"""
Chatbot Router - POST /chatbot/chat
===================================
Public student chat endpoint plus authenticated admin monitoring endpoints.
The chatbot stores sessions/messages and can raise complaint tickets for the
admin console.
"""

from __future__ import annotations

import logging
import re
import secrets
from collections import Counter
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.core.config import settings
from backend.core.deps import get_current_admin, get_db
from backend.models.chatbot import ChatMessage as ChatMessageModel
from backend.models.chatbot import ChatSession, Complaint
from backend.models.user import User
from backend.rag.retriever import get_retriever

log = logging.getLogger("chatbot")

router = APIRouter(prefix="/chatbot", tags=["chatbot"])


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    history: list[ChatMessage] = Field(default_factory=list)
    session_id: str | None = None
    display_name: str | None = Field(default=None, max_length=100)
    share_name: bool = False
    raise_complaint: bool = False


class ComplaintOut(BaseModel):
    ticket_id: str
    session_id: str | None = None
    display_name: str | None = None
    category: str
    priority: str
    status: str
    title: str
    summary: str
    student_message: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ChatResponse(BaseModel):
    reply: str
    session_id: str
    complaint: ComplaintOut | None = None
    sources: list[dict] = Field(default_factory=list)


class ChatSessionOut(BaseModel):
    session_id: str
    display_name: str | None = None
    share_name: bool
    last_message: str | None = None
    message_count: int
    complaint_count: int
    created_at: datetime
    updated_at: datetime


class ChatMessageOut(BaseModel):
    role: str
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ComplaintStatusUpdate(BaseModel):
    status: Literal["Open", "In Review", "Waiting on Student", "Resolved", "Closed"]


class AdminSummary(BaseModel):
    open_complaints: int
    high_priority_complaints: int
    resolved_today: int
    active_chat_sessions: int
    total_chat_messages: int
    recent_activity: list[dict]


_SYSTEM_TEMPLATE = """\
You are JIIT Buddy, a calm, professional, and genuinely kind campus guide for
Jaypee Institute of Information Technology (JIIT), Noida.

Your purpose is not just to answer quickly. Your purpose is to help students feel
oriented, understood, and less stressed while they figure out college information.
Speak like a patient senior mentor at a help desk: warm, clear, respectful, and
practical. Be sweet without being childish. Be professional without sounding cold.

Complaint handling:
- First try to help the student solve or understand the problem.
- If a complaint ticket has been created, acknowledge it clearly and calmly.
- Tell the student their ticket ID and what the admin team can see.
- If no ticket was created yet, explain what details they should provide before
  raising one.
- Never claim that an admin has already acted unless the context says so.

Privacy:
- Students may stay anonymous.
- If they did not choose to share a display name, refer to them by their chat ID
  only when needed.

Grounding rules:
- Use the CONTEXT below, taken from the JIIT official website, whenever it contains
  the answer.
- If the context answers the question, answer specifically and confidently.
- If the context is incomplete, say that the website context I found does not fully
  confirm it, then give the safest helpful guidance.
- Never invent exact numbers, dates, fees, policies, deadlines, names, or office
  instructions that are not in the context.
- Do not paste source URLs or mention citation numbers unless the student asks.

Response style:
- Write in clean Markdown.
- Start with a friendly one-sentence answer or reassurance.
- Prefer short sections such as **Short Answer**, **What This Means**, **Next Steps**,
  or **Keep Ready** when useful.
- Use bullets for lists and numbered steps for processes.
- Keep most answers under 180 words, but expand when the student asks for detail.
- Ask at most one gentle follow-up question when needed.
- For greetings or casual messages, respond naturally and invite a JIIT-related question.

--- JIIT WEBSITE CONTEXT ---
{context}
--- END CONTEXT ---

--- CURRENT CHAT ADMIN CONTEXT ---
{admin_context}
--- END ADMIN CONTEXT ---
"""


def _build_system_prompt(chunks: list[dict], admin_context: str = "") -> str:
    if not chunks:
        context_text = "No specific context retrieved for this query."
    else:
        parts = []
        for i, chunk in enumerate(chunks, 1):
            heading = chunk["heading"] or chunk["title"] or "General"
            parts.append(
                f"[{i}] {heading} (source: {chunk['url']})\n{chunk['text']}"
            )
        context_text = "\n\n".join(parts)

    return _SYSTEM_TEMPLATE.format(
        context=context_text,
        admin_context=admin_context or "No special admin action for this turn.",
    )


def _generate_session_id(db: Session) -> str:
    while True:
        value = f"CHAT-{secrets.token_hex(4).upper()}"
        exists = db.query(ChatSession).filter(ChatSession.session_id == value).first()
        if not exists:
            return value


def _get_or_create_session(request: ChatRequest, db: Session) -> ChatSession:
    session = None
    if request.session_id:
        session = (
            db.query(ChatSession)
            .filter(ChatSession.session_id == request.session_id)
            .first()
        )

    if session is None:
        session = ChatSession(session_id=_generate_session_id(db))
        db.add(session)

    clean_name = (request.display_name or "").strip()
    session.share_name = bool(request.share_name and clean_name)
    session.display_name = clean_name if session.share_name else None
    session.updated_at = datetime.now(timezone.utc)
    return session


def _add_message(db: Session, session: ChatSession, role: str, content: str) -> None:
    db.add(
        ChatMessageModel(
            session_id=session.session_id,
            role=role,
            content=content,
        )
    )
    session.last_message = content[:500]
    session.updated_at = datetime.now(timezone.utc)


def _recent_history_from_db(db: Session, session: ChatSession) -> list[dict]:
    rows = (
        db.query(ChatMessageModel)
        .filter(ChatMessageModel.session_id == session.session_id)
        .order_by(ChatMessageModel.created_at.desc(), ChatMessageModel.id.desc())
        .limit(10)
        .all()
    )
    return [
        {"role": row.role, "content": row.content}
        for row in reversed(rows)
        if row.role in {"user", "assistant"}
    ]


def _should_create_complaint(request: ChatRequest) -> bool:
    if request.raise_complaint:
        return True

    text = request.message.lower()
    explicit_patterns = (
        "raise complaint",
        "file complaint",
        "register complaint",
        "lodge complaint",
        "send to admin",
        "escalate this",
        "report this",
    )
    return any(pattern in text for pattern in explicit_patterns)


def _classify_category(text: str) -> str:
    lowered = text.lower()
    category_keywords = [
        ("Attendance", ("attendance", "present", "absent", "marked", "subject")),
        ("Network / Wi-Fi", ("wifi", "wi-fi", "internet", "network", "router")),
        ("Hostel", ("hostel", "room", "mess", "warden", "laundry")),
        ("Facilities", ("classroom", "projector", "lab", "washroom", "water", "electricity")),
        ("Admissions", ("admission", "application", "counselling", "fee", "fees")),
        ("Safety", ("fire", "smoke", "harassment", "unsafe", "security", "medical")),
        ("Placements", ("placement", "recruiter", "internship", "company")),
    ]
    for category, keywords in category_keywords:
        if any(keyword in lowered for keyword in keywords):
            return category
    return "General"


def _classify_priority(text: str, category: str) -> str:
    lowered = text.lower()
    high_words = ("urgent", "emergency", "unsafe", "harassment", "fire", "smoke", "medical")
    low_words = ("suggestion", "feedback", "request", "minor")
    if category == "Safety" or any(word in lowered for word in high_words):
        return "High"
    if any(word in lowered for word in low_words):
        return "Low"
    return "Medium"


def _title_from_message(text: str, category: str) -> str:
    clean = re.sub(r"\s+", " ", text).strip()
    if not clean:
        return f"{category} complaint"
    if len(clean) <= 90:
        return clean
    return f"{clean[:87].rstrip()}..."


def _generate_ticket_id(db: Session) -> str:
    while True:
        ticket_id = f"CMP-{datetime.now(timezone.utc):%y%m%d}-{secrets.token_hex(2).upper()}"
        exists = db.query(Complaint).filter(Complaint.ticket_id == ticket_id).first()
        if not exists:
            return ticket_id


def _create_complaint(db: Session, session: ChatSession, message: str) -> Complaint:
    category = _classify_category(message)
    priority = _classify_priority(message, category)
    complaint = Complaint(
        ticket_id=_generate_ticket_id(db),
        session_id=session.session_id,
        display_name=session.display_name if session.share_name else None,
        category=category,
        priority=priority,
        status="Open",
        title=_title_from_message(message, category),
        summary=message.strip(),
        student_message=message.strip(),
    )
    db.add(complaint)
    return complaint


def _build_admin_context(session: ChatSession, complaint: Complaint | None) -> str:
    lines = [f"Current chat ID: {session.session_id}."]
    if session.share_name and session.display_name:
        lines.append(f"The student chose to show this display name to admins: {session.display_name}.")
    else:
        lines.append("The student did not share a display name; admins will see this as Anonymous.")

    if complaint:
        lines.append(
            "A complaint ticket was created for this turn: "
            f"{complaint.ticket_id}, category {complaint.category}, priority {complaint.priority}."
        )
    return "\n".join(lines)


def _complaint_out(complaint: Complaint) -> ComplaintOut:
    return ComplaintOut.model_validate(complaint)


@router.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest, db: Session = Depends(get_db)) -> ChatResponse:
    """
    Accept a student message, persist the chat, optionally raise a complaint,
    and return an answer grounded in retrieved JIIT context.
    """
    if not settings.OPENAI_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Chatbot is not configured. OPENAI_API_KEY is missing.",
        )

    session = _get_or_create_session(request, db)
    complaint = _create_complaint(db, session, request.message) if _should_create_complaint(request) else None
    _add_message(db, session, "user", request.message)
    db.flush()

    retriever = get_retriever()
    chunks: list[dict] = []
    try:
        if retriever.is_ready():
            chunks = retriever.retrieve(request.message, n_results=5)
    except Exception as exc:
        log.warning("Retrieval failed, falling back to no-context mode: %s", exc)

    system_prompt = _build_system_prompt(chunks, _build_admin_context(session, complaint))
    db_history = _recent_history_from_db(db, session)
    if db_history:
        recent_history = db_history[-10:]
        recent_history = recent_history[:-1]  # current user message is appended below
    else:
        recent_history = [
            {"role": turn.role, "content": turn.content}
            for turn in request.history[-10:]
        ]

    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(recent_history)
    messages.append({"role": "user", "content": request.message})

    try:
        from openai import OpenAI

        client = OpenAI(api_key=settings.OPENAI_API_KEY)
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            temperature=0.55,
            max_tokens=900,
        )
        reply = response.choices[0].message.content or ""
    except Exception as exc:
        db.rollback()
        log.error("OpenAI call failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not reach the AI service. Please try again shortly.",
        )

    if complaint and complaint.ticket_id not in reply:
        reply = (
            f"{reply.rstrip()}\n\n"
            f"**Complaint Raised**\n"
            f"I have shared this with the admin team as ticket **{complaint.ticket_id}**. "
            f"Admins will see it under chat ID **{session.session_id}**"
            f"{' with your display name.' if session.display_name else ' without your name.'}"
        )

    _add_message(db, session, "assistant", reply)
    db.commit()
    if complaint:
        db.refresh(complaint)
    db.refresh(session)

    seen_urls: set[str] = set()
    sources: list[dict] = []
    for chunk in chunks:
        if chunk["url"] not in seen_urls:
            seen_urls.add(chunk["url"])
            sources.append(
                {
                    "url": chunk["url"],
                    "title": chunk["title"],
                    "heading": chunk["heading"],
                }
            )

    return ChatResponse(
        reply=reply,
        session_id=session.session_id,
        complaint=_complaint_out(complaint) if complaint else None,
        sources=sources,
    )


@router.get("/admin/summary", response_model=AdminSummary)
def admin_summary(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> AdminSummary:
    today = datetime.now(timezone.utc).date()
    open_statuses = ["Open", "In Review", "Waiting on Student"]

    open_complaints = (
        db.query(func.count(Complaint.id))
        .filter(Complaint.status.in_(open_statuses))
        .scalar()
    ) or 0
    high_priority = (
        db.query(func.count(Complaint.id))
        .filter(Complaint.priority == "High", Complaint.status.in_(open_statuses))
        .scalar()
    ) or 0
    resolved_today = (
        db.query(func.count(Complaint.id))
        .filter(
            Complaint.status.in_(["Resolved", "Closed"]),
            func.date(Complaint.updated_at) == today.isoformat(),
        )
        .scalar()
    ) or 0
    active_sessions = db.query(func.count(ChatSession.id)).scalar() or 0
    total_messages = db.query(func.count(ChatMessageModel.id)).scalar() or 0

    recent_complaints = (
        db.query(Complaint)
        .order_by(Complaint.created_at.desc())
        .limit(4)
        .all()
    )
    recent_messages = (
        db.query(ChatMessageModel)
        .filter(ChatMessageModel.role == "user")
        .order_by(ChatMessageModel.created_at.desc())
        .limit(4)
        .all()
    )

    activity = []
    for complaint in recent_complaints:
        activity.append(
            {
                "type": "complaint",
                "time": complaint.created_at.isoformat(),
                "title": f"{complaint.ticket_id} opened",
                "summary": complaint.title,
                "tone": "text-amber-700 bg-amber-50 border-amber-200",
            }
        )
    for message in recent_messages:
        activity.append(
            {
                "type": "chat",
                "time": message.created_at.isoformat(),
                "title": f"{message.session_id} message",
                "summary": message.content[:140],
                "tone": "text-sky-700 bg-sky-50 border-sky-200",
            }
        )
    activity.sort(key=lambda item: item["time"], reverse=True)

    return AdminSummary(
        open_complaints=open_complaints,
        high_priority_complaints=high_priority,
        resolved_today=resolved_today,
        active_chat_sessions=active_sessions,
        total_chat_messages=total_messages,
        recent_activity=activity[:6],
    )


@router.get("/admin/sessions", response_model=list[ChatSessionOut])
def list_chat_sessions(
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> list[ChatSessionOut]:
    rows = (
        db.query(
            ChatSession,
            func.count(func.distinct(ChatMessageModel.id)).label("message_count"),
            func.count(func.distinct(Complaint.id)).label("complaint_count"),
        )
        .outerjoin(ChatMessageModel, ChatMessageModel.session_id == ChatSession.session_id)
        .outerjoin(Complaint, Complaint.session_id == ChatSession.session_id)
        .group_by(ChatSession.id)
        .order_by(ChatSession.updated_at.desc())
        .limit(limit)
        .all()
    )

    return [
        ChatSessionOut(
            session_id=session.session_id,
            display_name=session.display_name,
            share_name=session.share_name,
            last_message=session.last_message,
            message_count=message_count,
            complaint_count=complaint_count,
            created_at=session.created_at,
            updated_at=session.updated_at,
        )
        for session, message_count, complaint_count in rows
    ]


@router.get("/admin/sessions/{session_id}/messages", response_model=list[ChatMessageOut])
def get_session_messages(
    session_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> list[ChatMessageOut]:
    return (
        db.query(ChatMessageModel)
        .filter(ChatMessageModel.session_id == session_id)
        .order_by(ChatMessageModel.created_at.asc(), ChatMessageModel.id.asc())
        .all()
    )


@router.get("/admin/complaints", response_model=list[ComplaintOut])
def list_complaints(
    status_filter: str | None = Query(None, alias="status"),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> list[ComplaintOut]:
    query = db.query(Complaint)
    if status_filter:
        query = query.filter(Complaint.status == status_filter)
    return query.order_by(Complaint.updated_at.desc()).limit(limit).all()


@router.patch("/admin/complaints/{ticket_id}", response_model=ComplaintOut)
def update_complaint_status(
    ticket_id: str,
    payload: ComplaintStatusUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
) -> ComplaintOut:
    complaint = db.query(Complaint).filter(Complaint.ticket_id == ticket_id).first()
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")
    complaint.status = payload.status
    complaint.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(complaint)
    return complaint


@router.get("/admin/complaints/stats")
def complaint_stats(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    rows = db.query(Complaint.status, func.count(Complaint.id)).group_by(Complaint.status).all()
    by_status = {status_value: count for status_value, count in rows}
    by_priority_rows = db.query(Complaint.priority, func.count(Complaint.id)).group_by(Complaint.priority).all()
    by_priority = {priority: count for priority, count in by_priority_rows}
    return {"by_status": by_status, "by_priority": by_priority}

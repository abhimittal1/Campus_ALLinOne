"""
Subjects router — CRUD for subjects, enrollment management, and
face-recognition based attendance taking via the IP camera.
"""

import asyncio
import os
from functools import lru_cache
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.core.deps import get_db, get_current_user, get_current_admin
from backend.models.attendance import Attendance
from backend.models.student import Student
from backend.models.subject import Subject, SubjectEnrollment
from backend.models.user import User
from backend.routers.camera import _camera_state
from backend.schemas.student import StudentOut
from backend.schemas.subject import (
    AttendanceResult,
    EnrollPayload,
    SubjectCreate,
    SubjectOut,
)

router = APIRouter(prefix="/subjects", tags=["subjects"])

# Face recognition settings
_FACE_SIM_THRESHOLD = 0.60  # cosine similarity threshold — raise to reduce false positives

# Path to students.json created by register_student.py (project root)
_STUDENTS_FILE = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "students.json")
)


def _load_face_db() -> dict:
    """Load students.json -> {student_id: {name, embedding: np.ndarray}}.
    Returns empty dict if the file is missing or malformed."""
    import json
    import numpy as np

    if not os.path.exists(_STUDENTS_FILE):
        return {}
    try:
        with open(_STUDENTS_FILE) as f:
            data = json.load(f)
        result = {}
        for s in data.get("students", []):
            sid = s.get("id")
            emb = s.get("embedding")
            name = s.get("name", "")
            if sid and emb:
                result[sid] = {
                    "name": name,
                    "embedding": np.array(emb, dtype=np.float32).flatten(),
                }
        return result
    except Exception:
        return {}


# ── ML models (loaded once at module import) ─────────────────────────────────

@lru_cache(maxsize=1)
def _load_models():
    import torch
    import torchvision.transforms as T
    from facenet_pytorch import MTCNN, InceptionResnetV1

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    mtcnn = MTCNN(keep_all=True, min_face_size=60, device=device)
    resnet = InceptionResnetV1(pretrained="vggface2").eval().to(device)
    transform = T.Compose([
        T.Resize((160, 160)),
        T.ToTensor(),
        T.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])
    return mtcnn, resnet, transform, device


def _get_embedding(face_pil, resnet, transform, device):
    """Return 512-dim embedding for a PIL face crop (RGB), or None if too small."""
    import torch

    if face_pil is None:
        return None
    w, h = face_pil.size
    if h < 20 or w < 20:
        return None
    tensor = transform(face_pil).unsqueeze(0).to(device)
    with torch.no_grad():
        emb = resnet(tensor).cpu().numpy().reshape(-1)
    return emb


def _cosine_similarity(a, b):
    import numpy as np
    a = np.asarray(a, dtype=np.float32).flatten()
    b = np.asarray(b, dtype=np.float32).flatten()
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def _capture_frame(url: str):
    """Capture one RGB frame from the configured camera URL."""
    from backend.routers.camera import capture_frame

    return capture_frame(url)


def _run_face_recognition(subject_id: int, db: Session) -> list[dict]:
    """Blocking function — run inside a thread executor.

    Returns a list of dicts with keys:
      student_id, student_name, similarity, enrolled, already_marked

    - enrolled=True  → student is registered for this subject (can mark attendance)
    - enrolled=False → face was recognised but student is NOT in this subject
    - already_marked → student was already marked present today for this subject
    """
    import numpy as np
    from datetime import date as _date

    mtcnn, resnet, transform, device = _load_models()
    camera_url = _camera_state["url"]

    # ── Load face embeddings: SQLite DB (primary) + students.json (fallback) ─
    # SQLite is written by the web UI "Register Face" button.
    # students.json is written by the CLI register_student.py.
    # Both are kept in sync by register_face(); we merge here so either source works.
    face_db: dict = {}

    # Primary: query all students that have an embedding stored in SQLite
    db_students = db.query(Student).filter(Student.embedding.isnot(None)).all()
    for s in db_students:
        face_db[s.student_id] = {
            "name": s.name,
            "embedding": np.array(s.embedding, dtype=np.float32).flatten(),
        }

    # Fallback: students.json — add any student not already found in the DB
    for sid, info in _load_face_db().items():
        if sid not in face_db:
            face_db[sid] = info

    if not face_db:
        raise RuntimeError(
            "No face embeddings registered. "
            "Use the Students page → 📷 Register Face to register students, "
            "or run register_student.py from the command line."
        )

    # ── Get enrolled student IDs for this subject ────────────────────────────
    enrollments = (
        db.query(SubjectEnrollment)
        .filter(SubjectEnrollment.subject_id == subject_id)
        .all()
    )
    enrolled_ids = {e.student_id for e in enrollments}

    # ── Capture a single frame ───────────────────────────────────────────────
    pil_frame = _capture_frame(camera_url)  # PIL Image (RGB)

    # ── Detect all faces in the frame ────────────────────────────────────────
    boxes, probs = mtcnn.detect(pil_frame)
    if boxes is None or len(boxes) == 0:
        return []

    # ── Find students already marked today for this subject ──────────────────
    today = _date.today()
    already_marked_ids: set[str] = set()
    for sid in face_db:
        if (
            db.query(Attendance)
            .filter(
                Attendance.student_id == sid,
                Attendance.date == today,
                Attendance.subject_id == subject_id,
            )
            .first()
        ):
            already_marked_ids.add(sid)

    # ── Match each detected face against all registered students ─────────────
    frame_w, frame_h = pil_frame.size
    results: list[dict] = []
    seen_student_ids: set[str] = set()

    for box, prob in zip(boxes, probs):
        # Skip low-confidence detections
        if prob is not None and prob < 0.90:
            continue

        # Crop face from PIL image (clamp to image bounds)
        x1 = max(0, int(box[0]))
        y1 = max(0, int(box[1]))
        x2 = min(frame_w, int(box[2]))
        y2 = min(frame_h, int(box[3]))
        face_pil = pil_frame.crop((x1, y1, x2, y2))
        face_emb = _get_embedding(face_pil, resnet, transform, device)
        if face_emb is None:
            continue

        # Find best cosine-similarity match across ALL registered students
        best_sim = -1.0
        best_sid: str | None = None
        best_name: str | None = None
        for sid, info in face_db.items():
            sim = _cosine_similarity(face_emb, info["embedding"])
            if sim > best_sim:
                best_sim = sim
                best_sid = sid
                best_name = info["name"]

        # Skip unknown faces (similarity below threshold)
        if best_sim < _FACE_SIM_THRESHOLD:
            continue

        # Deduplicate — each student appears at most once per scan
        if best_sid in seen_student_ids:
            continue
        seen_student_ids.add(best_sid)

        results.append({
            "student_id": best_sid,
            "student_name": best_name,
            "similarity": round(best_sim, 4),
            "enrolled": best_sid in enrolled_ids,
            "already_marked": best_sid in already_marked_ids,
        })

    return results


# ── Helper ────────────────────────────────────────────────────────────────────

def _subject_out(subject: Subject, db: Session) -> SubjectOut:
    count = (
        db.query(func.count(SubjectEnrollment.id))
        .filter(SubjectEnrollment.subject_id == subject.id)
        .scalar()
    ) or 0
    data = SubjectOut.model_validate(subject)
    data.student_count = count
    return data


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("", response_model=List[SubjectOut])
def list_subjects(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    subjects = db.query(Subject).order_by(Subject.created_at.desc()).all()
    return [_subject_out(s, db) for s in subjects]


@router.post("", response_model=SubjectOut, status_code=status.HTTP_201_CREATED)
def create_subject(
    payload: SubjectCreate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    if db.query(Subject).filter(Subject.code == payload.code).first():
        raise HTTPException(status_code=400, detail="Subject code already exists")
    subject = Subject(**payload.model_dump())
    db.add(subject)
    db.commit()
    db.refresh(subject)
    return _subject_out(subject, db)


@router.get("/{subject_id}", response_model=SubjectOut)
def get_subject(
    subject_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    subject = db.query(Subject).filter(Subject.id == subject_id).first()
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")
    return _subject_out(subject, db)


@router.delete("/{subject_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_subject(
    subject_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    subject = db.query(Subject).filter(Subject.id == subject_id).first()
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")
    db.delete(subject)
    db.commit()


@router.get("/{subject_id}/students", response_model=List[StudentOut])
def list_enrolled_students(
    subject_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    subject = db.query(Subject).filter(Subject.id == subject_id).first()
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")
    enrollments = (
        db.query(SubjectEnrollment)
        .filter(SubjectEnrollment.subject_id == subject_id)
        .all()
    )
    enrolled_ids = {e.student_id for e in enrollments}
    students = db.query(Student).filter(Student.student_id.in_(enrolled_ids)).all()

    from backend.routers.students import _to_out
    return [_to_out(s) for s in students]


@router.post("/{subject_id}/students", status_code=status.HTTP_201_CREATED)
def enroll_students(
    subject_id: int,
    payload: EnrollPayload,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    subject = db.query(Subject).filter(Subject.id == subject_id).first()
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")

    added = 0
    for sid in payload.student_ids:
        student = db.query(Student).filter(Student.student_id == sid).first()
        if not student:
            continue
        existing = (
            db.query(SubjectEnrollment)
            .filter(
                SubjectEnrollment.subject_id == subject_id,
                SubjectEnrollment.student_id == sid,
            )
            .first()
        )
        if not existing:
            db.add(SubjectEnrollment(subject_id=subject_id, student_id=sid))
            added += 1
    db.commit()
    return {"enrolled": added}


@router.delete("/{subject_id}/students/{student_id}", status_code=status.HTTP_204_NO_CONTENT)
def unenroll_student(
    subject_id: int,
    student_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    enrollment = (
        db.query(SubjectEnrollment)
        .filter(
            SubjectEnrollment.subject_id == subject_id,
            SubjectEnrollment.student_id == student_id,
        )
        .first()
    )
    if not enrollment:
        raise HTTPException(status_code=404, detail="Enrollment not found")
    db.delete(enrollment)
    db.commit()


@router.post("/{subject_id}/take-attendance", response_model=List[AttendanceResult])
async def take_attendance(
    subject_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    subject = db.query(Subject).filter(Subject.id == subject_id).first()
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")

    loop = asyncio.get_event_loop()
    try:
        results = await loop.run_in_executor(
            None, _run_face_recognition, subject_id, db
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    return results

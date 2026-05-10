from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.core.deps import get_db, get_current_user
from backend.models.attendance import Attendance
from backend.models.student import Student
from backend.models.subject import SubjectEnrollment
from backend.models.user import User
from backend.schemas.attendance import (
    AttendanceCreate,
    AttendanceOut,
    AttendanceSummary,
    StudentSubjectReport,
)

router = APIRouter(prefix="/attendance", tags=["attendance"])


@router.get("", response_model=list[AttendanceOut])
def list_attendance(
    student_id: str | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = db.query(Attendance)
    if student_id:
        q = q.filter(Attendance.student_id == student_id)
    if date_from:
        q = q.filter(Attendance.date >= date_from)
    if date_to:
        q = q.filter(Attendance.date <= date_to)
    return q.order_by(Attendance.timestamp.desc()).offset(skip).limit(limit).all()


@router.get("/summary", response_model=list[AttendanceSummary])
def attendance_summary(
    days: int = Query(7, ge=1, le=90, description="Number of past days to summarise"),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    rows = (
        db.query(Attendance.date, func.count(Attendance.id).label("total"))
        .group_by(Attendance.date)
        .order_by(Attendance.date.desc())
        .limit(days)
        .all()
    )
    return [{"date": r.date, "total": r.total} for r in rows]


@router.post("", response_model=AttendanceOut, status_code=201)
def create_attendance(
    payload: AttendanceCreate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    # Prevent duplicate: same student + same date + same subject
    duplicate = (
        db.query(Attendance)
        .filter(
            Attendance.student_id == payload.student_id,
            Attendance.date == payload.date,
            Attendance.subject_id == payload.subject_id,
        )
        .first()
    )
    if duplicate:
        raise HTTPException(
            status_code=409,
            detail=f"Attendance already recorded for student {payload.student_id} on {payload.date}",
        )
    record = Attendance(**payload.model_dump())
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


@router.get("/subject-report", response_model=list[StudentSubjectReport])
def subject_report(
    subject_id: int = Query(..., description="Subject to report on"),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return attendance statistics for every enrolled student in the given subject.

    Response lists ALL enrolled students (even those with 0 attendance) so the UI
    can show an 'Absent' row rather than hiding them.
    """
    from backend.models.subject import Subject
    from pathlib import Path

    subject = db.query(Subject).filter(Subject.id == subject_id).first()
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")

    # All enrolled students for this subject
    enrollments = (
        db.query(SubjectEnrollment)
        .filter(SubjectEnrollment.subject_id == subject_id)
        .all()
    )
    enrolled_ids = [e.student_id for e in enrollments]

    if not enrolled_ids:
        return []

    students = (
        db.query(Student)
        .filter(Student.student_id.in_(enrolled_ids))
        .all()
    )
    student_map = {s.student_id: s for s in students}

    # Attendance records for this subject (optionally filtered by date)
    q = db.query(Attendance).filter(Attendance.subject_id == subject_id)
    if date_from:
        q = q.filter(Attendance.date >= date_from)
    if date_to:
        q = q.filter(Attendance.date <= date_to)
    records = q.all()

    # Group records by student_id
    from collections import defaultdict
    by_student: dict[str, list[date]] = defaultdict(list)
    for r in records:
        by_student[r.student_id].append(r.date)

    UPLOADS_BASE = "/uploads/students/"
    result = []
    for sid in enrolled_ids:
        student = student_map.get(sid)
        dates = sorted(set(by_student.get(sid, [])))
        photo_url = (UPLOADS_BASE + student.photo_path) if (student and student.photo_path) else None
        result.append(StudentSubjectReport(
            student_id=sid,
            student_name=student.name if student else sid,
            photo_url=photo_url,
            present_count=len(dates),
            last_seen=dates[-1] if dates else None,
            dates=dates,
        ))

    # Sort: present_count descending, then name
    result.sort(key=lambda r: (-r.present_count, r.student_name))
    return result

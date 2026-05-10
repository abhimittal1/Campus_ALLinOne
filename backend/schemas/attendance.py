from datetime import date, time, datetime
from typing import Optional

from pydantic import BaseModel


class AttendanceCreate(BaseModel):
    student_id: str
    student_name: str
    subject_id: Optional[int] = None
    date: date
    time: time
    timestamp: datetime


class AttendanceOut(BaseModel):
    id: int
    student_id: str
    student_name: str
    subject_id: Optional[int] = None
    date: date
    time: time
    timestamp: datetime
    created_at: datetime

    model_config = {"from_attributes": True}


class AttendanceSummary(BaseModel):
    date: date
    total: int


class StudentSubjectReport(BaseModel):
    """Attendance statistics for one student in one subject."""
    student_id: str
    student_name: str
    photo_url: Optional[str] = None
    present_count: int
    last_seen: Optional[date] = None
    dates: list[date]  # list of dates the student was present

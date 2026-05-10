from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class SubjectCreate(BaseModel):
    name: str
    code: str
    description: Optional[str] = None


class SubjectOut(BaseModel):
    id: int
    name: str
    code: str
    description: Optional[str] = None
    created_at: datetime
    student_count: int = 0

    model_config = {"from_attributes": True}


class EnrollPayload(BaseModel):
    student_ids: list[str]


class AttendanceResult(BaseModel):
    student_id: str
    student_name: str
    similarity: float
    enrolled: bool = True        # False = face recognised but not enrolled in this subject
    already_marked: bool = False  # True = already marked present today for this subject

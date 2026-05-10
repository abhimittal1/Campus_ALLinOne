from datetime import datetime
from typing import Any

from pydantic import BaseModel


class StudentCreate(BaseModel):
    student_id: str
    name: str
    embedding: list[float] | None = None


class StudentUpdate(BaseModel):
    name: str | None = None
    embedding: list[float] | None = None


class StudentOut(BaseModel):
    id: int
    student_id: str
    name: str
    photo_url: str | None = None
    face_registered: bool = False  # True when a face embedding has been captured
    created_at: datetime

    model_config = {"from_attributes": True}


class StudentWithEmbedding(StudentOut):
    embedding: list[float] | None = None

from datetime import datetime, timezone

from sqlalchemy import Column, Integer, String, DateTime, JSON
from sqlalchemy.orm import relationship

from backend.database import Base


class Student(Base):
    __tablename__ = "students"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(String(20), unique=True, nullable=False, index=True)
    name = Column(String(100), nullable=False)
    embedding = Column(JSON, nullable=True)          # 512-dim FaceNet float list
    photo_path = Column(String(255), nullable=True)  # relative path under uploads/
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    attendances = relationship("Attendance", back_populates="student", cascade="all, delete-orphan")
    enrollments = relationship("SubjectEnrollment", back_populates="student", cascade="all, delete-orphan")

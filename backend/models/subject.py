from datetime import datetime, timezone

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship

from backend.database import Base


class Subject(Base):
    __tablename__ = "subjects"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    code = Column(String(20), unique=True, nullable=False, index=True)
    description = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    enrollments = relationship(
        "SubjectEnrollment",
        back_populates="subject",
        cascade="all, delete-orphan",
    )


class SubjectEnrollment(Base):
    __tablename__ = "subject_enrollments"

    id = Column(Integer, primary_key=True, index=True)
    subject_id = Column(
        Integer,
        ForeignKey("subjects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    student_id = Column(
        String(20),
        ForeignKey("students.student_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    enrolled_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    __table_args__ = (UniqueConstraint("subject_id", "student_id", name="uq_subject_student"),)

    subject = relationship("Subject", back_populates="enrollments")
    student = relationship("Student", back_populates="enrollments")

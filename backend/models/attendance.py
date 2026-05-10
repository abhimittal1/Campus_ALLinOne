from datetime import datetime, timezone

from sqlalchemy import Column, Integer, String, Date, Time, DateTime, ForeignKey
from sqlalchemy.orm import relationship

from backend.database import Base


class Attendance(Base):
    __tablename__ = "attendance"

    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(String(20), ForeignKey("students.student_id", ondelete="CASCADE"), nullable=False, index=True)
    student_name = Column(String(100), nullable=False)
    subject_id = Column(Integer, ForeignKey("subjects.id", ondelete="SET NULL"), nullable=True, index=True)
    date = Column(Date, nullable=False, index=True)
    time = Column(Time, nullable=False)
    timestamp = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    student = relationship("Student", back_populates="attendances")
    subject = relationship("Subject")

from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from backend.database import Base


class FireZone(Base):
    __tablename__ = "fire_zones"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False, unique=True, index=True)
    description = Column(String(255), nullable=True)
    camera_url = Column(String(500), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    alerts = relationship("FireAlert", back_populates="zone", cascade="all, delete-orphan")


class FireAlert(Base):
    __tablename__ = "fire_alerts"

    id = Column(Integer, primary_key=True, index=True)
    zone_id = Column(
        Integer,
        ForeignKey("fire_zones.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    detection_type = Column(String(20), nullable=False)  # "fire" | "smoke"
    confidence = Column(Float, nullable=False)
    snapshot_filename = Column(String(255), nullable=True)
    detections_json = Column(Text, nullable=True)  # JSON list of all detections
    is_dismissed = Column(Boolean, default=False, nullable=False)
    dismissed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        index=True,
    )

    zone = relationship("FireZone", back_populates="alerts")

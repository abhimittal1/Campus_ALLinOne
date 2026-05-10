from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class FireZoneCreate(BaseModel):
    name: str
    description: Optional[str] = None
    camera_url: Optional[str] = None   # blank → uses CAMERA_URL from .env
    is_active: bool = True


class FireZoneUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    camera_url: Optional[str] = None
    is_active: Optional[bool] = None


class FireZoneOut(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    camera_url: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class FireAlertOut(BaseModel):
    id: int
    zone_id: int
    zone_name: str
    detection_type: str
    confidence: float
    snapshot_filename: Optional[str] = None
    detections_json: Optional[str] = None
    is_dismissed: bool
    dismissed_at: Optional[datetime] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class FireZoneStatus(BaseModel):
    zone_id: int
    zone_name: str
    status_level: str = "normal"
    is_alert: bool = False
    consecutive_frames: int = 0
    strongest_detection: Optional[str] = None
    strongest_confidence: Optional[float] = None
    last_checked: Optional[str] = None
    current_detections: list[dict] = Field(default_factory=list)
    last_alert_detections: list[dict] = Field(default_factory=list)
    recent_frame_votes: list[dict] = Field(default_factory=list)
    scan_frames_sampled: int = 0
    error: Optional[str] = None


class FireStatsOut(BaseModel):
    active_zones: int
    alerts_today: int
    fire_count_today: int
    smoke_count_today: int
    total_alerts: int
    dismissed_alerts: int


class MonitorStatusOut(BaseModel):
    is_monitoring: bool
    last_scan_at: Optional[str] = None
    zones_count: int

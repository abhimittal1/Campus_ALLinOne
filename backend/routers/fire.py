from __future__ import annotations

import asyncio
import json
import time
from datetime import date, datetime, timezone
from io import BytesIO
from pathlib import Path
from threading import Lock
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from backend.core.deps import get_current_admin, get_db
from backend.core.config import settings
from backend.database import SessionLocal
from backend.models.fire import FireAlert, FireZone
from backend.models.user import User
from backend.routers.camera import capture_frame, normalize_camera_url
from backend.schemas.fire import (
    FireAlertOut,
    FireStatsOut,
    FireZoneCreate,
    FireZoneOut,
    FireZoneStatus,
    FireZoneUpdate,
    MonitorStatusOut,
)

router = APIRouter(prefix="/fire", tags=["fire"])

# ── Paths ─────────────────────────────────────────────────────────────────────
_WEIGHTS_PATH = (
    Path(__file__).resolve().parent.parent.parent
    / "best weights of training YOLO v8"
    / "best (1).pt"
)
_UPLOADS_DIR = Path(__file__).resolve().parent.parent / "uploads" / "fire_alerts"

# ── Module-level singletons ────────────────────────────────────────────────────
_yolo_model = None
_zone_states: dict[int, dict] = {}
_monitor_task: asyncio.Task | None = None
_is_monitoring: bool = False
_last_scan_at: str | None = None
_yolo_predict_lock = Lock()

# Detection thresholds + temporal smoothing tuned for live campus monitoring.
_MODEL_PREDICT_CONF = 0.20
_MODEL_PREDICT_IOU = 0.55
_MODEL_PREDICT_IMGSZ = 960
_FRAME_CAPTURE_TIMEOUT_SEC = 3.0
_SCAN_FRAME_COUNT = 3
_SCAN_FRAME_DELAY_SEC = 0.18
_SCAN_VOTE_THRESHOLD = 2
_FIRE_SUSPECT_CONF = 0.20
_SMOKE_SUSPECT_CONF = 0.20
_FIRE_ALERT_CONF = 0.33
_SMOKE_ALERT_CONF = 0.30
_CLEAR_STREAK_THRESHOLD = 2
_ALERT_RATE_LIMIT_SEC = 5


def _resolve_camera_url(camera_url: str | None) -> str:
    """Normalise a camera URL, falling back to CAMERA_URL from .env if blank."""
    raw = normalize_camera_url((camera_url or "").strip())
    if not raw:
        raw = settings.CAMERA_URL.strip()
    if not raw:
        raise HTTPException(
            status_code=400,
            detail="No camera URL provided and CAMERA_URL is not set in .env",
        )
    if not raw.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Camera URL must start with http:// or https://")
    return raw


# ── Model loading ──────────────────────────────────────────────────────────────

def _get_model():
    global _yolo_model
    if _yolo_model is None:
        try:
            from ultralytics import YOLO
        except ImportError as exc:
            raise RuntimeError(
                "ultralytics is not installed. Run: pip install ultralytics"
            ) from exc
        if not _WEIGHTS_PATH.exists():
            raise RuntimeError(f"YOLO weights not found at: {_WEIGHTS_PATH}")
        _yolo_model = YOLO(str(_WEIGHTS_PATH))
    return _yolo_model


# ── Per-zone in-memory state ───────────────────────────────────────────────────

def _get_zone_state(zone_id: int) -> dict:
    if zone_id not in _zone_states:
        _zone_states[zone_id] = {
            "is_alert": False,
            "status_level": "normal",
            "consecutive_frames": 0,
            "clear_streak": 0,
            "last_alert_at": 0.0,
            "last_checked": None,
            "current_detections": [],
            "last_alert_detections": [],
            "strongest_detection": None,
            "strongest_confidence": None,
            "scan_frames_sampled": 0,
            "recent_frame_votes": [],
            "error": None,
        }
    return _zone_states[zone_id]


# ── Blocking helpers (all run inside run_in_threadpool) ────────────────────────

def _sync_capture_frame(camera_url: str):
    """Capture a frame from camera; returns PIL Image."""
    return capture_frame(camera_url, timeout=_FRAME_CAPTURE_TIMEOUT_SEC)


def _detection_level(detection: dict) -> str | None:
    label = str(detection.get("label", "")).lower()
    confidence = float(detection.get("confidence", 0.0))

    if label == "fire":
        if confidence >= _FIRE_ALERT_CONF:
            return "alert"
        if confidence >= _FIRE_SUSPECT_CONF:
            return "suspect"
    elif label == "smoke":
        if confidence >= _SMOKE_ALERT_CONF:
            return "alert"
        if confidence >= _SMOKE_SUSPECT_CONF:
            return "suspect"

    return None


def _serialize_detection(detection: dict) -> dict:
    serialized = {
        "label": detection["label"],
        "confidence": round(float(detection["confidence"]), 3),
        "xyxy": detection["xyxy"],
    }
    level = _detection_level(detection)
    if level is not None:
        serialized["level"] = level
    return serialized


def _detection_priority(detection: dict | None) -> tuple[int, int, float]:
    if not detection:
        return (-1, -1, -1.0)

    level_rank = {None: 0, "suspect": 1, "alert": 2}[_detection_level(detection)]
    label_rank = 1 if str(detection.get("label", "")).lower() == "fire" else 0
    return (level_rank, label_rank, float(detection.get("confidence", 0.0)))


def _strongest_detection(detections: list[dict]) -> dict | None:
    relevant_detections = [detection for detection in detections if _detection_level(detection)]
    if not relevant_detections:
        return None
    return max(relevant_detections, key=_detection_priority)


def _frame_vote(detections: list[dict]) -> dict:
    strongest = _strongest_detection(detections)
    if strongest is None:
        return {"level": "none", "label": None, "confidence": 0.0}

    return {
        "level": _detection_level(strongest),
        "label": strongest["label"],
        "confidence": round(float(strongest["confidence"]), 3),
    }


def _pick_representative_frame(frame_results: list[dict]) -> dict:
    strongest_frame = max(
        frame_results,
        key=lambda item: _detection_priority(item["strongest_detection"]),
    )
    if strongest_frame["strongest_detection"] is not None:
        return strongest_frame
    return frame_results[-1]


def _banner_for_status(status_level: str, strongest_label: str | None) -> tuple[str, tuple[int, int, int]] | None:
    label = (strongest_label or "Fire").upper()
    if status_level == "alert":
        return (f"{label} ALERT", (0, 0, 255))
    if status_level == "suspect":
        return (f"SUSPECTED {label}", (0, 165, 255))
    return None


def _draw_detections(frame_bgr, detections: list[dict]) -> None:
    import cv2

    for det in detections:
        label = det["label"]
        conf = float(det["confidence"])
        xyxy = det.get("xyxy")
        if not xyxy:
            continue

        level = _detection_level(det)
        if level == "alert":
            color = (0, 0, 255)
        elif level == "suspect":
            color = (0, 165, 255)
        else:
            color = (120, 120, 120)

        x1, y1, x2, y2 = xyxy
        cv2.rectangle(frame_bgr, (x1, y1), (x2, y2), color, 2)
        cv2.putText(
            frame_bgr,
            f"{label} {conf:.2f}",
            (x1, max(y1 - 8, 20)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            color,
            2,
            cv2.LINE_AA,
        )


def _run_yolo(frame_pil) -> list[dict]:
    """Run YOLO inference on a PIL Image; returns list of detection dicts with xyxy."""
    import numpy as np

    frame_rgb = np.array(frame_pil.convert("RGB"))
    model = _get_model()
    with _yolo_predict_lock:
        results = model.predict(
            frame_rgb,
            conf=_MODEL_PREDICT_CONF,
            iou=_MODEL_PREDICT_IOU,
            imgsz=_MODEL_PREDICT_IMGSZ,
            verbose=False,
        )
    detections: list[dict] = []
    for result in results:
        names = result.names
        for box in result.boxes:
            class_id = int(box.cls[0])
            label = names[class_id]
            confidence = float(box.conf[0])
            xyxy = tuple(int(v) for v in box.xyxy[0].tolist())
            detections.append({"label": label, "confidence": confidence, "xyxy": xyxy})
    detections.sort(key=_detection_priority, reverse=True)
    return detections


def _annotate_jpeg(
    frame_pil,
    detections: list[dict],
    status_level: str,
    strongest_label: str | None,
) -> bytes:
    """Overlay bounding boxes + optional alert banner. Returns JPEG bytes.
    Mirrors draw_detection() from fire_alert_camera.py."""
    import cv2
    import numpy as np

    frame_bgr = cv2.cvtColor(np.array(frame_pil.convert("RGB")), cv2.COLOR_RGB2BGR)

    _draw_detections(frame_bgr, detections)

    banner = _banner_for_status(status_level, strongest_label)
    if banner:
        text, color = banner
        cv2.putText(
            frame_bgr,
            text,
            (20, 44),
            cv2.FONT_HERSHEY_SIMPLEX,
            1.1,
            color,
            3,
            cv2.LINE_AA,
        )

    _, buf = cv2.imencode(".jpg", frame_bgr, [cv2.IMWRITE_JPEG_QUALITY, 82])
    return buf.tobytes()


def _sync_snapshot_frame(zone_id: int, camera_url: str) -> bytes:
    """Capture one fresh camera frame and annotate it with the current zone state.
    No YOLO inference — state is populated by the background monitor loop.
    Returns JPEG bytes."""
    frame = _sync_capture_frame(camera_url)
    state = _get_zone_state(zone_id)
    return _annotate_jpeg(
        frame,
        state.get("current_detections", []),
        state.get("status_level", "normal"),
        state.get("strongest_detection"),
    )


def _save_alert_snapshot(frame_rgb, zone_id: int, detections: list[dict]) -> str | None:
    """Draw boxes and save annotated JPEG; return filename or None on error."""
    try:
        import cv2
        import numpy as np

        _UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        filename = f"zone_{zone_id}_{ts}.jpg"
        frame_bgr = cv2.cvtColor(np.array(frame_rgb), cv2.COLOR_RGB2BGR)

        _draw_detections(frame_bgr, detections)

        banner = _banner_for_status(
            "alert",
            detections[0]["label"] if detections else None,
        )
        if banner:
            text, color = banner
            cv2.putText(
                frame_bgr,
                text,
                (20, 44),
                cv2.FONT_HERSHEY_SIMPLEX,
                1.1,
                color,
                3,
                cv2.LINE_AA,
            )

        cv2.imwrite(str(_UPLOADS_DIR / filename), frame_bgr)
        return filename
    except Exception:
        return None


def _sync_scan_zone(zone_id: int, camera_url: str) -> dict:
    """Capture multiple nearby frames + YOLO inference + update in-memory state."""
    state = _get_zone_state(zone_id)
    previous_status = state["status_level"]
    frame_results: list[dict] = []
    errors: list[str] = []

    for frame_index in range(_SCAN_FRAME_COUNT):
        try:
            frame = _sync_capture_frame(camera_url)
            detections = _run_yolo(frame)
        except Exception as exc:
            errors.append(str(exc))
        else:
            frame_results.append(
                {
                    "frame": frame,
                    "detections": detections,
                    "strongest_detection": _strongest_detection(detections),
                    "vote": _frame_vote(detections),
                }
            )

        if frame_index < _SCAN_FRAME_COUNT - 1:
            time.sleep(_SCAN_FRAME_DELAY_SEC)

    if not frame_results:
        error_message = errors[-1] if errors else "No frames received from camera"
        state["error"] = error_message
        state["last_checked"] = datetime.now(timezone.utc).isoformat()
        state["scan_frames_sampled"] = 0
        state["recent_frame_votes"] = []
        return {
            "frame": None,
            "alert_detections": [],
            "all_detections": [],
            "error": error_message,
            "alert_transitioned": False,
        }

    representative = _pick_representative_frame(frame_results)
    representative_detections = representative["detections"]
    current_detections = [_serialize_detection(detection) for detection in representative_detections]
    relevant_detections = [
        detection for detection in current_detections if detection.get("level") in {"suspect", "alert"}
    ]
    alert_dets = [
        detection for detection in current_detections if detection.get("level") == "alert"
    ]
    strongest = representative["strongest_detection"]
    alert_votes = sum(1 for item in frame_results if item["vote"]["level"] == "alert")
    suspect_votes = sum(
        1 for item in frame_results if item["vote"]["level"] in {"suspect", "alert"}
    )

    if alert_votes >= _SCAN_VOTE_THRESHOLD:
        status_level = "alert"
        state["consecutive_frames"] = state["consecutive_frames"] + 1 if previous_status in {"alert", "suspect"} else 1
        state["clear_streak"] = 0
    elif suspect_votes >= _SCAN_VOTE_THRESHOLD or representative["vote"]["level"] == "suspect":
        status_level = "suspect"
        state["consecutive_frames"] = state["consecutive_frames"] + 1 if previous_status in {"alert", "suspect"} else 1
        state["clear_streak"] = 0
    else:
        if previous_status in {"alert", "suspect"}:
            state["clear_streak"] += 1
            if state["clear_streak"] < _CLEAR_STREAK_THRESHOLD:
                status_level = previous_status
            else:
                status_level = "normal"
                state["clear_streak"] = 0
                state["consecutive_frames"] = 0
        else:
            status_level = "normal"
            state["clear_streak"] = 0
            state["consecutive_frames"] = 0

    alert_transitioned = previous_status != "alert" and status_level == "alert"

    state["status_level"] = status_level
    state["is_alert"] = status_level == "alert"
    state["current_detections"] = current_detections
    if status_level == "alert" and relevant_detections:
        state["last_alert_detections"] = relevant_detections
    elif status_level == "normal":
        state["last_alert_detections"] = []
    state["strongest_detection"] = strongest["label"] if strongest else None
    state["strongest_confidence"] = round(float(strongest["confidence"]), 3) if strongest else None
    state["scan_frames_sampled"] = len(frame_results)
    state["recent_frame_votes"] = [item["vote"] for item in frame_results]
    state["last_checked"] = datetime.now(timezone.utc).isoformat()
    state["error"] = None

    return {
        "frame": representative["frame"],
        "alert_detections": alert_dets,
        "all_detections": current_detections,
        "error": None,
        "alert_transitioned": alert_transitioned,
    }


def _persist_alerts(zone_id: int, alert_dets: list[dict], snapshot_filename: str | None):
    """Write FireAlert rows, rate-limited. Blocking DB call."""
    state = _get_zone_state(zone_id)
    now = time.time()
    if now - state["last_alert_at"] < _ALERT_RATE_LIMIT_SEC:
        return
    state["last_alert_at"] = now

    db = SessionLocal()
    try:
        for det in alert_dets:
            db.add(
                FireAlert(
                    zone_id=zone_id,
                    detection_type=det["label"].lower(),
                    confidence=det["confidence"],
                    snapshot_filename=snapshot_filename,
                    detections_json=json.dumps(alert_dets),
                )
            )
        db.commit()
    finally:
        db.close()


# ── Background monitor loop ────────────────────────────────────────────────────

async def _fire_monitor_loop():
    global _last_scan_at
    while True:
        try:
            db = SessionLocal()
            try:
                zones = db.query(FireZone).filter(FireZone.is_active.is_(True)).all()
                zone_list = [(z.id, z.camera_url) for z in zones]
            finally:
                db.close()

            for zone_id, raw_url in zone_list:
                try:
                    camera_url = _resolve_camera_url(raw_url)
                    result = await run_in_threadpool(_sync_scan_zone, zone_id, camera_url)
                    if result["alert_transitioned"] and result["alert_detections"]:
                        snap = await run_in_threadpool(
                            _save_alert_snapshot,
                            result["frame"],
                            zone_id,
                            result["alert_detections"],
                        )
                        await run_in_threadpool(
                            _persist_alerts,
                            zone_id,
                            result["alert_detections"],
                            snap,
                        )
                except Exception as exc:
                    _get_zone_state(zone_id)["error"] = str(exc)

            _last_scan_at = datetime.now(timezone.utc).isoformat()
        except Exception:
            pass

        await asyncio.sleep(5)


async def startup_fire_monitor() -> None:
    """Pre-warm the YOLO model and start the background monitor loop.
    Called once from the FastAPI lifespan on server startup."""
    global _monitor_task, _is_monitoring
    if _is_monitoring and _monitor_task and not _monitor_task.done():
        return
    # Pre-warm: load the model now so the first snapshot request is not slow.
    try:
        await run_in_threadpool(_get_model)
    except Exception:
        pass  # weights missing / ultralytics not installed — surface later per-request
    _monitor_task = asyncio.create_task(_fire_monitor_loop())
    _is_monitoring = True


async def shutdown_fire_monitor() -> None:
    """Cancel the background monitor loop. Called from the FastAPI lifespan on shutdown."""
    global _monitor_task, _is_monitoring
    _is_monitoring = False
    if _monitor_task and not _monitor_task.done():
        _monitor_task.cancel()
        try:
            await _monitor_task
        except asyncio.CancelledError:
            pass


def _build_zone_status(zone_id: int, zone_name: str) -> FireZoneStatus:
    state = _get_zone_state(zone_id)
    return FireZoneStatus(
        zone_id=zone_id,
        zone_name=zone_name,
        status_level=state["status_level"],
        is_alert=state["is_alert"],
        consecutive_frames=state["consecutive_frames"],
        strongest_detection=state.get("strongest_detection"),
        strongest_confidence=state.get("strongest_confidence"),
        last_checked=state["last_checked"],
        current_detections=state["current_detections"],
        last_alert_detections=state.get("last_alert_detections", []),
        recent_frame_votes=state.get("recent_frame_votes", []),
        scan_frames_sampled=state.get("scan_frames_sampled", 0),
        error=state.get("error"),
    )


# ── Zone CRUD endpoints ────────────────────────────────────────────────────────

@router.get("/zones", response_model=list[FireZoneOut])
def list_zones(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    return db.query(FireZone).order_by(FireZone.created_at.desc()).all()


@router.post("/zones", response_model=FireZoneOut, status_code=status.HTTP_201_CREATED)
def create_zone(
    payload: FireZoneCreate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    if db.query(FireZone).filter(FireZone.name == payload.name).first():
        raise HTTPException(status_code=409, detail="A zone with that name already exists")
    data = payload.model_dump()
    data["camera_url"] = _resolve_camera_url(data.get("camera_url"))
    zone = FireZone(**data)
    db.add(zone)
    db.commit()
    db.refresh(zone)
    return zone


@router.put("/zones/{zone_id}", response_model=FireZoneOut)
def update_zone(
    zone_id: int,
    payload: FireZoneUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    zone = db.query(FireZone).filter(FireZone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    data = payload.model_dump(exclude_unset=True)
    if "camera_url" in data:
        data["camera_url"] = _resolve_camera_url(data.get("camera_url"))
    for field, value in data.items():
        setattr(zone, field, value)
    zone.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(zone)
    return zone


@router.delete("/zones/{zone_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_zone(
    zone_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    zone = db.query(FireZone).filter(FireZone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    db.delete(zone)
    db.commit()
    _zone_states.pop(zone_id, None)


# ── Snapshot endpoint — live frame + YOLO inference on every call ────────────

@router.get("/zones/{zone_id}/snapshot")
async def zone_snapshot(zone_id: int, db: Session = Depends(get_db)):
    """Capture a fresh camera frame and return it annotated with the current zone
    state (populated by the background monitor loop).  No YOLO inference here —
    that runs every 5 s in the monitor, keeping this endpoint fast."""
    zone = db.query(FireZone).filter(FireZone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    camera_url = _resolve_camera_url(zone.camera_url)

    try:
        jpeg_bytes = await asyncio.wait_for(
            run_in_threadpool(_sync_snapshot_frame, zone_id, camera_url),
            timeout=6.0,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=503, detail="Camera did not respond within 6 s")
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Camera error: {exc}")

    return StreamingResponse(
        BytesIO(jpeg_bytes),
        media_type="image/jpeg",
        headers={"Cache-Control": "no-store"},
    )


# ── On-demand scan ─────────────────────────────────────────────────────────────

@router.post("/zones/{zone_id}/scan", response_model=FireZoneStatus)
async def scan_zone_now(
    zone_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """Trigger an immediate YOLO scan for one zone and update its state."""
    zone = db.query(FireZone).filter(FireZone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

    camera_url = _resolve_camera_url(zone.camera_url)
    result = await run_in_threadpool(_sync_scan_zone, zone_id, camera_url)
    state = _get_zone_state(zone_id)

    if result["alert_transitioned"] and result["alert_detections"]:
        snap = await run_in_threadpool(
            _save_alert_snapshot, result["frame"], zone_id, result["alert_detections"]
        )
        await run_in_threadpool(
            _persist_alerts, zone_id, result["alert_detections"], snap
        )

    return _build_zone_status(zone_id, zone.name)


# ── Status endpoint ────────────────────────────────────────────────────────────

@router.get("/status", response_model=list[FireZoneStatus])
def get_fire_status(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    zones = db.query(FireZone).order_by(FireZone.created_at.desc()).all()
    return [_build_zone_status(z.id, z.name) for z in zones]


# ── Monitor control ────────────────────────────────────────────────────────────

@router.post("/monitor/start")
async def start_monitor(_: User = Depends(get_current_admin)):
    global _monitor_task, _is_monitoring
    if _is_monitoring and _monitor_task and not _monitor_task.done():
        return {"detail": "Monitor is already running"}
    _monitor_task = asyncio.create_task(_fire_monitor_loop())
    _is_monitoring = True
    return {"detail": "Monitor started"}


@router.post("/monitor/stop")
async def stop_monitor(_: User = Depends(get_current_admin)):
    global _monitor_task, _is_monitoring
    _is_monitoring = False
    if _monitor_task and not _monitor_task.done():
        _monitor_task.cancel()
        try:
            await _monitor_task
        except asyncio.CancelledError:
            pass
    return {"detail": "Monitor stopped"}


@router.get("/monitor/status", response_model=MonitorStatusOut)
def get_monitor_status(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    zones_count = db.query(FireZone).filter(FireZone.is_active.is_(True)).count()
    running = _is_monitoring and _monitor_task is not None and not _monitor_task.done()
    return MonitorStatusOut(
        is_monitoring=running,
        last_scan_at=_last_scan_at,
        zones_count=zones_count,
    )


# ── Alert endpoints ────────────────────────────────────────────────────────────

@router.get("/alerts", response_model=list[FireAlertOut])
def list_alerts(
    zone_id: Optional[int] = None,
    is_dismissed: Optional[bool] = None,
    limit: int = 50,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    q = db.query(FireAlert).join(FireZone)
    if zone_id is not None:
        q = q.filter(FireAlert.zone_id == zone_id)
    if is_dismissed is not None:
        q = q.filter(FireAlert.is_dismissed == is_dismissed)
    alerts = q.order_by(FireAlert.created_at.desc()).limit(limit).all()
    return [
        FireAlertOut(
            id=a.id,
            zone_id=a.zone_id,
            zone_name=a.zone.name if a.zone else "Unknown",
            detection_type=a.detection_type,
            confidence=a.confidence,
            snapshot_filename=a.snapshot_filename,
            detections_json=a.detections_json,
            is_dismissed=a.is_dismissed,
            dismissed_at=a.dismissed_at,
            created_at=a.created_at,
        )
        for a in alerts
    ]


@router.get("/alerts/stats", response_model=FireStatsOut)
def get_alert_stats(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    today = date.today()
    total = db.query(FireAlert).count()
    dismissed = db.query(FireAlert).filter(FireAlert.is_dismissed.is_(True)).count()
    today_alerts = (
        db.query(FireAlert)
        .filter(
            FireAlert.created_at
            >= datetime(today.year, today.month, today.day, tzinfo=timezone.utc)
        )
        .all()
    )
    fire_today = sum(1 for a in today_alerts if a.detection_type == "fire")
    smoke_today = sum(1 for a in today_alerts if a.detection_type == "smoke")
    active_zones = db.query(FireZone).filter(FireZone.is_active.is_(True)).count()
    return FireStatsOut(
        active_zones=active_zones,
        alerts_today=len(today_alerts),
        fire_count_today=fire_today,
        smoke_count_today=smoke_today,
        total_alerts=total,
        dismissed_alerts=dismissed,
    )


@router.patch("/alerts/{alert_id}/dismiss", response_model=FireAlertOut)
def dismiss_alert(
    alert_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    alert = db.query(FireAlert).filter(FireAlert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.is_dismissed = True
    alert.dismissed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(alert)
    return FireAlertOut(
        id=alert.id,
        zone_id=alert.zone_id,
        zone_name=alert.zone.name if alert.zone else "Unknown",
        detection_type=alert.detection_type,
        confidence=alert.confidence,
        snapshot_filename=alert.snapshot_filename,
        detections_json=alert.detections_json,
        is_dismissed=alert.is_dismissed,
        dismissed_at=alert.dismissed_at,
        created_at=alert.created_at,
    )

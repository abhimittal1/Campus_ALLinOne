import asyncio
import ipaddress
import re
from io import BytesIO
from urllib.parse import urlsplit, urlunsplit

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from backend.core.deps import get_current_admin
from backend.core.config import settings
from backend.models.user import User

router = APIRouter(prefix="/camera", tags=["camera"])


class CameraConfig(BaseModel):
    url: str


# In-process mutable store — for a production app store this in the DB or a
# settings table.  For this project a simple module-level variable is enough.
_camera_state: dict = {"url": settings.CAMERA_URL}

_STREAM_PATH_SUFFIXES = (
    "/video",
    "/videofeed",
    "/mjpeg",
    "/mjpegfeed",
    "/stream",
    "/live",
)

_SNAPSHOT_FILENAMES = ("shot.jpg", "photo.jpg", "snapshot.jpg", "capture.jpg")
_DOT_PORT_RE = re.compile(
    r"^(https?://)(\d{1,3}(?:\.\d{1,3}){3})\.(\d{2,5})([/#?].*)?$"
)


def normalize_camera_url(url: str) -> str:
    """Clean common camera URL typos without changing the intended endpoint."""
    raw = (url or "").strip()
    return _DOT_PORT_RE.sub(r"\1\2:\3\4", raw)


def _is_private_hostname(hostname: str | None) -> bool:
    if not hostname:
        return False
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        return hostname in {"localhost", "127.0.0.1"}
    return address.is_private or address.is_loopback or address.is_link_local


def _with_scheme(url: str, scheme: str) -> str:
    parts = urlsplit(url)
    return urlunsplit((scheme, parts.netloc, parts.path, parts.query, parts.fragment))


def _url_variants(url: str) -> list[str]:
    raw = normalize_camera_url(url)
    parts = urlsplit(raw)
    variants: list[str] = []

    def add(candidate: str) -> None:
        if candidate and candidate not in variants:
            variants.append(candidate)

    # Private IP camera apps commonly run plain HTTP even when HTTPS was typed.
    if parts.scheme == "https" and _is_private_hostname(parts.hostname):
        add(_with_scheme(raw, "http"))

    add(raw)
    return variants


def _is_probable_stream_url(url: str) -> bool:
    path = urlsplit(url).path.rstrip("/").lower()
    return path.endswith(_STREAM_PATH_SUFFIXES)


def _replace_path(url: str, path: str) -> str:
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, path, "", ""))


def _snapshot_candidates(url: str) -> list[str]:
    """Return finite image endpoints to try before falling back to video capture."""
    raw = url.strip()
    parts = urlsplit(raw)
    path = parts.path.rstrip("/")
    lower_path = path.lower()
    candidates: list[str] = []

    def add(candidate: str) -> None:
        if candidate and candidate not in candidates:
            candidates.append(candidate)

    if lower_path.endswith((".jpg", ".jpeg", ".png")):
        add(raw)
        return candidates

    if lower_path.endswith(_STREAM_PATH_SUFFIXES):
        base_path = path.rsplit("/", 1)[0]
    else:
        add(raw)
        base_path = path

    if not base_path or base_path == "/":
        base_path = ""

    for filename in _SNAPSHOT_FILENAMES:
        add(_replace_path(raw, f"{base_path}/{filename}"))

    return candidates


def _stream_candidates(url: str) -> list[str]:
    """Return likely MJPEG/video endpoints for base IP-camera URLs."""
    raw = url.strip()
    if _is_probable_stream_url(raw):
        return [raw]

    parts = urlsplit(raw)
    path = parts.path.rstrip("/")
    lower_path = path.lower()
    candidates: list[str] = []

    def add(candidate: str) -> None:
        if candidate and candidate not in candidates:
            candidates.append(candidate)

    if lower_path.endswith((".jpg", ".jpeg", ".png")):
        base_path = path.rsplit("/", 1)[0]
    else:
        base_path = path

    if not base_path or base_path == "/":
        base_path = ""

    for suffix in _STREAM_PATH_SUFFIXES:
        add(_replace_path(raw, f"{base_path}{suffix}"))

    add(raw)
    return candidates


def _load_snapshot(url: str, timeout: int):
    import urllib.request
    from PIL import Image

    request = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        data = response.read()
    if not data:
        raise RuntimeError("camera returned an empty image response")
    return Image.open(BytesIO(data)).convert("RGB")


def _load_video_frame(url: str, timeout: int):
    from PIL import Image
    import cv2

    cap = cv2.VideoCapture()
    timeout_ms = int(timeout * 1000)
    if hasattr(cv2, "CAP_PROP_OPEN_TIMEOUT_MSEC"):
        cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, timeout_ms)
    if hasattr(cv2, "CAP_PROP_READ_TIMEOUT_MSEC"):
        cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, timeout_ms)

    try:
        if not cap.open(url):
            raise RuntimeError("OpenCV could not open the camera stream")

        frame = None
        for _ in range(3):
            ok, candidate = cap.read()
            if ok and candidate is not None:
                frame = candidate
                break
        if frame is None:
            raise RuntimeError("camera stream opened but returned no frame")

        frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        return Image.fromarray(frame)
    finally:
        cap.release()


def _load_mjpeg_frame(url: str, timeout: int):
    import urllib.request
    from PIL import Image

    request = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0"},
    )
    buffer = b""
    max_bytes = 3 * 1024 * 1024

    with urllib.request.urlopen(request, timeout=timeout) as response:
        while len(buffer) < max_bytes:
            chunk = response.read(8192)
            if not chunk:
                break
            buffer += chunk
            start = buffer.find(b"\xff\xd8")
            end = buffer.find(b"\xff\xd9", start + 2)
            if start != -1 and end != -1:
                frame = buffer[start:end + 2]
                return Image.open(BytesIO(frame)).convert("RGB")

    raise RuntimeError("MJPEG stream did not contain a complete JPEG frame")


def capture_frame(url: str, timeout: int = 5):
    """Capture one RGB PIL frame from a snapshot endpoint or MJPEG/video stream."""
    raw = normalize_camera_url(url)
    if not raw:
        raise RuntimeError("Camera URL is not configured")
    if not raw.startswith(("http://", "https://")):
        raise RuntimeError("Camera URL must start with http:// or https://")

    errors: list[str] = []

    for current_url in _url_variants(raw):
        stream_url = _is_probable_stream_url(current_url)

        if stream_url:
            try:
                return _load_mjpeg_frame(current_url, timeout)
            except Exception as exc:
                errors.append(f"{current_url} as MJPEG stream: {exc}")

            try:
                return _load_video_frame(current_url, timeout)
            except Exception as exc:
                errors.append(f"{current_url} as video stream: {exc}")

        for candidate in _snapshot_candidates(current_url):
            if _is_probable_stream_url(candidate):
                continue
            try:
                return _load_snapshot(candidate, timeout)
            except Exception as exc:
                errors.append(f"{candidate}: {exc}")

        for candidate in _stream_candidates(current_url):
            if candidate == current_url and stream_url:
                continue
            try:
                return _load_mjpeg_frame(candidate, timeout)
            except Exception as exc:
                errors.append(f"{candidate} as MJPEG stream: {exc}")

            try:
                return _load_video_frame(candidate, timeout)
            except Exception as exc:
                errors.append(f"{candidate} as video stream: {exc}")

    attempted = "; ".join(errors[:6])
    if len(errors) > 6:
        attempted = f"{attempted}; and {len(errors) - 6} more attempts"
    raise RuntimeError(f"Could not fetch a camera frame. Tried {attempted}")


# Backwards-compatible name used by older router code.
_capture_frame = capture_frame


@router.get("", response_model=CameraConfig)
def get_camera(_: User = Depends(get_current_admin)):
    return _camera_state


@router.put("", response_model=CameraConfig)
def update_camera(payload: CameraConfig, _: User = Depends(get_current_admin)):
    url = normalize_camera_url(payload.url)
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="URL must start with http")
    _camera_state["url"] = url
    return _camera_state


@router.get("/snapshot")
async def get_snapshot():
    """Proxy a single JPEG frame from the IP camera for the web UI live preview."""
    url = _camera_state["url"]
    if not url:
        raise HTTPException(status_code=503, detail="Camera URL is not configured. Set it in Admin → Camera.")

    try:
        # Shield the blocking OpenCV/urllib call so it keeps running even if
        # the browser fires a new request and cancels the previous task.
        pil_img = await asyncio.wait_for(
            asyncio.shield(run_in_threadpool(capture_frame, url)),
            timeout=5.0,
        )
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=503,
            detail=f"Camera did not respond within 5 s. Check that {url} is reachable.",
        )
    except asyncio.CancelledError:
        # Client sent a new request and the browser cancelled the old one.
        raise HTTPException(status_code=503, detail="Snapshot request cancelled by client.")
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    buf = BytesIO()
    pil_img.save(buf, format="JPEG")
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="image/jpeg",
        headers={"Cache-Control": "no-store"},
    )

from __future__ import annotations

import argparse
import json
import re
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable

import cv2


DEFAULT_WEIGHTS = Path(__file__).resolve().parent / "best weights of training YOLO v8" / "best (1).pt"


@dataclass(frozen=True)
class Detection:
    label: str
    confidence: float
    xyxy: tuple[int, int, int, int]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run fire/smoke detection on an IP camera, webcam, image, or video file."
    )
    parser.add_argument(
        "--source",
        default="0",
        help=(
            "Camera/video source. Use 0 for webcam, an RTSP/HTTP IP-camera URL, "
            "or a local image/video path. Defaults to 0."
        ),
    )
    parser.add_argument(
        "--weights",
        default=str(DEFAULT_WEIGHTS),
        help="Path to trained YOLO weights.",
    )
    parser.add_argument(
        "--conf",
        type=float,
        default=0.35,
        help="Minimum model confidence for a detection to count.",
    )
    parser.add_argument(
        "--fire-conf",
        type=float,
        default=0.45,
        help="Minimum confidence needed before a Fire detection can raise an alert.",
    )
    parser.add_argument(
        "--smoke-conf",
        type=float,
        default=0.40,
        help="Minimum confidence needed before a Smoke detection can raise an alert.",
    )
    parser.add_argument(
        "--consecutive-frames",
        type=int,
        default=3,
        help="Number of consecutive alert frames required before alerting.",
    )
    parser.add_argument(
        "--frame-skip",
        type=int,
        default=2,
        help="Run inference once every N frames to reduce CPU/GPU load.",
    )
    parser.add_argument(
        "--save-alert-dir",
        type=Path,
        default=Path("alerts"),
        help="Directory where alert snapshots and JSON events are written.",
    )
    parser.add_argument(
        "--display",
        action="store_true",
        help="Show the annotated live stream in a window.",
    )
    parser.add_argument(
        "--no-save",
        action="store_true",
        help="Do not save alert snapshots or JSON event files.",
    )
    return parser.parse_args()


def normalize_source(source: str) -> str | int:
    if source.isdigit():
        return int(source)

    fixed_source = re.sub(
        r"^(https?://)(\d{1,3}(?:\.\d{1,3}){3})\.(\d{2,5})([/#?].*)?$",
        r"\1\2:\3\4",
        source,
    )
    if fixed_source != source:
        print(f"Corrected camera URL to: {fixed_source}")

    return fixed_source


def load_model(weights: Path):
    try:
        from ultralytics import YOLO
    except ImportError as exc:  # pragma: no cover - handled at runtime for a clearer CLI message.
        raise SystemExit(
            "The 'ultralytics' package is required. Install it with: "
            "python -m pip install ultralytics"
        ) from exc

    return YOLO(str(weights))


def draw_detection(frame, detection: Detection, alert: bool) -> None:
    x1, y1, x2, y2 = detection.xyxy
    color = (0, 0, 255) if alert else (0, 180, 255)
    text = f"{detection.label} {detection.confidence:.2f}"
    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
    cv2.putText(
        frame,
        text,
        (x1, max(y1 - 8, 20)),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.6,
        color,
        2,
        cv2.LINE_AA,
    )


def result_to_detections(result) -> list[Detection]:
    detections: list[Detection] = []
    names = result.names

    for box in result.boxes:
        class_id = int(box.cls[0])
        label = names[class_id]
        confidence = float(box.conf[0])
        xyxy = tuple(int(value) for value in box.xyxy[0].tolist())
        detections.append(Detection(label=label, confidence=confidence, xyxy=xyxy))

    return detections


def alert_detections(
    detections: Iterable[Detection],
    fire_conf: float,
    smoke_conf: float,
) -> list[Detection]:
    alerts: list[Detection] = []

    for detection in detections:
        if detection.label == "Fire" and detection.confidence >= fire_conf:
            alerts.append(detection)
        elif detection.label == "Smoke" and detection.confidence >= smoke_conf:
            alerts.append(detection)

    return alerts


def save_alert_event(
    frame,
    output_dir: Path,
    detections: list[Detection],
    source: str | int,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    image_path = output_dir / f"fire_alert_{timestamp}.jpg"
    event_path = output_dir / f"fire_alert_{timestamp}.json"

    cv2.imwrite(str(image_path), frame)
    event = {
        "alert": True,
        "source": str(source),
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "snapshot": str(image_path),
        "detections": [
            {
                "label": detection.label,
                "confidence": round(detection.confidence, 4),
                "box": detection.xyxy,
            }
            for detection in detections
        ],
    }
    event_path.write_text(json.dumps(event, indent=2), encoding="utf-8")


def main() -> None:
    args = parse_args()
    weights = Path(args.weights)
    source = normalize_source(args.source)

    if not weights.exists():
        raise SystemExit(f"Weights file not found: {weights}")

    model = load_model(weights)
    cap = cv2.VideoCapture(source)

    if not cap.isOpened():
        raise SystemExit(f"Could not open video source: {source}")

    frame_number = 0
    consecutive_alert_frames = 0
    last_alert_at = 0.0
    last_alert_detections: list[Detection] = []

    print("Fire alert camera started. Press 'q' in the video window to stop.")

    while True:
        ok, frame = cap.read()
        if not ok:
            print("No frame received from source. Stopping.")
            break

        frame_number += 1
        detections: list[Detection] = []
        current_alerts: list[Detection] = []

        if frame_number % max(args.frame_skip, 1) == 0:
            result = model.predict(frame, conf=args.conf, verbose=False)[0]
            detections = result_to_detections(result)
            current_alerts = alert_detections(detections, args.fire_conf, args.smoke_conf)

            if current_alerts:
                consecutive_alert_frames += 1
                last_alert_detections = current_alerts
            else:
                consecutive_alert_frames = 0
                last_alert_detections = []

        alert_active = consecutive_alert_frames >= max(args.consecutive_frames, 1)

        for detection in detections:
            draw_detection(frame, detection, detection in current_alerts)

        if alert_active:
            cv2.putText(
                frame,
                "FIRE ALERT",
                (20, 44),
                cv2.FONT_HERSHEY_SIMPLEX,
                1.1,
                (0, 0, 255),
                3,
                cv2.LINE_AA,
            )

            # Avoid writing duplicate snapshots every processed frame during the same incident.
            if not args.no_save and time.time() - last_alert_at >= 5:
                save_alert_event(frame, args.save_alert_dir, last_alert_detections, source)
                last_alert_at = time.time()
                labels = ", ".join({detection.label for detection in last_alert_detections})
                print(f"ALERT: {labels} detected from {source}")

        if args.display:
            cv2.imshow("Campus Fire Alert", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

    cap.release()
    if args.display:
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()

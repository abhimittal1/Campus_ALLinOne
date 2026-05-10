# register_student.py
# Register a new student by capturing their face from the IP cam.
# Saves averaged embedding to students.json.
#
# Usage:
#   python register_student.py
#   Enter student ID and name when prompted.
#   Press SPACE to capture a sample (default: 5 captures).
#   Press 'q' to abort at any time.

import json
import os
import cv2
import numpy as np
import torch
import torchvision.transforms as T
from PIL import Image
from facenet_pytorch import MTCNN, InceptionResnetV1

# ──────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────
IP_CAM_URL    = "http://10.72.193.71:8080/video"   # same URL as attendance_system.py
STUDENTS_FILE = "./students.json"
NUM_CAPTURES  = 5       # more captures → more robust average embedding
TARGET_WIDTH  = 960

# ──────────────────────────────────────────────────────────────
# Models
# ──────────────────────────────────────────────────────────────
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(f"Using device: {DEVICE}")
print("Loading models...")
_mtcnn  = MTCNN(keep_all=False, min_face_size=60, device=DEVICE)
_resnet = InceptionResnetV1(pretrained="vggface2").eval().to(DEVICE)

_to_tensor = T.Compose([
    T.Resize((160, 160)),
    T.ToTensor(),
    T.Normalize([0.485, 0.456, 0.406],
                [0.229, 0.224, 0.225]),
])
print("Models loaded.\n")


# ──────────────────────────────────────────────────────────────
# Embedding helper  (same logic as attendance_system.py)
# ──────────────────────────────────────────────────────────────
def get_embedding(face_crop_bgr: np.ndarray):
    if face_crop_bgr is None or face_crop_bgr.size == 0:
        return None
    h, w = face_crop_bgr.shape[:2]
    if h < 20 or w < 20:
        return None
    rgb    = cv2.cvtColor(face_crop_bgr, cv2.COLOR_BGR2RGB)
    pil    = Image.fromarray(rgb)
    tensor = _to_tensor(pil).unsqueeze(0).to(DEVICE)
    with torch.no_grad():
        emb = _resnet(tensor).cpu().numpy()[0]
    return emb


# ──────────────────────────────────────────────────────────────
# students.json helpers
# ──────────────────────────────────────────────────────────────
def load_db():
    if not os.path.exists(STUDENTS_FILE):
        return {"students": []}
    with open(STUDENTS_FILE) as f:
        return json.load(f)


def save_db(data):
    with open(STUDENTS_FILE, "w") as f:
        json.dump(data, f, indent=2)


# ──────────────────────────────────────────────────────────────
# Frame helper
# ──────────────────────────────────────────────────────────────
def resize_frame(frame):
    h, w = frame.shape[:2]
    if w <= TARGET_WIDTH:
        return frame
    return cv2.resize(frame, (TARGET_WIDTH, int(h * TARGET_WIDTH / w)),
                      interpolation=cv2.INTER_AREA)


# ──────────────────────────────────────────────────────────────
# Main registration flow
# ──────────────────────────────────────────────────────────────
def register():
    student_id   = input("Enter student ID   : ").strip()
    student_name = input("Enter student name : ").strip()
    if not student_id or not student_name:
        print("ID and name are required. Aborting.")
        return

    print(f"\nRegistering '{student_name}' (ID: {student_id})")
    print(f"Look at the camera — press SPACE to capture, 'q' to quit.\n")

    cap = cv2.VideoCapture(IP_CAM_URL)
    if not cap.isOpened():
        print(f"Error: cannot open stream -> {IP_CAM_URL}")
        return
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    cv2.namedWindow("Register Student", cv2.WINDOW_NORMAL)
    cv2.resizeWindow("Register Student", 1000, 700)

    embeddings = []
    consecutive_failures = 0

    while len(embeddings) < NUM_CAPTURES:
        ret, frame = cap.read()
        if not ret or frame is None:
            consecutive_failures += 1
            if consecutive_failures > 30:
                print("Stream lost.")
                break
            cv2.waitKey(50)
            continue
        consecutive_failures = 0

        display = resize_frame(frame)
        rgb     = cv2.cvtColor(display, cv2.COLOR_BGR2RGB)
        pil_img = Image.fromarray(rgb)

        # Detect face for live preview box
        try:
            boxes, probs = _mtcnn.detect(pil_img)
        except Exception:
            boxes, probs = None, None

        preview = display.copy()

        face_box = None   # (x1,y1,x2,y2) of best detected face

        if boxes is not None:
            for box, prob in zip(boxes, probs):
                if box is None or (prob is not None and prob < 0.90):
                    continue
                x1, y1, x2, y2 = [int(v) for v in box]
                x1 = max(0, x1);  y1 = max(0, y1)
                x2 = min(preview.shape[1]-1, x2)
                y2 = min(preview.shape[0]-1, y2)
                cv2.rectangle(preview, (x1, y1), (x2, y2), (0, 220, 0), 2)
                face_box = (x1, y1, x2, y2)
                break   # only track the best (first) face

        # Status bar
        remaining = NUM_CAPTURES - len(embeddings)
        status    = (f"Captured: {len(embeddings)}/{NUM_CAPTURES}   "
                     f"Remaining: {remaining}   "
                     f"SPACE=capture  q=quit")
        cv2.rectangle(preview, (0, 0), (preview.shape[1], 50), (30, 30, 30), -1)
        cv2.putText(preview, status, (10, 34),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)

        # Guide message
        if face_box is None:
            guide_text  = "No face detected — move closer or improve lighting"
            guide_color = (0, 0, 255)
        else:
            guide_text  = "Face detected! Press SPACE to capture."
            guide_color = (0, 220, 0)

        cv2.putText(preview, guide_text,
                    (10, preview.shape[0] - 15),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.65, guide_color, 2)

        cv2.imshow("Register Student", preview)
        key = cv2.waitKey(1) & 0xFF

        if key == ord("q"):
            print("Registration aborted.")
            cap.release()
            cv2.destroyAllWindows()
            return

        elif key == ord(" "):
            if face_box is None:
                print("  No face in frame — try again.")
                continue

            x1, y1, x2, y2 = face_box
            crop      = display[y1:y2, x1:x2]
            embedding = get_embedding(crop)

            if embedding is None:
                print("  Could not extract embedding — try again.")
                continue

            embeddings.append(embedding)
            print(f"  Captured {len(embeddings)}/{NUM_CAPTURES}")

            # Flash green border as feedback
            flash = display.copy()
            cv2.rectangle(flash, (x1, y1), (x2, y2), (0, 255, 0), 6)
            cv2.imshow("Register Student", flash)
            cv2.waitKey(200)

    cap.release()
    cv2.destroyAllWindows()

    if not embeddings:
        print("No embeddings captured. Registration aborted.")
        return

    # Average across all captures for a more robust template
    avg_embedding = np.mean(embeddings, axis=0).tolist()

    db = load_db()
    # Remove existing entry for this ID if re-registering
    db["students"] = [s for s in db["students"] if s["id"] != student_id]
    db["students"].append({
        "id":        student_id,
        "name":      student_name,
        "embedding": avg_embedding,
    })
    save_db(db)

    print(f"\nRegistered '{student_name}' (ID: {student_id}) successfully.")
    print(f"Total students in DB: {len(db['students'])}")
    print(f"Saved to: {STUDENTS_FILE}")


if __name__ == "__main__":
    register()
import os
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status, Query
from sqlalchemy.orm import Session

from backend.core.deps import get_db, get_current_user, get_current_admin
from backend.models.student import Student
from backend.models.subject import Subject, SubjectEnrollment
from backend.models.user import User
from backend.schemas.student import StudentCreate, StudentUpdate, StudentOut, StudentWithEmbedding
from backend.schemas.subject import SubjectOut, EnrollPayload

router = APIRouter(prefix="/students", tags=["students"])

UPLOADS_DIR = Path(__file__).parent.parent / "uploads" / "students"
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}


def _photo_url(student: Student) -> str | None:
    """Return the public URL for a student's photo, or None."""
    if student.photo_path:
        return f"/uploads/students/{student.photo_path}"
    return None


def _to_out(student: Student) -> StudentOut:
    data = StudentOut.model_validate(student)
    data.photo_url = _photo_url(student)
    data.face_registered = student.embedding is not None
    return data


@router.get("", response_model=list[StudentOut])
def list_students(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return [_to_out(s) for s in db.query(Student).offset(skip).limit(limit).all()]


@router.get("/{student_id}", response_model=StudentOut)
def get_student(
    student_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    student = db.query(Student).filter(Student.student_id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    return _to_out(student)


@router.post("", response_model=StudentOut, status_code=status.HTTP_201_CREATED)
def create_student(
    payload: StudentCreate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    if db.query(Student).filter(Student.student_id == payload.student_id).first():
        raise HTTPException(status_code=400, detail="Student ID already exists")
    student = Student(**payload.model_dump())
    db.add(student)
    db.commit()
    db.refresh(student)
    return _to_out(student)


@router.post("/{student_id}/photo", response_model=StudentOut)
def upload_photo(
    student_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    student = db.query(Student).filter(Student.student_id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="File must be an image (jpeg/png/webp/gif)")

    ext = Path(file.filename).suffix.lower() if file.filename else ".jpg"
    filename = f"{student_id}{ext}"
    dest = UPLOADS_DIR / filename

    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    student.photo_path = filename
    db.commit()
    db.refresh(student)
    return _to_out(student)


@router.patch("/{student_id}", response_model=StudentOut)
def update_student(
    student_id: str,
    payload: StudentUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    student = db.query(Student).filter(Student.student_id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(student, field, value)
    db.commit()
    db.refresh(student)
    return _to_out(student)


@router.delete("/{student_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_student(
    student_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    student = db.query(Student).filter(Student.student_id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    # Remove photo file if present
    if student.photo_path:
        photo_file = UPLOADS_DIR / student.photo_path
        if photo_file.exists():
            photo_file.unlink()
    db.delete(student)
    db.commit()


# ── Student ↔ Subject enrollment (read + write from Students page) ────────────

@router.get("/{student_id}/subjects", response_model=list[SubjectOut])
def get_student_subjects(
    student_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return all subjects the student is currently enrolled in."""
    from sqlalchemy import func
    student = db.query(Student).filter(Student.student_id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    enrollments = (
        db.query(SubjectEnrollment)
        .filter(SubjectEnrollment.student_id == student_id)
        .all()
    )
    subject_ids = [e.subject_id for e in enrollments]
    subjects = db.query(Subject).filter(Subject.id.in_(subject_ids)).all()

    # Build SubjectOut with student_count
    result = []
    for s in subjects:
        count = (
            db.query(func.count(SubjectEnrollment.id))
            .filter(SubjectEnrollment.subject_id == s.id)
            .scalar()
        ) or 0
        out = SubjectOut.model_validate(s)
        out.student_count = count
        result.append(out)
    return result


@router.post("/{student_id}/subjects", status_code=status.HTTP_201_CREATED)
def enroll_student_in_subjects(
    student_id: str,
    payload: EnrollPayload,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """Enroll a student in one or more subjects (subject_ids in payload.student_ids field,
    repurposed here as subject_ids for simplicity — or use a dedicated payload)."""
    student = db.query(Student).filter(Student.student_id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    added = 0
    for sid in payload.student_ids:
        try:
            subject_id = int(sid)
        except ValueError:
            continue
        subject = db.query(Subject).filter(Subject.id == subject_id).first()
        if not subject:
            continue
        existing = (
            db.query(SubjectEnrollment)
            .filter(
                SubjectEnrollment.subject_id == subject_id,
                SubjectEnrollment.student_id == student_id,
            )
            .first()
        )
        if not existing:
            db.add(SubjectEnrollment(subject_id=subject_id, student_id=student_id))
            added += 1
    db.commit()
    return {"enrolled": added}


@router.delete("/{student_id}/subjects/{subject_id}", status_code=status.HTTP_204_NO_CONTENT)
def unenroll_student_from_subject(
    student_id: str,
    subject_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """Remove a student from a subject."""
    enrollment = (
        db.query(SubjectEnrollment)
        .filter(
            SubjectEnrollment.subject_id == subject_id,
            SubjectEnrollment.student_id == student_id,
        )
        .first()
    )
    if not enrollment:
        raise HTTPException(status_code=404, detail="Enrollment not found")
    db.delete(enrollment)
    db.commit()


@router.post("/{student_id}/register-face", response_model=StudentOut)
def register_face(
    student_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """Capture the student's face from the IP camera and save the embedding.

    Uses the same ML pipeline as register_student.py:
      1. Fetch a single JPEG frame from /shot.jpg
      2. Detect faces with MTCNN (keep_all=False → best face only)
      3. Compute 512-dim embedding with InceptionResnetV1 (vggface2)
      4. Save to students.json AND to Student.embedding in the DB
    """
    import json
    import os

    student = db.query(Student).filter(Student.student_id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    # Lazy imports — these live in the root venv, not the backend sub-venv
    from backend.routers.subjects import (
        _STUDENTS_FILE,
        _capture_frame,
        _load_models,
        _get_embedding,
    )
    from backend.routers.camera import _camera_state

    # ── Capture single frame from IP camera ──────────────────────────────────
    try:
        pil_frame = _capture_frame(_camera_state["url"])
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    # ── Detect the best face with MTCNN (keep_all=False gives the top face) ──
    try:
        import torch
        import torchvision.transforms as T
        from facenet_pytorch import MTCNN, InceptionResnetV1

        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        mtcnn_single = MTCNN(keep_all=False, min_face_size=60, device=device)
        resnet_model = InceptionResnetV1(pretrained="vggface2").eval().to(device)
        transform = T.Compose([
            T.Resize((160, 160)),
            T.ToTensor(),
            T.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ])
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"ML models unavailable: {exc}. Ensure torch/facenet-pytorch are installed.",
        )

    boxes, probs = mtcnn_single.detect(pil_frame)
    if boxes is None or len(boxes) == 0:
        raise HTTPException(
            status_code=422,
            detail="No face detected in the camera frame. Move closer or improve lighting.",
        )

    # Pick the highest-confidence face
    best_idx = int(probs.argmax()) if probs is not None else 0
    box = boxes[best_idx]
    frame_w, frame_h = pil_frame.size
    x1 = max(0, int(box[0]))
    y1 = max(0, int(box[1]))
    x2 = min(frame_w, int(box[2]))
    y2 = min(frame_h, int(box[3]))
    face_pil = pil_frame.crop((x1, y1, x2, y2))

    embedding = _get_embedding(face_pil, resnet_model, transform, device)
    if embedding is None:
        raise HTTPException(
            status_code=422,
            detail="Face crop was too small. Move closer to the camera.",
        )

    embedding_list: list[float] = embedding.tolist()

    # ── Persist: SQLite DB ────────────────────────────────────────────────────
    student.embedding = embedding_list
    db.commit()
    db.refresh(student)

    # ── Persist: students.json (used by face-recognition attendance) ─────────
    face_db: dict = {"students": []}
    if os.path.exists(_STUDENTS_FILE):
        try:
            with open(_STUDENTS_FILE) as f:
                face_db = json.load(f)
        except Exception:
            face_db = {"students": []}

    # Replace existing entry for this student_id
    face_db["students"] = [s for s in face_db["students"] if s.get("id") != student_id]
    face_db["students"].append({
        "id": student_id,
        "name": student.name,
        "embedding": embedding_list,
    })

    os.makedirs(os.path.dirname(_STUDENTS_FILE), exist_ok=True)
    with open(_STUDENTS_FILE, "w") as f:
        json.dump(face_db, f, indent=2)

    return _to_out(student)

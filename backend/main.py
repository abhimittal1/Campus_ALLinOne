from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from backend.core.config import settings
from backend.core.security import hash_password
from backend.database import Base, engine
from backend.routers import auth_router, students_router, attendance_router, camera_router, subjects_router, chatbot_router, fire_router
from backend.routers.fire import startup_fire_monitor, shutdown_fire_monitor

# ── import models so SQLAlchemy registers them with Base ─────────────────────
import backend.models  # noqa: F401

UPLOADS_DIR = Path(__file__).parent / "uploads"


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure uploads directories exist
    (UPLOADS_DIR / "students").mkdir(parents=True, exist_ok=True)
    (UPLOADS_DIR / "fire_alerts").mkdir(parents=True, exist_ok=True)
    # Create all tables if they don't exist (dev-friendly approach)
    Base.metadata.create_all(bind=engine)
    _seed_default_admin()
    # Migrate: add subject_id column to attendance if it doesn't exist yet
    with engine.connect() as conn:
        try:
            conn.execute(text(
                "ALTER TABLE attendance ADD COLUMN subject_id INTEGER REFERENCES subjects(id)"
            ))
            conn.commit()
        except OperationalError:
            pass  # Column already exists
    # Start the fire/smoke background monitor and pre-warm the YOLO model
    await startup_fire_monitor()
    yield
    await shutdown_fire_monitor()


def _seed_default_admin():
    """Create a default admin in local development so the login flow is usable."""
    if not settings.SEED_DEFAULT_ADMIN:
        return

    from backend.database import SessionLocal
    from backend.models.user import User

    db = SessionLocal()
    try:
        admin_user = (
            db.query(User)
            .filter(User.username == settings.DEFAULT_ADMIN_USERNAME)
            .first()
        )

        if admin_user is None:
            db.add(User(
                username=settings.DEFAULT_ADMIN_USERNAME,
                email=settings.DEFAULT_ADMIN_EMAIL,
                hashed_password=hash_password(settings.DEFAULT_ADMIN_PASSWORD),
                role="admin",
            ))
        else:
            admin_user.email = settings.DEFAULT_ADMIN_EMAIL
            admin_user.hashed_password = hash_password(settings.DEFAULT_ADMIN_PASSWORD)
            admin_user.role = "admin"

        db.commit()
    finally:
        db.close()


app = FastAPI(
    title="Face Attendance API",
    version="1.0.0",
    description="Admin backend for the IP-camera face-recognition attendance system",
    lifespan=lifespan,
)

# ── CORS ─────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(auth_router)
app.include_router(students_router)
app.include_router(attendance_router)
app.include_router(camera_router)
app.include_router(subjects_router)
app.include_router(chatbot_router)
app.include_router(fire_router)

# ── Static files (uploaded student photos) ───────────────────────────────────
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")


@app.get("/health", tags=["health"])
def health():
    return {"status": "ok"}

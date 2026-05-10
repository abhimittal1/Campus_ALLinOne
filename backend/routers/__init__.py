from backend.routers.auth import router as auth_router
from backend.routers.students import router as students_router
from backend.routers.attendance import router as attendance_router
from backend.routers.camera import router as camera_router
from backend.routers.subjects import router as subjects_router
from backend.routers.chatbot import router as chatbot_router
from backend.routers.fire import router as fire_router

__all__ = [
    "auth_router",
    "students_router",
    "attendance_router",
    "camera_router",
    "subjects_router",
    "chatbot_router",
    "fire_router",
]

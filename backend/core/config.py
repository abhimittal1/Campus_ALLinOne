from pathlib import Path
from functools import lru_cache
from pydantic_settings import BaseSettings

# Project root — two levels above backend/core/
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = "sqlite:///./attendance.db"

    # JWT
    SECRET_KEY: str = "change-me-in-production-use-a-long-random-secret"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60

    # Camera — set CAMERA_URL in .env; no hardcoded fallback so misconfiguration is obvious
    CAMERA_URL: str = ""

    # App
    APP_ENV: str = "development"
    BACKEND_CORS_ORIGINS: str = "http://localhost:5173"

    # Development bootstrap
    SEED_DEFAULT_ADMIN: bool = True
    DEFAULT_ADMIN_USERNAME: str = "admin"
    DEFAULT_ADMIN_EMAIL: str = "admin@example.com"
    DEFAULT_ADMIN_PASSWORD: str = "admin12345"

    # RAG / Chatbot
    OPENAI_API_KEY: str = ""
    CHROMA_DB_PATH: str = str(_PROJECT_ROOT / "data" / "vector_store" / "chroma_db")

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.BACKEND_CORS_ORIGINS.split(",")]

    class Config:
        env_file = (".env", "backend/.env")
        env_file_encoding = "utf-8"
        extra = "ignore"  # silently discard unknown env vars


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

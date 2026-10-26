from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    app_name: str = "InternFlow AI"
    environment: str = "development"
    api_prefix: str = "/api"

    database_url: str = f"sqlite:///{(BASE_DIR / 'internflow.db').as_posix()}"
    jwt_secret: str = "internflow-dev-secret-change-me-before-deploying"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 720

    frontend_origin: str = "http://localhost:5173"

    storage_dir: str = str(BASE_DIR / "storage")
    max_upload_mb: int = 10
    allowed_extensions: str = (
        ".py,.js,.jsx,.ts,.tsx,.java,.c,.cpp,.cs,.go,.rb,.php,.sql,.html,.css,"
        ".md,.txt,.json,.csv,.yaml,.yml,.zip,.pdf,.docx,.pptx,.png,.jpg,.jpeg"
    )

    pass_threshold: float = 70.0
    confidence_threshold: float = 0.55
    borderline_margin: float = 8.0
    review_sla_hours: int = 48

    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "no-reply@internflow.local"
    smtp_tls: bool = True

    meeting_base_url: str = "https://meet.jit.si"
    company_timezone: str = "Asia/Kolkata"
    app_public_url: str = "http://127.0.0.1:8000"

    autopilot_lead_minutes: int = 5
    autopilot_meeting_minutes: int = 30
    autopilot_due_days: int = 2

    ai_provider: str = "heuristic"
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-4o-mini"
    ai_timeout_seconds: int = 25

    scheduler_enabled: bool = True
    reminder_interval_minutes: int = 15
    seed_demo_data: bool = True

    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def allowed_extension_list(self) -> list[str]:
        return [item.strip().lower() for item in self.allowed_extensions.split(",") if item.strip()]


settings = Settings()

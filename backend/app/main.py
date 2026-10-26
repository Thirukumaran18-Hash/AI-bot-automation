from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import inspect, text

from . import __version__
from .config import BASE_DIR, settings
from .database import Base, SessionLocal, engine
from .routers import (
    activity,
    assignments,
    auth,
    autopilot,
    chatbot,
    dashboard,
    interns,
    meetings,
    reviews,
    submissions,
    tasks,
)
from .scheduler import start_scheduler, stop_scheduler
from .seed import seed_demo_data

DIST_DIR = BASE_DIR.parent / "frontend" / "dist"


def _ensure_schema() -> None:
    inspector = inspect(engine)
    if "interns" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("interns")}
    if "phone" not in columns:
        with engine.begin() as connection:
            connection.execute(
                text("ALTER TABLE interns ADD COLUMN phone VARCHAR(40) DEFAULT ''")
            )


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    _ensure_schema()
    Path(settings.storage_dir).mkdir(parents=True, exist_ok=True)
    if settings.seed_demo_data:
        with SessionLocal() as db:
            try:
                seed_demo_data(db)
            except Exception:
                db.rollback()
                raise
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(
    title=settings.app_name,
    version=__version__,
    description=(
        "Autonomous internship management system: onboarding, tasks, submissions, "
        "rubric evaluation, feedback, reviews and meeting coordination."
    ),
    lifespan=lifespan,
)

origins = {
    settings.frontend_origin,
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
}
app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for router in (
    auth.router,
    autopilot.router,
    chatbot.router,
    interns.router,
    tasks.router,
    assignments.router,
    submissions.router,
    reviews.router,
    meetings.router,
    dashboard.router,
    activity.router,
):
    app.include_router(router, prefix=settings.api_prefix)


@app.get(f"{settings.api_prefix}/health", tags=["system"])
def health() -> dict:
    return {
        "status": "ok",
        "version": __version__,
        "environment": settings.environment,
        "ai_provider": settings.ai_provider,
        "email_mode": "smtp" if settings.smtp_host else "log-only",
    }


@app.get("/", include_in_schema=False)
def root():
    index = DIST_DIR / "index.html"
    if index.exists():
        return FileResponse(index)
    return {
        "name": settings.app_name,
        "version": __version__,
        "docs": "/docs",
        "health": f"{settings.api_prefix}/health",
        "message": "Frontend build not found. Run the Vite dev server or build the frontend.",
    }


if DIST_DIR.exists():
    assets_dir = DIST_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str):
        if full_path.startswith(settings.api_prefix.strip("/")):
            raise HTTPException(status_code=404, detail="Not found")
        candidate = (DIST_DIR / full_path).resolve()
        try:
            candidate.relative_to(DIST_DIR.resolve())
        except ValueError:
            raise HTTPException(status_code=404, detail="Not found")
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(DIST_DIR / "index.html")

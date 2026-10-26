from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import User
from ..services import chatbot as chatbot_service

router = APIRouter(prefix="/chatbot", tags=["chatbot"])


class ChatMessage(BaseModel):
    role: str = Field(default="user")
    content: str = Field(default="")


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    history: list[ChatMessage] = Field(default_factory=list)


@router.post("/message")
def send_message(
    payload: ChatRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    if not payload.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    result = chatbot_service.reply(
        db,
        user,
        payload.message,
        [item.model_dump() for item in payload.history[-8:]],
    )
    return {"reply": result["reply"], "engine": result["engine"], "role": user.role}


@router.get("/suggestions")
def suggestions(user: User = Depends(get_current_user)) -> dict:
    if user.role == "intern":
        items = [
            "What are my open tasks?",
            "When is my next meeting?",
            "Show my status",
            "How do I submit my work?",
        ]
    else:
        items = [
            "Give me a status summary",
            "Show upcoming meetings",
            "Pending reviews",
            "Which candidates are overdue?",
            "How do I import candidates?",
        ]
    return {"suggestions": items}

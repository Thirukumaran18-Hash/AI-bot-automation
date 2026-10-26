from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import Intern, User
from ..schemas import LoginRequest, PasswordChangeRequest, TokenResponse
from ..security import create_access_token, hash_password, verify_password
from ..serializers import user_dict

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> dict:
    user = (
        db.query(User)
        .filter(func.lower(User.email) == payload.email.lower())
        .first()
    )
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )
    if not user.active:
        raise HTTPException(status_code=403, detail="This account has been deactivated")

    intern = db.query(Intern).filter(Intern.user_id == user.id).first()
    user_data = user_dict(user)
    user_data["intern_id"] = intern.id if intern else None
    user_data["batch"] = intern.batch if intern else None
    user_data["domain"] = intern.domain if intern else None
    return {
        "access_token": create_access_token(user.id, user.role),
        "token_type": "bearer",
        "user": user_data,
    }


@router.get("/me")
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    intern = db.query(Intern).filter(Intern.user_id == user.id).first()
    data = user_dict(user)
    data["intern_id"] = intern.id if intern else None
    data["batch"] = intern.batch if intern else None
    data["domain"] = intern.domain if intern else None
    data["mentor_name"] = (
        intern.mentor.name if intern and intern.mentor else None
    )
    return data


@router.post("/change-password")
def change_password(
    payload: PasswordChangeRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    user.password_hash = hash_password(payload.new_password)
    db.commit()
    return {"message": "Password updated successfully"}

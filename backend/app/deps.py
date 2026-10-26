from collections.abc import Callable

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from .config import settings
from .database import get_db
from .models import Intern, User
from .security import decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.api_prefix}/auth/login")


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_access_token(token)
        user_id = int(payload.get("sub", "0"))
    except (jwt.PyJWTError, ValueError):
        raise credentials_error

    user = db.get(User, user_id)
    if not user or not user.active:
        raise credentials_error
    return user


def require_roles(*roles: str) -> Callable:
    def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to perform this action",
            )
        return user

    return checker


def get_current_intern(
    user: User = Depends(require_roles("intern")),
    db: Session = Depends(get_db),
) -> Intern:
    intern = db.query(Intern).filter(Intern.user_id == user.id).first()
    if not intern:
        raise HTTPException(status_code=404, detail="Intern profile not found")
    return intern


def ensure_assignment_access(
    assignment,
    user: User,
    intern: Intern | None,
) -> None:
    if user.role == "admin":
        return
    if user.role == "mentor":
        if intern is None or assignment.intern.mentor_id != user.id:
            raise HTTPException(status_code=403, detail="This assignment is not in your review queue")
        return
    if user.role == "intern":
        if intern is None or assignment.intern_id != intern.id:
            raise HTTPException(status_code=403, detail="You can only access your own assignments")
        return
    raise HTTPException(status_code=403, detail="Access denied")

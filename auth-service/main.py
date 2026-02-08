"""
FastAPI Auth Service for AIS Aviation System.
Provides registration, login, and password verification endpoints.
"""
import uuid
from typing import Generator

from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from passlib.context import CryptContext

from config import settings
from models import Base, User
from schemas import (
    RegisterRequest,
    LoginRequest,
    VerifyPasswordRequest,
    AuthResponse,
    UserResponse,
    HealthResponse,
)

# ---------------------------------------------------------------------------
# Database setup
# ---------------------------------------------------------------------------
engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Create tables only if they don't already exist (safe for shared DB)
Base.metadata.create_all(bind=engine, checkfirst=True)

# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
)

# CORS
origins = [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------
def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.post("/auth/register", response_model=AuthResponse)
def register(body: RegisterRequest, db: Session = Depends(get_db)):
    """Register a new user with email and password."""
    existing = db.query(User).filter(User.email == body.email).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists.",
        )

    open_id = f"local_{uuid.uuid4().hex[:16]}"
    hashed = pwd_context.hash(body.password)

    role = "admin" if settings.OWNER_EMAIL and body.email.lower() == settings.OWNER_EMAIL.lower() else "user"

    user = User(
        openId=open_id,
        name=body.name,
        email=body.email,
        passwordHash=hashed,
        loginMethod="password",
        role=role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return AuthResponse(
        success=True,
        user=UserResponse.model_validate(user),
        message="Registration successful.",
    )


@app.post("/auth/login", response_model=AuthResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    """Authenticate a user with email and password."""
    user = db.query(User).filter(User.email == body.email).first()
    if not user or not user.passwordHash:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    if not pwd_context.verify(body.password, user.passwordHash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )

    return AuthResponse(
        success=True,
        user=UserResponse.model_validate(user),
        message="Login successful.",
    )


@app.post("/auth/verify-password", response_model=AuthResponse)
def verify_password(body: VerifyPasswordRequest, db: Session = Depends(get_db)):
    """Verify a password against the stored hash. Used by the Node.js backend."""
    user = db.query(User).filter(User.email == body.email).first()
    if not user or not user.passwordHash:
        return AuthResponse(success=False, message="User not found or no password set.")

    if not pwd_context.verify(body.password, user.passwordHash):
        return AuthResponse(success=False, message="Password does not match.")

    return AuthResponse(
        success=True,
        user=UserResponse.model_validate(user),
        message="Password verified.",
    )


@app.get("/auth/health", response_model=HealthResponse)
def health_check():
    """Health-check endpoint."""
    return HealthResponse(
        status="healthy",
        service=settings.APP_NAME,
        version="1.0.0",
    )

"""
FastAPI Auth Service for AIS Aviation System.
Provides registration, login, and password verification endpoints.
"""
import hmac
import uuid
from typing import Generator, Optional

from fastapi import FastAPI, Depends, Header, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session
import bcrypt

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

# Schema creation and upgrades are owned exclusively by the Drizzle migrator.

# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------
class _BcryptContext:
    """bcrypt called directly, with the two methods the routes use.

    passlib 1.7.4 (unmaintained since 2020) reads ``bcrypt.__about__`` to
    detect the backend version; bcrypt 4.1+ removed that attribute, so every
    process start logged a trapped ``AttributeError`` traceback. Hashes are the
    same ``$2b$12$`` format passlib produced, so stored passwords keep
    verifying.
    """

    rounds = 12

    def hash(self, password: str) -> str:
        return bcrypt.hashpw(
            password.encode("utf-8"), bcrypt.gensalt(rounds=self.rounds)
        ).decode("ascii")

    def verify(self, password: str, hashed: str) -> bool:
        try:
            return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("ascii"))
        except ValueError:
            # Malformed stored hash or an over-long password: never a match.
            return False


pwd_context = _BcryptContext()
# Verified on the unknown-user branch so a missing account costs the same
# time as a wrong password; otherwise response timing enumerates accounts.
_DUMMY_HASH = pwd_context.hash(uuid.uuid4().hex)

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

def require_service_token(
    x_auth_service_token: Optional[str] = Header(default=None),
) -> None:
    """Only the Node backend may use this service. Enforced whenever a token is configured."""
    expected = settings.AUTH_SERVICE_TOKEN
    if not expected:
        return
    if not x_auth_service_token or not hmac.compare_digest(
        x_auth_service_token.encode(), expected.encode()
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Service credential required.",
        )

# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.post("/auth/register", response_model=AuthResponse, dependencies=[Depends(require_service_token)])
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

    role = "user"  # Public registration never grants platform privileges.

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


@app.post("/auth/login", response_model=AuthResponse, dependencies=[Depends(require_service_token)])
def login(body: LoginRequest, db: Session = Depends(get_db)):
    """Authenticate a user with email and password."""
    user = db.query(User).filter(User.email == body.email).first()
    if not user or not user.passwordHash:
        pwd_context.verify(body.password, _DUMMY_HASH)
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


@app.post("/auth/verify-password", response_model=AuthResponse, dependencies=[Depends(require_service_token)])
def verify_password(body: VerifyPasswordRequest, db: Session = Depends(get_db)):
    """Verify a password against the stored hash. Used by the Node.js backend."""
    user = db.query(User).filter(User.email == body.email).first()
    if not user or not user.passwordHash:
        # One message and one bcrypt cost for both failure kinds.
        pwd_context.verify(body.password, _DUMMY_HASH)
        return AuthResponse(success=False, message="Invalid email or password.")

    if not pwd_context.verify(body.password, user.passwordHash):
        return AuthResponse(success=False, message="Invalid email or password.")

    return AuthResponse(
        success=True,
        user=UserResponse.model_validate(user),
        message="Password verified.",
    )


@app.get("/auth/health", response_model=HealthResponse)
def health_check(db: Session = Depends(get_db)):
    """Readiness requires the shared database to accept queries."""
    try:
        db.execute(text("SELECT 1"))
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Database unavailable") from exc
    return HealthResponse(
        status="healthy",
        service=settings.APP_NAME,
        version="1.0.0",
    )

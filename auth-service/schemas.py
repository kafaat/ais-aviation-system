"""
Pydantic schemas for request/response validation.
"""
from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import Optional


def _within_bcrypt_limit(value: str) -> str:
    # bcrypt hashes only the first 72 bytes; a longer password would verify
    # with any suffix. Refuse it instead of silently truncating.
    if len(value.encode("utf-8")) > 72:
        raise ValueError("Password must be at most 72 bytes")
    return value


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: Optional[str] = None

    @field_validator("password")
    @classmethod
    def password_within_bcrypt_limit(cls, value: str) -> str:
        return _within_bcrypt_limit(value)

class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)

class VerifyPasswordRequest(BaseModel):
    email: str
    password: str

class UserResponse(BaseModel):
    id: int
    openId: str
    name: Optional[str] = None
    email: Optional[str] = None
    role: str

    class Config:
        from_attributes = True

class AuthResponse(BaseModel):
    success: bool
    user: Optional[UserResponse] = None
    message: Optional[str] = None

class HealthResponse(BaseModel):
    status: str
    service: str
    version: str

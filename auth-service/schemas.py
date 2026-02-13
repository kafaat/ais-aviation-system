"""
Pydantic schemas for request/response validation.
"""
from pydantic import BaseModel, EmailStr, Field
from typing import Optional

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: Optional[str] = None

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

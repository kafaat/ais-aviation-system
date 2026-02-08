"""
SQLAlchemy models for the Auth Service.
Maps to the existing 'users' table used by the Node.js backend.
"""
from sqlalchemy import Column, Integer, String, Text, Enum, DateTime, func
from sqlalchemy.orm import declarative_base

Base = declarative_base()

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    openId = Column(String(64), unique=True, nullable=False)
    name = Column(Text, nullable=True)
    email = Column(String(320), nullable=True, index=True)
    passwordHash = Column(String(255), nullable=True)
    loginMethod = Column(String(64), nullable=True)
    role = Column(
        Enum("user", "admin", "super_admin", "airline_admin", "finance", "ops", "support", name="user_role"),
        nullable=False,
        default="user",
    )
    createdAt = Column(DateTime, server_default=func.now(), nullable=False)
    updatedAt = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
    lastSignedIn = Column(DateTime, server_default=func.now(), nullable=False)

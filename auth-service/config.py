"""
Configuration for the Auth Service.
Reads from environment variables with sensible defaults.
"""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = "mysql+pymysql://root:password@localhost:3306/ais_aviation"

    # JWT
    JWT_SECRET: str = "your-super-secret-jwt-key-change-this-in-production"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30
    REFRESH_TOKEN_PEPPER: str = ""

    # App
    APP_NAME: str = "AIS Auth Service"
    APP_ID: str = "ais-aviation-system"
    DEBUG: bool = False
    PORT: int = 8000

    # CORS
    CORS_ORIGINS: str = "http://localhost:3000"

    # Owner (auto-admin)
    OWNER_EMAIL: str = ""

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()

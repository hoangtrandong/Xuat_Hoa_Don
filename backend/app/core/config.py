from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    PROJECT_NAME: str = "DMS - Distribution Management System"
    API_V1_PREFIX: str = "/api/v1"
    DEBUG: bool = False

    DB_HOST: str = "localhost"
    DB_PORT: int = 5432
    DB_USER: str = "dms"
    DB_PASSWORD: str = "dms"
    DB_NAME: str = "dms"
    SQLITE_PATH: str = "dms.db"

    DATABASE_URL: str | None = None

    SECRET_KEY: str = "change-me-in-production"
    DATA_ENCRYPTION_KEY: str | None = None
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24
    VINAMILK_SESSION_COOKIE: str = ""
    ALLOWED_ORIGINS: str = (
        "http://localhost:3000,http://localhost:3001,"
        "http://127.0.0.1:3000,http://127.0.0.1:3001,"
        "http://103.90.225.142.sslip.io,https://103.90.225.142.sslip.io,"
        "http://web.103.90.225.142.sslip.io,https://web.103.90.225.142.sslip.io,"
        "http://app.103.90.225.142.sslip.io,https://app.103.90.225.142.sslip.io"
    )
    ALLOWED_ORIGIN_REGEX: str = (
        r"^https?://([a-z0-9-]+\.)?103\.90\.225\.142\.sslip\.io(:\d+)?$"
        r"|^https?://103\.90\.225\.142(:\d+)?$"
    )
    ALLOW_MOCK_EINVOICE: bool = False
    ALLOW_MIGRATION_STAMP_FALLBACK: bool = False

    @property
    def cors_origins(self) -> list[str]:
        origins = [
            origin.strip().rstrip("/")
            for origin in (self.ALLOWED_ORIGINS or "").split(",")
            if origin.strip()
        ]
        return origins or [
            "http://localhost:3000",
            "http://localhost:3001",
            "http://127.0.0.1:3000",
            "http://127.0.0.1:3001",
        ]

    @property
    def sqlalchemy_database_uri(self) -> str:
        if self.DATABASE_URL:
            url = self.DATABASE_URL
            if url.startswith("postgres://"):
                url = url.replace("postgres://", "postgresql+psycopg://", 1)
            elif url.startswith("postgresql://") and not url.startswith("postgresql+"):
                url = url.replace("postgresql://", "postgresql+psycopg://", 1)
            return url
        return f"postgresql+psycopg://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"


settings = Settings()
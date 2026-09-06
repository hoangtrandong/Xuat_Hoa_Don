from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://dms:dms@localhost:5432/dms"
    database_url_sync: str = "postgresql+psycopg2://dms:dms@localhost:5432/dms"
    auto_create_schema: bool = False


settings = Settings()

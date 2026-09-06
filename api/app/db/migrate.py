from pathlib import Path

from sqlalchemy import create_engine

from app.config import settings

SQL_FILE = Path(__file__).resolve().parents[2] / "sql" / "001_phase1.sql"


def apply_schema() -> None:
    sql = SQL_FILE.read_text(encoding="utf-8")
    engine = create_engine(settings.database_url_sync)
    with engine.connect() as conn:
        conn = conn.execution_options(isolation_level="AUTOCOMMIT")
        conn.exec_driver_sql(sql)

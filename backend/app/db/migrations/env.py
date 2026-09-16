from logging.config import fileConfig

from sqlalchemy import engine_from_config
from sqlalchemy import pool
from sqlalchemy import text
from time import monotonic, sleep

from alembic import context
import os
from dotenv import load_dotenv
load_dotenv()

from app.core.database import Base
from app import models  # noqa: F401

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Importing app.models registers every model class and association table on
# the shared declarative Base before Alembic inspects the metadata.
target_metadata = Base.metadata


def get_database_url() -> str:
    """Prefer an explicit Alembic URL without changing the local config."""
    return (
        context.get_x_argument(as_dictionary=True).get("database_url")
        or os.getenv("DATABASE_URL")
        or config.get_main_option("sqlalchemy.url")
    )

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = get_database_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = get_database_url()
    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
        connect_args={"connect_timeout": 15},
    )

    with connectable.connect() as connection:
        # Multiple application instances can start together on deploy. Serialize
        # migrations so they cannot both apply the same revision concurrently.
        if connection.dialect.name == "postgresql":
            deadline = monotonic() + 60
            acquired = False
            while monotonic() < deadline:
                acquired = bool(connection.scalar(text(
                    "SELECT pg_try_advisory_lock(hashtext('dms_alembic_migrations'))"
                )))
                if acquired:
                    break
                sleep(1)
            if not acquired:
                raise RuntimeError("Timed out waiting for the database migration lock.")
            # The lock probe starts an implicit SQLAlchemy transaction. End it
            # before Alembic creates its own migration transaction.
            connection.commit()
        try:
            context.configure(
                connection=connection,
                target_metadata=target_metadata,
                compare_type=True,
            )

            with context.begin_transaction():
                if connection.dialect.name == "postgresql":
                    connection.execute(text("SET LOCAL lock_timeout = '60s'"))
                    connection.execute(text("SET LOCAL statement_timeout = '120s'"))
                context.run_migrations()
        finally:
            if connection.dialect.name == "postgresql":
                connection.execute(text("SELECT pg_advisory_unlock(hashtext('dms_alembic_migrations'))"))


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

import importlib.util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text


def test_customer_removal_migration_widens_alembic_version_column():
    migration_path = (
        Path(__file__).parents[1]
        / "app"
        / "db"
        / "migrations"
        / "versions"
        / "20260927_drop_customer_route_visit.py"
    )
    spec = importlib.util.spec_from_file_location("drop_customer_route_visit", migration_path)
    assert spec and spec.loader
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(text(
            "CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)"
        ))
        connection.execute(text(
            "INSERT INTO alembic_version (version_num) VALUES "
            "('20260921_vinamilk_allocations')"
        ))
        connection.execute(text(
            "CREATE TABLE customers (id INTEGER PRIMARY KEY, route_id INTEGER, "
            "assigned_employee_id INTEGER, visit_frequency INTEGER, phone VARCHAR(20))"
        ))
        connection.execute(text("CREATE TABLE routes (id INTEGER PRIMARY KEY)"))
        connection.execute(text("CREATE TABLE visits (id INTEGER PRIMARY KEY)"))

        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()

        version_column = next(
            column for column in inspect(connection).get_columns("alembic_version")
            if column["name"] == "version_num"
        )
        assert version_column["type"].length == 128

        connection.execute(
            text("UPDATE alembic_version SET version_num = :revision"),
            {"revision": migration.revision},
        )
        assert connection.scalar(
            text("SELECT version_num FROM alembic_version")
        ) == migration.revision

    engine.dispose()
from importlib import import_module

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def test_migration_expands_alembic_revision_column(monkeypatch):
    migration = import_module(
        "app.db.migrations.versions.20260927_drop_customer_route_visit"
    )
    engine = sa.create_engine("sqlite://")

    with engine.begin() as connection:
        connection.execute(sa.text(
            "CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)"
        ))
        connection.execute(sa.text(
            "INSERT INTO alembic_version (version_num) VALUES "
            "('20260921_vinamilk_allocations')"
        ))
        monkeypatch.setattr(
            migration, "op", Operations(MigrationContext.configure(connection))
        )

        migration._widen_alembic_version_column()

        column = next(
            column
            for column in sa.inspect(connection).get_columns("alembic_version")
            if column["name"] == "version_num"
        )
        assert column["type"].length == 128

        connection.execute(
            sa.text("UPDATE alembic_version SET version_num = :revision"),
            {"revision": migration.revision},
        )
        assert connection.scalar(
            sa.text("SELECT version_num FROM alembic_version")
        ) == migration.revision

    engine.dispose()

"""add stores and companies for store-to-customer and tax-code relationships

Phase 2: 1 cửa hàng → nhiều mã khách hàng; cùng mã số thuế có thể có nhiều công ty
quản lý (công ty xuất hóa đơn, công ty con của đơn vị phân phối).

Revision ID: 20260912_stores_companies
Revises: 20260910_raw_delivery_quantities
Create Date: 2026-09-12
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260912_stores_companies"
down_revision: Union[str, None] = "20260910_raw_delivery_quantities"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "stores",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(40), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("phone", sa.String(20)),
        sa.Column("owner_name", sa.String(120)),
        sa.Column("address", sa.String(255)),
        sa.Column("district", sa.String(80)),
        sa.Column("city", sa.String(80)),
        sa.Column("status", sa.String(15), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("code"),
    )
    op.create_index("ix_stores_code", "stores", ["code"])
    op.create_index("ix_stores_name", "stores", ["name"])

    op.create_table(
        "companies",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(40), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("tax_code", sa.String(30)),
        sa.Column("phone", sa.String(20)),
        sa.Column("address", sa.String(255)),
        sa.Column("status", sa.String(15), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("code"),
    )
    op.create_index("ix_companies_code", "companies", ["code"])
    op.create_index("ix_companies_name", "companies", ["name"])
    op.create_index("ix_companies_tax_code", "companies", ["tax_code"])

    with op.batch_alter_table("customers") as batch:
        batch.add_column(sa.Column("store_id", sa.Integer()))
        batch.add_column(sa.Column("company_id", sa.Integer()))
        batch.create_foreign_key("fk_customers_store", "stores", ["store_id"], ["id"], ondelete="SET NULL")
        batch.create_foreign_key("fk_customers_company", "companies", ["company_id"], ["id"], ondelete="SET NULL")
        batch.create_index("ix_customers_store_id", ["store_id"])
        batch.create_index("ix_customers_company_id", ["company_id"])


def downgrade() -> None:
    with op.batch_alter_table("customers") as batch:
        batch.drop_index("ix_customers_company_id")
        batch.drop_index("ix_customers_store_id")
        batch.drop_constraint("fk_customers_company", type_="foreignkey")
        batch.drop_constraint("fk_customers_store", type_="foreignkey")
        batch.drop_column("company_id")
        batch.drop_column("store_id")
    op.drop_index("ix_companies_tax_code", table_name="companies")
    op.drop_index("ix_companies_name", table_name="companies")
    op.drop_index("ix_companies_code", table_name="companies")
    op.drop_table("companies")
    op.drop_index("ix_stores_name", table_name="stores")
    op.drop_index("ix_stores_code", table_name="stores")
    op.drop_table("stores")
"""normalize legacy long Vinamilk customer codes to 3-char codes across snapshots and customers

Revision ID: 20261124_norm_vnm_cust
Revises: 20261124_inv_prod_company
"""

from alembic import op
from sqlalchemy.orm import Session


revision = "20261124_norm_vnm_cust"
down_revision = "20261124_inv_prod_company"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    session = Session(bind=bind)
    try:
        from app.services.vinamilk_customer_code import migrate_vinamilk_customer_codes_to_3_chars

        migrate_vinamilk_customer_codes_to_3_chars(session, commit=False)
        session.flush()
    finally:
        session.close()


def downgrade() -> None:
    # Data normalization migration (irreversible by design)
    pass

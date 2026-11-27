import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.v1.endpoints.product_groups import bulk_delete_distributor_products
from app.core.database import Base
from app.models.multi_tenant_invoice import Distributor
from app.models.product import DistributorProduct, Product, ProductCategory, ProductUnit
from app.models.user import User
from app.schemas.product_group import DistributorProductBulkDelete


@pytest.fixture
def dms_db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as db:
        dist_a = Distributor(code="NPP_A", name="NPP A")
        dist_b = Distributor(code="NPP_B", name="NPP B")
        cat = ProductCategory(code="CAT1", name="Category 1")
        unit = ProductUnit(code="HOP", name="Hộp")
        db.add_all([dist_a, dist_b, cat, unit])
        db.flush()

        p1 = Product(sku="CQT01", name="SP CQT 1", category_id=cat.id, unit_id=unit.id, _npp_code="DMS01")
        p2 = Product(sku="CQT02", name="SP CQT 2", category_id=cat.id, unit_id=unit.id, _npp_code="DMS02")
        p3 = Product(sku="CQT03", name="SP CQT 3", category_id=cat.id, unit_id=unit.id, _npp_code="DMS03")
        db.add_all([p1, p2, p3])
        db.flush()

        dp1 = DistributorProduct(
            distributor_id=dist_a.id,
            distributor_sku="DMS01",
            distributor_product_name="SP DMS 01",
            supplier="Vinamilk",
        )
        dp2 = DistributorProduct(
            distributor_id=dist_a.id,
            distributor_sku="DMS02",
            distributor_product_name="SP DMS 02",
            supplier="Vinamilk",
        )
        dp3_dup_sku = DistributorProduct(
            distributor_id=dist_b.id,
            distributor_sku="DMS02",
            distributor_product_name="SP DMS 02 (NPP B)",
            supplier="Vinamilk",
        )
        dp4_other_tenant = DistributorProduct(
            distributor_id=dist_b.id,
            distributor_sku="DMS03",
            distributor_product_name="SP DMS 03 (NPP B)",
            supplier="Vinamilk",
        )
        db.add_all([dp1, dp2, dp3_dup_sku, dp4_other_tenant])

        admin_user = User(
            username="admin",
            email="admin@example.com",
            hashed_password="x",
            full_name="Admin",
            is_active=True,
            distributor_id=None,
        )
        npp_a_user = User(
            username="npp_a",
            email="npp_a@example.com",
            hashed_password="x",
            full_name="NPP A",
            is_active=True,
            distributor_id=dist_a.id,
        )
        db.add_all([admin_user, npp_a_user])
        db.commit()

        yield db, {
            "admin": admin_user,
            "npp_a": npp_a_user,
            "dp1": dp1,
            "dp2": dp2,
            "dp3": dp3_dup_sku,
            "dp4": dp4_other_tenant,
            "p1": p1,
            "p2": p2,
            "p3": p3,
        }
    Base.metadata.drop_all(engine)
    engine.dispose()


def test_bulk_delete_dms_products_respects_tenant_and_clears_orphan_npp_code(dms_db):
    db, ctx = dms_db

    # NPP A tries to bulk delete dp1 (own), dp2 (own, SKU shared with NPP B), and dp4 (belongs to NPP B)
    res = bulk_delete_distributor_products(
        DistributorProductBulkDelete(ids=[ctx["dp1"].id, ctx["dp2"].id, ctx["dp4"].id]),
        db=db,
        current_user=ctx["npp_a"],
    )

    assert res["success"] is True
    assert res["deleted_count"] == 2
    assert set(res["deleted_ids"]) == {ctx["dp1"].id, ctx["dp2"].id}

    # dp4 belonging to NPP B must remain intact
    remaining_ids = set(db.scalars(select(DistributorProduct.id)).all())
    assert remaining_ids == {ctx["dp3"].id, ctx["dp4"].id}

    # Product p1 had DMS01 which has no remaining DistributorProduct -> _npp_code cleared
    db.refresh(ctx["p1"])
    assert ctx["p1"]._npp_code is None

    # Product p2 had DMS02 which is still referenced by dp3 -> _npp_code kept
    db.refresh(ctx["p2"])
    assert ctx["p2"]._npp_code == "DMS02"

    # Product p3 untouched
    db.refresh(ctx["p3"])
    assert ctx["p3"]._npp_code == "DMS03"


def test_bulk_delete_dms_products_as_admin(dms_db):
    db, ctx = dms_db

    res = bulk_delete_distributor_products(
        DistributorProductBulkDelete(ids=[ctx["dp1"].id, ctx["dp4"].id]),
        db=db,
        current_user=ctx["admin"],
    )

    assert res["success"] is True
    assert res["deleted_count"] == 2
    assert set(res["deleted_ids"]) == {ctx["dp1"].id, ctx["dp4"].id}
    db.refresh(ctx["p1"])
    db.refresh(ctx["p3"])
    assert ctx["p1"]._npp_code is None
    assert ctx["p3"]._npp_code is None

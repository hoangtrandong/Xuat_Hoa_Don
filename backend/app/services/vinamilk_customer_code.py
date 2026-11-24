"""Chuẩn hóa mã khách hàng đồng bộ từ Vinamilk DMS (mặc định lấy 3 ký tự cuối)."""

from __future__ import annotations

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session, selectinload

_PRESERVE_PREFIXES = ("NVGH-", "NVBH-", "KH")
_PRESERVE_EXACT = {"NVBH", "KH_LE", "KH-LE", "DEFAULT"}


def is_vinamilk_supplier(supplier_code: str | None) -> bool:
    """Kiểm tra nguồn dữ liệu có phải Vinamilk không (mặc định True nếu rỗng/None)."""
    sup = (supplier_code or "VINAMILK").strip().upper()
    return (
        sup == "VINAMILK"
        or "VINAMILK" in sup
        or sup == "VNM"
        or sup.startswith(("VNM-", "VNM_", "VNM "))
    )


def normalize_vinamilk_customer_code(
    code: str | None,
    supplier_code: str | None = "VINAMILK",
) -> str:
    """Lấy 3 ký tự cuối của mã khách hàng khi dữ liệu đến từ Vinamilk.

    - Giữ nguyên các mã nội bộ / placeholder (`NVGH-*`, `NVBH-*`, `KH-*`, `DEFAULT`, `KH_LE`).
    - Giữ nguyên nếu nguồn không phải Vinamilk.
    - VD: `MG200310CR` -> `0CR`, `MG2003100J` -> `00J`, `00J` -> `00J`.
    """
    cleaned = (code or "").strip()
    if not cleaned:
        return ""
    if not is_vinamilk_supplier(supplier_code):
        return cleaned
    upper = cleaned.upper()
    if upper.startswith(_PRESERVE_PREFIXES) or upper in _PRESERVE_EXACT:
        return cleaned
    return cleaned[-3:] if len(cleaned) > 3 else cleaned


def _looks_like_legacy_vinamilk_customer_code(code: str, snapshot_long_codes: set[str]) -> bool:
    """Xác định mã khách hàng cũ trong bảng customers thuộc nguồn Vinamilk cần rút gọn về 3 ký tự cuối."""
    cleaned = (code or "").strip()
    if len(cleaned) <= 3:
        return False
    upper = cleaned.upper()
    if upper.startswith(("KH", "NV")) or upper in _PRESERVE_EXACT:
        return False
    if upper in snapshot_long_codes:
        return True
    # Mã outlet Vinamilk DMS chuẩn thường dài >= 6 ký tự chữ+số (VD: MG200310CR, MG2003100J, 0000012345)
    return len(cleaned) >= 6 and cleaned.isalnum()


def migrate_vinamilk_customer_codes_to_3_chars(
    db: Session,
    commit: bool = True,
) -> dict[str, int]:
    """Chuyển toàn bộ dữ liệu cũ của Vinamilk (snapshots, customers, delivery_request_orders) sang mã 3 ký tự cuối.

    An toàn & idempotent:
    - Nếu mã 3 ký tự cuối đã tồn tại trong cùng NPP (VD: đã upload 00J có MST/Công ty, đồng thời tồn tại MG2003100J từ DMS),
      hệ thống tự động gộp thông tin còn thiếu + liên kết công ty + chuyển toàn bộ FK (đơn hàng, thanh toán, công nợ,
      giấy báo có) sang bản ghi 3 ký tự rồi xóa bản ghi trùng mã dài.
    - Không đụng tới các mã KH thủ công/KiotViet (`KH*`, `NV*`).
    """
    from app.models.customer import Customer, CustomerCompany
    from app.models.inventory import DeliveryRequestOrder
    from app.models.vinamilk import VinamilkOrderSnapshot

    snapshots_updated = 0
    customers_renamed = 0
    customers_merged = 0
    delivery_orders_updated = 0

    vinamilk_long_codes: set[str] = set()

    # 1. Chuẩn hóa vinamilk_order_snapshots (cả cột customer_code lẫn raw_payload['Mã KH'])
    long_snaps = db.scalars(
        select(VinamilkOrderSnapshot).where(
            VinamilkOrderSnapshot.customer_code.is_not(None),
            func.length(func.trim(VinamilkOrderSnapshot.customer_code)) > 3,
        )
    ).all()
    for snap in long_snaps:
        raw = snap.raw_payload if isinstance(snap.raw_payload, dict) else {}
        sup = str(raw.get("Nguồn đồng bộ") or raw.get("Nhà cung cấp") or "VINAMILK")
        if not is_vinamilk_supplier(sup):
            continue
        old_code = (snap.customer_code or "").strip()
        short_code = normalize_vinamilk_customer_code(old_code, sup)
        if not short_code or short_code == old_code:
            continue
        vinamilk_long_codes.add(old_code.upper())
        snap.customer_code = short_code
        if isinstance(snap.raw_payload, dict) and snap.raw_payload.get("Mã KH") != short_code:
            updated_payload = dict(snap.raw_payload)
            updated_payload["Mã KH"] = short_code
            snap.raw_payload = updated_payload
        snapshots_updated += 1

    # 2. Chuẩn hóa & gộp trùng trong bảng customers
    long_customers = db.scalars(
        select(Customer)
        .options(
            selectinload(Customer.company_links),
            selectinload(Customer.addresses),
            selectinload(Customer.contacts),
        )
        .where(func.length(func.trim(Customer.code)) > 3)
        .order_by(Customer.id.asc())
    ).all()

    if long_customers:
        # Nạp sẵn map (distributor_id, UPPER(code)) -> Customer hiện có
        all_existing = db.scalars(
            select(Customer)
            .options(
                selectinload(Customer.company_links),
                selectinload(Customer.addresses),
                selectinload(Customer.contacts),
            )
        ).all()
        by_dist_code: dict[tuple[int | None, str], Customer] = {
            (c.distributor_id, (c.code or "").strip().upper()): c
            for c in all_existing
            if c.code
        }

        for cust in long_customers:
            old_code = (cust.code or "").strip()
            if not _looks_like_legacy_vinamilk_customer_code(old_code, vinamilk_long_codes):
                continue
            short_code = normalize_vinamilk_customer_code(old_code, "VINAMILK")
            if not short_code or short_code.upper() == old_code.upper():
                continue

            target_key = (cust.distributor_id, short_code.upper())
            target = by_dist_code.get(target_key)

            if target is None or target.id == cust.id:
                by_dist_code.pop((cust.distributor_id, old_code.upper()), None)
                cust.code = short_code
                by_dist_code[target_key] = cust
                db.flush()
                customers_renamed += 1
            else:
                # Gộp thông tin còn thiếu từ bản ghi mã dài vào bản ghi mã 3 ký tự (không ghi đè dữ liệu đã có)
                if not target.tax_code and cust.tax_code:
                    target.tax_code = cust.tax_code
                if not target.citizen_id and cust.citizen_id:
                    target.citizen_id = cust.citizen_id
                if not target.phone and cust.phone:
                    target.phone = cust.phone
                if not target.email and cust.email:
                    target.email = cust.email
                if not target.staff_code and cust.staff_code:
                    target.staff_code = cust.staff_code
                if not target.staff_name and cust.staff_name:
                    target.staff_name = cust.staff_name
                if not target.manager_code and cust.manager_code:
                    target.manager_code = cust.manager_code
                    target.manager_name = cust.manager_name
                if not target.store_id and cust.store_id:
                    target.store_id = cust.store_id
                if not target.company_id and cust.company_id:
                    target.company_id = cust.company_id
                if cust.credit_limit and cust.credit_limit > (target.credit_limit or 0):
                    target.credit_limit = cust.credit_limit
                if cust.current_debt and not target.current_debt:
                    target.current_debt = cust.current_debt

                # Gộp liên kết Công ty quản lý (customer_companies)
                target_comp_ids = set(target.company_ids)
                for cid in cust.company_ids:
                    if cid not in target_comp_ids:
                        db.add(
                            CustomerCompany(
                                customer_id=target.id,
                                company_id=cid,
                                is_primary=(target.company_id is None and len(target_comp_ids) == 0),
                            )
                        )
                        if target.company_id is None:
                            target.company_id = cid
                        target_comp_ids.add(cid)

                # Chuyển địa chỉ / liên hệ nếu bản ghi đích chưa có
                if not target.addresses and cust.addresses:
                    for addr in list(cust.addresses):
                        addr.customer_id = target.id
                if not target.contacts and cust.contacts:
                    for contact in list(cust.contacts):
                        contact.customer_id = target.id

                # Chuyển toàn bộ khóa ngoại từ cust.id sang target.id
                for table_name in ("sales_orders", "payments", "receivables", "bank_receipts"):
                    db.execute(
                        text(f"UPDATE {table_name} SET customer_id = :tid WHERE customer_id = :sid"),
                        {"tid": target.id, "sid": cust.id},
                    )
                db.flush()

                by_dist_code.pop((cust.distributor_id, old_code.upper()), None)
                db.delete(cust)
                db.flush()
                customers_merged += 1

    # 3. Chuẩn hóa delivery_request_orders.customer_code nếu khớp mã dài Vinamilk
    if vinamilk_long_codes:
        delivery_orders = db.scalars(
            select(DeliveryRequestOrder).where(
                DeliveryRequestOrder.customer_code.is_not(None),
                func.length(func.trim(DeliveryRequestOrder.customer_code)) > 3,
            )
        ).all()
        for dro in delivery_orders:
            old_code = (dro.customer_code or "").strip()
            if old_code.upper() in vinamilk_long_codes:
                dro.customer_code = normalize_vinamilk_customer_code(old_code, "VINAMILK")
                delivery_orders_updated += 1

    if commit and (snapshots_updated or customers_renamed or customers_merged or delivery_orders_updated):
        db.commit()

    return {
        "snapshots_updated": snapshots_updated,
        "customers_renamed": customers_renamed,
        "customers_merged": customers_merged,
        "delivery_orders_updated": delivery_orders_updated,
    }

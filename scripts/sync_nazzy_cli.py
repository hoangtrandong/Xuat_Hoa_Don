#!/usr/bin/env python3
"""Công cụ dòng lệnh (CLI Utility) tự động đồng bộ đơn hàng từ DMS Nazzy (http://dms21.nazzy.vn)
cho Nhà Phân Phối Mai Gold (NPP-MAIGOLD).

Sử dụng:
  python scripts/sync_nazzy_cli.py [--date YYYY-MM-DD] [--save-config]
"""
import argparse
from datetime import date, datetime
import sys
from pathlib import Path

# Thêm thư mục backend vào sys.path
backend_dir = Path(__file__).resolve().parent.parent / "backend"
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app.core.database import SessionLocal
from app.models.multi_tenant_invoice import Distributor, DistributorSupplierConfig
from app.services.supplier_connectors import (
    DynamicFieldMapper,
    RestApiSupplierConnector,
    persist_canonical_orders_to_snapshots,
)
from app.api.v1.endpoints.multi_tenant_einvoice import _ensure_default_distributors_seeded
from sqlalchemy import select


def main():
    parser = argparse.ArgumentParser(description="Đồng bộ đơn hàng Nazzy DMS cho NPP Mai Gold.")
    parser.add_argument(
        "--from-date",
        dest="from_date",
        default=None,
        help="Ngày bắt đầu (YYYY-MM-DD hoặc YYYY/MM/DD). Mặc định là ngày hôm nay.",
    )
    parser.add_argument(
        "--to-date",
        dest="to_date",
        default=None,
        help="Ngày kết thúc (YYYY-MM-DD hoặc YYYY/MM/DD).",
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        _ensure_default_distributors_seeded(db)
        db.commit()

        # Tìm cấu hình NPP Mai Gold
        npp = db.scalar(select(Distributor).where(Distributor.code == "NPP-MAIGOLD"))
        if not npp:
            print("Lỗi: Không tìm thấy Nhà phân phối NPP-MAIGOLD trong cơ sở dữ liệu.")
            sys.exit(1)

        cfg = db.scalar(
            select(DistributorSupplierConfig).where(
                DistributorSupplierConfig.distributor_id == npp.id,
                DistributorSupplierConfig.supplier_code == "NAZZY",
            )
        )
        if not cfg:
            print("Lỗi: Chưa có cấu hình Nhà cung cấp NAZZY cho NPP-MAIGOLD.")
            sys.exit(1)

        today = datetime.utcnow().date()
        target_from = today
        if args.from_date:
            clean_f = args.from_date.replace("/", "-")
            target_from = datetime.strptime(clean_f, "%Y-%m-%d").date()

        target_to = target_from
        if args.to_date:
            clean_t = args.to_date.replace("/", "-")
            target_to = datetime.strptime(clean_t, "%Y-%m-%d").date()

        print(f"[*] Bắt đầu đồng bộ đơn hàng từ Nazzy DMS cho {npp.name} ({npp.code})...")
        print(f"[*] Khoảng thời gian: {target_from:%d/%m/%Y} -> {target_to:%d/%m/%Y}")

        connector = RestApiSupplierConnector()
        raw_rows = connector.fetch_raw_orders(cfg, target_from, target_to)
        print(f"[*] Đã tải về {len(raw_rows)} dòng sản phẩm thô từ hệ thống Nazzy.")

        canonical_orders = DynamicFieldMapper.transform_rows_to_canonical(
            raw_rows=raw_rows,
            supplier_code=cfg.supplier_code,
            field_mapping=cfg.field_mapping or {},
            distributor_code=npp.code,
        )
        print(f"[*] Chuẩn hóa thành {len(canonical_orders)} đơn hàng hợp lệ.")

        saved_lines = persist_canonical_orders_to_snapshots(
            db=db,
            canonical_orders=canonical_orders,
            distributor_code=npp.code,
        )
        cfg.last_synced_at = datetime.utcnow()
        db.commit()

        total_amount = sum(
            sum(item.line_total for item in ord_item.items)
            for ord_item in canonical_orders
        )

        print("\n" + "=" * 60)
        print("ĐỒNG BỘ THÀNH CÔNG RỰC RỠ!")
        print(f"  - Số đơn hàng: {len(canonical_orders)} đơn")
        print(f"  - Số dòng sản phẩm: {saved_lines} dòng")
        print(f"  - Tổng giá trị đơn hàng: {total_amount:,.0f} VND")
        print(f"  - Thời gian cập nhật: {datetime.now():%d/%m/%Y %H:%M:%S}")
        print("=" * 60)
        if canonical_orders:
            print("\nDanh sách 5 đơn hàng đầu tiên:")
            for o in canonical_orders[:5]:
                print(f"  + Đơn {o.order_number}: KH {o.customer_name} (MST: {o.customer_tax_code or 'Không có'}) - {len(o.items)} mặt hàng")

    except Exception as e:
        print(f"Lỗi trong quá trình đồng bộ: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()

"""Dọn các Employee bị tạo nhầm từ NVBH của Vinamilk.

Đó là các bản ghi có vinamilk_code. Chạy mặc định = dry-run.
    python -m scripts.cleanup_vinamilk_employees          # chỉ xem trước
    python -m scripts.cleanup_vinamilk_employees --apply  # thực hiện

- Gỡ liên kết employee_id khỏi sales_orders (đơn đồng bộ từ Vinamilk).
- Chỉ xóa nhân viên không còn tham chiếu nào khác (tài khoản, công nợ, phiếu...).
  Nhân viên còn tham chiếu sẽ được liệt kê để xử lý thủ công.
"""
import sys

from sqlalchemy import text

from app.core.database import SessionLocal
from app.models.employee import Employee
from app.models.sales import SalesOrder


def main(apply: bool) -> None:
    db = SessionLocal()
    try:
        emps = db.query(Employee).filter(Employee.vinamilk_code.isnot(None)).all()
        print(f"Tìm thấy {len(emps)} nhân viên có vinamilk_code")

        fk_rows = db.execute(text("""
            SELECT tc.table_name, kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
            JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
            WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'employees'
        """)).fetchall()
        other_refs = [(t, c) for t, c in fk_rows if (t, c) != ("sales_orders", "employee_id")]

        deletable, blocked = [], []
        for e in emps:
            used = False
            for table, col in other_refs:
                n = db.execute(text(f'SELECT COUNT(*) FROM "{table}" WHERE "{col}" = :i'), {"i": e.id}).scalar()
                if n:
                    used = True
                    break
            (blocked if used else deletable).append(e)

        for e in deletable:
            print(f"  XÓA   {e.code} | {e.vinamilk_code} | {e.name}")
        for e in blocked:
            print(f"  GIỮ (còn tham chiếu) {e.code} | {e.vinamilk_code} | {e.name}")

        if not apply:
            print("Dry-run: thêm --apply để thực hiện.")
            return

        ids = [e.id for e in emps]
        if ids:
            db.query(SalesOrder).filter(SalesOrder.employee_id.in_(ids)).update(
                {SalesOrder.employee_id: None}, synchronize_session=False
            )
        for e in deletable:
            db.delete(e)
        db.commit()
        print(f"Đã xóa {len(deletable)} nhân viên, giữ lại {len(blocked)}.")
    finally:
        db.close()


if __name__ == "__main__":
    main("--apply" in sys.argv)

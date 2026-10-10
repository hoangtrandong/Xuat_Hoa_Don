from decimal import Decimal, InvalidOperation
from io import BytesIO
from typing import Any, List
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from openpyxl import load_workbook
from openpyxl.utils.exceptions import InvalidFileException
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from zipfile import BadZipFile

from app.core.database import get_db
from app.core.auth import get_current_user
from app.crud import delivery_request as crud
from app.models.employee import Employee
from app.models.finance import DebtLedgerEntry
from app.models.user import User
from app.schemas.delivery_request import (
    DeliveryRequest, DeliveryRequestList, DeliveryRequestCreate, DeliveryPreviewItem,
    DeliveryPreviewResponse, FefoPlanItem,
)

router = APIRouter(prefix="/delivery-requests", tags=["delivery-requests"])


def _quantity(value: Any, boxes_per_carton: int = 1) -> tuple[int, int, int, str | None]:
    """Return base boxes, cartons, loose boxes and the original cell value."""
    if value is None or not str(value).strip():
        raise ValueError("quantity không được để trống.")
    raw = str(value).strip()
    if "/" in raw:
        parts = [part.strip() for part in raw.split("/")]
        if len(parts) != 2:
            raise ValueError(f"Số lượng '{raw}' không hợp lệ.")
        try:
            cartons, boxes = (int(part) for part in parts)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Số lượng '{raw}' không hợp lệ.") from exc
        if cartons < 0 or boxes < 0:
            raise ValueError(f"Số lượng '{raw}' không hợp lệ.")
        return cartons * boxes_per_carton + boxes, cartons, boxes, raw
    try:
        quantity = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Số lượng '{raw}' không hợp lệ.") from exc
    if quantity < 0:
        raise ValueError(f"Số lượng '{raw}' không hợp lệ.")
    return quantity, quantity // boxes_per_carton, quantity % boxes_per_carton, raw


def _looks_like_quantity(value: Any) -> bool:
    if value is None or not str(value).strip():
        return False
    raw = str(value).strip()
    if "/" in raw:
        parts = raw.split("/")
        return len(parts) == 2 and all(part.strip().isdigit() for part in parts)
    return raw.isdigit()


def _employee_amount(value: Any, employee_code: str, row_number: int) -> float:
    if value is None or not str(value).strip():
        raise ValueError(
            f"Dòng {row_number}: thiếu tổng tiền công nợ của nhân viên {employee_code}."
        )
    try:
        amount = Decimal(str(value).strip())
    except InvalidOperation as exc:
        raise ValueError(
            f"Dòng {row_number}: tổng tiền của nhân viên {employee_code} không hợp lệ."
        ) from exc
    if not amount.is_finite() or amount < 0:
        raise ValueError(
            f"Dòng {row_number}: tổng tiền của nhân viên {employee_code} phải là số không âm."
        )
    normalized_amount = amount * 1000
    if normalized_amount > Decimal("999999999999.99"):
        raise ValueError(
            f"Dòng {row_number}: tổng tiền của nhân viên {employee_code} vượt giới hạn lưu công nợ."
        )
    return float(normalized_amount)


@router.get("/template")
def download_template():
    from openpyxl import Workbook
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["sku", "quantity"])
    sheet.append(["SKU-001", 10])
    output = BytesIO()
    workbook.save(output)
    output.seek(0)
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=delivery-request-template.xlsx"},
    )


def _error(db, exc):
    db.rollback()
    raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/", response_model=List[DeliveryRequestList])
def list_requests(status: str | None = None, db: Session = Depends(get_db)):
    """Lightweight list endpoint for queue/admin UI — omits item allocations.

    Uses DeliveryRequestList schema (no allocations) so the response is small
    and serialization is fast even for requests with 100+ SKUs.
    """
    return crud.list_(db, status)


@router.post("/", response_model=DeliveryRequest, status_code=201)
def create_request(
    payload: DeliveryRequestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        return crud.create(
            db, payload,
            created_by=getattr(current_user, "username", None) or payload.created_by,
        )
    except ValueError as exc:
        return _error(db, exc)


@router.post("/plan", response_model=List[FefoPlanItem])
def plan_request(payload: DeliveryRequestCreate, db: Session = Depends(get_db)):
    try:
        return crud.plan(db, payload)
    except ValueError as exc:
        return _error(db, exc)


@router.post("/upload", response_model=DeliveryPreviewResponse)
def upload_request(warehouse_id: int, file: UploadFile = File(...), note: str | None = None,
                   db: Session = Depends(get_db)):
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="Vui lòng tải lên file Excel .xlsx hoặc .xlsm.")
    try:
        workbook = load_workbook(BytesIO(file.file.read()), read_only=True, data_only=True)
        rows = list(workbook.worksheets[0].iter_rows(values_only=True))
        if not rows:
            raise ValueError("File Excel không có dữ liệu.")
        from app.models.product import Product
        products = {p.sku.upper(): p for p in db.query(Product).all()}
        items = []
        employee_summaries = []
        warnings = []

        # Delivery workbook: rows 1-8 are descriptive, row 9 is the header,
        # row 10 contains employee codes, and data starts at row 11.
        first = [str(v).strip().lower() if v is not None else "" for v in rows[0]]
        code_header = str(rows[8][1] if len(rows[8]) > 1 else "").strip().lower()
        quantity_header = str(rows[8][3] if len(rows[8]) > 3 else "").strip().lower()
        delivery_format = len(rows) >= 10 and (
            code_header in {"sku", "mã sku", "ma sku", "mã hàng", "ma hang"}
            or "số lượng tổng" in quantity_header
            or "tong xuat" in quantity_header
        )
        if delivery_format:
            raw_emp_row = rows[9] if len(rows) > 9 else ()
            employee_cols = {}
            for col in range(4, len(raw_emp_row)):
                cell_val = raw_emp_row[col]
                if cell_val:
                    raw_str = str(cell_val).strip()
                    code = raw_str[:5].strip().upper()
                    if not code:
                        raise ValueError(f"Cột nhân viên {col + 1} không có mã nhân viên.")
                    if any(existing["code"] == code for existing in employee_cols.values()):
                        raise ValueError(f"Mã nhân viên {code} xuất hiện nhiều lần trong file.")
                    name = raw_str.split("(", 1)[1].split(")", 1)[0].strip() if "(" in raw_str and ")" in raw_str else ""
                    employee_cols[col] = {"code": code, "raw": raw_str, "name": name}

            weights = {}
            order_counts = {}
            amounts = {}
            amount_row_found = False

            for number, values in enumerate(rows[10:], 11):
                if not any(v is not None and str(v).strip() for v in values):
                    continue
                raw_sku = values[1] if len(values) > 1 else None
                sku = str(raw_sku).strip().upper() if raw_sku is not None else ""

                # Check for footer/summary rows: TỔNG CỘNG (tấn), TỔNG ĐƠN HÀNG (đơn), TỔNG CỘNG (ngàn đồng)
                col_b = str(values[1]).strip().lower() if len(values) > 1 and values[1] is not None else ""
                col_c = str(values[2]).strip().lower() if len(values) > 2 and values[2] is not None else ""
                combined_footer = f"{col_b} {col_c}".strip()
                if "tấn" in combined_footer or "(tấn)" in combined_footer:
                    for col, emp in employee_cols.items():
                        if col < len(values) and values[col] is not None:
                            try:
                                weights[emp["code"]] = float(values[col])
                            except Exception:
                                pass
                    continue
                elif "đơn" in combined_footer or "(đơn)" in combined_footer:
                    for col, emp in employee_cols.items():
                        if col < len(values) and values[col] is not None:
                            try:
                                order_counts[emp["code"]] = int(round(float(values[col])))
                            except Exception:
                                pass
                    continue
                elif "ngàn đồng" in combined_footer or "ngan dong" in combined_footer:
                    if amount_row_found:
                        raise ValueError(f"Dòng {number}: file có nhiều dòng tổng tiền công nợ.")
                    amount_row_found = True
                    for col, emp in employee_cols.items():
                        amounts[emp["code"]] = _employee_amount(
                            values[col] if col < len(values) else None,
                            emp["code"],
                            number,
                        )
                    continue

                if not sku:
                    continue

                quantity_cells = values[3:] if len(values) > 3 else ()
                if not any(_looks_like_quantity(value) for value in quantity_cells):
                    continue
                product = products.get(sku)
                raw_total = str(values[3] if len(values) > 3 else "").strip()
                if not raw_total:
                    raise ValueError(f"Dòng {number}: tổng số lượng không được để trống.")
                per_carton = max(1, product.boxes_per_carton or 1) if product else 1
                total, _, _, _ = _quantity(raw_total, per_carton)
                if total < 1:
                    raise ValueError(f"Dòng {number}: tổng số lượng phải lớn hơn 0.")
                allocations = {}
                for column in range(4, len(values)):
                    emp_info = employee_cols.get(column)
                    if not emp_info or values[column] in (None, ""):
                        continue
                    raw_employee = str(values[column]).strip()
                    if raw_employee:
                        employee_quantity, employee_cartons, employee_boxes, _ = _quantity(raw_employee, per_carton)
                        allocations[emp_info["code"]] = {
                            "quantity": employee_quantity,
                            "cartons": employee_cartons,
                            "boxes": employee_boxes,
                            "raw": raw_employee,
                        }
                items.append({"product_id": product.id if product else 0, "sku": sku,
                              "product_name": product.name if product else "Chưa đăng ký",
                              "quantity": total,
                              "requested_quantity_raw": raw_total,
                              "employee_allocations": allocations or None})

            if employee_cols and not amount_row_found:
                raise ValueError("File thiếu dòng tổng tiền công nợ theo nhân viên (ngàn đồng).")

            emp_by_code = {e.code.upper(): e for e in db.query(Employee).all()}
            for col, emp in employee_cols.items():
                code = emp["code"]
                db_emp = emp_by_code.get(code)
                amt = amounts.get(code, 0.0)
                w_ton = weights.get(code, 0.0)
                o_cnt = order_counts.get(code, 0)
                if not db_emp:
                    raise ValueError(f"Không tìm thấy nhân viên {code} ({emp['name']}) trong hệ thống.")
                debt_limit = float(db_emp.debt_limit or 50000000.0)
                curr_debt = float(db.scalar(
                    select(func.coalesce(func.sum(DebtLedgerEntry.amount), 0))
                    .where(DebtLedgerEntry.party_type == "EMPLOYEE", DebtLedgerEntry.party_id == db_emp.id)
                ) or 0.0)

                proj_debt = curr_debt + amt
                is_over = proj_debt > debt_limit
                if is_over:
                    warnings.append(
                        f"Cảnh báo: Nhân viên {code} ({db_emp.name}) có dự kiến nợ "
                        f"{proj_debt:,.0f}đ vượt hạn mức {debt_limit:,.0f}đ."
                    )
                employee_summaries.append({
                    "employee_id": db_emp.id,
                    "employee_code": code,
                    "employee_name": db_emp.name,
                    "column_key": f"Col {col}",
                    "weight_ton": w_ton,
                    "order_count": o_cnt,
                    "amount": amt,
                    "debt_limit": debt_limit,
                    "current_debt": curr_debt,
                    "projected_debt": proj_debt,
                    "is_over_limit": is_over,
                })
        else:
            headers = first
            product_column = "sku" if "sku" in headers else "product_code"
            if product_column not in headers or "quantity" not in headers:
                raise ValueError("File phải có cột sku (hoặc product_code) và quantity.")
            for number, values in enumerate(rows[1:], 2):
                if not any(v is not None and str(v).strip() for v in values):
                    continue
                data = dict(zip(headers, values))
                sku = str(data.get(product_column) or "").strip().upper()
                product = products.get(sku)
                if not product:
                    raise ValueError(f"Dòng {number}: không tìm thấy SKU {sku}.")
                quantity, _, _, _ = _quantity(data.get("quantity"), max(1, product.boxes_per_carton or 1))
                if quantity < 1:
                    raise ValueError(f"Dòng {number}: quantity phải lớn hơn 0.")
                items.append({"product_id": product.id, "quantity": quantity})
        preview = []
        for item in items:
            product = db.get(Product, item["product_id"]) if item["product_id"] else None
            preview.append(DeliveryPreviewItem(
                product_id=product.id if product else 0,
                sku=product.sku if product else item["sku"],
                product_name=product.name if product else item["product_name"],
                quantity=item["quantity"], requested_quantity_raw=item.get("requested_quantity_raw"),
                available_quantity=0,
                shortage_quantity=0,
                employee_allocations=item.get("employee_allocations"),
            ))
        return DeliveryPreviewResponse(
            items=preview,
            employee_summaries=employee_summaries,
            warnings=warnings,
        )
    except HTTPException:
        db.rollback()
        raise
    except (ValueError, TypeError, InvalidFileException, BadZipFile, OSError) as exc:
        return _error(db, exc)


@router.get("/{request_id}", response_model=DeliveryRequest)
def get_request(request_id: int, db: Session = Depends(get_db)):
    result = crud.get(db, request_id)
    if not result:
        raise HTTPException(status_code=404, detail="Không tìm thấy yêu cầu xuất kho.")
    return result


@router.put("/{request_id}", response_model=DeliveryRequest)
def update_request(request_id: int, payload: DeliveryRequestCreate, db: Session = Depends(get_db)):
    try:
        return crud.update(db, request_id, payload)
    except ValueError as exc:
        return _error(db, exc)


@router.delete("/{request_id}", status_code=204)
def delete_request(request_id: int, db: Session = Depends(get_db)):
    try:
        crud.delete(db, request_id)
        return None
    except ValueError as exc:
        return _error(db, exc)


@router.post("/{request_id}/submit", response_model=DeliveryRequest)
def submit_request(request_id: int, db: Session = Depends(get_db)):
    try:
        return crud.transition(db, request_id, "submit")
    except ValueError as exc:
        return _error(db, exc)


@router.post("/{request_id}/receive", response_model=DeliveryRequest)
def receive_request(request_id: int, db: Session = Depends(get_db)):
    try:
        return crud.transition(db, request_id, "receive")
    except ValueError as exc:
        return _error(db, exc)


@router.post("/{request_id}/complete", response_model=DeliveryRequest)
def complete_request(request_id: int, db: Session = Depends(get_db)):
    try:
        return crud.transition(db, request_id, "complete")
    except ValueError as exc:
        return _error(db, exc)


@router.post("/{request_id}/cancel", response_model=DeliveryRequest)
def cancel_request(request_id: int, db: Session = Depends(get_db)):
    try:
        return crud.transition(db, request_id, "cancel")
    except ValueError as exc:
        return _error(db, exc)

from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from io import BytesIO
import re
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
from app.models.inventory import DeliveryRequest as DeliveryRequestModel, DeliveryRequestEmployeeSummary, DeliveryRequestOrder as DeliveryRequestOrderModel
from app.models.user import User
from app.schemas.delivery_request import (
    DeliveryRequest, DeliveryRequestList, DeliveryRequestCreate, DeliveryPreviewItem,
    DeliveryPreviewResponse, FefoPlanItem, DeliveryRequestOrder,
    DeliveryRequestOrderCreate, SettlementOrderPayRequest,
    SettlementMatchStatementRequest, SettlementMatchStatementResponse,
    DeliverySettlementOverview, DailyEmployeeSettlement, BankStatementItem,
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
                debt_limit = float(
                    db_emp.debt_limit if db_emp.debt_limit is not None else 500000000.0
                )
                curr_debt = float(db.scalar(
                    select(func.coalesce(func.sum(DebtLedgerEntry.amount), 0))
                    .where(DebtLedgerEntry.party_type == "EMPLOYEE", DebtLedgerEntry.party_id == db_emp.id)
                ) or 0.0)
                pending_debt = float(db.scalar(
                    select(func.coalesce(func.sum(DeliveryRequestEmployeeSummary.amount), 0))
                    .join(DeliveryRequestModel, DeliveryRequestModel.id == DeliveryRequestEmployeeSummary.delivery_request_id)
                    .where(
                        DeliveryRequestEmployeeSummary.employee_id == db_emp.id,
                        DeliveryRequestModel.status.in_(("SUBMITTED", "RECEIVED")),
                    )
                ) or 0.0)

                proj_debt = curr_debt + pending_debt + amt
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
                    "pending_debt": pending_debt,
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
            bpc = max(1, product.boxes_per_carton or 1) if product else (item.get("boxes_per_carton") or 1)
            qty = item["quantity"]
            preview.append(DeliveryPreviewItem(
                product_id=product.id if product else 0,
                sku=product.sku if product else item["sku"],
                product_name=product.name if product else item["product_name"],
                quantity=qty,
                boxes_per_carton=bpc,
                cartons=qty // bpc,
                loose_boxes=qty % bpc,
                requested_quantity_raw=item.get("requested_quantity_raw"),
                available_quantity=0,
                shortage_quantity=0,
                employee_allocations=item.get("employee_allocations"),
            ))

        orders = []
        if len(workbook.worksheets) > 1:
            ws2 = workbook.worksheets[1]
            rows2 = list(ws2.iter_rows(values_only=True))
            order_header_row_idx = None
            for idx, r in enumerate(rows2[:15]):
                r_str = " ".join([str(v).lower() for v in r if v is not None])
                if "số đơn hàng" in r_str or "so don hang" in r_str or "ngày đơn hàng" in r_str:
                    order_header_row_idx = idx
                    break

            if order_header_row_idx is not None:
                parsed_order_rows = []
                order_numbers = []
                emp_by_code = {e.code.upper(): e for e in db.query(Employee).all()}

                for r in rows2[order_header_row_idx + 1:]:
                    if not r or not any(v is not None for v in r):
                        continue
                    order_num = str(r[1]).strip() if len(r) > 1 and r[1] is not None else ""
                    if not order_num:
                        continue

                    raw_date = r[0] if len(r) > 0 else None
                    order_date = None
                    if raw_date:
                        if hasattr(raw_date, "date"):
                            order_date = raw_date.date()
                        elif isinstance(raw_date, str):
                            try:
                                order_date = datetime.strptime(raw_date.strip(), "%d/%m/%Y").date()
                            except Exception:
                                try:
                                    order_date = datetime.strptime(raw_date.strip(), "%Y-%m-%d").date()
                                except Exception:
                                    pass

                    emp_code = str(r[2]).strip().upper() if len(r) > 2 and r[2] is not None else ""
                    emp_name = str(r[3]).strip() if len(r) > 3 and r[3] is not None else ""
                    cust_code = str(r[4]).strip() if len(r) > 4 and r[4] is not None else ""
                    cust_name = str(r[5]).strip() if len(r) > 5 and r[5] is not None else ""

                    parsed_order_rows.append({
                        "order_date": order_date,
                        "order_number": order_num,
                        "employee_code": emp_code,
                        "employee_name": emp_name,
                        "customer_code": cust_code,
                        "customer_name": cust_name,
                    })
                    order_numbers.append(order_num)

                from app.models import VinamilkOrderSnapshot
                snaps = db.scalars(
                    select(VinamilkOrderSnapshot).where(VinamilkOrderSnapshot.order_number.in_(order_numbers))
                ).all()

                snap_totals = {}
                for s in snaps:
                    val = s.raw_payload.get("Giá trị") if s.raw_payload else None
                    if val:
                        try:
                            amt = float(str(val).replace(",", "").strip())
                            snap_totals[s.order_number] = snap_totals.get(s.order_number, 0.0) + amt
                        except Exception:
                            pass

                for row_data in parsed_order_rows:
                    num = row_data["order_number"]
                    calculated_amt = snap_totals.get(num, 0.0)
                    emp_obj = emp_by_code.get(row_data["employee_code"])
                    orders.append(DeliveryRequestOrderCreate(
                        order_date=row_data["order_date"],
                        order_number=num,
                        employee_id=emp_obj.id if emp_obj else None,
                        employee_code=row_data["employee_code"],
                        employee_name=row_data["employee_name"] or (emp_obj.name if emp_obj else None),
                        customer_code=row_data["customer_code"],
                        customer_name=row_data["customer_name"],
                        amount=round(calculated_amt, 2),
                        payment_status="UNPAID",
                        payment_method="UNKNOWN",
                    ))

        total_cartons = sum(p.cartons for p in preview)
        total_loose_boxes = sum(p.loose_boxes for p in preview)
        total_quantity = sum(p.quantity for p in preview)

        return DeliveryPreviewResponse(
            items=preview,
            employee_summaries=employee_summaries,
            orders=orders,
            warnings=warnings,
            total_cartons=total_cartons,
            total_loose_boxes=total_loose_boxes,
            total_quantity=total_quantity,
        )
    except HTTPException:
        db.rollback()
        raise
    except (ValueError, TypeError, InvalidFileException, BadZipFile, OSError) as exc:
        return _error(db, exc)


@router.get("/daily-settlements", response_model=List[DailyEmployeeSettlement])
def list_daily_settlements(
    from_date: date,
    to_date: date,
    warehouse_id: int | None = None,
    db: Session = Depends(get_db),
):
    try:
        return crud.list_daily_settlements(
            db,
            from_date=from_date,
            to_date=to_date,
            warehouse_id=warehouse_id,
        )
    except ValueError as exc:
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


@router.get("/{request_id}/settlement", response_model=DeliverySettlementOverview)
def get_settlement(request_id: int, db: Session = Depends(get_db)):
    try:
        return crud.get_settlement(db, request_id)
    except ValueError as exc:
        return _error(db, exc)


@router.post("/{request_id}/settlement/orders/{order_id}/pay", response_model=DeliveryRequestOrder)
def pay_settlement_order(
    request_id: int,
    order_id: int,
    payload: SettlementOrderPayRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        return crud.settle_order_pay(
            db,
            request_id=request_id,
            order_id=order_id,
            payment_method=payload.payment_method,
            paid_amount=payload.paid_amount,
            bank_ref=payload.bank_ref,
            note=payload.note,
            created_by=getattr(current_user, "username", None),
        )
    except ValueError as exc:
        return _error(db, exc)


@router.post("/{request_id}/settlement/match-statement", response_model=SettlementMatchStatementResponse)
def match_bank_statement(
    request_id: int,
    payload: SettlementMatchStatementRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        return crud.match_statements(
            db,
            request_id=request_id,
            statements=payload.statements,
            auto_confirm=payload.auto_confirm,
            created_by=getattr(current_user, "username", None),
        )
    except ValueError as exc:
        return _error(db, exc)


@router.post("/{request_id}/settlement/upload-statement", response_model=SettlementMatchStatementResponse)
def upload_bank_statement(
    request_id: int,
    file: UploadFile = File(...),
    auto_confirm: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload an Excel/CSV bank statement and automatically match against orders."""
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm", ".csv")):
        raise HTTPException(status_code=400, detail="Vui lòng tải lên file Excel hoặc CSV sao kê.")
    try:
        content = file.file.read()
        statement_items = []
        if file.filename.lower().endswith(".csv"):
            import csv
            reader = csv.reader(content.decode("utf-8-sig", errors="ignore").splitlines())
            rows = list(reader)
        else:
            wb = load_workbook(BytesIO(content), read_only=True, data_only=True)
            rows = list(wb.worksheets[0].iter_rows(values_only=True))

        if not rows:
            raise ValueError("File sao kê không có dữ liệu.")

        header_idx = 0
        for idx, r in enumerate(rows[:10]):
            r_str = " ".join([str(v).lower() for v in r if v is not None])
            if any(k in r_str for k in ["số tiền", "so tien", "credit", "có", "phát sinh có", "diễn giải", "dien giai", "nội dung"]):
                header_idx = idx
                break

        header = [str(c).strip().lower() if c is not None else "" for c in rows[header_idx]]
        desc_col = None
        amt_col = None
        ref_col = None

        for c_idx, col_name in enumerate(header):
            if any(k in col_name for k in ["nội dung", "noi dung", "diễn giải", "dien giai", "description", "chi tiết"]):
                desc_col = c_idx
            elif any(k in col_name for k in ["số tiền", "so tien", "credit", "có", "tiền vào", "amount"]):
                amt_col = c_idx
            elif any(k in col_name for k in ["mã gd", "ma gd", "ref", "so gd", "số gd", "ft"]):
                ref_col = c_idx

        if desc_col is None or amt_col is None:
            desc_col = desc_col if desc_col is not None else (1 if len(header) > 1 else 0)
            amt_col = amt_col if amt_col is not None else (2 if len(header) > 2 else 1)

        for r in rows[header_idx + 1:]:
            if not r or not any(v is not None for v in r):
                continue
            desc_val = str(r[desc_col]).strip() if desc_col < len(r) and r[desc_col] is not None else ""
            amt_val = r[amt_col] if amt_col < len(r) else None
            ref_val = str(r[ref_col]).strip() if ref_col is not None and ref_col < len(r) and r[ref_col] is not None else None

            if not desc_val or amt_val is None:
                continue

            try:
                amt_num = float(str(amt_val).replace(",", "").replace(".", "").strip()) if isinstance(amt_val, str) else float(amt_val)
            except Exception:
                continue

            if amt_num <= 0:
                continue

            statement_items.append(BankStatementItem(
                ref_number=ref_val,
                amount=amt_num,
                description=desc_val,
            ))

        return crud.match_statements(
            db,
            request_id=request_id,
            statements=statement_items,
            auto_confirm=auto_confirm,
            created_by=getattr(current_user, "username", None),
        )
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        return _error(db, exc)


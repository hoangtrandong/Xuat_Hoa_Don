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


def _parse_orders_from_excel(content: bytes, db: Session) -> list[dict]:
    wb = load_workbook(BytesIO(content), read_only=True, data_only=True)
    target_ws = None
    for ws in wb.worksheets:
        name_clean = re.sub(r"\s+", "", ws.title.lower())
        if any(k in name_clean for k in ["dsdonhang", "danhsachdonhang", "orders", "donhang"]):
            target_ws = ws
            break
    if target_ws is None:
        target_ws = wb.worksheets[1] if len(wb.worksheets) > 1 else wb.worksheets[0]

    rows = list(target_ws.iter_rows(values_only=True))
    if not rows:
        return []

    header_idx = None
    order_num_col = None
    order_date_col = None
    emp_code_col = None
    emp_name_col = None
    cust_code_col = None
    cust_name_col = None
    amt_col = None

    for idx, r in enumerate(rows[:15]):
        row_strs = [str(v).lower() if v is not None else "" for v in r]
        for c_idx, cell in enumerate(row_strs):
            if any(k in cell for k in ["số đơn hàng", "so don hang", "order_number", "mã đơn hàng", "ma don hang", "mã đơn", "ma don"]):
                order_num_col = c_idx
                header_idx = idx
            elif any(k in cell for k in ["ngày đơn hàng", "ngay don hang", "ngày đơn", "ngay don", "order_date", "ngày", "ngay", "date"]):
                if order_date_col is None:
                    order_date_col = c_idx
            elif any(k in cell for k in ["mã nvgh", "ma nvgh", "mã nv", "ma nv", "manv", "emp_code"]):
                emp_code_col = c_idx
            elif any(k in cell for k in ["tên nvgh", "ten nvgh", "tên nv", "ten nv", "tennv", "emp_name"]):
                emp_name_col = c_idx
            elif any(k in cell for k in ["mã khách hàng", "ma khach hang", "mã kh", "ma kh", "makh", "cust_code", "customer_code"]):
                cust_code_col = c_idx
            elif any(k in cell for k in ["tên khách hàng", "ten khach hang", "tên kh", "ten kh", "tenkh", "cust_name", "customer_name"]):
                cust_name_col = c_idx
            elif any(k in cell for k in ["tiền", "tien", "giá trị", "gia tri", "thành tiền", "thanh tien", "amount"]):
                if amt_col is None:
                    amt_col = c_idx

    if header_idx is None or order_num_col is None:
        return []

    parsed_orders = []
    order_numbers = []

    for r in rows[header_idx + 1:]:
        if not r or not any(v is not None for v in r):
            continue
        order_num = str(r[order_num_col]).strip() if order_num_col < len(r) and r[order_num_col] is not None else ""
        if not order_num:
            continue

        raw_date = r[order_date_col] if order_date_col is not None and order_date_col < len(r) else None
        order_date = None
        if raw_date:
            if hasattr(raw_date, "date"):
                order_date = raw_date.date()
            elif isinstance(raw_date, str):
                for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
                    try:
                        order_date = datetime.strptime(raw_date.strip(), fmt).date()
                        break
                    except Exception:
                        pass

        emp_code = str(r[emp_code_col]).strip().upper() if emp_code_col is not None and emp_code_col < len(r) and r[emp_code_col] is not None else ""
        emp_name = str(r[emp_name_col]).strip() if emp_name_col is not None and emp_name_col < len(r) and r[emp_name_col] is not None else ""
        cust_code = str(r[cust_code_col]).strip() if cust_code_col is not None and cust_code_col < len(r) and r[cust_code_col] is not None else ""
        cust_name = str(r[cust_name_col]).strip() if cust_name_col is not None and cust_name_col < len(r) and r[cust_name_col] is not None else ""

        amt = 0.0
        if amt_col is not None and amt_col < len(r) and r[amt_col] is not None:
            try:
                amt = float(str(r[amt_col]).replace(",", "").strip())
            except Exception:
                amt = 0.0

        parsed_orders.append({
            "order_date": order_date,
            "order_number": order_num,
            "employee_code": emp_code,
            "employee_name": emp_name,
            "customer_code": cust_code,
            "customer_name": cust_name,
            "amount": amt,
        })
        order_numbers.append(order_num)

    orders_needing_amount = [o["order_number"] for o in parsed_orders if not o["amount"]]
    if orders_needing_amount:
        from app.models import VinamilkOrderSnapshot
        snaps = db.scalars(
            select(VinamilkOrderSnapshot).where(VinamilkOrderSnapshot.order_number.in_(orders_needing_amount))
        ).all()
        snap_totals: dict[str, float] = {}
        for s in snaps:
            val = s.raw_payload.get("Giá trị") if s.raw_payload else None
            if val:
                try:
                    v_float = float(str(val).replace(",", "").strip())
                    snap_totals[s.order_number] = snap_totals.get(s.order_number, 0.0) + v_float
                except Exception:
                    pass
        for o in parsed_orders:
            if not o["amount"]:
                o["amount"] = round(snap_totals.get(o["order_number"], 0.0), 2)

    return parsed_orders


@router.post("/upload", response_model=DeliveryPreviewResponse)
def upload_request(warehouse_id: int, file: UploadFile = File(...), note: str | None = None,
                   db: Session = Depends(get_db)):
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="Vui lòng tải lên file Excel .xlsx hoặc .xlsm.")
    try:
        file_bytes = file.file.read()
        workbook = load_workbook(BytesIO(file_bytes), read_only=True, data_only=True)
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
        parsed_order_rows = _parse_orders_from_excel(file_bytes, db)
        if parsed_order_rows:
            col_to_nv_map = {
                "MG07730": "NV001",
                "MG09637": "NV002",
                "MG12028": "NV003",
                "MG120281": "NV004",
                "MG12885": "NV005",
                "MG2003": "NV006",
                "MG200312": "NV007",
            }
            summaries_are_nv_sequential = any(
                s.get("employee_code") in ("NV001", "NV002", "NV003", "NV004", "NV005", "NV006", "NV007")
                for s in employee_summaries
            )
            emp_by_code = {e.code.upper(): e for e in db.query(Employee).all()}
            emp_by_name = {e.name.strip().lower(): e for e in db.query(Employee).all() if e.name}
            summary_by_code = {s.get("employee_code", "").upper(): s for s in employee_summaries}

            for row_data in parsed_order_rows:
                emp_code = (row_data.get("employee_code") or "").strip().upper()
                emp_name = (row_data.get("employee_name") or "").strip()

                target_emp_id = None
                target_emp_code = emp_code
                target_emp_name = emp_name

                if summaries_are_nv_sequential and emp_code in col_to_nv_map:
                    mapped_code = col_to_nv_map[emp_code]
                    sum_obj = summary_by_code.get(mapped_code)
                    if sum_obj:
                        target_emp_id = sum_obj.get("employee_id")
                        target_emp_code = sum_obj.get("employee_code")
                        target_emp_name = sum_obj.get("employee_name") or emp_name

                if target_emp_id is None:
                    emp_obj = emp_by_code.get(emp_code)
                    if not emp_obj and emp_name:
                        emp_obj = emp_by_name.get(emp_name.lower())
                    if not emp_obj and emp_code in summary_by_code:
                        sum_obj = summary_by_code[emp_code]
                        target_emp_id = sum_obj.get("employee_id")
                        target_emp_code = sum_obj.get("employee_code")
                        target_emp_name = sum_obj.get("employee_name") or emp_name

                    if emp_obj:
                        target_emp_id = emp_obj.id
                        target_emp_code = emp_obj.code
                        target_emp_name = emp_obj.name

                orders.append(DeliveryRequestOrderCreate(
                    order_date=row_data.get("order_date"),
                    order_number=row_data["order_number"],
                    employee_id=target_emp_id,
                    employee_code=target_emp_code,
                    employee_name=target_emp_name,
                    customer_code=row_data.get("customer_code"),
                    customer_name=row_data.get("customer_name"),
                    amount=row_data.get("amount", 0.0),
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


@router.post("/{request_id}/settlement/import-orders-excel", response_model=DeliverySettlementOverview)
def import_settlement_orders_excel(
    request_id: int,
    file: UploadFile = File(...),
    replace_existing: bool = True,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Import orders from an Excel file (BCTHGH or generic order list) into a delivery trip settlement."""
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="Vui lòng tải lên file Excel .xlsx hoặc .xlsm.")
    try:
        content = file.file.read()
        orders_data = _parse_orders_from_excel(content, db)
        if not orders_data:
            raise ValueError("Không tìm thấy dòng đơn hàng nào trong file Excel.")
        return crud.import_orders_for_request(
            db,
            request_id=request_id,
            orders_data=orders_data,
            replace_existing=replace_existing,
        )
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        return _error(db, exc)


@router.post("/{request_id}/settlement/import-orders", response_model=DeliverySettlementOverview)
def import_settlement_orders(
    request_id: int,
    payload: List[DeliveryRequestOrderCreate],
    replace_existing: bool = True,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Import orders from JSON payload into a delivery trip settlement."""
    try:
        orders_data = [o.model_dump() for o in payload]
        return crud.import_orders_for_request(
            db,
            request_id=request_id,
            orders_data=orders_data,
            replace_existing=replace_existing,
        )
    except Exception as exc:
        return _error(db, exc)


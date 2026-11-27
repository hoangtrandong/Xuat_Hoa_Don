from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from io import BytesIO
import hashlib
import json
import re
import unicodedata
from collections import defaultdict
from typing import Any, List
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from openpyxl import load_workbook
from openpyxl.utils.exceptions import InvalidFileException
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload, selectinload
from zipfile import BadZipFile

from app.core.database import get_db
from app.core.auth import get_current_user
from app.crud import delivery_request as crud
from app.models.employee import Employee
from app.models.finance import DebtLedgerEntry
from app.models.inventory import DeliveryRequest as DeliveryRequestModel, DeliveryRequestEmployeeSummary, DeliveryRequestOrder as DeliveryRequestOrderModel, Warehouse
from app.models.product import Product
from app.models.sales import SalesOrder, SalesOrderItem
from app.models.vinamilk import VinamilkOrderSnapshot
from app.models.user import User
from app.crud import employee_borrow as borrow_crud
from app.crud.npp import canonical_product_id
from app.schemas.delivery_request import (
    DeliveryRequest, DeliveryRequestList, DeliveryRequestCreate, DeliveryRequestItemCreate,
    DeliveryRequestEmployeeSummaryCreate, DeliveryPreviewItem,
    DeliveryPreviewResponse, FefoPlanItem, DeliveryRequestOrder,
    DeliveryRequestOrderCreate, SettlementOrderPayRequest,
    SettlementMatchStatementRequest, SettlementMatchStatementResponse,
    DeliverySettlementOverview, DailyEmployeeSettlement, BankStatementItem,
    EmployeeBorrowBatchCreate,
    DispatchPoolOrder, DispatchPoolOrderItem, DeliveryRequestFromOrdersCreate,
)

router = APIRouter(prefix="/delivery-requests", tags=["delivery-requests"])
borrow_router = APIRouter(prefix="/employee-borrowing", tags=["employee-borrowing"])


def _is_admin_user(user: User) -> bool:
    username = (getattr(user, "username", None) or "").strip().lower()
    if username == "admin":
        return True
    return any(
        (getattr(role, "name", None) or "").strip().lower() == "admin"
        for role in (getattr(user, "roles", None) or [])
    )


def _require_admin(user: User) -> None:
    if not _is_admin_user(user):
        raise HTTPException(status_code=403, detail="Chỉ Admin mới được duyệt yêu cầu xuất kho.")



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


def _borrow_employee_code(value: Any) -> str:
    return str(value).split("(", 1)[0].strip().upper()


def _normalized_label(value: Any) -> str:
    text = unicodedata.normalize("NFD", str(value or "").strip().casefold())
    return "".join(char for char in text if unicodedata.category(char) != "Mn").replace("đ", "d")


def _numeric_value(value: Any) -> Decimal:
    if value in (None, ""):
        return Decimal("0")
    try:
        result = Decimal(str(value).replace(",", "").strip())
    except InvalidOperation as exc:
        raise ValueError(f"Giá trị số không hợp lệ: {value}") from exc
    if not result.is_finite():
        raise ValueError(f"Giá trị số không hợp lệ: {value}")
    return result


def _date_value(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if not value:
        return None
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(str(value).strip(), fmt).date()
        except ValueError:
            continue
    raise ValueError(f"Ngày đơn hàng không hợp lệ: {value}")


def _new_workbook_sheets(workbook):
    normalized = {
        _normalized_label(re.sub(r"\s+", "", sheet.title)): sheet
        for sheet in workbook.worksheets
    }
    return next(
        (sheet for name, sheet in normalized.items() if name in {"dsdonhang", "danhsachdonhang"}),
        None,
    )


def _read_new_workbook_order_rows(workbook):
    orders_sheet = _new_workbook_sheets(workbook)
    if not orders_sheet:
        return None

    orders_rows = list(orders_sheet.iter_rows(values_only=True))
    header_index = next(
        (
            index for index, row in enumerate(orders_rows[:15])
            if any(_normalized_label(cell) in {"so don hang", "ma don hang"} for cell in row if cell is not None)
        ),
        None,
    )
    if header_index is None:
        raise ValueError("Không tìm thấy tiêu đề cột trong sheet DSDonHang.")
    headers = [_normalized_label(cell) for cell in orders_rows[header_index]]
    aliases = {
        "order_number": {"so don hang", "ma don hang"},
        "order_date": {"ngay don hang", "ngay don", "ngay"},
        "employee_code": {"ma nvgh", "ma nv"},
        "employee_name": {"ten nvgh", "ten nv"},
        "customer_code": {"ma khach hang", "ma kh"},
        "customer_name": {"ten khach hang", "ten kh"},
        "status": {"trang thai"},
    }
    columns = {
        key: next((index for index, header in enumerate(headers) if header in values), None)
        for key, values in aliases.items()
    }
    missing_columns = [key for key, index in columns.items() if index is None]
    if missing_columns:
        raise ValueError("Sheet DSDonHang thiếu các cột bắt buộc: " + ", ".join(missing_columns))

    orders = []
    seen_orders = set()
    for row_number, row in enumerate(orders_rows[header_index + 1:], header_index + 2):
        order_number = str(row[columns["order_number"]] or "").strip()
        if not order_number:
            continue
        key = order_number.casefold()
        if key in seen_orders:
            raise ValueError(f"Dòng {row_number}: số đơn {order_number} xuất hiện nhiều lần.")
        seen_orders.add(key)
        status_text = str(row[columns["status"]] or "").strip()
        status_key = _normalized_label(status_text)
        coded_statuses = {
            "001": "Xuất Hàng",
            "002": "Mượn Số",
            "003": "Trả Số",
        }
        legacy_statuses = {
            "xuat hang": "Xuất Hàng",
            "gui so": "Gửi Số",
            "muon so": "Mượn Số",
            "tra so": "Trả Số",
        }
        status = coded_statuses.get(status_text[:3]) or legacy_statuses.get(status_key)
        if not status:
            raise ValueError(f"Dòng {row_number}: trạng thái '{status_text}' không được hỗ trợ.")
        orders.append({
            "order_number": order_number,
            "order_date": _date_value(row[columns["order_date"]]),
            "employee_code": str(row[columns["employee_code"]] or "").strip().upper(),
            "employee_name": str(row[columns["employee_name"]] or "").strip(),
            "customer_code": str(row[columns["customer_code"]] or "").strip(),
            "customer_name": str(row[columns["customer_name"]] or "").strip(),
            "status": status,
            "row_number": row_number,
        })

    return orders


def _is_sales_employee(employee: Employee) -> bool:
    position = _normalized_label(employee.position)
    return (
        position.startswith("nvkd ")
        or position in {"sales", "ban hang", "nhan vien kinh doanh", "nhan vien ban hang"}
    )


def _resolve_employee(db: Session, code: str, name: str, row_number: int, role: str) -> Employee | None:
    def role_matches(employees: list[Employee]) -> list[Employee]:
        if role == "NVBH":
            return [employee for employee in employees if _is_sales_employee(employee)]
        return employees

    if code:
        matches = role_matches(db.scalars(
            select(Employee).where(func.upper(Employee.code) == code.upper())
        ).all())
        if len(matches) == 1:
            return matches[0]
        if len(matches) > 1:
            raise ValueError(f"Dòng {row_number}: mã {role} {code} trùng trong danh sách nhân viên.")
        matches = role_matches(db.scalars(
            select(Employee).where(func.upper(Employee.vinamilk_code) == code.upper())
        ).all())
        if len(matches) == 1:
            return matches[0]
        if len(matches) > 1:
            raise ValueError(f"Dòng {row_number}: mã Vinamilk {role} {code} trùng trong danh sách nhân viên.")
    if name:
        matches = role_matches(db.scalars(
            select(Employee).where(func.lower(Employee.name) == name.casefold())
        ).all())
        if len(matches) == 1:
            return matches[0]
        if len(matches) > 1:
            raise ValueError(f"Dòng {row_number}: tên {role} {name} trùng trong danh sách nhân viên.")
    return None


def _line_quantity_and_amount(snapshot: VinamilkOrderSnapshot) -> tuple[int, Decimal]:
    payload = snapshot.raw_payload or {}
    quantity = _numeric_value(
        next((payload[key] for key in ("Số lượng", "quantity", "qty") if payload.get(key) not in (None, "")), 0)
    )
    promo_quantity = _numeric_value(
        next((payload[key] for key in ("Số lượng KM", "promotionQuantity", "freeQuantity") if payload.get(key) not in (None, "")), 0)
    )
    amount = _numeric_value(
        next((payload[key] for key in ("Giá trị", "totalValue", "amount") if payload.get(key) not in (None, "")), 0)
    )
    total_quantity = quantity + promo_quantity
    if total_quantity < 0 or total_quantity != total_quantity.to_integral_value():
        raise ValueError(f"Đơn {snapshot.order_number}, mã DMS {snapshot.product_code}: số lượng không nguyên hoặc âm.")
    return int(total_quantity), amount


def _preview_new_workbook(
    *,
    file_bytes: bytes,
    filename: str,
    warehouse_id: int,
    db: Session,
    send_order_mappings: dict[str, int] | None = None,
) -> DeliveryPreviewResponse | None:
    workbook = load_workbook(BytesIO(file_bytes), read_only=True, data_only=True)
    parsed = _read_new_workbook_order_rows(workbook)
    if parsed is None:
        return None
    order_rows = parsed
    if not order_rows:
        raise ValueError("Sheet DSDonHang không có đơn hàng.")
    if not db.get(Warehouse, warehouse_id):
        raise ValueError("Không tìm thấy kho.")
    amount_source = "DMS"
    send_order_mappings = send_order_mappings or {}

    active_orders = [
        row for row in order_rows
        if row["status"] in {"Xuất Hàng", "Mượn Số", "Trả Số"}
    ]
    send_orders = [row for row in order_rows if row["status"] == "Gửi Số"]
    export_order_numbers = [
        row["order_number"] for row in order_rows
        if row["status"] in {"Xuất Hàng", "Gửi Số", "Trả Số"}
    ]
    existing_order_numbers = set(db.scalars(
        select(DeliveryRequestOrderModel.order_number)
        .join(
            DeliveryRequestModel,
            DeliveryRequestModel.id == DeliveryRequestOrderModel.delivery_request_id,
        )
        .where(
            func.upper(DeliveryRequestOrderModel.order_number).in_(
                [number.upper() for number in export_order_numbers]
            ),
            DeliveryRequestModel.status != "CANCELLED",
        )
    ).all()) if export_order_numbers else set()
    dms_order_numbers = [row["order_number"] for row in active_orders]
    snapshots = db.scalars(
        select(VinamilkOrderSnapshot).where(
            func.upper(VinamilkOrderSnapshot.order_number).in_([number.upper() for number in dms_order_numbers])
        )
    ).all() if dms_order_numbers else []
    snapshots_by_order: dict[str, list[VinamilkOrderSnapshot]] = defaultdict(list)
    for snapshot in snapshots:
        if snapshot.order_number:
            snapshots_by_order[snapshot.order_number.casefold()].append(snapshot)

    send_codes = [row["order_number"] for row in send_orders]
    mapped_order_ids = list(send_order_mappings.values())
    sales_orders = db.scalars(
        select(SalesOrder)
        .options(
            joinedload(SalesOrder.customer),
            joinedload(SalesOrder.employee),
            selectinload(SalesOrder.items).joinedload(SalesOrderItem.product),
        )
        .where(
            func.upper(SalesOrder.code).in_([code.upper() for code in send_codes])
            if not mapped_order_ids
            else (
                func.upper(SalesOrder.code).in_([code.upper() for code in send_codes])
                | SalesOrder.id.in_(mapped_order_ids)
            )
        )
    ).all() if send_codes or mapped_order_ids else []
    sales_order_by_code = {order.code.casefold(): order for order in sales_orders}
    sales_order_by_id = {order.id: order for order in sales_orders}
    candidate_sales_orders = db.scalars(
        select(SalesOrder)
        .options(
            joinedload(SalesOrder.customer),
            selectinload(SalesOrder.items).joinedload(SalesOrderItem.product),
        )
        .where(SalesOrder.status != "CANCELLED")
        .order_by(SalesOrder.created_at.desc())
        .limit(2000)
    ).all() if send_orders else []
    send_order_candidates: dict[str, list[dict[str, Any]]] = {}
    for send_order in send_orders:
        mapped_order = sales_order_by_id.get(send_order_mappings.get(send_order["order_number"].casefold()))
        if send_order["order_number"].casefold() in sales_order_by_code or (
            mapped_order
            and mapped_order.customer
            and (
                (
                    send_order["customer_code"]
                    and mapped_order.customer.code.casefold() == send_order["customer_code"].casefold()
                )
                or (
                    send_order["customer_name"]
                    and _normalized_label(mapped_order.customer.name) == _normalized_label(send_order["customer_name"])
                )
            )
        ):
            continue
        candidates = [
            order for order in candidate_sales_orders
            if (
                send_order["customer_code"]
                and order.customer
                and order.customer.code.casefold() == send_order["customer_code"].casefold()
            )
            or (
                send_order["customer_name"]
                and order.customer
                and _normalized_label(order.customer.name) == _normalized_label(send_order["customer_name"])
            )
        ]
        if not candidates:
            candidates = candidate_sales_orders
        if send_order["order_date"]:
            candidates.sort(
                key=lambda order: abs((order.created_at.date() - send_order["order_date"]).days)
                if order.created_at else 99999
            )
        send_order_candidates[send_order["order_number"]] = [
            {
                "id": order.id,
                "code": order.code,
                "status": order.status,
                "customer_code": order.customer.code if order.customer else "",
                "customer_name": order.customer.name if order.customer else "",
                "total": float(order.total or 0),
                "created_at": order.created_at.isoformat() if order.created_at else None,
                "products": [f"{item.product.sku} × {item.quantity}" for item in order.items],
            }
            for order in candidates[:30]
        ]

    products = {}
    for product in db.scalars(select(Product)).all():
        if product.sku:
            products[product.sku.upper()] = product
        if product.npp_code:
            products[product.npp_code.upper()] = product
    from app.crud.npp import NppDirectory
    directory = NppDirectory(db)
    issues: list[str] = []
    warnings: list[str] = []
    status_counts = defaultdict(int)
    aggregate: dict[int, dict[str, Any]] = {}
    order_reconciliation = []
    delivery_orders = []
    employee_summaries: dict[int, dict[str, Any]] = {}
    borrowed_lines: dict[tuple[str, int], dict[str, Any]] = {}
    used_sales_order_ids: set[int] = set()

    for row in order_rows:
        order_number = row["order_number"]
        status = row["status"]
        status_counts[status] += 1
        if status in {"Xuất Hàng", "Gửi Số", "Trả Số"} and order_number.upper() in {
            existing.upper() for existing in existing_order_numbers
        }:
            issues.append(f"Đơn {order_number} đã có trong một yêu cầu xuất kho trước đó.")
        employee = None
        if status in {"Xuất Hàng", "Gửi Số", "Trả Số"}:
            employee = _resolve_employee(
                db, row["employee_code"], row["employee_name"], row["row_number"], "NVGH"
            )
        if status in {"Xuất Hàng", "Gửi Số", "Trả Số"} and not employee:
            issues.append(
                f"Dòng {row['row_number']}: không tìm thấy NVGH {row['employee_code']} ({row['employee_name']})."
            )
        line_rows: list[dict[str, Any]] = []
        dms_amount = Decimal("0")
        source_order_code = None
        if status in {"Xuất Hàng", "Mượn Số", "Trả Số"}:
            dms_lines = snapshots_by_order.get(order_number.casefold(), [])
            if not dms_lines:
                issues.append(f"Đơn {order_number} ({status}) không tìm thấy chi tiết trong dữ liệu DMS đã đồng bộ.")
            if status in {"Mượn Số", "Trả Số"} and dms_lines:
                dms_staff = {}
                for snapshot in dms_lines:
                    payload = snapshot.raw_payload or {}
                    staff_code = str(payload.get("Mã NVBH") or payload.get("staffCode") or "").strip().upper()
                    staff_name = str(payload.get("Tên NVBH") or payload.get("staffName") or "").strip()
                    identity_key = f"{staff_code.casefold()}|{_normalized_label(staff_name)}"
                    if staff_code or staff_name:
                        dms_staff[identity_key] = (staff_code, staff_name)

                if len(dms_staff) > 1:
                    issues.append(f"Đơn {order_number}: dữ liệu DMS có nhiều NVBH khác nhau trong các dòng sản phẩm.")
                dms_staff_code, dms_staff_name = next(iter(dms_staff.values()), ("", ""))
                sales_employee = None
                if not dms_staff_code and not dms_staff_name:
                    issues.append(f"Đơn {order_number}: dữ liệu DMS không có mã/tên NVBH để ghi nhận {status}.")
                else:
                    file_code = row["employee_code"].strip().upper()
                    file_name = row["employee_name"].strip()
                    if status == "Mượn Số":
                        mismatches = []
                        if file_code and dms_staff_code and file_code.casefold() != dms_staff_code.casefold():
                            mismatches.append(f"mã file {file_code} ≠ mã DMS {dms_staff_code}")
                        if file_name and dms_staff_name and (
                            _normalized_label(file_name) != _normalized_label(dms_staff_name)
                        ):
                            mismatches.append(f"tên file {file_name} ≠ tên DMS {dms_staff_name}")
                        if mismatches:
                            warnings.append(
                                f"Đơn {order_number} ({status}): NVBH ưu tiên theo DMS "
                                f"{dms_staff_code} ({dms_staff_name}); " + "; ".join(mismatches) + "."
                            )

                    sales_employee = _resolve_employee(
                        db, dms_staff_code, dms_staff_name, row["row_number"], "NVBH"
                    )
                    if sales_employee and (
                        sales_employee.status != "active" or not _is_sales_employee(sales_employee)
                    ):
                        sales_employee = None
                    if not dms_staff_code:
                        issues.append(
                            f"Đơn {order_number}: cần mã NVBH trên DMS để ghi nhận Mượn Số hoặc bù trừ Trả Số."
                        )
            else:
                sales_employee = None
            for snapshot in dms_lines:
                dms_sku = (snapshot.product_code or "").strip().upper()
                product = products.get(dms_sku)
                if not product:
                    issues.append(f"Đơn {order_number}: không tìm thấy mã DMS {dms_sku} trong danh mục sản phẩm.")
                    continue
                try:
                    canonical_id = canonical_product_id(db, product.id)
                except ValueError:
                    issues.append(f"Đơn {order_number}: mã DMS {dms_sku} chưa được ghép mã NPP.")
                    continue
                quantity, line_amount = _line_quantity_and_amount(snapshot)
                if quantity <= 0:
                    continue
                npp_product = db.get(Product, canonical_id)
                npp_code, npp_name = directory.label(canonical_id, npp_product.sku, npp_product.name)
                line_rows.append({
                    "product_id": canonical_id,
                    "dms_sku": dms_sku,
                    "dms_name": snapshot.product_name or product.name,
                    "npp_code": npp_code,
                    "npp_name": npp_name,
                    "quantity": quantity,
                    "dms_amount": line_amount,
                    "staff_code": str((snapshot.raw_payload or {}).get("Mã NVBH") or (snapshot.raw_payload or {}).get("staffCode") or "").strip().upper(),
                    "staff_name": str((snapshot.raw_payload or {}).get("Tên NVBH") or (snapshot.raw_payload or {}).get("staffName") or "").strip(),
                })
                dms_amount += line_amount
        elif status == "Gửi Số":
            mapped_sales_order_id = send_order_mappings.get(order_number.casefold())
            sales_order = sales_order_by_id.get(mapped_sales_order_id) if mapped_sales_order_id else None
            if sales_order is None:
                sales_order = sales_order_by_code.get(order_number.casefold())
            if not sales_order:
                issues.append(f"Đơn Gửi Số {order_number} chưa được tạo trong phần đơn hàng nội bộ.")
            else:
                source_order_code = sales_order.code
                if sales_order.status == "CANCELLED":
                    issues.append(f"Đơn nội bộ {sales_order.code} đã bị hủy, không thể dùng cho Gửi Số.")
                if sales_order.id in used_sales_order_ids:
                    issues.append(f"Đơn nội bộ {sales_order.code} đã được ghép cho một dòng Gửi Số khác.")
                used_sales_order_ids.add(sales_order.id)
                if (
                    row["customer_code"]
                    and sales_order.customer
                    and row["customer_code"].casefold() != sales_order.customer.code.casefold()
                ):
                    warnings.append(
                        f"Đơn Gửi Số {order_number} ghép với đơn {sales_order.code} nhưng mã khách hàng không khớp."
                    )
                if (
                    row["customer_name"]
                    and sales_order.customer
                    and _normalized_label(row["customer_name"]) != _normalized_label(sales_order.customer.name)
                ):
                    warnings.append(
                        f"Đơn Gửi Số {order_number} ghép với đơn {sales_order.code} nhưng tên khách hàng không khớp."
                    )
                dms_amount = Decimal(str(sales_order.total or 0))
                for order_item in sales_order.items:
                    product = order_item.product
                    try:
                        canonical_id = canonical_product_id(db, product.id)
                    except ValueError:
                        issues.append(f"Đơn {order_number}: mã DMS {product.sku} chưa được ghép mã NPP.")
                        continue
                    npp_product = db.get(Product, canonical_id)
                    npp_code, npp_name = directory.label(canonical_id, npp_product.sku, npp_product.name)
                    line_rows.append({
                        "product_id": canonical_id,
                        "dms_sku": product.sku,
                        "dms_name": product.name,
                        "npp_code": npp_code,
                        "npp_name": npp_name,
                        "quantity": int(order_item.quantity),
                        "dms_amount": Decimal(str(order_item.line_total or 0)),
                        "staff_code": row["employee_code"],
                        "staff_name": row["employee_name"],
                    })

        if status in {"Xuất Hàng", "Trả Số"} and not line_rows:
            issues.append(f"Đơn {order_number} không có sản phẩm/số lượng để xuất.")
        selected_amount = dms_amount
        for line in line_rows:
            product_id = line["product_id"]
            if status in {"Xuất Hàng", "Gửi Số", "Trả Số"}:
                entry = aggregate.setdefault(product_id, {
                    "product_id": product_id,
                    "sku": line["npp_code"],
                    "product_name": line["npp_name"],
                    "quantity": 0,
                    "dms_skus": set(),
                    "employee_allocations": {},
                    "borrowed_employee_offsets": {},
                })
                entry["quantity"] += line["quantity"]
                entry["dms_skus"].add(line["dms_sku"])
                if employee:
                    allocation = entry["employee_allocations"].setdefault(employee.code, {
                        "quantity": 0, "cartons": 0, "boxes": 0,
                    })
                    allocation["quantity"] += line["quantity"]
                    bpc = max(1, db.get(Product, product_id).boxes_per_carton or 1)
                    allocation["cartons"] = allocation["quantity"] // bpc
                    allocation["boxes"] = allocation["quantity"] % bpc

            if status in {"Mượn Số", "Trả Số"}:
                staff_code = dms_staff_code.strip().upper()
                staff_name = dms_staff_name.strip()
                if not staff_code:
                    continue
                amount_weight = (
                    (selected_amount * line["dms_amount"] / dms_amount)
                    if dms_amount else Decimal(line["quantity"])
                )
                staff_key = staff_code.casefold()
                if status == "Mượn Số":
                    key = (staff_key, product_id)
                    borrowed = borrowed_lines.setdefault(key, {
                        "employee_id": sales_employee.id if sales_employee else None,
                        "external_employee_code": staff_code,
                        "external_employee_name": staff_name,
                        "product_id": product_id,
                        "quantity": 0,
                        "amount": Decimal("0"),
                        "orders": [],
                    })
                    borrowed["quantity"] += line["quantity"]
                    borrowed["amount"] += amount_weight
                    borrowed["orders"].append(order_number)
                else:
                    item_offsets = entry["borrowed_employee_offsets"]
                    item_offset = item_offsets.setdefault(staff_key, {
                        "external_employee_code": staff_code,
                        "external_employee_name": staff_name,
                        "employee_id": sales_employee.id if sales_employee else None,
                        "quantity": 0,
                        "amount": 0.0,
                    })
                    item_offset["quantity"] += line["quantity"]
                    item_offset["amount"] += float(amount_weight)

        if status in {"Xuất Hàng", "Gửi Số", "Trả Số"}:
            order_employee_code = employee.code if employee else row["employee_code"]
            order_employee_name = employee.name if employee else row["employee_name"]
            order_id = DeliveryRequestOrderCreate(
                order_date=row["order_date"],
                order_number=order_number,
                employee_id=employee.id if employee else None,
                employee_code=order_employee_code,
                employee_name=order_employee_name,
                customer_code=row["customer_code"],
                customer_name=row["customer_name"],
                amount=float(selected_amount),
                payment_status="UNPAID",
                payment_method="UNKNOWN",
                note=(
                    f"Trạng thái file: {status}; nguồn thành tiền: {amount_source}"
                    + (f"; đơn nội bộ: {source_order_code}" if source_order_code else "")
                ),
            )
            delivery_orders.append(order_id)
            if employee:
                summary = employee_summaries.setdefault(employee.id, {
                    "employee_id": employee.id,
                    "employee_code": employee.code,
                    "employee_name": employee.name,
                    "column_key": employee.code,
                    "weight_ton": 0,
                    "order_count": 0,
                    "amount": 0,
                })
                summary["order_count"] += 1
                summary["amount"] += float(selected_amount)

        order_reconciliation.append({
            "order_number": order_number,
            "status": status,
            "order_date": row["order_date"].isoformat() if row["order_date"] else None,
            "employee_code": row["employee_code"],
            "employee_name": employee.name if employee else row["employee_name"],
            "customer_code": row["customer_code"],
            "customer_name": row["customer_name"],
            "source_order_code": source_order_code,
            "dms_amount": float(dms_amount),
            "nvgh_amount": None,
            "selected_amount": float(selected_amount),
            "amount_source": amount_source,
            "difference": None,
            "products": [
                {
                    "product_id": line["product_id"],
                    "dms_sku": line["dms_sku"],
                    "dms_name": line["dms_name"],
                    "npp_code": line["npp_code"],
                    "npp_name": line["npp_name"],
                    "quantity": line["quantity"],
                }
                for line in line_rows
            ],
        })

    for summary in employee_summaries.values():
        employee = db.get(Employee, summary["employee_id"])
        debt_limit = float(employee.debt_limit if employee.debt_limit is not None else 500000000)
        current_debt = float(db.scalar(
            select(func.coalesce(func.sum(DebtLedgerEntry.amount), 0)).where(
                DebtLedgerEntry.party_type == "EMPLOYEE",
                DebtLedgerEntry.party_id == employee.id,
            )
        ) or 0)
        pending_debt = float(db.scalar(
            select(func.coalesce(func.sum(DeliveryRequestEmployeeSummary.amount), 0))
            .join(DeliveryRequestModel, DeliveryRequestModel.id == DeliveryRequestEmployeeSummary.delivery_request_id)
            .where(
                DeliveryRequestEmployeeSummary.employee_id == employee.id,
                DeliveryRequestModel.status.in_(("SUBMITTED", "RECEIVED")),
            )
        ) or 0)
        summary.update({
            "debt_limit": debt_limit,
            "current_debt": current_debt,
            "pending_debt": pending_debt,
            "projected_debt": current_debt + pending_debt + summary["amount"],
            "is_over_limit": current_debt + pending_debt + summary["amount"] > debt_limit,
        })

    preview_items = []
    for aggregate_row in aggregate.values():
        product = db.get(Product, aggregate_row["product_id"])
        quantity = aggregate_row["quantity"]
        bpc = max(1, product.boxes_per_carton or 1)
        preview_items.append(DeliveryPreviewItem(
            product_id=product.id,
            sku=aggregate_row["sku"],
            product_name=aggregate_row["product_name"],
            quantity=quantity,
            boxes_per_carton=bpc,
            cartons=quantity // bpc,
            loose_boxes=quantity % bpc,
            requested_quantity_raw=None,
            employee_allocations=aggregate_row["employee_allocations"] or None,
            borrowed_employee_offsets=list(aggregate_row["borrowed_employee_offsets"].values()),
            dms_skus=sorted(aggregate_row["dms_skus"]),
        ))

    borrow_entries = []
    for entry in borrowed_lines.values():
        borrow_entries.append({
            "employee_id": entry["employee_id"],
            "external_employee_code": entry["external_employee_code"],
            "external_employee_name": entry["external_employee_name"] or None,
            "product_id": entry["product_id"],
            "quantity": -entry["quantity"],
            "amount": float(-entry["amount"]),
            "note": "Mượn Số theo đơn: " + ", ".join(sorted(set(entry["orders"]))),
        })

    return DeliveryPreviewResponse(
        items=preview_items,
        employee_summaries=list(employee_summaries.values()),
        orders=delivery_orders,
        order_reconciliation=order_reconciliation,
        borrow_entries=borrow_entries,
        import_hash=hashlib.sha256(file_bytes).hexdigest(),
        filename=filename,
        amount_source=amount_source,
        statuses=dict(status_counts),
        warnings=list(dict.fromkeys(warnings)),
        issues=list(dict.fromkeys(issues)),
        can_create=not issues and (bool(preview_items) or bool(borrow_entries)),
        send_order_candidates=send_order_candidates,
        total_cartons=sum(item.cartons for item in preview_items),
        total_loose_boxes=sum(item.loose_boxes for item in preview_items),
        total_quantity=sum(item.quantity for item in preview_items),
    )


@borrow_router.get("/")
def list_borrowed_goods(db: Session = Depends(get_db)):
    return borrow_crud.list_ledger(db)


@borrow_router.post("/import-preview")
def import_borrowed_preview(
    payload: EmployeeBorrowBatchCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        batch = borrow_crud.create_posted_batch(
            db,
            import_hash=payload.import_hash,
            filename=payload.filename,
            entries=[entry.model_dump() for entry in payload.entries],
            created_by=getattr(current_user, "username", None),
        )
        db.commit()
        db.refresh(batch)
        return {
            "batch_id": batch.id,
            "status": batch.status,
            "message": "Đã ghi nhận các đơn Mượn Số vào sổ Hàng vay mượn NVBH.",
        }
    except ValueError as exc:
        return _error(db, exc)


@borrow_router.post("/import")
def import_borrowed_goods(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="Vui lòng tải lên file Excel .xlsx hoặc .xlsm.")
    try:
        content = file.file.read()
        workbook = load_workbook(BytesIO(content), read_only=True, data_only=True)
        rows = list(workbook.worksheets[0].iter_rows(values_only=True))
        if len(rows) < 11:
            raise ValueError("File không đúng mẫu phiếu tổng hợp giao hàng.")
        code_header = str(rows[8][1] if len(rows[8]) > 1 else "").strip().lower()
        quantity_header = str(rows[8][3] if len(rows[8]) > 3 else "").strip().lower()
        if code_header not in {"sku", "mã sku", "ma sku", "mã hàng", "ma hang"} and not (
            "số lượng tổng" in quantity_header or "tong xuat" in quantity_header
        ):
            raise ValueError("Không nhận diện được cấu trúc phiếu tổng hợp giao hàng.")

        employee_row = rows[9]
        borrowed_columns: dict[int, str] = {}
        for column, raw_value in enumerate(employee_row[4:], 4):
            if not raw_value:
                continue
            raw = str(raw_value).strip()
            if not re.search(r"-X\s*$", raw, re.IGNORECASE):
                continue
            code = _borrow_employee_code(raw)
            if not code:
                raise ValueError(f"Cột nhân viên {column + 1} không có mã nhân viên.")
            if code in borrowed_columns.values():
                raise ValueError(f"Mã nhân viên vay mượn {code} xuất hiện nhiều lần.")
            borrowed_columns[column] = code
        if not borrowed_columns:
            raise ValueError("File không có cột nhân viên được đánh dấu -X.")

        products = {product.sku.upper(): product for product in db.query(Product).all()}
        employees = {
            employee.code.upper(): employee
            for employee in db.scalars(select(Employee)).all()
        }
        quantities: dict[tuple[int, int], int] = {}
        product_by_id = {}
        amount_by_code: dict[str, Decimal] = {}
        amount_row_found = False
        for number, values in enumerate(rows[10:], 11):
            col_b = str(values[1]).strip().lower() if len(values) > 1 and values[1] is not None else ""
            col_c = str(values[2]).strip().lower() if len(values) > 2 and values[2] is not None else ""
            footer = f"{col_b} {col_c}"
            if "ngàn đồng" in footer or "ngan dong" in footer:
                if amount_row_found:
                    raise ValueError(f"Dòng {number}: file có nhiều dòng tổng tiền công nợ.")
                amount_row_found = True
                for column, code in borrowed_columns.items():
                    amount_by_code[code] = Decimal(str(_employee_amount(
                        values[column] if column < len(values) else None, code, number
                    )))
                continue
            if "tấn" in footer or "(tấn)" in footer or "đơn" in footer or "(đơn)" in footer:
                continue
            raw_sku = values[1] if len(values) > 1 else None
            sku = str(raw_sku).strip().upper() if raw_sku is not None else ""
            if not sku or sku not in products:
                if sku and any(values[column] not in (None, "") for column in borrowed_columns):
                    raise ValueError(f"Dòng {number}: không tìm thấy SKU {sku}.")
                continue
            product = products[sku]
            product_id = canonical_product_id(db, product.id)
            canonical_product = db.get(Product, product_id)
            per_carton = max(1, canonical_product.boxes_per_carton or 1)
            product_by_id[product_id] = canonical_product
            for column, code in borrowed_columns.items():
                cell = values[column] if column < len(values) else None
                if cell in (None, ""):
                    continue
                quantity, _, _, _ = _quantity(cell, per_carton)
                if quantity:
                    employee = employees.get(code)
                    if not employee:
                        raise ValueError(f"Không tìm thấy nhân viên {code} trong hệ thống.")
                    key = (employee.id, product_id)
                    quantities[key] = quantities.get(key, 0) + quantity
        if not amount_row_found:
            raise ValueError("File thiếu dòng tổng tiền công nợ theo nhân viên (ngàn đồng).")

        totals_by_employee: dict[int, int] = {}
        for (employee_id, _), quantity in quantities.items():
            totals_by_employee[employee_id] = totals_by_employee.get(employee_id, 0) + quantity
        employee_by_id = {employee.id: employee for employee in employees.values()}
        for code, amount in amount_by_code.items():
            employee = employees.get(code)
            if amount > 0 and (not employee or employee.id not in totals_by_employee):
                raise ValueError(f"Nhân viên {code} có tiền vay nhưng không có số lượng -X.")
        entries = []
        for employee_id, total_quantity in totals_by_employee.items():
            employee = employee_by_id[employee_id]
            total_amount = amount_by_code.get(employee.code.upper(), Decimal("0"))
            if total_quantity <= 0:
                raise ValueError(f"Nhân viên {employee.code} có tiền vay nhưng không có số lượng -X.")
            remaining_amount = total_amount
            employee_products = [
                (product_id, quantity)
                for (entry_employee_id, product_id), quantity in quantities.items()
                if entry_employee_id == employee_id
            ]
            for index, (product_id, quantity) in enumerate(employee_products):
                if index == len(employee_products) - 1:
                    amount = remaining_amount
                else:
                    amount = (total_amount * Decimal(quantity) / Decimal(total_quantity)).quantize(
                        Decimal("0.01")
                    )
                    remaining_amount -= amount
                entries.append({
                    "employee_id": employee_id,
                    "employee_code": employee.code,
                    "employee_name": employee.name,
                    "product_id": product_id,
                    "product_code": product_by_id[product_id].npp_code,
                    "product_name": product_by_id[product_id].npp_name,
                    "quantity": -quantity,
                    "amount": float(-amount),
                })
        if not entries:
            raise ValueError("Các cột -X không có số lượng vay mượn.")
        try:
            batch = borrow_crud.create_pending_batch(
                db,
                import_hash=hashlib.sha256(content).hexdigest(),
                filename=file.filename,
                entries=entries,
                created_by=current_user.username,
            )
            db.commit()
            db.refresh(batch)
            return {
                "batch_id": batch.id,
                "status": batch.status,
                "filename": batch.filename,
                "entries": entries,
                "message": "Đã tạo bản chờ xác nhận. Số dư vay chỉ được ghi nhận sau khi admin xác nhận.",
            }
        except ValueError as exc:
            return _error(db, exc)
    except HTTPException:
        db.rollback()
        raise
    except (ValueError, TypeError, InvalidFileException, BadZipFile, OSError) as exc:
        return _error(db, exc)


@borrow_router.post("/{batch_id}/confirm")
def confirm_borrowed_goods(
    batch_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        batch = borrow_crud.confirm_batch(db, batch_id)
        return {"id": batch.id, "status": batch.status, "posted_at": batch.posted_at}
    except ValueError as exc:
        return _error(db, exc)


@borrow_router.delete("/{batch_id}", status_code=204)
def cancel_borrowed_goods(batch_id: int, db: Session = Depends(get_db)):
    try:
        borrow_crud.cancel_batch(db, batch_id)
        return None
    except ValueError as exc:
        return _error(db, exc)


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


@router.get("/dispatch-pool", response_model=List[DispatchPoolOrder])
def list_dispatch_pool_orders(
    from_date: date | None = None,
    to_date: date | None = None,
    search: str | None = None,
    include_dispatched: bool = False,
    limit: int = 300,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Danh sách đơn hàng (SalesOrder) chờ Admin điều phối gom đợt giao & phân bổ NVGH."""
    from sqlalchemy.orm import selectinload
    from app.models.sales import SalesOrder, SalesOrderItem
    from app.models.inventory import DeliveryRequest as DeliveryRequestModel, DeliveryRequestOrder as DeliveryRequestOrderModel

    stmt = (
        select(SalesOrder)
        .options(
            selectinload(SalesOrder.customer),
            selectinload(SalesOrder.employee),
            selectinload(SalesOrder.items).selectinload(SalesOrderItem.product),
        )
        .where(SalesOrder.status.notin_(["CANCELLED", "COMPLETED"]))
        .order_by(SalesOrder.created_at.desc())
        .limit(min(max(limit, 1), 1000))
    )
    if from_date is not None:
        stmt = stmt.where(func.date(SalesOrder.created_at) >= from_date)
    if to_date is not None:
        stmt = stmt.where(func.date(SalesOrder.created_at) <= to_date)

    orders = db.scalars(stmt).all()
    order_codes = [o.code for o in orders if o.code]
    dispatched_map: dict[str, tuple[int, str, str]] = {}
    if order_codes:
        links = db.execute(
            select(
                DeliveryRequestOrderModel.order_number,
                DeliveryRequestModel.id,
                DeliveryRequestModel.code,
                DeliveryRequestModel.status,
            )
            .join(DeliveryRequestModel, DeliveryRequestModel.id == DeliveryRequestOrderModel.delivery_request_id)
            .where(
                DeliveryRequestOrderModel.order_number.in_(order_codes),
                DeliveryRequestModel.status != "CANCELLED",
            )
        ).all()
        for ord_num, req_id, req_code, req_status in links:
            dispatched_map[str(ord_num).strip().upper()] = (req_id, req_code, req_status)

    term = (search or "").strip().lower()
    result: list[DispatchPoolOrder] = []
    for o in orders:
        disp = dispatched_map.get((o.code or "").strip().upper())
        if disp is not None and not include_dispatched:
            continue
        cust = o.customer
        emp = o.employee
        cust_code = cust.code if cust else ""
        cust_name = cust.name if cust else ""
        cust_addr = cust.address if cust else None
        emp_code = emp.code if emp else None
        emp_name = emp.name if emp else None

        if term:
            hay = " ".join([
                o.code or "",
                cust_code,
                cust_name,
                cust_addr or "",
                emp_code or "",
                emp_name or "",
            ]).lower()
            if term not in hay:
                continue

        item_views: list[DispatchPoolOrderItem] = []
        for it in o.items:
            prod = it.product
            if not prod:
                continue
            item_views.append(
                DispatchPoolOrderItem(
                    product_id=it.product_id,
                    sku=prod.npp_code or prod.sku,
                    product_name=prod.npp_name or prod.name,
                    boxes_per_carton=max(1, int(prod.boxes_per_carton or 1)),
                    quantity=int(it.quantity or 0),
                    price=float(it.price or 0),
                    line_total=float(it.line_total or 0),
                )
            )

        result.append(
            DispatchPoolOrder(
                id=o.id,
                code=o.code,
                order_date=o.created_at.date() if o.created_at else None,
                status=o.status,
                warehouse_id=o.warehouse_id,
                customer_id=o.customer_id,
                customer_code=cust_code,
                customer_name=cust_name,
                customer_address=cust_addr,
                sales_employee_code=emp_code,
                sales_employee_name=emp_name,
                total=float(o.total or 0),
                note=o.note,
                items=item_views,
                dispatched_request_id=disp[0] if disp else None,
                dispatched_request_code=disp[1] if disp else None,
                dispatched_request_status=disp[2] if disp else None,
            )
        )
    return result


@router.post("/from-orders", response_model=DeliveryRequest, status_code=201)
def create_request_from_orders(
    payload: DeliveryRequestFromOrdersCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Gom nhiều đơn hàng (VD: Đợt 1 gồm 10 đơn) thành 1 Đơn tổng (DeliveryRequest) và phân bổ cho các NVGH theo từng khách hàng."""
    from collections import defaultdict
    from sqlalchemy.orm import selectinload
    from app.models.sales import SalesOrder, SalesOrderItem
    from app.models.inventory import DeliveryRequest as DeliveryRequestModel, DeliveryRequestOrder as DeliveryRequestOrderModel

    seen_order_ids: set[int] = set()
    for alloc in payload.allocations:
        if alloc.sales_order_id in seen_order_ids:
            raise HTTPException(status_code=400, detail=f"Đơn hàng ID #{alloc.sales_order_id} bị chọn trùng trong đợt giao.")
        seen_order_ids.add(alloc.sales_order_id)

    order_ids = list(seen_order_ids)
    orders = db.scalars(
        select(SalesOrder)
        .options(
            selectinload(SalesOrder.customer),
            selectinload(SalesOrder.items).selectinload(SalesOrderItem.product),
        )
        .where(SalesOrder.id.in_(order_ids))
    ).all()
    orders_by_id = {o.id: o for o in orders}
    missing_orders = [oid for oid in order_ids if oid not in orders_by_id]
    if missing_orders:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy đơn hàng ID: {', '.join(map(str, missing_orders))}.")

    emp_ids = list({alloc.employee_id for alloc in payload.allocations})
    employees = db.scalars(select(Employee).where(Employee.id.in_(emp_ids))).all()
    emps_by_id = {e.id: e for e in employees}
    missing_emps = [eid for eid in emp_ids if eid not in emps_by_id]
    if missing_emps:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy nhân viên giao hàng ID: {', '.join(map(str, missing_emps))}.")

    # Kiểm tra chống giao trùng
    order_codes = [o.code for o in orders if o.code]
    existing_links = db.execute(
        select(DeliveryRequestOrderModel.order_number, DeliveryRequestModel.code)
        .join(DeliveryRequestModel, DeliveryRequestModel.id == DeliveryRequestOrderModel.delivery_request_id)
        .where(
            DeliveryRequestOrderModel.order_number.in_(order_codes),
            DeliveryRequestModel.status != "CANCELLED",
        )
    ).all()
    if existing_links:
        dup_desc = ", ".join(f"{ord_num} (đã ở đợt {req_code})" for ord_num, req_code in existing_links[:5])
        raise HTTPException(status_code=409, detail=f"Có đơn hàng đã thuộc đợt giao khác: {dup_desc}.")

    # Gom hàng hóa toàn đợt (Đơn tổng) + phân bổ theo từng NVGH
    product_totals: dict[int, int] = defaultdict(int)
    product_emp_qty: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    emp_order_counts: dict[int, int] = defaultdict(int)
    emp_amounts: dict[int, float] = defaultdict(float)
    order_inputs: list[DeliveryRequestOrderCreate] = []

    for alloc in payload.allocations:
        so = orders_by_id[alloc.sales_order_id]
        if so.status == "CANCELLED":
            raise HTTPException(status_code=400, detail=f"Đơn hàng {so.code} đã bị hủy, không thể gom vào đợt giao.")
        if not so.items:
            raise HTTPException(status_code=400, detail=f"Đơn hàng {so.code} chưa có sản phẩm nào.")
        emp = emps_by_id[alloc.employee_id]
        emp_code = emp.code.strip().upper()
        for it in so.items:
            qty = int(it.quantity or 0)
            if qty <= 0:
                continue
            product_totals[it.product_id] += qty
            product_emp_qty[it.product_id][emp_code] += qty

        emp_order_counts[emp.id] += 1
        emp_amounts[emp.id] += float(so.total or 0)
        order_inputs.append(
            DeliveryRequestOrderCreate(
                order_date=so.created_at.date() if so.created_at else None,
                order_number=so.code,
                employee_id=emp.id,
                employee_code=emp_code,
                employee_name=emp.name,
                customer_code=so.customer.code if so.customer else None,
                customer_name=so.customer.name if so.customer else None,
                amount=float(so.total or 0),
                note=so.note,
            )
        )

    if not product_totals:
        raise HTTPException(status_code=400, detail="Các đơn hàng đã chọn không có sản phẩm hợp lệ (SL > 0).")

    item_inputs: list[DeliveryRequestItemCreate] = []
    for prod_id, total_qty in product_totals.items():
        alloc_map = {code: qty for code, qty in product_emp_qty[prod_id].items() if qty > 0}
        item_inputs.append(
            DeliveryRequestItemCreate(
                product_id=prod_id,
                quantity=total_qty,
                employee_allocations=alloc_map,
            )
        )

    summary_inputs: list[DeliveryRequestEmployeeSummaryCreate] = []
    for emp_id, cnt in emp_order_counts.items():
        emp = emps_by_id[emp_id]
        summary_inputs.append(
            DeliveryRequestEmployeeSummaryCreate(
                employee_id=emp.id,
                employee_code=emp.code.strip().upper(),
                employee_name=emp.name,
                order_count=cnt,
                amount=round(emp_amounts[emp_id], 2),
            )
        )

    batch_note = (payload.note or "").strip() or (
        f"Đợt giao gom {len(order_inputs)} đơn hàng cho {len(summary_inputs)} NVGH"
    )
    req_payload = DeliveryRequestCreate(
        warehouse_id=payload.warehouse_id,
        items=item_inputs,
        employee_summaries=summary_inputs,
        orders=order_inputs,
        note=batch_note,
    )
    try:
        return crud.create(
            db,
            req_payload,
            created_by=getattr(current_user, "username", None),
        )
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


def _group_items_by_npp(db: Session, items: list[dict]) -> list[dict]:
    """Gộp các dòng SKU cùng nhóm thành một dòng theo mã NPP; chặn SKU chưa có nhóm."""
    from app.crud.npp import NppDirectory
    from app.models.product import Product

    directory = NppDirectory(db)
    grouped: dict[object, dict] = {}
    unmapped: list[str] = []
    for item in items:
        product_id = item.get("product_id")
        if not product_id:
            grouped[("unknown", item.get("sku"))] = item
            continue
        canonical_id = directory.canonical(product_id)
        if canonical_id is None:
            product = db.get(Product, product_id)
            unmapped.append(item.get("sku") or (product.sku if product else str(product_id)))
            continue
        existing = grouped.get(canonical_id)
        if existing is None:
            grouped[canonical_id] = {**item, "product_id": canonical_id}
            continue
        existing["quantity"] += item["quantity"]
        existing["requested_quantity_raw"] = None
        for code, allocation in (item.get("employee_allocations") or {}).items():
            target = existing.setdefault("employee_allocations", None) or {}
            current = target.get(code)
            if current is None:
                target[code] = dict(allocation)
            else:
                current["quantity"] += allocation["quantity"]
                current["cartons"] = current.get("cartons", 0) + allocation.get("cartons", 0)
                current["boxes"] = current.get("boxes", 0) + allocation.get("boxes", 0)
                current["raw"] = f"{current.get('raw', '')} + {allocation.get('raw', '')}"
            existing["employee_allocations"] = target
    if unmapped:
        raise ValueError(
            "Các SKU chưa thuộc nhóm mã NPP, hãy gán mã NPP trước khi tải lên: "
            + ", ".join(sorted(set(unmapped))[:20])
        )
    return list(grouped.values())


@router.post("/upload", response_model=DeliveryPreviewResponse)
def upload_request(warehouse_id: int, file: UploadFile = File(...), note: str | None = None,
                   send_order_mappings: str | None = None,
                   db: Session = Depends(get_db)):
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="Vui lòng tải lên file Excel .xlsx hoặc .xlsm.")
    try:
        file_bytes = file.file.read()
        workbook = load_workbook(BytesIO(file_bytes), read_only=True, data_only=True)
        new_format = _preview_new_workbook(
            file_bytes=file_bytes,
            filename=file.filename,
            warehouse_id=warehouse_id,
            send_order_mappings=_parse_id_mapping(send_order_mappings, "đơn Gửi Số"),
            db=db,
        )
        if new_format is not None:
            return new_format
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
                    code = _borrow_employee_code(raw_str)
                    if not code:
                        raise ValueError(f"Cột nhân viên {col + 1} không có mã nhân viên.")
                    if any(existing["code"] == code for existing in employee_cols.values()):
                        raise ValueError(f"Mã nhân viên {code} xuất hiện nhiều lần trong file.")
                    name = raw_str.split("(", 1)[1].split(")", 1)[0].strip() if "(" in raw_str and ")" in raw_str else ""
                    employee_cols[col] = {
                        "code": code,
                        "raw": raw_str,
                        "name": name,
                        "is_borrowed": bool(re.search(r"-X\s*$", raw_str, re.IGNORECASE)),
                    }

            borrowed_employee_codes = {
                emp["code"] for emp in employee_cols.values() if emp["is_borrowed"]
            }
            if borrowed_employee_codes:
                warnings.append(
                    "Các cột nhân viên có hậu tố -X không được đưa vào yêu cầu xuất thật; "
                    "hãy xác nhận riêng tại mục Hàng vay mượn NVBH."
                )

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
                        if emp["is_borrowed"]:
                            continue
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
                borrowed_quantity = 0
                for column in range(4, len(values)):
                    emp_info = employee_cols.get(column)
                    if not emp_info or values[column] in (None, ""):
                        continue
                    raw_employee = str(values[column]).strip()
                    if raw_employee:
                        employee_quantity, employee_cartons, employee_boxes, _ = _quantity(raw_employee, per_carton)
                        if emp_info["is_borrowed"]:
                            borrowed_quantity += employee_quantity
                            continue
                        allocations[emp_info["code"]] = {
                            "quantity": employee_quantity,
                            "cartons": employee_cartons,
                            "boxes": employee_boxes,
                            "raw": raw_employee,
                        }
                if borrowed_quantity > total:
                    raise ValueError(
                        f"Dòng {number}: tổng số lượng -X vượt tổng số lượng của sản phẩm {sku}."
                    )
                actual_quantity = total - borrowed_quantity
                if actual_quantity > 0:
                    items.append({
                        "product_id": product.id if product else 0,
                        "sku": sku,
                        "product_name": product.name if product else "Chưa đăng ký",
                        "quantity": actual_quantity,
                        "requested_quantity_raw": (
                            f"{actual_quantity // per_carton}/{actual_quantity % per_carton}"
                            if "/" in raw_total else str(actual_quantity)
                        ),
                        "employee_allocations": allocations or None,
                    })

            if employee_cols and not amount_row_found:
                raise ValueError("File thiếu dòng tổng tiền công nợ theo nhân viên (ngàn đồng).")

            emp_by_code = {e.code.upper(): e for e in db.query(Employee).all()}
            for col, emp in employee_cols.items():
                code = emp["code"]
                if emp["is_borrowed"]:
                    continue
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
        items = _group_items_by_npp(db, items)
        from app.crud.npp import NppDirectory
        directory = NppDirectory(db)
        preview = []
        for item in items:
            product = db.get(Product, item["product_id"]) if item["product_id"] else None
            bpc = max(1, product.boxes_per_carton or 1) if product else (item.get("boxes_per_carton") or 1)
            qty = item["quantity"]
            npp_code, npp_name = (
                directory.label(product.id, product.sku, product.name) if product else (item["sku"], item["product_name"])
            )
            preview.append(DeliveryPreviewItem(
                product_id=product.id if product else 0,
                sku=npp_code,
                product_name=npp_name,
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
            ) or bool(borrowed_employee_codes)
            emp_by_code = {e.code.upper(): e for e in db.query(Employee).all()}
            emp_by_name = {e.name.strip().lower(): e for e in db.query(Employee).all() if e.name}
            summary_by_code = {s.get("employee_code", "").upper(): s for s in employee_summaries}

            for row_data in parsed_order_rows:
                emp_code = (row_data.get("employee_code") or "").strip().upper()
                emp_name = (row_data.get("employee_name") or "").strip()
                if (
                    summaries_are_nv_sequential
                    and col_to_nv_map.get(emp_code) in borrowed_employee_codes
                ):
                    continue

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

                if target_emp_code.strip().upper() in borrowed_employee_codes:
                    continue

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


def _parse_id_mapping(raw: str | None, label: str) -> dict[str, int]:
        if not raw:
            return {}
        try:
            value = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Dữ liệu ghép {label} không hợp lệ.") from exc
        if not isinstance(value, dict):
            raise ValueError(f"Dữ liệu ghép {label} phải là một đối tượng.")
        mapping = {}
        for key, identifier in value.items():
            if not isinstance(key, str) or not key.strip() or isinstance(identifier, bool) or not isinstance(identifier, int) or identifier <= 0:
                raise ValueError(f"Dữ liệu ghép {label} chứa mã hoặc ID không hợp lệ.")
            mapping[key.casefold()] = identifier
        return mapping


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
def submit_request(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin(current_user)
    try:
        return crud.transition(
            db,
            request_id,
            "submit",
            performed_by=getattr(current_user, "username", None),
        )
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

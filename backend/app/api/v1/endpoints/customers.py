from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Response
from pydantic import BaseModel
from io import BytesIO
import re
from openpyxl import Workbook, load_workbook
from openpyxl.utils.exceptions import InvalidFileException
from zipfile import BadZipFile
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload
from typing import List, Literal

from app.core.auth import (
    ensure_entity_in_distributor_scope,
    get_current_user,
    resolve_distributor_scope,
)
from app.core.database import get_db
from app.schemas.customer import Customer, CustomerCreate, CustomerUpdate
from app.crud import customer as crud
from app.models.customer import (
    Customer as CustomerModel,
    CustomerAddress,
    CustomerCompany,
    CustomerContact,
    Store as StoreModel,
    Company as CompanyModel,
)
from app.models.user import User

router = APIRouter(prefix="/customers", tags=["customers"])


CUSTOMER_HEADER_ALIASES = {
    "Mã KH": "code",
    "Mã khách hàng": "code",
    "Tên cửa hàng": "name",
    "Tên khách hàng": "name",
    "Loại": "type",
    "Hạng": "tier",
    "Điện thoại": "phone",
    "Số điện thoại": "phone",
    "SĐT": "phone",
    "SDT": "phone",
    "Email": "email",
    "CCCD": "citizen_id",
    "Mã số thuế": "tax_code",
    "Hạn mức công nợ": "credit_limit",
    "Trạng thái": "status",
    "Mã cửa hàng": "store_code",
    "Mã CH": "store_code",
    "Tuyến": "store_route",
    "Tuyến bán hàng": "store_route",
    "Mã tuyến": "store_route",
    "Mã công ty quản lý": "company_code",
    "Mã các công ty quản lý": "company_code",
    "Các công ty quản lý": "company_code",
    "Mã công ty": "company_code",
    "Công ty quản lý": "company_code_fallback",
    "Mã NVBH": "staff_code",
    "Tên NVBH": "staff_name",
    "Mã nhân viên bán hàng": "staff_code",
    "Tên nhân viên bán hàng": "staff_name",
    "Mã NVQL": "manager_code",
    "Tên NVQL": "manager_name",
    "Mã nhân viên quản lý": "manager_code",
    "Tên nhân viên quản lý": "manager_name",
    "Tên trên hoá đơn": "invoice_name",
    "Tên trên hóa đơn": "invoice_name",
    "Địa chỉ trên hoá đơn": "invoice_address",
    "Địa chỉ trên hóa đơn": "invoice_address",
}


def _canonical_customer_headers(headers: list[str]) -> list[str]:
    return [CUSTOMER_HEADER_ALIASES.get(header, header) for header in headers]


def _cell_to_str(raw: object) -> str:
    if raw is None:
        return ""
    if isinstance(raw, bool):
        return "1" if raw else "0"
    if isinstance(raw, float) and raw.is_integer():
        return str(int(raw))
    return str(raw).strip()


def _parse_company_codes(raw: object) -> list[str]:
    text = _cell_to_str(raw)
    if not text:
        return []
    tokens = re.split(r"[,;|\r\n]+", text)
    seen: set[str] = set()
    result: list[str] = []
    for token in tokens:
        cleaned = token.strip()
        if not cleaned:
            continue
        key = cleaned.upper()
        if key not in seen:
            seen.add(key)
            result.append(cleaned)
    return result


def _normalize_customer_type(raw: object) -> str | None:
    text = str(raw or "").strip()
    if not text:
        return None
    upper = text.upper()
    mapping = {
        "RETAIL": "RETAIL",
        "CỬA HÀNG": "RETAIL",
        "CUA HANG": "RETAIL",
        "WHOLESALE": "WHOLESALE",
        "ĐẠI LÝ": "WHOLESALE",
        "DAI LY": "WHOLESALE",
        "DISTRIBUTOR": "DISTRIBUTOR",
        "NHÀ PHÂN PHỐI": "DISTRIBUTOR",
        "NHA PHAN PHOI": "DISTRIBUTOR",
        "NPP": "DISTRIBUTOR",
        "HORECA": "HORECA",
    }
    return mapping.get(upper, upper)


def _normalize_customer_status(raw: object) -> str | None:
    text = str(raw or "").strip()
    if not text:
        return None
    lower = text.lower()
    if lower in ("active", "hoạt động", "hoat dong", "đang hoạt động", "1"):
        return "active"
    if lower in ("inactive", "ngưng giao", "ngung giao", "ngưng", "ngung", "ngừng", "0"):
        return "inactive"
    return lower


def _parse_credit_limit(raw: object) -> float | None:
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    return float(text.replace(",", "").replace(" ", ""))


@router.get("/template")
def download_customer_template():
    from app.core.excel_templates import create_smart_template

    output = create_smart_template(
        sheet_title="Khách hàng",
        headers=[
            "Mã KH", "Tên khách hàng", "Loại", "Email", "CCCD",
            "Mã số thuế", "Hạn mức công nợ", "Trạng thái", "Mã cửa hàng", "Tuyến", "Mã công ty quản lý",
            "Mã NVQL",
        ],
        sub_guides=[
            "Bắt buộc. VD: KH-0001 (Đã có -> Cập nhật; Chưa có -> Thêm mới)",
            "Bắt buộc khi thêm mới. Tên khách hàng / xuất hóa đơn",
            "Chọn: RETAIL, WHOLESALE, DISTRIBUTOR, HORECA",
            "Tùy chọn. Email nhận hóa đơn điện tử",
            "Tùy chọn. Căn cước công dân người đại diện",
            "Tùy chọn. Mã số thuế",
            "VNĐ. Hạn mức công nợ cho phép",
            "Chọn: active / inactive",
            "Tùy chọn. Mã điểm bán liên kết (VD: CH-0001)",
            "Tùy chọn. Tuyến của cửa hàng (VD: Tuyến 1)",
            "Tùy chọn. Nhập 1 hoặc nhiều mã cách nhau bởi dấu phẩy (VD: CT001, CT002)",
            "Tùy chọn. Mã nhân viên quản lý khách hàng, phải bắt đầu bằng NV",
        ],
        sample_rows=[
            ["KH-0001", "Hộ kinh doanh Mai Linh", "RETAIL", "mailinh@gmail.com", "012345678901", "8012345678", 20000000, "active", "CH-0001", "Tuyến 1", "CT001", "NV001"],
            ["KH-0002", "Công ty TNHH Hưng Thịnh", "WHOLESALE", "hungthinh@gmail.com", "", "0102030405", 50000000, "active", "CH-0002", "Tuyến 2", "CT001, CT002", "NV002"],
        ],
        col_widths=[18, 28, 16, 24, 18, 18, 20, 16, 18, 18, 26, 16],
        guide_title="HƯỚNG DẪN NHẬP / CẬP NHẬT DANH SÁCH KHÁCH HÀNG",
        guide_sections=[
            ("1. Quy tắc thêm mới & cập nhật (Upsert):", [
                "• Dòng 1: Tiêu đề cột. Dòng 2: Hướng dẫn mờ. Dữ liệu bắt đầu từ dòng 3.",
                "• Nếu Mã KH chưa tồn tại trong NPP: hệ thống sẽ THÊM MỚI khách hàng.",
                "• Nếu Mã KH đã tồn tại trong NPP: hệ thống sẽ CẬP NHẬT các trường có dữ liệu theo file upload (ô trống sẽ giữ nguyên dữ liệu cũ).",
            ]),
            ("2. Liên kết Cửa hàng & Nhiều Công ty quản lý:", [
                "• 'Mã cửa hàng': Giúp gom nhóm nhiều mã xuất hóa đơn của cùng 1 cửa hàng vật lý.",
                "• 'Tuyến': Ghi nhận tuyến của cửa hàng liên kết (hiển thị sang danh sách khách hàng).",
                "• 'Mã công ty quản lý': 1 khách hàng có thể do NHIỀU công ty quản lý. Nhập nhiều mã cách nhau bằng dấu phẩy (VD: CT001, CT002) hoặc tách thành nhiều dòng cùng Mã KH.",
                "• 'Mã NVQL': Mã nhân viên quản lý khách hàng, phải tồn tại trong danh sách nhân viên và bắt đầu bằng NV.",
            ]),
        ],
        validations=[
            ("C3:C500", '"RETAIL,WHOLESALE,DISTRIBUTOR,HORECA"', "Chọn loại khách hàng", "Chỉ chọn: RETAIL, WHOLESALE, DISTRIBUTOR, HORECA"),
            ("H3:H500", '"active,inactive"', "Chọn trạng thái", "Chỉ chọn active hoặc inactive"),
        ],
    )
    return Response(
        content=output.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="mau-khach-hang.xlsx"'},
    )


@router.post("/upload")
def upload_customers(
    file: UploadFile = File(...),
    distributor_id: int | None = Query(None),
    company_update_mode: Literal["append", "replace"] = Query("append"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    effective_dist_id = resolve_distributor_scope(current_user, distributor_id, require_for_write=True)
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="Vui lòng tải lên file Excel .xlsx hoặc .xlsm.")
    try:
        workbook = load_workbook(BytesIO(file.file.read()), read_only=True, data_only=True)
        rows = list(workbook.active.iter_rows(values_only=True))
        if not rows:
            raise HTTPException(status_code=400, detail="File Excel không có dữ liệu.")
        headers = _canonical_customer_headers([
            str(value).strip() if value is not None else "" for value in rows[0]
        ])
        if "code" not in headers:
            raise HTTPException(status_code=400, detail="Thiếu cột bắt buộc: Mã KH (code).")

        has_explicit_company_code_col = "company_code" in headers

        # Gom các dòng có cùng Mã KH trong file (cho phép 1 KH khai báo trên nhiều dòng với nhiều công ty quản lý khác nhau)
        grouped_rows: dict[str, dict] = {}
        for row_number, values in enumerate(rows[1:], start=2):
            if not any(value is not None and str(value).strip() for value in values):
                continue
            data = dict(zip(headers, values))
            code = _cell_to_str(data.get("code"))
            name = _cell_to_str(data.get("name"))
            # Bỏ qua dòng hướng dẫn phụ nếu giữ nguyên dòng 2 mẫu
            if "Bắt buộc" in code or "VD: KH-0001" in code or "Tên khách hàng" in name:
                continue
            if not code:
                raise HTTPException(status_code=400, detail=f"Dòng {row_number}: mã khách hàng không được để trống.")

            raw_company_val = (
                data.get("company_code")
                if has_explicit_company_code_col
                else data.get("company_code_fallback")
            )
            row_company_codes = _parse_company_codes(raw_company_val)
            row_credit_limit = _parse_credit_limit(data.get("credit_limit"))
            row_type = _normalize_customer_type(data.get("type"))
            row_status = _normalize_customer_status(data.get("status"))

            code_key = code.upper()
            if code_key not in grouped_rows:
                grouped_rows[code_key] = {
                    "row_number": row_number,
                    "code": code,
                    "name": name,
                    "type": row_type,
                    "tier": _cell_to_str(data.get("tier")).upper() or None,
                    "phone": _cell_to_str(data.get("phone")) or None,
                    "email": _cell_to_str(data.get("email")) or None,
                    "citizen_id": _cell_to_str(data.get("citizen_id")) or None,
                    "tax_code": _cell_to_str(data.get("tax_code")) or None,
                    "staff_code": _cell_to_str(data.get("staff_code")) or None,
                    "staff_name": _cell_to_str(data.get("staff_name")) or None,
                    "manager_code": _cell_to_str(data.get("manager_code")) or None,
                    "credit_limit": row_credit_limit,
                    "status": row_status,
                    "store_code": _cell_to_str(data.get("store_code")) or None,
                    "store_route": _cell_to_str(data.get("store_route")) or None,
                    "invoice_name": _cell_to_str(data.get("invoice_name")) or None,
                    "invoice_address": _cell_to_str(data.get("invoice_address")) or None,
                    "company_codes": list(row_company_codes),
                }
            else:
                entry = grouped_rows[code_key]
                scalar_updates = {
                    "name": name or None,
                    "type": row_type,
                    "tier": _cell_to_str(data.get("tier")).upper() or None,
                    "phone": _cell_to_str(data.get("phone")) or None,
                    "email": _cell_to_str(data.get("email")) or None,
                    "citizen_id": _cell_to_str(data.get("citizen_id")) or None,
                    "tax_code": _cell_to_str(data.get("tax_code")) or None,
                    "staff_code": _cell_to_str(data.get("staff_code")) or None,
                    "staff_name": _cell_to_str(data.get("staff_name")) or None,
                    "manager_code": _cell_to_str(data.get("manager_code")) or None,
                    "credit_limit": row_credit_limit,
                    "status": row_status,
                    "store_code": _cell_to_str(data.get("store_code")) or None,
                    "store_route": _cell_to_str(data.get("store_route")) or None,
                    "invoice_name": _cell_to_str(data.get("invoice_name")) or None,
                    "invoice_address": _cell_to_str(data.get("invoice_address")) or None,
                }
                for key_name, val in scalar_updates.items():
                    if val is not None:
                        entry[key_name] = val
                seen_comp_keys = {c.upper() for c in entry["company_codes"]}
                for comp_code in row_company_codes:
                    if comp_code.upper() not in seen_comp_keys:
                        seen_comp_keys.add(comp_code.upper())
                        entry["company_codes"].append(comp_code)

        # Nạp sẵn khách hàng, cửa hàng và công ty quản lý của NPP (zero N+1)
        existing_customers = db.scalars(
            select(CustomerModel)
            .options(
                selectinload(CustomerModel.company_links),
                selectinload(CustomerModel.addresses),
                selectinload(CustomerModel.contacts),
                selectinload(CustomerModel.store),
            )
            .where(CustomerModel.distributor_id == effective_dist_id)
        ).all()
        existing_by_code = {
            (c.code or "").strip().upper(): c for c in existing_customers if c.code
        }

        stores_by_code = {
            (s.code or "").strip().upper(): s
            for s in db.scalars(
                select(StoreModel).where(StoreModel.distributor_id == effective_dist_id)
            ).all()
            if s.code
        }

        companies_all = db.scalars(
            select(CompanyModel).where(CompanyModel.distributor_id == effective_dist_id)
        ).all()
        companies_by_code = {
            (c.code or "").strip().upper(): c for c in companies_all if c.code
        }
        companies_by_tax_code = {
            (c.tax_code or "").strip().upper(): c for c in companies_all if c.tax_code
        }
        companies_by_name = {
            (c.name or "").strip().upper(): c for c in companies_all if c.name
        }

        created = 0
        updated = 0

        for code_key, entry in grouped_rows.items():
            existing = existing_by_code.get(code_key)
            row_number = entry["row_number"]

            if existing is None and not entry["name"]:
                raise HTTPException(
                    status_code=400,
                    detail=f"Dòng {row_number}: tên khách hàng không được để trống khi thêm mới mã {entry['code']}.",
                )

            # Liên kết cửa hàng trong cùng NPP
            store_obj = None
            store_code = entry["store_code"]
            store_route = entry["store_route"]
            if store_code:
                store_key = store_code.upper()
                store_obj = stores_by_code.get(store_key)
                if store_obj is None:
                    store_obj = StoreModel(
                        distributor_id=effective_dist_id,
                        code=store_code,
                        name=entry["name"] or (existing.name if existing else store_code),
                        route=store_route or None,
                    )
                    db.add(store_obj)
                    db.flush()
                    stores_by_code[store_key] = store_obj
                elif store_route:
                    store_obj.route = store_route
            elif store_route and existing is not None and existing.store is not None:
                existing.store.route = store_route

            # Phân giải danh sách nhiều Công ty quản lý (cùng NPP)
            resolved_company_ids: list[int] = []
            for comp_token in entry["company_codes"]:
                comp_key = comp_token.upper()
                comp_obj = (
                    companies_by_code.get(comp_key)
                    or companies_by_tax_code.get(comp_key)
                    or companies_by_name.get(comp_key)
                )
                if comp_obj is None:
                    comp_obj = CompanyModel(
                        distributor_id=effective_dist_id,
                        code=comp_token,
                        name=comp_token,
                    )
                    db.add(comp_obj)
                    db.flush()
                    companies_by_code[comp_key] = comp_obj
                if comp_obj.id not in resolved_company_ids:
                    resolved_company_ids.append(comp_obj.id)

            # Kiểm tra NVQL nếu có nhập
            manager_pair = None
            if entry["manager_code"]:
                manager_pair = crud.resolve_manager_assignment(db, entry["manager_code"])

            if existing is not None:
                # Cập nhật thông tin khách hàng đã tồn tại theo các cột có dữ liệu trong file
                if entry["name"]:
                    existing.name = entry["name"]
                if entry["type"]:
                    existing.type = entry["type"]
                if entry["tier"]:
                    existing.tier = entry["tier"]
                if entry["phone"]:
                    existing.phone = entry["phone"]
                if entry["email"]:
                    existing.email = entry["email"]
                if entry["citizen_id"]:
                    existing.citizen_id = entry["citizen_id"]
                if entry["tax_code"]:
                    existing.tax_code = entry["tax_code"]
                if entry["staff_code"]:
                    existing.staff_code = entry["staff_code"]
                if entry["staff_name"]:
                    existing.staff_name = entry["staff_name"]
                if manager_pair is not None:
                    existing.manager_code, existing.manager_name = manager_pair
                if entry["credit_limit"] is not None:
                    existing.credit_limit = entry["credit_limit"]
                if entry["status"]:
                    existing.status = entry["status"]
                if store_obj is not None:
                    existing.store_id = store_obj.id

                if resolved_company_ids:
                    if company_update_mode == "replace":
                        crud.sync_customer_companies(db, existing, resolved_company_ids)
                    else:
                        next_company_ids = list(existing.company_ids)
                        for cid in resolved_company_ids:
                            if cid not in next_company_ids:
                                next_company_ids.append(cid)
                        crud.sync_customer_companies(db, existing, next_company_ids)

                if entry["invoice_address"]:
                    default_addr = next(
                        (a for a in existing.addresses if a.is_default),
                        existing.addresses[0] if existing.addresses else None,
                    )
                    if default_addr is not None:
                        default_addr.address = entry["invoice_address"]
                    else:
                        db.add(CustomerAddress(
                            customer_id=existing.id,
                            label="Địa chỉ hóa đơn",
                            address=entry["invoice_address"],
                            district="",
                            city="",
                            is_default=True,
                        ))
                if entry["invoice_name"]:
                    primary_contact = next(
                        (c for c in existing.contacts if c.is_primary),
                        existing.contacts[0] if existing.contacts else None,
                    )
                    if primary_contact is not None:
                        primary_contact.name = entry["invoice_name"]
                    else:
                        db.add(CustomerContact(
                            customer_id=existing.id,
                            name=entry["invoice_name"],
                            phone=entry["phone"] or "",
                            position="Tên trên hóa đơn",
                            is_primary=True,
                        ))
                updated += 1
            else:
                customer = CustomerModel(
                    distributor_id=effective_dist_id,
                    code=entry["code"],
                    name=entry["name"],
                    type=entry["type"] or "RETAIL",
                    tier=entry["tier"] or "B",
                    phone=entry["phone"],
                    email=entry["email"],
                    citizen_id=entry["citizen_id"],
                    tax_code=entry["tax_code"],
                    staff_code=entry["staff_code"],
                    staff_name=entry["staff_name"],
                    manager_code=manager_pair[0] if manager_pair else None,
                    manager_name=manager_pair[1] if manager_pair else None,
                    credit_limit=entry["credit_limit"] if entry["credit_limit"] is not None else 0.0,
                    status=entry["status"] or "active",
                    store_id=store_obj.id if store_obj else None,
                    company_id=resolved_company_ids[0] if resolved_company_ids else None,
                )
                db.add(customer)
                db.flush()
                if resolved_company_ids:
                    crud.sync_customer_companies(db, customer, resolved_company_ids)
                if entry["invoice_address"]:
                    db.add(CustomerAddress(
                        customer_id=customer.id,
                        label="Địa chỉ hóa đơn",
                        address=entry["invoice_address"],
                        district="",
                        city="",
                        is_default=True,
                    ))
                if entry["invoice_name"]:
                    db.add(CustomerContact(
                        customer_id=customer.id,
                        name=entry["invoice_name"],
                        phone=entry["phone"] or "",
                        position="Tên trên hóa đơn",
                        is_primary=True,
                    ))
                existing_by_code[code_key] = customer
                created += 1

        db.commit()
        return {
            "imported": created + updated,
            "created": created,
            "updated": updated,
            "distributor_id": effective_dist_id,
        }
    except HTTPException:
        db.rollback()
        raise
    except (ValueError, TypeError) as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Dữ liệu Excel không hợp lệ: {exc}") from exc
    except (InvalidFileException, BadZipFile, OSError) as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Không thể đọc file Excel: {exc}") from exc


class BulkAssignCompanyPayload(BaseModel):
    customer_ids: List[int]
    company_id: int | None = None
    mode: Literal["add", "replace"] = "add"


@router.post("/bulk-assign-company")
def bulk_assign_company(
    payload: BulkAssignCompanyPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Gán hàng loạt Công ty quản lý cho danh sách mã Khách hàng (hỗ trợ nhiều công ty & kiểm tra phạm vi NPP)."""
    if not payload.customer_ids:
        raise HTTPException(status_code=400, detail="Danh sách khách hàng trống.")

    target_company: CompanyModel | None = None
    if payload.company_id is not None:
        target_company = db.get(CompanyModel, payload.company_id)
        if not target_company:
            raise HTTPException(status_code=404, detail="Không tìm thấy Công ty quản lý.")
        ensure_entity_in_distributor_scope(current_user, target_company.distributor_id)

    customers = db.scalars(
        select(CustomerModel)
        .options(selectinload(CustomerModel.company_links))
        .where(CustomerModel.id.in_(payload.customer_ids))
    ).all()
    updated_count = 0
    for cust in customers:
        ensure_entity_in_distributor_scope(current_user, cust.distributor_id)
        if (
            target_company is not None
            and target_company.distributor_id is not None
            and cust.distributor_id is not None
            and target_company.distributor_id != cust.distributor_id
        ):
            raise HTTPException(
                status_code=400,
                detail=f"Khách hàng {cust.code} không thuộc cùng Nhà phân phối với Công ty {target_company.code}.",
            )
        if target_company is None:
            crud.sync_customer_companies(db, cust, [])
        elif payload.mode == "replace":
            crud.sync_customer_companies(db, cust, [target_company.id])
        else:
            next_ids = list(cust.company_ids)
            if target_company.id not in next_ids:
                next_ids.append(target_company.id)
            crud.sync_customer_companies(db, cust, next_ids)
        updated_count += 1

    db.commit()
    return {
        "ok": True,
        "updated": updated_count,
        "company_id": target_company.id if target_company else None,
        "company_name": target_company.name if target_company else None,
        "mode": payload.mode,
    }


@router.get("/", response_model=List[Customer])
def list_customers(
    skip: int = 0,
    limit: int = 100,
    status: str | None = None,
    distributor_id: int | None = Query(None),
    company_id: int | None = Query(None),
    q: str | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    effective_dist_id = resolve_distributor_scope(current_user, distributor_id, require_for_write=False)
    return crud.list_(
        db,
        skip=skip,
        limit=limit,
        status=status,
        distributor_id=effective_dist_id,
        company_id=company_id,
        q=q,
    )


@router.post("/", response_model=Customer, status_code=201)
def create_customer(
    payload: CustomerCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    effective_dist_id = resolve_distributor_scope(
        current_user, payload.distributor_id, require_for_write=True
    )
    scoped_payload = payload.model_copy(update={"distributor_id": effective_dist_id})
    existing = crud.get_by_code(db, scoped_payload.code, distributor_id=effective_dist_id)
    if existing:
        raise HTTPException(status_code=409, detail="Mã khách hàng đã tồn tại trong Nhà phân phối này.")
    try:
        return crud.create(db, scoped_payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{customer_id}", response_model=Customer)
def get_customer(
    customer_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    obj = crud.get(db, customer_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Customer not found")
    ensure_entity_in_distributor_scope(current_user, obj.distributor_id)
    return obj


@router.patch("/{customer_id}", response_model=Customer)
def update_customer(
    customer_id: int,
    payload: CustomerUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    obj = crud.get(db, customer_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Customer not found")
    ensure_entity_in_distributor_scope(current_user, obj.distributor_id)
    if current_user.distributor_id is not None and payload.distributor_id is not None:
        if payload.distributor_id != current_user.distributor_id:
            raise HTTPException(status_code=403, detail="Không thể chuyển khách hàng sang Nhà phân phối khác.")
    try:
        return crud.update(db, obj, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/{customer_id}", status_code=204)
def delete_customer(
    customer_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    obj = crud.get(db, customer_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Customer not found")
    ensure_entity_in_distributor_scope(current_user, obj.distributor_id)
    try:
        crud.delete(db, obj)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return Response(status_code=204)

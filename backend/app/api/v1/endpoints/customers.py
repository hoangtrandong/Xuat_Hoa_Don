from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Response
from io import BytesIO
from openpyxl import Workbook, load_workbook
from openpyxl.utils.exceptions import InvalidFileException
from zipfile import BadZipFile
from sqlalchemy import select
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.schemas.customer import Customer, CustomerCreate, CustomerUpdate
from app.crud import customer as crud
from app.models.customer import Customer as CustomerModel, CustomerAddress, CustomerContact
from app.models.customer import Store as StoreModel, Company as CompanyModel

router = APIRouter(prefix="/customers", tags=["customers"])


CUSTOMER_HEADER_ALIASES = {
    "Mã KH": "code",
    "Tên cửa hàng": "name",
    "Tên khách hàng": "name",
    "Loại": "type",
    "Hạng": "tier",
    "Email": "email",
    "CCCD": "citizen_id",
    "Mã số thuế": "tax_code",
    "Hạn mức công nợ": "credit_limit",
    "Trạng thái": "status",
    "Mã cửa hàng": "store_code",
    "Mã CH": "store_code",
    "Mã công ty quản lý": "company_code",
    "Công ty quản lý": "company_code",
    "Mã công ty": "company_code",
    "Tên trên hoá đơn": "invoice_name",
    "Tên trên hóa đơn": "invoice_name",
    "Địa chỉ trên hoá đơn": "invoice_address",
    "Địa chỉ trên hóa đơn": "invoice_address",
}


def _canonical_customer_headers(headers: list[str]) -> list[str]:
    return [CUSTOMER_HEADER_ALIASES.get(header, header) for header in headers]


@router.get("/template")
def download_customer_template():
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Khách hàng"
    sheet.append([
        "Mã KH",
        "Tên khách hàng",
        "Loại",
        "Email",
        "CCCD",
        "Mã số thuế",
        "Hạn mức công nợ",
        "Trạng thái",
        "Mã cửa hàng",
        "Mã công ty quản lý",
    ])
    sheet.append(["KH-0004", "Tên khách hàng", "RETAIL", "", "", "", 0, "active", "CH-0001", "CT001"])
    output = BytesIO()
    workbook.save(output)
    return Response(content=output.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": 'attachment; filename="mau-khach-hang.xlsx"'})


@router.post("/upload")
def upload_customers(file: UploadFile = File(...), db: Session = Depends(get_db)):
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
        required = {"code", "name"}
        if not required.issubset(headers):
            raise HTTPException(status_code=400, detail=f"Thiếu cột bắt buộc: {', '.join(sorted(required - set(headers)))}")
        imported = 0
        existing_codes = {
            code for code in db.execute(select(CustomerModel.code)).scalars().all()
        }
        file_codes: set[str] = set()
        for row_number, values in enumerate(rows[1:], start=2):
            data = dict(zip(headers, values))
            if not any(value is not None and str(value).strip() for value in values):
                continue
            code = str(data.get("code") or "").strip()
            if not code:
                raise HTTPException(status_code=400, detail=f"Dòng {row_number}: mã khách hàng không được để trống.")
            if not str(data.get("name") or "").strip():
                raise HTTPException(status_code=400, detail=f"Dòng {row_number}: tên khách hàng không được để trống.")
            if code in existing_codes or code in file_codes:
                raise HTTPException(status_code=409, detail=f"Dòng {row_number}: mã khách hàng {code} đã tồn tại.")
            file_codes.add(code)
            # Phase 2: liên kết mã KH với cửa hàng và công ty quản lý (nếu có trong file).
            store_id = None
            store_code = str(data.get("store_code") or "").strip()
            if store_code:
                store_obj = db.query(StoreModel).filter(StoreModel.code == store_code).first()
                if not store_obj:
                    store_obj = StoreModel(
                        code=store_code,
                        name=str(data.get("name") or store_code).strip(),
                    )
                    db.add(store_obj)
                    db.flush()
                store_id = store_obj.id

            company_id = None
            company_code = str(data.get("company_code") or "").strip()
            if company_code:
                company_obj = db.query(CompanyModel).filter(CompanyModel.code == company_code).first()
                if not company_obj:
                    company_obj = CompanyModel(code=company_code, name=company_code)
                    db.add(company_obj)
                    db.flush()
                company_id = company_obj.id

            customer = CustomerModel(
                code=code, name=str(data["name"]).strip(),
                type=str(data.get("type") or "RETAIL").strip().upper(),
                tier=str(data.get("tier") or "B").strip().upper(),
                email=str(data.get("email") or "").strip() or None,
                citizen_id=str(data.get("citizen_id") or "").strip() or None,
                tax_code=str(data.get("tax_code") or "").strip() or None,
                credit_limit=float(data.get("credit_limit") or 0),
                status=str(data.get("status") or "active").strip(),
                store_id=store_id,
                company_id=company_id,
            )
            db.add(customer)
            db.flush()
            invoice_name = str(data.get("invoice_name") or "").strip()
            invoice_address = str(data.get("invoice_address") or "").strip()
            if invoice_address:
                db.add(CustomerAddress(
                    customer_id=customer.id,
                    label="Địa chỉ hóa đơn",
                    address=invoice_address,
                    district="",
                    city="",
                    is_default=True,
                ))
            if invoice_name:
                db.add(CustomerContact(
                    customer_id=customer.id,
                    name=invoice_name,
                    phone="",
                    position="Tên trên hóa đơn",
                    is_primary=True,
                ))
            imported += 1
        db.commit()
        return {"imported": imported}
    except HTTPException:
        db.rollback()
        raise
    except (ValueError, TypeError) as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Dữ liệu Excel không hợp lệ: {exc}") from exc
    except (InvalidFileException, BadZipFile, OSError) as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Không thể đọc file Excel: {exc}") from exc

@router.get("/", response_model=List[Customer])
def list_customers(skip: int = 0, limit: int = 100, status: str | None = None, db: Session = Depends(get_db)):
    return crud.list_(db, skip=skip, limit=limit, status=status)


@router.post("/", response_model=Customer, status_code=201)
def create_customer(payload: CustomerCreate, db: Session = Depends(get_db)):
    existing = crud.get_by_code(db, payload.code)
    if existing:
        raise HTTPException(status_code=409, detail="Customer code already exists")
    return crud.create(db, payload)


@router.get("/{customer_id}", response_model=Customer)
def get_customer(customer_id: int, db: Session = Depends(get_db)):
    obj = crud.get(db, customer_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Customer not found")
    return obj


@router.patch("/{customer_id}", response_model=Customer)
def update_customer(customer_id: int, payload: CustomerUpdate, db: Session = Depends(get_db)):
    obj = crud.get(db, customer_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Customer not found")
    return crud.update(db, obj, payload)


@router.delete("/{customer_id}", status_code=204)
def delete_customer(customer_id: int, db: Session = Depends(get_db)):
    obj = crud.get(db, customer_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Customer not found")
    try:
        crud.delete(db, obj)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return Response(status_code=204)
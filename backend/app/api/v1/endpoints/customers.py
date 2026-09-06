from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Response
from io import BytesIO
from openpyxl import Workbook, load_workbook
from openpyxl.utils.exceptions import InvalidFileException
from zipfile import BadZipFile
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.schemas.customer import Customer, CustomerCreate, CustomerUpdate
from app.crud import customer as crud
from app.models.customer import Customer as CustomerModel

router = APIRouter(prefix="/customers", tags=["customers"])


@router.get("/template")
def download_customer_template():
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Khach hang"
    sheet.append(["code", "name", "type", "tier", "phone", "email", "citizen_id", "tax_code", "credit_limit", "visit_frequency", "status"])
    sheet.append(["KH-0004", "Ten khach hang", "RETAIL", "B", "0900000000", "", "", "", 0, 2, "active"])
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
        headers = [str(value).strip() if value is not None else "" for value in rows[0]]
        required = {"code", "name", "type", "tier", "phone"}
        if not required.issubset(headers):
            raise HTTPException(status_code=400, detail=f"Thiếu cột bắt buộc: {', '.join(sorted(required - set(headers)))}")
        imported = 0
        for row_number, values in enumerate(rows[1:], start=2):
            data = dict(zip(headers, values))
            if not any(value is not None and str(value).strip() for value in values):
                continue
            code = str(data.get("code") or "").strip()
            if not code:
                raise HTTPException(status_code=400, detail=f"Dòng {row_number}: mã khách hàng không được để trống.")
            if not str(data.get("name") or "").strip():
                raise HTTPException(status_code=400, detail=f"Dòng {row_number}: tên khách hàng không được để trống.")
            if crud.get_by_code(db, code):
                raise HTTPException(status_code=409, detail=f"Dòng {row_number}: mã khách hàng {code} đã tồn tại.")
            db.add(CustomerModel(
                code=code, name=str(data["name"]).strip(), type=str(data["type"]).strip().upper(),
                tier=str(data["tier"]).strip().upper(), phone=str(data["phone"]).strip(),
                email=str(data.get("email") or "").strip() or None,
                citizen_id=str(data.get("citizen_id") or "").strip() or None,
                tax_code=str(data.get("tax_code") or "").strip() or None,
                credit_limit=float(data.get("credit_limit") or 0), visit_frequency=int(data.get("visit_frequency") or 2),
                status=str(data.get("status") or "active").strip(),
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
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Response
from io import BytesIO
from openpyxl import Workbook, load_workbook
from openpyxl.utils.exceptions import InvalidFileException
from zipfile import BadZipFile
from sqlalchemy import select
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.schemas.store import Store, StoreCreate, StoreUpdate
from app.crud import store as store_crud
from app.models.customer import Store as StoreModel

router = APIRouter(prefix="/stores", tags=["stores"])


STORE_HEADER_ALIASES = {
    "Mã cửa hàng": "code",
    "Mã CH": "code",
    "Tên cửa hàng": "name",
    "Tên CH": "name",
    "Điện thoại": "phone",
    "Chủ hộ": "owner_name",
    "Chủ cửa hàng": "owner_name",
    "Địa chỉ": "address",
    "Quận": "district",
    "Tỉnh/TP": "city",
    "Thành phố": "city",
    "Trạng thái": "status",
}


def _canonical_headers(headers: list[str], aliases: dict[str, str]) -> list[str]:
    return [aliases.get(header, header) for header in headers]


@router.get("/template")
def download_store_template():
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Cửa hàng"
    sheet.append([
        "Mã cửa hàng",
        "Tên cửa hàng",
        "Điện thoại",
        "Chủ hộ",
        "Địa chỉ",
        "Quận",
        "Tỉnh/TP",
        "Trạng thái",
    ])
    sheet.append(["CH-0001", "Tên cửa hàng", "0900000000", "Chủ hộ", "Địa chỉ", "", "Nghệ An", "active"])
    output = BytesIO()
    workbook.save(output)
    return Response(
        content=output.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="mau-cua-hang.xlsx"'},
    )


@router.post("/upload")
def upload_stores(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="Vui lòng tải lên file Excel .xlsx hoặc .xlsm.")
    try:
        workbook = load_workbook(BytesIO(file.file.read()), read_only=True, data_only=True)
        rows = list(workbook.active.iter_rows(values_only=True))
        if not rows:
            raise HTTPException(status_code=400, detail="File Excel không có dữ liệu.")
        headers = _canonical_headers([
            str(value).strip() if value is not None else "" for value in rows[0]
        ], STORE_HEADER_ALIASES)
        if "code" not in headers or "name" not in headers:
            raise HTTPException(status_code=400, detail="Thiếu cột bắt buộc: Mã cửa hàng / Tên cửa hàng.")

        existing_codes = set(db.execute(select(StoreModel.code)).scalars().all())
        file_codes: set[str] = set()
        imported = 0
        for row_number, values in enumerate(rows[1:], start=2):
            data = dict(zip(headers, values))
            if not any(value is not None and str(value).strip() for value in values):
                continue
            code = str(data.get("code") or "").strip()
            name = str(data.get("name") or "").strip()
            if not code:
                raise HTTPException(status_code=400, detail=f"Dòng {row_number}: mã cửa hàng không được để trống.")
            if not name:
                raise HTTPException(status_code=400, detail=f"Dòng {row_number}: tên cửa hàng không được để trống.")

            if code in existing_codes:
                # Upsert: cập nhật thông tin nếu file gửi mới hơn.
                store = db.query(StoreModel).filter(StoreModel.code == code).first()
                if store:
                    for field in ("name", "phone", "owner_name", "address", "district", "city", "status"):
                        value = str(data.get(field) or "").strip()
                        if value:
                            setattr(store, field, value)
            else:
                if code in file_codes:
                    raise HTTPException(status_code=409, detail=f"Dòng {row_number}: mã cửa hàng {code} lặp trong file.")
                store = StoreModel(
                    code=code,
                    name=name,
                    phone=str(data.get("phone") or "").strip() or None,
                    owner_name=str(data.get("owner_name") or "").strip() or None,
                    address=str(data.get("address") or "").strip() or None,
                    district=str(data.get("district") or "").strip() or None,
                    city=str(data.get("city") or "").strip() or None,
                    status=str(data.get("status") or "active").strip(),
                )
                db.add(store)
                file_codes.add(code)
            imported += 1
        existing_codes = existing_codes | file_codes
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


@router.get("/", response_model=List[Store])
def list_stores(skip: int = 0, limit: int = 1000, status: str | None = None, db: Session = Depends(get_db)):
    return store_crud.list_(db, skip=skip, limit=limit, status=status)


@router.post("/", response_model=Store, status_code=201)
def create_store(payload: StoreCreate, db: Session = Depends(get_db)):
    existing = store_crud.get_by_code(db, payload.code)
    if existing:
        raise HTTPException(status_code=409, detail="Mã cửa hàng đã tồn tại.")
    return store_crud.create(db, payload)


@router.get("/{store_id}", response_model=Store)
def get_store(store_id: int, db: Session = Depends(get_db)):
    store = store_crud.get(db, store_id)
    if not store:
        raise HTTPException(status_code=404, detail="Cửa hàng không tồn tại.")
    return store


@router.patch("/{store_id}", response_model=Store)
def update_store(store_id: int, payload: StoreUpdate, db: Session = Depends(get_db)):
    store = store_crud.get(db, store_id)
    if not store:
        raise HTTPException(status_code=404, detail="Cửa hàng không tồn tại.")
    return store_crud.update(db, store, payload)


@router.delete("/{store_id}", status_code=204)
def delete_store(store_id: int, db: Session = Depends(get_db)):
    store = store_crud.get(db, store_id)
    if not store:
        raise HTTPException(status_code=404, detail="Cửa hàng không tồn tại.")
    store_crud.delete(db, store)
    return Response(status_code=204)
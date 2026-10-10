from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Response
from io import BytesIO
from openpyxl import Workbook, load_workbook
from openpyxl.utils.exceptions import InvalidFileException
from zipfile import BadZipFile
from sqlalchemy import select
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.schemas.company import Company, CompanyCreate, CompanyUpdate
from app.crud import company as company_crud
from app.models.customer import Company as CompanyModel

router = APIRouter(prefix="/companies", tags=["companies"])


COMPANY_HEADER_ALIASES = {
    "Mã công ty": "code",
    "Mã CT": "code",
    "Tên công ty": "name",
    "Tên CT": "name",
    "Mã số thuế": "tax_code",
    "Điện thoại": "phone",
    "Địa chỉ": "address",
    "Trạng thái": "status",
}


def _canonical_headers(headers: list[str], aliases: dict[str, str]) -> list[str]:
    return [aliases.get(header, header) for header in headers]


@router.get("/template")
def download_company_template():
    from app.core.excel_templates import create_smart_template

    output = create_smart_template(
        sheet_title="Công ty",
        headers=["Mã công ty", "Tên công ty", "Mã số thuế", "Điện thoại", "Địa chỉ", "Trạng thái"],
        sub_guides=[
            "Bắt buộc. VD: CT001, CT002 (Không trùng lặp)",
            "Bắt buộc. Tên pháp nhân công ty",
            "Tùy chọn. Nhiều công ty có thể dùng chung MST",
            "Tùy chọn. Số điện thoại liên hệ",
            "Tùy chọn. Địa chỉ đăng ký kinh doanh",
            "Chọn: active / inactive",
        ],
        sample_rows=[
            ["CT001", "Công ty TNHH Phân Phối A", "0102030405", "0243123456", "Số 1 Đại lộ Lê Lợi, TP Vinh", "active"],
            ["CT002", "Công ty CP Thương Mại B", "0102030405", "0243987654", "Số 15 Quang Trung, TP Vinh", "active"],
        ],
        col_widths=[18, 32, 20, 18, 35, 16],
        guide_title="HƯỚNG DẪN NHẬP DANH SÁCH CÔNG TY QUẢN LÝ",
        guide_sections=[
            ("1. Quy tắc chung:", [
                "• Dòng 1: Tiêu đề cột. Dòng 2: Hướng dẫn mờ. Dữ liệu bắt đầu từ dòng 3.",
                "• Nếu Mã công ty đã tồn tại, hệ thống sẽ cập nhật thông tin.",
                "• Nếu Mã công ty chưa tồn tại, hệ thống sẽ thêm mới công ty.",
            ]),
            ("2. Cơ chế dùng chung Mã số thuế (MST):", [
                "• Hệ thống hỗ trợ mô hình nhiều công ty con / chi nhánh dùng chung 1 mã số thuế.",
                "• Nhập đúng MST để hệ thống tự động gom nhóm báo cáo thuế và đối soát công nợ hợp nhất.",
            ]),
        ],
        validations=[("F3:F500", '"active,inactive"', "Chọn trạng thái", "Chỉ chọn active hoặc inactive")],
    )
    return Response(
        content=output.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="mau-cong-ty.xlsx"'},
    )


@router.post("/upload")
def upload_companies(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="Vui lòng tải lên file Excel .xlsx hoặc .xlsm.")
    try:
        workbook = load_workbook(BytesIO(file.file.read()), read_only=True, data_only=True)
        rows = list(workbook.active.iter_rows(values_only=True))
        if not rows:
            raise HTTPException(status_code=400, detail="File Excel không có dữ liệu.")
        headers = _canonical_headers([
            str(value).strip() if value is not None else "" for value in rows[0]
        ], COMPANY_HEADER_ALIASES)
        if "code" not in headers or "name" not in headers:
            raise HTTPException(status_code=400, detail="Thiếu cột bắt buộc: Mã công ty / Tên công ty.")

        existing_codes = set(db.execute(select(CompanyModel.code)).scalars().all())
        file_codes: set[str] = set()
        imported = 0
        for row_number, values in enumerate(rows[1:], start=2):
            data = dict(zip(headers, values))
            if not any(value is not None and str(value).strip() for value in values):
                continue
            code = str(data.get("code") or "").strip()
            name = str(data.get("name") or "").strip()
            # Bỏ qua dòng hướng dẫn phụ nếu giữ nguyên dòng 2 mẫu
            if "Bắt buộc" in code or "VD: CT001" in code or "Tên pháp nhân" in name:
                continue
            if not code:
                raise HTTPException(status_code=400, detail=f"Dòng {row_number}: mã công ty không được để trống.")
            if not name:
                raise HTTPException(status_code=400, detail=f"Dòng {row_number}: tên công ty không được để trống.")

            if code in existing_codes:
                company = db.query(CompanyModel).filter(CompanyModel.code == code).first()
                if company:
                    for field in ("name", "tax_code", "phone", "address", "status"):
                        value = str(data.get(field) or "").strip()
                        if value:
                            setattr(company, field, value)
            else:
                if code in file_codes:
                    raise HTTPException(status_code=409, detail=f"Dòng {row_number}: mã công ty {code} lặp trong file.")
                company = CompanyModel(
                    code=code,
                    name=name,
                    tax_code=str(data.get("tax_code") or "").strip() or None,
                    phone=str(data.get("phone") or "").strip() or None,
                    address=str(data.get("address") or "").strip() or None,
                    status=str(data.get("status") or "active").strip(),
                )
                db.add(company)
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


@router.get("/", response_model=List[Company])
def list_companies(
    skip: int = 0,
    limit: int = 1000,
    status: str | None = None,
    db: Session = Depends(get_db),
):
    return company_crud.list_(db, skip=skip, limit=limit, status=status)


@router.post("/", response_model=Company, status_code=201)
def create_company(payload: CompanyCreate, db: Session = Depends(get_db)):
    existing = company_crud.get_by_code(db, payload.code)
    if existing:
        raise HTTPException(status_code=409, detail="Mã công ty đã tồn tại.")
    return company_crud.create(db, payload)


@router.get("/{company_id}", response_model=Company)
def get_company(company_id: int, db: Session = Depends(get_db)):
    obj = company_crud.get(db, company_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Công ty không tồn tại.")
    return obj


@router.patch("/{company_id}", response_model=Company)
def update_company(company_id: int, payload: CompanyUpdate, db: Session = Depends(get_db)):
    obj = company_crud.get(db, company_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Công ty không tồn tại.")
    return company_crud.update(db, obj, payload)


@router.delete("/{company_id}", status_code=204)
def delete_company(company_id: int, db: Session = Depends(get_db)):
    obj = company_crud.get(db, company_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Công ty không tồn tại.")
    company_crud.delete(db, obj)
    return Response(status_code=204)
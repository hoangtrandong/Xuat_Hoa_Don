from io import BytesIO
import secrets
from typing import List
from zipfile import BadZipFile

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils.exceptions import InvalidFileException
from openpyxl.worksheet.datavalidation import DataValidation
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import get_current_user
from app.crud import employee as crud
from app.crud.user import create_user, update_user
from app.models.employee import Employee as EmployeeModel
from app.models.user import Role, User
from app.schemas.employee import (
    Employee,
    EmployeeAccountSetupRequest,
    EmployeeCreate,
    EmployeeCreated,
    EmployeeCreateRequest,
    EmployeeUpdate,
)
from app.schemas.debt_ledger import EmployeeDebtLimitChangeOut
from app.schemas.user import UserCreate, UserUpdate

router = APIRouter(prefix="/employees", tags=["employees"])

EMPLOYEE_HEADER_ALIASES = {
    "Mã nhân viên": "code",
    "Mã NV": "code",
    "Họ và tên": "name",
    "Tên nhân viên": "name",
    "Tên NV": "name",
    "Tên gọi": "nickname",
    "Biệt danh": "nickname",
    "Tên": "nickname",
    "Vị trí": "position",
    "Chức vụ": "position",
    "Số điện thoại": "phone",
    "Điện thoại": "phone",
    "SĐT": "phone",
    "Email": "email",
    "Mục tiêu tháng": "target",
    "Mục tiêu": "target",
    "Hạn mức nợ": "debt_limit",
    "Trạng thái": "status",
    "Mã DMS": "vinamilk_code",
    "Mã Vinamilk": "vinamilk_code",
    "Mã NV DMS": "vinamilk_code",
    "Tạo tài khoản": "create_account",
    "Tạo TK": "create_account",
    "Cấp tài khoản": "create_account",
    "create_account": "create_account",
    "Mật khẩu": "password",
    "Mật khẩu đăng nhập": "password",
    "Password": "password",
    "password": "password",
}

TRUTHY_ACCOUNT_VALUES = {"có", "co", "yes", "y", "1", "true", "x", "tạo", "tao"}

STATUS_ALIASES = {
    "active": "active", "đang làm việc": "active", "đang làm": "active",
    "inactive": "inactive", "đã nghỉ": "inactive", "nghỉ việc": "inactive", "nghỉ": "inactive",
}


def _to_response(obj) -> Employee:
    return Employee(
        id=obj.id,
        code=obj.code,
        name=obj.name,
        nickname=getattr(obj, "nickname", None),
        position=obj.position,
        phone=obj.phone,
        email=obj.email,
        territory_id=obj.territory_id,
        target=float(obj.target),
        debt_limit=float(obj.debt_limit if obj.debt_limit is not None else 500000000.0),
        vinamilk_code=obj.vinamilk_code,
        status=obj.status,
        join_date=obj.join_date,
        account_username=obj.user.username if obj.user else None,
        account_user_id=obj.user.id if obj.user else None,
        account_is_active=bool(obj.user.is_active) if obj.user else None,
    )


def _cell_text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return str(value).strip()


def _phone_text(value) -> str:
    text = _cell_text(value)
    # Excel hay làm mất số 0 đầu của số điện thoại khi ô được lưu dạng số.
    if text.isdigit() and len(text) == 9:
        text = "0" + text
    return text


def _number(value, label: str, row_number: int) -> float:
    text = _cell_text(value).replace(",", "")
    if not text:
        return 0.0
    try:
        return float(text)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Dòng {row_number}: {label} không hợp lệ.")


@router.get("/template")
def download_employee_template():
    workbook = Workbook()

    # --- SHEET 1: NHẬP LIỆU NHÂN VIÊN ---
    sheet = workbook.active
    sheet.title = "Nhân viên"

    # Định dạng style
    header_fill = PatternFill(start_color="1E40AF", end_color="1E40AF", fill_type="solid")  # Xanh navy đậm
    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    guide_fill = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")   # Xám nhạt
    guide_font = Font(name="Calibri", size=9, italic=True, color="475569")
    center_align = Alignment(horizontal="center", vertical="center", wrap_text=True)
    left_align = Alignment(horizontal="left", vertical="center", wrap_text=True)
    thin_border = Border(
        left=Side(style="thin", color="CBD5E1"),
        right=Side(style="thin", color="CBD5E1"),
        top=Side(style="thin", color="CBD5E1"),
        bottom=Side(style="thin", color="CBD5E1"),
    )

    headers = [
        "Mã nhân viên", "Họ và tên", "Tên gọi", "Vị trí", "Số điện thoại", "Email",
        "Mục tiêu tháng", "Hạn mức nợ", "Trạng thái", "Tạo tài khoản", "Mật khẩu",
    ]
    sub_guides = [
        "Bắt buộc. VD: NV001, KT001 (Không trùng, không dấu cách)",
        "Bắt buộc. Họ và tên đầy đủ",
        "Tùy chọn. Tên thường gọi / biệt danh (VD: Trung NPP, Tịnh xe...)",
        "Bắt buộc. Chọn từ danh sách thả xuống",
        "Bắt buộc. Số điện thoại (từ 10 số)",
        "Tùy chọn. VD: user@dms.vn",
        "VNĐ. Để 0 nếu khối văn phòng",
        "VNĐ. Mặc định 500,000,000 cho mỗi nhân viên",
        "Chọn: active / inactive",
        "Tùy chọn. Nhập 'Có' để tạo TK (tên ĐN = Mã NV)",
        "Tùy chọn (>= 6 ký tự). Nhập MK sẽ tự tạo TK / đổi MK",
    ]

    # Hàng 1: Tiêu đề cột
    sheet.append(headers)
    sheet.row_dimensions[1].height = 28
    for col_idx in range(1, len(headers) + 1):
        cell = sheet.cell(row=1, column=col_idx)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = center_align
        cell.border = thin_border

    # Hàng 2: Hướng dẫn chi tiết ngay dưới tiêu đề
    sheet.append(sub_guides)
    sheet.row_dimensions[2].height = 24
    for col_idx in range(1, len(sub_guides) + 1):
        cell = sheet.cell(row=2, column=col_idx)
        cell.fill = guide_fill
        cell.font = guide_font
        cell.alignment = left_align
        cell.border = thin_border

    # Dòng mẫu
    sample_rows = [
        ["NV001", "Mai Chí Trung", "Trung NPP", "Admin", "0912345678", "trung@dms.vn", 0, 500000000, "active", "Có", "123456"],
        ["NV004", "Nguyễn Duy Tịnh", "Tịnh xe", "Đội xe", "0987654321", "tinh@dms.vn", 0, 500000000, "active", "Có", "123456"],
        ["NV026", "Trần Hồng Sơn", "Sơn VNM", "NVKD Sữa Vinamilk", "0901234567", "", 120000000, 500000000, "active", "", ""],
    ]
    for row_idx, r in enumerate(sample_rows, start=3):
        sheet.append(r)
        sheet.row_dimensions[row_idx].height = 22
        for col_idx in range(1, len(r) + 1):
            cell = sheet.cell(row=row_idx, column=col_idx)
            cell.border = thin_border
            cell.alignment = left_align

    # Căn độ rộng các cột tự động thoáng đẹp
    col_widths = [18, 26, 18, 24, 18, 26, 20, 22, 16, 18, 20]
    for idx, width in enumerate(col_widths, start=1):
        col_letter = sheet.cell(row=1, column=idx).column_letter
        sheet.column_dimensions[col_letter].width = width

    # Thêm Dropdown chọn Vị trí (Áp dụng từ dòng 3 đến dòng 500)
    dv_pos = DataValidation(
        type="list",
        formula1='"Admin,Sales Admin,Đội xe,Thủ kho,Kế toán nội bộ,Kế toán thuế,NVKD Sữa Vinamilk,NVKD Gấu Đỏ,NVKD Nutricare,NVKD Nabati,NVKD Bỉm Mofix,NVKD Thanh An,NVKD Xilitol,Nhân viên kinh doanh"',
        allow_blank=True,
    )
    dv_pos.error = "Vui lòng chọn 1 trong các vị trí hợp lệ trong danh sách"
    dv_pos.errorTitle = "Vị trí không hợp lệ"
    dv_pos.prompt = "Chọn vị trí nhân viên từ danh sách"
    dv_pos.promptTitle = "Chọn Vị trí"
    sheet.add_data_validation(dv_pos)
    dv_pos.add("D3:D500")

    # Thêm Dropdown chọn Trạng thái (Áp dụng từ dòng 3 đến dòng 500)
    dv_status = DataValidation(
        type="list",
        formula1='"active,inactive"',
        allow_blank=True,
    )
    dv_status.error = "Trạng thái chỉ nhận: active (hoạt động) hoặc inactive (đã nghỉ)"
    dv_status.errorTitle = "Trạng thái không hợp lệ"
    sheet.add_data_validation(dv_status)
    dv_status.add("I3:I500")

    dv_acc = DataValidation(
        type="list",
        formula1='"Có,Không"',
        allow_blank=True,
    )
    sheet.add_data_validation(dv_acc)
    dv_acc.add("J3:J500")

    # --- SHEET 2: HƯỚNG DẪN SỬ DỤNG CHI TIẾT ---
    sheet_guide = workbook.create_sheet(title="Hướng dẫn sử dụng")
    guide_title_font = Font(name="Calibri", size=13, bold=True, color="1E40AF")
    section_font = Font(name="Calibri", size=11, bold=True, color="0F172A")
    normal_font = Font(name="Calibri", size=10, color="334155")

    sheet_guide["A1"] = "HƯỚNG DẪN NHẬP DỮ LIỆU NHÂN VIÊN TỪ EXCEL"
    sheet_guide["A1"].font = guide_title_font
    sheet_guide.row_dimensions[1].height = 28

    guide_lines = [
        ("1. Quy tắc chung:", [
            "• Hệ thống bắt đầu đọc dữ liệu từ dòng số 3 (dòng 2 là hướng dẫn, không xóa dòng 1 và 2).",
            "• Nếu mã nhân viên đã tồn tại trong hệ thống, dữ liệu mới trong file Excel sẽ cập nhật cho nhân viên đó.",
            "• Nếu mã nhân viên chưa có, hệ thống sẽ tự động thêm mới.",
            "• Các ô trống (trừ mã và tên) sẽ giữ nguyên dữ liệu hiện tại khi cập nhật.",
        ]),
        ("2. Các vị trí nhân viên & Ý nghĩa:", [
            "• Nhân viên kinh doanh: Người trực tiếp nhận hàng xuất từ phiếu Excel, chịu công nợ giao hàng và KPI doanh số.",
            "• Admin: Quản trị toàn bộ hệ thống, người dùng và dữ liệu.",
            "• Sales Admin: Người phụ trách nạp file Excel Vinamilk, tạo phiếu giao xuất và phân bổ hàng cho NVKD.",
            "• Kế toán: Quản lý công nợ, thu tiền, duyệt công nợ và đối soát sổ sách.",
            "• Thủ kho: Quản lý tồn kho thực tế, kiểm soát lô HSD/FEFO và nhận hàng trả về.",
        ]),
        ("3. Quy tắc các trường thông tin:", [
            "• Mã nhân viên: Bắt buộc, tối thiểu 3 ký tự (Ví dụ: NV001, KT001, ADM01). Không chứa dấu hoặc khoảng trắng.",
            "• Họ và tên: Bắt buộc, họ tên đầy đủ tiếng Việt.",
            "• Số điện thoại: Bắt buộc, định dạng số liên hệ (từ 10 số).",
            "• Hạn mức nợ: Số tiền nợ tối đa được phép nhận hàng, mặc định 500,000,000 cho mỗi nhân viên.",
            "• Trạng thái: 'active' (đang làm việc) hoặc 'inactive' (đã nghỉ - hệ thống sẽ tự động khóa tài khoản đăng nhập).",
            "• Tạo tài khoản: Nhập 'Có' (hoặc Yes/1/X) để tạo tài khoản đăng nhập với Tên đăng nhập = Mã nhân viên.",
            "• Mật khẩu: Tối thiểu 6 ký tự (VD: 123456). Nếu nhập cột Mật khẩu, hệ thống tự động tạo tài khoản (hoặc đổi mật khẩu nếu đã có tài khoản).",
        ]),
    ]

    cur_row = 3
    for title, points in guide_lines:
        cell_t = sheet_guide.cell(row=cur_row, column=1, value=title)
        cell_t.font = section_font
        cur_row += 1
        for p in points:
            cell_p = sheet_guide.cell(row=cur_row, column=1, value=p)
            cell_p.font = normal_font
            cur_row += 1
        cur_row += 1

    sheet_guide.column_dimensions["A"].width = 110

    output = BytesIO()
    workbook.save(output)
    return Response(
        content=output.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="mau-nhan-vien.xlsx"'},
    )


@router.post("/upload")
def upload_employees(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Thêm mới nhân viên từ Excel; mã đã tồn tại thì cập nhật các ô có dữ liệu."""
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="Vui lòng tải lên file Excel .xlsx hoặc .xlsm.")
    try:
        workbook = load_workbook(BytesIO(file.file.read()), read_only=True, data_only=True)
        rows = list(workbook.active.iter_rows(values_only=True))
        if not rows:
            raise HTTPException(status_code=400, detail="File Excel không có dữ liệu.")
        headers = [EMPLOYEE_HEADER_ALIASES.get(_cell_text(v), _cell_text(v)) for v in rows[0]]
        if "code" not in headers or "name" not in headers:
            raise HTTPException(status_code=400, detail="Thiếu cột bắt buộc: Mã nhân viên / Họ và tên.")

        existing = {e.code.upper(): e for e in db.query(EmployeeModel).all()}
        seen: set[str] = set()
        created = updated = accounts_created = accounts_updated = 0
        for row_number, values in enumerate(rows[1:], start=2):
            if not any(v is not None and str(v).strip() for v in values):
                continue
            data = dict(zip(headers, values))
            code = _cell_text(data.get("code"))
            name = _cell_text(data.get("name"))
            # Bỏ qua dòng hướng dẫn phụ nếu người dùng giữ nguyên dòng 2 của template mẫu
            if "Bắt buộc" in code or "VD: NV001" in code or "Họ và tên đầy đủ" in name:
                continue
            if not code:
                raise HTTPException(status_code=400, detail=f"Dòng {row_number}: mã nhân viên không được để trống.")
            if not name:
                raise HTTPException(status_code=400, detail=f"Dòng {row_number}: họ tên không được để trống.")
            if code.upper() in seen:
                raise HTTPException(status_code=409, detail=f"Dòng {row_number}: mã {code} lặp trong file.")
            seen.add(code.upper())

            status_raw = _cell_text(data.get("status"))
            status = STATUS_ALIASES.get(status_raw.lower()) if status_raw else None
            if status_raw and not status:
                raise HTTPException(status_code=400, detail=f"Dòng {row_number}: trạng thái '{status_raw}' không hợp lệ.")

            create_acc_raw = _cell_text(data.get("create_account")).lower()
            password_raw = _cell_text(data.get("password"))
            if password_raw and len(password_raw) < 6:
                raise HTTPException(
                    status_code=400,
                    detail=f"Dòng {row_number} ({code}): mật khẩu phải có tối thiểu 6 ký tự.",
                )
            want_account = (create_acc_raw in TRUTHY_ACCOUNT_VALUES) or bool(password_raw)

            fields = {
                "name": name,
                "nickname": _cell_text(data.get("nickname")),
                "position": _cell_text(data.get("position")),
                "phone": _phone_text(data.get("phone")),
                "email": _cell_text(data.get("email")),
                "vinamilk_code": _cell_text(data.get("vinamilk_code")).upper(),
            }
            target = _cell_text(data.get("target"))
            debt_limit = _cell_text(data.get("debt_limit"))

            obj = existing.get(code.upper())
            if obj:
                for key, value in fields.items():
                    if value:
                        setattr(obj, key, value)
                if target:
                    obj.target = _number(target, "mục tiêu", row_number)
                if debt_limit:
                    new_limit = _number(debt_limit, "hạn mức nợ", row_number)
                    crud.record_debt_limit_change(
                        db,
                        obj,
                        new_limit,
                        f"Cập nhật qua import Excel dòng {row_number}",
                        current_user.username,
                    )
                    obj.debt_limit = new_limit
                if status:
                    obj.status = status
                updated += 1
            else:
                obj = EmployeeModel(
                    code=code,
                    name=name,
                    nickname=fields["nickname"] or None,
                    position=fields["position"] or "Nhân viên kinh doanh",
                    phone=fields["phone"],
                    email=fields["email"] or None,
                    vinamilk_code=fields["vinamilk_code"] or None,
                    target=_number(target, "mục tiêu", row_number),
                    debt_limit=_number(debt_limit, "hạn mức nợ", row_number) if debt_limit else 500000000.0,
                    status=status or "active",
                )
                db.add(obj)
                db.flush()
                existing[code.upper()] = obj
                created += 1

            if want_account:
                if obj.user is None:
                    _provision_account_for_employee(
                        db,
                        obj,
                        password_raw or None,
                        getattr(current_user, "distributor_id", None),
                    )
                    accounts_created += 1
                elif password_raw:
                    update_user(db, obj.user.id, UserUpdate(password=password_raw))
                    accounts_updated += 1
        db.commit()
        return {
            "created": created,
            "updated": updated,
            "imported": created + updated,
            "accounts_created": accounts_created,
            "accounts_updated": accounts_updated,
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


@router.get("/", response_model=List[Employee])
def list_employees(skip: int = 0, limit: int = 100, status: str | None = None, db: Session = Depends(get_db)):
    return [_to_response(obj) for obj in crud.list_(db, skip=skip, limit=limit, status=status)]


POSITION_ROLE_MAP = {
    "Admin": "admin",
    "Sales Admin": "sales_admin",
    "Kế toán": "accountant",
    "Thủ kho": "warehouse",
    "Nhân viên kinh doanh": "staff",
}


def _resolve_password(raw_password: str | None) -> str:
    pw = (raw_password or "").strip()
    if pw:
        if len(pw) < 6:
            raise HTTPException(status_code=400, detail="Mật khẩu phải có tối thiểu 6 ký tự.")
        return pw
    return secrets.token_urlsafe(12)  # 16 ký tự ngẫu nhiên


def _provision_account_for_employee(
    db: Session,
    employee: EmployeeModel,
    raw_password: str | None,
    distributor_id: int | None,
) -> tuple[str, str]:
    username = (employee.code or "").strip()
    if len(username) < 3:
        raise HTTPException(
            status_code=400,
            detail="Mã nhân viên cần tối thiểu 3 ký tự để làm tên đăng nhập.",
        )
    email = (employee.email or "").strip() or f"{username.lower()}@noemail.local"
    if db.scalar(select(User.id).where(User.username == username)):
        raise HTTPException(status_code=409, detail=f"Tên đăng nhập '{username}' đã tồn tại.")
    if db.scalar(select(User.id).where(User.email == email)):
        email = f"{username.lower()}.{employee.id}@noemail.local"

    password = _resolve_password(raw_password)
    role_name = POSITION_ROLE_MAP.get(employee.position, "staff")
    assigned_role = db.scalar(select(Role).where(Role.name == role_name)) or db.scalar(
        select(Role).where(Role.name == "staff")
    )
    try:
        create_user(
            db,
            UserCreate(
                username=username,
                email=email,
                full_name=employee.name,
                password=password,
                role_ids=[assigned_role.id] if assigned_role else [],
                employee_id=employee.id,
                distributor_id=distributor_id,
            ),
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=f"Không tạo được tài khoản: {exc}") from exc
    return username, password


@router.post("/", response_model=EmployeeCreated, status_code=201)
def create_employee(
    payload: EmployeeCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if crud.get_by_code(db, payload.code):
        raise HTTPException(status_code=409, detail="Mã nhân viên đã tồn tại.")

    username = password = None
    if payload.create_account:
        check_username = payload.code.strip()
        if len(check_username) < 3:
            raise HTTPException(status_code=400, detail="Mã nhân viên cần tối thiểu 3 ký tự để làm tên đăng nhập.")
        if db.scalar(select(User.id).where(User.username == check_username)):
            raise HTTPException(status_code=409, detail=f"Tên đăng nhập '{check_username}' đã tồn tại.")
        if payload.account_password and len(payload.account_password.strip()) < 6:
            raise HTTPException(status_code=400, detail="Mật khẩu phải có tối thiểu 6 ký tự.")

    employee = crud.create(
        db,
        EmployeeCreate(**payload.model_dump(exclude={"create_account", "account_password"})),
    )

    if payload.create_account:
        username, password = _provision_account_for_employee(
            db,
            employee,
            payload.account_password,
            getattr(current_user, "distributor_id", None),
        )
        employee = crud.get(db, employee.id)

    return EmployeeCreated(
        **_to_response(employee).model_dump(),
        initial_username=username,
        initial_password=password,
    )


@router.post("/{employee_id}/account", response_model=EmployeeCreated)
def setup_or_update_employee_account(
    employee_id: int,
    payload: EmployeeAccountSetupRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Cấp tài khoản đăng nhập (tên đăng nhập = Mã NV) hoặc đặt lại mật khẩu / bật-khóa tài khoản."""
    employee = crud.get(db, employee_id)
    if not employee:
        raise HTTPException(status_code=404, detail="Không tìm thấy nhân viên.")

    if employee.user is None:
        username, password = _provision_account_for_employee(
            db,
            employee,
            payload.password,
            getattr(current_user, "distributor_id", None),
        )
        if payload.is_active is False:
            employee = crud.get(db, employee_id)
            if employee and employee.user:
                update_user(db, employee.user.id, UserUpdate(is_active=False))
        employee = crud.get(db, employee_id)
        return EmployeeCreated(
            **_to_response(employee).model_dump(),
            initial_username=username,
            initial_password=password,
        )

    # Đã có tài khoản -> cập nhật mật khẩu / trạng thái kích hoạt
    new_password: str | None = None
    if payload.password is not None and payload.password.strip() != "":
        pw = payload.password.strip()
        if len(pw) < 6:
            raise HTTPException(status_code=400, detail="Mật khẩu phải có tối thiểu 6 ký tự.")
        new_password = pw

    if new_password is None and payload.is_active is None:
        raise HTTPException(
            status_code=400,
            detail="Vui lòng nhập mật khẩu mới hoặc chọn thay đổi trạng thái tài khoản.",
        )

    update_user(
        db,
        employee.user.id,
        UserUpdate(
            password=new_password,
            is_active=payload.is_active,
        ),
    )
    employee = crud.get(db, employee_id)
    return EmployeeCreated(
        **_to_response(employee).model_dump(),
        initial_username=employee.user.username if employee and employee.user else None,
        initial_password=new_password,
    )


@router.get("/{employee_id}", response_model=Employee)
def get_employee(employee_id: int, db: Session = Depends(get_db)):
    obj = crud.get(db, employee_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Employee not found")
    return _to_response(obj)


@router.patch("/{employee_id}", response_model=Employee)
def update_employee(
    employee_id: int,
    payload: EmployeeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if payload.code is not None:
        clash = crud.get_by_code(db, payload.code)
        if clash and clash.id != employee_id:
            raise HTTPException(status_code=409, detail="Mã nhân viên đã tồn tại.")
    try:
        obj = crud.update(db, employee_id, payload, changed_by=current_user.username)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not obj:
        raise HTTPException(status_code=404, detail="Employee not found")
    return _to_response(obj)


@router.get("/{employee_id}/debt-limit-history", response_model=List[EmployeeDebtLimitChangeOut])
def get_employee_debt_limit_history(
    employee_id: int,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not crud.get(db, employee_id):
        raise HTTPException(status_code=404, detail="Employee not found")
    return crud.list_debt_limit_changes(db, employee_id, limit)


@router.delete("/{employee_id}", status_code=204)
def delete_employee(employee_id: int, db: Session = Depends(get_db)):
    obj = crud.get(db, employee_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Employee not found")
    used = crud.usage_summary(db, employee_id)
    if used:
        raise HTTPException(
            status_code=409,
            detail="Nhân viên đã có dữ liệu liên quan (" + ", ".join(used)
            + ") nên không thể xóa. Hãy chuyển sang trạng thái 'Đã nghỉ' thay vì xóa.",
        )
    crud.delete(db, obj)
    return Response(status_code=204)
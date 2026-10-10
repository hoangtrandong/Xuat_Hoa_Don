from io import BytesIO
from typing import Any, List, Optional, Tuple
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.worksheet.datavalidation import DataValidation


# Bảng màu & Style chuẩn cho toàn bộ hệ sinh thái DMS
HEADER_FILL = PatternFill(start_color="1E40AF", end_color="1E40AF", fill_type="solid")  # Xanh Navy đậm
HEADER_FONT = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
GUIDE_FILL = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")   # Xám nhạt dịu mắt
GUIDE_FONT = Font(name="Calibri", size=9, italic=True, color="475569")
SAMPLE_FONT = Font(name="Calibri", size=10, color="0F172A")

CENTER_ALIGN = Alignment(horizontal="center", vertical="center", wrap_text=True)
LEFT_ALIGN = Alignment(horizontal="left", vertical="center", wrap_text=True)
RIGHT_ALIGN = Alignment(horizontal="right", vertical="center", wrap_text=True)

THIN_BORDER = Border(
    left=Side(style="thin", color="CBD5E1"),
    right=Side(style="thin", color="CBD5E1"),
    top=Side(style="thin", color="CBD5E1"),
    bottom=Side(style="thin", color="CBD5E1"),
)


def create_smart_template(
    sheet_title: str,
    headers: List[str],
    sub_guides: List[str],
    sample_rows: List[List[Any]],
    col_widths: List[int],
    guide_title: str,
    guide_sections: List[Tuple[str, List[str]]],
    validations: Optional[List[Tuple[str, str, str, str]]] = None,  # (cell_range, formula, prompt, error)
) -> BytesIO:
    """Tạo workbook chuẩn hóa 2 sheet: Nhập liệu (có dropdown, guide row) + Hướng dẫn chi tiết."""
    wb = Workbook()

    # --- SHEET 1: NHẬP LIỆU ---
    ws = wb.active
    ws.title = sheet_title

    # 1. Hàng tiêu đề
    ws.append(headers)
    ws.row_dimensions[1].height = 28
    for col_idx in range(1, len(headers) + 1):
        cell = ws.cell(row=1, column=col_idx)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = CENTER_ALIGN
        cell.border = THIN_BORDER

    # 2. Hàng hướng dẫn mờ ngay dưới tiêu đề
    ws.append(sub_guides)
    ws.row_dimensions[2].height = 24
    for col_idx in range(1, len(sub_guides) + 1):
        cell = ws.cell(row=2, column=col_idx)
        cell.fill = GUIDE_FILL
        cell.font = GUIDE_FONT
        cell.alignment = LEFT_ALIGN
        cell.border = THIN_BORDER

    # 3. Các dòng dữ liệu mẫu
    for row_idx, r in enumerate(sample_rows, start=3):
        ws.append(r)
        ws.row_dimensions[row_idx].height = 22
        for col_idx in range(1, len(r) + 1):
            cell = ws.cell(row=row_idx, column=col_idx)
            cell.border = THIN_BORDER
            cell.font = SAMPLE_FONT
            cell.alignment = LEFT_ALIGN

    # 4. Độ rộng cột
    for idx, width in enumerate(col_widths, start=1):
        col_letter = ws.cell(row=1, column=idx).column_letter
        ws.column_dimensions[col_letter].width = width

    # 5. Các dropdown validation
    if validations:
        for cell_range, formula, prompt, error in validations:
            dv = DataValidation(type="list", formula1=formula, allow_blank=True)
            dv.prompt = prompt
            dv.promptTitle = "Chọn giá trị hợp lệ"
            dv.error = error
            dv.errorTitle = "Giá trị không hợp lệ"
            ws.add_data_validation(dv)
            dv.add(cell_range)

    # --- SHEET 2: HƯỚNG DẪN CHI TIẾT ---
    ws_guide = wb.create_sheet(title="Hướng dẫn sử dụng")
    ws_guide["A1"] = guide_title
    ws_guide["A1"].font = Font(name="Calibri", size=13, bold=True, color="1E40AF")
    ws_guide.row_dimensions[1].height = 28

    cur_row = 3
    for title, points in guide_sections:
        c_title = ws_guide.cell(row=cur_row, column=1, value=title)
        c_title.font = Font(name="Calibri", size=11, bold=True, color="0F172A")
        cur_row += 1
        for p in points:
            c_p = ws_guide.cell(row=cur_row, column=1, value=p)
            c_p.font = Font(name="Calibri", size=10, color="334155")
            cur_row += 1
        cur_row += 1

    ws_guide.column_dimensions["A"].width = 115

    output = BytesIO()
    wb.save(output)
    output.seek(0)
    return output

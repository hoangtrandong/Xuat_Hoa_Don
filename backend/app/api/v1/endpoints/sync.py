from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from app.core.database import get_db
import os
import subprocess

from app.services.vinamilk_sync import sync_from_excel

router = APIRouter()

def run_playwright_and_sync(db: Session):
    # Đường dẫn đến file tải về
    download_dir = "C:\\DATA\\VINAMILK"
    excel_file = os.path.join(download_dir, "DanhSachChiTietDonHang.xlsx")
    
    # Nếu file đã cũ hoặc muốn tải file mới nhất, bạn có thể gọi script playwright tại đây.
    # subprocess.run(["python", "D:\\Python\\Intergration\\vinamilk_automation_playwright.py"])
    
    if not os.path.exists(excel_file):
        raise Exception("Không tìm thấy file Excel. Có thể script tải về bị lỗi.")
        
    try:
        # Gọi hàm sync
        synced_count = sync_from_excel(db, excel_file)
        print(f"Sync thành công {synced_count} đơn hàng.")
    except Exception as e:
        print(f"Lỗi khi sync: {str(e)}")

@router.post("/vinamilk")
def trigger_sync(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """
    Kích hoạt tiến trình đồng bộ dữ liệu từ Vinamilk DMS.
    Do quá trình tải file bằng Playwright có thể mất thời gian (khoảng 10-30s),
    chúng ta sử dụng BackgroundTasks để trả về response ngay lập tức cho Frontend.
    """
    # 1. Tuỳ chọn A: Chạy trong background
    # background_tasks.add_task(run_playwright_and_sync, db)
    # return {"message": "Tiến trình đồng bộ đang chạy ngầm", "status": "processing"}
    
    # 2. Tuỳ chọn B: Chạy trực tiếp (Chờ lấy kết quả ngay - Phù hợp nếu file đã có sẵn)
    try:
        excel_file = "C:\\DATA\\VINAMILK\\DanhSachChiTietDonHang.xlsx"
        if not os.path.exists(excel_file):
            return {"success": False, "message": "Chưa có file Excel. Hãy chạy script Playwright trước."}
            
        synced_count = sync_from_excel(db, excel_file)
        return {"success": True, "message": f"Đã đồng bộ {synced_count} đơn hàng", "synced_count": synced_count}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

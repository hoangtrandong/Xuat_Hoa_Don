# Project Rules & Guidelines - Hệ Thống Xuất Hóa Đơn & Quản Lý Phân Phối (DMS)

## 1. Tiêu chuẩn Thiết kế Giao diện (UI Standard for Modals & Forms)
> **MẪU CHUẨN DUY NHẤT (Single Source of Truth):** `web/src/components/sales/CreateOrderForm.tsx` (Form Tạo mới đơn hàng).  
> Mọi Modal cấu hình, Popup nhập liệu, Drawer hoặc Form tạo mới/chỉnh sửa trong dự án bắt buộc phải tuân theo phong cách compact enterprise của `CreateOrderForm`.

### 1.1. Header Modal / Form
* **Nền & Padding:** `bg-[#14263d] px-3 py-2 text-white flex items-center justify-between`
* **Icon & Tiêu đề:**
  * Icon nổi bật: `<Icon size={17} className="text-red-500" />`
  * Tiêu đề: `text-xs font-bold uppercase tracking-wide text-white`
* **Nút Đóng (Close):**
  * `<button type="button" onClick={onClose} className="rounded p-1 text-white hover:bg-white/10"><X size={16} /></button>`

### 1.2. Thân Form & Trường Nhập liệu (Form Body & Inputs)
* **Khung chứa Form:** `border border-slate-400 bg-white shadow-lg`
* **Quy chuẩn Input / Select / Textarea (`inputCls`):**
  ```tsx
  const inputCls = "w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-100";
  ```
* **Nhãn trường (Label):**
  * `text-[10px] font-semibold text-slate-600 block mb-0.5`
* **Bố cục lưới (Grid layout):**
  * `grid gap-x-3 gap-y-2 sm:grid-cols-2 xl:grid-cols-4`
* **Section / Khối phân chia:**
  * Khối nội dung: `border-b border-slate-200 px-3 py-2.5`
  * Tiêu đề section con: `border-b border-sky-100 bg-sky-50/60 px-3 py-2 text-[11px] font-bold text-sky-800 uppercase`

### 1.3. Bảng Dữ liệu & Danh sách Sản phẩm (Data Table / Line Items)
* **Khung cuộn bảng:** `overflow-x-auto`
* **Bảng:** `w-full border-collapse text-left`
* **Header bảng (`thead`):** `bg-slate-100 text-[10px] font-semibold text-slate-600`
* **Dòng dữ liệu (`tbody tr`):**
  * `border-b border-slate-100 even:bg-amber-50/40 hover:bg-sky-50/50 text-[11px]`
  * Căn lề số tiền: `text-right font-medium text-slate-700`
  * Căn lề số lượng: `text-center font-semibold`
* **Tổng kết chân bảng (`tfoot`):**
  * `border-t border-slate-200 bg-slate-50 text-[10px] font-semibold text-slate-600`

### 1.4. Thanh Tác Vụ Dưới Cùng (Footer Action Bar)
* **Khung Footer:** `border-t border-slate-300 bg-slate-100 px-3 py-2 flex items-center justify-between gap-3`
* **Ghi chú bên trái:** `text-[10px] text-slate-500`
* **Nút Đóng / Hủy:**
  * `rounded bg-red-700 hover:bg-red-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors`
* **Nút Lưu / Thực thi (Submit):**
  * `inline-flex items-center gap-1.5 rounded bg-sky-600 hover:bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:bg-slate-300`
  * Có biểu tượng icon: `<CheckCircle2 size={13} />` (hoặc `<Loader2 size={13} className="animate-spin" />` khi đang tải).

---

## 2. Nguyên tắc Đồng bộ & Kết nối Nhà Cung Cấp (Suppliers)
* **Ưu tiên HTTP thuần (`httpx`):** Không sử dụng trình duyệt ảo (Playwright/Chromium) trên môi trường backend container.
* **KiotViet Web API:**
  * Endpoint Hóa đơn: `https://api-man1.kiotviet.vn/api/invoices?format=json&$top=15`
  * Endpoint Đơn hàng: `https://api-man1.kiotviet.vn/api/orders?format=json&$top=15`
  * Bắt buộc có header: `Retailer`, `Origin`, `Referer`, `Authorization: Bearer <Token>`.
  * Ánh xạ trường tự động case-insensitive (không phân biệt hoa thường).

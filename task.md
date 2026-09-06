# DMS Phase 1 Tasks

Trạng thái hiện tại: **UI mock (web + mobile)** + **PostgreSQL schema / FastAPI skeleton**. Chưa seed, chưa nối UI.

## Web khởi tạo & layout
- [x] Khởi tạo project Next.js
- [x] Setup cấu trúc thư mục (`components/`, `lib/`)
- [x] Layout chính: Sidebar & Header (responsive, collapsible, mobile drawer)
- [x] Menu theo module (Hàng hóa, Khách hàng, Bán hàng, Kho, …)

## Dashboard
- [x] KPI Cards
- [x] Revenue Chart (drill-down mock)
- [x] Supplier Chart
- [x] Customer Coverage
- [x] Top Sales

## Hàng hóa
- [x] Danh sách SKU (`/products`)
- [x] Chi tiết SKU (`/products/[id]`)
- [x] Danh mục (`/products/categories`)
- [x] Bảng giá (`/products/price-lists`)

## Khách hàng
- [x] Danh sách khách hàng (`/customers`)
- [x] Chi tiết khách hàng (drawer `CustomerDetail`)
- [x] Tuyến bán hàng (`/customers/routes`)

## Bán hàng
- [x] Danh sách đơn hàng (`/sales/orders`)
- [x] Tạo đơn hàng (`/sales/create`) — client store, trừ tồn khi đặt
- [x] Phiếu bán (`/sales/invoices`)
- [x] Trả hàng (`/sales/returns`)

## Kho
- [x] Tồn kho + điều chỉnh ledger (`/warehouse/inventory`)
- [x] Nhập kho (`/warehouse/import`)
- [x] Xuất kho (`/warehouse/export`)

## Nhân viên
- [x] Danh sách / chi tiết nhân viên (`/employees`)
- [x] KPI đội ngũ (`/kpi`)

## Chưa có UI mock (ComingSoon)
- [ ] Khuyến mãi (`/promotions`)
- [ ] Thị trường (`/market`)
- [ ] Công nợ & thanh toán (`/debt`)
- [ ] Báo cáo (`/reports`)
- [ ] Hệ thống — users, roles, audit (`/system`)

## API & Backend (FastAPI)
- [x] Khởi tạo project FastAPI (`api/`)
- [x] Setup kết nối PostgreSQL (`asyncpg` + `docker-compose`)
- [x] Thiết kế database schema Phase 1 (`api/sql/001_phase1.sql`)
- [ ] Seed data từ mock
- [ ] API Dashboard (aggregate)
- [x] API list: Products, Customers, Sales Orders, Inventory, Employees
- [ ] API ghi (POST đơn, ledger, sync mobile)
- [ ] API Price lists / KPI

## Mobile (Flutter)
- [x] Khởi tạo app Flutter (`mobile/`) — UI mock, offline queue
- [x] Luồng Sales: Customer → Visit → Order → Payment → Sync
- [ ] Cài Flutter SDK + generate Android/iOS (`flutter create .`)
- [ ] GPS thật / bản đồ / persist local DB
- [ ] Nối FastAPI khi backend sẵn sàng

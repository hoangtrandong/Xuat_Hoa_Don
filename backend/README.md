# DMS Backend - FastAPI Modular Monolith

Backend API cho hệ thống Distribution Management System (DMS), xây dựng bằng
FastAPI + SQLAlchemy 2.0 (async) + PostgreSQL.

## Kiến trúc

```
backend/
├── app/
│   ├── core/          # config, database engine
│   ├── models/        # SQLAlchemy models (user, customer, product, inventory, sales, promotion, employee, finance)
│   ├── schemas/       # Pydantic v2 schemas
│   ├── crud/          # CRUD operations
│   ├── api/v1/        # API router + endpoints
│   │   └── endpoints/ # customers, products, sales, inventory, employees, payments
│   ├── db/            # migrations (alembic)
│   └── main.py        # FastAPI app
├── scripts/           # seed data
├── tests/             # pytest
├── requirements.txt
└── .env.example
```

## Bắt đầu nhanh

```bash
# 1. Tạo virtual env
python -m venv .venv
.venv\Scripts\activate     # Windows

# 2. Cài dependencies
pip install -r requirements.txt

# 3. Cấu hình
cp .env.example .env
# chỉnh DATABASE_URL cho phù hợp

# 4. Tạo database PostgreSQL
createdb dms

# 5. Chạy migration
alembic upgrade head

# 6. Cấu hình SECRET_KEY duy nhất trước khi chạy API
# Tạo giá trị bằng: python -c "import secrets; print(secrets.token_urlsafe(48))"
# Đặt giá trị trong .env (không dùng giá trị mẫu/để trống).

# 7. Khởi tạo tài khoản quản trị đầu tiên bằng prompt tương tác
python -m scripts.bootstrap_admin

# 8. Seed dữ liệu mẫu (không tạo tài khoản hoặc mật khẩu quản trị)
python -m scripts.seed

# 9. Khởi động server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Authentication và quyền truy cập

Các API dưới `/api/v1` (ngoại trừ `/auth/login`) yêu cầu bearer access token.
Đăng nhập tại `POST /api/v1/auth/login` với `username` và `password`; token
được ký HS256 và hết hạn theo `ACCESS_TOKEN_EXPIRE_MINUTES`. Mật khẩu lưu dưới
dạng PBKDF2-SHA256 hash. Không đặt secret mặc định trong production; nếu
`SECRET_KEY` chưa được cấu hình đủ mạnh, các thao tác auth bị từ chối.

RBAC dùng permission code `<resource>:read` và `<resource>:write`, với quyền
được gán cho Role trong bảng hiện có `permissions`/`role_permissions`. Các thao
tác GET cần `read`; các method còn lại cần `write`. Script bootstrap cấp đầy
đủ quyền cho role `admin`, không tạo credential mặc định. Các role khác có thể
được gán permission qua quản trị cơ sở dữ liệu theo chính sách triển khai.

### Render Free: tạo admin khi deploy

Render Free không có Shell, nên `render.yaml` chạy
`scripts.bootstrap_admin_from_env` sau migration. Trên Render Dashboard, thêm
`SECRET_KEY` (ít nhất 32 ký tự) cùng bốn biến secret:
`INITIAL_ADMIN_USERNAME`, `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_FULL_NAME` và
`INITIAL_ADMIN_PASSWORD` (tối thiểu 12 ký tự). Deploy một lần; script chỉ tạo
admin nếu username chưa tồn tại và không in mật khẩu ra log. Sau khi deploy
thành công, xóa cả bốn biến `INITIAL_ADMIN_*` rồi deploy lại. Các deploy sau đó
sẽ bỏ qua bootstrap, nên mật khẩu khởi tạo không còn được giữ trong môi trường.
Backend cũng kiểm tra các biến này khi khởi động, để service Render tạo thủ công
vẫn bootstrap được dù chưa đồng bộ `preDeployCommand` từ `render.yaml`. Trong
runtime log, tìm `Initial administrator bootstrap: created.`.

## API Endpoints

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET    | `/health` | Health check |
| GET    | `/api/v1/customers/` | Danh sách khách hàng |
| POST   | `/api/v1/customers/` | Tạo khách hàng |
| GET    | `/api/v1/customers/{id}` | Chi tiết khách hàng |
| PATCH  | `/api/v1/customers/{id}` | Cập nhật khách hàng |
| GET    | `/api/v1/products/` | Danh sách sản phẩm |
| POST   | `/api/v1/products/` | Tạo sản phẩm |
| GET    | `/api/v1/products/price-lists/` | Bảng giá |
| POST   | `/api/v1/products/price-lists/` | Tạo bảng giá |
| GET    | `/api/v1/sales-orders/` | Đơn hàng |
| POST   | `/api/v1/sales-orders/` | Tạo đơn hàng |
| GET    | `/api/v1/inventory/transactions/` | Sổ nhật ký kho |
| GET    | `/api/v1/inventory/stock-levels/` | Tồn kho |
| POST   | `/api/v1/inventory/adjust/` | Điều chỉnh tồn |
| GET    | `/api/v1/employees/` | Nhân viên |
| GET    | `/api/v1/payments/` | Thanh toán |

Truy cập docs tự động: http://localhost:8000/api/v1/docs

## Database Schema

Các bảng chính: `customers`, `customer_addresses`, `customer_contacts`,
`products`, `product_categories`, `product_units`, `price_lists`, `price_list_items`,
`warehouses`, `inventory_transactions` (ledger), `sales_orders`, `sales_order_items`,
`promotions`, `promotion_rules`, `promotion_items`, `employees`, `sales_territories`,
`routes`, `visits`, `payments`, `receivables`, `users`, `roles`, `permissions`.

## Tests

```bash
pytest tests/ -v
```
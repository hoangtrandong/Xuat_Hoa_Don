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

# 6. Seed dữ liệu mẫu
python -m scripts.seed

# 7. Khởi động server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

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
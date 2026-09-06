-- DMS Phase 1 — PostgreSQL schema
-- Ledger tồn kho: inventory_transactions là nguồn sự thật; inventory là số dư hiện tại.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ========== Hệ thống ==========
CREATE TABLE roles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(50) NOT NULL UNIQUE,
    name        VARCHAR(100) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(80) NOT NULL UNIQUE,
    name        VARCHAR(120) NOT NULL
);

CREATE TABLE role_permissions (
    role_id         UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id   UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         VARCHAR(160) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name     VARCHAR(160) NOT NULL,
    role_id       UUID REFERENCES roles(id),
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========== Nhân sự & tuyến ==========
CREATE TABLE sales_territories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(30) NOT NULL UNIQUE,
    name        VARCHAR(120) NOT NULL,
    region      VARCHAR(120)
);

CREATE TABLE employees (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code          VARCHAR(30) NOT NULL UNIQUE,
    name          VARCHAR(160) NOT NULL,
    position      VARCHAR(80) NOT NULL,
    territory_id  UUID REFERENCES sales_territories(id),
    user_id       UUID UNIQUE REFERENCES users(id),
    phone         VARCHAR(30),
    email         VARCHAR(160),
    status        VARCHAR(20) NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'inactive')),
    join_date     DATE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE routes (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code          VARCHAR(30) NOT NULL UNIQUE,
    name          VARCHAR(120) NOT NULL,
    territory_id  UUID REFERENCES sales_territories(id),
    sales_rep_id  UUID REFERENCES employees(id),
    visit_target  INTEGER NOT NULL DEFAULT 0,
    color         VARCHAR(16)
);

-- ========== Sản phẩm ==========
CREATE TABLE product_categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(30) NOT NULL UNIQUE,
    name        VARCHAR(120) NOT NULL,
    description TEXT
);

CREATE TABLE product_units (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(30) NOT NULL UNIQUE,
    name        VARCHAR(60) NOT NULL
);

CREATE TABLE products (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code          VARCHAR(40) NOT NULL UNIQUE,
    name          VARCHAR(200) NOT NULL,
    category_id   UUID REFERENCES product_categories(id),
    unit_id       UUID REFERENCES product_units(id),
    supplier      VARCHAR(160),
    list_price    BIGINT NOT NULL DEFAULT 0,
    cost_price    BIGINT NOT NULL DEFAULT 0,
    status        VARCHAR(20) NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'inactive')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE price_lists (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            VARCHAR(40) NOT NULL UNIQUE,
    name            VARCHAR(160) NOT NULL,
    customer_type   VARCHAR(80),
    effective_date  DATE NOT NULL,
    note            TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE price_list_items (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    price_list_id  UUID NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
    product_id     UUID NOT NULL REFERENCES products(id),
    price          BIGINT NOT NULL,
    UNIQUE (price_list_id, product_id)
);

-- ========== Kho (ledger) ==========
CREATE TABLE warehouses (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(30) NOT NULL UNIQUE,
    name        VARCHAR(160) NOT NULL,
    location    VARCHAR(200),
    manager     VARCHAR(160)
);

CREATE TABLE inventory (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id    UUID NOT NULL REFERENCES warehouses(id),
    product_id      UUID NOT NULL REFERENCES products(id),
    on_hand         INTEGER NOT NULL DEFAULT 0,
    reserved        INTEGER NOT NULL DEFAULT 0,
    reorder_point   INTEGER NOT NULL DEFAULT 0,
    UNIQUE (warehouse_id, product_id),
    CHECK (on_hand >= 0),
    CHECK (reserved >= 0)
);

CREATE TABLE inventory_transactions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            VARCHAR(40) NOT NULL UNIQUE,
    txn_type        VARCHAR(20) NOT NULL
                    CHECK (txn_type IN ('OPENING', 'IN', 'OUT', 'ADJUST', 'RESERVE', 'RELEASE')),
    warehouse_id    UUID NOT NULL REFERENCES warehouses(id),
    product_id      UUID NOT NULL REFERENCES products(id),
    quantity        INTEGER NOT NULL,
    ref_type        VARCHAR(40),
    ref_code        VARCHAR(40),
    note            TEXT,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_inv_txn_product ON inventory_transactions (product_id, created_at DESC);
CREATE INDEX idx_inv_txn_wh ON inventory_transactions (warehouse_id, created_at DESC);

-- ========== Khách hàng ==========
CREATE TABLE customers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            VARCHAR(40) NOT NULL UNIQUE,
    name            VARCHAR(200) NOT NULL,
    customer_type   VARCHAR(40) NOT NULL,
    tier            VARCHAR(8) NOT NULL DEFAULT 'C',
    status          VARCHAR(20) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'inactive')),
    route_id        UUID REFERENCES routes(id),
    sales_rep_id    UUID REFERENCES employees(id),
    debit_balance   BIGINT NOT NULL DEFAULT 0,
    total_spend     BIGINT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE customer_addresses (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id   UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    line          VARCHAR(200) NOT NULL,
    district      VARCHAR(80),
    city          VARCHAR(80) DEFAULT 'TP.HCM',
    is_default    BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE customer_contacts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id   UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    name          VARCHAR(160) NOT NULL,
    phone         VARCHAR(30),
    email         VARCHAR(160),
    is_primary    BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE route_customers (
    route_id      UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    customer_id   UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (route_id, customer_id)
);

CREATE TABLE visits (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code          VARCHAR(40) NOT NULL UNIQUE,
    customer_id   UUID NOT NULL REFERENCES customers(id),
    employee_id   UUID NOT NULL REFERENCES employees(id),
    route_id      UUID REFERENCES routes(id),
    check_in_at   TIMESTAMPTZ,
    check_out_at  TIMESTAMPTZ,
    lat           DOUBLE PRECISION,
    lng           DOUBLE PRECISION,
    note          TEXT,
    status        VARCHAR(20) NOT NULL DEFAULT 'planned'
                  CHECK (status IN ('planned', 'checked_in', 'completed', 'skipped')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_visits_emp_day ON visits (employee_id, check_in_at);

-- ========== Bán hàng ==========
CREATE TABLE sales_orders (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code              VARCHAR(40) NOT NULL UNIQUE,
    customer_id       UUID NOT NULL REFERENCES customers(id),
    sales_rep_id      UUID REFERENCES employees(id),
    warehouse_id      UUID REFERENCES warehouses(id),
    visit_id          UUID REFERENCES visits(id),
    status            VARCHAR(30) NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'pending', 'delivering', 'completed', 'cancelled')),
    payment_status    VARCHAR(30) NOT NULL DEFAULT 'unpaid'
                      CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
    payment_method    VARCHAR(40),
    subtotal          BIGINT NOT NULL DEFAULT 0,
    discount          BIGINT NOT NULL DEFAULT 0,
    total             BIGINT NOT NULL DEFAULT 0,
    amount_paid       BIGINT NOT NULL DEFAULT 0,
    source            VARCHAR(20) NOT NULL DEFAULT 'web'
                      CHECK (source IN ('web', 'mobile')),
    note              TEXT,
    delivery_date     DATE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sales_order_items (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id      UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
    product_id    UUID NOT NULL REFERENCES products(id),
    quantity      INTEGER NOT NULL CHECK (quantity > 0),
    unit_price    BIGINT NOT NULL,
    discount_pct  NUMERIC(5,2) NOT NULL DEFAULT 0,
    line_total    BIGINT NOT NULL
);

CREATE TABLE sales_returns (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code          VARCHAR(40) NOT NULL UNIQUE,
    order_id      UUID REFERENCES sales_orders(id),
    customer_id   UUID NOT NULL REFERENCES customers(id),
    status        VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected')),
    amount        BIGINT NOT NULL DEFAULT 0,
    reason        TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sales_return_items (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    return_id     UUID NOT NULL REFERENCES sales_returns(id) ON DELETE CASCADE,
    product_id    UUID NOT NULL REFERENCES products(id),
    quantity      INTEGER NOT NULL CHECK (quantity > 0),
    unit_price    BIGINT NOT NULL
);

-- ========== Tài chính ==========
CREATE TABLE receivables (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id   UUID NOT NULL REFERENCES customers(id),
    order_id      UUID REFERENCES sales_orders(id),
    amount        BIGINT NOT NULL,
    balance       BIGINT NOT NULL,
    due_date      DATE,
    status        VARCHAR(20) NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'partial', 'settled')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payments (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code          VARCHAR(40) NOT NULL UNIQUE,
    customer_id   UUID NOT NULL REFERENCES customers(id),
    receivable_id UUID REFERENCES receivables(id),
    order_id      UUID REFERENCES sales_orders(id),
    amount        BIGINT NOT NULL CHECK (amount > 0),
    method        VARCHAR(40) NOT NULL,
    paid_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    source        VARCHAR(20) NOT NULL DEFAULT 'web',
    created_by    UUID REFERENCES users(id)
);

-- ========== Khuyến mãi ==========
CREATE TABLE promotions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code          VARCHAR(40) NOT NULL UNIQUE,
    name          VARCHAR(200) NOT NULL,
    starts_on     DATE NOT NULL,
    ends_on       DATE NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    note          TEXT
);

CREATE TABLE promotion_rules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    promotion_id    UUID NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
    rule_type       VARCHAR(40) NOT NULL,
    min_qty         INTEGER,
    discount_pct    NUMERIC(5,2),
    discount_amt    BIGINT
);

CREATE TABLE promotion_items (
    promotion_id  UUID NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
    product_id    UUID NOT NULL REFERENCES products(id),
    PRIMARY KEY (promotion_id, product_id)
);

-- ========== KPI ==========
CREATE TABLE employee_kpi (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id             UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    period                  CHAR(7) NOT NULL,
    sales_target            BIGINT NOT NULL DEFAULT 0,
    sales_achieved          BIGINT NOT NULL DEFAULT 0,
    orders_count            INTEGER NOT NULL DEFAULT 0,
    new_customers_target    INTEGER NOT NULL DEFAULT 0,
    new_customers           INTEGER NOT NULL DEFAULT 0,
    visit_target            INTEGER NOT NULL DEFAULT 0,
    visits                  INTEGER NOT NULL DEFAULT 0,
    UNIQUE (employee_id, period)
);

-- ========== Audit & sync (mobile offline) ==========
CREATE TABLE audit_logs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id      UUID REFERENCES users(id),
    action        VARCHAR(80) NOT NULL,
    entity        VARCHAR(80) NOT NULL,
    entity_id     UUID,
    payload       JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sync_queue (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id     VARCHAR(80) NOT NULL,
    entity_type   VARCHAR(40) NOT NULL
                  CHECK (entity_type IN ('visit', 'order', 'payment')),
    payload       JSONB NOT NULL,
    status        VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'synced', 'failed')),
    error_message TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    synced_at     TIMESTAMPTZ
);

CREATE INDEX idx_sync_queue_status ON sync_queue (status, created_at);
CREATE INDEX idx_customers_route ON customers (route_id);
CREATE INDEX idx_orders_customer ON sales_orders (customer_id, created_at DESC);

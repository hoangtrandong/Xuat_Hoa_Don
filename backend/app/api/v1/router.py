from fastapi import APIRouter
from app.api.v1.endpoints import (
    customers, products, sales, inventory, employees, payments, delivery_requests, debt,
    stores, companies, sync, product_groups, users,
    employee_debts, store_debts, cash_receipts, debt_transfers, delivery_returns,
    bank_receipts, promotions, multi_tenant_einvoice, supplier_dictionaries, invoice_products,
)

api_router = APIRouter()
api_router.include_router(customers.router)
api_router.include_router(stores.router)
api_router.include_router(companies.router)
api_router.include_router(products.router)
api_router.include_router(invoice_products.router)
api_router.include_router(supplier_dictionaries.router)
api_router.include_router(sales.router)
api_router.include_router(inventory.router)
api_router.include_router(employees.router)
api_router.include_router(payments.router)
api_router.include_router(delivery_requests.router)
api_router.include_router(delivery_requests.borrow_router)
api_router.include_router(debt.router)
api_router.include_router(employee_debts.router)
api_router.include_router(store_debts.router)
api_router.include_router(cash_receipts.router)
api_router.include_router(bank_receipts.router)
api_router.include_router(debt_transfers.router)
api_router.include_router(delivery_returns.router)
api_router.include_router(sync.router, prefix="/sync", tags=["Sync"])
api_router.include_router(product_groups.router)
api_router.include_router(users.router)
api_router.include_router(promotions.router)
api_router.include_router(multi_tenant_einvoice.router)
from fastapi import APIRouter
from app.api.v1.endpoints import customers, products, sales, inventory, employees, payments, delivery_requests, debt
from app.api.v1.endpoints import stores, companies, sync, product_groups

api_router = APIRouter()
api_router.include_router(customers.router)
api_router.include_router(stores.router)
api_router.include_router(companies.router)
api_router.include_router(products.router)
api_router.include_router(sales.router)
api_router.include_router(inventory.router)
api_router.include_router(employees.router)
api_router.include_router(payments.router)
api_router.include_router(delivery_requests.router)
api_router.include_router(debt.router)
api_router.include_router(sync.router, prefix="/sync", tags=["Sync"])
api_router.include_router(product_groups.router)
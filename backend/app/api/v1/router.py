from fastapi import APIRouter
from app.api.v1.endpoints import customers, products, sales, inventory, employees, payments

api_router = APIRouter()
api_router.include_router(customers.router)
api_router.include_router(products.router)
api_router.include_router(sales.router)
api_router.include_router(inventory.router)
api_router.include_router(employees.router)
api_router.include_router(payments.router)
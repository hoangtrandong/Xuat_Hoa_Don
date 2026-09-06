from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.session import get_db
from app.models.catalog import Product
from app.models.customer import Customer
from app.models.sales import SalesOrder
from app.models.warehouse import Inventory
from app.models.workforce import Employee
from app.schemas import CustomerOut, EmployeeOut, InventoryOut, OrderOut, ProductOut

router = APIRouter(prefix="/api", tags=["api"])


@router.get("/customers", response_model=list[CustomerOut])
async def list_customers(db: AsyncSession = Depends(get_db)) -> list[Customer]:
    result = await db.execute(select(Customer).order_by(Customer.code))
    return list(result.scalars().all())


@router.get("/products", response_model=list[ProductOut])
async def list_products(db: AsyncSession = Depends(get_db)) -> list[ProductOut]:
    result = await db.execute(
        select(Product).options(selectinload(Product.category), selectinload(Product.unit)).order_by(Product.code)
    )
    items = []
    for p in result.scalars().all():
        items.append(
            ProductOut(
                id=p.id,
                code=p.code,
                name=p.name,
                supplier=p.supplier,
                list_price=p.list_price,
                cost_price=p.cost_price,
                status=p.status,
                category_name=p.category.name if p.category else None,
                unit_name=p.unit.name if p.unit else None,
            )
        )
    return items


@router.get("/inventory", response_model=list[InventoryOut])
async def list_inventory(db: AsyncSession = Depends(get_db)) -> list[InventoryOut]:
    result = await db.execute(
        select(Inventory).options(selectinload(Inventory.warehouse), selectinload(Inventory.product))
    )
    rows = []
    for inv in result.scalars().all():
        product = inv.product
        warehouse = inv.warehouse
        rows.append(
            InventoryOut(
                product_code=product.code,
                product_name=product.name,
                warehouse_code=warehouse.code,
                warehouse_name=warehouse.name,
                on_hand=inv.on_hand,
                reserved=inv.reserved,
                available=max(0, inv.on_hand - inv.reserved),
                reorder_point=inv.reorder_point,
            )
        )
    return rows


@router.get("/sales-orders", response_model=list[OrderOut])
async def list_orders(db: AsyncSession = Depends(get_db)) -> list[OrderOut]:
    result = await db.execute(
        select(SalesOrder).options(selectinload(SalesOrder.customer)).order_by(SalesOrder.created_at.desc())
    )
    items = []
    for o in result.scalars().all():
        items.append(
            OrderOut(
                id=o.id,
                code=o.code,
                status=o.status,
                payment_status=o.payment_status,
                total=o.total,
                source=o.source,
                created_at=o.created_at,
                customer_name=o.customer.name if o.customer else None,
            )
        )
    return items


@router.get("/employees", response_model=list[EmployeeOut])
async def list_employees(db: AsyncSession = Depends(get_db)) -> list[Employee]:
    result = await db.execute(select(Employee).order_by(Employee.code))
    return list(result.scalars().all())

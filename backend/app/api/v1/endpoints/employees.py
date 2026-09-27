from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.schemas.employee import Employee, EmployeeCreate, EmployeeUpdate
from app.crud import employee as crud

router = APIRouter(prefix="/employees", tags=["employees"])


def _to_response(obj) -> Employee:
    return Employee(
        id=obj.id,
        code=obj.code,
        name=obj.name,
        position=obj.position,
        phone=obj.phone,
        email=obj.email,
        territory_id=obj.territory_id,
        target=float(obj.target),
        status=obj.status,
        join_date=obj.join_date,
        account_username=obj.user.username if obj.user else None,
    )


@router.get("/", response_model=List[Employee])
def list_employees(skip: int = 0, limit: int = 100, status: str | None = None, db: Session = Depends(get_db)):
    return [_to_response(obj) for obj in crud.list_(db, skip=skip, limit=limit, status=status)]


@router.post("/", response_model=Employee, status_code=201)
def create_employee(payload: EmployeeCreate, db: Session = Depends(get_db)):
    return _to_response(crud.create(db, payload))


@router.get("/{employee_id}", response_model=Employee)
def get_employee(employee_id: int, db: Session = Depends(get_db)):
    obj = crud.get(db, employee_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Employee not found")
    return _to_response(obj)


@router.patch("/{employee_id}", response_model=Employee)
def update_employee(employee_id: int, payload: EmployeeUpdate, db: Session = Depends(get_db)):
    obj = crud.update(db, employee_id, payload)
    if not obj:
        raise HTTPException(status_code=404, detail="Employee not found")
    return _to_response(obj)
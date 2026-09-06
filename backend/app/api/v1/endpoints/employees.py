from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.schemas.employee import Employee, EmployeeCreate
from app.crud import employee as crud

router = APIRouter(prefix="/employees", tags=["employees"])


@router.get("/", response_model=List[Employee])
def list_employees(skip: int = 0, limit: int = 100, status: str | None = None, db: Session = Depends(get_db)):
    return crud.list_(db, skip=skip, limit=limit, status=status)


@router.post("/", response_model=Employee, status_code=201)
def create_employee(payload: EmployeeCreate, db: Session = Depends(get_db)):
    return crud.create(db, payload)


@router.get("/{employee_id}", response_model=Employee)
def get_employee(employee_id: int, db: Session = Depends(get_db)):
    obj = crud.get(db, employee_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Employee not found")
    return obj
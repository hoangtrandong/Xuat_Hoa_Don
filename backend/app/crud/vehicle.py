from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models.employee import Employee
from app.models.inventory import Vehicle
from app.schemas.vehicle import VehicleCreate, VehicleUpdate


VALID_VEHICLE_TYPES = {"STANDARD", "COLD", "MOTORBIKE"}


def _serialize(vehicle: Vehicle) -> dict:
    return {
        "id": vehicle.id,
        "code": vehicle.code,
        "plate_number": vehicle.plate_number,
        "name": vehicle.name,
        "vehicle_type": vehicle.vehicle_type,
        "max_weight_kg": float(vehicle.max_weight_kg or 0),
        "max_volume_m3": float(vehicle.max_volume_m3) if vehicle.max_volume_m3 is not None else None,
        "default_driver_id": vehicle.default_driver_id,
        "default_driver_code": vehicle.default_driver.code if vehicle.default_driver else None,
        "default_driver_name": vehicle.default_driver.name if vehicle.default_driver else None,
        "is_active": vehicle.is_active,
        "note": vehicle.note,
        "created_at": vehicle.created_at,
    }


def list_vehicles(db: Session, active_only: bool = False) -> list[dict]:
    stmt = select(Vehicle).options(selectinload(Vehicle.default_driver)).order_by(Vehicle.code)
    if active_only:
        stmt = stmt.where(Vehicle.is_active.is_(True))
    return [_serialize(v) for v in db.scalars(stmt).all()]


def create_vehicle(db: Session, payload: VehicleCreate) -> dict:
    code = payload.code.strip().upper()
    plate = payload.plate_number.strip().upper()
    vtype = (payload.vehicle_type or "STANDARD").strip().upper()
    if vtype not in VALID_VEHICLE_TYPES:
        raise ValueError(f"Loại xe không hợp lệ. Chỉ chấp nhận: {', '.join(sorted(VALID_VEHICLE_TYPES))}.")

    if db.scalar(select(Vehicle.id).where(func.upper(Vehicle.code) == code)):
        raise ValueError(f"Mã xe '{code}' đã tồn tại.")
    if db.scalar(select(Vehicle.id).where(func.upper(Vehicle.plate_number) == plate)):
        raise ValueError(f"Biển số xe '{plate}' đã tồn tại.")
    if payload.default_driver_id is not None and not db.get(Employee, payload.default_driver_id):
        raise ValueError("Không tìm thấy tài xế mặc định trong danh mục nhân viên.")

    vehicle = Vehicle(
        code=code,
        plate_number=plate,
        name=payload.name.strip(),
        vehicle_type=vtype,
        max_weight_kg=payload.max_weight_kg,
        max_volume_m3=payload.max_volume_m3,
        default_driver_id=payload.default_driver_id,
        is_active=payload.is_active,
        note=payload.note,
    )
    db.add(vehicle)
    db.commit()
    db.refresh(vehicle)
    vehicle = db.scalar(
        select(Vehicle).options(selectinload(Vehicle.default_driver)).where(Vehicle.id == vehicle.id)
    )
    return _serialize(vehicle)


def update_vehicle(db: Session, vehicle_id: int, payload: VehicleUpdate) -> dict:
    vehicle = db.scalar(
        select(Vehicle).options(selectinload(Vehicle.default_driver)).where(Vehicle.id == vehicle_id)
    )
    if not vehicle:
        raise ValueError("Không tìm thấy xe giao hàng.")

    data = payload.model_dump(exclude_unset=True)
    if "code" in data and data["code"] is not None:
        code = data["code"].strip().upper()
        dup = db.scalar(select(Vehicle.id).where(func.upper(Vehicle.code) == code, Vehicle.id != vehicle_id))
        if dup:
            raise ValueError(f"Mã xe '{code}' đã tồn tại.")
        vehicle.code = code
    if "plate_number" in data and data["plate_number"] is not None:
        plate = data["plate_number"].strip().upper()
        dup = db.scalar(select(Vehicle.id).where(func.upper(Vehicle.plate_number) == plate, Vehicle.id != vehicle_id))
        if dup:
            raise ValueError(f"Biển số xe '{plate}' đã tồn tại.")
        vehicle.plate_number = plate
    if "vehicle_type" in data and data["vehicle_type"] is not None:
        vtype = data["vehicle_type"].strip().upper()
        if vtype not in VALID_VEHICLE_TYPES:
            raise ValueError(f"Loại xe không hợp lệ. Chỉ chấp nhận: {', '.join(sorted(VALID_VEHICLE_TYPES))}.")
        vehicle.vehicle_type = vtype
    if "default_driver_id" in data and data["default_driver_id"] is not None:
        if not db.get(Employee, data["default_driver_id"]):
            raise ValueError("Không tìm thấy tài xế mặc định trong danh mục nhân viên.")
        vehicle.default_driver_id = data["default_driver_id"]
    elif "default_driver_id" in data:
        vehicle.default_driver_id = None

    for field in ("name", "max_weight_kg", "max_volume_m3", "is_active", "note"):
        if field in data:
            setattr(vehicle, field, data[field])

    db.commit()
    vehicle = db.scalar(
        select(Vehicle).options(selectinload(Vehicle.default_driver)).where(Vehicle.id == vehicle_id)
    )
    return _serialize(vehicle)


def delete_vehicle(db: Session, vehicle_id: int) -> None:
    vehicle = db.get(Vehicle, vehicle_id)
    if not vehicle:
        raise ValueError("Không tìm thấy xe giao hàng.")
    db.delete(vehicle)
    db.commit()

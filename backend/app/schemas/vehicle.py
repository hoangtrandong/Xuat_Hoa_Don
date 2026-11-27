from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class VehicleBase(BaseModel):
    code: str = Field(min_length=1, max_length=30)
    plate_number: str = Field(min_length=1, max_length=30)
    name: str = Field(min_length=1, max_length=120)
    vehicle_type: str = Field(default="STANDARD", description="STANDARD | COLD | MOTORBIKE")
    max_weight_kg: float = Field(default=0.0, ge=0)
    max_volume_m3: Optional[float] = Field(default=None, ge=0)
    default_driver_id: Optional[int] = None
    is_active: bool = True
    note: Optional[str] = None


class VehicleCreate(VehicleBase):
    pass


class VehicleUpdate(BaseModel):
    code: Optional[str] = Field(default=None, min_length=1, max_length=30)
    plate_number: Optional[str] = Field(default=None, min_length=1, max_length=30)
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    vehicle_type: Optional[str] = None
    max_weight_kg: Optional[float] = Field(default=None, ge=0)
    max_volume_m3: Optional[float] = Field(default=None, ge=0)
    default_driver_id: Optional[int] = None
    is_active: Optional[bool] = None
    note: Optional[str] = None


class VehicleOut(VehicleBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    default_driver_code: Optional[str] = None
    default_driver_name: Optional[str] = None
    created_at: datetime

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class RoleResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    email: str = Field(min_length=3, max_length=120)
    full_name: str = Field(min_length=1, max_length=120)
    password: str
    role_ids: List[int] = Field(default_factory=list)
    employee_id: Optional[int] = None

    @field_validator("password")
    @classmethod
    def _password_strength(cls, value: str) -> str:
        if len(value) < 12:
            raise ValueError("Password must contain at least 12 characters.")
        return value


class UserUpdate(BaseModel):
    is_active: Optional[bool] = None
    role_ids: Optional[List[int]] = None
    full_name: Optional[str] = Field(default=None, min_length=1, max_length=120)


class UserResponse(BaseModel):
    id: int
    username: str
    email: str
    full_name: str
    is_active: bool
    employee_id: Optional[int]
    employee_code: Optional[str] = None
    employee_name: Optional[str] = None
    created_at: datetime
    roles: List[RoleResponse]

    model_config = ConfigDict(from_attributes=True)

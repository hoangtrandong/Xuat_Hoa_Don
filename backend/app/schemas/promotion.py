from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


TriggerType = Literal["QUANTITY", "AMOUNT"]
QuantityUnit = Literal["CARTON", "BOX"]
RewardType = Literal["FREE_QUANTITY", "DISCOUNT_AMOUNT", "DISCOUNT_PERCENT"]
CustomerType = Literal["DISTRIBUTOR", "WHOLESALE", "HORECA", "RETAIL"]
TargetScope = Literal["ALL", "CUSTOMER_TYPE"]
ProductScope = Literal["SELECTED", "SUPPLIER"]


class PromotionRuleInput(BaseModel):
    trigger_type: TriggerType
    min_quantity: int | None = Field(default=None, ge=1)
    quantity_unit: QuantityUnit = "CARTON"
    min_amount: float | None = Field(default=None, gt=0)
    reward_type: RewardType
    reward_value: float = Field(ge=0)
    reward_unit: QuantityUnit = "BOX"

    @model_validator(mode="after")
    def validate_trigger(self):
        if self.trigger_type == "QUANTITY" and self.min_quantity is None:
            raise ValueError("Chương trình theo số lượng cần số lượng tối thiểu.")
        if self.trigger_type == "AMOUNT" and self.min_amount is None:
            raise ValueError("Chương trình theo giá trị cần số tiền tối thiểu.")
        if self.reward_type == "FREE_QUANTITY" and (self.reward_value < 1 or not self.reward_value.is_integer()):
            raise ValueError("Số lượng khuyến mãi phải là số nguyên dương.")
        if self.reward_type == "DISCOUNT_PERCENT" and self.reward_value > 100:
            raise ValueError("Chiết khấu phần trăm không được vượt quá 100%.")
        return self


class PromotionInput(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=255)
    start_date: datetime
    end_date: datetime
    is_active: bool = True
    promotion_type: Literal["ORDER"] = "ORDER"
    target_scope: TargetScope = "ALL"
    customer_type: CustomerType | None = None
    employee_code: str | None = Field(default=None, max_length=20)
    vat_rate: float = Field(default=0, ge=0, le=100)
    product_scope: ProductScope = "SELECTED"
    supplier: str | None = Field(default=None, max_length=120)
    product_ids: list[int] = Field(default_factory=list)
    rules: list[PromotionRuleInput] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_dates(self):
        if self.end_date < self.start_date:
            raise ValueError("Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.")
        if self.target_scope == "CUSTOMER_TYPE" and self.customer_type is None:
            raise ValueError("Vui lòng chọn loại khách hàng áp dụng.")
        if self.target_scope == "ALL" and self.customer_type is not None:
            raise ValueError("Không chọn loại khách hàng khi áp dụng cho tất cả khách hàng.")
        if self.product_scope == "SELECTED" and not self.product_ids:
            raise ValueError("Vui lòng thêm ít nhất một sản phẩm áp dụng.")
        if self.product_scope == "SUPPLIER" and not (self.supplier or "").strip():
            raise ValueError("Vui lòng chọn nhà cung cấp khi áp dụng toàn bộ sản phẩm theo nhà cung cấp.")
        return self


class PromotionRuleOutput(PromotionRuleInput):
    model_config = ConfigDict(from_attributes=True)
    id: int


class PromotionOutput(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    name: str
    description: str | None
    start_date: datetime
    end_date: datetime
    is_active: bool
    is_locked: bool
    promotion_type: str
    target_scope: str
    customer_type: str | None
    employee_code: str | None
    vat_rate: float
    product_scope: str
    supplier: str | None
    product_ids: list[int]
    rules: list[PromotionRuleOutput]


class PromotionStatusUpdate(BaseModel):
    is_active: bool

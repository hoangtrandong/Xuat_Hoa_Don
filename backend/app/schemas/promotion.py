from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


TriggerType = Literal["CARTON", "AMOUNT"]
RewardType = Literal["FREE_QUANTITY", "DISCOUNT_AMOUNT", "DISCOUNT_PERCENT"]


class PromotionRuleInput(BaseModel):
    trigger_type: TriggerType
    min_cartons: int | None = Field(default=None, ge=1)
    min_amount: float | None = Field(default=None, gt=0)
    reward_type: RewardType
    reward_value: float = Field(ge=0)

    @model_validator(mode="after")
    def validate_trigger(self):
        if self.trigger_type == "CARTON" and self.min_cartons is None:
            raise ValueError("Chương trình theo thùng cần số thùng tối thiểu.")
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
    product_ids: list[int] = Field(min_length=1)
    rules: list[PromotionRuleInput] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_dates(self):
        if self.end_date < self.start_date:
            raise ValueError("Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.")
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
    product_ids: list[int]
    rules: list[PromotionRuleOutput]


class PromotionStatusUpdate(BaseModel):
    is_active: bool

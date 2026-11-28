from datetime import date, datetime
from typing import Optional, List
from pydantic import BaseModel, ConfigDict, Field


class DebtLedgerEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    party_type: str
    party_id: int
    entry_type: str
    amount: float
    source_type: str
    source_id: Optional[int] = None
    source_code: Optional[str] = None
    document_date: Optional[datetime] = None
    note: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime


class EmployeeDebtSummary(BaseModel):
    employee_id: int
    code: str
    vinamilk_code: Optional[str] = None
    name: str
    phone: Optional[str] = None
    position: Optional[str] = None
    status: str
    debt_limit: float = 500000000.0
    current_debt: float = 0.0
    pending_delivery_debt: float = 0.0
    projected_debt: float = 0.0
    total_debit: float = 0.0
    total_credit: float = 0.0
    is_over_limit: bool = False
    last_active_at: Optional[datetime] = None


class EmployeeDebtLimitChangeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    employee_id: Optional[int] = None
    employee_code: str
    old_limit: float
    new_limit: float
    reason: str
    changed_by: Optional[str] = None
    changed_at: datetime


class StoreDebtSummary(BaseModel):
    store_id: int
    code: str
    name: str
    phone: Optional[str] = None
    owner_name: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    customer_count: int = 0
    current_debt: float = 0.0
    total_debit: float = 0.0
    total_credit: float = 0.0
    last_active_at: Optional[datetime] = None


class CashReceiptCreate(BaseModel):
    party_type: str = Field(description="EMPLOYEE or STORE")
    party_id: int
    amount: float = Field(gt=0, description="Amount must be positive")
    settlement_date: Optional[date] = None
    note: Optional[str] = None


class CashReceiptOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    party_type: str
    party_id: int
    party_code: Optional[str] = None
    party_name: Optional[str] = None
    settlement_date: Optional[date] = None
    amount: float
    receipt_date: datetime
    note: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime


class DebtTransferCreate(BaseModel):
    from_party_type: str = Field(description="EMPLOYEE or STORE")
    from_party_id: int = Field(gt=0)
    to_party_type: str = Field(description="EMPLOYEE or STORE")
    to_party_id: int = Field(gt=0)
    amount: float = Field(gt=0, description="Amount must be positive")
    reason: Optional[str] = None
    delivery_request_order_id: Optional[int] = None
    pod_image_url: Optional[str] = None
    require_approval: bool = False
    override_limit_reason: Optional[str] = None


class DebtTransferApproveRequest(BaseModel):
    override_limit_reason: Optional[str] = None


class DebtTransferRejectRequest(BaseModel):
    reject_reason: str = Field(min_length=1, max_length=255)


class DebtTransferOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    from_party_type: str
    from_party_id: int
    to_party_type: str
    to_party_id: int
    delivery_request_order_id: Optional[int] = None
    pod_image_url: Optional[str] = None
    amount: float
    reason: Optional[str] = None
    status: str = "COMPLETED"
    requested_by: Optional[str] = None
    approved_by: Optional[str] = None
    approved_at: Optional[datetime] = None
    rejected_by: Optional[str] = None
    rejected_at: Optional[datetime] = None
    reject_reason: Optional[str] = None
    override_limit_by: Optional[str] = None
    override_limit_reason: Optional[str] = None
    created_at: datetime


class DeliveryReturnItemBase(BaseModel):
    product_id: int
    quantity: int = Field(gt=0, description="Số lượng hộp/đơn vị trả về")
    cartons: int = 0
    loose_boxes: int = 0
    unit_price: float = 0.0
    amount: float = 0.0
    reason: Optional[str] = None
    location_id: Optional[int] = None
    lot_id: Optional[int] = None
    expiry_date: Optional[datetime] = None
    item_condition: str = Field(default="GOOD", description="GOOD | DAMAGED | EXPIRED")


class DeliveryReturnItemCreate(DeliveryReturnItemBase):
    pass


class DeliveryReturnItemOut(DeliveryReturnItemBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    delivery_return_id: int
    actual_received_qty: Optional[int] = None
    sku: Optional[str] = None
    product_name: Optional[str] = None
    location_code: Optional[str] = None
    lot_number: Optional[str] = None
    damage_resolution: Optional[str] = None
    resolved_by: Optional[str] = None
    resolved_at: Optional[datetime] = None
    resolution_note: Optional[str] = None


class DeliveryReturnCreate(BaseModel):
    delivery_request_id: int
    employee_id: int
    order_id: Optional[int] = None
    amount: Optional[float] = Field(default=0.0, ge=0)
    note: Optional[str] = None
    items: Optional[List[DeliveryReturnItemCreate]] = None
    restore_stock: bool = True
    auto_receive: bool = True
    settlement_party_type: str = Field(default="EMPLOYEE", description="EMPLOYEE or STORE")
    settlement_party_id: Optional[int] = None


class DeliveryReturnReceiveItem(BaseModel):
    item_id: int
    actual_received_qty: int = Field(ge=0)
    item_condition: str = Field(default="GOOD", description="GOOD | DAMAGED | EXPIRED")
    lot_id: Optional[int] = None
    location_id: Optional[int] = None
    expiry_date: Optional[datetime] = None


class DeliveryReturnReceiveRequest(BaseModel):
    items: Optional[List[DeliveryReturnReceiveItem]] = None
    restore_stock: bool = True
    note: Optional[str] = None


class DeliveryReturnDamageResolveRequest(BaseModel):
    resolution: str = Field(description="CHARGE_EMPLOYEE | COMPANY_ABSORB")
    note: Optional[str] = None


class DeliveryReturnOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    delivery_request_id: int
    delivery_request_code: Optional[str] = None
    employee_id: int
    employee_code: Optional[str] = None
    employee_name: Optional[str] = None
    order_id: Optional[int] = None
    order_number: Optional[str] = None
    customer_code: Optional[str] = None
    customer_name: Optional[str] = None
    return_type: str = "STANDARD"
    replacement_order_number: Optional[str] = None
    amount: float
    status: str
    settlement_party_type: str = "EMPLOYEE"
    settlement_party_id: Optional[int] = None
    note: Optional[str] = None
    created_by: Optional[str] = None
    approved_by: Optional[str] = None
    warehouse_received_by: Optional[str] = None
    warehouse_received_at: Optional[datetime] = None
    rejected_by: Optional[str] = None
    rejected_at: Optional[datetime] = None
    reject_reason: Optional[str] = None
    created_at: datetime
    items: List[DeliveryReturnItemOut] = Field(default_factory=list)


class EligibleOldOrderOut(BaseModel):
    delivery_request_order_id: int
    delivery_request_id: int
    delivery_request_code: str
    order_number: str
    order_date: Optional[date] = None
    employee_id: Optional[int] = None
    employee_code: str
    employee_name: Optional[str] = None
    customer_code: Optional[str] = None
    customer_name: Optional[str] = None
    amount: float
    returned_amount: float = 0.0
    net_amount: float = 0.0
    delivery_status: str
    payment_status: str
    item_count: int = 0
    total_qty: int = 0


class EligibleNewOrderOut(BaseModel):
    order_number: str
    order_date: Optional[date] = None
    customer_code: Optional[str] = None
    customer_name: Optional[str] = None
    staff_code: Optional[str] = None
    staff_name: Optional[str] = None
    total_qty: int = 0
    total_amount: float = 0.0
    line_count: int = 0
    status: Optional[str] = None


class ReplacementReturnPreviewRequest(BaseModel):
    old_delivery_request_order_id: int = Field(gt=0)
    new_order_number: str = Field(min_length=1, max_length=120)


class ReplacementReturnComparisonLine(BaseModel):
    product_id: int
    sku: str
    product_name: str
    boxes_per_carton: int = 1
    old_qty: int
    new_qty: int
    return_qty: int
    return_cartons: int = 0
    return_loose_boxes: int = 0
    old_amount: float = 0.0
    new_amount: float = 0.0
    unit_price: float = 0.0
    return_amount: float = 0.0


class ReplacementReturnPreviewOut(BaseModel):
    old_order: EligibleOldOrderOut
    new_order: EligibleNewOrderOut
    comparison_lines: List[ReplacementReturnComparisonLine] = Field(default_factory=list)
    old_amount: float = 0.0
    new_amount: float = 0.0
    return_amount: float = 0.0
    total_old_qty: int = 0
    total_new_qty: int = 0
    total_return_qty: int = 0
    warnings: List[str] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)
    can_create: bool = False


class ReplacementReturnCreateRequest(BaseModel):
    old_delivery_request_order_id: int = Field(gt=0)
    new_order_number: str = Field(min_length=1, max_length=120)
    note: Optional[str] = Field(default=None, max_length=255)


class DeliveryReturnCancelRequest(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=255)

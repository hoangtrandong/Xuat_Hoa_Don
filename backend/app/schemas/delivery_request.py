from datetime import date, datetime
from typing import Dict, List, Optional, Any
from pydantic import BaseModel, ConfigDict, Field, computed_field, model_validator

from app.schemas.debt_ledger import DeliveryReturnOut


class DeliveryRequestOrderBase(BaseModel):
    order_date: Optional[date] = None
    order_number: str
    employee_id: Optional[int] = None
    employee_code: str
    employee_name: Optional[str] = None
    customer_code: Optional[str] = None
    customer_name: Optional[str] = None
    amount: float = Field(default=0.0, ge=0)
    payment_status: str = "UNPAID"
    payment_method: Optional[str] = None
    bank_ref: Optional[str] = None
    paid_at: Optional[datetime] = None
    note: Optional[str] = None


class DeliveryRequestOrderCreate(DeliveryRequestOrderBase):
    pass


class DeliveryRequestOrder(DeliveryRequestOrderBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    delivery_request_id: int
    created_at: datetime


class SettlementOrderPayRequest(BaseModel):
    payment_method: str = "BANK"  # BANK | CASH | DEBT | RETURN
    paid_amount: Optional[float] = None
    bank_ref: Optional[str] = None
    note: Optional[str] = None


class BankStatementItem(BaseModel):
    ref_number: Optional[str] = None
    amount: float = Field(gt=0)
    description: str


class SettlementMatchStatementRequest(BaseModel):
    statements: List[BankStatementItem]
    auto_confirm: bool = False


class StatementMatchResult(BaseModel):
    statement_ref: Optional[str] = None
    statement_amount: float
    statement_description: str
    order_id: Optional[int] = None
    order_number: Optional[str] = None
    customer_code: Optional[str] = None
    customer_name: Optional[str] = None
    employee_code: Optional[str] = None
    order_amount: Optional[float] = None
    matched: bool = False
    confidence: float = 0.0
    message: Optional[str] = None
    already_paid: bool = False


class SettlementMatchStatementResponse(BaseModel):
    total_statements: int
    matched_count: int
    unmatched_count: int
    auto_confirmed_count: int = 0
    matches: List[StatementMatchResult]


class DeliverySettlementOverview(BaseModel):
    request_id: int
    request_code: str
    request_status: str
    warehouse_id: int
    total_orders_count: int
    total_amount: float
    total_paid_bank: float
    total_paid_cash: float
    total_transferred_debt: float
    total_returned: float
    total_unpaid: float
    difference: float
    employee_settlements: List[Dict[str, Any]]
    orders: List[DeliveryRequestOrder]
    returns: List[DeliveryReturnOut] = Field(default_factory=list)
    items: List[Dict[str, Any]] = Field(default_factory=list)


class DailySettlementOrderBreakdown(BaseModel):
    id: int
    order_number: str
    order_date: Optional[date] = None
    delivery_request_id: int
    delivery_request_code: str
    customer_code: Optional[str] = None
    customer_name: Optional[str] = None
    amount: float
    paid_bank: float
    paid_cash: float
    transferred_debt: float
    remaining_unpaid: float
    payment_status: str
    payment_method: Optional[str] = None
    bank_ref: Optional[str] = None
    note: Optional[str] = None


class DailySettlementProductBreakdown(BaseModel):
    product_id: int
    sku: str
    product_name: str
    unit_name: Optional[str] = None
    boxes_per_carton: int = 1
    quantity: int = 0
    cartons: int = 0
    loose_boxes: int = 0
    returned_quantity: int = 0
    returned_cartons: int = 0
    returned_loose_boxes: int = 0
    net_quantity: int = 0
    net_cartons: int = 0
    net_loose_boxes: int = 0
    unit_price: Optional[float] = None
    amount: Optional[float] = None
    returned_amount: float = 0.0
    net_amount: Optional[float] = None


class DailySettlementRequestBreakdown(BaseModel):
    request_id: int
    request_code: str
    warehouse_id: int
    warehouse_name: str
    completed_at: datetime
    orders_count: int


class DailyEmployeeSettlement(BaseModel):
    settlement_date: date
    employee_id: Optional[int] = None
    employee_code: str
    employee_name: Optional[str] = None
    delivery_requests_count: int
    allocated_amount: float
    orders_count: int
    orders_amount: float
    paid_bank: float
    paid_cash: float
    transferred_debt: float
    returned: float
    unpaid: float
    cash_remitted: float = 0.0
    cash_pending_remittance: float = 0.0
    remaining_employee_debt: float
    difference: float
    products: List[DailySettlementProductBreakdown] = Field(default_factory=list)
    orders: List[DailySettlementOrderBreakdown] = Field(default_factory=list)
    requests: List[DailySettlementRequestBreakdown] = Field(default_factory=list)


class BorrowedEmployeeOffsetCreate(BaseModel):
    external_employee_code: str = Field(min_length=1, max_length=50)
    external_employee_name: Optional[str] = Field(default=None, max_length=120)
    employee_id: Optional[int] = None
    quantity: int = Field(gt=0)
    amount: float = Field(ge=0, allow_inf_nan=False)



class DeliveryRequestItemCreate(BaseModel):
    product_id: int
    quantity: int = Field(ge=0)
    requested_quantity_raw: Optional[str] = None
    employee_allocations: Optional[Dict[str, Any]] = None
    borrowed_employee_offsets: Optional[List[BorrowedEmployeeOffsetCreate]] = None
    planned_allocations: Optional[List[Dict[str, Any]]] = None


class DeliveryRequestEmployeeSummaryBase(BaseModel):
    employee_id: Optional[int] = None
    employee_code: str
    employee_name: Optional[str] = None
    column_key: Optional[str] = None
    weight_ton: float = 0.0
    order_count: int = 0
    amount: float = Field(default=0.0, ge=0, le=999999999999.99, allow_inf_nan=False)
    debt_limit: Optional[float] = 500000000.0
    current_debt: Optional[float] = 0.0
    pending_debt: Optional[float] = 0.0
    projected_debt: Optional[float] = 0.0
    is_over_limit: Optional[bool] = False


class DeliveryRequestEmployeeSummaryCreate(DeliveryRequestEmployeeSummaryBase):
    pass


class EmployeeBorrowEntryCreate(BaseModel):
    employee_id: Optional[int] = None
    external_employee_code: Optional[str] = Field(default=None, max_length=50)
    external_employee_name: Optional[str] = Field(default=None, max_length=120)
    product_id: int
    quantity: int = Field(lt=0)
    amount: float = Field(le=0, allow_inf_nan=False)
    note: Optional[str] = None

    @model_validator(mode="after")
    def require_employee_identity(self):
        if self.employee_id is None and not (self.external_employee_code or "").strip():
            raise ValueError("Thiếu mã nhân viên nội bộ hoặc mã NVBH trên DMS.")
        return self


class EmployeeBorrowBatchCreate(BaseModel):
    import_hash: str = Field(min_length=64, max_length=64)
    filename: str = Field(min_length=1, max_length=255)
    entries: List[EmployeeBorrowEntryCreate] = Field(min_length=1)


class DeliveryRequestEmployeeSummary(DeliveryRequestEmployeeSummaryBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    delivery_request_id: int
    created_at: datetime


class DeliveryRequestCreate(BaseModel):
    warehouse_id: int
    items: List[DeliveryRequestItemCreate] = Field(min_length=1)
    employee_summaries: Optional[List[DeliveryRequestEmployeeSummaryCreate]] = None
    orders: Optional[List[DeliveryRequestOrderCreate]] = None
    borrow_entries: Optional[List[EmployeeBorrowEntryCreate]] = None
    borrow_import_hash: Optional[str] = Field(default=None, min_length=64, max_length=64)
    borrow_filename: Optional[str] = Field(default=None, max_length=255)
    note: Optional[str] = None
    created_by: Optional[str] = None


class DispatchPoolOrderItem(BaseModel):
    product_id: int
    sku: str
    product_name: str
    boxes_per_carton: int = 1
    quantity: int
    price: float = 0.0
    line_total: float = 0.0


class DispatchPoolOrder(BaseModel):
    id: int
    code: str
    order_date: Optional[date] = None
    status: str
    warehouse_id: int
    customer_id: int
    customer_code: str
    customer_name: str
    customer_address: Optional[str] = None
    sales_employee_code: Optional[str] = None
    sales_employee_name: Optional[str] = None
    total: float = 0.0
    note: Optional[str] = None
    items: List[DispatchPoolOrderItem] = Field(default_factory=list)
    dispatched_request_id: Optional[int] = None
    dispatched_request_code: Optional[str] = None
    dispatched_request_status: Optional[str] = None


class OrderDispatchAllocation(BaseModel):
    sales_order_id: int
    employee_id: int


class DeliveryRequestFromOrdersCreate(BaseModel):
    warehouse_id: int
    allocations: List[OrderDispatchAllocation] = Field(min_length=1)
    note: Optional[str] = None


class DeliveryPreviewItem(BaseModel):
    product_id: int
    sku: str
    product_name: str
    quantity: int
    boxes_per_carton: int = 1
    cartons: int = 0
    loose_boxes: int = 0
    requested_quantity_raw: Optional[str] = None
    available_quantity: int = 0
    shortage_quantity: int = 0
    employee_allocations: Optional[Dict[str, Any]] = None
    borrowed_employee_offsets: List[BorrowedEmployeeOffsetCreate] = Field(default_factory=list)
    allocations: List["DeliveryAllocation"] = Field(default_factory=list)
    dms_skus: List[str] = Field(default_factory=list)


class DeliveryPreviewResponse(BaseModel):
    items: List[DeliveryPreviewItem]
    employee_summaries: List[DeliveryRequestEmployeeSummaryBase] = Field(default_factory=list)
    orders: List[DeliveryRequestOrderCreate] = Field(default_factory=list)
    order_reconciliation: List[Dict[str, Any]] = Field(default_factory=list)
    borrow_entries: List[EmployeeBorrowEntryCreate] = Field(default_factory=list)
    import_hash: Optional[str] = None
    filename: Optional[str] = None
    amount_source: Optional[str] = None
    statuses: Dict[str, int] = Field(default_factory=dict)
    issues: List[str] = Field(default_factory=list)
    can_create: bool = True
    send_order_candidates: Dict[str, List[Dict[str, Any]]] = Field(default_factory=dict)
    warnings: List[str] = Field(default_factory=list)
    total_cartons: int = 0
    total_loose_boxes: int = 0
    total_quantity: int = 0


class FefoPlanPick(BaseModel):
    lot_id: Optional[int] = None
    location_code: Optional[str] = None
    location_id: Optional[int] = None
    lot_number: Optional[str] = None
    expiry_date: Optional[datetime] = None
    quantity: int
    cartons: int = 0
    loose_boxes: int = 0
    allocation_strategy: str


class FefoPlanItem(BaseModel):
    product_id: int
    sku: str
    product_name: str
    quantity: int
    boxes_per_carton: int = 1
    cartons: int = 0
    loose_boxes: int = 0
    planned_quantity: int
    shortage_quantity: int
    picks: List[FefoPlanPick] = Field(default_factory=list)


class DeliveryAllocation(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    allocated_quantity: int
    allocation_sequence: int
    allocation_strategy: str
    lot_id: Optional[int] = None
    location_id: Optional[int] = None
    location_code: Optional[str] = None
    lot_number: Optional[str] = None
    expiry_date: Optional[datetime] = None


class DeliveryRequestItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    product_id: int
    quantity: int
    requested_quantity_raw: Optional[str] = None
    sku: str
    product_name: str
    boxes_per_carton: int = 1
    available_quantity: int = 0
    shortage_quantity: int = 0
    allocations: List[DeliveryAllocation] = Field(default_factory=list)
    employee_allocations: Optional[Dict[str, Any]] = None
    planned_allocations: Optional[List[Dict[str, Any]]] = None

    @computed_field
    @property
    def cartons(self) -> int:
        bpc = max(1, self.boxes_per_carton or 1)
        return self.quantity // bpc

    @computed_field
    @property
    def loose_boxes(self) -> int:
        bpc = max(1, self.boxes_per_carton or 1)
        return self.quantity % bpc


class DeliveryRequestItemList(BaseModel):
    """Lightweight item for list endpoints - avoids loading full Product/Allocation rows."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    product_id: int
    quantity: int
    requested_quantity_raw: Optional[str] = None
    sku: Optional[str] = None
    product_name: Optional[str] = None
    boxes_per_carton: int = 1
    available_quantity: int = 0
    shortage_quantity: int = 0
    planned_allocations: Optional[List[Dict[str, Any]]] = None

    @computed_field
    @property
    def cartons(self) -> int:
        bpc = max(1, self.boxes_per_carton or 1)
        return self.quantity // bpc

    @computed_field
    @property
    def loose_boxes(self) -> int:
        bpc = max(1, self.boxes_per_carton or 1)
        return self.quantity % bpc


class DeliveryRequestList(BaseModel):
    """Lightweight request summary for list views - skips items.allocations."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    warehouse_id: int
    status: str
    note: Optional[str] = None
    created_by: Optional[str] = None
    approved_by: Optional[str] = None
    approved_at: Optional[datetime] = None
    submitted_at: Optional[datetime] = None
    received_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    created_at: datetime
    items: List[DeliveryRequestItemList] = Field(default_factory=list)
    employee_summaries: List[DeliveryRequestEmployeeSummary] = Field(default_factory=list)
    item_count: int = 0

    @computed_field
    @property
    def total_cartons(self) -> int:
        return sum(item.cartons for item in self.items)

    @computed_field
    @property
    def total_loose_boxes(self) -> int:
        return sum(item.loose_boxes for item in self.items)

    @computed_field
    @property
    def total_quantity(self) -> int:
        return sum(item.quantity for item in self.items)


class DeliveryRequest(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    warehouse_id: int
    status: str
    note: Optional[str] = None
    created_by: Optional[str] = None
    approved_by: Optional[str] = None
    approved_at: Optional[datetime] = None
    submitted_at: Optional[datetime] = None
    received_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    created_at: datetime
    items: List[DeliveryRequestItem] = Field(default_factory=list)
    employee_summaries: List[DeliveryRequestEmployeeSummary] = Field(default_factory=list)
    orders: List[DeliveryRequestOrder] = Field(default_factory=list)

    @computed_field
    @property
    def total_cartons(self) -> int:
        return sum(item.cartons for item in self.items)

    @computed_field
    @property
    def total_loose_boxes(self) -> int:
        return sum(item.loose_boxes for item in self.items)

    @computed_field
    @property
    def total_quantity(self) -> int:
        return sum(item.quantity for item in self.items)

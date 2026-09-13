path = "d:\\DMS_Project\\backend\\app\\schemas\\delivery_request.py"
with open(path, encoding="utf-8") as f:
    lines = f.readlines()

anchor = '    employee_allocations: Optional[Dict[str, Any]] = None\n'
# find the FIRST occurrence which is inside DeliveryRequestItem (line 71)
idx = lines.index(anchor)
print("anchor idx:", idx)

new_block = [
    "\n",
    "\n",
    "class DeliveryRequestItemList(BaseModel):\n",
    "    \"\"\"Lightweight item for list endpoints \u2014 avoids loading full Product/Allocation rows.\"\"\"\n",
    "    id: int\n",
    "    product_id: int\n",
    "    quantity: int\n",
    "    requested_quantity_raw: Optional[str] = None\n",
    "    sku: Optional[str] = None\n",
    "    product_name: Optional[str] = None\n",
    "    available_quantity: int = 0\n",
    "    shortage_quantity: int = 0\n",
    "\n",
    "\n",
    "class DeliveryRequestList(BaseModel):\n",
    "    \"\"\"Lightweight request summary for list views \u2014 skips items.allocations.\"\"\"\n",
    "    model_config = ConfigDict(from_attributes=True)\n",
    "    id: int\n",
    "    code: str\n",
    "    warehouse_id: int\n",
    "    status: str\n",
    "    note: Optional[str] = None\n",
    "    created_by: Optional[str] = None\n",
    "    submitted_at: Optional[datetime] = None\n",
    "    received_at: Optional[datetime] = None\n",
    "    completed_at: Optional[datetime] = None\n",
    "    created_at: datetime\n",
    "    items: List[DeliveryRequestItemList] = Field(default_factory=list)\n",
    "    item_count: int = 0\n",
]

# insert after the anchor line (which sits inside DeliveryRequestItem, before blanks+D.R.)
lines[idx+1:idx+1] = new_block

with open(path, "w", encoding="utf-8") as f:
    f.writelines(lines)
print("inserted; total lines now:", len(lines))
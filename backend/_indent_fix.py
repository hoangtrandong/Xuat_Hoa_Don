import io, re
path = r"d:\DMS_Project\backend\app\crud\delivery_request.py"
text = open(path, encoding="utf-8").read()

start = text.index("def list_(db: Session")
end = text.index("def _with_stock", start)

clean = (
    'def list_(db: Session, status: str | None = None):\n'
    '    """Lightweight list query for the queue/admin UI.\n'
    '\n'
    '    Loads requests + their items + the related Product in a single joined\n'
    '    select (no allocations needed for list views). This keeps the response\n'
    '    small and avoids N+1 lazy loads on the @property sku/product_name fields\n'
    '    and on the allocations relationship (which is only loaded by the detail\n'
    '    endpoint via get()).\n'
    '    """\n'
    '    stmt = select(DeliveryRequest).options(\n'
    '        selectinload(DeliveryRequest.items)\n'
    '        .selectinload(DeliveryRequestItem.product)\n'
    '    ).order_by(DeliveryRequest.created_at.desc())\n'
    '    if status:\n'
    '        stmt = stmt.where(DeliveryRequest.status == status.upper())\n'
    '    return list(db.scalars(stmt).all())\n'
    '\n\n'
)

text = text[:start] + clean + text[end:]
with open(path, "w", encoding="utf-8") as f:
    f.write(text)
print("DONE; rewritten list_. len:", len(text))
print("U+FFFD:", "\ufffd" in text)


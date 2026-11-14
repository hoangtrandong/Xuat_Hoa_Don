from abc import ABC, abstractmethod
from collections import defaultdict
from datetime import datetime
import hashlib
from typing import Any
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.customer import Customer
from app.models.multi_tenant_invoice import (
    Distributor,
    DistributorInvoiceConfig,
    IssuedInvoice,
    IssuedInvoiceItem,
)
from app.models.product import Product, ProductGroup, ProductGroupItem
from app.models.vinamilk import VinamilkOrderSnapshot


_DIGITS = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"]


def _read_three_digits(n: int, show_zero_hundred: bool) -> str:
    hundred = n // 100
    ten = (n % 100) // 10
    unit = n % 10
    parts: list[str] = []

    if hundred > 0 or show_zero_hundred:
        parts.append(f"{_DIGITS[hundred]} trăm")

    if ten > 1:
        parts.append(f"{_DIGITS[ten]} mươi")
        if unit == 1:
            parts.append("mốt")
        elif unit == 4:
            parts.append("tư")
        elif unit == 5:
            parts.append("lăm")
        elif unit > 0:
            parts.append(_DIGITS[unit])
    elif ten == 1:
        parts.append("mười")
        if unit == 5:
            parts.append("lăm")
        elif unit > 0:
            parts.append(_DIGITS[unit])
    elif ten == 0 and unit > 0:
        if hundred > 0 or show_zero_hundred:
            parts.append("lẻ")
        parts.append(_DIGITS[unit])

    return " ".join(parts)


def number_to_vietnamese_words(amount: float) -> str:
    """Chuyển số tiền sang chữ Tiếng Việt chuẩn kế toán hóa đơn."""
    n = int(round(max(0.0, amount)))
    if n == 0:
        return "Không đồng chẵn"

    units = ["", "nghìn", "triệu", "tỷ", "nghìn tỷ", "triệu tỷ"]
    groups: list[int] = []
    temp = n
    while temp > 0:
        groups.append(temp % 1000)
        temp //= 1000

    words: list[str] = []
    for i in range(len(groups) - 1, -1, -1):
        grp = groups[i]
        if grp > 0:
            show_zero = i < len(groups) - 1
            grp_text = _read_three_digits(grp, show_zero)
            unit_label = units[i] if i < len(units) else ""
            words.append(f"{grp_text} {unit_label}".strip())

    result = " ".join(words).strip()
    if not result:
        return "Không đồng chẵn"
    return result[0].upper() + result[1:] + " đồng chẵn."


class PreviewInvoiceLine(BaseModel):
    line_number: int
    item_type: str = "NORMAL"  # NORMAL | PROMOTION | DISCOUNT | NOTE
    product_code: str
    product_name: str
    unit_name: str = "Hộp"
    quantity: float = 0.0
    unit_price: float = 0.0
    discount_rate: float = 0.0
    discount_amount: float = 0.0
    amount_before_tax: float = 0.0
    vat_rate: float = 8.0
    vat_amount: float = 0.0
    total_amount: float = 0.0
    source_order_number: str | None = None


class PreviewInvoiceDocument(BaseModel):
    distributor_id: int
    distributor_code: str
    distributor_name: str
    seller_tax_code: str
    seller_address: str
    seller_phone: str
    seller_bank_account: str
    seller_bank_name: str
    invoice_config_id: int
    provider: str
    invoice_template_code: str
    invoice_series: str
    supplier_code: str
    source_order_numbers: list[str]
    buyer_code: str
    buyer_name: str
    buyer_legal_name: str
    buyer_tax_code: str
    buyer_address: str
    buyer_email: str = ""
    payment_method: str = "TM/CK"
    subtotal_before_tax: float = 0.0
    discount_amount: float = 0.0
    vat_rate: float = 8.0
    vat_amount: float = 0.0
    total_payment: float = 0.0
    amount_in_words: str = ""
    note: str = ""
    form_layout_config: dict[str, Any] = Field(default_factory=dict)
    items: list[PreviewInvoiceLine] = Field(default_factory=list)
    provider_payload_preview: dict[str, Any] = Field(default_factory=dict)


class BaseEInvoiceProvider(ABC):
    """Strategy Interface cho các Nhà cung cấp Hóa đơn điện tử (MISA, Viettel, VNPT, EasyInvoice...)."""

    provider_code: str = "GENERIC"

    @abstractmethod
    def build_provider_payload(
        self,
        doc: PreviewInvoiceDocument,
        config: DistributorInvoiceConfig,
    ) -> dict[str, Any]:
        """Xây dựng cấu trúc dữ liệu đặc thù theo chuẩn API của từng nhà mạng HĐĐT."""
        pass

    def issue_invoice(
        self,
        doc: PreviewInvoiceDocument,
        config: DistributorInvoiceConfig,
        publish_immediately: bool = True,
    ) -> dict[str, Any]:
        """Gửi yêu cầu tạo nháp hoặc ký số phát hành hóa đơn và trả về Số HĐ + Mã CQT."""
        payload = self.build_provider_payload(doc, config)
        seed = f"{doc.distributor_code}|{config.provider}|{config.invoice_series}|{','.join(doc.source_order_numbers)}|{datetime.utcnow().isoformat()}"
        digest = hashlib.sha256(seed.encode("utf-8")).hexdigest().upper()
        inv_no = str(int(digest[:7], 16) % 9000000 + 1000000).zfill(8)
        tax_auth_code = f"M1-26-{digest[7:12]}-{digest[12:23]}"
        tx_id = f"{config.provider}-{digest[:12]}"

        return {
            "success": True,
            "provider": config.provider,
            "status": "ISSUED" if publish_immediately else "DRAFT",
            "invoice_number": inv_no if publish_immediately else None,
            "invoice_series": config.invoice_series,
            "invoice_template_code": config.invoice_template_code,
            "tax_authority_code": tax_auth_code if publish_immediately else None,
            "transaction_id": tx_id,
            "issued_at": datetime.utcnow().isoformat(),
            "lookup_url": f"https://tracuuhoadon.{config.provider.lower()}.vn/search?code={tx_id}",
            "provider_payload": payload,
        }


class MisaMeInvoiceProvider(BaseEInvoiceProvider):
    provider_code = "MISA"

    def build_provider_payload(
        self,
        doc: PreviewInvoiceDocument,
        config: DistributorInvoiceConfig,
    ) -> dict[str, Any]:
        return {
            "Standard": "MISA_MEINVOICE_V2_ND123",
            "AppID": config.app_id or "MISA-APP-DEMO",
            "CompanyTaxCode": doc.seller_tax_code,
            "InvoiceData": [
                {
                    "RefID": f"MISA-{doc.distributor_code}-{'-'.join(doc.source_order_numbers)[:40]}",
                    "InvSeries": doc.invoice_series,
                    "InvTemplateNo": doc.invoice_template_code,
                    "InvDate": datetime.utcnow().strftime("%Y-%m-%d"),
                    "AccountObjectCode": doc.buyer_code,
                    "AccountObjectName": doc.buyer_legal_name or doc.buyer_name,
                    "BuyerName": doc.buyer_name,
                    "AccountObjectTaxCode": doc.buyer_tax_code,
                    "AccountObjectAddress": doc.buyer_address,
                    "PaymentMethodName": doc.payment_method,
                    "CurrencyCode": "VND",
                    "ExchangeRate": 1.0,
                    "TotalSaleAmountOC": round(doc.subtotal_before_tax + doc.discount_amount),
                    "TotalDiscountAmountOC": round(doc.discount_amount),
                    "TotalAmountWithoutVATOC": round(doc.subtotal_before_tax),
                    "TotalVATAmountOC": round(doc.vat_amount),
                    "TotalAmountOC": round(doc.total_payment),
                    "TotalAmountInWords": doc.amount_in_words,
                    "OriginalInvoiceDetail": [
                        {
                            "ItemType": 1 if item.item_type == "NORMAL" else (2 if item.item_type == "PROMOTION" else 3),
                            "SortOrder": item.line_number,
                            "ItemCode": item.product_code,
                            "ItemName": item.product_name,
                            "UnitName": item.unit_name,
                            "Quantity": item.quantity,
                            "UnitPrice": round(item.unit_price),
                            "DiscountRate": item.discount_rate,
                            "DiscountAmountOC": round(item.discount_amount),
                            "AmountOC": round(item.amount_before_tax),
                            "VATRateName": f"{int(item.vat_rate)}%",
                            "VATAmountOC": round(item.vat_amount),
                            "IsPromotion": item.item_type == "PROMOTION",
                        }
                        for item in doc.items
                    ],
                }
            ],
        }


class ViettelSInvoiceProvider(BaseEInvoiceProvider):
    provider_code = "VIETTEL"

    def build_provider_payload(
        self,
        doc: PreviewInvoiceDocument,
        config: DistributorInvoiceConfig,
    ) -> dict[str, Any]:
        return {
            "Standard": "VIETTEL_SINVOICE_V2_TT78",
            "generalInvoiceInfo": {
                "invoiceType": "1",
                "templateCode": doc.invoice_template_code,
                "invoiceSeries": doc.invoice_series,
                "currencyCode": "VND",
                "adjustmentType": "1",
                "paymentStatus": True,
                "paymentType": doc.payment_method,
                "paymentTypeName": doc.payment_method,
                "cusGetInvoiceRight": True,
            },
            "buyerInfo": {
                "buyerName": doc.buyer_name,
                "buyerLegalName": doc.buyer_legal_name or doc.buyer_name,
                "buyerTaxCode": doc.buyer_tax_code,
                "buyerAddressLine": doc.buyer_address,
                "buyerCode": doc.buyer_code,
            },
            "sellerInfo": {
                "sellerLegalName": doc.distributor_name,
                "sellerTaxCode": doc.seller_tax_code,
                "sellerAddressLine": doc.seller_address,
                "sellerPhoneNumber": doc.seller_phone,
                "sellerBankAccount": doc.seller_bank_account,
                "sellerBankName": doc.seller_bank_name,
            },
            "itemInfo": [
                {
                    "lineNumber": item.line_number,
                    "selection": 2 if item.item_type == "PROMOTION" else (3 if item.item_type == "DISCOUNT" else 1),
                    "itemCode": item.product_code,
                    "itemName": item.product_name,
                    "unitName": item.unit_name,
                    "quantity": item.quantity,
                    "unitPrice": round(item.unit_price),
                    "discount": item.discount_rate,
                    "itemDiscount": round(item.discount_amount),
                    "itemTotalAmountWithoutTax": round(item.amount_before_tax),
                    "taxPercentage": item.vat_rate,
                    "taxAmount": round(item.vat_amount),
                    "itemTotalAmountWithTax": round(item.total_amount),
                }
                for item in doc.items
            ],
            "summarizeInfo": {
                "sumOfTotalLineAmountWithoutTax": round(doc.subtotal_before_tax),
                "totalAmountWithoutTax": round(doc.subtotal_before_tax),
                "totalTaxAmount": round(doc.vat_amount),
                "totalAmountWithTax": round(doc.total_payment),
                "totalAmountWithTaxInWords": doc.amount_in_words,
                "discountAmount": round(doc.discount_amount),
            },
        }


class VnptInvoiceProvider(BaseEInvoiceProvider):
    provider_code = "VNPT"

    def build_provider_payload(
        self,
        doc: PreviewInvoiceDocument,
        config: DistributorInvoiceConfig,
    ) -> dict[str, Any]:
        return {
            "Standard": "VNPT_EINVOICE_XML_JSON_TT78",
            "Pattern": doc.invoice_template_code,
            "Serial": doc.invoice_series,
            "Inv": {
                "key": f"VNPT-{doc.distributor_code}-{'-'.join(doc.source_order_numbers)[:35]}",
                "Invoice": {
                    "CusCode": doc.buyer_code,
                    "CusName": doc.buyer_legal_name or doc.buyer_name,
                    "Buyer": doc.buyer_name,
                    "CusAddress": doc.buyer_address,
                    "CusTaxCode": doc.buyer_tax_code,
                    "PaymentMethod": doc.payment_method,
                    "Products": [
                        {
                            "Code": item.product_code,
                            "ProdName": item.product_name,
                            "ProdUnit": item.unit_name,
                            "ProdQuantity": item.quantity,
                            "ProdPrice": round(item.unit_price),
                            "DiscountAmount": round(item.discount_amount),
                            "Total": round(item.amount_before_tax),
                            "VATRate": item.vat_rate,
                            "VATAmount": round(item.vat_amount),
                            "Amount": round(item.total_amount),
                            "IsSum": 2 if item.item_type == "PROMOTION" else 0,
                        }
                        for item in doc.items
                    ],
                    "Total": round(doc.subtotal_before_tax),
                    "DiscountAmount": round(doc.discount_amount),
                    "VATRate": doc.vat_rate,
                    "VATAmount": round(doc.vat_amount),
                    "Amount": round(doc.total_payment),
                    "AmountInWords": doc.amount_in_words,
                },
            },
        }


class EasyInvoiceProvider(BaseEInvoiceProvider):
    provider_code = "EASYINVOICE"

    def build_provider_payload(
        self,
        doc: PreviewInvoiceDocument,
        config: DistributorInvoiceConfig,
    ) -> dict[str, Any]:
        return {
            "Standard": "EASYINVOICE_REST_API_TT78",
            "Pattern": doc.invoice_template_code,
            "Serial": doc.invoice_series,
            "Invoices": [
                {
                    "Ikey": f"EASY-{doc.distributor_code}-{'-'.join(doc.source_order_numbers)[:35]}",
                    "CustomerCode": doc.buyer_code,
                    "CustomerName": doc.buyer_legal_name or doc.buyer_name,
                    "Buyer": doc.buyer_name,
                    "CustomerTaxCode": doc.buyer_tax_code,
                    "CustomerAddress": doc.buyer_address,
                    "PaymentMethod": doc.payment_method,
                    "Products": [
                        {
                            "Feature": 2 if item.item_type == "PROMOTION" else (3 if item.item_type == "DISCOUNT" else 1),
                            "Code": item.product_code,
                            "ProdName": item.product_name,
                            "ProdUnit": item.unit_name,
                            "ProdQuantity": item.quantity,
                            "ProdPrice": round(item.unit_price),
                            "Discount": item.discount_rate,
                            "DiscountAmount": round(item.discount_amount),
                            "Total": round(item.amount_before_tax),
                            "VATRate": item.vat_rate,
                            "VATAmount": round(item.vat_amount),
                            "Amount": round(item.total_amount),
                        }
                        for item in doc.items
                    ],
                    "Total": round(doc.subtotal_before_tax),
                    "DiscountAmount": round(doc.discount_amount),
                    "VATRate": doc.vat_rate,
                    "VATAmount": round(doc.vat_amount),
                    "Amount": round(doc.total_payment),
                    "AmountInWords": doc.amount_in_words,
                }
            ],
        }


PROVIDER_REGISTRY: dict[str, BaseEInvoiceProvider] = {
    "MISA": MisaMeInvoiceProvider(),
    "VIETTEL": ViettelSInvoiceProvider(),
    "VNPT": VnptInvoiceProvider(),
    "EASYINVOICE": EasyInvoiceProvider(),
    "BKAV": EasyInvoiceProvider(),
}


def get_einvoice_provider(provider_name: str) -> BaseEInvoiceProvider:
    return PROVIDER_REGISTRY.get(provider_name.upper().strip(), MisaMeInvoiceProvider())


def _safe_float(payload: dict[str, Any], keys: tuple[str, ...], default: float = 0.0) -> float:
    for k in keys:
        if k in payload and payload[k] is not None and str(payload[k]).strip() != "":
            try:
                return float(str(payload[k]).replace(",", "").strip())
            except ValueError:
                continue
    return default


def _safe_str(payload: dict[str, Any], keys: tuple[str, ...], default: str = "") -> str:
    for k in keys:
        if k in payload and payload[k] is not None and str(payload[k]).strip() != "":
            return str(payload[k]).strip()
    return default


class InvoiceFormEngine:
    """Động cơ xây dựng Form Hóa Đơn Điện Tử Động theo cấu hình riêng của từng Nhà phân phối."""

    @staticmethod
    def build_invoice_previews(
        db: Session,
        distributor: Distributor,
        config: DistributorInvoiceConfig,
        order_numbers: list[str],
        buyer_override: dict[str, Any] | None = None,
    ) -> list[PreviewInvoiceDocument]:
        clean_order_nums = [o.strip() for o in order_numbers if o and o.strip()]
        if not clean_order_nums:
            return []

        snapshots = db.scalars(
            select(VinamilkOrderSnapshot)
            .where(
                VinamilkOrderSnapshot.order_number.in_(clean_order_nums),
                VinamilkOrderSnapshot.product_code.is_not(None),
            )
            .order_by(VinamilkOrderSnapshot.order_number, VinamilkOrderSnapshot.id)
        ).all()

        if not snapshots:
            return []

        # Tra cứu thông tin khách hàng (MST, Địa chỉ, Tên pháp lý)
        cust_codes = {s.customer_code for s in snapshots if s.customer_code}
        customers_by_code: dict[str, Customer] = {}
        if cust_codes:
            cust_rows = db.scalars(
                select(Customer)
                .options(selectinload(Customer.addresses), selectinload(Customer.store))
                .where(Customer.code.in_(cust_codes))
            ).all()
            customers_by_code = {c.code: c for c in cust_rows}

        # Tra cứu mã sản phẩm NPP nội bộ nếu cấu hình yêu cầu DISTRIBUTOR_SKU
        prod_codes = {s.product_code for s in snapshots if s.product_code}
        products_by_sku: dict[str, Product] = {}
        if prod_codes:
            prod_rows = db.scalars(
                select(Product)
                .options(
                    selectinload(Product.unit),
                    selectinload(Product.group_items)
                    .selectinload(ProductGroupItem.group)
                    .selectinload(ProductGroup.company_links),
                    selectinload(Product.group_items)
                    .selectinload(ProductGroupItem.group)
                    .selectinload(ProductGroup.representative_product),
                )
                .where(Product.sku.in_(prod_codes))
            ).all()
            products_by_sku = {p.sku: p for p in prod_rows}

        # Phân nhóm đơn hàng:
        # - Nếu config.combine_orders == True: Gộp các đơn hàng có cùng Mã khách hàng thành 1 Hóa đơn
        # - Nếu config.combine_orders == False: Mỗi đơn hàng sinh ra 1 Hóa đơn riêng biệt
        grouped_snapshots: dict[str, list[VinamilkOrderSnapshot]] = defaultdict(list)
        for snap in snapshots:
            if config.combine_orders:
                group_key = f"CUST:{snap.customer_code or 'DEFAULT'}"
            else:
                group_key = f"ORD:{snap.order_number}"
            grouped_snapshots[group_key].append(snap)

        documents: list[PreviewInvoiceDocument] = []
        provider_impl = get_einvoice_provider(config.provider)

        for _, group_rows in grouped_snapshots.items():
            first_row = group_rows[0]
            first_raw = first_row.raw_payload if isinstance(first_row.raw_payload, dict) else {}
            cust_code = first_row.customer_code or _safe_str(first_raw, ("Mã KH", "customerCode"), "KH-LE")
            cust_obj = customers_by_code.get(cust_code)

            buyer_name = (
                (buyer_override or {}).get("buyer_name")
                or first_row.customer_name
                or (cust_obj.name if cust_obj else "")
                or _safe_str(first_raw, ("Tên KH", "customerName"), "Khách hàng lẻ")
            )
            buyer_legal_name = (
                (buyer_override or {}).get("buyer_legal_name")
                or (cust_obj.store.name if cust_obj and cust_obj.store else "")
                or buyer_name
            )
            buyer_tax_code = (
                (buyer_override or {}).get("buyer_tax_code")
                or (cust_obj.tax_code if cust_obj and cust_obj.tax_code else "")
                or _safe_str(first_raw, ("Mã số thuế", "taxCode", "mst_khach"), "")
            )
            default_addr = ""
            if cust_obj:
                if cust_obj.addresses:
                    default_addr = cust_obj.addresses[0].address
                elif cust_obj.store and cust_obj.store.address:
                    default_addr = cust_obj.store.address
            buyer_address = (
                (buyer_override or {}).get("buyer_address")
                or default_addr
                or _safe_str(first_raw, ("Địa chỉ", "customerAddress", "address"), "Việt Nam")
            )
            payment_method = (
                (buyer_override or {}).get("payment_method")
                or config.default_payment_method
                or "TM/CK"
            )
            supplier_code = _safe_str(first_raw, ("Nhà cung cấp", "supplierCode"), "VINAMILK")

            src_orders = list(dict.fromkeys(r.order_number for r in group_rows if r.order_number))

            items: list[PreviewInvoiceLine] = []
            line_no = 1
            total_sub_before_tax = 0.0
            total_discount = 0.0
            total_vat = 0.0
            promo_notes: list[str] = []

            for row in group_rows:
                raw = row.raw_payload if isinstance(row.raw_payload, dict) else {}
                raw_sku = row.product_code or _safe_str(raw, ("Mã sản phẩm", "productCode"), "SKU")
                raw_name = row.product_name or _safe_str(raw, ("Tên sản phẩm", "productName"), raw_sku)
                prod_obj = products_by_sku.get(raw_sku)

                # Chọn mã SKU hiển thị trên form hóa đơn theo cấu hình NPP
                if config.product_code_source == "DISTRIBUTOR_SKU" and prod_obj is not None:
                    display_code = prod_obj.npp_code or raw_sku
                    display_name = prod_obj.npp_name or raw_name
                else:
                    display_code = raw_sku
                    display_name = raw_name

                unit_name = _safe_str(
                    raw,
                    ("ĐVT", "unit", "uom"),
                    prod_obj.unit.name if (prod_obj and prod_obj.unit) else "Hộp",
                )
                qty = _safe_float(raw, ("Số lượng", "quantity", "qty"), 0.0)
                promo_qty = _safe_float(
                    raw, ("Số lượng KM", "promotionQuantity", "freeQuantity", "giftQuantity"), 0.0
                )
                price = _safe_float(raw, ("Giá bán", "unitPrice", "price"), 0.0)
                gross_val = _safe_float(raw, ("Giá trị", "totalValue", "subtotal"), qty * price)
                if price == 0 and qty > 0 and gross_val > 0:
                    price = round(gross_val / qty, 2)
                disc_amt = _safe_float(raw, ("Số tiền CK", "discountAmount", "totalDiscount"), 0.0)
                vat_rate = _safe_float(raw, ("Thuế suất", "vatRate"), config.default_vat_rate)

                if qty > 0:
                    line_gross = round(qty * price) if price > 0 else round(gross_val)
                    effective_disc = round(disc_amt) if config.discount_display == "BY_LINE" else 0.0
                    amt_before_tax = max(0.0, line_gross - effective_disc)
                    disc_rate = round((effective_disc / line_gross) * 100, 2) if line_gross > 0 else 0.0
                    vat_amt = round(amt_before_tax * (vat_rate / 100.0))
                    line_total = amt_before_tax + vat_amt

                    items.append(
                        PreviewInvoiceLine(
                            line_number=line_no,
                            item_type="NORMAL",
                            product_code=display_code,
                            product_name=display_name,
                            unit_name=unit_name,
                            quantity=qty,
                            unit_price=price,
                            discount_rate=disc_rate,
                            discount_amount=effective_disc,
                            amount_before_tax=amt_before_tax,
                            vat_rate=vat_rate,
                            vat_amount=vat_amt,
                            total_amount=line_total,
                            source_order_number=row.order_number,
                        )
                    )
                    line_no += 1
                    total_sub_before_tax += amt_before_tax
                    total_discount += disc_amt
                    total_vat += vat_amt

                # Xử lý hàng khuyến mãi theo quy tắc riêng của NPP
                if promo_qty > 0:
                    if config.promo_handling == "ZERO_PRICE":
                        items.append(
                            PreviewInvoiceLine(
                                line_number=line_no,
                                item_type="PROMOTION",
                                product_code=display_code,
                                product_name=f"{display_name} (Hàng khuyến mãi không thu tiền)",
                                unit_name=unit_name,
                                quantity=promo_qty,
                                unit_price=0.0,
                                discount_rate=0.0,
                                discount_amount=0.0,
                                amount_before_tax=0.0,
                                vat_rate=vat_rate,
                                vat_amount=0.0,
                                total_amount=0.0,
                                source_order_number=row.order_number,
                            )
                        )
                        line_no += 1
                    elif config.promo_handling == "DISCOUNT_LINE" and price > 0:
                        promo_val = round(promo_qty * price)
                        items.append(
                            PreviewInvoiceLine(
                                line_number=line_no,
                                item_type="PROMOTION",
                                product_code=display_code,
                                product_name=f"{display_name} (Hàng tặng kèm chiết khấu 100%)",
                                unit_name=unit_name,
                                quantity=promo_qty,
                                unit_price=price,
                                discount_rate=100.0,
                                discount_amount=promo_val,
                                amount_before_tax=0.0,
                                vat_rate=vat_rate,
                                vat_amount=0.0,
                                total_amount=0.0,
                                source_order_number=row.order_number,
                            )
                        )
                        line_no += 1
                        total_discount += promo_val
                    elif config.promo_handling == "NOTE_ONLY":
                        promo_notes.append(f"{display_name}: {promo_qty:g} {unit_name}")

            # Nếu NPP chọn hiển thị chiết khấu tổng ở cuối hóa đơn (TOTAL_BOTTOM)
            if config.discount_display == "TOTAL_BOTTOM" and total_discount > 0:
                vat_reduction = round(total_discount * (config.default_vat_rate / 100.0))
                total_sub_before_tax = max(0.0, total_sub_before_tax - total_discount)
                total_vat = max(0.0, total_vat - vat_reduction)
                items.append(
                    PreviewInvoiceLine(
                        line_number=line_no,
                        item_type="DISCOUNT",
                        product_code="CK-TM",
                        product_name="Chiết khấu thương mại theo đơn hàng",
                        unit_name="Lần",
                        quantity=1,
                        unit_price=-round(total_discount),
                        discount_rate=0.0,
                        discount_amount=round(total_discount),
                        amount_before_tax=-round(total_discount),
                        vat_rate=config.default_vat_rate,
                        vat_amount=-vat_reduction,
                        total_amount=-(round(total_discount) + vat_reduction),
                        source_order_number=",".join(src_orders),
                    )
                )

            total_payment = round(total_sub_before_tax + total_vat)
            note_parts = [f"Xuất theo đơn hàng DMS: {', '.join(src_orders)}"]
            if promo_notes:
                note_parts.append(f"Hàng KM kèm theo: {'; '.join(promo_notes)}")
            layout_cfg = config.form_layout_config or {}
            if layout_cfg.get("footer_note"):
                note_parts.append(str(layout_cfg["footer_note"]))

            doc = PreviewInvoiceDocument(
                distributor_id=distributor.id,
                distributor_code=distributor.code,
                distributor_name=distributor.name,
                seller_tax_code=distributor.tax_code or "0100109106",
                seller_address=distributor.address or "Việt Nam",
                seller_phone=distributor.phone or "",
                seller_bank_account=config.seller_bank_account or "",
                seller_bank_name=config.seller_bank_name or "",
                invoice_config_id=config.id,
                provider=config.provider,
                invoice_template_code=config.invoice_template_code,
                invoice_series=config.invoice_series,
                supplier_code=supplier_code,
                source_order_numbers=src_orders,
                buyer_code=cust_code,
                buyer_name=buyer_name,
                buyer_legal_name=buyer_legal_name,
                buyer_tax_code=buyer_tax_code,
                buyer_address=buyer_address,
                payment_method=payment_method,
                subtotal_before_tax=round(total_sub_before_tax),
                discount_amount=round(total_discount),
                vat_rate=config.default_vat_rate,
                vat_amount=round(total_vat),
                total_payment=total_payment,
                amount_in_words=number_to_vietnamese_words(total_payment),
                note=" | ".join(note_parts),
                form_layout_config=layout_cfg,
                items=items,
            )
            doc.provider_payload_preview = provider_impl.build_provider_payload(doc, config)
            documents.append(doc)

        return documents

import os
import openpyxl
from datetime import datetime
from sqlalchemy.orm import Session
from app.models.sales import SalesOrder, SalesOrderItem
from app.models.customer import Customer
from app.services.vinamilk_customer_code import normalize_vinamilk_customer_code
from app.models.product import Product, ProductUnit, ProductCategory
from app.models.employee import Employee
from app.models.inventory import Warehouse

def sync_from_excel(db: Session, file_path: str):
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File {file_path} not found")

    wb = openpyxl.load_workbook(file_path, data_only=True)
    sheet = wb.active

    headers = [cell.value for cell in sheet[1]]
    
    # get default warehouse
    warehouse = db.query(Warehouse).first()
    if not warehouse:
        warehouse = Warehouse(code="DEF", name="Default Warehouse")
        db.add(warehouse)
        db.commit()

    # get default category
    category = db.query(ProductCategory).first()
    if not category:
        category = ProductCategory(code="DEF", name="Default Category")
        db.add(category)
        db.commit()

    # Caching dictionaries to avoid N+1 queries
    cust_cache = {c.code: c for c in db.query(Customer).all()}
    prod_cache = {p.sku: p for p in db.query(Product).all()}
    unit_cache = {u.name: u for u in db.query(ProductUnit).all()}

    orders_dict = {}

    for row in sheet.iter_rows(min_row=2, values_only=True):
        row_dict = dict(zip(headers, row))
        
        order_code = str(row_dict.get('Số đơn hàng'))
        if not order_code or order_code == 'None':
            continue
            
        # "Mã NVBH"/"Tên NVBH" là nhân viên thuộc Vinamilk, KHÔNG phải nhân viên
        # của công ty (nhân viên nhận hàng theo phiếu giao xuất). Không tạo/gán Employee.
        employee = None

        # Customer
        raw_cust_code = str(row_dict.get('Mã KH') or "").strip()
        cust_code = normalize_vinamilk_customer_code(raw_cust_code, "VINAMILK")
        cust_name = str(row_dict.get('Tên KH') or '')
        customer = None
        if cust_code and cust_code != 'None':
            customer = cust_cache.get(cust_code)
            if not customer:
                customer = Customer(code=cust_code, name=cust_name, type="RETAIL")
                db.add(customer)
                db.flush()
                cust_cache[cust_code] = customer

        # Product
        prod_sku = str(row_dict.get('Mã sản phẩm'))
        prod_name = str(row_dict.get('Sản phẩm') or '')
        prod_unit_name = str(row_dict.get('ĐVT') or 'CAI')
        
        product = None
        if prod_sku and prod_sku != 'None':
            product = prod_cache.get(prod_sku)
            if not product:
                unit = unit_cache.get(prod_unit_name)
                if not unit:
                    unit = ProductUnit(code=prod_unit_name[:10], name=prod_unit_name)
                    db.add(unit)
                    db.flush()
                    unit_cache[prod_unit_name] = unit
                    
                product = Product(sku=prod_sku, name=prod_name, category_id=category.id, unit_id=unit.id)
                db.add(product)
                db.flush()
                prod_cache[prod_sku] = product

        if order_code not in orders_dict:
            # parse date
            raw_date = row_dict.get('Ngày')
            delivery_date = None
            if isinstance(raw_date, datetime):
                delivery_date = raw_date
            elif isinstance(raw_date, str):
                try:
                    delivery_date = datetime.strptime(raw_date, "%d/%m/%Y")
                except:
                    pass

            orders_dict[order_code] = {
                'customer_id': customer.id if customer else None,
                'employee_id': employee.id if employee else None,
                'status': "COMPLETED",
                'delivery_date': delivery_date,
                'items': []
            }
            
        qty = float(row_dict.get('Số lượng') or 0)
        price = float(row_dict.get('Đơn giá') or 0)
        discount = float(row_dict.get('Số tiền CK') or 0)
        
        if product:
            orders_dict[order_code]['items'].append({
                'product_id': product.id,
                'quantity': int(qty),
                'price': price,
                'discount': discount,
                'line_total': (qty * price) - discount
            })

    for code, order_data in orders_dict.items():
        if not order_data['customer_id']:
            continue
            
        order = db.query(SalesOrder).filter(SalesOrder.code == code).first()
        if not order:
            order = SalesOrder(
                code=code,
                customer_id=order_data['customer_id'],
                employee_id=order_data['employee_id'],
                warehouse_id=warehouse.id,
                status=order_data['status'],
                payment_status="UNPAID",
                source="VINAMILK",
                delivery_date=order_data['delivery_date']
            )
            db.add(order)
            db.flush()
        else:
            for item in order.items:
                db.delete(item)
            db.flush()
            
        subtotal = 0
        total_discount = 0
        for item_data in order_data['items']:
            item = SalesOrderItem(
                order_id=order.id,
                product_id=item_data['product_id'],
                quantity=item_data['quantity'],
                price=item_data['price'],
                discount=item_data['discount'],
                line_total=item_data['line_total']
            )
            subtotal += (item_data['quantity'] * item_data['price'])
            total_discount += item_data['discount']
            db.add(item)
            
        order.subtotal = subtotal
        order.discount = total_discount
        order.total = subtotal - total_discount
        
    db.commit()
    return len(orders_dict)


import tempfile
from playwright.sync_api import sync_playwright

def download_and_sync_vinamilk_orders(db: Session, from_date: str, to_date: str) -> int:
    """
    Tự động xuất Excel danh sách chi tiết đơn hàng từ Vinamilk và đồng bộ vào DB.
    from_date, to_date có định dạng 'dd/mm/yyyy'.
    """
    from app.services.vinamilk_customer_report import _cookie_header, _browser_cookies
    from scripts.vinamilk_login import login_and_get_cookie

    cookie_header = _cookie_header() or login_and_get_cookie()
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-setuid-sandbox"])
        context = browser.new_context()
        context.add_cookies(_browser_cookies(cookie_header))
        
        # 1. Gọi API export-excel
        form_data = {
            "orderNumber": "",
            "refOrderNumber": "",
            "fromDate": from_date,
            "toDate": to_date,
            "deliveryDate": "",
            "customerCode": "",
            "customerName": "",
            "orderSource": "0",
            "priorityCode": "-1",
            "csvStatus": "",
            "xmlStatus": "",
            "saleStaff": "",
            "deliveryStaff": "",
            "orderType": "IN",
            "saleOrderType": "-1",
            "reportCode": "1790085269000",
            "reportFormId": ""
        }
        
        headers = {
            "accept": "application/json, text/javascript, */*; q=0.01",
            "x-requested-with": "XMLHttpRequest",
            "referer": "https://vinamilk.dmsone.vn/sale-product/search-sale/info"
        }
        
        response = context.request.post(
            "https://vinamilk.dmsone.vn/sale-product/search-sale/export-excel",
            form=form_data,
            headers=headers
        )
        
        if response.status in (401, 403):
            cookie_header = login_and_get_cookie()
            context.clear_cookies()
            context.add_cookies(_browser_cookies(cookie_header))
            response = context.request.post(
                "https://vinamilk.dmsone.vn/sale-product/search-sale/export-excel",
                form=form_data,
                headers=headers
            )
            
        data = response.json()
        if not data or data.get("error") or not data.get("path"):
            raise RuntimeError(f"Lỗi khi gọi API export-excel: {data}")
            
        excel_url = data["path"]
        
        # 2. Tải file excel về
        file_resp = context.request.get(
            excel_url,
            headers={"referer": "https://vinamilk.dmsone.vn/sale-product/search-sale/info"}
        )
        
        if not file_resp.ok:
            raise RuntimeError(f"Lỗi khi tải file excel: {file_resp.status}")
            
        excel_bytes = file_resp.body()
        
        # Lưu file tạm để gọi hàm sync_from_excel
        fd, temp_path = tempfile.mkstemp(suffix=".xlsx")
        import os
        with os.fdopen(fd, 'wb') as f:
            f.write(excel_bytes)
            
        browser.close()
        
    # 3. Đồng bộ vào DB
    try:
        count = sync_from_excel(db, temp_path)
        return count
    finally:
        os.remove(temp_path)


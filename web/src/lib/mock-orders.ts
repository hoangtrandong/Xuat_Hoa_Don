// src/lib/mock-orders.ts
// Mock data: Đơn hàng / Phiếu bán / Trả hàng (Sales Order)

import { customers } from "./mock-customers";
import { products } from "./mock-products";

export type OrderStatus = "Hoàn thành" | "Đang giao" | "Chờ duyệt" | "Đã hủy";
export type PaymentStatus = "Đã thanh toán" | "Thanh toán một phần" | "Chưa thanh toán";

export interface OrderItem {
  productCode: string;
  productName: string;
  unit: string;
  quantity: number;
  price: number;
  discount: number;
  lineTotal: number;
}

export interface SalesOrder {
  id: string;
  code: string;
  customerCode: string;
  customerName: string;
  customerType: string;
  address: string;
  district: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  total: number;
  createdAt: string;
  deliveryDate: string;
  warehouse: string;
  note?: string;
  source: "Web" | "Mobile";
  invoiceCode: string;
  paymentMethod: string;
  amountPaid: number;
}

type ItemSpec = [productCode: string, quantity: number, discount?: number];

function makeLine(spec: ItemSpec): OrderItem {
  const [productCode, quantity, discount = 0] = spec;
  const p = products.find((x) => x.code === productCode);
  if (!p) throw new Error(`Sản phẩm không tồn tại: ${productCode}`);
  const lineTotal = Math.round(p.price * quantity * (1 - discount / 100));
  return { productCode, productName: p.name, unit: p.unit, quantity, price: p.price, discount, lineTotal };
}

interface BuildOrderInput {
  code: string;
  createdAt: string;
  customerCode: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  items: ItemSpec[];
  orderDiscount?: number;
  warehouse?: string;
  note?: string;
  source?: "Web" | "Mobile";
}

function buildOrder(input: BuildOrderInput): SalesOrder {
  const c = customers.find((x) => x.code === input.customerCode);
  if (!c) throw new Error(`Khách hàng không tồn tại: ${input.customerCode}`);
  const items = input.items.map(makeLine);
  const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);
  const discount = Math.round((subtotal * (input.orderDiscount ?? 0)) / 100);
  const total = subtotal - discount;
  const paymentType = input.paymentStatus;
  const amountPaid =
    paymentType === "Đã thanh toán" ? total : paymentType === "Thanh toán một phần" ? Math.round(total * 0.5) : 0;
  return {
    id: input.code,
    code: input.code,
    customerCode: c.code,
    customerName: c.name,
    customerType: c.type,
    address: c.address,
    district: c.district,
    status: input.status,
    paymentStatus: paymentType,
    items,
    subtotal,
    discount,
    total,
    createdAt: input.createdAt,
    deliveryDate: input.createdAt.slice(0, 10),
    warehouse: input.warehouse ?? "Kho Tổng",
    note: input.note,
    source: input.source ?? "Mobile",
    invoiceCode: paymentType === "Chưa thanh toán" ? "" : input.code.replace("SO-", "INV-"),
    paymentMethod: paymentType === "Chưa thanh toán" ? "" : paymentType === "Thanh toán một phần" ? "COD" : "Chuyển khoản",
    amountPaid,
  };
}

export const salesOrders: SalesOrder[] = [
  buildOrder({ code: "SO-260906-001", createdAt: "2026-09-06T08:42:00", customerCode: "KH-0003", status: "Đang giao", paymentStatus: "Đã thanh toán", items: [["SKU-007", 24], ["SKU-008", 60], ["SKU-020", 30]], orderDiscount: 3, note: "Ưu tiên giao trước 14h" }),
  buildOrder({ code: "SO-260906-002", createdAt: "2026-09-06T08:58:00", customerCode: "KH-0011", status: "Chờ duyệt", paymentStatus: "Chưa thanh toán", items: [["SKU-001", 12], ["SKU-003", 20]], orderDiscount: 2, note: "Chờ duyệt giá đại lý" }),
  buildOrder({ code: "SO-260906-003", createdAt: "2026-09-06T09:15:00", customerCode: "KH-0016", status: "Hoàn thành", paymentStatus: "Đã thanh toán", items: [["SKU-011", 5], ["SKU-012", 40]], orderDiscount: 2, source: "Web" }),
  buildOrder({ code: "SO-260906-004", createdAt: "2026-09-06T09:40:00", customerCode: "KH-0001", status: "Hoàn thành", paymentStatus: "Đã thanh toán", items: [["SKU-013", 30], ["SKU-014", 20], ["SKU-016", 24]], orderDiscount: 3 }),
  buildOrder({ code: "SO-260906-005", createdAt: "2026-09-06T10:05:00", customerCode: "KH-0005", status: "Đang giao", paymentStatus: "Thanh toán một phần", items: [["SKU-010", 12], ["SKU-020", 24]], warehouse: "Kho HCM" }),
  buildOrder({ code: "SO-260906-006", createdAt: "2026-09-06T10:26:00", customerCode: "KH-0014", status: "Chờ duyệt", paymentStatus: "Chưa thanh toán", items: [["SKU-009", 50], ["SKU-012", 30]], orderDiscount: 3, source: "Web" }),
  buildOrder({ code: "SO-260906-007", createdAt: "2026-09-06T10:52:00", customerCode: "KH-0022", status: "Hoàn thành", paymentStatus: "Đã thanh toán", items: [["SKU-002", 6], ["SKU-005", 12]], warehouse: "Kho HCM" }),
  buildOrder({ code: "SO-260906-008", createdAt: "2026-09-06T14:18:00", customerCode: "KH-0019", status: "Đang giao", paymentStatus: "Chưa thanh toán", items: [["SKU-004", 40], ["SKU-006", 30]], orderDiscount: 4 }),
  buildOrder({ code: "SO-260905-001", createdAt: "2026-09-05T09:30:00", customerCode: "KH-0002", status: "Hoàn thành", paymentStatus: "Đã thanh toán", items: [["SKU-003", 4], ["SKU-018", 10]] }),
  buildOrder({ code: "SO-260905-002", createdAt: "2026-09-05T11:02:00", customerCode: "KH-0012", status: "Hoàn thành", paymentStatus: "Đã thanh toán", items: [["SKU-001", 6], ["SKU-013", 12]] }),
  buildOrder({ code: "SO-260905-003", createdAt: "2026-09-05T15:47:00", customerCode: "KH-0009", status: "Hoàn thành", paymentStatus: "Thanh toán một phần", items: [["SKU-011", 10], ["SKU-015", 100]], orderDiscount: 3 }),
  buildOrder({ code: "SO-260905-004", createdAt: "2026-09-05T16:20:00", customerCode: "KH-0010", status: "Hoàn thành", paymentStatus: "Đã thanh toán", items: [["SKU-010", 15], ["SKU-020", 30]], warehouse: "Kho HCM" }),
  buildOrder({ code: "SO-260904-001", createdAt: "2026-09-04T10:11:00", customerCode: "KH-0006", status: "Đã hủy", paymentStatus: "Chưa thanh toán", items: [["SKU-008", 20], ["SKU-016", 30]], orderDiscount: 2, note: "Khách hủy do thiếu vốn" }),
  buildOrder({ code: "SO-260904-002", createdAt: "2026-09-04T13:44:00", customerCode: "KH-0017", status: "Hoàn thành", paymentStatus: "Đã thanh toán", items: [["SKU-005", 6], ["SKU-002", 4]], warehouse: "Kho HCM" }),
  buildOrder({ code: "SO-260903-001", createdAt: "2026-09-03T09:58:00", customerCode: "KH-0021", status: "Đang giao", paymentStatus: "Chưa thanh toán", items: [["SKU-007", 30]], orderDiscount: 2 }),
  buildOrder({ code: "SO-260903-002", createdAt: "2026-09-03T15:05:00", customerCode: "KH-0015", status: "Hoàn thành", paymentStatus: "Đã thanh toán", items: [["SKU-018", 10], ["SKU-020", 6]], warehouse: "Kho HCM" }),
  buildOrder({ code: "SO-260902-001", createdAt: "2026-09-02T08:35:00", customerCode: "KH-0008", status: "Hoàn thành", paymentStatus: "Đã thanh toán", items: [["SKU-012", 4]] }),
  buildOrder({ code: "SO-260901-001", createdAt: "2026-09-01T09:12:00", customerCode: "KH-0018", status: "Hoàn thành", paymentStatus: "Thanh toán một phần", items: [["SKU-011", 3], ["SKU-014", 10]], warehouse: "Kho HCM" }),
];

// Trả hàng (Returns)
export interface ReturnOrder {
  id: string;
  code: string;
  orderCode: string;
  customerName: string;
  productName: string;
  unit: string;
  quantity: number;
  amount: number;
  reason: string;
  status: "Chờ duyệt" | "Đã duyệt";
  createdAt: string;
}

export const returnOrders: ReturnOrder[] = [
  { id: "RT-01", code: "RT-260906-001", orderCode: "SO-260906-003", customerName: "Đại lý Hồng Phát", productName: "Bia Heineken 330ml (Thùng 24)", unit: "Chai", quantity: 1, amount: 17500, reason: "Vỡ hàng khi vận chuyển", status: "Chờ duyệt", createdAt: "2026-09-06T11:20:00" },
  { id: "RT-02", code: "RT-260906-002", orderCode: "SO-260906-008", customerName: "Nhà phân phối Đại Nam", productName: "Comfort Xanh 800ml", unit: "Chai", quantity: 3, amount: 225000, reason: "Đặt nhầm dung tích", status: "Đã duyệt", createdAt: "2026-09-06T15:02:00" },
  { id: "RT-03", code: "RT-260905-001", orderCode: "SO-260905-004", customerName: "Khách sạn Windsor Plaza", productName: "Tương ớt Chinsu 250g", unit: "Chai", quantity: 6, amount: 90000, reason: "Sai hàng (đặt 2 chai, giao 6)", status: "Đã duyệt", createdAt: "2026-09-05T17:30:00" },
  { id: "RT-04", code: "RT-260904-001", orderCode: "SO-260904-002", customerName: "Cửa hàng Xuân Thu", productName: "Vim Diệt Khuẩn 900ml", unit: "Chai", quantity: 2, amount: 84000, reason: "Hàng gần hết hạn sử dụng", status: "Chờ duyệt", createdAt: "2026-09-04T15:12:00" },
  { id: "RT-05", code: "RT-260903-001", orderCode: "SO-260903-001", customerName: "Đại lý Ánh Dương", productName: "Bánh quy Cosy 300g", unit: "Hộp", quantity: 4, amount: 180000, reason: "Hàng tồn ế cần trả lại", status: "Đã duyệt", createdAt: "2026-09-03T16:45:00" },
  { id: "RT-06", code: "RT-260902-001", orderCode: "SO-260902-001", customerName: "Tạp hóa Bé Na", productName: "Nước ngọt Coca-Cola 390ml", unit: "Lốc", quantity: 2, amount: 90000, reason: "Móp hộp, hư hỏng", status: "Chờ duyệt", createdAt: "2026-09-02T10:20:00" },
];

// Hóa đơn (phiếu bán) = các đơn đã xuất

export const salesInvoices = salesOrders.filter((o) => o.invoiceCode !== "");

export function getOrderById(code: string): SalesOrder | undefined {
  return salesOrders.find((o) => o.code === code);
}

export function getOrdersByCustomer(customerCode: string): SalesOrder[] {
  return salesOrders.filter((o) => o.customerCode === customerCode);
}
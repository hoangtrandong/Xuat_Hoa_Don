// src/lib/order-store.ts
// LocalStorage store: đơn hàng tạo mới (UI mock, dữ liệu giữ khi refresh page)

import { salesOrders, type SalesOrder, type OrderItem, type PaymentStatus } from "./mock-orders";
import { reserveStock } from "./inventory-store";
import type { Customer } from "./mock-customers";

const ORDER_KEY = "dms.created.orders.v1";

function readCreatedOrders(): SalesOrder[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ORDER_KEY);
    return raw ? (JSON.parse(raw) as SalesOrder[]) : [];
  } catch {
    return [];
  }
}

function writeCreatedOrders(orders: SalesOrder[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ORDER_KEY, JSON.stringify(orders));
}

/** Tất cả đơn: đơn mới tạo hiện trước (mới nhất trên cùng), kế đó là dữ liệu demo */
export function getAllOrders(): SalesOrder[] {
  return [...readCreatedOrders(), ...salesOrders];
}

export function getCreatedOrderCount(): number {
  return readCreatedOrders().length;
}

export function generateOrderCode(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(2);
  const prefix = `SO-${yy}${mm}${dd}-`;
  const maxSeq = getAllOrders()
    .filter((o) => o.code.startsWith(prefix))
    .map((o) => parseInt(o.code.slice(prefix.length), 10) || 0);
  const seq = (maxSeq.length ? Math.max(...maxSeq) : 0) + 1;
  return `${prefix}${String(seq).padStart(3, "0")}`;
}

export interface NewOrderInput {
  customer: Customer;
  warehouse: string;
  items: OrderItem[];
  orderDiscount: number; // phần trăm cấp đơn
  paymentMethod: string;
  amountPaid: number;
  note?: string;
}

export function createOrder(input: NewOrderInput): SalesOrder {
  const subtotal = input.items.reduce((s, it) => s + it.lineTotal, 0);
  const discount = Math.round((subtotal * input.orderDiscount) / 100);
  const total = subtotal - discount;
  const paymentStatus: PaymentStatus =
    total > 0 && input.amountPaid >= total
      ? "Đã thanh toán"
      : input.amountPaid > 0
        ? "Thanh toán một phần"
        : "Chưa thanh toán";
  const code = generateOrderCode();
  const now = new Date().toISOString();
  const invoiceCode = paymentStatus === "Chưa thanh toán" ? "" : code.replace("SO-", "INV-");
  const order: SalesOrder = {
    id: code,
    code,
    customerCode: input.customer.code,
    customerName: input.customer.name,
    customerType: input.customer.type,
    phone: input.customer.phone,
    address: input.customer.address,
    district: input.customer.district,
    routeCode: input.customer.routeCode,
    salesRep: input.customer.salesRep,
    status:
      paymentStatus === "Đã thanh toán"
        ? "Hoàn thành"
        : paymentStatus === "Thanh toán một phần"
          ? "Đang giao"
          : "Chờ duyệt",
    paymentStatus,
    items: input.items,
    subtotal,
    discount,
    total,
    createdAt: now,
    deliveryDate: now.slice(0, 10),
    warehouse: input.warehouse,
    note: input.note,
    source: "Web",
    invoiceCode,
    paymentMethod: paymentStatus === "Chưa thanh toán" ? "" : input.paymentMethod,
    amountPaid: paymentStatus === "Chưa thanh toán" ? 0 : input.amountPaid,
  };
  writeCreatedOrders([order, ...readCreatedOrders()]);
  return order;
}

/** Giu cho ton kho cho cac dong san pham cua don vua tao */
export function reserveOrderStock(items: OrderItem[]): void {
  items.forEach((it) => reserveStock(it.productCode, it.quantity));
}

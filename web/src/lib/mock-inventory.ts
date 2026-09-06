// src/lib/mock-inventory.ts
// Mock data: Kho, tồn kho & Sổ nhật ký giao dịch (Ledger inventory_transactions)

import { products } from "./mock-products";

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  location: string;
  manager: string;
}

export const warehouses: Warehouse[] = [
  { id: "WH01", code: "KT", name: "Kho Tổng", location: "Bình Tân, TP.HCM", manager: "Nguyễn Thủ Kho" },
  { id: "WH02", code: "KHCM", name: "Kho Chi nhánh HCM", location: "Gò Vấp, TP.HCM", manager: "Trần Thủ Kho" },
];

export interface StockLevel {
  id: string;
  productCode: string;
  productName: string;
  category: string;
  unit: string;
  onHand: number;
  reserved: number;
  available: number;
  reorderPoint: number;
  unitValue: number;
  totalValue: number;
}

const stockOverrides: Record<string, { onHand?: number; reserved?: number; reorderPoint?: number }> = {
  "SKU-002": { reorderPoint: 60 }, // tồn 45 < 60 -> sắp hết
  "SKU-004": { onHand: 15, reserved: 6, reorderPoint: 30 },
  "SKU-011": { onHand: 8, reserved: 2, reorderPoint: 12 },
  "SKU-016": { onHand: 12, reserved: 4, reorderPoint: 30 },
  "SKU-017": { onHand: 0, reserved: 0, reorderPoint: 20 },
};

export const stockLevels: StockLevel[] = products.map((p) => {
  const o = stockOverrides[p.code] ?? {};
  const onHand = o.onHand ?? p.stock;
  const reserved = o.reserved ?? Math.round(onHand * 0.15);
  const reorderPoint = o.reorderPoint ?? 20;
  const available = Math.max(0, onHand - reserved);
  return {
    id: p.id,
    productCode: p.code,
    productName: p.name,
    category: p.category,
    unit: p.unit,
    onHand,
    reserved,
    available,
    reorderPoint,
    unitValue: p.costPrice,
    totalValue: onHand * p.costPrice,
  };
});

export type LedgerType = "OPENING" | "IN" | "OUT" | "ADJUST";

export interface LedgerEntry {
  id: number;
  code: string;
  type: LedgerType;
  productCode: string;
  productName: string;
  unit: string;
  warehouse: string;
  quantity: number;
  refType: string;
  refCode: string;
  createdAt: string;
  createdBy: string;
  note: string;
}

export const ledgerEntries: LedgerEntry[] = [
  // Ngày 06/09 - Xuất kho theo đơn hàng
  { id: 24, code: "ITT-260906-008", type: "OUT", productCode: "SKU-006", productName: "Nước lau sàn Sunlight 1kg", unit: "Chai", warehouse: "Kho Tổng", quantity: -30, refType: "SO", refCode: "SO-260906-008", createdAt: "2026-09-06T14:20:00", createdBy: "Trần Thủ Kho", note: "Xuất theo đơn SO-260906-008" },
  { id: 23, code: "ITT-260906-007", type: "OUT", productCode: "SKU-004", productName: "Comfort Xanh 800ml", unit: "Chai", warehouse: "Kho Tổng", quantity: -40, refType: "SO", refCode: "SO-260906-008", createdAt: "2026-09-06T14:19:00", createdBy: "Trần Thủ Kho", note: "Xuất theo đơn SO-260906-008" },
  { id: 22, code: "ITT-260906-006", type: "OUT", productCode: "SKU-005", productName: "Vim Diệt Khuẩn 900ml", unit: "Chai", warehouse: "Kho HCM", quantity: -12, refType: "SO", refCode: "SO-260906-007", createdAt: "2026-09-06T10:55:00", createdBy: "Nguyễn Thủ Kho", note: "Xuất theo đơn SO-260906-007" },
  { id: 21, code: "ITT-260906-005", type: "OUT", productCode: "SKU-002", productName: "Dầu xả Sunsilk 320ml", unit: "Chai", warehouse: "Kho HCM", quantity: -6, refType: "SO", refCode: "SO-260906-007", createdAt: "2026-09-06T10:54:00", createdBy: "Nguyễn Thủ Kho", note: "Xuất theo đơn SO-260906-007" },
  { id: 20, code: "ITT-260906-004", type: "OUT", productCode: "SKU-012", productName: "Nước ngọt Coca-Cola 390ml", unit: "Lốc", warehouse: "Kho Tổng", quantity: -30, refType: "SO", refCode: "SO-260906-006", createdAt: "2026-09-06T10:30:00", createdBy: "Trần Thủ Kho", note: "Xuất theo đơn SO-260906-006" },
  { id: 19, code: "ITT-260906-003", type: "OUT", productCode: "SKU-009", productName: "Mì Hảo Hảo Tôm Chua Cay", unit: "Thùng", warehouse: "Kho Tổng", quantity: -50, refType: "SO", refCode: "SO-260906-006", createdAt: "2026-09-06T10:29:00", createdBy: "Trần Thủ Kho", note: "Xuất theo đơn SO-260906-006" },
  { id: 18, code: "ITT-260906-002", type: "OUT", productCode: "SKU-013", productName: "Sữa tươi Vinamilk 100% 180ml", unit: "Lốc", warehouse: "Kho Tổng", quantity: -30, refType: "SO", refCode: "SO-260906-004", createdAt: "2026-09-06T09:45:00", createdBy: "Nguyễn Thủ Kho", note: "Xuất theo đơn SO-260906-004" },
  { id: 17, code: "ITT-260906-001", type: "OUT", productCode: "SKU-008", productName: "Kẹo dẻo Chupa Chups 150g", unit: "Gói", warehouse: "Kho Tổng", quantity: -60, refType: "SO", refCode: "SO-260906-001", createdAt: "2026-09-06T08:45:00", createdBy: "Trần Thủ Kho", note: "Xuất theo đơn SO-260906-001" },
  // Ngày 05/09 - Nhập kho + điều chỉnh
  { id: 16, code: "ITT-260905-005", type: "ADJUST", productCode: "SKU-004", productName: "Comfort Xanh 800ml", unit: "Chai", warehouse: "Kho Tổng", quantity: -3, refType: "ADJ", refCode: "ADJ-260905-01", createdAt: "2026-09-05T17:10:00", createdBy: "Lê Kế Toán", note: "Hàng hư hỏng phát hiện khi kiểm kê" },
  { id: 15, code: "ITT-260905-004", type: "OUT", productCode: "SKU-012", productName: "Nước ngọt Coca-Cola 390ml", unit: "Lốc", warehouse: "Kho HCM", quantity: -12, refType: "SO", refCode: "SO-260905-004", createdAt: "2026-09-05T16:25:00", createdBy: "Nguyễn Thủ Kho", note: "Xuất theo đơn SO-260905-004" },
  { id: 14, code: "ITT-260905-003", type: "OUT", productCode: "SKU-003", productName: "Omo Matic 3kg", unit: "Túi", warehouse: "Kho Tổng", quantity: -4, refType: "SO", refCode: "SO-260905-001", createdAt: "2026-09-05T09:35:00", createdBy: "Trần Thủ Kho", note: "Xuất theo đơn SO-260905-001" },
  { id: 13, code: "ITT-260905-002", type: "IN", productCode: "SKU-013", productName: "Sữa tươi Vinamilk 100% 180ml", unit: "Lốc", warehouse: "Kho Tổng", quantity: 80, refType: "PO", refCode: "PO-260902-02", createdAt: "2026-09-05T08:30:00", createdBy: "Nguyễn Thủ Kho", note: "Nhập hàng Vinamilk theo đơn PO-260902-02" },
  { id: 12, code: "ITT-260905-001", type: "IN", productCode: "SKU-001", productName: "Dầu gội Clear 650ml", unit: "Chai", warehouse: "Kho Tổng", quantity: 60, refType: "PO", refCode: "PO-260902-01", createdAt: "2026-09-05T08:15:00", createdBy: "Nguyễn Thủ Kho", note: "Nhập hàng Unilever theo đơn PO-260902-01" },
  // Ngày 04/09
  { id: 11, code: "ITT-260904-004", type: "ADJUST", productCode: "SKU-015", productName: "Nước suối Aquafina 500ml", unit: "Chai", warehouse: "Kho Tổng", quantity: 100, refType: "ADJ", refCode: "ADJ-260904-01", createdAt: "2026-09-04T16:40:00", createdBy: "Lê Kế Toán", note: "Kiểm kê phát hiện thừa" },
  { id: 10, code: "ITT-260904-003", type: "OUT", productCode: "SKU-016", productName: "Sữa đặc Ông Thọ 380g", unit: "Lon", warehouse: "Kho Tổng", quantity: -30, refType: "SO", refCode: "SO-260904-001", createdAt: "2026-09-04T10:15:00", createdBy: "Trần Thủ Kho", note: "Xuất theo đơn SO-260904-001" },
  { id: 9, code: "ITT-260904-002", type: "OUT", productCode: "SKU-008", productName: "Kẹo dẻo Chupa Chups 150g", unit: "Gói", warehouse: "Kho Tổng", quantity: -20, refType: "SO", refCode: "SO-260904-001", createdAt: "2026-09-04T10:14:00", createdBy: "Trần Thủ Kho", note: "Xuất theo đơn SO-260904-001" },
  { id: 8, code: "ITT-260904-001", type: "IN", productCode: "SKU-011", productName: "Bia Heineken 330ml (Thùng 24)", unit: "Thùng", warehouse: "Kho Tổng", quantity: 30, refType: "PO", refCode: "PO-260901-01", createdAt: "2026-09-04T08:00:00", createdBy: "Nguyễn Thủ Kho", note: "Nhập bia Heineken theo đơn PO-260901-01" },
  // Ngày 03/09
  { id: 7, code: "ITT-260903-002", type: "IN", productCode: "SKU-007", productName: "Bánh quy Cosy 300g", unit: "Hộp", warehouse: "Kho Tổng", quantity: 100, refType: "PO", refCode: "PO-260831-01", createdAt: "2026-09-03T09:20:00", createdBy: "Trần Thủ Kho", note: "Nhập hàng Việt Đại theo đơn PO-260831-01" },
  { id: 6, code: "ITT-260903-001", type: "IN", productCode: "SKU-008", productName: "Kẹo dẻo Chupa Chups 150g", unit: "Gói", warehouse: "Kho Tổng", quantity: 200, refType: "PO", refCode: "PO-260831-01", createdAt: "2026-09-03T09:18:00", createdBy: "Trần Thủ Kho", note: "Nhập hàng Việt Đại theo đơn PO-260831-01" },
  // Ngày 01/09 - Tồn đầu kỳ
  { id: 5, code: "ITT-260901-005", type: "OPENING", productCode: "SKU-015", productName: "Nước suối Aquafina 500ml", unit: "Chai", warehouse: "Kho Tổng", quantity: 700, refType: "BAL", refCode: "OPEN-20260901", createdAt: "2026-09-01T07:00:00", createdBy: "Lê Kế Toán", note: "Tồn đầu kỳ tháng 09" },
  { id: 4, code: "ITT-260901-004", type: "OPENING", productCode: "SKU-011", productName: "Bia Heineken 330ml (Thùng 24)", unit: "Thùng", warehouse: "Kho Tổng", quantity: 8, refType: "BAL", refCode: "OPEN-20260901", createdAt: "2026-09-01T07:00:00", createdBy: "Lê Kế Toán", note: "Tồn đầu kỳ tháng 09" },
  { id: 3, code: "ITT-260901-003", type: "OPENING", productCode: "SKU-009", productName: "Mì Hảo Hảo Tôm Chua Cay", unit: "Thùng", warehouse: "Kho Tổng", quantity: 470, refType: "BAL", refCode: "OPEN-20260901", createdAt: "2026-09-01T07:00:00", createdBy: "Lê Kế Toán", note: "Tồn đầu kỳ tháng 09" },
  { id: 2, code: "ITT-260901-002", type: "OPENING", productCode: "SKU-001", productName: "Dầu gội Clear 650ml", unit: "Chai", warehouse: "Kho Tổng", quantity: 60, refType: "BAL", refCode: "OPEN-20260901", createdAt: "2026-09-01T07:00:00", createdBy: "Lê Kế Toán", note: "Tồn đầu kỳ tháng 09" },
  { id: 1, code: "ITT-260901-001", type: "OPENING", productCode: "SKU-007", productName: "Bánh quy Cosy 300g", unit: "Hộp", warehouse: "Kho Tổng", quantity: 220, refType: "BAL", refCode: "OPEN-20260901", createdAt: "2026-09-01T07:00:00", createdBy: "Lê Kế Toán", note: "Tồn đầu kỳ tháng 09" },
];

export const ledgerLabels: Record<LedgerType, string> = {
  OPENING: "Tồn đầu kỳ",
  IN: "Nhập kho",
  OUT: "Xuất kho",
  ADJUST: "Điều chỉnh",
};
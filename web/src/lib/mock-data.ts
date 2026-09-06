// src/lib/mock-data.ts
// Mock data for Dashboard

export const kpiData = {
  revenue: { value: 142_600_000, change: 12.4, label: "Doanh thu hôm nay", unit: "VND" },
  orders: { value: 128, change: 8.2, label: "Đơn hàng hôm nay", unit: "" },
  customers: { value: 963, total: 2310, label: "Khách hàng đã mua", unit: "" },
  inventory: { value: 12_800_000_000, change: -2.1, label: "Giá trị tồn kho", unit: "VND" },
};

export const revenueByDay = [
  { label: "T2", value: 95_000_000 },
  { label: "T3", value: 112_000_000 },
  { label: "T4", value: 88_000_000 },
  { label: "T5", value: 134_000_000 },
  { label: "T6", value: 124_500_000 },
  { label: "T7", value: 142_600_000 },
];

export const revenueByMonth = [
  { label: "T1", value: 1_850_000_000 },
  { label: "T2", value: 2_100_000_000 },
  { label: "T3", value: 1_980_000_000 },
  { label: "T4", value: 2_350_000_000 },
  { label: "T5", value: 2_480_000_000 },
  { label: "T6", value: 2_720_000_000 },
  { label: "T7", value: 2_890_000_000 },
  { label: "T8", value: 3_100_000_000 },
  { label: "T9", value: 880_000_000 },
];

export const revenueBySupplier = [
  { name: "Việt Đại", value: 52_000_000, color: "#0ea5e9" },
  { name: "Cầu Đỏ", value: 38_000_000, color: "#8b5cf6" },
  { name: "Hayat", value: 28_000_000, color: "#f59e0b" },
  { name: "Unilever", value: 15_600_000, color: "#10b981" },
  { name: "Khác", value: 9_000_000, color: "#6b7280" },
];

export const topSales = [
  { name: "Nguyễn Văn A", avatar: "NA", value: 45_200_000, orders: 38, customers: 22 },
  { name: "Trần Thị B", avatar: "TB", value: 38_700_000, orders: 31, customers: 18 },
  { name: "Lê Văn C", avatar: "LC", value: 31_500_000, orders: 27, customers: 15 },
  { name: "Phạm Thị D", avatar: "PD", value: 18_200_000, orders: 19, customers: 11 },
  { name: "Hoàng Văn E", avatar: "HE", value: 9_000_000, orders: 13, customers: 7 },
];

export const customerCoverage = {
  visited: 963,
  total: 2310,
  bought: 820,
  notBought: 143,
};

// Drill-down data: Nhà cung cấp -> Nhân viên

export interface DrilldownItem {
  name: string;
  value: number;
  orders: number;
  customers: number;
}

export const drilldownData: Record<string, { employees: DrilldownItem[] }> = {
  "Việt Đại": {
    employees: [
      { name: "Nguyễn Văn A", value: 20_000_000, orders: 15, customers: 8 },
      { name: "Trần Thị B", value: 18_000_000, orders: 12, customers: 6 },
      { name: "Lê Văn C", value: 14_000_000, orders: 9, customers: 5 },
    ],
  },
  "Cầu Đỏ": {
    employees: [
      { name: "Nguyễn Văn A", value: 16_000_000, orders: 11, customers: 6 },
      { name: "Phạm Thị D", value: 12_000_000, orders: 8, customers: 4 },
      { name: "Hoàng Văn E", value: 10_000_000, orders: 6, customers: 3 },
    ],
  },
  "Hayat": {
    employees: [
      { name: "Trần Thị B", value: 14_000_000, orders: 9, customers: 5 },
      { name: "Lê Văn C", value: 9_000_000, orders: 7, customers: 4 },
      { name: "Hoàng Văn E", value: 5_000_000, orders: 4, customers: 2 },
    ],
  },
  "Unilever": {
    employees: [
      { name: "Nguyễn Văn A", value: 7_000_000, orders: 6, customers: 4 },
      { name: "Trần Thị B", value: 5_000_000, orders: 5, customers: 3 },
      { name: "Lý Mỹ H", value: 3_600_000, orders: 4, customers: 2 },
    ],
  },
  "Khác": {
    employees: [
      { name: "Hoàng Văn E", value: 4_000_000, orders: 3, customers: 2 },
      { name: "Phạm Thị D", value: 3_000_000, orders: 3, customers: 2 },
      { name: "Lê Văn C", value: 2_000_000, orders: 2, customers: 1 },
    ],
  },
};
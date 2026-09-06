// src/lib/mock-employees.ts
// Mock data: Nhân viên / Vị trí / KPI (Sales & Employee)

export type EmployeePosition = "Giám đốc vùng" | "Giám sát" | "Nhân viên kinh doanh";

export interface Employee {
  id: string;
  code: string;
  name: string;
  position: EmployeePosition;
  territory: string;
  routes: string[];
  phone: string;
  email: string;
  status: "active" | "inactive";
  joinDate: string;
  target: number;
  achieved: number;
  orders: number;
  customersServed: number;
  newCustomersTarget: number;
  newCustomers: number;
  visitTarget: number;
  visits: number;
  avatar: string;
}

export const employees: Employee[] = [
  { id: "NV001", code: "NV001", name: "Nguyễn Văn A", position: "Nhân viên kinh doanh", territory: "KV HCM - Khu 1", routes: ["TX.01"], phone: "0912 000 101", email: "nva@dms.vn", status: "active", joinDate: "2021-06-15", target: 120000000, achieved: 128500000, orders: 86, customersServed: 38, newCustomersTarget: 15, newCustomers: 18, visitTarget: 60, visits: 64, avatar: "NA" },
  { id: "NV002", code: "NV002", name: "Trần Thị B", position: "Nhân viên kinh doanh", territory: "KV HCM - Khu 2", routes: ["TX.02"], phone: "0912 000 102", email: "ttb@dms.vn", status: "active", joinDate: "2021-09-01", target: 110000000, achieved: 104200000, orders: 72, customersServed: 31, newCustomersTarget: 12, newCustomers: 11, visitTarget: 56, visits: 52, avatar: "TB" },
  { id: "NV003", code: "NV003", name: "Lê Văn C", position: "Nhân viên kinh doanh", territory: "KV HCM - Khu 3", routes: ["TX.03"], phone: "0912 000 103", email: "lvc@dms.vn", status: "active", joinDate: "2022-02-10", target: 100000000, achieved: 86400000, orders: 64, customersServed: 27, newCustomersTarget: 10, newCustomers: 7, visitTarget: 52, visits: 41, avatar: "LC" },
  { id: "NV004", code: "NV004", name: "Phạm Thị D", position: "Nhân viên kinh doanh", territory: "KV HCM - Khu 4", routes: ["TX.04"], phone: "0912 000 104", email: "ptd@dms.vn", status: "active", joinDate: "2022-08-22", target: 80000000, achieved: 92100000, orders: 58, customersServed: 21, newCustomersTarget: 8, newCustomers: 12, visitTarget: 44, visits: 50, avatar: "PD" },
  { id: "NV005", code: "NV005", name: "Hoàng Văn E", position: "Nhân viên kinh doanh", territory: "KV HCM - Khu 5", routes: ["TX.05"], phone: "0912 000 105", email: "hve@dms.vn", status: "active", joinDate: "2023-01-05", target: 70000000, achieved: 51600000, orders: 41, customersServed: 17, newCustomersTarget: 8, newCustomers: 5, visitTarget: 40, visits: 29, avatar: "HE" },
  { id: "NV006", code: "NV006", name: "Lý Mỹ H", position: "Nhân viên kinh doanh", territory: "KV HCM - Khu 2", routes: ["TX.06"], phone: "0912 000 106", email: "lmh@dms.vn", status: "active", joinDate: "2023-11-18", target: 90000000, achieved: 59800000, orders: 39, customersServed: 14, newCustomersTarget: 10, newCustomers: 4, visitTarget: 48, visits: 31, avatar: "LH" },
  { id: "NV007", code: "NV007", name: "Ngô Thị F", position: "Giám sát", territory: "KV HCM - Khu 2 & 5", routes: ["TX.02", "TX.05", "TX.06"], phone: "0912 000 107", email: "ntf@dms.vn", status: "active", joinDate: "2020-05-20", target: 200000000, achieved: 164000000, orders: 111, customersServed: 45, newCustomersTarget: 22, newCustomers: 15, visitTarget: 104, visits: 83, avatar: "NF" },
  { id: "NV008", code: "NV008", name: "Trần Quốc G", position: "Giám đốc vùng", territory: "KV HCM", routes: ["TX.01", "TX.02", "TX.03", "TX.04", "TX.05", "TX.06"], phone: "0912 000 108", email: "tqg@dms.vn", status: "active", joinDate: "2019-03-01", target: 570000000, achieved: 522600000, orders: 360, customersServed: 148, newCustomersTarget: 63, newCustomers: 57, visitTarget: 300, visits: 267, avatar: "TG" },
];

export const teamKpi = {
  month: "09/2026",
  totalTarget: employees.reduce((s, e) => s + e.target, 0),
  totalAchieved: employees.reduce((s, e) => s + e.achieved, 0),
  totalOrders: employees.reduce((s, e) => s + e.orders, 0),
  totalNewCustomers: employees.reduce((s, e) => s + e.newCustomers, 0),
  totalNewCustomersTarget: employees.reduce((s, e) => s + e.newCustomersTarget, 0),
  totalVisits: employees.reduce((s, e) => s + e.visits, 0),
  totalVisitTarget: employees.reduce((s, e) => s + e.visitTarget, 0),
  activeCount: employees.filter((e) => e.status === "active").length,
};
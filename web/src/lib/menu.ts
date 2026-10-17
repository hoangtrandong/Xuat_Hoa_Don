// src/lib/menu.ts
export interface MenuItem {
  key: string;
  label: string;
  icon: string;
  href: string;
  children?: Omit<MenuItem, "children">[];
}

export const menuItems: MenuItem[] = [
  { key: "dashboard", label: "Dashboard", icon: "LayoutDashboard", href: "/" },
  {
    key: "products",
    label: "Hàng hóa",
    icon: "Package",
    href: "/products",
    children: [
      { key: "products-list", label: "Danh sách SKU", icon: "List", href: "/products" },
      { key: "products-company-management", label: "Quản lý mã NPP nội bộ", icon: "Building2", href: "/products/company-management" },
      { key: "products-categories", label: "Danh mục", icon: "FolderOpen", href: "/products/categories" },
      { key: "products-price", label: "Bảng giá", icon: "Tag", href: "/products/price-lists" },
    ],
  },
  {
    key: "customers",
    label: "Khách hàng",
    icon: "Users",
    href: "/customers",
    children: [
      { key: "customers-stores", label: "Cửa hàng", icon: "Store", href: "/customers/stores" },
      { key: "customers-list", label: "Khách hàng", icon: "List", href: "/customers" },
      { key: "customers-companies", label: "Công ty quản lý", icon: "Building2", href: "/customers/companies" },
    ],
  },
  {
    key: "sales",
    label: "Bán hàng",
    icon: "ShoppingCart",
    href: "/sales",
    children: [
      { key: "sales-orders", label: "Đơn hàng", icon: "FileText", href: "/sales/orders" },
      { key: "sales-summary", label: "Tổng hợp đơn hàng", icon: "BarChart2", href: "/sales/summary" },
      { key: "sales-returns", label: "Trả hàng", icon: "RotateCcw", href: "/sales/returns" },
    ],
  },
  {
    key: "warehouse",
    label: "Kho",
    icon: "Warehouse",
    href: "/warehouse",
    children: [
      { key: "warehouse-queue", label: "Hàng đợi xuất kho", icon: "ClipboardList", href: "/warehouse/delivery-queue" },
      { key: "warehouse-inventory", label: "Tồn kho", icon: "BoxesIcon", href: "/warehouse/inventory" },
      { key: "warehouse-in", label: "Nhập kho", icon: "PackagePlus", href: "/warehouse/import" },
      { key: "warehouse-out", label: "Xuất kho", icon: "PackageMinus", href: "/warehouse/export" },
      { key: "warehouse-transfer", label: "Điều chuyển vị trí", icon: "MapPin", href: "/warehouse/transfers" },
      { key: "warehouse-discrepancies", label: "Theo dõi nợ NCC", icon: "ClipboardCheck", href: "/warehouse/discrepancies" },
    ],
  },
  {
    key: "admin",
    label: "Admin",
    icon: "ShieldCheck",
    href: "/admin",
    children: [
      { key: "admin-delivery-requests", label: "Yêu cầu xuất hàng", icon: "ClipboardList", href: "/admin/delivery-requests" },
      { key: "admin-daily-settlements", label: "Quyết toán ngày", icon: "ClipboardCheck", href: "/admin/daily-settlements" },
    ],
  },
  { key: "promotions", label: "Khuyến mãi", icon: "Gift", href: "/promotions" },
  { key: "market", label: "Thị trường", icon: "Map", href: "/market" },
  { key: "employees", label: "Nhân viên", icon: "UserCheck", href: "/employees" },
  {
    key: "debt",
    label: "Công nợ",
    icon: "CreditCard",
    href: "/debt/employees",
    children: [
      { key: "debt-employees", label: "Công nợ nhân viên", icon: "UserCheck", href: "/debt/employees" },
      { key: "debt-stores", label: "Công nợ cửa hàng", icon: "Store", href: "/debt/stores" },
      { key: "debt-bank-receipts", label: "Thu chuyển khoản & Phân bổ", icon: "Receipt", href: "/debt/bank-receipts" },
      { key: "debt-transfers", label: "Chuyển công nợ", icon: "ArrowRightLeft", href: "/debt/transfers" },
      // Ẩn khỏi menu (trang /debt cũ vẫn truy cập được qua URL): công nợ nay theo Cửa hàng.
      // { key: "debt-customers", label: "Công nợ khách hàng", icon: "CreditCard", href: "/debt" },
    ],
  },
  { key: "kpi", label: "KPI", icon: "Target", href: "/kpi" },
  { key: "reports", label: "Báo cáo", icon: "BarChart2", href: "/reports" },
  { key: "system", label: "Hệ thống", icon: "Settings", href: "/system" },
];

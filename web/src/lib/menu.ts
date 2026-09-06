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
      { key: "customers-list", label: "Danh sách", icon: "List", href: "/customers" },
      { key: "customers-routes", label: "Tuyến bán hàng", icon: "MapPin", href: "/customers/routes" },
    ],
  },
  {
    key: "sales",
    label: "Bán hàng",
    icon: "ShoppingCart",
    href: "/sales",
    children: [
      { key: "sales-orders", label: "Đơn hàng", icon: "FileText", href: "/sales/orders" },
      { key: "sales-invoices", label: "Phiếu bán", icon: "Receipt", href: "/sales/invoices" },
      { key: "sales-returns", label: "Trả hàng", icon: "RotateCcw", href: "/sales/returns" },
    ],
  },
  {
    key: "warehouse",
    label: "Kho",
    icon: "Warehouse",
    href: "/warehouse",
    children: [
      { key: "warehouse-inventory", label: "Tồn kho", icon: "BoxesIcon", href: "/warehouse/inventory" },
      { key: "warehouse-in", label: "Nhập kho", icon: "PackagePlus", href: "/warehouse/import" },
      { key: "warehouse-out", label: "Xuất kho", icon: "PackageMinus", href: "/warehouse/export" },
    ],
  },
  { key: "promotions", label: "Khuyến mãi", icon: "Gift", href: "/promotions" },
  { key: "market", label: "Thị trường", icon: "Map", href: "/market" },
  { key: "employees", label: "Nhân viên", icon: "UserCheck", href: "/employees" },
  { key: "debt", label: "Công nợ", icon: "CreditCard", href: "/debt" },
  { key: "kpi", label: "KPI", icon: "Target", href: "/kpi" },
  { key: "reports", label: "Báo cáo", icon: "BarChart2", href: "/reports" },
  { key: "system", label: "Hệ thống", icon: "Settings", href: "/system" },
];

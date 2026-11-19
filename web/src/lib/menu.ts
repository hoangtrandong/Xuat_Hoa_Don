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
    label: "Sản phẩm",
    icon: "Package",
    href: "/products",
    children: [
      { key: "products-list", label: "Danh sách SKU", icon: "List", href: "/products" },
      { key: "products-company-management", label: "Quản lý mã NPP nội bộ", icon: "Building2", href: "/products/company-management" },
      { key: "products-suppliers", label: "Từ điển Nhà cung cấp", icon: "Boxes", href: "/products/suppliers" },
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
    label: "Đơn Hàng DMS",
    icon: "ShoppingCart",
    href: "/sales/orders",
    children: [
      { key: "sales-orders", label: "Đơn hàng DMS", icon: "FileText", href: "/sales/orders" },
      { key: "sales-invoices", label: "Xuất Hóa Đơn ĐT", icon: "Receipt", href: "/sales/invoices" },
      { key: "sales-purchase-invoices", label: "Hóa Đơn Mua Vào (CQT)", icon: "PackagePlus", href: "/sales/purchase-invoices" },
      { key: "sales-supplier-configs", label: "Đa NPP & Nguồn NCC", icon: "Settings", href: "/sales/supplier-configs" },
      { key: "sales-summary", label: "Tổng hợp đơn hàng", icon: "BarChart2", href: "/sales/summary" },
      { key: "sales-returns", label: "Trả hàng", icon: "RotateCcw", href: "/sales/returns" },
    ],
  },
];

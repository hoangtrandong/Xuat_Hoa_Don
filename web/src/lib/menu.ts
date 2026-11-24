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
    key: "tax-einvoice",
    label: "Hóa đơn & Thuế",
    icon: "ShieldCheck",
    href: "/sales/daily-cockpit",
    children: [
      { key: "daily-cockpit", label: "Trạm Xuất HĐ Hàng Ngày", icon: "ClipboardCheck", href: "/sales/daily-cockpit" },
      { key: "sales-invoices", label: "Xuất Hóa Đơn ĐT", icon: "Receipt", href: "/sales/invoices" },
      { key: "sales-purchase-invoices", label: "Hóa Đơn Mua Vào (CQT)", icon: "PackagePlus", href: "/sales/purchase-invoices" },
    ],
  },
  {
    key: "sales",
    label: "Đơn Hàng DMS",
    icon: "ShoppingCart",
    href: "/sales/orders",
    children: [
      { key: "sales-orders", label: "Đơn hàng DMS", icon: "FileText", href: "/sales/orders" },
      { key: "sales-summary", label: "Tổng hợp đơn hàng", icon: "BarChart2", href: "/sales/summary" },
      { key: "sales-returns", label: "Trả hàng", icon: "RotateCcw", href: "/sales/returns" },
    ],
  },
  {
    key: "products",
    label: "Sản phẩm",
    icon: "Package",
    href: "/products",
    children: [
      { key: "products-invoice", label: "Sản phẩm XHĐ", icon: "FileCheck2", href: "/products/invoice-products" },
      { key: "products-list", label: "Sản phẩm CQT", icon: "List", href: "/products" },
      { key: "products-company-management", label: "Sản phẩm DMS", icon: "Building2", href: "/products/company-management" },
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
    key: "system-config",
    label: "Đa NPP & Nguồn NCC",
    icon: "Settings",
    href: "/sales/supplier-configs",
  },
];

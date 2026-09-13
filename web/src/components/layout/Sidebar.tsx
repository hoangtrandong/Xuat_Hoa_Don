"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard, Package, Users, ShoppingCart, Warehouse, Gift, Map,
  UserCheck, CreditCard, Target, BarChart2, Settings, List, FolderOpen,
  Tag, MapPin, FileText, Receipt, RotateCcw, Boxes, PackagePlus,
  PackageMinus, ClipboardList, ShieldCheck, ChevronDown, ChevronRight, X, Menu as MenuIcon,
  Store, Building2,
} from "lucide-react";
import { menuItems, MenuItem } from "@/lib/menu";
import { cn } from "@/lib/utils";

const iconMap: Record<string, React.ElementType> = {
  LayoutDashboard, Package, Users, ShoppingCart, Warehouse, Gift, Map,
  UserCheck, CreditCard, Target, BarChart2, Settings, List, FolderOpen,
  Tag, MapPin, FileText, Receipt, RotateCcw, BoxesIcon: Boxes, PackagePlus,
  PackageMinus, ClipboardList, ShieldCheck, Store, Building2,
};

function NavIcon({ name }: { name: string }) {
  const Icon = iconMap[name] || LayoutDashboard;
  return <Icon size={18} />;
}

function NavItem({
  item,
  collapsed,
}: {
  item: MenuItem;
  collapsed: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const hasChildren = item.children && item.children.length > 0;
  const isActive =
    pathname === item.href ||
    (hasChildren && item.children!.some((c) => pathname.startsWith(c.href)));

  if (hasChildren) {
    return (
      <div>
        <button
          onClick={() => setOpen(!open)}
          className={cn(
            "flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
            isActive
              ? "bg-sky-50 text-sky-600"
              : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
          )}
        >
          <span className="flex-shrink-0">
            <NavIcon name={item.icon} />
          </span>
          {!collapsed && (
            <>
              <span className="flex-1 text-left">{item.label}</span>
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </>
          )}
        </button>
        {!collapsed && open && (
          <div className="ml-7 mt-1 space-y-1">
            {item.children!.map((child) => (
              <Link
                key={child.key}
                href={child.href}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
                  pathname === child.href
                    ? "bg-sky-50 text-sky-600 font-medium"
                    : "text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                )}
              >
                <NavIcon name={child.icon} />
                {child.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
        isActive
          ? "bg-sky-500 text-white shadow-sm"
          : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
      )}
    >
      <span className="flex-shrink-0">
        <NavIcon name={item.icon} />
      </span>
      {!collapsed && <span>{item.label}</span>}
    </Link>
  );
}

interface SidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export default function Sidebar({ mobileOpen, onMobileClose }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  const sidebarContent = (
    <div
      className={cn(
        "flex flex-col h-full bg-white border-r border-gray-200 transition-all duration-300",
        collapsed ? "w-16" : "w-60"
      )}
    >
      {/* Logo */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 h-16 flex-shrink-0">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-sky-500 flex items-center justify-center">
              <span className="text-white font-bold text-sm">D</span>
            </div>
            <span className="font-bold text-gray-800 text-lg">DMS</span>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hidden lg:block"
        >
          <MenuIcon size={18} />
        </button>
        {/* Mobile close */}
        <button
          onClick={onMobileClose}
          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 lg:hidden"
        >
          <X size={18} />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-1">
        {menuItems.map((item) => (
          <NavItem key={item.key} item={item} collapsed={collapsed} />
        ))}
      </nav>

      {/* Footer */}
      {!collapsed && (
        <div className="p-4 border-t border-gray-200">
          <p className="text-xs text-gray-400 text-center">DMS v1.0.0</p>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop */}
      <aside className="hidden lg:block flex-shrink-0 h-screen sticky top-0">
        {sidebarContent}
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="fixed inset-0 bg-black/40"
            onClick={onMobileClose}
          />
          <aside className="fixed left-0 top-0 h-full z-50">
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
}

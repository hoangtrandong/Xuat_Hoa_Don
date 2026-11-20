"use client";

import { Bell, Search, Menu as MenuIcon, LogOut, Building2, ShieldCheck } from "lucide-react";
import { useDistributorContext } from "@/lib/distributor-context";

interface HeaderProps {
  onMobileMenuOpen: () => void;
  onLogout: () => void;
  username: string;
  fullName?: string;
  distributorCode?: string;
  distributorName?: string;
  distributorTaxCode?: string;
  isSuperAdmin?: boolean;
}

export default function Header({
  onMobileMenuOpen,
  onLogout,
  username,
  fullName,
  distributorCode,
  distributorName,
  distributorTaxCode,
  isSuperAdmin,
}: HeaderProps) {
  const {
    distributors,
    effectiveDistributorId,
    setSelectedDistributorId,
  } = useDistributorContext();

  return (
    <header className="sticky top-0 z-30 h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 lg:px-6 gap-3">
      {/* Left: Mobile menu + Active NPP Badge / Switcher + Search */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onMobileMenuOpen}
          className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 lg:hidden shrink-0"
        >
          <MenuIcon size={20} />
        </button>

        {distributorCode ? (
          <div className="flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 min-w-0">
            <Building2 size={15} className="text-sky-600 shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-bold text-sky-900 truncate">
                <span className="rounded bg-sky-600 px-1.5 py-0.5 text-[10px] text-white font-mono">
                  {distributorCode}
                </span>
                <span className="truncate">{distributorName}</span>
              </div>
              {distributorTaxCode && (
                <p className="text-[10px] text-sky-700 font-mono leading-tight">
                  MST: {distributorTaxCode}
                </p>
              )}
            </div>
          </div>
        ) : isSuperAdmin ? (
          <div className="flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50/80 px-2.5 py-1.5 min-w-0">
            <ShieldCheck size={15} className="text-indigo-600 shrink-0" />
            <span className="hidden md:inline text-[11px] font-bold text-indigo-800 whitespace-nowrap">
              Phạm vi NPP:
            </span>
            <select
              aria-label="Chọn Nhà phân phối làm việc"
              value={effectiveDistributorId === null ? "ALL" : String(effectiveDistributorId)}
              onChange={(e) => {
                const v = e.target.value;
                setSelectedDistributorId(v === "ALL" ? null : Number(v));
              }}
              className="max-w-[260px] rounded border border-indigo-300 bg-white px-2 py-1 text-xs font-semibold text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
              <option value="ALL">Tất cả Nhà phân phối ({distributors.length})</option>
              {distributors.map((d) => (
                <option key={d.id} value={String(d.id)}>
                  [{d.code}] {d.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="relative hidden xl:block">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            type="text"
            placeholder="Tìm kiếm..."
            className="pl-9 pr-4 py-1.5 text-xs bg-gray-100 rounded-lg w-52 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:bg-white transition-colors"
          />
        </div>
      </div>

      {/* Right: Notifications + User */}
      <div className="flex items-center gap-2 shrink-0">
        <button className="relative p-2 rounded-lg hover:bg-gray-100 text-gray-500">
          <Bell size={19} />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />
        </button>

        <div className="flex items-center gap-2 pl-2 border-l border-gray-200">
          <div className="w-8 h-8 rounded-full bg-[#14263d] flex items-center justify-center shrink-0">
            <span className="text-white text-xs font-bold">
              {(username || "U").slice(0, 2).toUpperCase()}
            </span>
          </div>
          <div className="hidden sm:block text-left">
            <p className="text-xs font-bold text-gray-800 leading-none">
              {fullName || username}
            </p>
            <p className="text-[11px] text-gray-500 mt-0.5 font-mono">
              @{username}
            </p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="ml-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 transition-colors hover:bg-red-100 flex items-center gap-1"
            aria-label="Đăng xuất"
            title="Đăng xuất khỏi phiên NPP hiện tại"
          >
            <LogOut size={14} />
            <span className="hidden md:inline">Đăng xuất</span>
          </button>
        </div>
      </div>
    </header>
  );
}

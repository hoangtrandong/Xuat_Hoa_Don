"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bell,
  Search,
  Menu as MenuIcon,
  LogOut,
  Building2,
  ShieldCheck,
  Moon,
  Sun,
  ChevronDown,
  User,
  KeyRound,
  Shield,
  History,
  Palette,
} from "lucide-react";
import { useDistributorContext } from "@/lib/distributor-context";
import { useTheme } from "@/lib/theme";
import AccountSettingsModal, {
  type AccountSettingsTab,
} from "@/components/layout/AccountSettingsModal";

interface HeaderProps {
  onMobileMenuOpen: () => void;
  onLogout: () => void;
  username: string;
  fullName?: string;
  distributorCode?: string;
  distributorName?: string;
  distributorTaxCode?: string;
  isSuperAdmin?: boolean;
  mustChangePassword?: boolean;
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
  mustChangePassword = false,
}: HeaderProps) {
  const {
    distributors,
    effectiveDistributorId,
    setSelectedDistributorId,
  } = useDistributorContext();
  const { resolvedTheme, toggleTheme } = useTheme();

  const [menuOpen, setMenuOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<AccountSettingsTab>("profile");
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Đóng dropdown khi click ra ngoài hoặc nhấn Escape
  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  function openAccountModal(tab: AccountSettingsTab) {
    setMenuOpen(false);
    setModalTab(tab);
    setModalOpen(true);
  }

  const effectiveModalOpen = modalOpen || mustChangePassword;

  return (
    <>
      <header className="sticky top-0 z-30 h-16 bg-white dark:bg-[#101725] border-b border-gray-200 dark:border-[#2a3547] flex items-center justify-between px-4 lg:px-6 gap-3">
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

        {/* Right: Theme + Notifications + User Avatar Dropdown + Quick Logout */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={toggleTheme}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
            aria-label={resolvedTheme === "dark" ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"}
            title={resolvedTheme === "dark" ? "Giao diện sáng" : "Giao diện tối"}
          >
            {resolvedTheme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
          </button>
          <button className="relative p-2 rounded-lg hover:bg-gray-100 text-gray-500">
            <Bell size={19} />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />
          </button>

          <div className="flex items-center gap-2 pl-2 border-l border-gray-200">
            {/* Avatar & Account Menu Trigger */}
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((prev) => !prev)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                title="Cấu hình tài khoản"
                className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-gray-100 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                <div className="w-8 h-8 rounded-full bg-[#14263d] flex items-center justify-center shrink-0 ring-2 ring-transparent hover:ring-sky-500/40">
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
                <ChevronDown
                  size={14}
                  className={`text-gray-400 transition-transform ${menuOpen ? "rotate-180" : ""}`}
                />
              </button>

              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 mt-1.5 w-64 rounded border border-slate-300 bg-white shadow-lg z-40 overflow-hidden"
                >
                  {/* Tóm tắt tài khoản */}
                  <div className="bg-[#14263d] px-3 py-2.5 text-white">
                    <p className="text-xs font-bold truncate">{fullName || username}</p>
                    <p className="text-[11px] text-slate-300 font-mono truncate">@{username}</p>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      {distributorCode ? (
                        <span className="rounded bg-sky-600/90 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-white">
                          {distributorCode}
                        </span>
                      ) : isSuperAdmin ? (
                        <span className="rounded bg-indigo-600/90 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                          Super Admin
                        </span>
                      ) : null}
                      {distributorTaxCode && (
                        <span className="text-[10px] text-slate-300 font-mono">
                          MST: {distributorTaxCode}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Danh sách tính năng cấu hình tài khoản */}
                  <div className="py-1">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => openAccountModal("profile")}
                      className="w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-sky-50 hover:text-sky-800 flex items-center gap-2 transition-colors"
                    >
                      <User size={14} className="text-slate-500 shrink-0" />
                      <span>Thông tin tài khoản</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => openAccountModal("security")}
                      className="w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-sky-50 hover:text-sky-800 flex items-center gap-2 transition-colors"
                    >
                      <KeyRound size={14} className="text-slate-500 shrink-0" />
                      <span>Đổi mật khẩu đăng nhập</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => openAccountModal("permissions")}
                      className="w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-sky-50 hover:text-sky-800 flex items-center gap-2 transition-colors"
                    >
                      <Shield size={14} className="text-slate-500 shrink-0" />
                      <span>Phân quyền & Phạm vi NPP</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => openAccountModal("activity")}
                      className="w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-sky-50 hover:text-sky-800 flex items-center gap-2 transition-colors"
                    >
                      <History size={14} className="text-slate-500 shrink-0" />
                      <span>Lịch sử đăng nhập & Hoạt động</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => openAccountModal("preferences")}
                      className="w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-sky-50 hover:text-sky-800 flex items-center gap-2 transition-colors"
                    >
                      <Palette size={14} className="text-slate-500 shrink-0" />
                      <span>Tùy chọn giao diện</span>
                    </button>
                  </div>

                  <div className="border-t border-slate-200 py-1">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        onLogout();
                      }}
                      className="w-full px-3 py-1.5 text-left text-xs font-semibold text-red-700 hover:bg-red-50 flex items-center gap-2 transition-colors"
                    >
                      <LogOut size={14} className="shrink-0" />
                      <span>Đăng xuất</span>
                    </button>
                  </div>
                </div>
              )}
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

      {effectiveModalOpen && (
        <AccountSettingsModal
          key={`${modalTab}-${mustChangePassword ? "forced" : "normal"}`}
          open={effectiveModalOpen}
          initialTab={modalTab}
          forcedPasswordChange={mustChangePassword}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}

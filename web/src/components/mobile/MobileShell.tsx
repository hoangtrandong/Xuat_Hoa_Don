"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import {
  ClipboardList,
  ShoppingCart,
  Truck,
  UserCircle2,
  Users,
  Wifi,
  WifiOff,
  Moon,
  Sun,
} from "lucide-react";
import { useAuthSession } from "@/lib/auth-session";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/m", label: "Bấm đơn", icon: ShoppingCart, matchExact: true },
  { href: "/m/deliveries", label: "Giao hàng", icon: Truck, matchExact: false },
  { href: "/m/customers", label: "Khách hàng", icon: Users, matchExact: false },
  { href: "/m/orders", label: "Đơn của tôi", icon: ClipboardList, matchExact: false },
  { href: "/m/account", label: "Tài khoản", icon: UserCircle2, matchExact: false },
] as const;

function subscribeOnlineStatus(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getOnlineSnapshot() {
  return typeof navigator !== "undefined" ? navigator.onLine : true;
}

export default function MobileShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const session = useAuthSession();
  const { resolvedTheme, toggleTheme } = useTheme();
  const online = useSyncExternalStore(
    subscribeOnlineStatus,
    getOnlineSnapshot,
    () => true,
  );

  return (
    <div className="flex min-h-[100dvh] flex-col bg-slate-100 text-slate-900 dark:bg-[#0b1020] dark:text-slate-100">
      {/* Compact Enterprise Mobile Header (#14263d) */}
      <header className="sticky top-0 z-30 bg-[#14263d] text-white shadow-sm pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-13 max-w-2xl items-center justify-between gap-2 px-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/20 ring-1 ring-sky-400/40">
              <ShoppingCart size={16} className="text-red-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-xs font-bold uppercase tracking-wide text-white">
                  {session.fullName || session.username || "NVBH"}
                </span>
                {session.distributorCode && (
                  <span className="shrink-0 rounded bg-sky-500/25 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-sky-200">
                    {session.distributorCode}
                  </span>
                )}
              </div>
              <p className="truncate text-[10px] text-slate-300">
                {session.distributorName || "DMS Mobile Sales"}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                online
                  ? "bg-emerald-500/20 text-emerald-200"
                  : "bg-red-500/30 text-red-100",
              )}
              title={online ? "Đang kết nối máy chủ" : "Mất kết nối mạng"}
            >
              {online ? <Wifi size={11} /> : <WifiOff size={11} />}
              {online ? "Online" : "Offline"}
            </span>
            <button
              type="button"
              onClick={toggleTheme}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-200 hover:bg-white/10 active:scale-95"
              aria-label="Đổi giao diện sáng tối"
            >
              {resolvedTheme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </div>
      </header>

      {/* Offline banner */}
      {!online && (
        <div className="bg-amber-600 px-3 py-1.5 text-center text-[11px] font-medium text-white">
          Đang mất kết nối mạng — giỏ hàng của bạn vẫn được tự động lưu nháp trên máy.
        </div>
      )}

      {/* Main Content Area (padded for fixed bottom nav) */}
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
        {children}
      </main>

      {/* Fixed Bottom Tab Navigation (Thumb-friendly >= 48px tap targets) */}
      <nav
        aria-label="Điều hướng chính"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur-md dark:border-[#2a3547] dark:bg-[#101725]/95 pb-[env(safe-area-inset-bottom)]"
      >
        <div className="mx-auto grid max-w-2xl grid-cols-5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = item.matchExact
              ? pathname === item.href
              : pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] font-semibold transition-colors active:scale-95",
                  active
                    ? "text-sky-600 dark:text-sky-400"
                    : "text-slate-500 hover:text-slate-800 dark:text-slate-400",
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                    active ? "bg-sky-100 dark:bg-sky-500/20" : "",
                  )}
                >
                  <Icon size={19} strokeWidth={active ? 2.4 : 1.9} />
                </span>
                <span className="truncate leading-tight">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

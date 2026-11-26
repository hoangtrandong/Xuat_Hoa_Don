"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Building2,
  Download,
  LogOut,
  Monitor,
  Moon,
  Share,
  Smartphone,
  Sun,
  UserCircle2,
} from "lucide-react";
import { clearAuthSession, useAuthSession } from "@/lib/auth-session";
import { useTheme } from "@/lib/theme";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function MobileAccountPage() {
  const session = useAuthSession();
  const { resolvedTheme, toggleTheme } = useTheme();
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  async function handleInstallPwa() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setInstalled(true);
      setInstallPrompt(null);
    }
  }

  return (
    <div className="space-y-3 p-3">
      {/* Profile Card */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-[#2a3547] dark:bg-[#151d2b]">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#14263d] text-white">
            <UserCircle2 size={26} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-bold text-slate-900 dark:text-white">
              {session.fullName || session.username}
            </h2>
            <p className="font-mono text-xs text-slate-500">
              Tài khoản: {session.username}
            </p>
          </div>
        </div>

        {session.distributorCode && (
          <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50/70 p-3 text-xs">
            <div className="flex items-center gap-1.5 font-bold text-sky-900">
              <Building2 size={14} className="text-sky-600" />
              <span>{session.distributorName || session.distributorCode}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-[11px] text-sky-700">
              <span>Mã NPP: {session.distributorCode}</span>
              {session.distributorTaxCode && (
                <span>MST: {session.distributorTaxCode}</span>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Install PWA Card */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-[#2a3547] dark:bg-[#151d2b]">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
          <Smartphone size={17} className="text-sky-600" />
          Cài đặt ra Màn hình chính (như App)
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Cài biểu tượng DMS Sales lên màn hình điện thoại để mở toàn màn hình và bấm đơn nhanh hơn.
        </p>

        {installPrompt && !installed ? (
          <button
            type="button"
            onClick={() => void handleInstallPwa()}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 py-3 text-xs font-bold text-white shadow-xs active:scale-[0.99]"
          >
            <Download size={15} /> Cài đặt ứng dụng DMS Sales ngay
          </button>
        ) : (
          <div className="mt-3 space-y-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
            <div className="flex items-start gap-2">
              <Share size={14} className="mt-0.5 shrink-0 text-sky-600" />
              <span>
                <strong>iPhone (Safari):</strong> Bấm nút <em>Chia sẻ</em> ở thanh dưới → chọn <strong>Thêm vào MH chính</strong>.
              </span>
            </div>
            <div className="flex items-start gap-2">
              <Download size={14} className="mt-0.5 shrink-0 text-emerald-600" />
              <span>
                <strong>Android (Chrome):</strong> Bấm dấu <em>3 chấm ⋮</em> góc trên phải → chọn <strong>Cài đặt ứng dụng</strong>.
              </span>
            </div>
          </div>
        )}
      </section>

      {/* Quick Settings */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs dark:border-[#2a3547] dark:bg-[#151d2b]">
        <button
          type="button"
          onClick={toggleTheme}
          className="flex w-full items-center justify-between border-b border-slate-100 px-4 py-3.5 text-left text-sm font-semibold text-slate-800 active:bg-slate-50"
        >
          <span className="flex items-center gap-2.5">
            {resolvedTheme === "dark" ? (
              <Sun size={18} className="text-amber-500" />
            ) : (
              <Moon size={18} className="text-indigo-600" />
            )}
            Giao diện: {resolvedTheme === "dark" ? "Chế độ Tối" : "Chế độ Sáng"}
          </span>
          <span className="text-xs font-semibold text-sky-600">Đổi</span>
        </button>

        <Link
          href="/sales/orders"
          className="flex w-full items-center justify-between border-b border-slate-100 px-4 py-3.5 text-sm font-semibold text-slate-800 active:bg-slate-50"
        >
          <span className="flex items-center gap-2.5">
            <Monitor size={18} className="text-sky-600" />
            Chuyển sang bản Máy tính (Desktop)
          </span>
          <span className="text-xs text-slate-400">→</span>
        </Link>

        <button
          type="button"
          onClick={() => clearAuthSession()}
          className="flex w-full items-center gap-2.5 px-4 py-3.5 text-sm font-bold text-red-600 active:bg-red-50"
        >
          <LogOut size={18} />
          Đăng xuất tài khoản
        </button>
      </section>
    </div>
  );
}

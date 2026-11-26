"use client";

import { FormEvent, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { CheckCircle2, Loader2, LockKeyhole, Moon, Smartphone, Sun } from "lucide-react";
import Sidebar from "@/components/layout/Sidebar";
import Header from "@/components/layout/Header";
import GlobalTaskProgressBar from "@/components/layout/GlobalTaskProgressBar";
import { DistributorProvider } from "@/lib/distributor-context";
import { useTheme } from "@/lib/theme";
import { API_URL, apiFetch } from "@/lib/api";
import {
  AUTH_EXPIRED_EVENT,
  clearAuthSession,
  saveAuthSession,
  useAuthSession,
} from "@/lib/auth-session";

const inputCls =
  "w-full min-w-0 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-100";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isMobileAppRoute = pathname === "/m" || pathname?.startsWith("/m/");
  const session = useAuthSession();
  const { resolvedTheme, toggleTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [companyCode, setCompanyCode] = useState("");
  const [loginUsername, setLoginUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberLogin, setRememberLogin] = useState(true);
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    const handleAuthExpired = () => {
      setSessionExpired(true);
      setLoginError("");
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
  }, []);

  // Đồng bộ thông tin NPP của phiên đang đăng nhập từ /auth/me (nếu F5 hoặc phiên cũ chưa có metadata)
  useEffect(() => {
    if (!session.ready || !session.token) return;
    apiFetch(`${API_URL}/auth/me`)
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => {
        if (!me) return;
        const effDistId = me.distributor_id ?? session.distributorId;
        const effDistCode = me.distributor_code || session.distributorCode;
        const effDistName = me.distributor_name || session.distributorName;
        const effDistTax = me.distributor_tax_code || session.distributorTaxCode;
        if (
          me.full_name !== session.fullName ||
          effDistId !== session.distributorId ||
          effDistCode !== session.distributorCode ||
          Boolean(me.is_super_admin) !== session.isSuperAdmin ||
          Boolean(me.must_change_password) !== session.mustChangePassword
        ) {
          saveAuthSession(session.token!, me.username || session.username, {
            fullName: me.full_name || "",
            distributorId: effDistId ?? null,
            distributorCode: effDistCode || "",
            distributorName: effDistName || "",
            distributorTaxCode: effDistTax || "",
            isSuperAdmin: Boolean(me.is_super_admin),
            mustChangePassword: Boolean(me.must_change_password),
          });
        }
      })
      .catch(() => {});
  }, [
    session.ready,
    session.token,
    session.username,
    session.fullName,
    session.distributorId,
    session.distributorCode,
    session.distributorName,
    session.distributorTaxCode,
    session.isSuperAdmin,
    session.mustChangePassword,
  ]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError("");
    setIsLoggingIn(true);

    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_code: companyCode.trim(),
          username: loginUsername.trim(),
          password,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setLoginError(
          data.detail ||
            (response.status === 401
              ? "Mã DN, Mã NV hoặc mật khẩu không chính xác."
              : "Không thể đăng nhập. Vui lòng thử lại sau."),
        );
        return;
      }

      saveAuthSession(data.access_token, data.username || loginUsername.trim(), {
        fullName: data.full_name || "",
        distributorId: data.distributor_id ?? null,
        distributorCode: data.distributor_code || "",
        distributorName: data.distributor_name || "",
        distributorTaxCode: data.distributor_tax_code || "",
        isSuperAdmin: Boolean(data.is_super_admin),
        mustChangePassword: Boolean(data.must_change_password),
        persist: isMobileAppRoute ? rememberLogin : false,
      });
      setPassword("");
      setSessionExpired(false);
    } catch {
      setLoginError("Không thể kết nối máy chủ. Vui lòng kiểm tra kết nối và thử lại.");
    } finally {
      setIsLoggingIn(false);
    }
  }

  function handleLogout() {
    clearAuthSession();
    setLoginUsername("");
    setPassword("");
    setLoginError("");
  }

  if (!session.ready) {
    return <div className="min-h-screen bg-slate-100" aria-busy="true" />;
  }

  if (!session.token) {
    if (isMobileAppRoute) {
      return (
        <main className="flex min-h-[100dvh] flex-col bg-slate-100 dark:bg-[#0b1020]">
          {/* Header thương hiệu DMS Mobile */}
          <div className="bg-[#14263d] px-5 pb-8 pt-[max(2rem,env(safe-area-inset-top))] text-white">
            <div className="mx-auto flex max-w-md items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/20 ring-1 ring-sky-400/40">
                  <Smartphone size={20} className="text-red-400" />
                </div>
                <div>
                  <div className="text-sm font-bold uppercase tracking-wide">DMS Sales Mobile</div>
                  <div className="text-[11px] text-slate-300">Ứng dụng bấm đơn nhân viên bán hàng</div>
                </div>
              </div>
              <button
                type="button"
                onClick={toggleTheme}
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-slate-200 active:scale-95"
                aria-label="Đổi giao diện sáng tối"
              >
                {resolvedTheme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
              </button>
            </div>
          </div>

          <div className="mx-auto -mt-5 w-full max-w-md flex-1 px-4 pb-8">
            <section className="overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-lg dark:border-[#2a3547] dark:bg-[#151d2b]">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-[#2a3547] dark:bg-[#1a2434]">
                <h1 className="text-sm font-bold text-slate-800 dark:text-white">
                  Đăng nhập tài khoản NVBH
                </h1>
                <p className="mt-0.5 text-xs text-slate-500">
                  Nhập Mã DN, Mã NV và mật khẩu để bắt đầu bấm đơn
                </p>
              </div>

              <form onSubmit={handleLogin} className="space-y-3.5 p-4">
                {sessionExpired && (
                  <div
                    role="status"
                    className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800"
                  >
                    Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.
                  </div>
                )}

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Mã DN / Nhà phân phối <span className="text-red-600">*</span>
                  </label>
                  <input
                    required
                    autoCapitalize="characters"
                    placeholder="VD: NPP-DONGDO"
                    value={companyCode}
                    onChange={(event) => setCompanyCode(event.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-base text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Mã nhân viên / Tài khoản <span className="text-red-600">*</span>
                  </label>
                  <input
                    autoComplete="username"
                    required
                    placeholder="Nhập mã NV hoặc tên đăng nhập"
                    value={loginUsername}
                    onChange={(event) => setLoginUsername(event.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-base text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Mật khẩu <span className="text-red-600">*</span>
                  </label>
                  <input
                    autoComplete="current-password"
                    required
                    type="password"
                    placeholder="Nhập mật khẩu"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-base text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
                  />
                </div>

                <label className="flex items-center gap-2.5 py-1 text-xs font-medium text-slate-600 select-none">
                  <input
                    type="checkbox"
                    checked={rememberLogin}
                    onChange={(e) => setRememberLogin(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                  />
                  Ghi nhớ đăng nhập trên điện thoại này
                </label>

                {loginError && (
                  <div
                    role="alert"
                    className="rounded-xl border border-red-300 bg-red-50 px-3 py-2.5 text-xs font-medium text-red-700"
                  >
                    {loginError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoggingIn}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3.5 text-sm font-bold text-white shadow-sm transition active:scale-[0.99] hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {isLoggingIn ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
                  {isLoggingIn ? "Đang xác thực..." : "Đăng nhập bấm đơn"}
                </button>
              </form>
            </section>
          </div>
        </main>
      );
    }

    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-200/80 px-4 py-10">
        {/* Khung Đăng nhập tuân thủ chuẩn CreateOrderForm (GEMINI.md) */}
        <section className="w-full max-w-md border border-slate-400 bg-white shadow-lg">
          {/* 1.1 Header Modal / Form */}
          <div className="bg-[#14263d] px-3.5 py-2.5 text-white flex items-center justify-between">
            <div className="flex items-center gap-2">
              <LockKeyhole size={17} className="text-red-500" />
              <span className="text-xs font-bold uppercase tracking-wide text-white">
                Đăng Nhập Hệ Thống
              </span>
            </div>
            <button
              type="button"
              onClick={toggleTheme}
              className="rounded p-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
              aria-label={resolvedTheme === "dark" ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"}
              title={resolvedTheme === "dark" ? "Giao diện sáng" : "Giao diện tối"}
            >
              {resolvedTheme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>

          <form onSubmit={handleLogin}>
            <div className="px-3.5 py-3.5 space-y-2.5">
              {sessionExpired && (
                <div
                  role="status"
                  className="rounded border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800"
                >
                  Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.
                </div>
              )}

              <div>
                <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                  Mã DN <span className="text-red-600">(*)</span>
                </label>
                <input
                  required
                  placeholder="Nhập mã doanh nghiệp / mã NPP (VD: NPP-DONGDO)..."
                  value={companyCode}
                  onChange={(event) => setCompanyCode(event.target.value)}
                  className={inputCls}
                />
              </div>

              <div>
                <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                  Mã NV <span className="text-red-600">(*)</span>
                </label>
                <input
                  autoComplete="username"
                  required
                  placeholder="Nhập mã nhân viên / tài khoản..."
                  value={loginUsername}
                  onChange={(event) => setLoginUsername(event.target.value)}
                  className={inputCls}
                />
              </div>

              <div>
                <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                  Mật khẩu <span className="text-red-600">(*)</span>
                </label>
                <input
                  autoComplete="current-password"
                  required
                  type="password"
                  placeholder="Nhập mật khẩu..."
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className={inputCls}
                />
              </div>

              {loginError && (
                <div
                  role="alert"
                  className="rounded border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700"
                >
                  {loginError}
                </div>
              )}
            </div>

            {/* 1.4 Footer Action Bar */}
            <div className="border-t border-slate-300 bg-slate-100 px-3.5 py-2 flex items-center justify-between gap-3">
              <span className="text-[10px] text-slate-500">
                Nhập Mã DN, Mã NV và Mật khẩu để tiếp tục.
              </span>
              <button
                type="submit"
                disabled={isLoggingIn}
                className="inline-flex items-center gap-1.5 rounded bg-sky-600 hover:bg-sky-700 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {isLoggingIn ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <CheckCircle2 size={13} />
                )}
                {isLoggingIn ? "Đang xác thực..." : "Đăng nhập"}
              </button>
            </div>
          </form>
        </section>
      </main>
    );
  }

  if (isMobileAppRoute) {
    return <DistributorProvider>{children}</DistributorProvider>;
  }

  return (
    <DistributorProvider>
      <div className="flex h-screen overflow-hidden bg-gray-100 dark:bg-[#0b1020]">
        <Sidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
        <div className="flex flex-col flex-1 overflow-hidden">
          <Header
            onMobileMenuOpen={() => setMobileOpen(true)}
            onLogout={handleLogout}
            username={session.username}
            fullName={session.fullName}
            distributorCode={session.distributorCode}
            distributorName={session.distributorName}
            distributorTaxCode={session.distributorTaxCode}
            isSuperAdmin={session.isSuperAdmin}
            mustChangePassword={session.mustChangePassword}
          />
          <GlobalTaskProgressBar />
          <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
        </div>
      </div>
    </DistributorProvider>
  );
}

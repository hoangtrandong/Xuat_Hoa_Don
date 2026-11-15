"use client";

import { FormEvent, useEffect, useState } from "react";
import { CheckCircle2, Loader2, LockKeyhole } from "lucide-react";
import Sidebar from "@/components/layout/Sidebar";
import Header from "@/components/layout/Header";
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
  const session = useAuthSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [companyCode, setCompanyCode] = useState("");
  const [loginUsername, setLoginUsername] = useState("");
  const [password, setPassword] = useState("");
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
          Boolean(me.is_super_admin) !== session.isSuperAdmin
        ) {
          saveAuthSession(session.token!, me.username || session.username, {
            fullName: me.full_name || "",
            distributorId: effDistId ?? null,
            distributorCode: effDistCode || "",
            distributorName: effDistName || "",
            distributorTaxCode: effDistTax || "",
            isSuperAdmin: Boolean(me.is_super_admin),
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

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100">
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
        />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}

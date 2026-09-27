"use client";

import { FormEvent, useEffect, useState } from "react";
import { LockKeyhole, LogIn } from "lucide-react";
import Sidebar from "@/components/layout/Sidebar";
import Header from "@/components/layout/Header";
import { API_URL } from "@/lib/api";
import {
  AUTH_EXPIRED_EVENT,
  clearAuthSession,
  saveAuthSession,
  useAuthSession,
} from "@/lib/auth-session";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const session = useAuthSession();
  const [mobileOpen, setMobileOpen] = useState(false);
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

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError("");
    setIsLoggingIn(true);

    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: loginUsername, password }),
      });
      if (!response.ok) {
        setLoginError(
          response.status === 401
            ? "Tên đăng nhập hoặc mật khẩu không chính xác."
            : "Không thể đăng nhập. Vui lòng thử lại sau.",
        );
        return;
      }

      const result: { access_token: string; token_type: string } = await response.json();
      saveAuthSession(result.access_token, loginUsername);
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
    return <div className="min-h-screen bg-gray-100" aria-busy="true" />;
  }

  if (!session.token) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
        <section className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
              <LockKeyhole size={23} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Đăng nhập DMS</h1>
              <p className="mt-1 text-sm text-gray-500">Hệ thống quản lý phân phối</p>
            </div>
          </div>
          {sessionExpired && (
            <p role="status" className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.
            </p>
          )}
          <form onSubmit={handleLogin} className="space-y-4">
            <label className="block text-sm font-medium text-gray-700">
              Tên đăng nhập
              <input
                autoComplete="username"
                required
                value={loginUsername}
                onChange={(event) => setLoginUsername(event.target.value)}
                className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2.5 font-normal outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              />
            </label>
            <label className="block text-sm font-medium text-gray-700">
              Mật khẩu
              <input
                autoComplete="current-password"
                required
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2.5 font-normal outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              />
            </label>
            {loginError && (
              <p role="alert" className="text-sm text-red-600">{loginError}</p>
            )}
            <button
              type="submit"
              disabled={isLoggingIn}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 font-medium text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <LogIn size={17} />
              {isLoggingIn ? "Đang đăng nhập..." : "Đăng nhập"}
            </button>
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
        />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}

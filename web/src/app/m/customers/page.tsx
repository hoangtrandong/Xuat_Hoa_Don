"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Building2,
  Loader2,
  MapPin,
  Phone,
  Search,
  ShoppingCart,
  Users,
  X,
} from "lucide-react";
import { API_URL, apiFetch } from "@/lib/api";
import { formatCustomerCode } from "@/lib/format";
import {
  CUSTOMER_TYPE_LABELS,
  type MobileCurrentUser,
  type MobileCustomer,
  fetchWithRetry,
  getCachedMasterData,
  normalizeSearchText,
} from "@/lib/mobile-sales";
import { useAuthSession } from "@/lib/auth-session";
import { cn } from "@/lib/utils";

const PAGE_STEP = 50;

export default function MobileCustomersPage() {
  const session = useAuthSession();
  const [customers, setCustomers] = useState<MobileCustomer[]>([]);
  const [ownEmployeeCode, setOwnEmployeeCode] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [query, setQuery] = useState("");
  const [routeFilter, setRouteFilter] = useState("ALL");
  const [onlyMine, setOnlyMine] = useState(true);
  const [visibleCount, setVisibleCount] = useState(PAGE_STEP);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const cacheKey = `${session.distributorCode || "default"}:${session.username || "guest"}`;
        const cached = getCachedMasterData(cacheKey);
        if (cached) {
          if (cancelled) return;
          const empCode = cached.me?.employee_code?.trim() || "";
          setOwnEmployeeCode(empCode);
          if (!empCode) setOnlyMine(false);
          setCustomers(cached.customers);
          setLoading(false);
          return;
        }

        const [custRes, meSettled] = await Promise.all([
          fetchWithRetry(() => apiFetch(`${API_URL}/customers/?limit=2000`)),
          Promise.allSettled([fetchWithRetry(() => apiFetch(`${API_URL}/auth/me`), 1)]),
        ]);
        if (!custRes.ok) {
          throw new Error(`Không thể tải danh sách khách hàng (HTTP ${custRes.status}).`);
        }
        const custRows = (await custRes.json()) as Array<Record<string, unknown>>;
        const meRes = meSettled[0].status === "fulfilled" ? meSettled[0].value : null;
        const me =
          meRes && meRes.ok ? ((await meRes.json()) as MobileCurrentUser) : null;
        if (cancelled) return;

        const empCode = me?.employee_code?.trim() || "";
        setOwnEmployeeCode(empCode);
        if (!empCode) setOnlyMine(false);

        setCustomers(
          custRows
            .filter((row) => row.status !== "inactive")
            .map((row) => ({
              id: Number(row.id),
              code: String(row.code ?? ""),
              name: String(row.name ?? ""),
              type:
                CUSTOMER_TYPE_LABELS[String(row.type ?? "")] ??
                String(row.type ?? ""),
              tier: String(row.tier ?? ""),
              status: String(row.status ?? "active"),
              staffCode: String(row.staff_code ?? ""),
              staffName: String(row.staff_name ?? ""),
              storeName: String(row.store_name ?? ""),
              salesRoute: String(row.store_route ?? ""),
              phone: String(row.phone ?? ""),
              address: String(row.address ?? ""),
            })),
        );
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? `${err.message} (API: ${API_URL})`
              : "Lỗi tải khách hàng.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [session.distributorCode, session.username]);

  const routes = useMemo(() => {
    const set = new Set<string>();
    for (const c of customers) {
      if (
        onlyMine &&
        ownEmployeeCode &&
        c.staffCode.trim().toUpperCase() !== ownEmployeeCode.toUpperCase()
      ) {
        continue;
      }
      if (c.salesRoute.trim()) set.add(c.salesRoute.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "vi"));
  }, [customers, onlyMine, ownEmployeeCode]);

  const filtered = useMemo(() => {
    const q = normalizeSearchText(query.trim());
    let list = customers;
    if (onlyMine && ownEmployeeCode) {
      const target = ownEmployeeCode.toUpperCase();
      list = list.filter((c) => c.staffCode.trim().toUpperCase() === target);
    }
    if (routeFilter !== "ALL") {
      list = list.filter((c) => c.salesRoute.trim() === routeFilter);
    }
    if (q) {
      list = list.filter((c) =>
        [c.code, c.name, c.storeName, c.salesRoute, c.phone, c.address].some(
          (v) => normalizeSearchText(v).includes(q),
        ),
      );
    }
    return list;
  }, [customers, query, routeFilter, onlyMine, ownEmployeeCode]);

  const visible = useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount],
  );

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-10 text-slate-500">
        <Loader2 size={24} className="animate-spin text-sky-600" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* Sticky Search & Route Filter */}
      <div className="sticky top-[calc(3.25rem+env(safe-area-inset-top))] z-20 border-b border-slate-200 bg-slate-100/95 px-3 py-2.5 backdrop-blur-sm dark:border-[#2a3547] dark:bg-[#0b1020]/95">
        <div className="relative">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setVisibleCount(PAGE_STEP);
            }}
            placeholder="Tìm khách hàng, mã KH, SĐT, tuyến..."
            className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-9 pr-9 text-base text-slate-900 focus:border-sky-500 focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400"
            >
              <X size={16} />
            </button>
          )}
        </div>

        <div className="no-scrollbar mt-2 flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {ownEmployeeCode && (
            <button
              type="button"
              onClick={() => {
                setOnlyMine((v) => !v);
                setRouteFilter("ALL");
                setVisibleCount(PAGE_STEP);
              }}
              className={cn(
                "shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold",
                onlyMine
                  ? "bg-sky-600 text-white"
                  : "border border-slate-300 bg-white text-slate-700",
              )}
            >
              {onlyMine ? "Khách của tôi" : "Tất cả NPP"}
            </button>
          )}

          <button
            type="button"
            onClick={() => setRouteFilter("ALL")}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold",
              routeFilter === "ALL"
                ? "bg-[#14263d] text-white"
                : "border border-slate-300 bg-white text-slate-700",
            )}
          >
            Tất cả tuyến ({filtered.length})
          </button>

          {routes.map((route) => (
            <button
              key={route}
              type="button"
              onClick={() => {
                setRouteFilter(route);
                setVisibleCount(PAGE_STEP);
              }}
              className={cn(
                "shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold",
                routeFilter === route
                  ? "bg-sky-600 text-white"
                  : "border border-slate-300 bg-white text-slate-700",
              )}
            >
              {route}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="m-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700">
          {error}
        </div>
      )}

      {/* Customer Cards */}
      <div className="flex-1 space-y-2.5 p-3">
        {visible.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">
            <Users size={30} className="mx-auto mb-2 text-slate-300" />
            <p className="text-sm font-medium">Không có khách hàng nào</p>
          </div>
        ) : (
          <>
            {visible.map((c) => (
              <article
                key={c.id}
                className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-xs dark:border-[#2a3547] dark:bg-[#151d2b]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="rounded bg-[#14263d] px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
                        {formatCustomerCode(c.code) || c.code}
                      </span>
                      <h3 className="truncate text-sm font-bold text-slate-900 dark:text-white">
                        {c.name}
                      </h3>
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                      {c.salesRoute && (
                        <span className="inline-flex items-center gap-1 font-medium text-sky-700">
                          <MapPin size={11} /> {c.salesRoute}
                        </span>
                      )}
                      {c.type && (
                        <span className="inline-flex items-center gap-1">
                          <Building2 size={11} /> {c.type}
                        </span>
                      )}
                    </div>

                    {c.address && (
                      <p className="mt-1 line-clamp-1 text-[11px] text-slate-400">
                        {c.address}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-2.5">
                  {c.phone && (
                    <a
                      href={`tel:${c.phone}`}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 py-2 text-xs font-semibold text-slate-700 active:scale-95"
                    >
                      <Phone size={14} className="text-emerald-600" />
                      Gọi {c.phone}
                    </a>
                  )}
                  <Link
                    href={`/m?customer=${encodeURIComponent(c.code)}`}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-sky-600 py-2 text-xs font-bold text-white shadow-xs active:scale-95"
                  >
                    <ShoppingCart size={14} />
                    Bấm đơn ngay
                  </Link>
                </div>
              </article>
            ))}

            {filtered.length > visibleCount && (
              <button
                type="button"
                onClick={() => setVisibleCount((n) => n + PAGE_STEP)}
                className="w-full rounded-xl border border-slate-300 bg-white py-3 text-xs font-bold text-sky-700"
              >
                Xem thêm ({filtered.length - visibleCount} khách hàng)
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

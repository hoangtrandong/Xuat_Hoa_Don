"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Calendar,
  ClipboardList,
  Eye,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { API_URL, apiFetch } from "@/lib/api";
import { useAuthSession } from "@/lib/auth-session";
import { formatNumber, formatVNDFull } from "@/lib/format";
import { type MobileCurrentUser, todayInputDate } from "@/lib/mobile-sales";
import { cn } from "@/lib/utils";

type RemoteRow = Record<string, unknown>;

function strVal(row: RemoteRow, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function numVal(row: RemoteRow, ...keys: string[]): number {
  for (const k of keys) {
    const v = row[k];
    if (v != null && v !== "") {
      const n = Number(v);
      if (!Number.isNaN(n)) return n;
    }
  }
  return 0;
}

function offsetDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function MobileOrdersPage() {
  const session = useAuthSession();
  const [rangePreset, setRangePreset] = useState<"today" | "yesterday" | "7d">("today");
  const [fromDate, setFromDate] = useState(todayInputDate());
  const [toDate, setToDate] = useState(todayInputDate());
  const [ownStaffCode, setOwnStaffCode] = useState("");
  const [onlyMyOrders, setOnlyMyOrders] = useState(true);

  const [orders, setOrders] = useState<RemoteRow[]>([]);
  const [totalOrders, setTotalOrders] = useState(0);
  const [totalValue, setTotalValue] = useState(0);
  const [totalDiscount, setTotalDiscount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);

  // Order detail sheet
  const [detailOrderNo, setDetailOrderNo] = useState<string | null>(null);
  const [detailLines, setDetailLines] = useState<RemoteRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Load current user employee_code
  useEffect(() => {
    apiFetch(`${API_URL}/auth/me`)
      .then((r) => (r.ok ? r.json() : null))
      .then((me: MobileCurrentUser | null) => {
        const code = me?.employee_code?.trim() || "";
        setOwnStaffCode(code);
        if (!code) setOnlyMyOrders(false);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function fetchOrders() {
      await Promise.resolve();
      if (cancelled) return;
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          from_date: fromDate,
          to_date: toDate,
          skip: "0",
          limit: "100",
        });
        if (onlyMyOrders && ownStaffCode) {
          params.set("staff", ownStaffCode);
        }
        if (session.distributorCode) {
          params.set("distributor_code", session.distributorCode);
        }
        const res = await apiFetch(
          `${API_URL}/sync/vinamilk-orders/grouped?${params.toString()}`,
        );
        const payload = (await res.json().catch(() => ({}))) as {
          rows?: RemoteRow[];
          total?: number;
          total_value?: number;
          total_discount?: number;
          detail?: string;
        };
        if (!res.ok || !Array.isArray(payload.rows)) {
          throw new Error(payload.detail || "Không thể tải danh sách đơn hàng.");
        }
        if (!cancelled) {
          setOrders(payload.rows);
          setTotalOrders(payload.total ?? payload.rows.length);
          setTotalValue(payload.total_value ?? 0);
          setTotalDiscount(payload.total_discount ?? 0);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Không thể tải đơn hàng.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void fetchOrders();
    return () => {
      cancelled = true;
    };
  }, [fromDate, toDate, onlyMyOrders, ownStaffCode, session.distributorCode, refreshTick]);

  function selectPreset(preset: "today" | "yesterday" | "7d") {
    setRangePreset(preset);
    if (preset === "today") {
      const t = todayInputDate();
      setFromDate(t);
      setToDate(t);
    } else if (preset === "yesterday") {
      const y = offsetDate(1);
      setFromDate(y);
      setToDate(y);
    } else {
      setFromDate(offsetDate(6));
      setToDate(todayInputDate());
    }
  }

  async function openDetail(orderNo: string) {
    setDetailOrderNo(orderNo);
    setDetailLines([]);
    setDetailLoading(true);
    try {
      const params = new URLSearchParams({
        order_search: orderNo,
        skip: "0",
        limit: "200",
      });
      if (session.distributorCode) {
        params.set("distributor_code", session.distributorCode);
      }
      const res = await apiFetch(
        `${API_URL}/sync/vinamilk-orders?${params.toString()}`,
      );
      const payload = (await res.json().catch(() => ({}))) as {
        rows?: RemoteRow[];
      };
      if (res.ok && Array.isArray(payload.rows)) {
        setDetailLines(
          payload.rows.filter(
            (r) =>
              strVal(r, "Số đơn hàng", "orderNumber", "order_number") === orderNo,
          ),
        );
      }
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* Top Filter & KPI Strip */}
      <div className="border-b border-slate-200 bg-white px-3 py-3 dark:border-[#2a3547] dark:bg-[#151d2b]">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            {(
              [
                { id: "today", label: "Hôm nay" },
                { id: "yesterday", label: "Hôm qua" },
                { id: "7d", label: "7 ngày" },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => selectPreset(item.id)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-semibold transition",
                  rangePreset === item.id
                    ? "bg-[#14263d] text-white"
                    : "bg-slate-100 text-slate-600",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setRefreshTick((t) => t + 1)}
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-600 active:scale-95"
            aria-label="Tải lại"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        {/* Own orders toggle */}
        {ownStaffCode && (
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-slate-500">
              Mã NVBH: <strong className="font-mono text-slate-800">{ownStaffCode}</strong>
            </span>
            <button
              type="button"
              onClick={() => setOnlyMyOrders((v) => !v)}
              className="font-semibold text-sky-600 underline"
            >
              {onlyMyOrders ? "Đang xem: Đơn của tôi" : "Đang xem: Toàn NPP"}
            </button>
          </div>
        )}

        {/* KPI Cards */}
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2">
            <div className="text-[10px] font-semibold text-slate-500">Số đơn</div>
            <div className="mt-0.5 text-base font-extrabold text-slate-900">
              {formatNumber(totalOrders)}
            </div>
          </div>
          <div className="rounded-xl border border-sky-200 bg-sky-50/70 px-2.5 py-2">
            <div className="text-[10px] font-semibold text-sky-700">Doanh số</div>
            <div className="mt-0.5 truncate text-sm font-extrabold text-sky-800">
              {formatVNDFull(totalValue)}
            </div>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-2.5 py-2">
            <div className="text-[10px] font-semibold text-emerald-700">Chiết khấu</div>
            <div className="mt-0.5 truncate text-sm font-extrabold text-emerald-800">
              {formatVNDFull(totalDiscount)}
            </div>
          </div>
        </div>
      </div>

      {/* Order List */}
      <div className="flex-1 space-y-2.5 p-3">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12 text-slate-500">
            <Loader2 size={24} className="animate-spin text-sky-600" />
          </div>
        ) : orders.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
            <ClipboardList size={32} className="mx-auto mb-2 text-slate-300" />
            <p className="text-sm font-semibold text-slate-700">
              Chưa có đơn hàng nào trong khoảng ngày này
            </p>
            <Link
              href="/m"
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2.5 text-xs font-bold text-white"
            >
              <Plus size={15} /> Bấm đơn mới ngay
            </Link>
          </div>
        ) : (
          orders.map((row, idx) => {
            const orderNo = strVal(row, "Số đơn hàng", "orderNumber", "order_number");
            const customerName = strVal(row, "Tên khách hàng", "customerName", "customer_name");
            const customerCode = strVal(row, "Mã khách hàng", "customerCode", "customer_code");
            const orderDateStr = strVal(row, "Ngày đơn hàng", "orderDate", "order_date");
            const status = strVal(row, "Tình trạng xuất kho", "_delivery_status", "Trạng thái", "orderStatus");
            const productCount = numVal(row, "_product_count", "Số sản phẩm");
            const value = numVal(row, "Tổng tiền", "Thành tiền", "totalAmount", "total_amount", "amount");
            const isManual = orderNo.toUpperCase().startsWith("TC-");

            return (
              <article
                key={`${orderNo}-${idx}`}
                className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-xs dark:border-[#2a3547] dark:bg-[#151d2b]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="rounded bg-[#14263d] px-1.5 py-0.5 font-mono text-[11px] font-bold text-white">
                        {orderNo || "—"}
                      </span>
                      {status && (
                        <span className="truncate rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
                          {status}
                        </span>
                      )}
                    </div>
                    <h3 className="mt-1.5 truncate text-sm font-bold text-slate-900 dark:text-white">
                      {customerName || customerCode || "Khách hàng"}
                    </h3>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <Calendar size={11} /> {orderDateStr || fromDate}
                      </span>
                      {productCount > 0 && <span>· {productCount} SKU</span>}
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <div className="text-sm font-extrabold text-sky-700">
                      {formatVNDFull(value)}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-2.5">
                  <button
                    type="button"
                    onClick={() => void openDetail(orderNo)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 py-2 text-xs font-semibold text-slate-700 active:scale-95"
                  >
                    <Eye size={14} /> Xem chi tiết
                  </button>
                  {isManual && (
                    <Link
                      href={`/m?edit=${encodeURIComponent(orderNo)}`}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-sky-600 py-2 text-xs font-bold text-white active:scale-95"
                    >
                      <Pencil size={14} /> Sửa đơn
                    </Link>
                  )}
                </div>
              </article>
            );
          })
        )}
      </div>

      {/* Bottom Sheet: Chi tiết đơn hàng */}
      {detailOrderNo && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/55">
          <div className="flex-1" onClick={() => setDetailOrderNo(null)} />
          <div className="mobile-sheet-enter mx-auto flex max-h-[85dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-[#151d2b]">
            <div className="flex items-center justify-between bg-[#14263d] px-4 py-3 text-white">
              <span className="text-xs font-bold uppercase tracking-wide">
                Chi tiết đơn {detailOrderNo}
              </span>
              <button
                type="button"
                onClick={() => setDetailOrderNo(null)}
                className="rounded-lg p-1.5 text-white hover:bg-white/10"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto p-3.5 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {detailLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 size={22} className="animate-spin text-sky-600" />
                </div>
              ) : detailLines.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-500">
                  Không có dòng chi tiết sản phẩm.
                </p>
              ) : (
                detailLines.map((line, i) => {
                  const sku = strVal(line, "Mã sản phẩm", "productCode", "product_code");
                  const name = strVal(line, "Tên sản phẩm", "productName", "product_name");
                  const qty = numVal(line, "Số lượng", "quantity");
                  const promo = numVal(line, "SL khuyến mãi", "promoQuantity", "promo_quantity");
                  const amount = numVal(line, "Thành tiền", "Tổng tiền", "amount", "totalAmount");
                  return (
                    <div
                      key={`${sku}-${i}`}
                      className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs"
                    >
                      <div className="font-bold text-slate-900">{name || sku}</div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-slate-600">
                        <span>
                          {sku} · SL: <strong>{formatNumber(qty)}</strong>
                          {promo > 0 && (
                            <span className="ml-1.5 font-bold text-emerald-600">
                              +{formatNumber(promo)} KM
                            </span>
                          )}
                        </span>
                        <span className="font-bold text-sky-700">
                          {formatVNDFull(amount)}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

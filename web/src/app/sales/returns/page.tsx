"use client";
// src/app/sales/returns/page.tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Ban,
  CheckCircle2,
  Clock3,
  Eye,
  Loader2,
  PackageCheck,
  Plus,
  RefreshCw,
  RotateCcw,
  Scale,
  Search,
  ShieldCheck,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import Badge from "@/components/ui/Badge";
import ReplaceOrderReturnModal from "@/components/sales/ReplaceOrderReturnModal";
import WarehouseReceiveReturnModal, {
  type DeliveryReturnRecord,
} from "@/components/sales/WarehouseReceiveReturnModal";
import { API_URL, apiFetch } from "@/lib/api";
import { formatDateTime, formatNumber, formatVNDFull } from "@/lib/format";

type TabFilter = "ALL" | "PENDING_WAREHOUSE" | "COMPLETED" | "ORDER_REPLACEMENT" | "CANCELLED";

export default function SalesReturnsPage() {
  const [returns, setReturns] = useState<DeliveryReturnRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<TabFilter>("ALL");

  const [showReplaceModal, setShowReplaceModal] = useState(false);
  const [activeRecord, setActiveRecord] = useState<DeliveryReturnRecord | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  const loadReturns = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`${API_URL}/delivery-returns?limit=200`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? "Không thể tải danh sách phiếu trả hàng.");
      }
      const data: DeliveryReturnRecord[] = await res.json();
      setReturns(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi tải danh sách trả hàng.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReturns();
  }, [loadReturns]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  async function handleCancelReturn(ret: DeliveryReturnRecord) {
    const confirmed = window.confirm(
      `Bạn chắc chắn muốn hủy lệnh trả hàng ${ret.code}? Liên kết thay thế đơn (nếu có) sẽ được gỡ bỏ.`
    );
    if (!confirmed) return;
    setCancellingId(ret.id);
    setError("");
    try {
      const res = await apiFetch(`${API_URL}/delivery-returns/${ret.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Hủy từ màn hình Trả hàng" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail ?? "Không thể hủy phiếu trả hàng.");
      setToast(`Đã hủy lệnh yêu cầu trả hàng ${ret.code}.`);
      await loadReturns();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi khi hủy phiếu trả hàng.");
    } finally {
      setCancellingId(null);
    }
  }

  const stats = useMemo(() => {
    const pending = returns.filter((r) => r.status === "PENDING_WAREHOUSE").length;
    const completed = returns.filter(
      (r) => r.status === "WAREHOUSE_RECEIVED" || r.status === "APPROVED"
    ).length;
    const completedAmount = returns
      .filter((r) => r.status === "WAREHOUSE_RECEIVED" || r.status === "APPROVED")
      .reduce((s, r) => s + Number(r.amount || 0), 0);
    return {
      total: returns.length,
      pending,
      completed,
      completedAmount,
    };
  }, [returns]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return returns.filter((r) => {
      if (activeTab === "PENDING_WAREHOUSE" && r.status !== "PENDING_WAREHOUSE") return false;
      if (
        activeTab === "COMPLETED" &&
        r.status !== "WAREHOUSE_RECEIVED" &&
        r.status !== "APPROVED"
      )
        return false;
      if (activeTab === "ORDER_REPLACEMENT" && r.return_type !== "ORDER_REPLACEMENT") return false;
      if (activeTab === "CANCELLED" && r.status !== "CANCELLED") return false;

      if (!q) return true;
      return (
        (r.code || "").toLowerCase().includes(q) ||
        (r.order_number || "").toLowerCase().includes(q) ||
        (r.replacement_order_number || "").toLowerCase().includes(q) ||
        (r.delivery_request_code || "").toLowerCase().includes(q) ||
        (r.employee_code || "").toLowerCase().includes(q) ||
        (r.employee_name || "").toLowerCase().includes(q) ||
        (r.customer_code || "").toLowerCase().includes(q) ||
        (r.customer_name || "").toLowerCase().includes(q) ||
        r.items.some(
          (it) =>
            (it.sku || "").toLowerCase().includes(q) ||
            (it.product_name || "").toLowerCase().includes(q)
        )
      );
    });
  }, [returns, activeTab, search]);

  function renderStatusBadge(status: string) {
    if (status === "PENDING_WAREHOUSE") {
      return <Badge variant="warning">Chờ thủ kho nhận</Badge>;
    }
    if (status === "WAREHOUSE_RECEIVED" || status === "APPROVED") {
      return <Badge variant="success">Thành công (Đã giảm CN)</Badge>;
    }
    if (status === "CANCELLED" || status === "REJECTED") {
      return <Badge variant="danger">Đã hủy</Badge>;
    }
    return <Badge variant="default">{status}</Badge>;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Trả hàng & Thay thế đơn giao một phần"
        subtitle="Quản lý lệnh yêu cầu trả hàng về kho, đối chiếu đơn thay thế DMS và xác nhận nhập kho giảm công nợ NVGH"
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadReturns()}
              className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              Làm mới
            </button>
            <button
              type="button"
              onClick={() => setShowReplaceModal(true)}
              className="inline-flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-sky-700"
            >
              <Plus size={14} />
              Thay thế đơn &amp; Tạo lệnh trả hàng
            </button>
          </div>
        }
      />

      {toast && (
        <div className="flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
          <CheckCircle2 size={15} className="shrink-0 text-emerald-600" />
          <span>{toast}</span>
        </div>
      )}

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Tổng lệnh trả hàng"
          value={stats.total}
          icon={<RotateCcw size={20} />}
          color="bg-sky-50 text-sky-600"
        />
        <StatCard
          label="Chờ thủ kho nhận"
          value={stats.pending}
          icon={<Clock3 size={20} />}
          color="bg-amber-50 text-amber-600"
        />
        <StatCard
          label="Thành công (Đã giảm CN)"
          value={stats.completed}
          icon={<ShieldCheck size={20} />}
          color="bg-emerald-50 text-emerald-600"
        />
        <StatCard
          label="Giá trị đã giảm công nợ"
          value={formatVNDFull(stats.completedAmount)}
          icon={<Scale size={20} />}
          color="bg-rose-50 text-rose-600"
        />
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { key: "ALL", label: `Tất cả (${returns.length})` },
              { key: "PENDING_WAREHOUSE", label: `Chờ thủ kho nhận (${stats.pending})` },
              { key: "COMPLETED", label: `Thành công (${stats.completed})` },
              {
                key: "ORDER_REPLACEMENT",
                label: `Thay thế đơn DMS (${returns.filter((r) => r.return_type === "ORDER_REPLACEMENT").length})`,
              },
              { key: "CANCELLED", label: "Đã hủy" },
            ] as { key: TabFilter; label: string }[]
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                activeTab === tab.key
                  ? "bg-[#14263d] text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm mã trả, đơn cũ/mới, KH, NVGH, SP..."
            className="w-full rounded border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
        </div>
      </div>

      {/* Returns Table */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead className="bg-slate-100 text-[10px] font-semibold uppercase text-slate-600">
              <tr>
                <th className="px-3 py-2">Mã phiếu trả / Phiếu xuất</th>
                <th className="px-3 py-2">Đơn hàng / Thay thế</th>
                <th className="px-3 py-2">Khách hàng / NVGH</th>
                <th className="px-3 py-2">Hàng trả về kho</th>
                <th className="px-3 py-2 text-right">Giá trị trả</th>
                <th className="px-3 py-2">Trạng thái</th>
                <th className="px-3 py-2">Thời điểm</th>
                <th className="px-3 py-2 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-xs text-slate-500">
                    <Loader2 size={16} className="mr-1.5 inline animate-spin text-sky-600" />
                    Đang tải danh sách phiếu trả hàng...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-xs text-slate-400">
                    Chưa có lệnh yêu cầu trả hàng nào phù hợp bộ lọc.
                  </td>
                </tr>
              ) : (
                filtered.map((ret) => {
                  const totalQty = ret.items.reduce((s, it) => s + Number(it.quantity || 0), 0);
                  const isPending = ret.status === "PENDING_WAREHOUSE";
                  return (
                    <tr
                      key={ret.id}
                      className="border-b border-slate-100 text-[11px] even:bg-amber-50/40 hover:bg-sky-50/50"
                    >
                      <td className="px-3 py-2">
                        <div className="font-bold text-slate-800">{ret.code}</div>
                        <div className="text-[10px] text-slate-500">
                          PXK: {ret.delivery_request_code || `#${ret.delivery_request_id}`}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {ret.return_type === "ORDER_REPLACEMENT" && ret.replacement_order_number ? (
                          <div>
                            <span className="inline-block rounded bg-sky-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-sky-800">
                              Thay thế đơn DMS
                            </span>
                            <div className="mt-0.5 flex items-center gap-1 font-semibold text-slate-800">
                              <span>{ret.order_number || "—"}</span>
                              <ArrowRight size={11} className="text-sky-600" />
                              <span className="text-sky-700">{ret.replacement_order_number}</span>
                            </div>
                          </div>
                        ) : (
                          <div>
                            <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-slate-600">
                              Trả hàng chuyến xe
                            </span>
                            <div className="mt-0.5 font-medium text-slate-700">
                              {ret.order_number || "—"}
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-800">
                          {ret.customer_code ? `[${ret.customer_code}] ` : ""}
                          {ret.customer_name || "—"}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          NVGH: <strong>{ret.employee_code}</strong>{" "}
                          {ret.employee_name ? `- ${ret.employee_name}` : ""}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {ret.items.length > 0 ? (
                          <div>
                            <div className="font-semibold text-slate-700">
                              {ret.items.length} SP • Tổng SL: {formatNumber(totalQty)}
                            </div>
                            <div className="max-w-[220px] truncate text-[10px] text-slate-500">
                              {ret.items
                                .map((it) => `${it.sku || it.product_id} (${it.quantity})`)
                                .join(", ")}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-400">Theo tổng tiền</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-bold text-rose-600">
                        {formatVNDFull(ret.amount)}
                      </td>
                      <td className="px-3 py-2">
                        {renderStatusBadge(ret.status)}
                        {ret.warehouse_received_by && (
                          <div className="mt-0.5 text-[10px] text-emerald-700">
                            Kho: {ret.warehouse_received_by}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[10px] text-slate-500">
                        <div>Tạo: {formatDateTime(ret.created_at)}</div>
                        {ret.warehouse_received_at && (
                          <div className="text-emerald-700">
                            Nhận: {formatDateTime(ret.warehouse_received_at)}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {isPending ? (
                            <>
                              <button
                                type="button"
                                onClick={() => setActiveRecord(ret)}
                                className="inline-flex items-center gap-1 rounded bg-sky-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-sky-700"
                              >
                                <PackageCheck size={12} />
                                Thủ kho nhận
                              </button>
                              <button
                                type="button"
                                disabled={cancellingId === ret.id}
                                onClick={() => void handleCancelReturn(ret)}
                                className="inline-flex items-center gap-1 rounded bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                                title="Hủy lệnh trả hàng"
                              >
                                {cancellingId === ret.id ? (
                                  <Loader2 size={12} className="animate-spin" />
                                ) : (
                                  <Ban size={12} />
                                )}
                                Hủy
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setActiveRecord(ret)}
                              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              <Eye size={12} />
                              Chi tiết
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Thay thế đơn & Tạo lệnh trả hàng */}
      <ReplaceOrderReturnModal
        open={showReplaceModal}
        onClose={() => setShowReplaceModal(false)}
        onCreated={(code) => {
          setToast(
            `Đã tạo lệnh yêu cầu trả hàng ${code} (Chờ thủ kho xác nhận nhận đủ hàng để giảm công nợ NVGH).`
          );
          void loadReturns();
        }}
      />

      {/* Modal Thủ kho kiểm đếm & Xác nhận nhận hàng */}
      <WarehouseReceiveReturnModal
        record={activeRecord}
        onClose={() => setActiveRecord(null)}
        onUpdated={(msg) => {
          setToast(msg);
          void loadReturns();
        }}
      />
    </div>
  );
}

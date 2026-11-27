"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  Camera,
  CheckCircle2,
  CreditCard,
  Loader2,
  PackageMinus,
  RefreshCw,
  RotateCcw,
  Truck,
  X,
} from "lucide-react";
import { API_URL, apiFetch } from "@/lib/api";
import { formatVND } from "@/lib/format";

type TripSummary = {
  id: number;
  code: string;
  status: string;
  vehicle_plate_number?: string | null;
  driver_name?: string | null;
  route_code?: string | null;
  planned_weight_kg?: number;
  note?: string | null;
  created_at: string;
};

type TripOrder = {
  id: number;
  order_number: string;
  employee_id: number | null;
  employee_code: string;
  store_id?: number | null;
  customer_code?: string | null;
  customer_name?: string | null;
  amount: number;
  returned_amount?: number;
  net_amount?: number | null;
  delivery_status?: string;
  payment_status: string;
  payment_method?: string | null;
  einvoice_status?: string;
  note?: string | null;
};

type TripItem = {
  product_id: number;
  sku: string;
  product_name: string;
  quantity: number;
  boxes_per_carton: number;
};

type TripDetail = {
  request_id: number;
  request_code: string;
  request_status: string;
  orders: TripOrder[];
  items?: TripItem[];
};

const inputCls =
  "w-full min-w-0 rounded border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500";

export default function MobileDeliveriesPage() {
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<number | null>(null);
  const [tripDetail, setTripDetail] = useState<TripDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Modal Ghi nợ Cửa hàng (2 bước + POD)
  const [debtOrder, setDebtOrder] = useState<TripOrder | null>(null);
  const [podUrl, setPodUrl] = useState("");
  const [debtReason, setDebtReason] = useState("");

  // Modal Trả hàng / Giao một phần (2 bước chờ Thủ kho)
  const [returnOrder, setReturnOrder] = useState<TripOrder | null>(null);
  const [returnProdId, setReturnProdId] = useState<number>(0);
  const [returnQty, setReturnQty] = useState<number>(1);
  const [returnUnitPrice, setReturnUnitPrice] = useState<number>(0);
  const [returnCondition, setReturnCondition] = useState<"GOOD" | "DAMAGED" | "EXPIRED">("GOOD");
  const [returnReason, setReturnReason] = useState("Khách từ chối nhận");

  const loadTrips = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`${API_URL}/delivery-requests?limit=30`);
      if (!res.ok) throw new Error("Không thể tải danh sách chuyến giao hàng.");
      const data = (await res.json()) as TripSummary[];
      const activeTrips = data.filter((t) => t.status !== "CANCELLED");
      setTrips(activeTrips);
      if (activeTrips.length > 0 && !selectedTripId) {
        setSelectedTripId(activeTrips[0].id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi tải chuyến xe.");
    } finally {
      setLoading(false);
    }
  }, [selectedTripId]);

  const loadTripDetail = useCallback(async (tripId: number) => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`${API_URL}/delivery-requests/${tripId}/settlement`);
      if (!res.ok) throw new Error("Không thể tải danh sách đơn trên chuyến xe.");
      setTripDetail((await res.json()) as TripDetail);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi tải chi tiết chuyến xe.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTrips();
  }, [loadTrips]);

  useEffect(() => {
    if (selectedTripId) {
      void loadTripDetail(selectedTripId);
    }
  }, [selectedTripId, loadTripDetail]);

  function getOrderNet(o: TripOrder): number {
    if (o.net_amount != null) return Number(o.net_amount);
    return Math.max(0, Number(o.amount || 0) - Number(o.returned_amount || 0));
  }

  async function handleQuickPay(order: TripOrder, method: "CASH" | "BANK") {
    if (!selectedTripId) return;
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const res = await apiFetch(
        `${API_URL}/delivery-requests/${selectedTripId}/settlement/orders/${order.id}/pay`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payment_method: method,
            paid_amount: getOrderNet(order),
            note: method === "CASH" ? "NVGH thu tiền mặt tại điểm bán" : "Khách chuyển khoản tại điểm bán",
          }),
        }
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || "Không thể xác nhận thanh toán đơn.");
      }
      setNotice(
        `Đã chốt giao ${order.order_number} (${method === "CASH" ? "Tiền mặt" : "Chuyển khoản"} ${formatVND(getOrderNet(order))}).`
      );
      await loadTripDetail(selectedTripId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi cập nhật thanh toán.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmitDebtTransfer() {
    if (!debtOrder || !selectedTripId) return;
    if (!debtOrder.employee_id || !debtOrder.store_id) {
      setError("Đơn hàng chưa gắn đủ mã NVGH hoặc mã Cửa hàng để chuyển công nợ.");
      return;
    }
    if (!podUrl.trim()) {
      setError("Bắt buộc nhập/đính kèm ảnh ký nhận (POD) khi chuyển công nợ sang Cửa hàng.");
      return;
    }
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const res = await apiFetch(`${API_URL}/debt-transfers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_party_type: "EMPLOYEE",
          from_party_id: debtOrder.employee_id,
          to_party_type: "STORE",
          to_party_id: debtOrder.store_id,
          amount: getOrderNet(debtOrder),
          delivery_request_order_id: debtOrder.id,
          pod_image_url: podUrl.trim(),
          require_approval: true,
          reason: debtReason.trim() || `Chuyển nợ đơn ${debtOrder.order_number} từ Mobile`,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || "Không thể gửi yêu cầu chuyển công nợ.");
      }
      setNotice(`Đã gửi yêu cầu chuyển nợ đơn ${debtOrder.order_number} (có POD) chờ Kế toán duyệt.`);
      setDebtOrder(null);
      setPodUrl("");
      setDebtReason("");
      await loadTripDetail(selectedTripId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi gửi yêu cầu chuyển nợ.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmitReturn() {
    if (!returnOrder || !selectedTripId || !returnOrder.employee_id) return;
    if (!returnProdId || returnQty <= 0) {
      setError("Vui lòng chọn sản phẩm và số lượng trả về > 0.");
      return;
    }
    const lineAmt = returnUnitPrice > 0 ? returnQty * returnUnitPrice : getOrderNet(returnOrder);
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const res = await apiFetch(`${API_URL}/delivery-returns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          delivery_request_id: selectedTripId,
          employee_id: returnOrder.employee_id,
          order_id: returnOrder.id,
          amount: lineAmt,
          restore_stock: true,
          auto_receive: false,
          note: `NVGH báo trả từ Mobile: ${returnReason}`,
          items: [
            {
              product_id: returnProdId,
              quantity: returnQty,
              unit_price: returnUnitPrice,
              amount: lineAmt,
              item_condition: returnCondition,
              reason: returnReason,
            },
          ],
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || "Không thể lập phiếu trả hàng.");
      }
      setNotice(
        `Đã gửi phiếu trả hàng đơn ${returnOrder.order_number} (${returnCondition}) — Chờ Thủ kho kiểm đếm nhập kho FEFO.`
      );
      setReturnOrder(null);
      await loadTripDetail(selectedTripId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi lập phiếu trả hàng.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-3 p-3">
      {/* Chọn chuyến xe */}
      <div className="rounded-lg border border-slate-300 bg-white p-3 shadow-sm">
        <div className="mb-1.5 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase text-slate-700">
            <Truck size={15} className="text-red-500" />
            Chuyến Giao Hàng Của Tôi
          </div>
          <button
            type="button"
            onClick={() => (selectedTripId ? void loadTripDetail(selectedTripId) : void loadTrips())}
            className="rounded border border-slate-200 p-1 text-slate-600 hover:bg-slate-50"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
        <select
          value={selectedTripId ?? ""}
          onChange={(e) => setSelectedTripId(e.target.value ? Number(e.target.value) : null)}
          className={inputCls}
        >
          {trips.length === 0 && <option value="">Chưa có chuyến giao hàng nào</option>}
          {trips.map((t) => (
            <option key={t.id} value={t.id}>
              {t.code} {t.vehicle_plate_number ? `· ${t.vehicle_plate_number}` : ""}{" "}
              {t.route_code ? `· ${t.route_code}` : ""} ({t.status})
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
          <AlertTriangle size={14} className="shrink-0 text-red-600" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="flex items-center gap-2 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          <CheckCircle2 size={14} className="shrink-0 text-emerald-600" />
          <span>{notice}</span>
        </div>
      )}

      {/* Danh sách đơn hàng trên chuyến xe */}
      {loading && !tripDetail ? (
        <div className="flex items-center justify-center py-10 text-slate-500">
          <Loader2 size={22} className="animate-spin text-sky-600" />
        </div>
      ) : (
        <div className="space-y-2.5">
          {(tripDetail?.orders || []).map((ord) => {
            const netAmt = getOrderNet(ord);
            const isSettled = ["PAID", "PAID_BANK", "PAID_CASH", "TRANSFERRED_DEBT", "RETURNED"].includes(
              ord.payment_status
            );
            return (
              <div
                key={ord.id}
                className="rounded-lg border border-slate-300 bg-white p-3 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs font-bold text-[#14263d]">
                        {ord.order_number}
                      </span>
                      {ord.delivery_status === "PARTIAL_DELIVERED" && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                          Giao 1 phần
                        </span>
                      )}
                      {ord.einvoice_status === "ADJUSTMENT_REQUIRED" && (
                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
                          Cần HĐ ĐC giảm
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs font-semibold text-slate-800">
                      {ord.customer_name || ord.customer_code || "Khách lẻ"}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-bold text-sky-700">{formatVND(netAmt)}</div>
                    {Number(ord.returned_amount || 0) > 0 && (
                      <div className="text-[10px] text-rose-600">
                        Đã trả: -{formatVND(Number(ord.returned_amount))}
                      </div>
                    )}
                  </div>
                </div>

                {isSettled ? (
                  <div className="mt-2.5 flex items-center justify-between rounded bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-800">
                    <span className="inline-flex items-center gap-1">
                      <CheckCircle2 size={13} /> Đã chốt ({ord.payment_status})
                    </span>
                    <span>{ord.payment_method || ""}</span>
                  </div>
                ) : (
                  <div className="mt-2.5 grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => void handleQuickPay(ord, "CASH")}
                      className="inline-flex items-center justify-center gap-1 rounded bg-emerald-600 px-2 py-2 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:bg-slate-300"
                    >
                      <Banknote size={13} /> Thu Tiền mặt
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => void handleQuickPay(ord, "BANK")}
                      className="inline-flex items-center justify-center gap-1 rounded bg-sky-600 px-2 py-2 text-[11px] font-semibold text-white hover:bg-sky-700 disabled:bg-slate-300"
                    >
                      <CreditCard size={13} /> Chuyển khoản
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => {
                        setDebtOrder(ord);
                        setPodUrl("");
                        setDebtReason("");
                      }}
                      className="inline-flex items-center justify-center gap-1 rounded border border-indigo-300 bg-indigo-50 px-2 py-2 text-[11px] font-semibold text-indigo-800 hover:bg-indigo-100"
                    >
                      <Camera size={13} /> Ghi nợ (POD)
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => {
                        setReturnOrder(ord);
                        setReturnProdId(tripDetail?.items?.[0]?.product_id || 0);
                        setReturnQty(1);
                        setReturnUnitPrice(0);
                        setReturnCondition("GOOD");
                        setReturnReason("Khách từ chối nhận");
                      }}
                      className="inline-flex items-center justify-center gap-1 rounded border border-rose-300 bg-rose-50 px-2 py-2 text-[11px] font-semibold text-rose-800 hover:bg-rose-100"
                    >
                      <RotateCcw size={13} /> Giao thiếu / Trả
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Chuyển nợ Cửa hàng (2 bước + POD) */}
      {debtOrder && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-4">
          <div className="w-full max-w-md overflow-hidden rounded-t-xl border border-slate-400 bg-white shadow-xl sm:rounded-lg">
            <div className="flex items-center justify-between bg-[#14263d] px-3 py-2 text-white">
              <div className="flex items-center gap-2">
                <Camera size={16} className="text-red-500" />
                <span className="text-xs font-bold uppercase">
                  Chuyển nợ Cửa hàng · {debtOrder.order_number}
                </span>
              </div>
              <button type="button" onClick={() => setDebtOrder(null)} className="p-1 text-white">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-2.5 p-3">
              <div className="rounded bg-slate-50 p-2 text-xs text-slate-700">
                Số tiền chuyển nợ: <strong className="text-sky-700">{formatVND(getOrderNet(debtOrder))}</strong>
              </div>
              <div>
                <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                  Link / Mã ảnh ký nhận (POD) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={podUrl}
                  onChange={(e) => setPodUrl(e.target.value)}
                  placeholder="https://... hoặc mã ảnh biên bản ký nhận"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                  Ghi chú chuyển nợ
                </label>
                <input
                  type="text"
                  value={debtReason}
                  onChange={(e) => setDebtReason(e.target.value)}
                  placeholder="Khách hẹn thanh toán sau 7 ngày..."
                  className={inputCls}
                />
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-slate-300 bg-slate-100 px-3 py-2">
              <button
                type="button"
                onClick={() => setDebtOrder(null)}
                className="rounded bg-red-700 px-3 py-1.5 text-xs font-semibold text-white"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleSubmitDebtTransfer()}
                className="inline-flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white disabled:bg-slate-300"
              >
                <CheckCircle2 size={13} /> Gửi Kế toán duyệt
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Trả hàng / Giao một phần (2 bước chờ Thủ kho) */}
      {returnOrder && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-4">
          <div className="w-full max-w-md overflow-hidden rounded-t-xl border border-slate-400 bg-white shadow-xl sm:rounded-lg">
            <div className="flex items-center justify-between bg-[#14263d] px-3 py-2 text-white">
              <div className="flex items-center gap-2">
                <PackageMinus size={16} className="text-red-500" />
                <span className="text-xs font-bold uppercase">
                  Báo Giao Thiếu / Trả Hàng · {returnOrder.order_number}
                </span>
              </div>
              <button type="button" onClick={() => setReturnOrder(null)} className="p-1 text-white">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-2.5 p-3">
              <div>
                <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                  Sản phẩm trả về
                </label>
                <select
                  value={returnProdId}
                  onChange={(e) => setReturnProdId(Number(e.target.value))}
                  className={inputCls}
                >
                  {(tripDetail?.items || []).map((it) => (
                    <option key={it.product_id} value={it.product_id}>
                      {it.sku} - {it.product_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                    Số lượng trả (hộp)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={returnQty}
                    onChange={(e) => setReturnQty(Math.max(1, Number(e.target.value) || 1))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                    Đơn giá (đ)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={returnUnitPrice}
                    onChange={(e) => setReturnUnitPrice(Math.max(0, Number(e.target.value) || 0))}
                    className={inputCls}
                  />
                </div>
              </div>
              <div>
                <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                  Tình trạng hàng
                </label>
                <select
                  value={returnCondition}
                  onChange={(e) => setReturnCondition(e.target.value as "GOOD" | "DAMAGED" | "EXPIRED")}
                  className={inputCls}
                >
                  <option value="GOOD">GOOD - Nguyên vẹn (Nhập lại Lô FEFO)</option>
                  <option value="DAMAGED">DAMAGED - Hỏng vận chuyển (Chờ Admin duyệt)</option>
                  <option value="EXPIRED">EXPIRED - Hết hạn</option>
                </select>
              </div>
              <div>
                <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                  Lý do trả hàng
                </label>
                <input
                  type="text"
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-slate-300 bg-slate-100 px-3 py-2">
              <button
                type="button"
                onClick={() => setReturnOrder(null)}
                className="rounded bg-red-700 px-3 py-1.5 text-xs font-semibold text-white"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleSubmitReturn()}
                className="inline-flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white disabled:bg-slate-300"
              >
                <CheckCircle2 size={13} /> Gửi phiếu chờ Thủ kho nhận
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

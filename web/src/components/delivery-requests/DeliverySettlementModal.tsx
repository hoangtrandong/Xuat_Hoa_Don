"use client";

import { useCallback, useEffect, useState } from "react";
import {
  X,
  CheckCircle2,
  Clock,
  Search,
  RefreshCw,
  ArrowRight,
  RotateCcw,
  PackageMinus,
  Plus,
  Trash2,
  PackageCheck,
} from "lucide-react";
import { API_URL, apiFetch } from "@/lib/api";

type DeliveryOrder = {
  id: number;
  order_date: string | null;
  order_number: string;
  employee_id: number | null;
  employee_code: string;
  employee_name: string | null;
  customer_code: string | null;
  customer_name: string | null;
  amount: number;
  payment_status: string;
  payment_method: string | null;
  bank_ref: string | null;
  paid_at: string | null;
  note: string | null;
};

type EmployeeSettlement = {
  employee_id: number | null;
  employee_code: string;
  employee_name: string | null;
  allocated_amount: number;
  orders_count: number;
  orders_amount: number;
  paid_bank: number;
  paid_cash: number;
  transferred_debt: number;
  returned: number;
  unpaid: number;
  remaining_cash_to_turn_in: number;
  difference: number;
};

type DeliveryReturnItem = {
  id?: number;
  product_id: number;
  quantity: number;
  cartons: number;
  loose_boxes: number;
  unit_price: number;
  amount: number;
  reason?: string | null;
  location_id?: number | null;
  sku?: string | null;
  product_name?: string | null;
  location_code?: string | null;
};

type DeliveryReturn = {
  id: number;
  code: string;
  delivery_request_id: number;
  employee_id: number;
  employee_code?: string | null;
  employee_name?: string | null;
  order_id?: number | null;
  order_number?: string | null;
  amount: number;
  status: string;
  note?: string | null;
  created_by?: string | null;
  created_at: string;
  items: DeliveryReturnItem[];
};

type SettlementOverviewItem = {
  id: number;
  product_id: number;
  sku: string;
  product_name: string;
  quantity: number;
  cartons: number;
  loose_boxes: number;
  boxes_per_carton: number;
};

type SettlementOverview = {
  request_id: number;
  request_code: string;
  request_status: string;
  warehouse_id: number;
  total_orders_count: number;
  total_amount: number;
  total_paid_bank: number;
  total_paid_cash: number;
  total_transferred_debt: number;
  total_returned: number;
  total_unpaid: number;
  difference: number;
  employee_settlements: EmployeeSettlement[];
  orders: DeliveryOrder[];
  returns: DeliveryReturn[];
  items?: SettlementOverviewItem[];
};

type Props = {
  requestId: number;
  requestCode: string;
  isOpen: boolean;
  onClose: () => void;
  onSettled?: () => void;
};

export default function DeliverySettlementModal({
  requestId,
  requestCode,
  isOpen,
  onClose,
  onSettled,
}: Props) {
  const [data, setData] = useState<SettlementOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState<"returns" | "orders">("returns");

  // Orders filter & search
  const [orderSearch, setOrderSearch] = useState("");
  const [selectedEmp, setSelectedEmp] = useState<string>("ALL");
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");

  // Delivery return modal states
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [returnEmpId, setReturnEmpId] = useState<number | "">("");
  const [returnOrderId, setReturnOrderId] = useState<number | "">("");
  const [returnAmount, setReturnAmount] = useState<number>(0);
  const [returnNote, setReturnNote] = useState("");
  const [returnRestoreStock, setReturnRestoreStock] = useState(true);
  const [returnItems, setReturnItems] = useState<
    Array<{
      product_id: number;
      cartons: number;
      loose_boxes: number;
      quantity: number;
      unit_price: number;
      amount: number;
      reason: string;
      boxes_per_carton: number;
    }>
  >([]);
  const [submittingReturn, setSubmittingReturn] = useState(false);

  const fetchSettlement = useCallback(async () => {
    const res = await apiFetch(`${API_URL}/delivery-requests/${requestId}/settlement`);
    if (!res.ok) throw new Error("Không thể tải chi tiết phiếu xuất.");
    const json: SettlementOverview = await res.json();
    return json;
  }, [requestId]);

  const loadSettlement = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await fetchSettlement());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi khi tải dữ liệu.");
    } finally {
      setLoading(false);
    }
  }, [fetchSettlement]);

  useEffect(() => {
    if (!isOpen || !requestId) return;
    let active = true;
    void fetchSettlement()
      .then((json) => {
        if (active) setData(json);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : "Lỗi khi tải dữ liệu.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isOpen, requestId, fetchSettlement]);

  async function handleCreateReturn() {
    if (!returnEmpId) {
      setError("Vui lòng chọn nhân viên giao hàng.");
      return;
    }
    const finalAmount =
      returnAmount > 0
        ? returnAmount
        : returnItems.reduce((acc, it) => acc + it.amount, 0);

    if (finalAmount <= 0) {
      setError("Giá trị hàng trả về phải lớn hơn 0.");
      return;
    }

    setSubmittingReturn(true);
    setError("");
    setMessage("");
    try {
      const payload = {
        delivery_request_id: requestId,
        employee_id: Number(returnEmpId),
        order_id: returnOrderId ? Number(returnOrderId) : undefined,
        amount: finalAmount,
        note: returnNote || undefined,
        restore_stock: returnRestoreStock,
        ...(returnItems.length > 0
          ? {
              items: returnItems.map((it) => ({
                product_id: it.product_id,
                quantity: it.quantity,
                cartons: it.cartons,
                loose_boxes: it.loose_boxes,
                unit_price: it.unit_price,
                amount: it.amount,
                reason: it.reason || undefined,
              })),
            }
          : {}),
      };

      const res = await apiFetch(`${API_URL}/delivery-returns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail ?? "Không thể lập phiếu trả hàng.");
      }

      const createdReturn: DeliveryReturn = await res.json();
      setMessage(
        `Đã lập phiếu trả hàng ${createdReturn.code} (${finalAmount.toLocaleString("vi-VN")} đ). Đã khôi phục tồn kho và khấu trừ công nợ NVGH.`
      );
      setShowReturnModal(false);
      setReturnEmpId("");
      setReturnOrderId("");
      setReturnAmount(0);
      setReturnNote("");
      setReturnItems([]);
      await loadSettlement();
      onSettled?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi khi lập phiếu trả hàng.");
    } finally {
      setSubmittingReturn(false);
    }
  }

  const filteredOrders = (data?.orders ?? []).filter((o) => {
    if (selectedEmp !== "ALL" && o.employee_code !== selectedEmp) return false;
    if (selectedStatus === "PAID" && !o.payment_status.startsWith("PAID")) return false;
    if (selectedStatus === "UNPAID" && o.payment_status.startsWith("PAID")) return false;
    if (orderSearch) {
      const q = orderSearch.toLowerCase();
      return (
        o.order_number.toLowerCase().includes(q) ||
        (o.customer_name && o.customer_name.toLowerCase().includes(q)) ||
        (o.customer_code && o.customer_code.toLowerCase().includes(q)) ||
        o.employee_code.toLowerCase().includes(q)
      );
    }
    return true;
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6">
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/70 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-sm">
              <RotateCcw size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-gray-900">Chi Tiết Phiếu Xuất & Hàng Trả</h3>
                <span className="font-mono text-xs px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800 font-semibold">
                  {requestCode}
                </span>
              </div>
              <p className="text-xs text-gray-500">
                Theo dõi đơn và xử lý hàng trả cho phiếu này; quyết toán công nợ được tổng hợp theo ngày và nhân viên
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadSettlement}
              disabled={loading}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              title="Làm mới"
            >
              <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Alerts */}
        {error && <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm">{error}</div>}
        {message && <div className="mx-6 mt-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl text-sm">{message}</div>}

        <div className="mx-6 mt-4 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-800">
          Đây là chi tiết nghiệp vụ của một phiếu xuất, không phải màn hình quyết toán chuyến. Công nợ được đối chiếu chung theo ngày/nhân viên.
        </div>

        {/* Tab Navigation */}
        <div className="px-6 pt-4 border-b border-gray-100 flex gap-4 overflow-x-auto">
          <button
            onClick={() => setActiveTab("returns")}
            className={`pb-3 text-sm font-semibold border-b-2 transition-colors shrink-0 flex items-center gap-1.5 ${
              activeTab === "returns"
                ? "border-rose-500 text-rose-600"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            <RotateCcw size={14} />
            Hàng trả về kho ({data?.returns?.length || 0})
          </button>
          <button
            onClick={() => setActiveTab("orders")}
            className={`pb-3 text-sm font-semibold border-b-2 transition-colors shrink-0 ${
              activeTab === "orders"
                ? "border-sky-500 text-sky-600"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            Đơn hàng tra cứu ({data?.orders.length || 0})
          </button>
        </div>

        {/* Modal Body / Tab Content */}
        <div className="p-6 flex-1 overflow-y-auto">
          {/* TAB 2: ORDERS */}
          {activeTab === "orders" && (
            <div className="space-y-4">
              {/* Filter bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 bg-gray-50/80 p-3 rounded-xl border border-gray-100">
                <div className="flex items-center gap-2 flex-1 min-w-[240px]">
                  <div className="relative flex-1">
                    <Search size={14} className="absolute left-3 top-2.5 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Tìm số đơn hàng, mã KH, tên KH..."
                      value={orderSearch}
                      onChange={(e) => setOrderSearch(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>
                  {orderSearch && (
                    <button onClick={() => setOrderSearch("")} className="text-xs text-gray-400 hover:text-gray-600">
                      Xóa
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={selectedEmp}
                    onChange={(e) => setSelectedEmp(e.target.value)}
                    className="px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg text-xs"
                  >
                    <option value="ALL">Tất cả NVGH</option>
                    {data?.employee_settlements.map((e) => (
                      <option key={e.employee_code} value={e.employee_code}>
                        {e.employee_code} ({e.employee_name || ""})
                      </option>
                    ))}
                  </select>
                  <select
                    value={selectedStatus}
                    onChange={(e) => setSelectedStatus(e.target.value)}
                    className="px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg text-xs"
                  >
                    <option value="ALL">Tất cả trạng thái</option>
                    <option value="UNPAID">Chưa thanh toán</option>
                    <option value="PAID">Đã thanh toán</option>
                  </select>
                  <span className="text-xs text-gray-500 px-2 py-1 bg-white border border-gray-200 rounded-lg">
                    {filteredOrders.length} đơn
                  </span>
                </div>
              </div>

              {/* Orders table */}
              <div className="overflow-x-auto rounded-xl border border-gray-100 max-h-[500px]">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50/90 text-gray-500 border-b border-gray-100 sticky top-0">
                    <tr>
                      <th className="text-left px-4 py-2.5">Số đơn hàng</th>
                      <th className="text-left px-4 py-2.5">Ngày đơn</th>
                      <th className="text-left px-4 py-2.5">NVGH</th>
                      <th className="text-left px-4 py-2.5">Mã KH</th>
                      <th className="text-left px-4 py-2.5">Tên khách hàng</th>
                      <th className="text-right px-4 py-2.5">Số tiền</th>
                      <th className="text-center px-4 py-2.5">Trạng thái TT</th>
                      <th className="text-left px-4 py-2.5">Hình thức / Ref</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredOrders.map((ord) => {
                      const isPaid = ord.payment_status.startsWith("PAID");
                      const isReturned = ord.payment_status === "RETURNED";
                      const isTransferredDebt = ord.payment_status === "TRANSFERRED_DEBT";

                      return (
                        <tr key={ord.id} className="hover:bg-gray-50/60">
                          <td className="px-4 py-2.5 font-mono font-medium text-sky-700">{ord.order_number}</td>
                          <td className="px-4 py-2.5 text-gray-500">{ord.order_date || "—"}</td>
                          <td className="px-4 py-2.5">
                            <span className="font-semibold text-gray-900">{ord.employee_code}</span>
                            {ord.employee_name && <span className="text-gray-400 ml-1">({ord.employee_name})</span>}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-gray-600">{ord.customer_code || "—"}</td>
                          <td className="px-4 py-2.5 font-medium text-gray-800">{ord.customer_name || "—"}</td>
                          <td className="px-4 py-2.5 text-right font-bold text-gray-900">
                            {ord.amount.toLocaleString("vi-VN")} đ
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            {isPaid ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800">
                                <CheckCircle2 size={11} /> Đã thu
                              </span>
                            ) : isReturned ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-100 text-rose-800">
                                <RotateCcw size={11} /> Trả hàng
                              </span>
                            ) : isTransferredDebt ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-purple-100 text-purple-800">
                                <ArrowRight size={11} /> Khách nợ
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-gray-100 text-gray-600">
                                <Clock size={11} /> Chưa thu
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-gray-600">
                            {isPaid ? (
                              <div className="flex flex-col">
                                <span className="font-medium text-gray-900">
                                  {ord.payment_method === "BANK" ? "Chuyển khoản" : "Tiền mặt"}
                                </span>
                                {ord.bank_ref && <span className="font-mono text-[10px] text-gray-400">Ref: {ord.bank_ref}</span>}
                              </div>
                            ) : isReturned ? (
                              <span className="text-rose-700 font-medium">Hoàn kho & Cấn nợ</span>
                            ) : isTransferredDebt ? (
                              <span className="text-purple-700 font-medium">Chuyển nợ khách</span>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      );
                    })}

                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "returns" && data && (
            <div className="space-y-4">
              <div className="bg-rose-50/60 border border-rose-100 rounded-xl p-3 text-xs text-rose-800 leading-relaxed flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  💡 <strong>Hàng trả về từ chuyến xe:</strong> Ghi nhận hàng do khách từ chối nhận nguyên đơn hoặc trả lại một số mặt hàng lẻ (thùng/hộp). Khi lập phiếu trả hàng, hệ thống tự động:
                  <ul className="list-disc pl-5 mt-1 space-y-0.5">
                    <li>Khôi phục tồn kho vật lý tại kho (InventoryTransaction IN).</li>
                    <li>Khấu trừ công nợ NVGH trên sổ cái tài chính (DebtLedgerEntry RETURN).</li>
                    <li>Trừ giảm số tiền mặt NVGH phải nộp về cho công ty.</li>
                  </ul>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowReturnModal(true);
                    setReturnEmpId(data.employee_settlements[0]?.employee_id || "");
                    setReturnOrderId("");
                    setReturnAmount(0);
                    setReturnNote("");
                    setReturnRestoreStock(true);
                    setReturnItems([]);
                  }}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-colors"
                >
                  <Plus size={14} />
                  Lập phiếu trả hàng
                </button>
              </div>

              {/* Returns List Table */}
              <div className="overflow-x-auto rounded-xl border border-gray-100">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50/90 text-gray-500 border-b border-gray-100">
                    <tr>
                      <th className="text-left px-4 py-3">Mã phiếu trả</th>
                      <th className="text-left px-4 py-3">Thời gian</th>
                      <th className="text-left px-4 py-3">NVGH</th>
                      <th className="text-left px-4 py-3">Đơn hàng liên quan</th>
                      <th className="text-left px-4 py-3">Chi tiết mặt hàng / Lý do</th>
                      <th className="text-right px-4 py-3 text-rose-700 font-bold">Giá trị trả về</th>
                      <th className="text-center px-4 py-3">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.returns && data.returns.length > 0 ? (
                      data.returns.map((ret) => (
                        <tr key={ret.id} className="hover:bg-gray-50/60">
                          <td className="px-4 py-3 font-mono font-bold text-rose-700">{ret.code}</td>
                          <td className="px-4 py-3 text-gray-500">
                            {new Date(ret.created_at).toLocaleString("vi-VN")}
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-semibold text-gray-900">{ret.employee_code}</span>
                            {ret.employee_name && <span className="text-gray-400 ml-1">({ret.employee_name})</span>}
                          </td>
                          <td className="px-4 py-3">
                            {ret.order_number ? (
                              <span className="font-mono text-sky-700 bg-sky-50 px-2 py-0.5 rounded text-[11px]">
                                {ret.order_number}
                              </span>
                            ) : (
                              <span className="text-gray-400 italic">Trả lẻ theo SP</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {ret.items && ret.items.length > 0 ? (
                              <div className="space-y-1">
                                {ret.items.map((it, idx) => (
                                  <div key={idx} className="flex items-center gap-2">
                                    <span className="font-semibold text-gray-800">{it.sku || "SP"}</span>
                                    <span className="text-gray-600">
                                      {it.quantity} hộp
                                      {(it.cartons > 0 || it.loose_boxes > 0) &&
                                        ` (${it.cartons > 0 ? `${it.cartons} thùng ` : ""}${
                                          it.loose_boxes > 0 ? `${it.loose_boxes} lẻ` : ""
                                        })`}
                                    </span>
                                    {it.reason && (
                                      <span className="text-gray-400 italic">[{it.reason}]</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-gray-600">{ret.note || "Trả nguyên đơn"}</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-bold text-rose-700">
                            {ret.amount.toLocaleString("vi-VN")} đ
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800">
                              <CheckCircle2 size={12} /> Đã hoàn kho & Cấn nợ
                            </span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                          Chuyến xe này chưa có ghi nhận hàng trả về nào.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-gray-100 bg-gray-50/50 flex items-center justify-between">
          <p className="text-xs text-gray-500">
            Mọi thanh toán & trả hàng ghi nhận sẽ tự động sinh bút toán đối soát nợ trên sổ cái công nợ tài chính.
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-xl text-xs font-semibold shadow-sm transition-colors"
          >
            Đóng
          </button>
        </div>
      </div>

      {/* Create Return Slip Modal */}
      {showReturnModal && (
        <div className="fixed inset-0 z-60 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 w-full max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <RotateCcw className="text-rose-600" size={18} />
                <h4 className="font-bold text-gray-900 text-sm">Lập phiếu trả hàng về kho & Cấn trừ nợ</h4>
              </div>
              <button onClick={() => setShowReturnModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Nhân viên giao hàng <span className="text-red-500">*</span>
                </label>
                <select
                  value={returnEmpId}
                  onChange={(e) => {
                    setReturnEmpId(e.target.value ? Number(e.target.value) : "");
                    setReturnOrderId("");
                  }}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs bg-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                >
                  <option value="">-- Chọn NVGH --</option>
                  {data?.employee_settlements.map((emp) => (
                    <option key={emp.employee_id || emp.employee_code} value={emp.employee_id || ""}>
                      {emp.employee_code} ({emp.employee_name || ""})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Đơn hàng liên quan (tùy chọn)
                </label>
                <select
                  value={returnOrderId}
                  onChange={(e) => {
                    const oId = e.target.value ? Number(e.target.value) : "";
                    setReturnOrderId(oId);
                    if (oId) {
                      const matchedOrd = data?.orders.find((o) => o.id === oId);
                      if (matchedOrd && returnItems.length === 0) {
                        setReturnAmount(matchedOrd.amount);
                      }
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs bg-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                >
                  <option value="">-- Không gắn đơn (Trả lẻ theo mặt hàng) --</option>
                  {data?.orders
                    .filter((o) => !returnEmpId || o.employee_id === Number(returnEmpId))
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.order_number} - {o.customer_name || o.customer_code} ({o.amount.toLocaleString("vi-VN")} đ)
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {/* Item-level return list */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                  <PackageMinus size={14} className="text-rose-600" />
                  Chi tiết mặt hàng trả về
                </label>
                <button
                  type="button"
                  onClick={() => {
                    if (!data?.items || data.items.length === 0) {
                      setError("Chuyến xe không có danh sách mặt hàng để chọn.");
                      return;
                    }
                    const firstProd = data.items[0];
                    setReturnItems([
                      ...returnItems,
                      {
                        product_id: firstProd.product_id,
                        cartons: 0,
                        loose_boxes: 1,
                        quantity: 1,
                        unit_price: 0,
                        amount: 0,
                        reason: "Khách trả hàng",
                        boxes_per_carton: firstProd.boxes_per_carton || 1,
                      },
                    ]);
                  }}
                  className="inline-flex items-center gap-1 text-xs text-rose-600 hover:text-rose-700 font-semibold"
                >
                  <Plus size={14} /> Thêm sản phẩm
                </button>
              </div>

              {returnItems.length > 0 ? (
                <div className="space-y-2 border border-gray-100 rounded-xl p-3 bg-gray-50/60 max-h-60 overflow-y-auto">
                  {returnItems.map((item, idx) => (
                    <div key={idx} className="bg-white p-2.5 rounded-lg border border-gray-200 text-xs space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <select
                          value={item.product_id}
                          onChange={(e) => {
                            const newPId = Number(e.target.value);
                            const selectedP = data?.items?.find((p) => p.product_id === newPId);
                            const bpc = selectedP?.boxes_per_carton || 1;
                            const updated = [...returnItems];
                            updated[idx].product_id = newPId;
                            updated[idx].boxes_per_carton = bpc;
                            updated[idx].quantity = updated[idx].cartons * bpc + updated[idx].loose_boxes;
                            updated[idx].amount = updated[idx].quantity * updated[idx].unit_price;
                            setReturnItems(updated);
                          }}
                          className="flex-1 px-2 py-1 border border-gray-200 rounded text-xs"
                        >
                          {data?.items?.map((p) => (
                            <option key={p.product_id} value={p.product_id}>
                              {p.sku} - {p.product_name} ({p.boxes_per_carton} hộp/thùng)
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            setReturnItems(returnItems.filter((_, i) => i !== idx));
                          }}
                          className="text-gray-400 hover:text-red-500 p-1"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        <div>
                          <span className="text-[10px] text-gray-500">Số thùng</span>
                          <input
                            type="number"
                            min={0}
                            value={item.cartons}
                            onChange={(e) => {
                              const c = Math.max(0, parseInt(e.target.value) || 0);
                              const updated = [...returnItems];
                              updated[idx].cartons = c;
                              updated[idx].quantity = c * item.boxes_per_carton + item.loose_boxes;
                              updated[idx].amount = updated[idx].quantity * item.unit_price;
                              setReturnItems(updated);
                            }}
                            className="w-full px-2 py-1 border border-gray-200 rounded text-xs"
                          />
                        </div>
                        <div>
                          <span className="text-[10px] text-gray-500">Hộp lẻ</span>
                          <input
                            type="number"
                            min={0}
                            value={item.loose_boxes}
                            onChange={(e) => {
                              const b = Math.max(0, parseInt(e.target.value) || 0);
                              const updated = [...returnItems];
                              updated[idx].loose_boxes = b;
                              updated[idx].quantity = item.cartons * item.boxes_per_carton + b;
                              updated[idx].amount = updated[idx].quantity * item.unit_price;
                              setReturnItems(updated);
                            }}
                            className="w-full px-2 py-1 border border-gray-200 rounded text-xs"
                          />
                        </div>
                        <div>
                          <span className="text-[10px] text-gray-500">Đơn giá (đ)</span>
                          <input
                            type="number"
                            min={0}
                            value={item.unit_price}
                            onChange={(e) => {
                              const p = Math.max(0, parseFloat(e.target.value) || 0);
                              const updated = [...returnItems];
                              updated[idx].unit_price = p;
                              updated[idx].amount = item.quantity * p;
                              setReturnItems(updated);
                            }}
                            className="w-full px-2 py-1 border border-gray-200 rounded text-xs"
                          />
                        </div>
                        <div>
                          <span className="text-[10px] text-gray-500 font-semibold text-rose-700">Thành tiền (đ)</span>
                          <input
                            type="number"
                            min={0}
                            value={item.amount}
                            onChange={(e) => {
                              const a = Math.max(0, parseFloat(e.target.value) || 0);
                              const updated = [...returnItems];
                              updated[idx].amount = a;
                              setReturnItems(updated);
                            }}
                            className="w-full px-2 py-1 border border-gray-200 rounded text-xs font-semibold text-rose-700"
                          />
                        </div>
                      </div>
                      <div>
                        <input
                          type="text"
                          placeholder="Lý do trả lại (bao bì lỗi, khách dư, giao trễ...)"
                          value={item.reason}
                          onChange={(e) => {
                            const updated = [...returnItems];
                            updated[idx].reason = e.target.value;
                            setReturnItems(updated);
                          }}
                          className="w-full px-2 py-1 border border-gray-200 rounded text-[11px]"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-3 text-xs text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-200 text-center">
                  Chưa chọn sản phẩm lẻ. Nếu trả nguyên đơn, số tiền sẽ được lấy theo đơn hàng đã chọn bên trên.
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Tổng giá trị trả về (đ) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  min={0}
                  value={
                    returnAmount > 0
                      ? returnAmount
                      : returnItems.reduce((acc, it) => acc + it.amount, 0)
                  }
                  onChange={(e) => setReturnAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs font-bold text-rose-700 bg-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div className="flex items-center pt-5">
                <label className="flex items-center gap-2 text-xs font-medium text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={returnRestoreStock}
                    onChange={(e) => setReturnRestoreStock(e.target.checked)}
                    className="w-4 h-4 text-rose-600 rounded border-gray-300 focus:ring-rose-500"
                  />
                  <span>Khôi phục tồn kho (Tự động nhập kho vật lý)</span>
                </label>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Ghi chú</label>
              <input
                type="text"
                placeholder="Ghi chú phiếu trả hàng..."
                value={returnNote}
                onChange={(e) => setReturnNote(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs bg-white focus:outline-none focus:ring-2 focus:ring-rose-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setShowReturnModal(false)}
                className="px-3 py-2 border border-gray-200 rounded-xl text-xs font-medium text-gray-600 hover:bg-gray-50"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleCreateReturn}
                disabled={submittingReturn}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                <PackageCheck size={14} />
                {submittingReturn ? "Đang xử lý..." : "Xác nhận & Cấn trừ nợ NVGH"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

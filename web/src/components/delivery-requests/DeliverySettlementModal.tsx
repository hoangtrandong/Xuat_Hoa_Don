"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import {
  X,
  CreditCard,
  Banknote,
  CheckCircle2,
  Clock,
  Search,
  Upload,
  RefreshCw,
  ArrowRight,
  ShieldCheck,
  FileSpreadsheet,
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
};

type MatchResult = {
  statement_ref: string | null;
  statement_amount: number;
  statement_description: string;
  order_id: number | null;
  order_number: string | null;
  customer_code: string | null;
  customer_name: string | null;
  employee_code: string | null;
  order_amount: number | null;
  matched: boolean;
  confidence: number;
  message: string | null;
  already_paid: boolean;
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
  const [activeTab, setActiveTab] = useState<"employees" | "orders" | "statement">("employees");

  // Orders filter & search
  const [orderSearch, setOrderSearch] = useState("");
  const [selectedEmp, setSelectedEmp] = useState<string>("ALL");
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");

  // Single order payment modal
  const [payingOrder, setPayingOrder] = useState<DeliveryOrder | null>(null);
  const [payMethod, setPayMethod] = useState<"BANK" | "CASH">("BANK");
  const [payBankRef, setPayBankRef] = useState("");
  const [payNote, setPayNote] = useState("");
  const [submittingPay, setSubmittingPay] = useState(false);

  // Bank statement matching
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [matchingFile, setMatchingFile] = useState(false);
  const [matchResults, setMatchResults] = useState<MatchResult[] | null>(null);
  const [matchStats, setMatchStats] = useState<{ total: number; matched: number; autoConfirmed: number } | null>(null);

  useEffect(() => {
    if (isOpen && requestId) {
      loadSettlement();
    }
  }, [isOpen, requestId]);

  async function loadSettlement() {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`${API_URL}/delivery-requests/${requestId}/settlement`);
      if (!res.ok) throw new Error("Không thể tải bảng quyết toán chuyến xe.");
      const json: SettlementOverview = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi khi tải dữ liệu.");
    } finally {
      setLoading(false);
    }
  }

  async function handlePayOrder() {
    if (!payingOrder) return;
    setSubmittingPay(true);
    setError("");
    setMessage("");
    try {
      const res = await apiFetch(
        `${API_URL}/delivery-requests/${requestId}/settlement/orders/${payingOrder.id}/pay`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payment_method: payMethod,
            bank_ref: payBankRef || undefined,
            note: payNote || undefined,
          }),
        }
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail ?? "Không thể cập nhật thanh toán đơn hàng.");
      }
      setMessage(
        `Đã ghi nhận thanh toán ${payMethod === "BANK" ? "Chuyển khoản" : "Tiền mặt"} cho đơn ${payingOrder.order_number}. Đã khấu trừ công nợ nhân viên.`
      );
      setPayingOrder(null);
      setPayBankRef("");
      setPayNote("");
      await loadSettlement();
      onSettled?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi khi thanh toán đơn.");
    } finally {
      setSubmittingPay(false);
    }
  }

  async function handleUploadStatement(file: File, autoConfirm: boolean = false) {
    setMatchingFile(true);
    setError("");
    setMessage("");
    setMatchResults(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await apiFetch(
        `${API_URL}/delivery-requests/${requestId}/settlement/upload-statement?auto_confirm=${autoConfirm}`,
        {
          method: "POST",
          body: formData,
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail ?? "Không thể đọc và đối soát file sao kê.");

      setMatchResults(json.matches || []);
      setMatchStats({
        total: json.total_statements || 0,
        matched: json.matched_count || 0,
        autoConfirmed: json.auto_confirmed_count || 0,
      });

      if (autoConfirm && json.auto_confirmed_count > 0) {
        setMessage(
          `Đã đối soát thành công và tự động quyết toán & khấu trừ công nợ cho ${json.auto_confirmed_count} đơn hàng!`
        );
        await loadSettlement();
        onSettled?.();
      } else {
        setMessage(`Đã đối soát file sao kê: Khớp ${json.matched_count}/${json.total_statements} giao dịch.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi khi đối soát file sao kê.");
    } finally {
      setMatchingFile(false);
    }
  }

  const filteredOrders = useMemo(() => {
    if (!data?.orders) return [];
    return data.orders.filter((o) => {
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
  }, [data?.orders, selectedEmp, selectedStatus, orderSearch]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6">
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/70 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500 flex items-center justify-center text-white shadow-sm">
              <CreditCard size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-gray-900">Bảng Quyết Toán Chuyến Xe</h3>
                <span className="font-mono text-xs px-2.5 py-0.5 rounded-full bg-sky-100 text-sky-800 font-semibold">
                  {requestCode}
                </span>
              </div>
              <p className="text-xs text-gray-500">
                Đối soát các khoản tiền khách hàng thanh toán (ngân hàng / tiền mặt) và khấu trừ công nợ nhân viên
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

        {/* KPI Summary Cards */}
        {data && (
          <div className="px-6 pt-4 grid grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl">
              <span className="text-xs text-slate-500 font-medium">Tổng tiền chuyến ({data.total_orders_count} đơn)</span>
              <p className="text-lg font-bold text-slate-900 mt-1">{data.total_amount.toLocaleString("vi-VN")} đ</p>
            </div>
            <div className="p-3 bg-sky-50 border border-sky-100 rounded-xl">
              <div className="flex items-center gap-1.5 text-xs text-sky-700 font-medium">
                <CreditCard size={14} />
                <span>Đã thu Chuyển khoản</span>
              </div>
              <p className="text-lg font-bold text-sky-900 mt-1">{data.total_paid_bank.toLocaleString("vi-VN")} đ</p>
            </div>
            <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-xl">
              <div className="flex items-center gap-1.5 text-xs text-indigo-700 font-medium">
                <Banknote size={14} />
                <span>Đã nộp Tiền mặt</span>
              </div>
              <p className="text-lg font-bold text-indigo-900 mt-1">{data.total_paid_cash.toLocaleString("vi-VN")} đ</p>
            </div>
            <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl">
              <div className="flex items-center gap-1.5 text-xs text-amber-700 font-medium">
                <Clock size={14} />
                <span>Còn phải thu (chưa TT)</span>
              </div>
              <p className="text-lg font-bold text-amber-900 mt-1">{data.total_unpaid.toLocaleString("vi-VN")} đ</p>
            </div>
            <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl">
              <div className="flex items-center gap-1.5 text-xs text-emerald-700 font-medium">
                <ShieldCheck size={14} />
                <span>Đã khấu trừ công nợ</span>
              </div>
              <p className="text-lg font-bold text-emerald-900 mt-1">
                {(data.total_paid_bank + data.total_paid_cash).toLocaleString("vi-VN")} đ
              </p>
            </div>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="px-6 pt-4 border-b border-gray-100 flex gap-4">
          <button
            onClick={() => setActiveTab("employees")}
            className={`pb-3 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === "employees"
                ? "border-sky-500 text-sky-600"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            1. Quyết toán theo NVGH ({data?.employee_settlements.length || 0})
          </button>
          <button
            onClick={() => setActiveTab("orders")}
            className={`pb-3 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === "orders"
                ? "border-sky-500 text-sky-600"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            2. Chi tiết đơn hàng ({data?.orders.length || 0} đơn)
          </button>
          <button
            onClick={() => setActiveTab("statement")}
            className={`pb-3 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === "statement"
                ? "border-sky-500 text-sky-600"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            3. Đối soát sao kê ngân hàng
          </button>
        </div>

        {/* Modal Body / Tab Content */}
        <div className="p-6 flex-1 overflow-y-auto">
          {/* TAB 1: EMPLOYEES */}
          {activeTab === "employees" && data && (
            <div className="space-y-4">
              <div className="bg-sky-50/60 border border-sky-100 rounded-xl p-3 text-xs text-sky-800 leading-relaxed">
                💡 <strong>Nguyên tắc quyết toán công nợ chuyến xe:</strong> Khi phiếu xuất kho hoàn thành, NVGH được ghi nhận công nợ đúng bằng tổng tiền hàng. Khi cửa hàng chuyển khoản vào tài khoản công ty, hệ thống <strong>tự động khấu trừ công nợ NVGH</strong> tương ứng. Số tiền còn lại là số <strong>tiền mặt NVGH phải nộp về cho thủ quỹ</strong>.
              </div>
              <div className="overflow-x-auto rounded-xl border border-gray-100">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50/80 text-gray-500 border-b border-gray-100">
                    <tr>
                      <th className="text-left px-4 py-3">Mã NV</th>
                      <th className="text-left px-4 py-3">Tên NVGH</th>
                      <th className="text-right px-4 py-3">Nợ xuất kho (đã giao)</th>
                      <th className="text-right px-4 py-3">Số đơn</th>
                      <th className="text-right px-4 py-3">Tiền theo đơn</th>
                      <th className="text-right px-4 py-3 text-sky-700">KH Chuyển khoản (-Nợ)</th>
                      <th className="text-right px-4 py-3 text-indigo-700">Đã nộp TM (-Nợ)</th>
                      <th className="text-right px-4 py-3 text-amber-700 font-bold">Tiền mặt phải nộp về cty</th>
                      <th className="text-center px-4 py-3">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.employee_settlements.map((emp) => {
                      const isFullySettled = emp.remaining_cash_to_turn_in <= 0;
                      return (
                        <tr key={emp.employee_code} className="hover:bg-gray-50/60">
                          <td className="px-4 py-3 font-semibold text-gray-900">{emp.employee_code}</td>
                          <td className="px-4 py-3 text-gray-700">{emp.employee_name || "—"}</td>
                          <td className="px-4 py-3 text-right font-semibold text-gray-900">
                            {emp.allocated_amount.toLocaleString("vi-VN")} đ
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-gray-600">{emp.orders_count}</td>
                          <td className="px-4 py-3 text-right font-mono text-gray-600">
                            {emp.orders_amount.toLocaleString("vi-VN")} đ
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-sky-700">
                            {emp.paid_bank.toLocaleString("vi-VN")} đ
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-indigo-700">
                            {emp.paid_cash.toLocaleString("vi-VN")} đ
                          </td>
                          <td className="px-4 py-3 text-right font-bold text-amber-800 bg-amber-50/40">
                            {emp.remaining_cash_to_turn_in.toLocaleString("vi-VN")} đ
                          </td>
                          <td className="px-4 py-3 text-center">
                            {isFullySettled ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800">
                                <CheckCircle2 size={12} /> Đã tất toán
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800">
                                <Clock size={12} /> Cần nộp tiền mặt
                              </span>
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
                      <th className="text-center px-4 py-2.5">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredOrders.map((ord) => {
                      const isPaid = ord.payment_status.startsWith("PAID");
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
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            {!isPaid ? (
                              <button
                                onClick={() => {
                                  setPayingOrder(ord);
                                  setPayMethod("BANK");
                                  setPayBankRef("");
                                  setPayNote("");
                                }}
                                className="px-2.5 py-1 bg-sky-50 hover:bg-sky-100 text-sky-700 font-medium rounded-lg text-[11px] transition-colors"
                              >
                                Thu tiền
                              </button>
                            ) : (
                              <span className="text-[11px] text-gray-400 font-mono">Đã xong</span>
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

          {/* TAB 3: BANK STATEMENT MATCHING */}
          {activeTab === "statement" && (
            <div className="space-y-5">
              <div className="bg-gradient-to-r from-sky-50 to-indigo-50 border border-sky-100 rounded-2xl p-5">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h4 className="font-bold text-gray-900 flex items-center gap-2">
                      <FileSpreadsheet className="text-sky-600" size={18} />
                      Tải lên file Sao Kê Ngân Hàng (Excel hoặc CSV)
                    </h4>
                    <p className="text-xs text-gray-600 mt-1 max-w-xl">
                      Hệ thống tự động phân tích diễn giải sao kê (tìm số đơn hàng INxxxxxx, mã khách hàng, tên KH) và số tiền phát sinh CÓ để khớp với danh sách đơn hàng chuyến xe này.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,.xlsm,.csv"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleUploadStatement(file, false);
                        e.target.value = "";
                      }}
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={matchingFile}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 hover:bg-gray-50 text-gray-800 rounded-xl text-xs font-semibold shadow-sm transition-colors disabled:opacity-50"
                    >
                      <Upload size={14} />
                      {matchingFile ? "Đang xử lý..." : "Xem trước đối soát"}
                    </button>
                    <button
                      onClick={() => {
                        const file = fileInputRef.current?.files?.[0];
                        if (!file) {
                          fileInputRef.current?.click();
                        }
                      }}
                      disabled={matchingFile}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-xs font-semibold shadow-sm transition-colors disabled:opacity-50"
                    >
                      <ShieldCheck size={14} />
                      Tải lên & Tự động quyết toán
                    </button>
                  </div>
                </div>
              </div>

              {/* Match Results Preview */}
              {matchResults && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h5 className="font-semibold text-gray-900 text-sm">
                      Kết quả đối soát ({matchStats?.matched}/{matchStats?.total} giao dịch khớp đơn hàng)
                    </h5>
                    {matchStats && matchStats.matched > 0 && (
                      <button
                        onClick={async () => {
                          // Auto confirm all matched
                          if (!data) return;
                          setMatchingFile(true);
                          try {
                            const unmatchedItems = matchResults
                              .filter((m) => m.matched && !m.already_paid && m.order_id)
                              .map((m) => ({
                                ref_number: m.statement_ref,
                                amount: m.statement_amount,
                                description: m.statement_description,
                              }));
                            if (unmatchedItems.length === 0) {
                              setMessage("Tất cả các giao dịch đã được thanh toán.");
                              return;
                            }
                            const res = await apiFetch(
                              `${API_URL}/delivery-requests/${requestId}/settlement/match-statement`,
                              {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  statements: unmatchedItems,
                                  auto_confirm: true,
                                }),
                              }
                            );
                            const json = await res.json();
                            if (!res.ok) throw new Error(json.detail ?? "Lỗi khi xác nhận.");
                            setMessage(
                              `Đã tự động quyết toán & khấu trừ công nợ cho ${json.auto_confirmed_count} đơn hàng!`
                            );
                            await loadSettlement();
                            onSettled?.();
                          } catch (e) {
                            setError(e instanceof Error ? e.message : "Lỗi khi xác nhận.");
                          } finally {
                            setMatchingFile(false);
                          }
                        }}
                        className="inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition-colors"
                      >
                        <CheckCircle2 size={14} />
                        Xác nhận tất toán các đơn đã khớp
                      </button>
                    )}
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-gray-100 max-h-[400px]">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50/90 text-gray-500 border-b border-gray-100 sticky top-0">
                        <tr>
                          <th className="text-left px-4 py-2.5">Giao dịch sao kê</th>
                          <th className="text-right px-4 py-2.5">Tiền sao kê</th>
                          <th className="text-left px-4 py-2.5">Khớp đơn hàng</th>
                          <th className="text-left px-4 py-2.5">Khách hàng</th>
                          <th className="text-left px-4 py-2.5">NVGH</th>
                          <th className="text-center px-4 py-2.5">Độ tin cậy</th>
                          <th className="text-center px-4 py-2.5">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {matchResults.map((m, idx) => (
                          <tr key={idx} className={m.matched ? "bg-emerald-50/30" : "bg-gray-50/20"}>
                            <td className="px-4 py-2.5 max-w-[280px]">
                              <p className="font-mono text-gray-700 truncate">{m.statement_description}</p>
                              {m.statement_ref && (
                                <p className="text-[10px] text-gray-400 font-mono">Ref: {m.statement_ref}</p>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-right font-bold text-gray-900">
                              {m.statement_amount.toLocaleString("vi-VN")} đ
                            </td>
                            <td className="px-4 py-2.5">
                              {m.matched ? (
                                <span className="font-mono font-semibold text-sky-700">{m.order_number}</span>
                              ) : (
                                <span className="text-gray-400">Không tìm thấy</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-gray-700">
                              {m.customer_name ? (
                                <span>
                                  {m.customer_name} <span className="text-gray-400">({m.customer_code})</span>
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="px-4 py-2.5 font-medium text-gray-900">{m.employee_code || "—"}</td>
                            <td className="px-4 py-2.5 text-center">
                              {m.matched ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                                  {Math.round(m.confidence * 100)}%
                                </span>
                              ) : (
                                <span className="text-gray-400">—</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              {m.already_paid ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
                                  <CheckCircle2 size={12} /> Đã tất toán
                                </span>
                              ) : m.matched ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-600">
                                  Sẵn sàng tất toán
                                </span>
                              ) : (
                                <span className="text-gray-400 text-[11px]">Chưa khớp</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-gray-100 bg-gray-50/50 flex items-center justify-between">
          <p className="text-xs text-gray-500">
            Mọi thanh toán ghi nhận sẽ tự động sinh bút toán đối soát nợ trên sổ cái công nợ tài chính.
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-xl text-xs font-semibold shadow-sm transition-colors"
          >
            Đóng
          </button>
        </div>
      </div>

      {/* Single Order Pay Dialog */}
      {payingOrder && (
        <div className="fixed inset-0 z-60 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <h4 className="font-bold text-gray-900 text-sm">Ghi nhận thanh toán đơn hàng</h4>
              <button onClick={() => setPayingOrder(null)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            <div className="bg-sky-50 rounded-xl p-3 text-xs space-y-1">
              <p className="text-sky-900 font-semibold">Đơn hàng: {payingOrder.order_number}</p>
              <p className="text-sky-800">
                Khách hàng: {payingOrder.customer_name} ({payingOrder.customer_code})
              </p>
              <p className="text-sky-800 font-bold text-sm pt-1">
                Số tiền: {payingOrder.amount.toLocaleString("vi-VN")} đ
              </p>
              <p className="text-sky-700 text-[11px]">
                NVGH: {payingOrder.employee_code} ({payingOrder.employee_name})
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Hình thức thanh toán</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPayMethod("BANK")}
                  className={`flex items-center justify-center gap-2 py-2 px-3 rounded-xl border text-xs font-semibold transition-all ${
                    payMethod === "BANK"
                      ? "border-sky-500 bg-sky-50 text-sky-700 shadow-xs"
                      : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  <CreditCard size={14} /> Chuyển khoản (Bank)
                </button>
                <button
                  type="button"
                  onClick={() => setPayMethod("CASH")}
                  className={`flex items-center justify-center gap-2 py-2 px-3 rounded-xl border text-xs font-semibold transition-all ${
                    payMethod === "CASH"
                      ? "border-indigo-500 bg-indigo-50 text-indigo-700 shadow-xs"
                      : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  <Banknote size={14} /> Tiền mặt (Cash)
                </button>
              </div>
            </div>

            {payMethod === "BANK" && (
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Mã giao dịch / Mã tham chiếu ngân hàng (FT / Ref ID)
                </label>
                <input
                  type="text"
                  placeholder="Ví dụ: FT260908123456 hoặc MB998877"
                  value={payBankRef}
                  onChange={(e) => setPayBankRef(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Ghi chú (tùy chọn)</label>
              <input
                type="text"
                placeholder="Ghi chú thêm..."
                value={payNote}
                onChange={(e) => setPayNote(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setPayingOrder(null)}
                className="px-3 py-2 border border-gray-200 rounded-xl text-xs font-medium text-gray-600 hover:bg-gray-50"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handlePayOrder}
                disabled={submittingPay}
                className="px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-xs font-semibold shadow-sm transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                <ArrowRight size={14} />
                {submittingPay ? "Đang xử lý..." : "Xác nhận & Khấu trừ công nợ"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { API_URL, apiFetch } from "@/lib/api";
import { formatNumber, formatVNDFull } from "@/lib/format";

export interface EligibleOldOrder {
  delivery_request_order_id: number;
  delivery_request_id: number;
  delivery_request_code: string;
  order_number: string;
  order_date: string | null;
  employee_id: number | null;
  employee_code: string;
  employee_name: string | null;
  customer_code: string | null;
  customer_name: string | null;
  amount: number;
  returned_amount: number;
  net_amount: number;
  delivery_status: string;
  payment_status: string;
  item_count: number;
  total_qty: number;
}

export interface EligibleNewOrder {
  order_number: string;
  order_date: string | null;
  customer_code: string | null;
  customer_name: string | null;
  staff_code: string | null;
  staff_name: string | null;
  total_qty: number;
  total_amount: number;
  line_count: number;
  status: string | null;
}

interface ComparisonLine {
  product_id: number;
  sku: string;
  product_name: string;
  boxes_per_carton: number;
  old_qty: number;
  new_qty: number;
  return_qty: number;
  return_cartons: number;
  return_loose_boxes: number;
  old_amount: number;
  new_amount: number;
  unit_price: number;
  return_amount: number;
}

interface ReplacementPreview {
  old_order: EligibleOldOrder;
  new_order: EligibleNewOrder;
  comparison_lines: ComparisonLine[];
  old_amount: number;
  new_amount: number;
  return_amount: number;
  total_old_qty: number;
  total_new_qty: number;
  total_return_qty: number;
  warnings: string[];
  errors: string[];
  can_create: boolean;
}

interface ReplaceOrderReturnModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (createdCode: string) => void;
}

const inputCls =
  "w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-100";

export default function ReplaceOrderReturnModal({
  open,
  onClose,
  onCreated,
}: ReplaceOrderReturnModalProps) {
  const [oldSearch, setOldSearch] = useState("");
  const [oldOrders, setOldOrders] = useState<EligibleOldOrder[]>([]);
  const [loadingOld, setLoadingOld] = useState(false);
  const [selectedOld, setSelectedOld] = useState<EligibleOldOrder | null>(null);

  const [newSearch, setNewSearch] = useState("");
  const [newOrders, setNewOrders] = useState<EligibleNewOrder[]>([]);
  const [loadingNew, setLoadingNew] = useState(false);
  const [selectedNew, setSelectedNew] = useState<EligibleNewOrder | null>(null);

  const [preview, setPreview] = useState<ReplacementPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const fetchOldOrders = useCallback(async (q: string) => {
    setLoadingOld(true);
    try {
      const res = await apiFetch(
        `${API_URL}/delivery-returns/eligible-old-orders?search=${encodeURIComponent(q)}&limit=40`
      );
      if (!res.ok) throw new Error("Không thể tải danh sách đơn cũ đã xuất kho.");
      const data: EligibleOldOrder[] = await res.json();
      setOldOrders(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi tải danh sách đơn cũ.");
    } finally {
      setLoadingOld(false);
    }
  }, []);

  const fetchNewOrders = useCallback(async (q: string, customerCode?: string | null) => {
    setLoadingNew(true);
    try {
      const params = new URLSearchParams({ limit: "40" });
      if (q.trim()) params.set("search", q.trim());
      if (customerCode && customerCode.trim()) params.set("customer_code", customerCode.trim());
      const res = await apiFetch(
        `${API_URL}/delivery-returns/eligible-new-orders?${params.toString()}`
      );
      if (!res.ok) throw new Error("Không thể tải danh sách đơn mới DMS.");
      const data: EligibleNewOrder[] = await res.json();
      setNewOrders(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi tải danh sách đơn mới.");
    } finally {
      setLoadingNew(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setError("");
    setSelectedOld(null);
    setSelectedNew(null);
    setPreview(null);
    setNote("");
    setOldSearch("");
    setNewSearch("");
    void fetchOldOrders("");
    void fetchNewOrders("", null);
  }, [open, fetchOldOrders, fetchNewOrders]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      void fetchOldOrders(oldSearch);
    }, 250);
    return () => clearTimeout(t);
  }, [oldSearch, open, fetchOldOrders]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      void fetchNewOrders(newSearch, selectedOld?.customer_code ?? null);
    }, 250);
    return () => clearTimeout(t);
  }, [newSearch, selectedOld?.customer_code, open, fetchNewOrders]);

  useEffect(() => {
    if (!open || !selectedOld || !selectedNew) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    async function loadPreview() {
      setLoadingPreview(true);
      setError("");
      try {
        const res = await apiFetch(`${API_URL}/delivery-returns/preview-replacement`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            old_delivery_request_order_id: selectedOld!.delivery_request_order_id,
            new_order_number: selectedNew!.order_number,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.detail ?? "Không thể đối chiếu đơn cũ và đơn mới.");
        }
        if (!cancelled) setPreview(data);
      } catch (e) {
        if (!cancelled) {
          setPreview(null);
          setError(e instanceof Error ? e.message : "Lỗi đối chiếu đơn hàng.");
        }
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    }
    void loadPreview();
    return () => {
      cancelled = true;
    };
  }, [open, selectedOld, selectedNew]);

  async function handleSubmit() {
    if (!selectedOld || !selectedNew || !preview?.can_create) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await apiFetch(`${API_URL}/delivery-returns/from-replacement`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          old_delivery_request_order_id: selectedOld.delivery_request_order_id,
          new_order_number: selectedNew.order_number,
          note: note.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail ?? "Không thể tạo lệnh thay thế & yêu cầu trả hàng.");
      }
      onCreated(data.code);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi khi tạo lệnh trả hàng.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col border border-slate-400 bg-white shadow-lg">
        {/* Header - CreateOrderForm standard */}
        <div className="flex items-center justify-between bg-[#14263d] px-3 py-2 text-white">
          <div className="flex items-center gap-2">
            <RefreshCw size={17} className="text-red-500" />
            <h2 className="text-xs font-bold uppercase tracking-wide text-white">
              Thay thế đơn hàng đã xuất kho &amp; Tạo lệnh yêu cầu trả hàng về kho
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-white hover:bg-white/10"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="mx-3 mt-2.5 flex items-center gap-2 rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
              <AlertTriangle size={14} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Step 1 & 2: Chọn Đơn Cũ & Đơn Mới */}
          <div className="grid gap-3 border-b border-slate-200 px-3 py-2.5 lg:grid-cols-2">
            {/* Panel 1: Đơn hàng cũ */}
            <div className="flex flex-col rounded border border-slate-200">
              <div className="border-b border-sky-100 bg-sky-50/60 px-3 py-2 text-[11px] font-bold uppercase text-sky-800">
                1. Chọn đơn hàng cũ (Đã xuất kho, chưa giao thành công)
              </div>
              <div className="p-2.5">
                <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                  Tìm theo số đơn, mã/tên KH, mã NVGH, mã phiếu xuất
                </label>
                <div className="relative mb-2">
                  <Search
                    size={13}
                    className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    type="text"
                    value={oldSearch}
                    onChange={(e) => setOldSearch(e.target.value)}
                    placeholder="Nhập số đơn cũ, tên KH, NVGH..."
                    className={`${inputCls} pl-7`}
                  />
                </div>
                <div className="max-h-48 overflow-y-auto rounded border border-slate-200">
                  {loadingOld ? (
                    <div className="flex items-center justify-center py-6 text-xs text-slate-500">
                      <Loader2 size={14} className="mr-1.5 animate-spin" />
                      Đang tìm đơn cũ đã xuất kho...
                    </div>
                  ) : oldOrders.length === 0 ? (
                    <div className="py-6 text-center text-xs text-slate-400">
                      Không tìm thấy đơn hàng nào đã xuất kho chưa giao thành công.
                    </div>
                  ) : (
                    <table className="w-full border-collapse text-left">
                      <thead className="sticky top-0 bg-slate-100 text-[10px] font-semibold text-slate-600">
                        <tr>
                          <th className="px-2 py-1">Số đơn / Phiếu xuất</th>
                          <th className="px-2 py-1">Khách hàng / NVGH</th>
                          <th className="px-2 py-1 text-right">Giá trị</th>
                        </tr>
                      </thead>
                      <tbody>
                        {oldOrders.map((o) => {
                          const active =
                            selectedOld?.delivery_request_order_id === o.delivery_request_order_id;
                          return (
                            <tr
                              key={o.delivery_request_order_id}
                              onClick={() => {
                                setSelectedOld(o);
                                setSelectedNew(null);
                              }}
                              className={`cursor-pointer border-b border-slate-100 text-[11px] transition-colors ${
                                active
                                  ? "bg-sky-100 font-semibold text-sky-900"
                                  : "even:bg-amber-50/40 hover:bg-sky-50/50"
                              }`}
                            >
                              <td className="px-2 py-1.5">
                                <div className="font-semibold text-slate-800">{o.order_number}</div>
                                <div className="text-[10px] text-slate-500">
                                  {o.delivery_request_code} • {o.order_date ?? "—"}
                                </div>
                              </td>
                              <td className="px-2 py-1.5">
                                <div className="truncate max-w-[180px] text-slate-700">
                                  {o.customer_code ? `[${o.customer_code}] ` : ""}
                                  {o.customer_name || "—"}
                                </div>
                                <div className="text-[10px] text-slate-500">
                                  NVGH: {o.employee_code} {o.employee_name ? `- ${o.employee_name}` : ""}
                                </div>
                              </td>
                              <td className="px-2 py-1.5 text-right font-medium text-slate-700">
                                {formatVNDFull(o.net_amount)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>

            {/* Panel 2: Đơn hàng mới */}
            <div className="flex flex-col rounded border border-slate-200">
              <div className="border-b border-sky-100 bg-sky-50/60 px-3 py-2 text-[11px] font-bold uppercase text-sky-800">
                2. Chọn đơn hàng mới thay thế (Đồng bộ DMS - Chưa xuất kho)
              </div>
              <div className="p-2.5">
                <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                  Tìm theo số đơn mới, mã/tên KH
                  {selectedOld?.customer_code && (
                    <span className="ml-1 font-normal text-sky-700">
                      (Đang ưu tiên KH {selectedOld.customer_code})
                    </span>
                  )}
                </label>
                <div className="relative mb-2">
                  <Search
                    size={13}
                    className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    type="text"
                    value={newSearch}
                    onChange={(e) => setNewSearch(e.target.value)}
                    placeholder="Nhập số đơn mới trên DMS..."
                    className={`${inputCls} pl-7`}
                  />
                </div>
                <div className="max-h-48 overflow-y-auto rounded border border-slate-200">
                  {loadingNew ? (
                    <div className="flex items-center justify-center py-6 text-xs text-slate-500">
                      <Loader2 size={14} className="mr-1.5 animate-spin" />
                      Đang tìm đơn mới trên DMS...
                    </div>
                  ) : newOrders.length === 0 ? (
                    <div className="py-6 text-center text-xs text-slate-400">
                      Không tìm thấy đơn mới phù hợp (chưa xuất kho).
                    </div>
                  ) : (
                    <table className="w-full border-collapse text-left">
                      <thead className="sticky top-0 bg-slate-100 text-[10px] font-semibold text-slate-600">
                        <tr>
                          <th className="px-2 py-1">Số đơn mới / Ngày</th>
                          <th className="px-2 py-1">Khách hàng</th>
                          <th className="px-2 py-1 text-center">SL</th>
                          <th className="px-2 py-1 text-right">Giá trị</th>
                        </tr>
                      </thead>
                      <tbody>
                        {newOrders.map((n) => {
                          const active = selectedNew?.order_number === n.order_number;
                          const sameCust =
                            selectedOld?.customer_code &&
                            n.customer_code &&
                            selectedOld.customer_code.toUpperCase() ===
                              n.customer_code.toUpperCase();
                          return (
                            <tr
                              key={n.order_number}
                              onClick={() => setSelectedNew(n)}
                              className={`cursor-pointer border-b border-slate-100 text-[11px] transition-colors ${
                                active
                                  ? "bg-sky-100 font-semibold text-sky-900"
                                  : "even:bg-amber-50/40 hover:bg-sky-50/50"
                              }`}
                            >
                              <td className="px-2 py-1.5">
                                <div className="font-semibold text-slate-800">{n.order_number}</div>
                                <div className="text-[10px] text-slate-500">
                                  {n.order_date ?? "—"}
                                </div>
                              </td>
                              <td className="px-2 py-1.5">
                                <div className="truncate max-w-[170px] text-slate-700">
                                  {n.customer_code ? `[${n.customer_code}] ` : ""}
                                  {n.customer_name || "—"}
                                </div>
                                {sameCust && (
                                  <span className="inline-block rounded bg-emerald-100 px-1 py-0.2 text-[9px] font-semibold text-emerald-700">
                                    Cùng KH
                                  </span>
                                )}
                              </td>
                              <td className="px-2 py-1.5 text-center font-semibold text-slate-700">
                                {formatNumber(n.total_qty)}
                              </td>
                              <td className="px-2 py-1.5 text-right font-medium text-slate-700">
                                {formatVNDFull(n.total_amount)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Step 3: Đối chiếu chi tiết & Hàng trả về kho */}
          <div className="border-b border-sky-100 bg-sky-50/60 px-3 py-2 text-[11px] font-bold uppercase text-sky-800">
            3. Đối chiếu số lượng &amp; Lệnh yêu cầu trả hàng còn lại về kho
          </div>

          <div className="px-3 py-2.5">
            {!selectedOld || !selectedNew ? (
              <div className="rounded border border-dashed border-slate-300 bg-slate-50 py-6 text-center text-xs text-slate-500">
                Vui lòng chọn cả <strong>Đơn hàng cũ</strong> và <strong>Đơn hàng mới thay thế</strong> ở trên để hệ thống tự động tính phần hàng chênh lệch cần trả về kho.
              </div>
            ) : loadingPreview ? (
              <div className="flex items-center justify-center py-8 text-xs text-slate-500">
                <Loader2 size={16} className="mr-2 animate-spin text-sky-600" />
                Đang đối chiếu SKU giữa đơn cũ và đơn mới...
              </div>
            ) : preview ? (
              <div className="space-y-2.5">
                {/* Banner liên kết & Tổng hợp tiền */}
                <div className="grid gap-2 sm:grid-cols-4">
                  <div className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                    <div className="text-[10px] font-semibold text-slate-500">Liên kết thay thế</div>
                    <div className="mt-0.5 flex items-center gap-1 text-xs font-bold text-slate-800">
                      <span>{preview.old_order.order_number}</span>
                      <ArrowRight size={12} className="text-sky-600" />
                      <span className="text-sky-700">{preview.new_order.order_number}</span>
                    </div>
                    <div className="text-[10px] text-slate-500">
                      NVGH: {preview.old_order.employee_code}
                    </div>
                  </div>
                  <div className="rounded border border-slate-200 bg-white px-2.5 py-1.5">
                    <div className="text-[10px] font-semibold text-slate-500">Giá trị đơn cũ (Đã xuất)</div>
                    <div className="mt-0.5 text-sm font-bold text-slate-800">
                      {formatVNDFull(preview.old_amount)}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Tổng SL: {formatNumber(preview.total_old_qty)}
                    </div>
                  </div>
                  <div className="rounded border border-emerald-200 bg-emerald-50/50 px-2.5 py-1.5">
                    <div className="text-[10px] font-semibold text-emerald-700">Giá trị đơn mới (Thực giao)</div>
                    <div className="mt-0.5 text-sm font-bold text-emerald-700">
                      {formatVNDFull(preview.new_amount)}
                    </div>
                    <div className="text-[10px] text-emerald-600">
                      Tổng SL: {formatNumber(preview.total_new_qty)}
                    </div>
                  </div>
                  <div className="rounded border border-rose-200 bg-rose-50/60 px-2.5 py-1.5">
                    <div className="text-[10px] font-semibold text-rose-700">
                      Trả về kho (Giảm CN khi kho nhận)
                    </div>
                    <div className="mt-0.5 text-sm font-bold text-rose-700">
                      {formatVNDFull(preview.return_amount)}
                    </div>
                    <div className="text-[10px] text-rose-600">
                      SL trả kho: {formatNumber(preview.total_return_qty)}
                    </div>
                  </div>
                </div>

                {/* Errors & Warnings */}
                {preview.errors.length > 0 && (
                  <div className="rounded border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">
                    <div className="font-bold">Không thể tạo lệnh trả hàng:</div>
                    <ul className="mt-1 list-disc pl-4 space-y-0.5">
                      {preview.errors.map((err, idx) => (
                        <li key={idx}>{err}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {preview.warnings.length > 0 && (
                  <div className="rounded border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
                    <div className="font-bold">Cảnh báo kiểm tra:</div>
                    <ul className="mt-1 list-disc pl-4 space-y-0.5">
                      {preview.warnings.map((w, idx) => (
                        <li key={idx}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Bảng đối chiếu SKU */}
                <div className="overflow-x-auto rounded border border-slate-200">
                  <table className="w-full border-collapse text-left">
                    <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600">
                      <tr>
                        <th className="px-2 py-1.5">Mã NPP</th>
                        <th className="px-2 py-1.5">Sản phẩm</th>
                        <th className="px-2 py-1.5 text-center">SL Đơn cũ</th>
                        <th className="px-2 py-1.5 text-center">SL Đơn mới</th>
                        <th className="px-2 py-1.5 text-center text-rose-700">SL Trả kho</th>
                        <th className="px-2 py-1.5 text-center">Quy đổi (Thùng/Lẻ)</th>
                        <th className="px-2 py-1.5 text-right">Đơn giá</th>
                        <th className="px-2 py-1.5 text-right">Tiền trả kho</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.comparison_lines.map((ln) => (
                        <tr
                          key={ln.product_id}
                          className="border-b border-slate-100 text-[11px] even:bg-amber-50/40 hover:bg-sky-50/50"
                        >
                          <td className="px-2 py-1.5 font-mono font-semibold text-slate-700">
                            {ln.sku}
                          </td>
                          <td className="px-2 py-1.5 text-slate-800">{ln.product_name}</td>
                          <td className="px-2 py-1.5 text-center font-semibold text-slate-700">
                            {formatNumber(ln.old_qty)}
                          </td>
                          <td className="px-2 py-1.5 text-center font-semibold text-emerald-700">
                            {formatNumber(ln.new_qty)}
                          </td>
                          <td className="px-2 py-1.5 text-center font-bold text-rose-600">
                            {ln.return_qty > 0 ? formatNumber(ln.return_qty) : "—"}
                          </td>
                          <td className="px-2 py-1.5 text-center text-slate-600">
                            {ln.return_qty > 0
                              ? `${ln.return_cartons}T ${ln.return_loose_boxes}L`
                              : "—"}
                          </td>
                          <td className="px-2 py-1.5 text-right font-medium text-slate-700">
                            {formatVNDFull(ln.unit_price)}
                          </td>
                          <td className="px-2 py-1.5 text-right font-semibold text-rose-600">
                            {ln.return_qty > 0 ? formatVNDFull(ln.return_amount) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t border-slate-200 bg-slate-50 text-[10px] font-semibold text-slate-600">
                      <tr>
                        <td colSpan={2} className="px-2 py-1.5 uppercase">
                          Tổng cộng
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          {formatNumber(preview.total_old_qty)}
                        </td>
                        <td className="px-2 py-1.5 text-center text-emerald-700">
                          {formatNumber(preview.total_new_qty)}
                        </td>
                        <td className="px-2 py-1.5 text-center text-rose-700">
                          {formatNumber(preview.total_return_qty)}
                        </td>
                        <td />
                        <td />
                        <td className="px-2 py-1.5 text-right text-rose-700">
                          {formatVNDFull(preview.return_amount)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Ghi chú */}
                <div>
                  <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                    Ghi chú lệnh trả hàng (tùy chọn)
                  </label>
                  <input
                    type="text"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="VD: Khách chỉ nhận một phần, NVBH đã bấm đơn mới trên DMS..."
                    className={inputCls}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Footer - CreateOrderForm standard */}
        <div className="flex items-center justify-between gap-3 border-t border-slate-300 bg-slate-100 px-3 py-2">
          <span className="text-[10px] text-slate-500">
            Lệnh trả hàng tạo ở trạng thái <strong>Chờ thủ kho nhận</strong> — công nợ NVGH chỉ giảm sau khi thủ kho xác nhận nhận đủ hàng.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded bg-red-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-800"
            >
              Đóng
            </button>
            <button
              type="button"
              disabled={!preview?.can_create || submitting}
              onClick={handleSubmit}
              className="inline-flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {submitting ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <CheckCircle2 size={13} />
              )}
              Tạo lệnh thay thế &amp; Yêu cầu trả kho
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

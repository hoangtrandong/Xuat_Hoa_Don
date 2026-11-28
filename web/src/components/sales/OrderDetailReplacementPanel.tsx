"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
} from "lucide-react";
import { API_URL, apiFetch } from "@/lib/api";
import { formatNumber, formatVNDFull } from "@/lib/format";

interface EligibleOldOrder {
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
}

interface OldOrderContext {
  eligible: boolean;
  reason: string | null;
  old_order: EligibleOldOrder | null;
  existing_return_code: string | null;
  existing_return_status: string | null;
  existing_replacement_order_number: string | null;
}

interface EligibleNewOrder {
  order_number: string;
  order_date: string | null;
  customer_code: string | null;
  customer_name: string | null;
  total_qty: number;
  total_amount: number;
  line_count: number;
}

interface NewOrderLineDetail {
  product_id: number | null;
  sku: string;
  product_name: string;
  quantity: number;
  promo_quantity: number;
  total_qty: number;
  unit_price: number;
  amount: number;
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
  new_order_lines: NewOrderLineDetail[];
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

interface OrderDetailReplacementPanelProps {
  orderNumber: string;
  customerCode?: string;
  onConfirmed?: (info: {
    returnCode: string;
    oldOrderNumber: string;
    newOrderNumber: string;
  }) => void;
}

const inputCls =
  "w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-100";

export default function OrderDetailReplacementPanel({
  orderNumber,
  customerCode,
  onConfirmed,
}: OrderDetailReplacementPanelProps) {
  const [context, setContext] = useState<OldOrderContext | null>(null);
  const [loadingContext, setLoadingContext] = useState(true);

  const [newOrderInput, setNewOrderInput] = useState("");
  const [suggestions, setSuggestions] = useState<EligibleNewOrder[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  const [preview, setPreview] = useState<ReplacementPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState("");

  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [createdInfo, setCreatedInfo] = useState<{
    code: string;
    newOrderNumber: string;
  } | null>(null);

  const loadContext = useCallback(async () => {
    setLoadingContext(true);
    setPreview(null);
    setPreviewError("");
    setNewOrderInput("");
    setNote("");
    setCreatedInfo(null);
    try {
      const res = await apiFetch(
        `${API_URL}/delivery-returns/old-order-context/${encodeURIComponent(orderNumber)}`
      );
      if (!res.ok) {
        setContext(null);
        return;
      }
      const data: OldOrderContext = await res.json();
      setContext(data);
    } catch {
      setContext(null);
    } finally {
      setLoadingContext(false);
    }
  }, [orderNumber]);

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  const fetchSuggestions = useCallback(
    async (q: string) => {
      if (!context?.eligible) return;
      setLoadingSuggestions(true);
      try {
        const params = new URLSearchParams({ limit: "20" });
        if (q.trim()) params.set("search", q.trim());
        const cust = context.old_order?.customer_code || customerCode;
        if (cust && cust.trim()) params.set("customer_code", cust.trim());
        const res = await apiFetch(
          `${API_URL}/delivery-returns/eligible-new-orders?${params.toString()}`
        );
        if (res.ok) {
          const data: EligibleNewOrder[] = await res.json();
          setSuggestions(data);
        }
      } finally {
        setLoadingSuggestions(false);
      }
    },
    [context?.eligible, context?.old_order?.customer_code, customerCode]
  );

  useEffect(() => {
    if (!context?.eligible) return;
    const t = setTimeout(() => {
      void fetchSuggestions(newOrderInput);
    }, 250);
    return () => clearTimeout(t);
  }, [newOrderInput, context?.eligible, fetchSuggestions]);

  const runPreview = useCallback(
    async (targetNewOrder: string) => {
      const trimmed = targetNewOrder.trim();
      if (!trimmed || !context?.old_order) {
        setPreview(null);
        setPreviewError("");
        return;
      }
      setLoadingPreview(true);
      setPreviewError("");
      try {
        const res = await apiFetch(`${API_URL}/delivery-returns/preview-replacement`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            old_delivery_request_order_id: context.old_order.delivery_request_order_id,
            old_order_number: orderNumber,
            new_order_number: trimmed,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.detail ?? "Không tìm thấy đơn hàng mới hoặc không thể đối chiếu.");
        }
        setPreview(data);
      } catch (e) {
        setPreview(null);
        setPreviewError(e instanceof Error ? e.message : "Lỗi kiểm tra đơn thay thế.");
      } finally {
        setLoadingPreview(false);
      }
    },
    [context?.old_order, orderNumber]
  );

  async function handleConfirmReplacement() {
    if (!preview?.can_create || !context?.old_order) return;
    setSubmitting(true);
    setPreviewError("");
    try {
      const res = await apiFetch(`${API_URL}/delivery-returns/from-replacement`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          old_delivery_request_order_id: context.old_order.delivery_request_order_id,
          old_order_number: orderNumber,
          new_order_number: preview.new_order.order_number,
          note: note.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail ?? "Không thể xác nhận thay thế & tạo lệnh trả hàng.");
      }
      setCreatedInfo({
        code: data.code,
        newOrderNumber: preview.new_order.order_number,
      });
      onConfirmed?.({
        returnCode: data.code,
        oldOrderNumber: orderNumber,
        newOrderNumber: preview.new_order.order_number,
      });
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : "Lỗi xác nhận thay thế đơn.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingContext) return null;
  if (!context) return null;

  // Nếu đơn này đã từng được thay thế bằng đơn mới -> hiển thị banner thông tin + link tới UI Trả hàng
  if (!context.eligible && context.existing_return_code) {
    return (
      <div className="overflow-hidden border border-sky-300 bg-white">
        <div className="flex items-center justify-between border-b border-sky-100 bg-sky-50/80 px-3 py-1.5">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase text-sky-800">
            <RotateCcw size={13} />
            Đã gán đơn thay thế &amp; tạo lệnh trả hàng về kho
          </span>
          <Link
            href="/sales/returns"
            className="inline-flex items-center gap-1 rounded bg-sky-600 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-sky-700"
          >
            Mở UI Trả hàng <ExternalLink size={10} />
          </Link>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs text-slate-700">
          <div className="flex items-center gap-1.5">
            <span>Đơn cũ <strong>{orderNumber}</strong></span>
            <ArrowRight size={12} className="text-sky-600" />
            <span>Đơn thay thế <strong className="text-sky-700">{context.existing_replacement_order_number}</strong></span>
            <span className="text-slate-400">•</span>
            <span>Phiếu trả kho: <strong>{context.existing_return_code}</strong></span>
          </div>
          <span
            className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
              context.existing_return_status === "PENDING_WAREHOUSE"
                ? "bg-amber-100 text-amber-800"
                : "bg-emerald-100 text-emerald-700"
            }`}
          >
            {context.existing_return_status === "PENDING_WAREHOUSE"
              ? "Chờ thủ kho xác nhận nhận hàng"
              : "Thủ kho đã nhận - Đã giảm công nợ"}
          </span>
        </div>
      </div>
    );
  }

  // Nếu đơn chưa xuất kho hoặc đã giao thành công rồi -> không hiển thị khung gán thay thế
  if (!context.eligible || !context.old_order) return null;

  const returnLines = (preview?.comparison_lines ?? []).filter((ln) => ln.return_qty > 0);

  return (
    <div className="overflow-hidden border border-slate-300 bg-white">
      <div className="flex items-center justify-between border-b border-sky-100 bg-sky-50/60 px-3 py-1.5">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase text-sky-800">
          <RefreshCw size={13} className="text-red-500" />
          Gán đơn hàng thay thế (Giao 1 phần) &amp; Tạo lệnh trả hàng về kho
        </span>
        <span className="text-[10px] font-semibold text-slate-500">
          PXK: {context.old_order.delivery_request_code} • NVGH: {context.old_order.employee_code}
        </span>
      </div>

      <div className="space-y-3 px-3 py-2.5">
        {createdInfo ? (
          <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 size={15} className="text-emerald-600" />
                <span>
                  Đã xác nhận thay thế đơn <strong>{orderNumber}</strong> (Giao 1 phần) bằng đơn{" "}
                  <strong>{createdInfo.newOrderNumber}</strong> (Đã giao) và tạo lệnh trả kho{" "}
                  <strong>{createdInfo.code}</strong>!
                </span>
              </div>
              <Link
                href="/sales/returns"
                className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700"
              >
                Xem tại UI Trả hàng <ExternalLink size={11} />
              </Link>
            </div>
            <p className="mt-1 text-[11px] text-emerald-700">
              Lệnh trả hàng đang ở trạng thái <strong>Chờ thủ kho nhận</strong>. Sau khi thủ kho xác nhận nhận đủ hàng, hệ thống sẽ tự động cộng tồn kho và giảm công nợ cho NVGH {context.old_order.employee_code}.
            </p>
          </div>
        ) : (
          <>
            {/* Trường nhập mã đơn hàng thay thế */}
            <div className="grid gap-2 sm:grid-cols-12 sm:items-end">
              <div className="relative sm:col-span-9">
                <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                  Nhập mã đơn hàng thay thế (Đơn mới trên DMS chưa xuất kho)
                </label>
                <div className="relative">
                  <Search
                    size={13}
                    className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    type="text"
                    value={newOrderInput}
                    onFocus={() => setShowSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 180)}
                    onChange={(e) => {
                      setNewOrderInput(e.target.value);
                      setShowSuggestions(true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        setShowSuggestions(false);
                        void runPreview(newOrderInput);
                      }
                    }}
                    placeholder="Nhập mã đơn mới (VD: SO...) hoặc chọn từ gợi ý bên dưới..."
                    className={`${inputCls} pl-7`}
                  />
                </div>

                {/* Dropdown gợi ý đơn mới */}
                {showSuggestions && (loadingSuggestions || suggestions.length > 0) && (
                  <div className="absolute left-0 right-0 z-30 mt-1 max-h-48 overflow-y-auto rounded border border-slate-300 bg-white shadow-lg">
                    {loadingSuggestions ? (
                      <div className="flex items-center gap-1.5 px-2.5 py-2 text-[11px] text-slate-500">
                        <Loader2 size={12} className="animate-spin" /> Đang tìm đơn mới DMS...
                      </div>
                    ) : (
                      suggestions.map((s) => {
                        const sameCust =
                          context.old_order?.customer_code &&
                          s.customer_code &&
                          context.old_order.customer_code.toUpperCase() ===
                            s.customer_code.toUpperCase();
                        return (
                          <button
                            key={s.order_number}
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setNewOrderInput(s.order_number);
                              setShowSuggestions(false);
                              void runPreview(s.order_number);
                            }}
                            className="flex w-full items-center justify-between border-b border-slate-100 px-2.5 py-1.5 text-left text-[11px] hover:bg-sky-50"
                          >
                            <div>
                              <span className="font-bold text-slate-800">{s.order_number}</span>
                              {sameCust && (
                                <span className="ml-1.5 rounded bg-emerald-100 px-1 py-0.5 text-[9px] font-semibold text-emerald-700">
                                  Cùng KH
                                </span>
                              )}
                              <div className="text-[10px] text-slate-500">
                                {s.order_date ?? "—"} • {s.customer_code ? `[${s.customer_code}] ` : ""}
                                {s.customer_name || "—"}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-semibold text-slate-800">
                                {formatVNDFull(s.total_amount)}
                              </div>
                              <div className="text-[10px] text-slate-500">
                                SL: {formatNumber(s.total_qty)}
                              </div>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>

              <div className="sm:col-span-3">
                <button
                  type="button"
                  disabled={!newOrderInput.trim() || loadingPreview}
                  onClick={() => void runPreview(newOrderInput)}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {loadingPreview ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Search size={13} />
                  )}
                  Kiểm tra đơn mới
                </button>
              </div>
            </div>

            {previewError && (
              <div className="flex items-center gap-2 rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
                <AlertTriangle size={14} className="shrink-0" />
                <span>{previewError}</span>
              </div>
            )}

            {preview && (
              <div className="space-y-3">
                {/* Cảnh báo & Lỗi */}
                {preview.errors.length > 0 && (
                  <div className="rounded border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">
                    <div className="font-bold">Không thể gán thay thế:</div>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4">
                      {preview.errors.map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {preview.warnings.length > 0 && (
                  <div className="rounded border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
                    <div className="font-bold">Lưu ý kiểm tra:</div>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4">
                      {preview.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* VÙNG 1: Chi tiết sản phẩm & số lượng của ĐƠN MỚI */}
                <div className="overflow-hidden rounded border border-emerald-200 bg-white">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-100 bg-emerald-50/70 px-3 py-1.5">
                    <span className="text-[11px] font-bold uppercase text-emerald-800">
                      Thông tin sản phẩm chi tiết đơn mới: {preview.new_order.order_number} ({preview.new_order_lines.length} dòng)
                    </span>
                    <span className="text-[11px] font-bold text-emerald-700">
                      Tổng thực giao: {formatNumber(preview.total_new_qty)} SP · {formatVNDFull(preview.new_amount)}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left">
                      <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600">
                        <tr>
                          <th className="px-2 py-1">Mã SP</th>
                          <th className="px-2 py-1">Tên sản phẩm</th>
                          <th className="px-2 py-1 text-center">SL Bán</th>
                          <th className="px-2 py-1 text-center">SL KM</th>
                          <th className="px-2 py-1 text-center">Tổng SL</th>
                          <th className="px-2 py-1 text-right">Đơn giá</th>
                          <th className="px-2 py-1 text-right">Thành tiền</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.new_order_lines.map((ln, idx) => (
                          <tr
                            key={`${ln.sku}-${idx}`}
                            className="border-b border-slate-100 text-[11px] even:bg-amber-50/40 hover:bg-sky-50/50"
                          >
                            <td className="px-2 py-1 font-mono font-semibold text-slate-700">
                              {ln.sku}
                            </td>
                            <td className="px-2 py-1 text-slate-800">{ln.product_name}</td>
                            <td className="px-2 py-1 text-center font-semibold text-slate-700">
                              {formatNumber(ln.quantity)}
                            </td>
                            <td className="px-2 py-1 text-center text-emerald-700">
                              {ln.promo_quantity > 0 ? formatNumber(ln.promo_quantity) : "—"}
                            </td>
                            <td className="px-2 py-1 text-center font-bold text-emerald-700">
                              {formatNumber(ln.total_qty)}
                            </td>
                            <td className="px-2 py-1 text-right text-slate-700">
                              {formatVNDFull(ln.unit_price)}
                            </td>
                            <td className="px-2 py-1 text-right font-semibold text-slate-800">
                              {formatVNDFull(ln.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* VÙNG 2 (Phía dưới): Danh sách các hàng cần trả lại kho */}
                <div className="overflow-hidden rounded border border-rose-200 bg-white">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rose-100 bg-rose-50/70 px-3 py-1.5">
                    <span className="text-[11px] font-bold uppercase text-rose-800">
                      Danh sách hàng cần trả lại kho ({returnLines.length} sản phẩm)
                    </span>
                    <span className="text-[11px] font-bold text-rose-700">
                      Tổng trả kho: {formatNumber(preview.total_return_qty)} SP · Giảm CN dự kiến:{" "}
                      {formatVNDFull(preview.return_amount)}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left">
                      <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600">
                        <tr>
                          <th className="px-2 py-1">Mã NPP</th>
                          <th className="px-2 py-1">Tên sản phẩm</th>
                          <th className="px-2 py-1 text-center">SL Đơn cũ</th>
                          <th className="px-2 py-1 text-center">SL Đơn mới</th>
                          <th className="px-2 py-1 text-center text-rose-700">SL Trả kho</th>
                          <th className="px-2 py-1 text-center">Thùng / Lẻ</th>
                          <th className="px-2 py-1 text-right">Đơn giá</th>
                          <th className="px-2 py-1 text-right">Tiền trả kho</th>
                        </tr>
                      </thead>
                      <tbody>
                        {returnLines.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="px-2 py-4 text-center text-xs text-slate-400">
                              Không có sản phẩm chênh lệch cần trả về kho.
                            </td>
                          </tr>
                        ) : (
                          returnLines.map((ln) => (
                            <tr
                              key={ln.product_id}
                              className="border-b border-slate-100 text-[11px] even:bg-amber-50/40 hover:bg-sky-50/50"
                            >
                              <td className="px-2 py-1 font-mono font-semibold text-slate-700">
                                {ln.sku}
                              </td>
                              <td className="px-2 py-1 text-slate-800">{ln.product_name}</td>
                              <td className="px-2 py-1 text-center font-semibold text-slate-700">
                                {formatNumber(ln.old_qty)}
                              </td>
                              <td className="px-2 py-1 text-center font-semibold text-emerald-700">
                                {formatNumber(ln.new_qty)}
                              </td>
                              <td className="px-2 py-1 text-center font-bold text-rose-600">
                                {formatNumber(ln.return_qty)}
                              </td>
                              <td className="px-2 py-1 text-center text-slate-600">
                                {ln.return_cartons}T {ln.return_loose_boxes}L
                              </td>
                              <td className="px-2 py-1 text-right text-slate-700">
                                {formatVNDFull(ln.unit_price)}
                              </td>
                              <td className="px-2 py-1 text-right font-semibold text-rose-600">
                                {formatVNDFull(ln.return_amount)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                      {returnLines.length > 0 && (
                        <tfoot className="border-t border-slate-200 bg-slate-50 text-[10px] font-semibold text-slate-600">
                          <tr>
                            <td colSpan={4} className="px-2 py-1.5 uppercase">
                              Tổng cộng hàng trả về kho
                            </td>
                            <td className="px-2 py-1.5 text-center font-bold text-rose-700">
                              {formatNumber(preview.total_return_qty)}
                            </td>
                            <td colSpan={2} />
                            <td className="px-2 py-1.5 text-right font-bold text-rose-700">
                              {formatVNDFull(preview.return_amount)}
                            </td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </div>

                {/* Ghi chú & Nút Xác nhận */}
                <div className="flex flex-wrap items-end justify-between gap-2 border-t border-slate-200 pt-2">
                  <div className="min-w-[220px] flex-1">
                    <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                      Ghi chú (tùy chọn)
                    </label>
                    <input
                      type="text"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="VD: Khách chỉ nhận 1 phần, NVBH đã lên đơn mới..."
                      className={inputCls}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={!preview.can_create || submitting}
                    onClick={() => void handleConfirmReplacement()}
                    className="inline-flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {submitting ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <CheckCircle2 size={13} />
                    )}
                    Xác nhận thay thế &amp; Tạo lệnh trả hàng về kho
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

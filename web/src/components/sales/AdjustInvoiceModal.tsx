"use client";

import { useState } from "react";
import { CheckCircle2, FileWarning, Loader2, X } from "lucide-react";
import { API_URL, apiFetch } from "@/lib/api";
import { formatVND } from "@/lib/format";

export interface AdjustableInvoiceItem {
  id?: number;
  line_number: number;
  product_code: string;
  product_name: string;
  unit_name: string;
  quantity: number;
  unit_price: number;
  vat_rate: number;
  amount_before_tax: number;
}

export interface AdjustableInvoice {
  id: number;
  invoice_series: string;
  invoice_number: string;
  buyer_name: string;
  buyer_tax_code: string;
  items: AdjustableInvoiceItem[];
}

const inputCls =
  "w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500";

export default function AdjustInvoiceModal({
  invoice,
  onClose,
  onSuccess,
}: {
  invoice: AdjustableInvoice;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const [mode, setMode] = useState<"ADJUSTMENT" | "REPLACEMENT">("ADJUSTMENT");
  const [reason, setReason] = useState("Khách hàng trả lại hàng theo phiếu trả hàng");
  const [returnRef, setReturnRef] = useState("");
  const [qtys, setQtys] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {};
    invoice.items.forEach((it) => {
      init[it.line_number] = "0";
    });
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function switchMode(nextMode: "ADJUSTMENT" | "REPLACEMENT") {
    setMode(nextMode);
    const next: Record<number, string> = {};
    invoice.items.forEach((it) => {
      next[it.line_number] = nextMode === "REPLACEMENT" ? String(it.quantity) : "0";
    });
    setQtys(next);
  }

  const previewLines = invoice.items
    .map((it) => {
      const q = Math.max(0, Number(qtys[it.line_number] || 0));
      const signedQty = mode === "ADJUSTMENT" ? -q : q;
      const amt = Math.round(signedQty * Number(it.unit_price || 0) * 100) / 100;
      const vat = Math.round(((amt * Number(it.vat_rate || 0)) / 100) * 100) / 100;
      return { it, q, signedQty, amt, vat, total: amt + vat };
    })
    .filter((x) => x.q > 0);

  const totalAmt = previewLines.reduce((s, x) => s + x.amt, 0);
  const totalVat = previewLines.reduce((s, x) => s + x.vat, 0);
  const totalPay = previewLines.reduce((s, x) => s + x.total, 0);

  async function submit() {
    setError("");
    if (!reason.trim()) {
      setError("Vui lòng nhập lý do điều chỉnh / thay thế theo quy định NĐ 123.");
      return;
    }
    if (previewLines.length === 0) {
      setError("Vui lòng nhập số lượng > 0 cho ít nhất 1 dòng hàng.");
      return;
    }
    setSaving(true);
    try {
      const resp = await apiFetch(`${API_URL}/einvoice/issued/${invoice.id}/adjust-or-replace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          reason: reason.trim(),
          return_reference: returnRef.trim() || null,
          items: previewLines.map((x) => ({
            parent_item_id: x.it.id ?? null,
            product_code: x.it.product_code,
            product_name: x.it.product_name,
            unit_name: x.it.unit_name,
            quantity: x.q,
            unit_price: x.it.unit_price,
            vat_rate: x.it.vat_rate,
          })),
        }),
      });
      const data = (await resp.json().catch(() => ({}))) as { detail?: string; id?: number };
      if (!resp.ok) throw new Error(data.detail || "Không thể lập hóa đơn điều chỉnh/thay thế.");
      onSuccess(
        mode === "ADJUSTMENT"
          ? `Đã lập Hóa đơn Điều chỉnh giảm #${data.id} cho HĐ ${invoice.invoice_number} và hoàn tồn kho thuế.`
          : `Đã lập Hóa đơn Thay thế #${data.id} cho HĐ ${invoice.invoice_number}.`,
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi khi lập hóa đơn điều chỉnh/thay thế.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-4xl border border-slate-400 bg-white shadow-lg max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-[#14263d] px-3 py-2 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <FileWarning size={17} className="text-red-500" />
            <span className="text-xs font-bold uppercase tracking-wide text-white">
              Điều Chỉnh Giảm / Thay Thế Hóa Đơn (NĐ 123) · HĐ {invoice.invoice_series}-{invoice.invoice_number}
            </span>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-white hover:bg-white/10">
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          <div className="border-b border-slate-200 px-3 py-2.5 grid gap-x-3 gap-y-2 sm:grid-cols-2 xl:grid-cols-4">
            <div className="sm:col-span-2">
              <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                Nghiệp vụ xử lý hóa đơn (NĐ 123 / TT 78)
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => switchMode("ADJUSTMENT")}
                  className={`rounded border px-2 py-1 text-xs font-semibold transition-colors ${
                    mode === "ADJUSTMENT"
                      ? "border-sky-600 bg-sky-600 text-white"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  Điều chỉnh giảm (Trả hàng)
                </button>
                <button
                  type="button"
                  onClick={() => switchMode("REPLACEMENT")}
                  className={`rounded border px-2 py-1 text-xs font-semibold transition-colors ${
                    mode === "REPLACEMENT"
                      ? "border-sky-600 bg-sky-600 text-white"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  Thay thế toàn phần
                </button>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                Mã phiếu trả hàng / Tham chiếu
              </label>
              <input
                value={returnRef}
                onChange={(e) => setReturnRef(e.target.value)}
                placeholder="VD: TH-20261121-01"
                className={inputCls}
              />
            </div>

            <div>
              <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                Khách hàng trên HĐ gốc
              </label>
              <input disabled value={invoice.buyer_name} className={inputCls} />
            </div>

            <div className="sm:col-span-2 xl:col-span-4">
              <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                Lý do điều chỉnh / thay thế <span className="text-red-600">*</span>
              </label>
              <input
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Nhập lý do rõ ràng theo quy định NĐ 123..."
                className={inputCls}
              />
            </div>
          </div>

          <div className="border-b border-sky-100 bg-sky-50/60 px-3 py-2 text-[11px] font-bold text-sky-800 uppercase">
            {mode === "ADJUSTMENT"
              ? "Nhập số lượng hàng trả lại (Hệ thống tự sinh dòng âm & hoàn tồn kho thuế)"
              : "Nhập số lượng mới sau khi trừ hàng trả lại (Hóa đơn gốc sẽ chuyển trạng thái Đã thay thế)"}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600 uppercase">
                <tr className="border-b border-slate-200">
                  <th className="px-2.5 py-2">Mã SP</th>
                  <th className="px-2.5 py-2">Tên hàng hóa</th>
                  <th className="px-2 py-2 text-center">ĐVT</th>
                  <th className="px-2 py-2 text-center">SL gốc</th>
                  <th className="px-2 py-2 text-center w-28">
                    {mode === "ADJUSTMENT" ? "SL trả lại" : "SL mới"}
                  </th>
                  <th className="px-2.5 py-2 text-right">Đơn giá</th>
                  <th className="px-2.5 py-2 text-right">Tiền sau ĐC</th>
                </tr>
              </thead>
              <tbody>
                {invoice.items.map((it) => {
                  const q = Math.max(0, Number(qtys[it.line_number] || 0));
                  const signedQty = mode === "ADJUSTMENT" ? -q : q;
                  const amt = signedQty * Number(it.unit_price || 0);
                  return (
                    <tr
                      key={it.line_number}
                      className="border-b border-slate-100 even:bg-amber-50/40 hover:bg-sky-50/50 text-[11px]"
                    >
                      <td className="px-2.5 py-1.5 font-mono font-bold text-sky-800">{it.product_code}</td>
                      <td className="px-2.5 py-1.5 text-slate-800">{it.product_name}</td>
                      <td className="px-2 py-1.5 text-center">{it.unit_name}</td>
                      <td className="px-2 py-1.5 text-center font-semibold text-slate-600">{it.quantity}</td>
                      <td className="px-2 py-1.5 text-center">
                        <input
                          type="number"
                          min={0}
                          max={mode === "ADJUSTMENT" ? it.quantity : undefined}
                          step="any"
                          value={qtys[it.line_number] ?? "0"}
                          onChange={(e) => setQtys({ ...qtys, [it.line_number]: e.target.value })}
                          className={`${inputCls} text-center font-semibold`}
                        />
                      </td>
                      <td className="px-2.5 py-1.5 text-right">{formatVND(it.unit_price)}</td>
                      <td
                        className={`px-2.5 py-1.5 text-right font-bold ${
                          amt < 0 ? "text-red-700" : "text-slate-800"
                        }`}
                      >
                        {formatVND(amt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-700">
                <tr>
                  <td colSpan={6} className="px-2.5 py-2 text-right">
                    Tổng trước thuế / VAT / Thanh toán:
                  </td>
                  <td className="px-2.5 py-2 text-right font-bold text-sky-800 whitespace-nowrap">
                    {formatVND(totalAmt)} + {formatVND(totalVat)} = {formatVND(totalPay)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {error && (
            <div className="mx-3 my-2 rounded border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="border-t border-slate-300 bg-slate-100 px-3 py-2 flex items-center justify-between gap-3 shrink-0">
          <span className="text-[10px] text-slate-500">
            Hóa đơn mới sẽ tạo ở trạng thái Nháp (DRAFT) và tự động cập nhật Sổ Tồn kho Thuế theo đúng MST.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded bg-red-700 hover:bg-red-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
            >
              Đóng
            </button>
            <button
              type="button"
              disabled={saving || previewLines.length === 0}
              onClick={() => void submit()}
              className="inline-flex items-center gap-1.5 rounded bg-sky-600 hover:bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
              {mode === "ADJUSTMENT" ? "Lập HĐ Điều chỉnh giảm" : "Lập HĐ Thay thế"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Banknote, CheckCircle2, Loader2, X } from "lucide-react";
import { API_URL, apiFetch } from "@/lib/api";
import { formatVNDFull } from "@/lib/format";

export interface CashReceiptTarget {
  partyType: "EMPLOYEE" | "STORE";
  partyId: number;
  code: string;
  name: string;
  currentDebt: number;
}

interface CashReceiptModalProps {
  target: CashReceiptTarget | null;
  onClose: () => void;
  onCreated: (message: string) => void;
}

const inputCls =
  "w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-100";

export default function CashReceiptModal({
  target,
  onClose,
  onCreated,
}: CashReceiptModalProps) {
  const [amountStr, setAmountStr] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!target) return;
    setAmountStr(target.currentDebt > 0 ? String(Math.round(target.currentDebt)) : "");
    setNote("");
    setError("");
  }, [target]);

  if (!target) return null;

  const parsedAmount = Number(amountStr.replace(/[,\s]/g, "")) || 0;
  const remainingAfter = target.currentDebt - parsedAmount;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!target) return;
    if (parsedAmount <= 0) {
      setError("Số tiền thu phải lớn hơn 0.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const res = await apiFetch(`${API_URL}/cash-receipts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          party_type: target.partyType,
          party_id: target.partyId,
          amount: parsedAmount,
          note: note.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail ?? "Không thể lập phiếu thu tiền mặt.");
      }
      onCreated(
        `Đã lập phiếu thu ${data.code || ""} (${formatVNDFull(parsedAmount)}) giảm công nợ cho ${target.code} - ${target.name}.`
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi lập phiếu thu.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg border border-slate-400 bg-white shadow-lg"
      >
        {/* Header */}
        <div className="flex items-center justify-between bg-[#14263d] px-3 py-2 text-white">
          <div className="flex items-center gap-2">
            <Banknote size={17} className="text-red-500" />
            <h2 className="text-xs font-bold uppercase tracking-wide text-white">
              Lập phiếu thu tiền mặt —{" "}
              {target.partyType === "EMPLOYEE" ? "Nhân viên" : "Khách hàng / Cửa hàng"}
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
        <div className="space-y-2.5 px-3 py-2.5">
          {error && (
            <div className="flex items-center gap-2 rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
              <AlertTriangle size={14} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 rounded border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs">
            <div>
              <span className="block text-[10px] font-semibold text-slate-500">Đối tượng nộp</span>
              <span className="font-bold text-slate-800">
                {target.code} - {target.name}
              </span>
            </div>
            <div className="text-right">
              <span className="block text-[10px] font-semibold text-slate-500">
                Công nợ hiện tại
              </span>
              <span className="text-sm font-bold text-rose-600">
                {formatVNDFull(target.currentDebt)}
              </span>
            </div>
          </div>

          <div>
            <div className="mb-0.5 flex items-center justify-between">
              <label className="text-[10px] font-semibold text-slate-600">
                Số tiền thu (VNĐ) *
              </label>
              {target.currentDebt > 0 && (
                <button
                  type="button"
                  onClick={() => setAmountStr(String(Math.round(target.currentDebt)))}
                  className="text-[10px] font-semibold text-sky-600 hover:underline"
                >
                  Điền đủ công nợ ({formatVNDFull(target.currentDebt)})
                </button>
              )}
            </div>
            <input
              type="number"
              min={1}
              step="any"
              required
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              placeholder="Nhập số tiền thực thu..."
              className={`${inputCls} text-right font-bold`}
            />
            {parsedAmount > 0 && (
              <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500">
                <span>Số tiền thu: {formatVNDFull(parsedAmount)}</span>
                <span>
                  Dư nợ sau thu:{" "}
                  <strong className={remainingAfter <= 0 ? "text-emerald-700" : "text-slate-700"}>
                    {formatVNDFull(remainingAfter)}
                  </strong>
                </span>
              </div>
            )}
          </div>

          <div>
            <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
              Ghi chú phiếu thu
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="VD: NVGH nộp tiền mặt cuối ngày..."
              className={inputCls}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-slate-300 bg-slate-100 px-3 py-2">
          <span className="text-[10px] text-slate-500">
            Bút toán giảm công nợ sẽ được ghi ngay vào sổ cái.
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
              type="submit"
              disabled={submitting || parsedAmount <= 0}
              className="inline-flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {submitting ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <CheckCircle2 size={13} />
              )}
              Xác nhận thu tiền
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

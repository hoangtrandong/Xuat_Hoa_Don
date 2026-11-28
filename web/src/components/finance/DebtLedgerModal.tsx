"use client";

import { useEffect, useState } from "react";
import { Banknote, BookOpen, Loader2, X } from "lucide-react";
import { API_URL, apiFetch } from "@/lib/api";
import { formatDateTime, formatVNDFull } from "@/lib/format";
import type { CashReceiptTarget } from "./CashReceiptModal";

export interface DebtLedgerEntry {
  id: number;
  party_type: string;
  party_id: number;
  entry_type: string;
  amount: number;
  source_type: string;
  source_id: number | null;
  source_code: string | null;
  document_date: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface DebtLedgerParty {
  partyType: "EMPLOYEE" | "STORE";
  partyId: number;
  code: string;
  name: string;
  currentDebt: number;
  totalDebit: number;
  totalCredit: number;
}

interface DebtLedgerModalProps {
  party: DebtLedgerParty | null;
  onClose: () => void;
  onOpenCashReceipt?: (target: CashReceiptTarget) => void;
}

const ENTRY_TYPE_LABELS: Record<string, { label: string; cls: string }> = {
  DELIVERY_ISSUE: { label: "Xuất kho giao hàng", cls: "bg-rose-100 text-rose-700" },
  CASH_RECEIPT: { label: "Thu tiền mặt", cls: "bg-emerald-100 text-emerald-700" },
  BANK_RECEIPT: { label: "Chuyển khoản NH", cls: "bg-emerald-100 text-emerald-700" },
  RETURN: { label: "Trả hàng về kho", cls: "bg-sky-100 text-sky-700" },
  TRANSFER_OUT: { label: "Chuyển công nợ đi", cls: "bg-amber-100 text-amber-800" },
  TRANSFER_IN: { label: "Nhận công nợ đến", cls: "bg-rose-100 text-rose-700" },
  ADJUSTMENT: { label: "Điều chỉnh", cls: "bg-slate-100 text-slate-700" },
  REVERSAL: { label: "Hoàn tác", cls: "bg-slate-100 text-slate-700" },
};

export default function DebtLedgerModal({
  party,
  onClose,
  onOpenCashReceipt,
}: DebtLedgerModalProps) {
  const [entries, setEntries] = useState<DebtLedgerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!party) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const endpoint =
          party!.partyType === "EMPLOYEE"
            ? `${API_URL}/employee-debts/${party!.partyId}/ledger?limit=200`
            : `${API_URL}/store-debts/${party!.partyId}/ledger?limit=200`;
        const res = await apiFetch(endpoint);
        if (!res.ok) throw new Error("Không thể tải sổ cái công nợ.");
        const data: DebtLedgerEntry[] = await res.json();
        if (!cancelled) setEntries(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Lỗi tải sổ cái.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [party]);

  if (!party) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col border border-slate-400 bg-white shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between bg-[#14263d] px-3 py-2 text-white">
          <div className="flex items-center gap-2">
            <BookOpen size={17} className="text-red-500" />
            <h2 className="text-xs font-bold uppercase tracking-wide text-white">
              Sổ cái công nợ — {party.code} · {party.name}
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

        {/* Summary bar */}
        <div className="grid grid-cols-3 divide-x divide-slate-200 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs">
          <div className="pr-3">
            <span className="block text-[10px] font-semibold text-slate-500">
              Tổng phát sinh nợ (+)
            </span>
            <span className="text-sm font-bold text-rose-600">
              {formatVNDFull(party.totalDebit)}
            </span>
          </div>
          <div className="px-3">
            <span className="block text-[10px] font-semibold text-slate-500">
              Tổng đã thu / trả hàng / chuyển (-)
            </span>
            <span className="text-sm font-bold text-emerald-700">
              {formatVNDFull(party.totalCredit)}
            </span>
          </div>
          <div className="pl-3">
            <span className="block text-[10px] font-semibold text-slate-500">
              Dư nợ hiện tại
            </span>
            <span
              className={`text-sm font-bold ${
                party.currentDebt > 0 ? "text-rose-700" : "text-emerald-700"
              }`}
            >
              {formatVNDFull(party.currentDebt)}
            </span>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="m-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 bg-slate-100 text-[10px] font-semibold uppercase text-slate-600">
                <tr>
                  <th className="px-3 py-1.5">Thời điểm</th>
                  <th className="px-3 py-1.5">Nghiệp vụ</th>
                  <th className="px-3 py-1.5">Mã chứng từ</th>
                  <th className="px-3 py-1.5">Diễn giải</th>
                  <th className="px-3 py-1.5 text-right">Phát sinh Nợ (+)</th>
                  <th className="px-3 py-1.5 text-right">Giảm Nợ (-)</th>
                  <th className="px-3 py-1.5">Người ghi</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-xs text-slate-500">
                      <Loader2 size={15} className="mr-1.5 inline animate-spin text-sky-600" />
                      Đang tải lịch sử công nợ...
                    </td>
                  </tr>
                ) : entries.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-xs text-slate-400">
                      Chưa có phát sinh công nợ nào.
                    </td>
                  </tr>
                ) : (
                  entries.map((e) => {
                    const meta = ENTRY_TYPE_LABELS[e.entry_type] || {
                      label: e.entry_type,
                      cls: "bg-slate-100 text-slate-700",
                    };
                    const isDebit = Number(e.amount) > 0;
                    return (
                      <tr
                        key={e.id}
                        className="border-b border-slate-100 text-[11px] even:bg-amber-50/40 hover:bg-sky-50/50"
                      >
                        <td className="whitespace-nowrap px-3 py-1.5 text-[10px] text-slate-500">
                          {formatDateTime(e.document_date || e.created_at)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5">
                          <span
                            className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${meta.cls}`}
                          >
                            {meta.label}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 font-mono font-semibold text-slate-700">
                          {e.source_code || "—"}
                        </td>
                        <td className="px-3 py-1.5 text-slate-700">{e.note || "—"}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold text-rose-600">
                          {isDebit ? `+${formatVNDFull(Number(e.amount))}` : "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold text-emerald-700">
                          {!isDebit ? formatVNDFull(Number(e.amount)) : "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-[10px] text-slate-500">
                          {e.created_by || "Hệ thống"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-slate-300 bg-slate-100 px-3 py-2">
          <span className="text-[10px] text-slate-500">
            Hiển thị tối đa 200 bút toán gần nhất (từ mới nhất đến cũ nhất).
          </span>
          <div className="flex items-center gap-2">
            {onOpenCashReceipt && (
              <button
                type="button"
                onClick={() => {
                  onOpenCashReceipt({
                    partyType: party.partyType,
                    partyId: party.partyId,
                    code: party.code,
                    name: party.name,
                    currentDebt: party.currentDebt,
                  });
                }}
                className="inline-flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-700"
              >
                <Banknote size={13} />
                Thu tiền mặt
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded bg-red-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-800"
            >
              Đóng
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

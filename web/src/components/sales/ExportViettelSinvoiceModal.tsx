"use client";

import { useState } from "react";
import {
  FileSpreadsheet,
  Download,
  X,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Layers,
  FileCheck,
} from "lucide-react";
import { API_URL, apiFetch } from "@/lib/api";
import { formatVND } from "@/lib/format";

interface ExportCandidateOrder {
  order_number: string;
  order_date: string;
  customer_name: string;
  customer_code?: string;
  net_amount: number;
  item_count?: number;
}

interface ExportViettelSinvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedOrderNumbers: string[];
  candidateOrders?: ExportCandidateOrder[];
  onSuccess?: (message: string) => void;
}

export default function ExportViettelSinvoiceModal({
  isOpen,
  onClose,
  selectedOrderNumbers,
  candidateOrders = [],
  onSuccess,
}: ExportViettelSinvoiceModalProps) {
  const [exportMode, setExportMode] = useState<"AGGREGATED" | "SEPARATE">("AGGREGATED");
  const [defaultTax, setDefaultTax] = useState<number>(8);
  const [customNote, setCustomNote] = useState<string>("");
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>("");

  if (!isOpen) return null;

  // Lọc lấy danh sách các đơn đang được chọn
  const selectedOrderList = candidateOrders.filter((ord) =>
    selectedOrderNumbers.includes(ord.order_number)
  );

  const totalAmount = selectedOrderList.reduce(
    (sum, ord) => sum + (Number(ord.net_amount) || 0),
    0
  );

  async function handleDownloadExcel() {
    if (selectedOrderNumbers.length === 0) {
      setErrorMsg("Vui lòng chọn ít nhất một đơn hàng để xuất file hóa đơn.");
      return;
    }

    setIsExporting(true);
    setErrorMsg("");

    try {
      const res = await apiFetch(`${API_URL}/einvoice/export/viettel-sinvoice`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          order_numbers: selectedOrderNumbers,
          mode: exportMode,
          default_tax: Number(defaultTax),
          custom_note: customNote.trim(),
        }),
      });

      if (!res.ok) {
        const errPayload = await res.json().catch(() => ({}));
        throw new Error(
          errPayload.detail || "Không thể xuất file hóa đơn Viettel S-Invoice."
        );
      }

      const blob = await res.blob();
      const nowStr = new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/[-:]/g, "")
        .replace("T", "_");
      const filename = `Viettel_SInvoice_${exportMode}_${nowStr}.xls`;

      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);

      if (onSuccess) {
        onSuccess(
          `Đã xuất thành công file Excel Viettel S-Invoice (${selectedOrderNumbers.length} đơn) với tên: ${filename}`
        );
      }
      onClose();
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error ? err.message : "Đã xảy ra lỗi khi tạo file Excel."
      );
    } finally {
      setIsExporting(false);
    }
  }

  const inputCls =
    "w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-100";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-2 backdrop-blur-xs sm:p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-4xl overflow-hidden border border-slate-400 bg-white shadow-2xl">
        {/* Header Modal - GEMINI.md standard */}
        <header className="flex items-center justify-between bg-[#14263d] px-3 py-2 text-white">
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={17} className="text-emerald-400" />
            <h2 className="text-xs font-bold uppercase tracking-wide">
              Xuất Hóa Đơn Điện Tử Viettel
            </h2>
            <span className="hidden rounded border border-white/15 bg-white/10 px-1.5 py-0.5 text-[9px] font-medium text-slate-200 sm:inline">
              Mẫu 1/001 - C26TTD
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-white hover:bg-white/10 transition-colors"
            aria-label="Đóng"
          >
            <X size={16} />
          </button>
        </header>

        {/* Body Form */}
        <div className="max-h-[78vh] overflow-y-auto">
          {errorMsg && (
            <div
              role="alert"
              className="mx-3 mt-2 flex items-center gap-2 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
            >
              <AlertTriangle size={14} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="grid lg:grid-cols-[280px_minmax(0,1fr)]">
            <section className="border-b border-slate-200 px-3 py-2.5 lg:border-b-0 lg:border-r lg:border-slate-200">
              <div className="-mx-3 -mt-2.5 mb-2.5 border-b border-sky-100 bg-sky-50/60 px-3 py-2 text-[11px] font-bold uppercase text-sky-800 flex items-center gap-1.5">
                <FileCheck size={14} className="text-sky-600" /> Cấu hình xuất
              </div>

              <div className="space-y-2.5">
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-slate-600">Phương thức tạo hóa đơn</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setExportMode("AGGREGATED")}
                      className={`min-h-16 rounded border px-2 py-2 text-left transition-colors ${
                        exportMode === "AGGREGATED"
                          ? "border-sky-500 bg-sky-50 text-sky-800"
                          : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      <span className="flex items-center gap-1 text-[10px] font-bold uppercase"><Layers size={12} /> Gom đơn</span>
                      <span className="mt-1 block text-[9px] leading-tight opacity-80">Cộng dồn cùng SKU</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setExportMode("SEPARATE")}
                      className={`min-h-16 rounded border px-2 py-2 text-left transition-colors ${
                        exportMode === "SEPARATE"
                          ? "border-sky-500 bg-sky-50 text-sky-800"
                          : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      <span className="flex items-center gap-1 text-[10px] font-bold uppercase"><FileCheck size={12} /> Tách đơn</span>
                      <span className="mt-1 block text-[9px] leading-tight opacity-80">Mỗi đơn một tờ</span>
                    </button>
                  </div>
                </div>

                <div>
                  <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">Thuế suất GTGT</label>
                  <select value={defaultTax} onChange={(e) => setDefaultTax(Number(e.target.value))} className={inputCls}>
                    <option value={8}>8% - Giảm thuế GTGT</option>
                    <option value={10}>10% - Thuế suất chuẩn</option>
                    <option value={5}>5% - Thuế suất ưu đãi</option>
                    <option value={0}>0% - Không thuế</option>
                  </select>
                </div>

                <div>
                  <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">Ghi chú hóa đơn</label>
                  <textarea
                    rows={3}
                    value={customNote}
                    onChange={(e) => setCustomNote(e.target.value)}
                    placeholder="Ví dụ: Xuất theo bảng kê bán lẻ..."
                    className={`${inputCls} resize-none`}
                  />
                </div>

                <div className="flex items-center gap-2 border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[9px] text-emerald-800">
                  <CheckCircle2 size={13} className="shrink-0 text-emerald-600" />
                  <span>Mẫu 45 cột BIFF8 tương thích Viettel S-Invoice</span>
                </div>
              </div>
            </section>

            <section className="px-3 py-2.5">
              <div className="-mx-3 -mt-2.5 mb-2 border-b border-sky-100 bg-sky-50/60 px-3 py-2 text-[11px] font-bold uppercase text-sky-800 flex items-center justify-between">
                <span className="flex items-center gap-1.5"><Layers size={14} className="text-sky-600" /> Đơn hàng xuất ({selectedOrderNumbers.length})</span>
                <span className="text-[10px] font-bold text-sky-900 normal-case">{formatVND(totalAmount)}</span>
              </div>

              {selectedOrderNumbers.length === 0 ? (
                <div className="flex min-h-44 items-center justify-center border border-dashed border-amber-300 bg-amber-50 px-4 text-center text-xs text-amber-800">
                  Chưa có đơn hàng nào được chọn.
                </div>
              ) : (
                <div className="overflow-x-auto border border-slate-200">
                  <table className="w-full border-collapse text-left">
                    <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600">
                      <tr>
                        <th className="px-2 py-1.5 text-center">STT</th>
                        <th className="px-2 py-1.5">Mã đơn hàng</th>
                        <th className="px-2 py-1.5">Khách hàng</th>
                        <th className="px-2 py-1.5 text-center">Ngày</th>
                        <th className="px-2 py-1.5 text-right">Tổng tiền</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-[11px]">
                      {selectedOrderList.length > 0
                        ? selectedOrderList.map((ord, idx) => (
                            <tr key={ord.order_number} className="even:bg-amber-50/40 hover:bg-sky-50/50">
                              <td className="px-2 py-1.5 text-center text-slate-500">{idx + 1}</td>
                              <td className="px-2 py-1.5 font-mono font-bold text-sky-800">{ord.order_number}</td>
                              <td className="max-w-[220px] truncate px-2 py-1.5 text-slate-700" title={ord.customer_name}>{ord.customer_name}</td>
                              <td className="px-2 py-1.5 text-center text-slate-500">{ord.order_date}</td>
                              <td className="px-2 py-1.5 text-right font-medium text-slate-700">{formatVND(ord.net_amount)}</td>
                            </tr>
                          ))
                        : selectedOrderNumbers.map((ordNum, idx) => (
                            <tr key={ordNum} className="even:bg-amber-50/40">
                              <td className="px-2 py-1.5 text-center">{idx + 1}</td>
                              <td className="px-2 py-1.5 font-mono font-bold">{ordNum}</td>
                              <td className="px-2 py-1.5 text-slate-500" colSpan={3}>Đơn hàng đã chọn</td>
                            </tr>
                          ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </div>

        {/* Footer Action Bar - GEMINI.md standard */}
        <footer className="flex items-center justify-between gap-3 border-t border-slate-300 bg-slate-100 px-3 py-2">
          <div className="hidden items-center gap-2 text-[10px] text-slate-500 sm:flex">
            <FileSpreadsheet size={13} />
            <span>Tương thích nhập từ file Excel của Viettel S-Invoice</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isExporting}
              className="rounded bg-red-700 hover:bg-red-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:bg-slate-300"
            >
              Đóng
            </button>
            <button
              type="button"
              onClick={handleDownloadExcel}
              disabled={selectedOrderNumbers.length === 0 || isExporting}
              className="inline-flex items-center gap-1.5 rounded bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:bg-slate-300 shadow-sm"
            >
              {isExporting ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Download size={13} />
              )}
              {isExporting ? "Đang tạo file Excel..." : `Tải file Viettel (.xls) (${selectedOrderNumbers.length} đơn)`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

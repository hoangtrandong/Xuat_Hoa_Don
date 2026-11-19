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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-2xl overflow-hidden rounded border border-slate-400 bg-white shadow-2xl">
        {/* Header Modal - GEMINI.md standard */}
        <header className="flex items-center justify-between bg-[#14263d] px-3 py-2 text-white">
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={17} className="text-emerald-400" />
            <h2 className="text-xs font-bold uppercase tracking-wide">
              Xuất Dữ Liệu Excel Viettel S-Invoice (Mẫu 1/001 - C26TTD)
            </h2>
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
        <div className="max-h-[80vh] overflow-y-auto">
          {errorMsg && (
            <div
              role="alert"
              className="mx-3 mt-2 flex items-center gap-2 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
            >
              <AlertTriangle size={14} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Section 1: Thông tin cấu hình mẫu xuất */}
          <section className="border-b border-slate-200 px-3 py-2.5">
            <div className="border-b border-sky-100 bg-sky-50/60 -mx-3 -mt-2.5 mb-2.5 px-3 py-1.5 text-[11px] font-bold text-sky-800 uppercase flex items-center gap-1.5">
              <FileCheck size={14} className="text-sky-600" /> 1. Định Dạng Biểu Mẫu & Phương Thức Gom Hóa Đơn
            </div>

            <div className="space-y-3">
              <div className="rounded border border-emerald-200 bg-emerald-50/70 p-2.5 text-xs text-emerald-900">
                <div className="font-semibold flex items-center gap-1.5 text-emerald-800">
                  <CheckCircle2 size={14} className="text-emerald-600" />
                  Mẫu chuẩn Viettel S-Invoice: 1/001 - C26TTD (45 cột BIFF8)
                </div>
                <div className="text-[11px] text-emerald-700 mt-0.5">
                  File xuất ra giữ nguyên 10 dòng cấu trúc hệ thống của Viettel, xóa sạch dòng mẫu cũ và tự động ánh xạ dữ liệu đơn hàng theo đúng chuẩn Viettel Sinvoice.
                </div>
              </div>

              <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2">
                <div>
                  <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                    Phương thức xuất / Gom đơn:
                  </label>
                  <select
                    value={exportMode}
                    onChange={(e) =>
                      setExportMode(e.target.value as "AGGREGATED" | "SEPARATE")
                    }
                    className={inputCls}
                  >
                    <option value="AGGREGATED">
                      Gom thành 1 hóa đơn tổng (Group = 1, Bán lẻ)
                    </option>
                    <option value="SEPARATE">
                      Xuất riêng từng đơn lẻ (Group = 1, 2, 3...)
                    </option>
                  </select>
                  <span className="text-[9px] text-slate-500 mt-0.5 block">
                    {exportMode === "AGGREGATED"
                      ? "• Khuyên dùng: Tự động gộp các sản phẩm cùng SKU, cộng dồn số lượng & tiền."
                      : "• Mỗi đơn hàng sẽ tạo thành 1 hóa đơn riêng biệt với đầy đủ thông tin khách hàng."}
                  </span>
                </div>

                <div>
                  <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                    Thuế suất GTGT áp dụng:
                  </label>
                  <select
                    value={defaultTax}
                    onChange={(e) => setDefaultTax(Number(e.target.value))}
                    className={inputCls}
                  >
                    <option value={8}>8% (Nghị quyết giảm thuế GTGT)</option>
                    <option value={10}>10% (Thuế suất chuẩn GTGT)</option>
                    <option value={5}>5% (Thuế suất ưu đãi 5%)</option>
                    <option value={0}>0% (Thuế suất 0%)</option>
                  </select>
                  <span className="text-[9px] text-slate-500 mt-0.5 block">
                    Thuế suất sẽ được điền vào cột taxPercentage ({defaultTax}%) trên file Viettel.
                  </span>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                  Ghi chú hóa đơn (Tùy chọn):
                </label>
                <input
                  type="text"
                  value={customNote}
                  onChange={(e) => setCustomNote(e.target.value)}
                  placeholder="Ví dụ: Xuất theo bảng kê bán lẻ ngày... hoặc để trống"
                  className={inputCls}
                />
              </div>
            </div>
          </section>

          {/* Section 2: Danh sách đơn hàng được chọn */}
          <section className="px-3 py-2.5">
            <div className="border-b border-sky-100 bg-sky-50/60 -mx-3 -mt-2.5 mb-2 px-3 py-1.5 text-[11px] font-bold text-sky-800 uppercase flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Layers size={14} className="text-sky-600" /> 2. Danh Sách Đơn Hàng Tham Gia Xuất ({selectedOrderNumbers.length} đơn)
              </span>
              <span className="text-[10px] text-slate-600 font-semibold normal-case">
                Tổng giá trị: <strong className="text-sky-800">{formatVND(totalAmount)}</strong>
              </span>
            </div>

            {selectedOrderNumbers.length === 0 ? (
              <div className="p-4 text-center text-xs text-amber-700 bg-amber-50 rounded border border-amber-200">
                Chưa có đơn hàng nào được chọn. Hãy đóng modal này và tích chọn các đơn hàng bạn muốn xuất từ danh sách!
              </div>
            ) : (
              <div className="overflow-x-auto border border-slate-200 rounded max-h-48">
                <table className="w-full border-collapse text-left">
                  <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600 sticky top-0">
                    <tr>
                      <th className="px-2 py-1.5">STT</th>
                      <th className="px-2 py-1.5">Mã đơn hàng</th>
                      <th className="px-2 py-1.5">Khách hàng</th>
                      <th className="px-2 py-1.5 text-center">Ngày đơn</th>
                      <th className="px-2 py-1.5 text-right">Tổng tiền</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-[11px]">
                    {selectedOrderList.length > 0
                      ? selectedOrderList.map((ord, idx) => (
                          <tr
                            key={ord.order_number}
                            className="even:bg-amber-50/40 hover:bg-sky-50/50"
                          >
                            <td className="px-2 py-1 text-slate-500 text-center">{idx + 1}</td>
                            <td className="px-2 py-1 font-mono font-bold text-sky-800">
                              {ord.order_number}
                            </td>
                            <td className="px-2 py-1 text-slate-700 truncate max-w-[200px]" title={ord.customer_name}>
                              {ord.customer_name}
                            </td>
                            <td className="px-2 py-1 text-center text-slate-500">
                              {ord.order_date}
                            </td>
                            <td className="px-2 py-1 text-right font-medium text-slate-700">
                              {formatVND(ord.net_amount)}
                            </td>
                          </tr>
                        ))
                      : selectedOrderNumbers.map((ordNum, idx) => (
                          <tr key={ordNum} className="even:bg-amber-50/40">
                            <td className="px-2 py-1 text-center">{idx + 1}</td>
                            <td className="px-2 py-1 font-mono font-bold">{ordNum}</td>
                            <td className="px-2 py-1 text-slate-500" colSpan={3}>
                              Đơn hàng đã chọn
                            </td>
                          </tr>
                        ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        {/* Footer Action Bar - GEMINI.md standard */}
        <footer className="flex items-center justify-between gap-3 border-t border-slate-300 bg-slate-100 px-3 py-2">
          <p className="text-[10px] text-slate-500 hidden sm:block">
            File Excel xuất ra tương thích 100% chức năng &quot;Nhập hóa đơn từ file Excel&quot; của Viettel S-Invoice.
          </p>
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

"use client";

import React, { useRef } from "react";
import { Printer, X, Box, Boxes, Package, CheckCircle2 } from "lucide-react";
import { formatNumber, formatDate, splitCartons } from "@/lib/format";

interface DeliveryItem {
  id?: number;
  product_id: number;
  sku: string;
  product_name: string;
  boxes_per_carton?: number;
  quantity: number;
  cartons?: number;
  loose_boxes?: number;
  requested_quantity_raw?: string | null;
  allocations?: {
    location_code?: string | null;
    lot_number?: string | null;
    expiry_date?: string | null;
    allocated_quantity: number;
  }[];
  planned_allocations?: {
    location_code?: string | null;
    lot_number?: string | null;
    expiry_date?: string | null;
    quantity: number;
  }[] | null;
}

interface EmployeeSummary {
  employee_code: string;
  employee_name?: string | null;
  weight_ton?: number;
  order_count?: number;
  amount?: number;
}

interface DeliveryRequestData {
  id: number;
  code: string;
  warehouse_id: number;
  status: string;
  note?: string | null;
  created_by?: string | null;
  created_at: string;
  items: DeliveryItem[];
  employee_summaries?: EmployeeSummary[];
  total_cartons?: number;
  total_loose_boxes?: number;
  total_quantity?: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  request: DeliveryRequestData | null;
  warehouseName?: string;
}

export default function DeliveryDispatchPrintModal({ open, onClose, request, warehouseName }: Props) {
  const printRef = useRef<HTMLDivElement>(null);

  if (!open || !request) return null;

  const totalCartons = request.total_cartons ?? request.items.reduce((sum, item) => {
    const { cartons } = splitCartons(item.quantity, item.boxes_per_carton);
    return sum + cartons;
  }, 0);

  const totalLooseBoxes = request.total_loose_boxes ?? request.items.reduce((sum, item) => {
    const { looseBoxes } = splitCartons(item.quantity, item.boxes_per_carton);
    return sum + looseBoxes;
  }, 0);

  const totalQuantity = request.total_quantity ?? request.items.reduce((sum, item) => sum + item.quantity, 0);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="flex flex-col h-[92vh] max-h-[900px] w-full max-w-4xl bg-white rounded-2xl shadow-2xl overflow-hidden border border-gray-100">
        {/* Header Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50 no-print">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-sky-100 text-sky-700">
              <Printer size={18} />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Xem trước & In Phiếu bốc xếp xuất kho</h3>
              <p className="text-xs text-gray-500">Mã phiếu: {request.code} · Chuẩn quy cách Thùng / Hộp lẻ</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-sky-600 hover:bg-sky-700 transition shadow-xs"
            >
              <Printer size={16} /> In phiếu (Print)
            </button>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Printable Document Area */}
        <div className="flex-1 overflow-y-auto p-8 bg-gray-100/50 print:bg-white print:p-0">
          <div
            ref={printRef}
            className="dispatch-print-sheet bg-white p-8 max-w-[210mm] mx-auto shadow-sm rounded-xl border border-gray-200 print:border-none print:shadow-none print:p-0 print:max-w-none"
          >
            {/* Header */}
            <div className="flex justify-between items-start border-b-2 border-gray-800 pb-4 mb-6">
              <div>
                <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold">TỔNG KHO PHÂN PHỐI SỮA & BÁN LẺ</p>
                <h1 className="text-xl font-black text-gray-900 tracking-tight mt-0.5">
                  PHIẾU BỐC XẾP & BÀN GIAO HÀNG XUẤT KHO
                </h1>
                <p className="text-xs text-gray-600 mt-1">
                  Kho xuất: <span className="font-semibold text-gray-900">{warehouseName || `Kho #${request.warehouse_id}`}</span>
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono text-base font-bold text-sky-800">{request.code}</p>
                <p className="text-xs text-gray-500 mt-1">
                  Ngày lập: {formatDate(request.created_at)}
                </p>
                <p className="text-xs text-gray-500">
                  Người lập: <span className="font-medium text-gray-700">{request.created_by || "Sales Admin"}</span>
                </p>
              </div>
            </div>

            {/* Quick Summary Highlights for Loaders / Drivers */}
            <div className="grid grid-cols-4 gap-3 p-4 mb-6 bg-sky-50/70 border border-sky-200 rounded-xl print:bg-gray-50 print:border-gray-300">
              <div className="text-center">
                <span className="text-[11px] font-medium text-sky-800 uppercase block">Tổng Thùng Nguyên</span>
                <span className="text-2xl font-black text-sky-900 mt-0.5 block">
                  {formatNumber(totalCartons)} <span className="text-xs font-normal text-sky-700">thùng</span>
                </span>
              </div>
              <div className="text-center border-l border-sky-200 print:border-gray-300">
                <span className="text-[11px] font-medium text-amber-800 uppercase block">Tổng Hộp Lẻ</span>
                <span className="text-2xl font-black text-amber-900 mt-0.5 block">
                  {formatNumber(totalLooseBoxes)} <span className="text-xs font-normal text-amber-700">hộp</span>
                </span>
              </div>
              <div className="text-center border-l border-sky-200 print:border-gray-300">
                <span className="text-[11px] font-medium text-gray-600 uppercase block">Tổng Quy Đổi</span>
                <span className="text-2xl font-black text-gray-900 mt-0.5 block">
                  {formatNumber(totalQuantity)} <span className="text-xs font-normal text-gray-500">hộp</span>
                </span>
              </div>
              <div className="text-center border-l border-sky-200 print:border-gray-300">
                <span className="text-[11px] font-medium text-gray-600 uppercase block">Tổng Mặt Hàng</span>
                <span className="text-2xl font-black text-gray-900 mt-0.5 block">
                  {request.items.length} <span className="text-xs font-normal text-gray-500">SKU</span>
                </span>
              </div>
            </div>

            {/* Note if any */}
            {request.note && (
              <p className="text-xs italic text-gray-600 mb-4 bg-gray-50 p-2.5 rounded-lg border border-gray-100">
                <span className="font-semibold text-gray-700">Ghi chú chuyến xe:</span> {request.note}
              </p>
            )}

            {/* Product Table */}
            <div className="mb-6">
              <h2 className="text-xs font-bold uppercase tracking-wider text-gray-700 mb-2">
                Danh sách sản phẩm bốc xếp chi tiết
              </h2>
              <table className="w-full text-left text-xs border border-gray-300 border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-gray-800 font-semibold border-b border-gray-300">
                    <th className="py-2 px-2 border-r border-gray-300 w-8 text-center">STT</th>
                    <th className="py-2 px-2 border-r border-gray-300 w-24">Mã SKU</th>
                    <th className="py-2 px-2 border-r border-gray-300">Tên sản phẩm</th>
                    <th className="py-2 px-2 border-r border-gray-300 w-16 text-center">Quy cách</th>
                    <th className="py-2 px-2 border-r border-gray-300 w-20 text-right bg-sky-50 print:bg-gray-100 font-bold">
                      Thùng (T)
                    </th>
                    <th className="py-2 px-2 border-r border-gray-300 w-16 text-right bg-amber-50 print:bg-gray-100 font-bold">
                      Lẻ (H)
                    </th>
                    <th className="py-2 px-2 border-r border-gray-300 w-20 text-right">Tổng hộp</th>
                    <th className="py-2 px-2 border-r border-gray-300 w-32">Vị trí kho / Lô</th>
                    <th className="py-2 px-2 w-16 text-center">Ký nhận</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {request.items.map((item, idx) => {
                    const { cartons, looseBoxes, bpc } = splitCartons(item.quantity, item.boxes_per_carton);
                    const picks = item.planned_allocations || item.allocations || [];
                    const locationsSummary = picks.length > 0
                      ? picks
                          .map((p) => `${p.location_code || "Khu kệ"}${p.lot_number ? ` (Lô ${p.lot_number})` : ""}`)
                          .slice(0, 2)
                          .join(", ")
                      : "Kho chính";

                    return (
                      <tr key={item.id ?? idx} className="hover:bg-gray-50/50">
                        <td className="py-2 px-2 border-r border-gray-300 text-center text-gray-500">{idx + 1}</td>
                        <td className="py-2 px-2 border-r border-gray-300 font-mono font-medium text-gray-900">{item.sku}</td>
                        <td className="py-2 px-2 border-r border-gray-300 font-medium text-gray-900">{item.product_name}</td>
                        <td className="py-2 px-2 border-r border-gray-300 text-center text-gray-500">{bpc} H/T</td>
                        <td className="py-2 px-2 border-r border-gray-300 text-right font-black text-sky-950 text-sm bg-sky-50/40 print:bg-transparent">
                          {cartons > 0 ? formatNumber(cartons) : "—"}
                        </td>
                        <td className="py-2 px-2 border-r border-gray-300 text-right font-bold text-amber-900 bg-amber-50/40 print:bg-transparent">
                          {looseBoxes > 0 ? looseBoxes : "—"}
                        </td>
                        <td className="py-2 px-2 border-r border-gray-300 text-right text-gray-700">
                          {formatNumber(item.quantity)}
                        </td>
                        <td className="py-2 px-2 border-r border-gray-300 text-gray-500 text-[11px] truncate max-w-[140px]" title={locationsSummary}>
                          {locationsSummary}
                        </td>
                        <td className="py-2 px-2 text-center text-gray-300">
                          [ &nbsp; ]
                        </td>
                      </tr>
                    );
                  })}
                  {/* Total Row */}
                  <tr className="bg-gray-100 font-bold border-t-2 border-gray-400">
                    <td colSpan={4} className="py-2.5 px-3 border-r border-gray-300 text-right uppercase">
                      TỔNG CỘNG CHUYẾN XE:
                    </td>
                    <td className="py-2.5 px-2 border-r border-gray-300 text-right text-sm text-sky-950 font-black bg-sky-100/50 print:bg-transparent">
                      {formatNumber(totalCartons)}
                    </td>
                    <td className="py-2.5 px-2 border-r border-gray-300 text-right text-sm text-amber-950 font-bold bg-amber-100/50 print:bg-transparent">
                      {formatNumber(totalLooseBoxes)}
                    </td>
                    <td className="py-2.5 px-2 border-r border-gray-300 text-right text-sm text-gray-900 font-bold">
                      {formatNumber(totalQuantity)}
                    </td>
                    <td colSpan={2} className="py-2.5 px-2 text-gray-500 text-center italic text-[11px]">
                      Kiểm đếm theo Thùng & Lẻ
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Employee Breakdown if available */}
            {request.employee_summaries && request.employee_summaries.length > 0 && (
              <div className="mb-6 page-break-inside-avoid">
                <h2 className="text-xs font-bold uppercase tracking-wider text-gray-700 mb-2">
                  Phân bổ giao hàng theo Nhân viên giao hàng (NVGH)
                </h2>
                <table className="w-full text-left text-xs border border-gray-300 border-collapse">
                  <thead>
                    <tr className="bg-gray-100 text-gray-800 font-semibold border-b border-gray-300">
                      <th className="py-1.5 px-2 border-r border-gray-300">Mã NV</th>
                      <th className="py-1.5 px-2 border-r border-gray-300">Tên nhân viên</th>
                      <th className="py-1.5 px-2 border-r border-gray-300 text-right">Khối lượng (tấn)</th>
                      <th className="py-1.5 px-2 border-r border-gray-300 text-right">Số đơn hàng</th>
                      <th className="py-1.5 px-2 text-right">Tiền hàng nợ chuyến (VNĐ)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {request.employee_summaries.map((emp, idx) => (
                      <tr key={idx}>
                        <td className="py-1.5 px-2 border-r border-gray-300 font-mono font-medium">{emp.employee_code}</td>
                        <td className="py-1.5 px-2 border-r border-gray-300">{emp.employee_name || "—"}</td>
                        <td className="py-1.5 px-2 border-r border-gray-300 text-right">{emp.weight_ton ? emp.weight_ton.toFixed(3) : "—"}</td>
                        <td className="py-1.5 px-2 border-r border-gray-300 text-right">{emp.order_count || "—"}</td>
                        <td className="py-1.5 px-2 text-right font-semibold text-gray-900">
                          {emp.amount ? `${formatNumber(emp.amount)} đ` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Handover & Signatures */}
            <div className="mt-8 pt-4 border-t-2 border-gray-800 page-break-inside-avoid">
              <p className="text-xs italic text-gray-700 mb-6">
                * Cam kết: Người nhận đã kiểm đếm đầy đủ đúng số lượng:{" "}
                <span className="font-bold text-gray-900">{formatNumber(totalCartons)} Thùng nguyên</span> và{" "}
                <span className="font-bold text-gray-900">{formatNumber(totalLooseBoxes)} Hộp lẻ</span> theo danh mục trên, quy cách bao bì nguyên vẹn không móp méo rách vỡ.
              </p>
              <div className="grid grid-cols-4 gap-4 text-center text-xs">
                <div>
                  <p className="font-bold text-gray-900 uppercase">Người lập phiếu</p>
                  <p className="text-gray-400 italic text-[11px] mt-0.5">(Ký & ghi rõ họ tên)</p>
                  <div className="h-16"></div>
                  <p className="font-medium text-gray-800">{request.created_by || "Sales Admin"}</p>
                </div>
                <div>
                  <p className="font-bold text-gray-900 uppercase">Thủ kho xuất hàng</p>
                  <p className="text-gray-400 italic text-[11px] mt-0.5">(Ký & ghi rõ họ tên)</p>
                  <div className="h-16"></div>
                  <p className="text-gray-400">................................</p>
                </div>
                <div>
                  <p className="font-bold text-gray-900 uppercase">Tài xế / NVGH nhận</p>
                  <p className="text-gray-400 italic text-[11px] mt-0.5">(Ký & ghi rõ họ tên)</p>
                  <div className="h-16"></div>
                  <p className="text-gray-400">................................</p>
                </div>
                <div>
                  <p className="font-bold text-gray-900 uppercase">Bảo vệ cổng</p>
                  <p className="text-gray-400 italic text-[11px] mt-0.5">(Xác nhận xe xuất kho)</p>
                  <div className="h-16"></div>
                  <p className="text-gray-400">................................</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Embedded print styles */}
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .dispatch-print-sheet,
          .dispatch-print-sheet * {
            visibility: visible;
          }
          .dispatch-print-sheet {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            margin: 0;
            padding: 15mm;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}

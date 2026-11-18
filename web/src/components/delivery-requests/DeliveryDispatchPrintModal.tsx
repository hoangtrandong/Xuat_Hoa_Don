"use client";

import React, { useRef } from "react";
import { Printer, X } from "lucide-react";
import { formatNumber, formatDate, formatVND, splitCartons } from "@/lib/format";

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
  employee_allocations?: Record<string, unknown> | null;
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
  employee_id?: number | null;
  employee_code: string;
  employee_name?: string | null;
  weight_ton?: number;
  order_count?: number;
  amount?: number;
}

interface DeliveryOrder {
  id: number;
  order_date?: string | null;
  order_number: string;
  employee_code: string;
  employee_name?: string | null;
  customer_code?: string | null;
  customer_name?: string | null;
  amount: number;
  payment_status?: string;
  payment_method?: string | null;
  note?: string | null;
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
  orders?: DeliveryOrder[];
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

function paymentMethodLabel(order: DeliveryOrder): string {
  if (order.payment_method === "BANK" || order.payment_status === "PAID_BANK") return "Chuyển khoản";
  if (order.payment_method === "CASH" || order.payment_status === "PAID_CASH") return "Tiền mặt";
  if (order.payment_method === "DEBT" || order.payment_status === "TRANSFERRED_DEBT") return "Ghi nợ";
  if (order.payment_method === "RETURN" || order.payment_status === "RETURNED") return "Trả hàng";
  return "Chưa thanh toán";
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

  const employeePrintPages = new Map<string, {
    employee_code: string;
    employee_name: string;
    summary?: EmployeeSummary;
    orders: DeliveryOrder[];
    products: Array<DeliveryItem & { employee_quantity: number }>;
  }>();
  for (const summary of request.employee_summaries ?? []) {
    const employeeCode = summary.employee_code.trim().toUpperCase();
    if (!employeeCode) continue;
    employeePrintPages.set(employeeCode, {
      employee_code: summary.employee_code,
      employee_name: summary.employee_name || "",
      summary,
      orders: [],
      products: [],
    });
  }
  for (const order of request.orders ?? []) {
    const employeeCode = order.employee_code.trim().toUpperCase();
    if (!employeeCode) continue;
    const page = employeePrintPages.get(employeeCode) ?? {
      employee_code: order.employee_code,
      employee_name: order.employee_name || "",
      orders: [],
      products: [],
    };
    if (!page.employee_name && order.employee_name) page.employee_name = order.employee_name;
    page.orders.push(order);
    employeePrintPages.set(employeeCode, page);
  }
  for (const item of request.items) {
    for (const [rawEmployeeCode, rawAllocation] of Object.entries(item.employee_allocations ?? {})) {
      const employeeCode = rawEmployeeCode.trim().toUpperCase();
      const allocation = typeof rawAllocation === "object" && rawAllocation !== null
        ? rawAllocation as { quantity?: unknown }
        : null;
      const quantity = typeof rawAllocation === "number"
        ? rawAllocation
        : typeof allocation?.quantity === "number"
          ? allocation.quantity
          : 0;
      if (!employeeCode || !Number.isFinite(quantity) || quantity <= 0) continue;
      const page = employeePrintPages.get(employeeCode) ?? {
        employee_code: rawEmployeeCode,
        employee_name: "",
        orders: [],
        products: [],
      };
      page.products.push({ ...item, employee_quantity: quantity });
      employeePrintPages.set(employeeCode, page);
    }
  }
  const sortedEmployeePrintPages = [...employeePrintPages.values()]
    .sort((a, b) => a.employee_code.localeCompare(b.employee_code, "vi"));

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
                    <th className="py-2 px-2 border-r border-gray-300 w-16 text-center">Quy cách (H/T)</th>
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
                        <td className="py-2 px-2 border-r border-gray-300 text-center text-gray-500">{bpc}</td>
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

            {sortedEmployeePrintPages.map((employee) => {
              const employeeOrderTotal = employee.orders.reduce((sum, order) => sum + order.amount, 0);
              const productTotals = employee.products.reduce((totals, item) => {
                const key = item.product_id;
                const current = totals.get(key) ?? { item, quantity: 0 };
                current.quantity += item.employee_quantity;
                totals.set(key, current);
                return totals;
              }, new Map<number, { item: DeliveryItem & { employee_quantity: number }; quantity: number }>());
              const products = [...productTotals.values()];
              const employeeTotalQuantity = products.reduce((sum, product) => sum + product.quantity, 0);

              return (
                <section key={employee.employee_code} className="employee-dispatch-page">
                  <div className="border-b-2 border-gray-800 pb-3 mb-5">
                    <p className="text-xs uppercase tracking-widest text-gray-500 font-semibold">PHIẾU CHI TIẾT GIAO HÀNG THEO NHÂN VIÊN</p>
                    <h2 className="mt-1 text-xl font-black text-gray-900">
                      {employee.employee_code} · {employee.employee_name || "Chưa có tên nhân viên"}
                    </h2>
                    <p className="mt-1 text-xs text-gray-600">
                      Phiếu xuất kho {request.code} · Ngày lập {formatDate(request.created_at)}
                    </p>
                  </div>

                  <div className="mb-5 grid grid-cols-3 gap-3 text-center text-xs">
                    <div className="rounded border border-gray-300 p-2">
                      <p className="text-gray-500">Số đơn hàng</p>
                      <p className="mt-1 text-lg font-bold">{employee.orders.length || employee.summary?.order_count || 0}</p>
                    </div>
                    <div className="rounded border border-gray-300 p-2">
                      <p className="text-gray-500">Tổng số lượng giao</p>
                      <p className="mt-1 text-lg font-bold">{formatNumber(employeeTotalQuantity)} hộp</p>
                    </div>
                    <div className="rounded border border-gray-300 p-2">
                      <p className="text-gray-500">Tiền hàng theo đơn</p>
                      <p className="mt-1 text-lg font-bold">{formatVND(employeeOrderTotal || employee.summary?.amount || 0)}</p>
                    </div>
                  </div>

                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-700">Đơn hàng phụ trách</h3>
                  {employee.orders.length > 0 ? (
                    <table className="mb-5 w-full border-collapse border border-gray-300 text-left text-xs">
                      <thead>
                        <tr className="border-b border-gray-300 bg-gray-100 font-semibold">
                          <th className="border-r border-gray-300 px-2 py-2 text-center">STT</th>
                          <th className="border-r border-gray-300 px-2 py-2">Mã đơn</th>
                          <th className="border-r border-gray-300 px-2 py-2">Cửa hàng</th>
                          <th className="border-r border-gray-300 px-2 py-2 text-center">Ngày đơn</th>
                          <th className="border-r border-gray-300 px-2 py-2 text-right">Tiền hàng</th>
                          <th className="px-2 py-2">Thanh toán</th>
                        </tr>
                      </thead>
                      <tbody>
                        {employee.orders.map((order, index) => (
                          <tr key={order.id} className="border-b border-gray-200">
                            <td className="border-r border-gray-300 px-2 py-2 text-center">{index + 1}</td>
                            <td className="border-r border-gray-300 px-2 py-2 font-mono font-semibold">{order.order_number}</td>
                            <td className="border-r border-gray-300 px-2 py-2">
                              <span className="font-medium">{order.customer_name || "Chưa rõ cửa hàng"}</span>
                              {order.customer_code && <span className="ml-1 text-gray-500">({order.customer_code})</span>}
                            </td>
                            <td className="border-r border-gray-300 px-2 py-2 text-center">{order.order_date ? formatDate(order.order_date) : "—"}</td>
                            <td className="border-r border-gray-300 px-2 py-2 text-right font-semibold">{formatVND(order.amount)}</td>
                            <td className="px-2 py-2">{paymentMethodLabel(order)}</td>
                          </tr>
                        ))}
                        <tr className="bg-gray-100 font-bold">
                          <td colSpan={4} className="border-r border-gray-300 px-2 py-2 text-right">TỔNG TIỀN ĐƠN:</td>
                          <td className="border-r border-gray-300 px-2 py-2 text-right">{formatVND(employeeOrderTotal)}</td>
                          <td />
                        </tr>
                      </tbody>
                    </table>
                  ) : (
                    <p className="mb-5 border border-gray-300 px-3 py-4 text-center text-xs text-gray-500">
                      Không có chi tiết đơn hàng được lưu cho nhân viên này.
                    </p>
                  )}

                  <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-gray-700">Hàng phân bổ cho nhân viên trong chuyến</h3>
                  <p className="mb-2 text-[10px] text-gray-500">
                    Số lượng SKU là tổng phân bổ cho nhân viên trong chuyến, không phải chi tiết SKU của từng đơn.
                  </p>
                  {products.length > 0 ? (
                    <table className="w-full border-collapse border border-gray-300 text-left text-xs">
                      <thead>
                        <tr className="border-b border-gray-300 bg-gray-100 font-semibold">
                          <th className="border-r border-gray-300 px-2 py-2 text-center">STT</th>
                          <th className="border-r border-gray-300 px-2 py-2">Mã SKU</th>
                          <th className="border-r border-gray-300 px-2 py-2">Tên sản phẩm</th>
                          <th className="border-r border-gray-300 px-2 py-2 text-center">Quy cách (H/T)</th>
                          <th className="border-r border-gray-300 px-2 py-2 text-right">Thùng</th>
                          <th className="border-r border-gray-300 px-2 py-2 text-right">Hộp lẻ</th>
                          <th className="px-2 py-2 text-right">Tổng hộp</th>
                        </tr>
                      </thead>
                      <tbody>
                        {products.map(({ item, quantity }, index) => {
                          const { cartons, looseBoxes, bpc } = splitCartons(quantity, item.boxes_per_carton);
                          return (
                            <tr key={item.product_id} className="border-b border-gray-200">
                              <td className="border-r border-gray-300 px-2 py-2 text-center">{index + 1}</td>
                              <td className="border-r border-gray-300 px-2 py-2 font-mono">{item.sku}</td>
                              <td className="border-r border-gray-300 px-2 py-2 font-medium">{item.product_name}</td>
                              <td className="border-r border-gray-300 px-2 py-2 text-center">{bpc}</td>
                              <td className="border-r border-gray-300 px-2 py-2 text-right">{formatNumber(cartons)}</td>
                              <td className="border-r border-gray-300 px-2 py-2 text-right">{formatNumber(looseBoxes)}</td>
                              <td className="px-2 py-2 text-right font-bold">{formatNumber(quantity)}</td>
                            </tr>
                          );
                        })}
                        <tr className="bg-gray-100 font-bold">
                          <td colSpan={4} className="border-r border-gray-300 px-2 py-2 text-right">TỔNG:</td>
                          <td className="border-r border-gray-300 px-2 py-2 text-right">
                            {formatNumber(products.reduce((sum, product) => sum + splitCartons(product.quantity, product.item.boxes_per_carton).cartons, 0))}
                          </td>
                          <td className="border-r border-gray-300 px-2 py-2 text-right">
                            {formatNumber(products.reduce((sum, product) => sum + splitCartons(product.quantity, product.item.boxes_per_carton).looseBoxes, 0))}
                          </td>
                          <td className="px-2 py-2 text-right">{formatNumber(employeeTotalQuantity)}</td>
                        </tr>
                      </tbody>
                    </table>
                  ) : (
                    <p className="border border-gray-300 px-3 py-4 text-center text-xs text-gray-500">
                      Không có số lượng phân bổ chi tiết theo nhân viên trong dữ liệu phiếu.
                    </p>
                  )}

                  <div className="mt-10 grid grid-cols-2 gap-8 text-center text-xs page-break-inside-avoid">
                    <div>
                      <p className="font-bold uppercase">Người giao hàng</p>
                      <p className="mt-1 text-gray-500">(Ký và ghi rõ họ tên)</p>
                      <div className="h-20" />
                      <p className="font-semibold">{employee.employee_name || employee.employee_code}</p>
                    </div>
                    <div>
                      <p className="font-bold uppercase">Người nhận hàng</p>
                      <p className="mt-1 text-gray-500">(Ký và ghi rõ họ tên)</p>
                      <div className="h-20" />
                      <p>........................................</p>
                    </div>
                  </div>
                </section>
              );
            })}
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
          .employee-dispatch-page {
            break-before: page;
            page-break-before: always;
          }
          .employee-dispatch-page tr,
          .employee-dispatch-page th,
          .employee-dispatch-page td {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          .employee-dispatch-page thead {
            display: table-header-group;
          }
        }
      `}</style>
    </div>
  );
}

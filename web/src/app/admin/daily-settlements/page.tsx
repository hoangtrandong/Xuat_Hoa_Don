"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, ClipboardCheck, RefreshCw } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import Badge from "@/components/ui/Badge";
import DeliverySettlementModal from "@/components/delivery-requests/DeliverySettlementModal";
import { API_URL, apiFetch } from "@/lib/api";
import { formatVND } from "@/lib/format";

interface SettlementRequest {
  request_id: number;
  request_code: string;
  warehouse_id: number;
  warehouse_name: string;
  completed_at: string;
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
}

interface EmployeeDailySettlement {
  settlement_date: string;
  employee_id: number | null;
  employee_code: string;
  employee_name: string | null;
  delivery_requests_count: number;
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
  requests: SettlementRequest[];
}

interface WarehouseOption {
  id: number;
  name: string;
}

const vnToday = () => new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);

function reconciliationLabel(row: EmployeeDailySettlement) {
  if (Math.abs(row.difference) >= 0.01) return "Lệch tổng tiền đơn";
  if (row.unpaid > 0) return "Còn đơn chưa thu";
  if (row.remaining_cash_to_turn_in > 0) return "Còn tiền mặt cần nộp";
  return "Không còn khoản chờ theo dữ liệu hiện có";
}

export default function AdminDailySettlementsPage() {
  const [fromDate, setFromDate] = useState(vnToday);
  const [toDate, setToDate] = useState(vnToday);
  const [warehouseId, setWarehouseId] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [rows, setRows] = useState<EmployeeDailySettlement[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [selectedRequest, setSelectedRequest] = useState<SettlementRequest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    if (!fromDate || !toDate) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ from_date: fromDate, to_date: toDate });
      if (warehouseId) params.set("warehouse_id", warehouseId);
      const [settlementResponse, warehouseResponse] = await Promise.all([
        apiFetch(`${API_URL}/delivery-requests/daily-settlements?${params.toString()}`),
        apiFetch(`${API_URL}/inventory/warehouses/`),
      ]);
      const settlementPayload = await settlementResponse.json() as EmployeeDailySettlement[] | { detail?: string };
      if (!settlementResponse.ok) {
        throw new Error("detail" in settlementPayload ? settlementPayload.detail : "Không thể tải quyết toán ngày.");
      }
      const warehousePayload = await warehouseResponse.json() as WarehouseOption[] | { detail?: string };
      if (!warehouseResponse.ok) {
        throw new Error("detail" in warehousePayload ? warehousePayload.detail : "Không thể tải danh sách kho.");
      }
      setRows(settlementPayload as EmployeeDailySettlement[]);
      setWarehouses(warehousePayload as WarehouseOption[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Không thể tải dữ liệu quyết toán.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, warehouseId]);

  useEffect(() => {
    // Loading synchronizes this view with the selected date and warehouse filters.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
  }, [loadData]);

  const filteredRows = useMemo(() => rows.filter((row) => {
    const query = employeeFilter.trim().toLocaleLowerCase("vi");
    const matchesEmployee = !query
      || `${row.employee_code} ${row.employee_name ?? ""}`.toLocaleLowerCase("vi").includes(query);
    const hasDifference = Math.abs(row.difference) >= 0.01;
    const needsFollowUp = hasDifference || row.unpaid > 0 || row.remaining_cash_to_turn_in > 0;
    const matchesStatus = statusFilter === "ALL"
      || (statusFilter === "FOLLOW_UP" ? needsFollowUp : !needsFollowUp);
    return matchesEmployee && matchesStatus;
  }), [rows, employeeFilter, statusFilter]);

  const totals = useMemo(() => filteredRows.reduce((result, row) => ({
    employees: result.employees + 1,
    requests: result.requests + row.delivery_requests_count,
    allocated: result.allocated + row.allocated_amount,
    paidBank: result.paidBank + row.paid_bank,
    remaining: result.remaining + row.remaining_cash_to_turn_in,
    returned: result.returned + row.returned,
  }), { employees: 0, requests: 0, allocated: 0, paidBank: 0, remaining: 0, returned: 0 }), [filteredRows]);

  function toggleRow(row: EmployeeDailySettlement) {
    const key = `${row.settlement_date}:${row.employee_id ?? row.employee_code}`;
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function rowKey(row: EmployeeDailySettlement) {
    return `${row.settlement_date}:${row.employee_id ?? row.employee_code}`;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quyết toán ngày"
        subtitle="Tổng hợp phiếu đã xuất thành công theo ngày nghiệp vụ và nhân viên"
        actions={
          <button
            type="button"
            onClick={() => void loadData()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            Làm mới
          </button>
        }
      />

      <div className="rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-900">
        Đây là màn hình tổng hợp/đối soát từ các phiếu đã hoàn thành; không tạo thêm bút toán công nợ.
        Mọi khoản thu, trả hàng và điều chỉnh vẫn được ghi nhận tại chi tiết phiếu nguồn.
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
        <label className="text-sm text-gray-600">
          Từ ngày
          <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="mt-1 block rounded-lg border border-gray-200 px-3 py-2 text-sm" />
        </label>
        <label className="text-sm text-gray-600">
          Đến ngày
          <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="mt-1 block rounded-lg border border-gray-200 px-3 py-2 text-sm" />
        </label>
        <label className="text-sm text-gray-600">
          Kho
          <select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} className="mt-1 block min-w-40 rounded-lg border border-gray-200 px-3 py-2 text-sm">
            <option value="">Tất cả kho</option>
            {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
          </select>
        </label>
        <label className="text-sm text-gray-600">
          Nhân viên
          <input value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)} placeholder="Mã hoặc tên nhân viên" className="mt-1 block min-w-52 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
        </label>
        <label className="text-sm text-gray-600">
          Tình trạng đối chiếu
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="mt-1 block rounded-lg border border-gray-200 px-3 py-2 text-sm">
            <option value="ALL">Tất cả</option>
            <option value="FOLLOW_UP">Cần theo dõi</option>
            <option value="MATCHED">Không còn khoản chờ</option>
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
        <StatCard label="Nhân viên trong kết quả" value={totals.employees} icon={<ClipboardCheck size={20} />} color="bg-sky-50 text-sky-600" />
        <StatCard label="Phiếu đã xuất" value={totals.requests} icon={<ClipboardCheck size={20} />} color="bg-purple-50 text-purple-600" />
        <StatCard label="Tổng công nợ phát sinh" value={formatVND(totals.allocated)} icon={<ClipboardCheck size={20} />} color="bg-emerald-50 text-emerald-600" />
        <StatCard label="Đã chuyển khoản" value={formatVND(totals.paidBank)} icon={<ClipboardCheck size={20} />} color="bg-blue-50 text-blue-600" />
        <StatCard label="Tiền mặt còn phải nộp" value={formatVND(totals.remaining)} icon={<ClipboardCheck size={20} />} color="bg-amber-50 text-amber-600" />
        <StatCard label="Hàng trả / cấn trừ" value={formatVND(totals.returned)} icon={<ClipboardCheck size={20} />} color="bg-rose-50 text-rose-600" />
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <tr>
              <th className="w-10 px-3 py-3" />
              <th className="px-4 py-3 text-left">Ngày</th>
              <th className="px-4 py-3 text-left">Nhân viên</th>
              <th className="px-4 py-3 text-right">Phiếu / đơn</th>
              <th className="px-4 py-3 text-right">Tổng công nợ</th>
              <th className="px-4 py-3 text-right">Đã chuyển khoản</th>
              <th className="px-4 py-3 text-right">Khách trả tiền mặt</th>
              <th className="px-4 py-3 text-right">Tiền mặt cần nộp</th>
              <th className="px-4 py-3 text-right">Còn khách nợ</th>
              <th className="px-4 py-3 text-left">Đối chiếu</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-500">Đang tải quyết toán ngày...</td></tr>}
            {!loading && filteredRows.length === 0 && (
              <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-500">Không có phiếu xuất kho hoàn thành trong bộ lọc này.</td></tr>
            )}
            {!loading && filteredRows.map((row) => {
              const key = rowKey(row);
              const expanded = expandedRows.has(key);
              const needsFollowUp = Math.abs(row.difference) >= 0.01 || row.unpaid > 0 || row.remaining_cash_to_turn_in > 0;
              return (
                <Fragment key={key}>
                  <tr className="hover:bg-gray-50">
                    <td className="px-3 py-3">
                      <button type="button" onClick={() => toggleRow(row)} aria-label={expanded ? "Thu gọn chi tiết" : "Mở chi tiết"} className="rounded p-1 text-gray-500 hover:bg-gray-100">
                        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </button>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{new Date(`${row.settlement_date}T00:00:00`).toLocaleDateString("vi-VN")}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-gray-900">{row.employee_name || "—"}</p>
                      <p className="text-xs text-gray-500">{row.employee_code}</p>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.delivery_requests_count} phiếu / {row.orders_count} đơn</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatVND(row.allocated_amount)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-sky-700">{formatVND(row.paid_bank)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-indigo-700">{formatVND(row.paid_cash)}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-amber-700">{formatVND(row.remaining_cash_to_turn_in)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-600">{formatVND(row.unpaid)}</td>
                    <td className="px-4 py-3">
                      <Badge variant={needsFollowUp ? "warning" : "success"}>{reconciliationLabel(row)}</Badge>
                    </td>
                  </tr>
                  {expanded && (
                    <tr key={`${key}:details`}>
                      <td colSpan={10} className="bg-slate-50 px-8 py-4">
                        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                          <table className="w-full text-xs">
                            <thead className="bg-gray-100 text-gray-500">
                              <tr>
                                <th className="px-3 py-2 text-left">Phiếu xuất</th>
                                <th className="px-3 py-2 text-left">Kho / giờ hoàn thành</th>
                                <th className="px-3 py-2 text-right">Số đơn</th>
                                <th className="px-3 py-2 text-right">Tổng tiền</th>
                                <th className="px-3 py-2 text-right">Đã thu ngân hàng</th>
                                <th className="px-3 py-2 text-right">Khách trả tiền mặt</th>
                                <th className="px-3 py-2 text-right">Hàng trả / cấn trừ</th>
                                <th className="px-3 py-2 text-right">Tiền mặt cần nộp</th>
                                <th className="px-3 py-2 text-right">Còn khách nợ</th>
                                <th className="px-3 py-2 text-right">Lệch</th>
                                <th className="px-3 py-2" />
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {row.requests.map((request) => (
                                <tr key={request.request_id}>
                                  <td className="px-3 py-2 font-semibold text-gray-800">{request.request_code}</td>
                                  <td className="px-3 py-2 text-gray-600">
                                    {request.warehouse_name} · {new Date(request.completed_at).toLocaleString("vi-VN")}
                                  </td>
                                  <td className="px-3 py-2 text-right">{request.orders_count}</td>
                                  <td className="px-3 py-2 text-right font-medium">{formatVND(request.allocated_amount)}</td>
                                  <td className="px-3 py-2 text-right text-sky-700">{formatVND(request.paid_bank)}</td>
                                  <td className="px-3 py-2 text-right text-indigo-700">{formatVND(request.paid_cash)}</td>
                                  <td className="px-3 py-2 text-right text-rose-700">{formatVND(request.returned)}</td>
                                  <td className="px-3 py-2 text-right text-amber-700">{formatVND(request.remaining_cash_to_turn_in)}</td>
                                  <td className="px-3 py-2 text-right">{formatVND(request.unpaid)}</td>
                                  <td className="px-3 py-2 text-right">{formatVND(request.difference)}</td>
                                  <td className="px-3 py-2 text-right">
                                    <button type="button" onClick={() => setSelectedRequest(request)} className="whitespace-nowrap rounded-md border border-sky-200 px-2.5 py-1.5 font-medium text-sky-700 hover:bg-sky-50">
                                      Chi tiết phiếu
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {selectedRequest && (
        <DeliverySettlementModal
          requestId={selectedRequest.request_id}
          requestCode={selectedRequest.request_code}
          isOpen
          onClose={() => setSelectedRequest(null)}
          onSettled={() => void loadData()}
        />
      )}
    </div>
  );
}

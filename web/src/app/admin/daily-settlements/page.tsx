"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronDown, ChevronRight, RefreshCw, Receipt, ShoppingBag, Truck, Package } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Badge from "@/components/ui/Badge";
import { API_URL, apiFetch } from "@/lib/api";
import { formatVND } from "@/lib/format";

interface SettlementProduct {
  product_id: number;
  sku: string;
  product_name: string;
  unit_name?: string | null;
  boxes_per_carton: number;
  quantity: number;
  cartons: number;
  loose_boxes: number;
  returned_quantity: number;
  returned_cartons: number;
  returned_loose_boxes: number;
  net_quantity: number;
  net_cartons: number;
  net_loose_boxes: number;
  unit_price: number | null;
  amount: number | null;
  returned_amount: number;
  net_amount: number | null;
}

interface SettlementOrder {
  id: number;
  order_number: string;
  order_date: string | null;
  delivery_request_id: number;
  delivery_request_code: string;
  customer_code: string | null;
  customer_name: string | null;
  amount: number;
  paid_bank: number;
  paid_cash: number;
  transferred_debt: number;
  remaining_unpaid: number;
  payment_status: string;
  payment_method: string | null;
  bank_ref: string | null;
  note: string | null;
}

interface StoreOrderGroup {
  key: string;
  customerCode: string | null;
  customerName: string;
  orders: SettlementOrder[];
  amount: number;
  paidBank: number;
  paidCash: number;
  remainingUnpaid: number;
}

interface SettlementRequest {
  request_id: number;
  request_code: string;
  warehouse_id: number;
  warehouse_name: string;
  completed_at: string;
  orders_count: number;
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
  cash_remitted: number;
  cash_pending_remittance: number;
  remaining_employee_debt: number;
  difference: number;
  products?: SettlementProduct[];
  orders?: SettlementOrder[];
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
  if (row.remaining_employee_debt > 0) return "Còn công nợ nhân viên";
  return "Không còn khoản chờ theo dữ liệu hiện có";
}

function renderOrderStatusBadge(order: SettlementOrder) {
  if (order.payment_status === "PAID_BANK" || (order.payment_method === "BANK" && order.paid_bank >= order.amount)) {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-sky-100 text-sky-800">Chuyển khoản</span>;
  }
  if (order.payment_status === "PAID_CASH" || (order.payment_method === "CASH" && order.paid_cash >= order.amount)) {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-100 text-emerald-800">Tiền mặt</span>;
  }
  if (order.paid_bank > 0 && order.remaining_unpaid > 0) {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-blue-100 text-blue-800">CK một phần ({formatVND(order.paid_bank)})</span>;
  }
  if (order.payment_status === "TRANSFERRED_DEBT" || order.payment_method === "DEBT") {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-purple-100 text-purple-800">Ghi nợ cửa hàng</span>;
  }
  if (order.payment_status === "RETURNED" || order.payment_method === "RETURN") {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-rose-100 text-rose-800">Khách trả hàng</span>;
  }
  return <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-amber-100 text-amber-800">Chưa thanh toán</span>;
}

function groupOrdersByStore(orders: SettlementOrder[]): StoreOrderGroup[] {
  const groups = new Map<string, StoreOrderGroup>();
  for (const order of orders) {
    const customerCode = order.customer_code?.trim() || null;
    const customerName = order.customer_name?.trim() || "Chưa xác định cửa hàng";
    const key = customerCode
      ? `code:${customerCode.toLocaleUpperCase("vi")}`
      : order.customer_name?.trim()
        ? `name:${customerName.toLocaleLowerCase("vi")}`
        : `order:${order.id}`;
    const group = groups.get(key) ?? {
      key,
      customerCode,
      customerName,
      orders: [],
      amount: 0,
      paidBank: 0,
      paidCash: 0,
      remainingUnpaid: 0,
    };
    group.orders.push(order);
    group.amount += order.amount;
    group.paidBank += order.paid_bank;
    group.paidCash += order.paid_cash;
    group.remainingUnpaid += order.remaining_unpaid;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) =>
    a.customerName.localeCompare(b.customerName, "vi")
      || (a.customerCode ?? "").localeCompare(b.customerCode ?? "", "vi"),
  );
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
  const [employeeTab, setEmployeeTab] = useState<Record<string, "ORDERS" | "PRODUCTS">>({});
  const [remittanceRow, setRemittanceRow] = useState<EmployeeDailySettlement | null>(null);
  const [remittanceAmount, setRemittanceAmount] = useState("");
  const [remittanceError, setRemittanceError] = useState("");
  const [savingRemittance, setSavingRemittance] = useState(false);
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
    const needsFollowUp = hasDifference || row.unpaid > 0 || row.remaining_employee_debt > 0;
    const matchesStatus = statusFilter === "ALL"
      || (statusFilter === "FOLLOW_UP" ? needsFollowUp : !needsFollowUp);
    return matchesEmployee && matchesStatus;
  }), [rows, employeeFilter, statusFilter]);

  const submitRemittance = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!remittanceRow?.employee_id) {
      setRemittanceError("Không xác định được nhân viên của quyết toán ngày.");
      return;
    }
    setSavingRemittance(true);
    setRemittanceError("");
    try {
      const response = await apiFetch(`${API_URL}/cash-receipts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          party_type: "EMPLOYEE",
          party_id: remittanceRow.employee_id,
          settlement_date: remittanceRow.settlement_date,
          amount: Number(remittanceAmount),
          note: `Nộp tiền mặt quyết toán ngày ${remittanceRow.settlement_date}`,
        }),
      });
      const payload = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(payload.detail || "Không thể ghi nhận tiền nộp.");
      setRemittanceRow(null);
      setRemittanceAmount("");
      await loadData();
    } catch (submitError) {
      setRemittanceError(submitError instanceof Error ? submitError.message : "Không thể ghi nhận tiền nộp.");
    } finally {
      setSavingRemittance(false);
    }
  };

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
        subtitle="Tổng hợp công nợ theo ngày và nhân viên, gộp các đơn trong ngày qua nhiều chuyến"
        actions={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void loadData()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
              Làm mới
            </button>
            <Link
              href="/debt/bank-receipts"
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 shadow-sm"
            >
              <Receipt size={16} />
              Thu & Phân bổ chuyển khoản
            </Link>
          </div>
        }
      />

      <div className="rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-900">
        Bảng chính tổng hợp công nợ theo ngày và nhân viên. Chọn <strong>Chi tiết</strong> để xem khoản thu,
        hàng trả, tiền mặt đã nộp và các đơn được gom theo cửa hàng qua nhiều chuyến.
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

      <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left">Ngày</th>
              <th className="px-4 py-3 text-left">Nhân viên</th>
              <th className="px-4 py-3 text-right">Tổng công nợ</th>
              <th className="px-4 py-3 text-right">Chuyển khoản</th>
              <th className="px-4 py-3 text-right">Tiền mặt đã thu</th>
              <th className="px-4 py-3 text-right">Hàng trả</th>
              <th className="px-4 py-3 text-right">Còn công nợ NV</th>
              <th className="px-4 py-3 text-center">Chi tiết</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-500">Đang tải quyết toán ngày...</td></tr>}
            {!loading && filteredRows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-500">Không có phiếu xuất kho hoàn thành trong bộ lọc này.</td></tr>
            )}
            {!loading && filteredRows.map((row) => {
              const key = rowKey(row);
              const storeGroups = groupOrdersByStore(row.orders ?? []);
              const expanded = expandedRows.has(key);
              const needsFollowUp = Math.abs(row.difference) >= 0.01 || row.unpaid > 0 || row.remaining_employee_debt > 0;
              return (
                <Fragment key={key}>
                  <tr className="hover:bg-sky-50/50 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap">{new Date(`${row.settlement_date}T00:00:00`).toLocaleDateString("vi-VN")}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-gray-900">{row.employee_name || "—"}</p>
                      <p className="text-xs text-gray-500">{row.employee_code} · {storeGroups.length} cửa hàng · {row.orders_count} đơn</p>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatVND(row.allocated_amount)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-sky-700 font-medium">{formatVND(row.paid_bank)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-indigo-700 font-medium">{formatVND(row.paid_cash)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-rose-700 font-medium">{formatVND(row.returned)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-600 font-medium">{formatVND(row.remaining_employee_debt)}</td>
                    <td className="px-4 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => toggleRow(row)}
                        aria-expanded={expanded}
                        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-sky-200 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50"
                      >
                        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        {expanded ? "Ẩn chi tiết" : "Chi tiết"}
                      </button>
                    </td>
                  </tr>
                  {expanded && (
                    <tr key={`${key}:details`}>
                      <td colSpan={8} className="bg-slate-50/80 p-5">
                        <div className="space-y-4">
                          {/* Sub-header with Tab Switcher */}
                          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEmployeeTab((prev) => ({ ...prev, [key]: "ORDERS" }));
                                }}
                                className={`inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                                  (employeeTab[key] || "ORDERS") === "ORDERS"
                                    ? "bg-sky-600 text-white shadow"
                                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                }`}
                              >
                                <ShoppingBag size={14} />
                                Đơn hàng theo cửa hàng ({row.orders?.length || row.orders_count} đơn · {storeGroups.length} cửa hàng)
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEmployeeTab((prev) => ({ ...prev, [key]: "PRODUCTS" }));
                                }}
                                className={`inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                                  employeeTab[key] === "PRODUCTS"
                                    ? "bg-indigo-600 text-white shadow"
                                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                }`}
                              >
                                <Package size={14} />
                                Bảng kê mặt hàng xuất kho ({row.products?.length || 0} mặt hàng)
                              </button>
                            </div>
                            <div className="text-xs text-gray-500 font-medium">
                              Nhân viên: <strong className="text-gray-900">{row.employee_name || "—"}</strong> ({row.employee_code}) · Ngày {new Date(`${row.settlement_date}T00:00:00`).toLocaleDateString("vi-VN")}
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant={needsFollowUp ? "warning" : "success"}>{reconciliationLabel(row)}</Badge>
                              <button
                                type="button"
                                disabled={!row.employee_id || row.cash_pending_remittance <= 0}
                                onClick={() => {
                                  setRemittanceError("");
                                  setRemittanceRow(row);
                                  setRemittanceAmount(String(row.cash_pending_remittance));
                                }}
                                className="whitespace-nowrap rounded-md border border-emerald-200 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Ghi nhận nộp tiền
                              </button>
                            </div>
                          </div>

                          {(employeeTab[key] || "ORDERS") === "ORDERS" ? (
                            <>
                              {/* Top summary card for employee's daily orders */}
                              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-sky-100 bg-sky-50/60 p-3.5">
                                <div>
                                  <h4 className="text-sm font-bold text-sky-950 flex items-center gap-2">
                                    <ShoppingBag size={18} className="text-sky-600" />
                                    Quyết toán {storeGroups.length} cửa hàng · {row.orders?.length || row.orders_count} đơn trong ngày
                                  </h4>
                                  <p className="text-xs text-sky-700 mt-0.5">
                                    Các đơn cùng cửa hàng được gom qua mọi chuyến; từng mã đơn và phiếu xuất vẫn được giữ để tra cứu.
                                  </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-3 text-xs">
                                  <span className="rounded-md bg-white px-2.5 py-1 font-semibold text-gray-700 shadow-sm border border-sky-200">
                                    Tổng đơn: <span className="text-sky-700">{formatVND(row.orders_amount)}</span>
                                  </span>
                                  <span className="rounded-md bg-white px-2.5 py-1 font-semibold text-gray-700 shadow-sm border border-sky-200">
                                    Đã chuyển khoản: <span className="text-emerald-700">{formatVND(row.paid_bank)}</span>
                                  </span>
                                  <span className="rounded-md bg-white px-2.5 py-1 font-semibold text-gray-700 shadow-sm border border-sky-200">
                                    Tiền mặt: <span className="text-indigo-700">{formatVND(row.paid_cash)}</span>
                                  </span>
                                  <span className="rounded-md bg-white px-2.5 py-1 font-semibold text-gray-700 shadow-sm border border-sky-200">
                                    Còn lại chưa thu: <span className="text-amber-700">{formatVND(row.unpaid)}</span>
                                  </span>
                                  <span className="rounded-md bg-white px-2.5 py-1 font-semibold text-gray-700 shadow-sm border border-sky-200">
                                    Đã nộp kế toán: <span className="text-emerald-700">{formatVND(row.cash_remitted)}</span>
                                  </span>
                                  <span className="rounded-md bg-white px-2.5 py-1 font-semibold text-gray-700 shadow-sm border border-sky-200">
                                    Tiền mặt còn phải nộp: <span className="text-amber-700">{formatVND(row.cash_pending_remittance)}</span>
                                  </span>
                                  <span className="rounded-md bg-white px-2.5 py-1 font-semibold text-gray-700 shadow-sm border border-sky-200">
                                    Còn công nợ nhân viên: <span className="text-amber-700">{formatVND(row.remaining_employee_debt)}</span>
                                  </span>
                                </div>
                              </div>

                              {/* Orders Breakdown Table */}
                              <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
                                <table className="w-full text-xs">
                                  <thead className="bg-slate-100 text-slate-600 font-semibold border-b border-gray-200">
                                    <tr>
                                      <th className="px-3 py-2.5 text-center w-12">#</th>
                                      <th className="px-3 py-2.5 text-left">Mã đơn hàng</th>
                                      <th className="px-3 py-2.5 text-left">Khách hàng / Đại lý</th>
                                      <th className="px-3 py-2.5 text-left">Phiếu xuất</th>
                                      <th className="px-3 py-2.5 text-right">Giá trị đơn</th>
                                      <th className="px-3 py-2.5 text-right">Đã chuyển khoản</th>
                                      <th className="px-3 py-2.5 text-right">Khách trả tiền mặt</th>
                                      <th className="px-3 py-2.5 text-right">Còn lại chưa thu</th>
                                      <th className="px-3 py-2.5 text-center">Trạng thái</th>
                                      <th className="px-3 py-2.5 text-left">Ghi chú / GD</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100">
                                    {(!row.orders || row.orders.length === 0) ? (
                                      <tr>
                                        <td colSpan={10} className="px-4 py-6 text-center text-gray-500 italic">
                                          Chưa có chi tiết đơn hàng lẻ được liên kết với phiếu xuất kho này.
                                        </td>
                                      </tr>
                                    ) : (
                                      storeGroups.flatMap((group) => [
                                        <tr key={`${group.key}:summary`} className="bg-sky-50/80 border-y border-sky-100">
                                          <td className="px-3 py-2 font-semibold text-sky-900" colSpan={3}>
                                            <span>{group.customerName}</span>
                                            {group.customerCode && <span className="ml-2 font-mono text-[11px] text-sky-700">{group.customerCode}</span>}
                                            <span className="ml-2 text-[11px] font-medium text-slate-500">{group.orders.length} đơn</span>
                                          </td>
                                          <td className="px-3 py-2 text-right font-semibold text-gray-900 tabular-nums">{formatVND(group.amount)}</td>
                                          <td className="px-3 py-2 text-right font-medium text-sky-700 tabular-nums">{formatVND(group.paidBank)}</td>
                                          <td className="px-3 py-2 text-right font-medium text-indigo-700 tabular-nums">{formatVND(group.paidCash)}</td>
                                          <td className="px-3 py-2 text-right font-semibold text-amber-700 tabular-nums">{formatVND(group.remainingUnpaid)}</td>
                                          <td colSpan={3} />
                                        </tr>,
                                        ...group.orders.map((order, idx) => (
                                          <tr key={order.id} className="hover:bg-slate-50/70">
                                            <td className="px-3 py-2 text-center text-gray-400 font-mono">{idx + 1}</td>
                                            <td className="px-3 py-2 font-semibold text-gray-900">{order.order_number}</td>
                                            <td className="px-3 py-2 text-gray-500">{order.customer_name || group.customerName}</td>
                                            <td className="px-3 py-2 font-mono text-gray-600">{order.delivery_request_code}</td>
                                            <td className="px-3 py-2 text-right font-semibold text-gray-900 tabular-nums">{formatVND(order.amount)}</td>
                                            <td className="px-3 py-2 text-right tabular-nums text-sky-700 font-medium">
                                              {order.paid_bank > 0 ? formatVND(order.paid_bank) : "—"}
                                            </td>
                                            <td className="px-3 py-2 text-right tabular-nums text-indigo-700 font-medium">
                                              {order.paid_cash > 0 ? formatVND(order.paid_cash) : "—"}
                                            </td>
                                            <td className="px-3 py-2 text-right tabular-nums font-semibold text-amber-700">
                                              {order.remaining_unpaid > 0 ? formatVND(order.remaining_unpaid) : "0 ₫"}
                                            </td>
                                            <td className="px-3 py-2 text-center whitespace-nowrap">{renderOrderStatusBadge(order)}</td>
                                            <td className="px-3 py-2 text-gray-500 truncate max-w-44" title={order.note || order.bank_ref || ""}>
                                              {order.bank_ref && <span className="font-mono text-sky-700 mr-1">[{order.bank_ref}]</span>}
                                              {order.note || (order.bank_ref ? "" : "—")}
                                            </td>
                                          </tr>
                                        )),
                                      ])
                                    )}
                                  </tbody>
                                  {row.orders && row.orders.length > 0 && (
                                    <tfoot className="bg-slate-50 font-semibold border-t-2 border-gray-200">
                                      <tr>
                                        <td colSpan={4} className="px-3 py-2.5 text-right text-gray-700 uppercase tracking-wide">
                                          Tổng cộng {row.orders.length} đơn:
                                        </td>
                                        <td className="px-3 py-2.5 text-right font-bold text-gray-900 tabular-nums">
                                          {formatVND(row.orders_amount)}
                                        </td>
                                        <td className="px-3 py-2.5 text-right font-bold text-sky-700 tabular-nums">
                                          {formatVND(row.paid_bank)}
                                        </td>
                                        <td className="px-3 py-2.5 text-right font-bold text-indigo-700 tabular-nums">
                                          {formatVND(row.paid_cash)}
                                        </td>
                                        <td className="px-3 py-2.5 text-right font-bold text-amber-700 tabular-nums">
                                          {formatVND(row.unpaid)}
                                        </td>
                                        <td colSpan={2} />
                                      </tr>
                                    </tfoot>
                                  )}
                                </table>
                              </div>
                            </>
                          ) : (
                            <>
                              {/* Product quantities are historical; financial totals come from settlement records. */}
                              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-indigo-100 bg-indigo-50/60 p-3.5">
                                <div>
                                  <h4 className="text-sm font-bold text-indigo-950 flex items-center gap-2">
                                    <Package size={18} className="text-indigo-600" />
                                    Bảng kê mặt hàng xuất kho trong ngày — {row.products?.length || 0} mặt hàng
                                  </h4>
                                  <p className="text-xs text-indigo-700 mt-0.5">
                                    Đơn giá theo SKU không được lưu theo lịch sử xuất; số tiền đối soát xem theo phiếu/đơn hàng.
                                  </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-3 text-xs">
                                  <span className="rounded-md bg-white px-2.5 py-1 font-semibold text-gray-700 shadow-sm border border-indigo-200">
                                    Tổng xuất: <span className="text-indigo-700 font-bold">{row.products?.reduce((s, p) => s + p.cartons, 0) || 0} thùng {row.products?.reduce((s, p) => s + p.loose_boxes, 0) || 0} hộp</span>
                                  </span>
                                  <span className="rounded-md bg-white px-2.5 py-1 font-semibold text-gray-700 shadow-sm border border-indigo-200">
                                    Tổng phân bổ: <span className="text-slate-800 font-bold">{formatVND(row.allocated_amount)}</span>
                                  </span>
                                  <span className="rounded-md bg-white px-2.5 py-1 font-semibold text-gray-700 shadow-sm border border-indigo-200">
                                    Hàng trả về kho: <span className="text-rose-700">{row.products?.reduce((s, p) => s + p.returned_quantity, 0) || 0} hộp ({formatVND(row.returned)})</span>
                                  </span>
                                  <span className="rounded-md bg-white px-2.5 py-1 font-semibold text-gray-700 shadow-sm border border-indigo-200">
                                    Còn công nợ nhân viên: <span className="text-amber-700 font-bold">{formatVND(row.remaining_employee_debt)}</span>
                                  </span>
                                </div>
                              </div>

                              {/* Products Breakdown Table */}
                              <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
                                <table className="w-full text-xs">
                                  <thead className="bg-slate-100 text-slate-600 font-semibold border-b border-gray-200">
                                    <tr>
                                      <th className="px-3 py-2.5 text-center w-12">#</th>
                                      <th className="px-3 py-2.5 text-left">Mã SKU</th>
                                      <th className="px-3 py-2.5 text-left">Tên mặt hàng</th>
                                      <th className="px-3 py-2.5 text-center">ĐVT</th>
                                      <th className="px-3 py-2.5 text-center">Quy cách</th>
                                      <th className="px-3 py-2.5 text-right">Số lượng xuất</th>
                                      <th className="px-3 py-2.5 text-right">Trả về kho</th>
                                      <th className="px-3 py-2.5 text-right">Thực giao</th>
                                      <th className="px-3 py-2.5 text-right">Giá trị phiếu trả</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100">
                                    {(!row.products || row.products.length === 0) ? (
                                      <tr>
                                        <td colSpan={9} className="px-4 py-6 text-center text-gray-500 italic">
                                          Chưa có chi tiết mặt hàng xuất kho cho nhân viên này trong ngày.
                                        </td>
                                      </tr>
                                    ) : (
                                      row.products.map((product, idx) => (
                                        <tr key={product.product_id} className="hover:bg-slate-50/70">
                                          <td className="px-3 py-2 text-center text-gray-400 font-mono">{idx + 1}</td>
                                          <td className="px-3 py-2 font-mono font-bold text-gray-800">{product.sku}</td>
                                          <td className="px-3 py-2 font-medium text-gray-900">{product.product_name}</td>
                                          <td className="px-3 py-2 text-center text-gray-600">{product.unit_name || "Hộp"}</td>
                                          <td className="px-3 py-2 text-center text-gray-500">{product.boxes_per_carton} hộp/T</td>
                                          <td className="px-3 py-2 text-right tabular-nums font-semibold text-indigo-950">
                                            {product.cartons > 0 ? `${product.cartons}T ${product.loose_boxes > 0 ? `${product.loose_boxes}H` : ""}` : `${product.quantity}H`}
                                          </td>
                                          <td className="px-3 py-2 text-right tabular-nums text-rose-700 font-medium">
                                            {product.returned_quantity > 0 ? (
                                              <span>
                                                {product.returned_cartons > 0 ? `${product.returned_cartons}T ` : ""}
                                                {product.returned_loose_boxes > 0 ? `${product.returned_loose_boxes}H` : ""}
                                                {product.returned_amount > 0 && <span className="block text-[10px] text-rose-600">(-{formatVND(product.returned_amount)})</span>}
                                              </span>
                                            ) : "—"}
                                          </td>
                                          <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-800">
                                            {product.net_cartons > 0 ? `${product.net_cartons}T ${product.net_loose_boxes > 0 ? `${product.net_loose_boxes}H` : ""}` : `${product.net_quantity}H`}
                                          </td>
                                          <td className="px-3 py-2 text-right tabular-nums font-bold text-emerald-900">
                                            {product.returned_amount > 0 ? formatVND(product.returned_amount) : "—"}
                                          </td>
                                        </tr>
                                      ))
                                    )}
                                  </tbody>
                                  {row.products && row.products.length > 0 && (
                                    <tfoot className="bg-slate-50 font-semibold border-t-2 border-gray-200">
                                      <tr>
                                        <td colSpan={5} className="px-3 py-2.5 text-right text-gray-700 uppercase tracking-wide">
                                          Tổng cộng {row.products.length} mặt hàng:
                                        </td>
                                        <td className="px-3 py-2.5 text-right font-bold text-indigo-950 tabular-nums">
                                          {row.products.reduce((s, p) => s + p.cartons, 0)}T {row.products.reduce((s, p) => s + p.loose_boxes, 0)}H
                                        </td>
                                        <td className="px-3 py-2.5 text-right font-bold text-rose-700 tabular-nums">
                                          {formatVND(row.products.reduce((s, p) => s + p.returned_amount, 0))}
                                        </td>
                                        <td className="px-3 py-2.5 text-right font-bold text-emerald-800 tabular-nums">
                                          {row.products.reduce((s, p) => s + p.net_cartons, 0)}T {row.products.reduce((s, p) => s + p.net_loose_boxes, 0)}H
                                        </td>
                                      </tr>
                                    </tfoot>
                                  )}
                                </table>
                              </div>
                            </>
                          )}

                          {/* Related Delivery Requests Accordion / Section */}
                          <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
                            <h5 className="text-xs font-bold text-gray-700 flex items-center gap-1.5 mb-2.5">
                              <Truck size={14} className="text-gray-500" />
                              Phiếu xuất liên quan để tra cứu ({row.requests.length} phiếu)
                            </h5>
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead className="bg-gray-50 text-gray-500">
                                  <tr>
                                    <th className="px-3 py-2 text-left">Phiếu xuất</th>
                                    <th className="px-3 py-2 text-left">Kho / giờ hoàn thành</th>
                                    <th className="px-3 py-2 text-right">Số đơn liên quan</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {row.requests.map((request) => (
                                    <tr key={request.request_id} className="hover:bg-gray-50">
                                      <td className="px-3 py-2 font-semibold text-gray-800">{request.request_code}</td>
                                      <td className="px-3 py-2 text-gray-600">
                                        {request.warehouse_name} · {new Date(request.completed_at).toLocaleString("vi-VN")}
                                      </td>
                                      <td className="px-3 py-2 text-right">{request.orders_count}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
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

      {remittanceRow && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" role="presentation">
          <form
            onSubmit={submitRemittance}
            className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cash-remittance-title"
          >
            <h2 id="cash-remittance-title" className="text-lg font-bold text-gray-900">Ghi nhận nộp tiền mặt</h2>
            <p className="mt-1 text-sm text-gray-600">
              {remittanceRow.employee_name || remittanceRow.employee_code} · Ngày {new Date(`${remittanceRow.settlement_date}T00:00:00`).toLocaleDateString("vi-VN")}
              {" "}· Tiền mặt còn phải nộp {formatVND(remittanceRow.cash_pending_remittance)}
            </p>
            <label className="mt-4 block text-sm font-medium text-gray-700" htmlFor="remittance-amount">
              Số tiền nộp
            </label>
            <input
              id="remittance-amount"
              type="number"
              min="0.01"
              max={remittanceRow.cash_pending_remittance}
              step="1"
              required
              autoFocus
              value={remittanceAmount}
              onChange={(event) => setRemittanceAmount(event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-right font-semibold tabular-nums focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            />
            {remittanceError && <p className="mt-3 text-sm text-red-600" role="alert">{remittanceError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={savingRemittance}
                onClick={() => setRemittanceRow(null)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={savingRemittance || Number(remittanceAmount) <= 0}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingRemittance ? "Đang lưu..." : "Xác nhận nộp"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Truck,
  X,
  Search,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  PackageSearch,
  Users,
  Layers,
  RefreshCw,
} from "lucide-react";
import { API_URL, apiFetch } from "@/lib/api";
import { formatNumber, formatVND, splitCartons } from "@/lib/format";

const inputCls =
  "w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-100";

type DispatchPoolOrderItem = {
  product_id: number;
  sku: string;
  product_name: string;
  boxes_per_carton: number;
  quantity: number;
  price: number;
  line_total: number;
};

type DispatchPoolOrder = {
  id: number;
  code: string;
  order_date: string | null;
  status: string;
  warehouse_id: number;
  customer_id: number;
  customer_code: string;
  customer_name: string;
  customer_address: string | null;
  sales_employee_code: string | null;
  sales_employee_name: string | null;
  total: number;
  note: string | null;
  items: DispatchPoolOrderItem[];
  dispatched_request_id: number | null;
  dispatched_request_code: string | null;
  dispatched_request_status: string | null;
};

type WarehouseOption = {
  id: number;
  code: string;
  name: string;
};

type EmployeeOption = {
  id: number;
  code: string;
  name: string;
  position: string;
  status: string;
};

type FefoPick = {
  lot_id: number | null;
  location_code: string | null;
  lot_number: string | null;
  expiry_date: string | null;
  quantity: number;
  allocation_strategy: string;
};

type FefoPlanItem = {
  product_id: number;
  sku: string;
  product_name: string;
  boxes_per_carton?: number;
  quantity: number;
  planned_quantity: number;
  shortage_quantity: number;
  picks: FefoPick[];
};

export default function DeliveryRequestBatchCreateModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (created: { id: number; code: string }) => void | Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [orders, setOrders] = useState<DispatchPoolOrder[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);

  const [warehouseId, setWarehouseId] = useState<number>(0);
  const [batchNote, setBatchNote] = useState<string>("");
  const [search, setSearch] = useState<string>("");

  // orderId -> employeeId (được chọn vào đợt)
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<number>>(new Set());
  const [assignedEmpByOrder, setAssignedEmpByOrder] = useState<Record<number, number>>({});
  const [bulkEmpId, setBulkEmpId] = useState<string>("");

  const [rightTab, setRightTab] = useState<"employees" | "summary">("employees");
  const [fefoLoading, setFefoLoading] = useState(false);
  const [fefoPlan, setFefoPlan] = useState<FefoPlanItem[] | null>(null);
  const [saving, setSaving] = useState(false);

  const loadPool = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [resPool, resWh, resEmp] = await Promise.all([
        apiFetch(`${API_URL}/delivery-requests/dispatch-pool?limit=500`),
        apiFetch(`${API_URL}/inventory/warehouses/`),
        apiFetch(`${API_URL}/employees/?limit=1000&status=active`),
      ]);
      if (!resPool.ok) {
        const d = await resPool.json().catch(() => ({}));
        throw new Error(d.detail || "Không thể tải danh sách đơn hàng chờ điều phối.");
      }
      const poolData = (await resPool.json()) as DispatchPoolOrder[];
      setOrders(poolData);

      if (resWh.ok) {
        const whData = (await resWh.json()) as WarehouseOption[];
        setWarehouses(whData);
        if (whData.length > 0) {
          setWarehouseId((prev) => prev || whData[0].id);
        }
      }
      if (resEmp.ok) {
        const empData = (await resEmp.json()) as EmployeeOption[];
        // Ưu tiên hiển thị nhân viên giao hàng lên đầu
        const sorted = [...empData].sort((a, b) => {
          const aDeliv = (a.position || "").toLowerCase().includes("giao hàng") ? 0 : 1;
          const bDeliv = (b.position || "").toLowerCase().includes("giao hàng") ? 0 : 1;
          if (aDeliv !== bDeliv) return aDeliv - bDeliv;
          return a.code.localeCompare(b.code);
        });
        setEmployees(sorted);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi khi tải dữ liệu điều phối.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setSelectedOrderIds(new Set());
    setAssignedEmpByOrder({});
    setBulkEmpId("");
    setFefoPlan(null);
    setBatchNote(`Đợt giao ${new Date().toLocaleDateString("vi-VN")}`);
    void loadPool();
  }, [open, loadPool]);

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) =>
      [o.code, o.customer_code, o.customer_name, o.customer_address || "", o.sales_employee_code || "", o.sales_employee_name || ""]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [orders, search]);

  const selectedOrders = useMemo(
    () => orders.filter((o) => selectedOrderIds.has(o.id)),
    [orders, selectedOrderIds]
  );

  // Đơn tổng gom SKU từ các đơn đã chọn
  const consolidatedItems = useMemo(() => {
    const map = new Map<
      number,
      {
        product_id: number;
        sku: string;
        product_name: string;
        boxes_per_carton: number;
        quantity: number;
      }
    >();
    for (const o of selectedOrders) {
      for (const it of o.items) {
        const prev = map.get(it.product_id);
        if (prev) {
          prev.quantity += it.quantity;
        } else {
          map.set(it.product_id, {
            product_id: it.product_id,
            sku: it.sku,
            product_name: it.product_name,
            boxes_per_carton: Math.max(1, it.boxes_per_carton || 1),
            quantity: it.quantity,
          });
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => a.sku.localeCompare(b.sku));
  }, [selectedOrders]);

  // Thống kê phân bổ theo từng NVGH
  const empById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  const employeeBreakdown = useMemo(() => {
    const groups = new Map<
      number,
      { employee: EmployeeOption; orders: DispatchPoolOrder[]; totalAmount: number; totalQty: number }
    >();
    let unassignedCount = 0;
    for (const o of selectedOrders) {
      const eid = assignedEmpByOrder[o.id];
      if (!eid || !empById.has(eid)) {
        unassignedCount++;
        continue;
      }
      const emp = empById.get(eid)!;
      const g = groups.get(eid) || { employee: emp, orders: [], totalAmount: 0, totalQty: 0 };
      g.orders.push(o);
      g.totalAmount += Number(o.total || 0);
      g.totalQty += o.items.reduce((s, it) => s + Number(it.quantity || 0), 0);
      groups.set(eid, g);
    }
    return {
      groups: Array.from(groups.values()).sort((a, b) => a.employee.code.localeCompare(b.employee.code)),
      unassignedCount,
    };
  }, [selectedOrders, assignedEmpByOrder, empById]);

  function toggleOrder(orderId: number) {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
    setFefoPlan(null);
  }

  function toggleSelectAllFiltered() {
    const allSelected =
      filteredOrders.length > 0 && filteredOrders.every((o) => selectedOrderIds.has(o.id));
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const o of filteredOrders) next.delete(o.id);
      } else {
        for (const o of filteredOrders) next.add(o.id);
      }
      return next;
    });
    setFefoPlan(null);
  }

  function assignEmployeeToOrder(orderId: number, empId: number) {
    setAssignedEmpByOrder((prev) => {
      const next = { ...prev };
      if (!empId) delete next[orderId];
      else next[orderId] = empId;
      return next;
    });
    if (empId && !selectedOrderIds.has(orderId)) {
      setSelectedOrderIds((prev) => new Set(prev).add(orderId));
      setFefoPlan(null);
    }
  }

  function handleBulkAssign() {
    const eid = Number(bulkEmpId);
    if (!eid || selectedOrderIds.size === 0) return;
    setAssignedEmpByOrder((prev) => {
      const next = { ...prev };
      for (const oid of selectedOrderIds) {
        next[oid] = eid;
      }
      return next;
    });
  }

  async function handleCheckFefo() {
    if (!warehouseId || consolidatedItems.length === 0) return;
    setFefoLoading(true);
    setError("");
    setRightTab("summary");
    try {
      const res = await apiFetch(`${API_URL}/delivery-requests/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          warehouse_id: warehouseId,
          items: consolidatedItems.map((it) => ({
            product_id: it.product_id,
            quantity: it.quantity,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Không thể tính tồn kho FEFO.");
      setFefoPlan(data as FefoPlanItem[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi khi kiểm tra tồn kho FEFO.");
    } finally {
      setFefoLoading(false);
    }
  }

  async function handleCreateBatch() {
    if (!warehouseId) {
      setError("Vui lòng chọn kho xuất hàng.");
      return;
    }
    if (selectedOrders.length === 0) {
      setError("Vui lòng chọn ít nhất 1 đơn hàng để gom vào đợt giao.");
      return;
    }
    if (employeeBreakdown.unassignedCount > 0) {
      setError(
        `Còn ${employeeBreakdown.unassignedCount} đơn hàng chưa được gán Nhân viên giao hàng. Vui lòng gán đầy đủ trước khi tạo đợt.`
      );
      return;
    }

    setSaving(true);
    setError("");
    try {
      const res = await apiFetch(`${API_URL}/delivery-requests/from-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          warehouse_id: warehouseId,
          note: batchNote.trim() || null,
          allocations: selectedOrders.map((o) => ({
            sales_order_id: o.id,
            employee_id: assignedEmpByOrder[o.id],
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Không thể tạo đợt giao hàng.");
      await onCreated({ id: data.id, code: data.code });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi khi tạo đợt giao hàng.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const fefoByProductId = new Map((fefoPlan || []).map((p) => [p.product_id, p]));
  const totalShortageSkus = (fefoPlan || []).filter((p) => p.shortage_quantity > 0).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden border border-slate-400 bg-white shadow-2xl">
        {/* HEADER chuẩn CreateOrderForm */}
        <header className="flex shrink-0 items-center justify-between bg-[#14263d] px-3 py-2 text-white">
          <div className="flex items-center gap-2">
            <Truck size={17} className="text-red-500" />
            <h2 className="text-xs font-bold uppercase tracking-wide text-white">
              Điều Phối Đợt Giao Hàng (Gom Đơn Tổng &amp; Phân Bổ NVGH)
            </h2>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="rounded p-1 text-white hover:bg-white/10"
          >
            <X size={16} />
          </button>
        </header>

        {/* THANH CẤU HÌNH ĐỢT */}
        <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-3 py-2">
          <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                Kho xuất hàng (Check FEFO)
              </label>
              <select
                value={warehouseId}
                onChange={(e) => {
                  setWarehouseId(Number(e.target.value));
                  setFefoPlan(null);
                }}
                className={inputCls}
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    [{w.code}] {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                Tên / Ghi chú Đợt giao
              </label>
              <input
                type="text"
                value={batchNote}
                onChange={(e) => setBatchNote(e.target.value)}
                placeholder="VD: Đợt 1 - Sáng 27/11"
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                Tìm đơn hàng / Khách hàng
              </label>
              <div className="relative">
                <Search
                  size={13}
                  className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Mã đơn, mã KH, tên KH, địa chỉ..."
                  className={`${inputCls} pl-7`}
                />
              </div>
            </div>
            <div>
              <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                Gán nhanh NVGH cho {selectedOrderIds.size} đơn đang chọn
              </label>
              <div className="flex gap-1.5">
                <select
                  value={bulkEmpId}
                  onChange={(e) => setBulkEmpId(e.target.value)}
                  className={inputCls}
                >
                  <option value="">-- Chọn NVGH --</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.code} - {e.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleBulkAssign}
                  disabled={!bulkEmpId || selectedOrderIds.size === 0}
                  className="shrink-0 rounded bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-indigo-700 disabled:bg-slate-300"
                >
                  Gán
                </button>
                <button
                  type="button"
                  onClick={() => void loadPool()}
                  disabled={loading}
                  title="Tải lại danh sách đơn chờ giao"
                  className="shrink-0 rounded border border-slate-300 bg-white p-1 text-slate-600 hover:bg-slate-100"
                >
                  <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
                </button>
              </div>
            </div>
          </div>

          {error && (
            <div className="mt-2 flex items-center gap-2 rounded border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
              <AlertTriangle size={14} className="shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* THÂN 2 CỘT */}
        <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-slate-200 overflow-hidden lg:grid-cols-12 lg:divide-x lg:divide-y-0">
          {/* CỘT TRÁI: DANH SÁCH ĐƠN CHỜ ĐIỀU PHỐI */}
          <div className="flex min-h-0 flex-col lg:col-span-7">
            <div className="flex shrink-0 items-center justify-between border-b border-sky-100 bg-sky-50/60 px-3 py-1.5">
              <span className="text-[11px] font-bold uppercase text-sky-800">
                1. Đơn hàng chờ điều phối ({filteredOrders.length}) — Đã chọn: {selectedOrderIds.size}
              </span>
              <button
                type="button"
                onClick={toggleSelectAllFiltered}
                className="text-[10px] font-semibold text-sky-700 hover:underline"
              >
                {filteredOrders.length > 0 && filteredOrders.every((o) => selectedOrderIds.has(o.id))
                  ? "Bỏ chọn tất cả"
                  : "Chọn tất cả"}
              </button>
            </div>

            <div className="flex-1 overflow-auto">
              <table className="w-full border-collapse text-left">
                <thead className="sticky top-0 z-10 bg-slate-100 text-[10px] font-semibold uppercase text-slate-600">
                  <tr className="border-b border-slate-200">
                    <th className="w-8 px-2 py-1.5 text-center">✓</th>
                    <th className="px-2 py-1.5">Mã đơn</th>
                    <th className="px-2 py-1.5">Khách hàng</th>
                    <th className="px-2 py-1.5 text-center">SKU</th>
                    <th className="px-2 py-1.5 text-right">Tổng tiền</th>
                    <th className="w-44 px-2 py-1.5">NVGH phụ trách</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-xs text-slate-500">
                        <span className="inline-flex items-center gap-2">
                          <Loader2 size={14} className="animate-spin text-sky-600" />
                          Đang tải đơn hàng chờ điều phối...
                        </span>
                      </td>
                    </tr>
                  ) : filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-xs text-slate-500">
                        Không có đơn hàng nào đang chờ điều phối.
                      </td>
                    </tr>
                  ) : (
                    filteredOrders.map((o) => {
                      const checked = selectedOrderIds.has(o.id);
                      const assignedId = assignedEmpByOrder[o.id] || 0;
                      return (
                        <tr
                          key={o.id}
                          className={`border-b border-slate-100 text-[11px] transition-colors hover:bg-sky-50/50 ${
                            checked ? "bg-sky-50/80" : "even:bg-amber-50/40"
                          }`}
                        >
                          <td className="px-2 py-1.5 text-center">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleOrder(o.id)}
                              className="h-3.5 w-3.5 cursor-pointer rounded border-slate-300 text-sky-600"
                            />
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5">
                            <div className="font-mono font-bold text-sky-800">{o.code}</div>
                            <div className="text-[10px] text-slate-400">{o.order_date || "—"}</div>
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="font-medium text-slate-800">
                              <span className="font-mono text-[10px] text-slate-500">{o.customer_code}</span>{" "}
                              {o.customer_name}
                            </div>
                            {o.customer_address && (
                              <div className="max-w-[240px] truncate text-[10px] text-slate-400" title={o.customer_address}>
                                {o.customer_address}
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-center font-semibold text-slate-700">
                            {o.items.length}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1.5 text-right font-medium text-slate-700">
                            {formatVND(o.total)}
                          </td>
                          <td className="px-2 py-1.5">
                            <select
                              value={assignedId || ""}
                              onChange={(e) => assignEmployeeToOrder(o.id, Number(e.target.value))}
                              className={`${inputCls} ${
                                checked && !assignedId ? "border-red-400 bg-red-50/60" : ""
                              }`}
                            >
                              <option value="">-- Chọn NVGH --</option>
                              {employees.map((e) => (
                                <option key={e.id} value={e.id}>
                                  {e.code} · {e.name}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* CỘT PHẢI: PHÂN BỔ NVGH & ĐƠN TỔNG CHECK FEFO */}
          <div className="flex min-h-0 flex-col lg:col-span-5">
            <div className="flex shrink-0 items-center justify-between border-b border-sky-100 bg-sky-50/60 px-2.5 py-1.5">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setRightTab("employees")}
                  className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-bold uppercase ${
                    rightTab === "employees"
                      ? "bg-sky-600 text-white"
                      : "text-sky-800 hover:bg-sky-100"
                  }`}
                >
                  <Users size={11} /> Phân bổ NVGH ({employeeBreakdown.groups.length})
                </button>
                <button
                  type="button"
                  onClick={() => setRightTab("summary")}
                  className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-bold uppercase ${
                    rightTab === "summary"
                      ? "bg-sky-600 text-white"
                      : "text-sky-800 hover:bg-sky-100"
                  }`}
                >
                  <Layers size={11} /> Đơn tổng ({consolidatedItems.length} SKU)
                </button>
              </div>
              <button
                type="button"
                disabled={fefoLoading || consolidatedItems.length === 0 || !warehouseId}
                onClick={() => void handleCheckFefo()}
                className="inline-flex items-center gap-1 rounded bg-emerald-700 px-2 py-1 text-[10px] font-semibold text-white hover:bg-emerald-800 disabled:bg-slate-300"
              >
                {fefoLoading ? <Loader2 size={11} className="animate-spin" /> : <PackageSearch size={11} />}
                Check FEFO
              </button>
            </div>

            <div className="flex-1 overflow-auto p-2.5">
              {rightTab === "employees" ? (
                <div className="space-y-2">
                  {employeeBreakdown.unassignedCount > 0 && (
                    <div className="flex items-center gap-1.5 rounded border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-800">
                      <AlertTriangle size={13} className="shrink-0" />
                      Còn {employeeBreakdown.unassignedCount} đơn đã chọn chưa gán NVGH.
                    </div>
                  )}
                  {employeeBreakdown.groups.length === 0 ? (
                    <div className="py-10 text-center text-xs text-slate-400">
                      Chọn đơn hàng bên trái và gán NVGH để xem bảng phân bổ từng chuyến xe.
                    </div>
                  ) : (
                    employeeBreakdown.groups.map((g) => (
                      <div
                        key={g.employee.id}
                        className="overflow-hidden rounded border border-slate-200 bg-white"
                      >
                        <div className="flex items-center justify-between bg-slate-100 px-2.5 py-1.5 text-xs">
                          <div className="font-bold text-indigo-900">
                            <span className="font-mono">{g.employee.code}</span> — {g.employee.name}
                          </div>
                          <div className="text-[11px] font-semibold text-slate-700">
                            {g.orders.length} đơn · {formatVND(g.totalAmount)}
                          </div>
                        </div>
                        <div className="divide-y divide-slate-100 px-2.5 py-1">
                          {g.orders.map((o) => (
                            <div
                              key={o.id}
                              className="flex items-center justify-between py-1 text-[11px]"
                            >
                              <div className="min-w-0 flex-1 pr-2">
                                <span className="font-mono font-semibold text-sky-800">{o.code}</span>{" "}
                                <span className="text-slate-700">{o.customer_name}</span>
                              </div>
                              <span className="shrink-0 font-medium text-slate-600">
                                {formatVND(o.total)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {fefoPlan && (
                    <div
                      className={`rounded border px-2.5 py-1.5 text-[11px] font-semibold ${
                        totalShortageSkus > 0
                          ? "border-red-300 bg-red-50 text-red-800"
                          : "border-emerald-300 bg-emerald-50 text-emerald-800"
                      }`}
                    >
                      {totalShortageSkus > 0
                        ? `Cảnh báo: Có ${totalShortageSkus} sản phẩm thiếu tồn kho khả dụng theo FEFO!`
                        : `Đủ hàng 100% cho cả ${fefoPlan.length} sản phẩm theo kế hoạch FEFO / HSD!`}
                    </div>
                  )}

                  {consolidatedItems.length === 0 ? (
                    <div className="py-10 text-center text-xs text-slate-400">
                      Chưa chọn đơn hàng nào để gom Đơn tổng.
                    </div>
                  ) : (
                    <table className="w-full border-collapse text-left">
                      <thead className="bg-slate-100 text-[10px] font-semibold uppercase text-slate-600">
                        <tr className="border-b border-slate-200">
                          <th className="px-2 py-1.5">SKU / Sản phẩm</th>
                          <th className="px-2 py-1.5 text-center">Tổng SL</th>
                          <th className="px-2 py-1.5">Lô FEFO / Vị trí</th>
                        </tr>
                      </thead>
                      <tbody>
                        {consolidatedItems.map((it) => {
                          const plan = fefoByProductId.get(it.product_id);
                          const { cartons, looseBoxes } = splitCartons(it.quantity, it.boxes_per_carton);
                          return (
                            <tr
                              key={it.product_id}
                              className="border-b border-slate-100 text-[11px] even:bg-amber-50/40"
                            >
                              <td className="px-2 py-1.5">
                                <div className="font-mono font-bold text-sky-800">{it.sku}</div>
                                <div className="text-[10px] text-slate-600">{it.product_name}</div>
                              </td>
                              <td className="whitespace-nowrap px-2 py-1.5 text-center font-semibold text-slate-800">
                                <div>{formatNumber(it.quantity)}</div>
                                {it.boxes_per_carton > 1 && (
                                  <div className="text-[9px] font-normal text-slate-500">
                                    {cartons}T/{looseBoxes}L
                                  </div>
                                )}
                              </td>
                              <td className="px-2 py-1.5 text-[10px]">
                                {!plan ? (
                                  <span className="italic text-slate-400">Bấm Check FEFO</span>
                                ) : (
                                  <div className="space-y-0.5">
                                    {plan.picks.map((pk, idx) => (
                                      <div key={idx} className="text-slate-700">
                                        <span className="font-mono font-bold text-indigo-800">
                                          {pk.location_code || "KHO"}
                                        </span>{" "}
                                        · Lô {pk.lot_number || "—"} · HSD{" "}
                                        {pk.expiry_date ? pk.expiry_date.slice(0, 10) : "—"}:{" "}
                                        <strong>{pk.quantity}</strong>
                                      </div>
                                    ))}
                                    {plan.shortage_quantity > 0 && (
                                      <div className="font-bold text-red-700">
                                        Thiếu: {plan.shortage_quantity}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* FOOTER chuẩn CreateOrderForm */}
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-300 bg-slate-100 px-3 py-2">
          <span className="text-[10px] text-slate-500">
            Đã chọn <strong>{selectedOrders.length}</strong> đơn ·{" "}
            <strong>{consolidatedItems.length}</strong> SKU ·{" "}
            <strong>{employeeBreakdown.groups.length}</strong> NVGH · Tổng tiền:{" "}
            <strong>
              {formatVND(selectedOrders.reduce((s, o) => s + Number(o.total || 0), 0))}
            </strong>
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="rounded bg-red-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-800"
            >
              Đóng
            </button>
            <button
              type="button"
              disabled={
                saving ||
                selectedOrders.length === 0 ||
                employeeBreakdown.unassignedCount > 0 ||
                !warehouseId
              }
              onClick={() => void handleCreateBatch()}
              className="inline-flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
              Tạo Đợt Giao ({selectedOrders.length} đơn)
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

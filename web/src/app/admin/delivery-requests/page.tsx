"use client";
import { useEffect, useState, useMemo } from "react";
import PageHeader from "@/components/ui/PageHeader";
import DataTable, { Column } from "@/components/ui/DataTable";
import Badge from "@/components/ui/Badge";
import Drawer from "@/components/ui/Drawer";
import StatCard from "@/components/ui/StatCard";
import DeliveryRequestExcelCreate from "@/components/delivery-requests/DeliveryRequestExcelCreate";
import DeliverySettlementModal from "@/components/delivery-requests/DeliverySettlementModal";
import DeliveryDispatchPrintModal from "@/components/delivery-requests/DeliveryDispatchPrintModal";
import { ClipboardList, Pencil, X, PackageSearch, CheckCircle2, AlertTriangle, FileDown, Send, Truck, Ban, Upload, Printer, RotateCcw } from "lucide-react";
import { API_URL, apiFetch } from "@/lib/api";
import { splitCartons, formatDateTime, formatDateKey } from "@/lib/format";


type Item = {
  id: number;
  product_id: number;
  sku: string;
  product_name: string;
  boxes_per_carton?: number;
  quantity: number;
  cartons?: number;
  loose_boxes?: number;
  requested_quantity_raw: string | null;
  employee_allocations?: Record<string, unknown> | null;
};
type EmployeeDebtSummary = { employee_id: number | null; employee_code: string; employee_name: string | null; amount: number; };
type DeliveryOrder = {
  id: number;
  order_date: string | null;
  order_number: string;
  employee_code: string;
  employee_name: string | null;
  customer_code: string | null;
  customer_name: string | null;
  amount: number;
  payment_status: string;
  payment_method: string | null;
  note: string | null;
};
type StockPick = {
  lot_id: number | null;
  location_code: string | null;
  location_id: number | null;
  lot_number: string | null;
  expiry_date: string | null;
  quantity: number;
  cartons?: number;
  loose_boxes?: number;
  allocation_strategy: string;
};
type StockPlanItem = {
  product_id: number;
  sku: string;
  product_name: string;
  boxes_per_carton?: number;
  quantity: number;
  cartons?: number;
  loose_boxes?: number;
  planned_quantity: number;
  shortage_quantity: number;
  picks: StockPick[];
};
type DeliveryRequest = {
  id: number;
  code: string;
  warehouse_id: number;
  status: "DRAFT" | "SUBMITTED" | "RECEIVED" | "COMPLETED" | "CANCELLED";
  note: string | null;
  created_by: string | null;
  submitted_at: string | null;
  received_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  items: Item[];
  employee_summaries?: EmployeeDebtSummary[];
  orders?: DeliveryOrder[];
  total_cartons?: number;
  total_loose_boxes?: number;
  total_quantity?: number;
};
type AdminDeliveryRequestRow = DeliveryRequest & {
  searchText: string;
  totalQuantity: number;
  totalCartons: number;
  totalLooseBoxes: number;
  skuSummary: string;
};

const statusLabel: Record<string, string> = { DRAFT: "Nháp", SUBMITTED: "Chờ nhận", RECEIVED: "Đang xuất", COMPLETED: "Hoàn thành", CANCELLED: "Đã hủy" };
const statusVariant: Record<string, "default" | "info" | "warning" | "success" | "danger"> = { DRAFT: "default", SUBMITTED: "warning", RECEIVED: "info", COMPLETED: "success", CANCELLED: "danger" };

function totalQuantityOf(request: Pick<DeliveryRequest, "items">) {
  return request.items.reduce((sum, item) => sum + item.quantity, 0);
}

function toSearchText(request: DeliveryRequest) {
  return [
    request.code,
    request.created_by,
    request.note,
    statusLabel[request.status],
    ...request.items.flatMap((item) => [item.sku, item.product_name]),
  ].filter(Boolean).join(" ");
}

function csvCell(value: string | number | null | undefined) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

export default function AdminDeliveryRequestsPage() {
  const [rows, setRows] = useState<DeliveryRequest[]>([]);
  const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("ALL"); const [dateFilter, setDateFilter] = useState<string>("");
  const [selected, setSelected] = useState<DeliveryRequest | null>(null);
  const [editing, setEditing] = useState(false); const [editNote, setEditNote] = useState(""); const [editItems, setEditItems] = useState<{ quantity: string; sku: string; product_name: string; product_id: number }[]>([]);
  const [stockPlan, setStockPlan] = useState<StockPlanItem[] | null>(null); const [checkingStock, setCheckingStock] = useState(false);
  const [settlementRow, setSettlementRow] = useState<DeliveryRequest | null>(null);
  const [printRow, setPrintRow] = useState<DeliveryRequest | null>(null);
  const [loadingPrint, setLoadingPrint] = useState(false);
  const [activeTab, setActiveTab] = useState<"list" | "create">(() => {
    if (typeof window === "undefined") return "list";
    return new URLSearchParams(window.location.search).get("tab") === "create" ? "create" : "list";
  });

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const r = await apiFetch(`${API_URL}/delivery-requests/`);
      if (!r.ok) throw new Error("Không thể tải danh sách yêu cầu.");
      const data: DeliveryRequest[] = await r.json();
      const sortedRows = data.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setRows(sortedRows);
      const requestId = Number(new URLSearchParams(window.location.search).get("request_id"));
      if (Number.isInteger(requestId) && requestId > 0) {
        const request = sortedRows.find((row) => row.id === requestId);
        if (request) {
          openDetail(request);
          const url = new URL(window.location.href);
          url.searchParams.delete("request_id");
          window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
        }
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Không thể tải dữ liệu."); }
  }

  function openDetail(row: DeliveryRequest) { setSelected(row); setEditing(false); setStockPlan(null); setError(""); setMessage(""); }

  function startEdit() {
    if (!selected) return;
    setEditNote(selected.note ?? "");
    setEditItems(selected.items.map((item) => ({ product_id: item.product_id, sku: item.sku, product_name: item.product_name, quantity: String(item.requested_quantity_raw || item.quantity) })));
    setStockPlan(null); setEditing(true);
  }

  async function saveEdit() {
    if (!selected) return;
    setLoading(true); setError(""); setMessage("");
    try {
      const items = editItems.map((item) => ({ product_id: item.product_id, quantity: parseInt(item.quantity) || 0, requested_quantity_raw: item.quantity }));
      const res = await apiFetch(`${API_URL}/delivery-requests/${selected.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ warehouse_id: selected.warehouse_id, note: editNote, items }) });
      const result = await res.json().catch(() => ({})) as { detail?: string };
      if (!res.ok) throw new Error(result.detail ?? "Không thể cập nhật yêu cầu.");
      setMessage("Đã cập nhật yêu cầu thành công."); setEditing(false); setStockPlan(null);
      await load();
      const updated = await apiFetch(`${API_URL}/delivery-requests/${selected.id}`);
      if (updated.ok) setSelected(await updated.json());
    } catch (e) { setError(e instanceof Error ? e.message : "Lỗi khi lưu."); } finally { setLoading(false); }
  }

  async function checkStock() {
    if (!selected) return;
    setCheckingStock(true); setError(""); setStockPlan(null);
    try {
      const items = selected.items.map((item) => ({ product_id: item.product_id, quantity: item.quantity }));
      const res = await apiFetch(`${API_URL}/delivery-requests/plan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ warehouse_id: selected.warehouse_id, items }) });
      const result = await res.json().catch(() => ({})) as StockPlanItem[] | { detail?: string };
      if (!res.ok) throw new Error((result as { detail?: string }).detail ?? "Không thể kiểm tra tồn kho.");
      setStockPlan(result as StockPlanItem[]);
    } catch (e) { setError(e instanceof Error ? e.message : "Lỗi kiểm tra tồn kho."); } finally { setCheckingStock(false); }
  }

  async function cancelRequest() {
    if (!selected) return;
    if (!confirm(`Bạn có chắc muốn hủy yêu cầu ${selected.code}?`)) return;
    setLoading(true); setError(""); setMessage("");
    try {
      const res = await apiFetch(`${API_URL}/delivery-requests/${selected.id}/cancel`, { method: "POST" });
      const result = await res.json().catch(() => ({})) as { detail?: string };
      if (!res.ok) throw new Error(result.detail ?? "Không thể hủy yêu cầu.");
      setMessage("Đã hủy yêu cầu thành công."); setSelected(null); setEditing(false); setStockPlan(null);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Lỗi khi hủy."); } finally { setLoading(false); }
  }

  async function openPrintPreview(request: DeliveryRequest) {
    setLoadingPrint(true);
    setError("");
    try {
      const response = await apiFetch(`${API_URL}/delivery-requests/${request.id}`);
      const result = await response.json() as DeliveryRequest | { detail?: string };
      if (!response.ok) {
        throw new Error("detail" in result ? result.detail : "Không thể tải chi tiết phiếu để in.");
      }
      setPrintRow(result as DeliveryRequest);
    } catch (printError) {
      setError(printError instanceof Error ? printError.message : "Không thể tải chi tiết phiếu để in.");
    } finally {
      setLoadingPrint(false);
    }
  }

  async function transition(action: "submit" | "receive" | "complete") {
    if (!selected) return;
    const successMap = { submit: "Đã gửi xác nhận — yêu cầu chuyển sang Chờ nhận.", receive: "Đã chuyển sang Đang xuất.", complete: "Đã hoàn thành xuất kho — tồn kho đã được trừ." };
    setLoading(true); setError(""); setMessage("");
    try {
      if (action === "submit" && stockPlan) {
        const items = selected.items.map((item) => {
          const planned = stockPlan.find((planItem) => planItem.product_id === item.product_id);
          return {
            product_id: item.product_id,
            quantity: item.quantity,
            requested_quantity_raw: item.requested_quantity_raw,
            planned_allocations: planned?.picks.map((pick) => ({
              lot_id: pick.lot_id,
              location_id: pick.location_id,
              location_code: pick.location_code,
              lot_number: pick.lot_number,
              expiry_date: pick.expiry_date,
              quantity: pick.quantity,
              allocation_strategy: pick.allocation_strategy,
            })),
          };
        });
        const planResponse = await apiFetch(`${API_URL}/delivery-requests/${selected.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ warehouse_id: selected.warehouse_id, note: selected.note, items }),
        });
        const planResult = await planResponse.json().catch(() => ({})) as { detail?: string };
        if (!planResponse.ok) throw new Error(planResult.detail ?? "Không thể lưu vị trí lấy hàng.");
      }
      const res = await apiFetch(`${API_URL}/delivery-requests/${selected.id}/${action}`, { method: "POST" });
      const result = await res.json().catch(() => ({})) as { detail?: string };
      if (!res.ok) throw new Error(result.detail ?? "Thao tác thất bại.");
      setMessage(successMap[action]); setStockPlan(null); setEditing(false);
      await load();
      const updated = await apiFetch(`${API_URL}/delivery-requests/${selected.id}`);
      if (updated.ok) setSelected(await updated.json());
    } catch (e) { setError(e instanceof Error ? e.message : "Thao tác thất bại."); } finally { setLoading(false); }
  }

  const enrichedRows = useMemo<AdminDeliveryRequestRow[]>(() => rows.map((row) => {
    const totalCartons = row.total_cartons ?? row.items.reduce((s, it) => {
      const { cartons } = splitCartons(it.quantity, it.boxes_per_carton);
      return s + cartons;
    }, 0);
    const totalLooseBoxes = row.total_loose_boxes ?? row.items.reduce((s, it) => {
      const { looseBoxes } = splitCartons(it.quantity, it.boxes_per_carton);
      return s + looseBoxes;
    }, 0);
    return {
      ...row,
      searchText: toSearchText(row),
      totalQuantity: totalQuantityOf(row),
      totalCartons,
      totalLooseBoxes,
      skuSummary: row.items.map((item) => `${item.sku} - ${item.product_name}`).join("; "),
    };
  }), [rows]);

  const stats = useMemo(() => ({
    total: rows.length,
    draft: rows.filter((row) => row.status === "DRAFT").length,
    submitted: rows.filter((row) => row.status === "SUBMITTED").length,
    received: rows.filter((row) => row.status === "RECEIVED").length,
    completed: rows.filter((row) => row.status === "COMPLETED").length,
    cancelled: rows.filter((row) => row.status === "CANCELLED").length,
  }), [rows]);

  const filteredRows = useMemo(() => enrichedRows.filter((r) => {
    if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
    if (dateFilter && formatDateKey(r.created_at) !== dateFilter) return false;
    return true;
  }), [enrichedRows, statusFilter, dateFilter]);

  const stockOk = stockPlan !== null && stockPlan.every((p) => p.shortage_quantity === 0);
  const totalShortage = stockPlan?.reduce((s, p) => s + p.shortage_quantity, 0) ?? 0;

  function exportCsv() {
    const headers = ["Mã yêu cầu", "Kho", "Người tạo", "Trạng thái", "Ngày tạo", "Số SKU", "Tổng số lượng", "Ghi chú", "Danh sách SKU"];
    const lines = filteredRows.map((row) => [
      row.code,
      row.warehouse_id,
      row.created_by ?? "",
      statusLabel[row.status] ?? row.status,
      formatDateTime(row.created_at),
      row.items.length,
      row.totalQuantity,
      row.note ?? "",
      row.skuSummary,
    ].map(csvCell).join(","));
    const csv = `\uFEFF${headers.map(csvCell).join(",")}\n${lines.join("\n")}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `delivery-requests-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const columns: Column<AdminDeliveryRequestRow>[] = [
    { key: "code", title: "Mã yêu cầu", sortable: true },
    { key: "items", title: "Số SKU", align: "center", render: (_, row) => <span className="font-medium">{row.items?.length || 0}</span> },
    {
      key: "totalQuantity",
      title: "Số lượng xuất",
      sortable: true,
      align: "right",
      render: (_, row) => (
        <div className="text-right">
          <span className="font-bold text-sky-950 block text-sm">
            {row.totalCartons > 0 ? `${row.totalCartons.toLocaleString("vi-VN")}T` : ""}
            {row.totalLooseBoxes > 0 ? ` ${row.totalLooseBoxes}H` : (row.totalCartons === 0 ? "0H" : "")}
          </span>
          <span className="text-[11px] text-gray-400">
            ({Number(row.totalQuantity || 0).toLocaleString("vi-VN")} hộp)
          </span>
        </div>
      ),
    },
    { key: "created_by", title: "Người tạo", render: (val) => <span className="text-gray-600">{val ? String(val) : "—"}</span> },
    { key: "created_at", title: "Ngày tạo", sortable: true, render: (_, row) => <span className="text-gray-600 text-xs">{formatDateTime(row.created_at)}</span> },
    { key: "status", title: "Trạng thái", sortable: true, render: (val) => <Badge variant={statusVariant[String(val)] ?? "default"}>{statusLabel[String(val)] ?? String(val)}</Badge> },
    {
      key: "actions",
      title: "Thao tác",
      align: "center",
      render: (_, row) => (
        <div className="flex items-center justify-center gap-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setPrintRow(row);
            }}
            title="In phiếu bốc xếp xuất kho"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-gray-50 hover:bg-gray-100 text-gray-700 transition-colors border border-gray-200"
          >
            <Printer size={13} /> In phiếu
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Quản lý yêu cầu xuất hàng" subtitle="Theo dõi toàn bộ danh sách các yêu cầu giao hàng" />
      {error && !selected && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>}
      {message && !selected && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg px-4 py-3 text-sm">{message}</div>}

      <div className="inline-flex rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
        <button onClick={() => setActiveTab("list")} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${activeTab === "list" ? "bg-sky-500 text-white shadow-sm" : "text-gray-600 hover:bg-gray-50"}`}>
          <ClipboardList size={16} /> Danh sách yêu cầu
        </button>
        <button onClick={() => setActiveTab("create")} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${activeTab === "create" ? "bg-sky-500 text-white shadow-sm" : "text-gray-600 hover:bg-gray-50"}`}>
          <Upload size={16} /> Tạo từ Excel
        </button>
      </div>

      {activeTab === "list" ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
            <StatCard label="Tổng yêu cầu" value={stats.total} icon={<ClipboardList size={20} />} color="bg-sky-50 text-sky-600" />
            <StatCard label="Nháp" value={stats.draft} icon={<Pencil size={20} />} color="bg-gray-50 text-gray-600" />
            <StatCard label="Chờ nhận" value={stats.submitted} icon={<Send size={20} />} color="bg-amber-50 text-amber-600" />
            <StatCard label="Đang xuất" value={stats.received} icon={<Truck size={20} />} color="bg-blue-50 text-blue-600" />
            <StatCard label="Hoàn thành" value={stats.completed} icon={<CheckCircle2 size={20} />} color="bg-emerald-50 text-emerald-600" />
            <StatCard label="Đã hủy" value={stats.cancelled} icon={<Ban size={20} />} color="bg-rose-50 text-rose-600" />
          </div>

          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Trạng thái</label>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full sm:w-48 bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
                <option value="ALL">Tất cả</option><option value="DRAFT">Nháp</option><option value="SUBMITTED">Chờ nhận</option><option value="RECEIVED">Đang xuất</option><option value="COMPLETED">Hoàn thành</option><option value="CANCELLED">Đã hủy</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Ngày tạo</label>
              <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="w-full sm:w-48 bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
            </div>
            {(statusFilter !== "ALL" || dateFilter) && <button onClick={() => { setStatusFilter("ALL"); setDateFilter(""); }} className="text-sm text-sky-600 hover:text-sky-800 font-medium pb-2">Xóa bộ lọc</button>}
          </div>

          <DataTable
            data={filteredRows}
            columns={columns}
            searchKeys={["searchText"]}
            searchPlaceholder="Tìm mã yêu cầu, SKU, sản phẩm, người tạo..."
            pageSize={15}
            onRowClick={openDetail}
            emptyMessage="Không có yêu cầu xuất kho nào"
            toolbar={
              <button onClick={exportCsv} disabled={filteredRows.length === 0} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
                <FileDown size={15} /> Xuất CSV
              </button>
            }
          />
        </>
      ) : (
        <DeliveryRequestExcelCreate
          embedded
          onCreated={async (request) => {
            await load();
            setActiveTab("list");
            setMessage(`Đã tạo yêu cầu ${request.code ?? ""}. Danh sách đã được cập nhật.`);
          }}
        />
      )}

      <Drawer open={selected !== null} onClose={() => { setSelected(null); setEditing(false); setStockPlan(null); setError(""); setMessage(""); }} title={editing ? "Chỉnh sửa yêu cầu" : "Chi tiết yêu cầu xuất kho"} subtitle={selected?.code}>
        {selected && (
          <div className="p-5 space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-sky-500 flex items-center justify-center flex-shrink-0"><ClipboardList size={20} className="text-white" /></div>
              <div className="flex-1 min-w-0"><p className="font-bold text-gray-900 text-sm truncate">{selected.code}</p><p className="text-xs text-gray-400">Kho #{selected.warehouse_id} · {selected.items.length} SKU · {totalQuantityOf(selected).toLocaleString("vi-VN")} sản phẩm</p></div>
              <Badge variant={statusVariant[selected.status] ?? "default"}>{statusLabel[selected.status]}</Badge>
            </div>
            {error && <div className="bg-red-50 border border-red-200 text-red-600 rounded-lg px-3 py-2 text-sm">{error}</div>}
            {message && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg px-3 py-2 text-sm">{message}</div>}

            {!editing ? (
              <>
                {/* Carton/Box Dispatch Summary Card */}
                {(() => {
                  const totalCartons = selected.total_cartons ?? selected.items.reduce((s, it) => s + splitCartons(it.quantity, it.boxes_per_carton).cartons, 0);
                  const totalLoose = selected.total_loose_boxes ?? selected.items.reduce((s, it) => s + splitCartons(it.quantity, it.boxes_per_carton).looseBoxes, 0);
                  const totalQty = selected.total_quantity ?? selected.items.reduce((s, it) => s + it.quantity, 0);
                  return (
                    <div className="grid grid-cols-3 gap-2 p-3.5 bg-gradient-to-r from-sky-50 to-indigo-50/40 rounded-xl border border-sky-100">
                      <div className="text-center">
                        <span className="text-[11px] font-semibold text-sky-800 uppercase block">Thùng nguyên</span>
                        <span className="text-2xl font-black text-sky-950 mt-0.5 block">{totalCartons.toLocaleString("vi-VN")} <span className="text-xs font-normal text-sky-700">thùng</span></span>
                      </div>
                      <div className="text-center border-x border-sky-200/60">
                        <span className="text-[11px] font-semibold text-amber-800 uppercase block">Hộp lẻ</span>
                        <span className="text-2xl font-black text-amber-950 mt-0.5 block">{totalLoose.toLocaleString("vi-VN")} <span className="text-xs font-normal text-amber-700">hộp</span></span>
                      </div>
                      <div className="text-center">
                        <span className="text-[11px] font-semibold text-gray-600 uppercase block">Tổng quy đổi</span>
                        <span className="text-2xl font-black text-gray-900 mt-0.5 block">{totalQty.toLocaleString("vi-VN")} <span className="text-xs font-normal text-gray-500">hộp</span></span>
                      </div>
                    </div>
                  );
                })()}

                <div className="rounded-xl bg-gray-50 px-4 py-3 space-y-2">
                  <div className="flex justify-between text-sm"><span className="text-gray-400">Người tạo</span><span className="text-gray-700 font-medium">{selected.created_by || "—"}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-gray-400">Ngày tạo</span><span className="text-gray-700">{formatDateTime(selected.created_at)}</span></div>
                  {selected.note && <div className="flex justify-between text-sm"><span className="text-gray-400">Ghi chú</span><span className="text-gray-700 text-right max-w-[60%]">{selected.note}</span></div>}
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">Tiến trình xử lý</h4>
                  <div className="space-y-2">
                    {[
                      { label: "Tạo phiếu (Nháp)", time: selected.created_at, done: true, cancelled: false },
                      { label: "Gửi xác nhận (Chờ nhận)", time: selected.submitted_at, done: !!selected.submitted_at, cancelled: false },
                      { label: "Thủ kho nhận (Đang xuất)", time: selected.received_at, done: !!selected.received_at, cancelled: false },
                      { label: selected.cancelled_at ? "Đã hủy" : "Hoàn thành xuất kho", time: selected.cancelled_at || selected.completed_at, done: !!(selected.cancelled_at || selected.completed_at), cancelled: !!selected.cancelled_at },
                    ].map((step, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <div className={`w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center mt-0.5 text-xs font-bold ${step.cancelled ? "bg-red-100 text-red-500 ring-1 ring-red-300" : step.done ? "bg-emerald-100 text-emerald-600 ring-1 ring-emerald-300" : "bg-gray-100 text-gray-400"}`}>
                          {step.cancelled ? "×" : step.done ? "✓" : i + 1}
                        </div>
                        <div className="flex-1">
                          <p className={`text-sm ${step.done ? "text-gray-800 font-medium" : "text-gray-400"}`}>{step.label}</p>
                          {step.time && <p className="text-xs text-gray-400">{formatDateTime(step.time)}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-semibold text-gray-700">Danh sách sản phẩm ({selected.items.length} SKU)</h4>
                    <span className="text-xs text-gray-400">Thùng (T) / Hộp (H)</span>
                  </div>
                  <div className="rounded-xl border border-gray-100 divide-y divide-gray-50">
                    {selected.items.map((item, idx) => {
                      const { cartons, looseBoxes, bpc } = splitCartons(item.quantity, item.boxes_per_carton);
                      return (
                        <div key={item.id ?? idx} className="flex items-center justify-between px-4 py-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800 truncate">{item.product_name}</p>
                            <p className="text-xs text-gray-400">{item.sku} · 1T = {bpc}H</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-bold text-sky-950">
                              {cartons > 0 && <span className="text-sky-800">{cartons}T </span>}
                              {looseBoxes > 0 && <span className="text-amber-800">{looseBoxes}H</span>}
                              {cartons === 0 && looseBoxes === 0 && <span>0H</span>}
                            </p>
                            <p className="text-xs text-gray-400">({item.quantity.toLocaleString("vi-VN")} hộp)</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {stockPlan && (
                  <div className={`rounded-xl border px-4 py-3 space-y-2 ${stockOk ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
                    <div className="flex items-center gap-2 mb-1">
                      {stockOk ? <CheckCircle2 size={16} className="text-emerald-600" /> : <AlertTriangle size={16} className="text-amber-600" />}
                      <p className={`text-sm font-semibold ${stockOk ? "text-emerald-700" : "text-amber-700"}`}>{stockOk ? "Tồn kho đủ — sẵn sàng xuất kho" : `Thiếu ${totalShortage} đơn vị`}</p>
                    </div>
                    {stockPlan.map((plan, i) => (
                      <div key={i} className="text-xs">
                        <div className="flex justify-between">
                          <span className="text-gray-600 font-medium">{plan.sku} — {plan.product_name}</span>
                          {plan.shortage_quantity > 0 ? <span className="text-red-600 font-bold">Thiếu {plan.shortage_quantity}</span> : <span className="text-emerald-600 font-medium">✓ Đủ ({plan.planned_quantity})</span>}
                        </div>
                        {plan.picks.filter(p => p.location_code).map((pick, j) => {
                          const { cartons, looseBoxes } = splitCartons(pick.quantity, plan.boxes_per_carton);
                          return (
                            <p key={j} className="text-gray-500 pl-2">
                              + {pick.location_code ?? "Không xác định"} · Lô {pick.lot_number ?? "không mã"} · HSD {pick.expiry_date ? new Date(pick.expiry_date).toLocaleDateString("vi-VN") : "—"} · <span className="font-semibold text-gray-800">Lấy: {cartons > 0 ? `${cartons}T ` : ""}{looseBoxes > 0 ? `${looseBoxes}H ` : ""}({pick.quantity} hộp)</span>
                            </p>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}

                {selected.employee_summaries?.length && (selected.status === "DRAFT" || selected.status === "SUBMITTED") ? (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    Phiếu có công nợ theo nhân viên. Không thể sửa mặt hàng riêng lẻ vì sẽ làm lệch số tiền đã xác nhận; hãy tạo lại phiếu từ file Excel đã cập nhật.
                  </p>
                ) : null}
                {(selected.status === "DRAFT" || selected.status === "SUBMITTED" || selected.status === "RECEIVED") && (
                  <div className="space-y-2 pt-1 border-t border-gray-100">
                    {selected.status === "DRAFT" && <>
                      <p className="text-xs text-gray-500 font-medium pt-1">📝 Phiếu nháp — kiểm tra tồn kho trước khi gửi xác nhận.</p>
                      <button onClick={checkStock} disabled={checkingStock} className="flex items-center justify-center gap-2 w-full rounded-lg border border-sky-200 bg-sky-50 hover:bg-sky-100 text-sky-700 py-2.5 text-sm font-medium transition-colors disabled:opacity-50">
                        <PackageSearch size={15} />{checkingStock ? "Đang kiểm tra..." : "Kiểm tra tồn kho (FEFO)"}
                      </button>
                      <button onClick={() => transition("submit")} disabled={loading || !stockOk} title={!stockPlan ? "Hãy kiểm tra tồn kho trước" : !stockOk ? "Tồn kho không đủ" : ""} className="flex items-center justify-center gap-2 w-full rounded-lg bg-sky-500 hover:bg-sky-600 disabled:opacity-40 disabled:cursor-not-allowed text-white py-2.5 text-sm font-medium transition-colors">
                        {loading ? "Đang xử lý..." : "✓ Gửi xác nhận xuất kho"}
                      </button>
                    </>}
                    {selected.status === "SUBMITTED" && <>
                      <p className="text-xs text-amber-600 font-medium pt-1">📦 Chờ thủ kho nhận — có thể chỉnh sửa, chuyển tiếp hoặc hủy.</p>
                      <button onClick={() => transition("receive")} disabled={loading} className="flex items-center justify-center gap-2 w-full rounded-lg bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white py-2.5 text-sm font-medium transition-colors">
                        {loading ? "Đang xử lý..." : "✓ Chuyển sang Đang xuất"}
                      </button>
                    </>}
                    {selected.status === "RECEIVED" && <>
                      <p className="text-xs text-sky-600 font-medium pt-1">🚚 Đang xuất — đánh dấu hoàn thành để trừ tồn kho.</p>
                      <button onClick={() => transition("complete")} disabled={loading} className="flex items-center justify-center gap-2 w-full rounded-lg bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white py-2.5 text-sm font-medium transition-colors">
                        {loading ? "Đang xử lý..." : "✓ Đánh dấu Hoàn thành"}
                      </button>
                    </>}
                    {(selected.status === "DRAFT" || selected.status === "SUBMITTED") && (
                      <button onClick={startEdit} disabled={Boolean(selected.employee_summaries?.length)} title={selected.employee_summaries?.length ? "Phiếu có công nợ nhân viên; hãy tạo lại từ file Excel đã cập nhật." : ""} className="flex items-center justify-center gap-2 w-full rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50">
                        <Pencil size={15} /> Chỉnh sửa nội dung
                      </button>
                    )}
                    <button onClick={cancelRequest} disabled={loading} className="flex items-center justify-center gap-2 w-full rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-600 py-2.5 text-sm font-medium transition-colors disabled:opacity-50">
                      <X size={15} />{loading ? "Đang xử lý..." : "Hủy yêu cầu"}
                    </button>
                  </div>
                )}
                <button
                  onClick={() => void openPrintPreview(selected)}
                  disabled={loadingPrint}
                  className="flex items-center justify-center gap-2 w-full rounded-lg bg-gray-900 hover:bg-gray-800 text-white py-2.5 text-sm font-semibold transition-colors shadow-xs mt-3"
                >
                  <Printer size={16} /> {loadingPrint ? "Đang tải chi tiết phiếu..." : "In Phiếu Bốc Xếp & Xuất Kho"}
                </button>
                {selected.status === "COMPLETED" && (
                  <button
                    onClick={() => {
                      setSettlementRow(selected);
                    }}
                    className="flex items-center justify-center gap-2 w-full rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 text-sm font-semibold transition-colors shadow-xs mt-2"
                  >
                    <RotateCcw size={16} /> Biên bản giao hàng & Trả hàng về kho
                  </button>
                )}
                <button onClick={() => { setSelected(null); setEditing(false); setStockPlan(null); }} className="rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 w-full mt-2">Đóng</button>
              </>
            ) : (
              <>
                <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">✏️ Đang chỉnh sửa — mọi thay đổi được áp dụng ngay khi lưu.</div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Ghi chú</label>
                  <textarea value={editNote} onChange={(e) => setEditNote(e.target.value)} rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none" placeholder="Ghi chú (tùy chọn)" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">Chỉnh sửa số lượng</h4>
                  <div className="space-y-2">
                    {editItems.map((item, idx) => (
                      <div key={idx} className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 bg-gray-50">
                        <div className="flex-1 min-w-0"><p className="text-sm font-medium text-gray-800 truncate">{item.product_name}</p><p className="text-xs text-gray-400">{item.sku}</p></div>
                        <input type="text" value={item.quantity} onChange={(e) => { const next = [...editItems]; next[idx] = { ...next[idx], quantity: e.target.value }; setEditItems(next); }} className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white" placeholder="SL" />
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 mt-1.5">💡 Hỗ trợ định dạng thùng/lẻ (vd: <code>3/2</code>)</p>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button onClick={() => setEditing(false)} className="rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50">Hủy chỉnh sửa</button>
                  <button onClick={saveEdit} disabled={loading} className="rounded-lg bg-sky-500 hover:bg-sky-600 text-white py-2.5 text-sm font-medium transition-colors disabled:opacity-50">{loading ? "Đang lưu..." : "Lưu thay đổi"}</button>
                </div>
              </>
            )}
          </div>
        )}
      </Drawer>

      {settlementRow && (
        <DeliverySettlementModal
          requestId={settlementRow.id}
          requestCode={settlementRow.code}
          isOpen={Boolean(settlementRow)}
          onClose={() => setSettlementRow(null)}
          onSettled={load}
        />
      )}

      {printRow && (
        <DeliveryDispatchPrintModal
          open={Boolean(printRow)}
          onClose={() => setPrintRow(null)}
          request={printRow}
        />
      )}
    </div>
  );
}

"use client";
// src/app/warehouse/inventory/page.tsx
import { useEffect, useState } from "react";
import { Boxes, CircleDollarSign, TriangleAlert, ArrowDownUp, Warehouse as WarehouseIcon, SlidersHorizontal, Download } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import DataTable, { Column } from "@/components/ui/DataTable";
import Badge from "@/components/ui/Badge";
import Tabs from "@/components/ui/Tabs";
import Drawer from "@/components/ui/Drawer";
import { ledgerLabels, type StockLevel, type LedgerEntry, type LedgerType } from "@/lib/mock-inventory";
import { formatVND, formatDateTime, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { API_URL, apiFetch } from "@/lib/api";
import { downloadExcel } from "@/lib/excel";

interface ApiStockLevel {
  product_id: number;
  product_code: string;
  product_name: string;
  unit: string;
  on_hand: number;
  reserved: number;
  available: number;
  reorder_level: number;
  lot_count?: number;
  earliest_expiry?: string | null;
  locations?: string | null;
}

interface ApiTransaction {
  id: number;
  code: string;
  type: LedgerType;
  warehouse_id: number;
  product_id: number;
  quantity: number;
  ref_type: string | null;
  ref_code: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

interface ApiWarehouse {
  id: number;
  code: string;
  name: string;
  location?: string;
  manager?: string;
}

interface ApiLocation {
  id: number;
  warehouse_id: number;
  code: string;
  name?: string | null;
  is_active: boolean;
}

interface ApiLot {
  id: number;
  warehouse_id: number;
  location_id?: number | null;
  product_id: number;
  expiry_date?: string | null;
  quantity_on_hand: number;
  unit_cost?: number | null;
}

interface ApiLotDetail {
  id: number;
  warehouse_id: number;
  location_id?: number | null;
  location_code?: string | null;
  location_name?: string | null;
  product_id: number;
  product_code: string;
  product_name: string;
  unit: string;
  lot_number?: string | null;
  expiry_date?: string | null;
  quantity_on_hand: number;
  reserved_quantity: number;
  available_quantity: number;
  unit_cost?: number | null;
}

function toStockLevel(item: ApiStockLevel): StockLevel {
  return {
    id: String(item.product_id),
    productCode: item.product_code,
    productName: item.product_name,
    category: "",
    unit: item.unit,
    onHand: item.on_hand,
    reserved: item.reserved,
    available: item.available,
    reorderPoint: item.reorder_level,
    unitValue: 0,
    totalValue: 0,
    lotCount: item.lot_count ?? 0,
    earliestExpiry: item.earliest_expiry ?? null,
    locations: item.locations ?? null,
  };
}

function stockStatus(s: StockLevel) {
  if (s.onHand === 0) return { label: "Hết hàng", variant: "danger" as const };
  if (s.onHand <= s.reorderPoint) return { label: "Sắp hết", variant: "warning" as const };
  return { label: "Bình thường", variant: "success" as const };
}

function ledgerVariant(type: LedgerType) {
  if (type === "IN") return "success";
  if (type === "OUT") return "info";
  if (type === "ADJUST") return "warning";
  return "purple";
}

const adjustTypes: Array<{ value: LedgerType; label: string }> = [
  { value: "IN", label: "Nhập kho (tăng tồn)" },
  { value: "OUT", label: "Xuất kho (giảm tồn)" },
  { value: "ADJUST", label: "Điều chỉnh (giảm tồn)" },
];

export default function WarehouseInventoryPage() {
  const [tab, setTab] = useState("stock");
  const [categoryFilter, setCategoryFilter] = useState("Tất cả");
  const [typeFilter, setTypeFilter] = useState("Tất cả");
  const [version, setVersion] = useState(0);
  const [adjustOpen, setAdjustOpen] = useState(false);

  // Điều chỉnh form
  const [adjProduct, setAdjProduct] = useState("");
  const [adjType, setAdjType] = useState<LedgerType>("IN");
  const [adjQty, setAdjQty] = useState(1);
  const [warehouseOptions, setWarehouseOptions] = useState<ApiWarehouse[]>([]);
  const [adjWarehouseId, setAdjWarehouseId] = useState<number | "">("");
  const [adjNote, setAdjNote] = useState("");
  const [adjExpiryDate, setAdjExpiryDate] = useState("");
  const [adjLocationId, setAdjLocationId] = useState<number | "">("");
  const [adjError, setAdjError] = useState("");
  const [adjSuccess, setAdjSuccess] = useState("");

  const [stockLevels, setStockLevels] = useState<StockLevel[]>([]);
  const [ledgerEntriesState, setLedgerEntriesState] = useState<LedgerEntry[]>([]);
  const [locations, setLocations] = useState<ApiLocation[]>([]);
  const [lots, setLots] = useState<ApiLot[]>([]);
  const [lotDetails, setLotDetails] = useState<ApiLotDetail[]>([]);
  const [lotProductFilter, setLotProductFilter] = useState("Tất cả");
  const [lotWarehouseFilter, setLotWarehouseFilter] = useState<number | "">("");
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadInventory() {
      try {
        const [stockResponse, transactionResponse, warehouseResponse, locationResponse, lotResponse, lotDetailResponse] = await Promise.all([
          apiFetch(`${API_URL}/inventory/stock-levels/`),
          apiFetch(`${API_URL}/inventory/transactions/`),
          apiFetch(`${API_URL}/inventory/warehouses/`),
          apiFetch(`${API_URL}/inventory/locations/`),
          apiFetch(`${API_URL}/inventory/lots/`),
          apiFetch(`${API_URL}/inventory/lot-details/`),
        ]);
        if (!stockResponse.ok || !transactionResponse.ok || !warehouseResponse.ok || !locationResponse.ok || !lotResponse.ok || !lotDetailResponse.ok) {
          throw new Error("Không thể tải dữ liệu tồn kho từ API.");
        }
        const stocks = await stockResponse.json() as ApiStockLevel[];
        const transactions = await transactionResponse.json() as ApiTransaction[];
        const warehouses = await warehouseResponse.json() as ApiWarehouse[];
        const locationRows = await locationResponse.json() as ApiLocation[];
        const lotRows = await lotResponse.json() as ApiLot[];
        const lotDetailRows = await lotDetailResponse.json() as ApiLotDetail[];
        if (cancelled) return;
        const stockMap = new Map(stocks.map((item) => [item.product_id, item]));
        const warehouseMap = new Map(warehouses.map((item) => [item.id, item.name]));
        setStockLevels(stocks.map(toStockLevel));
        setLedgerEntriesState(transactions.map((item) => ({
          id: item.id,
          code: item.code,
          type: item.type,
          productCode: stockMap.get(item.product_id)?.product_code ?? String(item.product_id),
          productName: stockMap.get(item.product_id)?.product_name ?? "Sản phẩm",
          unit: stockMap.get(item.product_id)?.unit ?? "",
          warehouse: warehouseMap.get(item.warehouse_id) ?? `Kho #${item.warehouse_id}`,
          quantity: item.quantity,
          refType: item.ref_type ?? "",
          refCode: item.ref_code ?? "",
          createdAt: item.created_at,
          createdBy: item.created_by ?? "",
          note: item.note ?? "",
        })));
        setWarehouseOptions(warehouses);
        setLocations(locationRows);
        setLots(lotRows);
        setLotDetails(lotDetailRows);
        setLoadError("");
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Không thể tải dữ liệu tồn kho.");
      }
    }
    loadInventory();
    return () => { cancelled = true; };
  }, [version]);

  const refresh = () => setVersion((v) => v + 1);

  const totalValue = stockLevels.reduce((s, i) => s + i.totalValue, 0);
  const lowStock = stockLevels.filter((s) => s.onHand <= s.reorderPoint).length;
  const todayTx = ledgerEntriesState.filter((e) => e.createdAt.startsWith(new Date().toISOString().slice(0, 10))).length;
  const categories = Array.from(new Set(stockLevels.map((s) => s.category)));
  const stockColumns: Column<StockLevel>[] = [
    { key: "productCode", title: "Mã SKU", sortable: true },
    {
      key: "productName",
      title: "Sản phẩm",
      sortable: true,
      render: (val, row) => (
        <div>
          <p className="font-medium text-gray-900">{String(val)}</p>
          <p className="text-xs text-gray-400">{row.category}</p>
        </div>
      ),
    },
    { key: "unit", title: "ĐVT" },
    {
      key: "onHand",
      title: "Tồn kho",
      sortable: true,
      align: "right",
      render: (val) => <span className="font-semibold text-gray-900">{formatNumber(val as number)}</span>,
    },
    {
      key: "locations",
      title: "Vị trí kho",
      render: (val) => (
        <span className="text-xs text-gray-600">
          {val ? String(val) : <span className="text-gray-400">Chưa gán</span>}
        </span>
      ),
    },
    {
      key: "earliestExpiry",
      title: "Hạn sử dụng",
      sortable: true,
      render: (val) => {
        if (!val) return <span className="text-gray-400 text-xs">Không có</span>;
        const date = new Date(String(val));
        const isExpired = date < new Date();
        const isNearExpiry = date < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
        return (
          <span className={`text-xs font-medium ${isExpired ? "text-red-600" : isNearExpiry ? "text-amber-600" : "text-gray-600"}`}>
            {date.toLocaleDateString("vi-VN")}
          </span>
        );
      },
    },
    {
      key: "lotCount",
      title: "Số lô",
      align: "right",
      render: (val) => <span className="text-gray-500">{Number(val)}</span>,
    },
    {
      key: "reserved",
      title: "Giữ chỗ",
      align: "right",
      render: (val) => <span className="text-gray-500">{formatNumber(val as number)}</span>,
    },
    {
      key: "available",
      title: "Khả dụng",
      sortable: true,
      align: "right",
      render: (val) => <span className="text-emerald-600 font-medium">{formatNumber(val as number)}</span>,
    },
    {
      key: "reorderPoint",
      title: "Điểm đặt lại",
      align: "right",
      render: (val) => <span className="text-gray-400">{formatNumber(val as number)}</span>,
    },
    {
      key: "totalValue",
      title: "Giá trị tồn",
      sortable: true,
      align: "right",
      render: (val) => <span className="font-medium text-gray-800">{formatVND(val as number)}</span>,
    },
    {
      key: "onHand",
      title: "Trạng thái",
      render: (_, row) => {
        const st = stockStatus(row);
        return <Badge variant={st.variant}>{st.label}</Badge>;
      },
    },
  ];

  const ledgerColumns: Column<LedgerEntry>[] = [
    { key: "code", title: "Mã giao dịch", sortable: true },
    {
      key: "createdAt",
      title: "Thời gian",
      sortable: true,
      render: (val) => <span className="text-xs text-gray-500">{formatDateTime(String(val))}</span>,
    },
    {
      key: "type",
      title: "Loại",
      sortable: true,
      render: (val) => <Badge variant={ledgerVariant(val as LedgerType)}>{ledgerLabels[val as LedgerType]}</Badge>,
    },
    {
      key: "productName",
      title: "Sản phẩm",
      render: (val, row) => (
        <div>
          <p className="font-medium text-gray-900">{String(val)}</p>
          <p className="text-xs text-gray-400">{row.productCode}</p>
        </div>
      ),
    },
    { key: "warehouse", title: "Kho", sortable: true },
    {
      key: "quantity",
      title: "Số lượng",
      sortable: true,
      align: "right",
      render: (val) => {
        const n = val as number;
        return (
          <span className={cn("font-bold", n > 0 ? "text-emerald-600" : n < 0 ? "text-red-500" : "text-gray-500")}>
            {n > 0 ? "+" : ""}{formatNumber(n)}
          </span>
        );
      },
    },
    {
      key: "refCode",
      title: "Chứng từ",
      render: (val, row) => (
        <div>
          <Badge variant="default">{row.refType}</Badge>
          <p className="text-xs text-gray-400 mt-0.5">{String(val)}</p>
        </div>
      ),
    },
    { key: "createdBy", title: "Người tạo" },
    {
      key: "note",
      title: "Ghi chú",
      render: (val) => <span className="text-xs text-gray-500">{String(val)}</span>,
    },
  ];
  const filteredStock = stockLevels.filter((s) => categoryFilter === "Tất cả" || s.category === categoryFilter);
  const filteredLedger = ledgerEntriesState.filter((e) => typeFilter === "Tất cả" || e.type === typeFilter);
  const filteredLotDetails = lotDetails
    .filter((lot) => lotProductFilter === "Tất cả" || lot.product_code === lotProductFilter)
    .filter((lot) => !lotWarehouseFilter || lot.warehouse_id === lotWarehouseFilter);

  function exportStock() {
    downloadExcel(filteredStock.map((stock) => ({
      "Mã SKU": stock.productCode,
      "Sản phẩm": stock.productName,
      "ĐVT": stock.unit,
      "Tồn kho": stock.onHand,
      "Đã giữ": stock.reserved,
      "Khả dụng": stock.available,
      "Vị trí kho": stock.locations ?? "",
      "Hạn sử dụng gần nhất": stock.earliestExpiry ?? "",
      "Số lô": stock.lotCount,
      "Điểm đặt lại": stock.reorderPoint,
    })), `ton-kho-${new Date().toISOString().slice(0, 10)}`, "Tồn kho");
  }

  function exportLedger() {
    downloadExcel(filteredLedger.map((entry) => ({
      "Mã giao dịch": entry.code,
      "Thời gian": entry.createdAt,
      "Loại": ledgerLabels[entry.type],
      "Mã SKU": entry.productCode,
      "Sản phẩm": entry.productName,
      "Kho": entry.warehouse,
      "Số lượng": entry.quantity,
      "Loại chứng từ": entry.refType,
      "Mã chứng từ": entry.refCode,
      "Người tạo": entry.createdBy,
      "Ghi chú": entry.note,
    })), `so-nhat-ky-kho-${new Date().toISOString().slice(0, 10)}`, "Ledger");
  }

  function exportLots() {
    downloadExcel(filteredLotDetails.map((lot) => ({
      "Mã SKU": lot.product_code,
      "Sản phẩm": lot.product_name,
      "ĐVT": lot.unit,
      "Kho": lot.warehouse_id,
      "Vị trí": lot.location_code ?? "",
      "Lot": lot.lot_number ?? "",
      "Hạn sử dụng": lot.expiry_date ?? "",
      "Tồn": lot.quantity_on_hand,
      "Đã giữ": lot.reserved_quantity,
      "Khả dụng": lot.available_quantity,
    })), `vi-tri-lot-${new Date().toISOString().slice(0, 10)}`, "Vị trí Lot");
  }

  function openAdjust() {
    setAdjError("");
    setAdjSuccess("");
    setAdjProduct("");
    setAdjType("IN");
    setAdjQty(1);
    setAdjWarehouseId(warehouseOptions[0]?.id ?? "");
    setAdjNote("");
    setAdjExpiryDate("");
    setAdjLocationId("");
    setAdjustOpen(true);
  }

  async function submitAdjust() {
    setAdjError("");
    setAdjSuccess("");
    if (!adjProduct) { setAdjError("Vui lòng chọn sản phẩm."); return; }
    if (adjQty < 1) { setAdjError("Số lượng phải lớn hơn 0."); return; }
    const stock = stockLevels.find((s) => s.productCode === adjProduct);
    if (!stock) { setAdjError("Không tìm thấy sản phẩm."); return; }
    if ((adjType === "OUT" || adjType === "ADJUST") && adjQty > stock.onHand) {
      setAdjError(`Không thể xuất/điều chỉnh ${adjQty} khi tồn kho chỉ còn ${stock.onHand} ${stock.unit}.`);
      return;
    }
    if (!adjWarehouseId) { setAdjError("Vui lòng chọn kho."); return; }
    try {
      const response = await apiFetch(`${API_URL}/inventory/adjust/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: adjType,
          warehouse_id: adjWarehouseId,
          product_id: Number(stock.id),
          quantity: adjQty,
          location_id: adjLocationId || null,
          expiry_date: adjExpiryDate ? `${adjExpiryDate}T00:00:00` : null,
          note: adjNote.trim() || `${ledgerLabels[adjType]} thủ công`,
        }),
      });
      const result = await response.json() as { code?: string; detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "Không thể ghi giao dịch.");
      setAdjSuccess(`Đã ghi phiếu ${result.code ?? ""} vào PostgreSQL.`);
      refresh();
      setTimeout(() => { setAdjustOpen(false); setAdjSuccess(""); }, 900);
    } catch (error) {
      setAdjError(error instanceof Error ? error.message : "Không thể ghi giao dịch.");
    }
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title="Tồn kho & Kho hàng"
        subtitle="Bảng tồn kho theo SKU và sổ nhật ký giao dịch (inventory_transactions)"
        actions={
          <button onClick={openAdjust} className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            <SlidersHorizontal size={16} />
            Điều chỉnh tồn
          </button>
        }
      />

      {loadError && <div className="bg-red-50 text-red-700 rounded-xl px-4 py-3 text-sm">{loadError}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Giá trị tồn kho" value={formatVND(totalValue)} icon={<CircleDollarSign size={20} />} color="bg-sky-50 text-sky-600" />
        <StatCard label="Tổng SKU" value={stockLevels.length} icon={<Boxes size={20} />} color="bg-purple-50 text-purple-600" />
        <StatCard label="SKU thiếu (≤ điểm đặt lại)" value={lowStock} icon={<TriangleAlert size={20} />} color="bg-amber-50 text-amber-600" />
        <StatCard label="Giao dịch hôm nay" value={todayTx} icon={<ArrowDownUp size={20} />} color="bg-emerald-50 text-emerald-600" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {warehouseOptions.map((w) => (
          <div key={w.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
              <WarehouseIcon size={18} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-900">{w.name} <span className="text-gray-400 font-normal">({w.code})</span></p>
              <p className="text-xs text-gray-400">{w.location} · Thủ kho: {w.manager}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <Tabs
          items={[
            { key: "stock", label: "Bảng tồn kho", count: stockLevels.length },
            { key: "ledger", label: "Sổ nhật ký (Ledger)", count: ledgerEntriesState.length },
            { key: "lots", label: "Vị trí / hạn dùng", count: lots.length },
          ]}
          active={tab}
          onChange={setTab}
        />
        {tab === "ledger" && (
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Nhập kho</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> Xuất kho</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> Điều chỉnh</span>
          </div>
        )}
      </div>

      {tab === "stock" ? (
        <DataTable
          data={filteredStock}
          columns={stockColumns}
          searchKeys={["productCode", "productName", "category", "locations", "earliestExpiry"]}
          searchPlaceholder="Tìm SKU, tên sản phẩm, vị trí..."
          toolbar={
            <div className="flex flex-wrap gap-2"><select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"><option value="Tất cả">Tất cả danh mục</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select><button onClick={exportStock} disabled={!filteredStock.length} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 disabled:opacity-50"><Download size={15} />Tải Excel</button></div>
          }
        />
      ) : tab === "ledger" ? (
        <DataTable
          data={filteredLedger}
          columns={ledgerColumns}
          searchKeys={["code", "productName", "productCode", "refCode", "createdBy"]}
          searchPlaceholder="Tìm mã giao dịch, sản phẩm, chứng từ..."
          toolbar={
            <div className="flex flex-wrap gap-2"><select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"><option value="Tất cả">Tất cả loại</option><option value="OPENING">Tồn đầu kỳ</option><option value="IN">Nhập kho</option><option value="OUT">Xuất kho</option><option value="ADJUST">Điều chỉnh</option></select><button onClick={exportLedger} disabled={!filteredLedger.length} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 disabled:opacity-50"><Download size={15} />Tải Excel</button></div>
          }
        />
      ) : (
        <DataTable
          data={filteredLotDetails}
          columns={[
            { key: "product_code", title: "Mã SKU", sortable: true },
            {
              key: "product_name",
              title: "Sản phẩm",
              sortable: true,
              render: (value, row) => (
                <div>
                  <p className="font-medium text-gray-900">{String(value)}</p>
                  <p className="text-xs text-gray-400">{row.unit}</p>
                </div>
              ),
            },
            {
              key: "location_code",
              title: "Vị trí",
              sortable: true,
              render: (value, row) => (
                <span>{String(value ?? "Chưa gán")}{row.location_name ? ` - ${row.location_name}` : ""}</span>
              ),
            },
            { key: "lot_number", title: "Lot", sortable: true, render: (value) => String(value ?? "—") },
            {
              key: "expiry_date",
              title: "Hạn sử dụng",
              sortable: true,
              render: (value) => value ? new Date(String(value)).toLocaleDateString("vi-VN") : "Không có",
            },
            { key: "quantity_on_hand", title: "Tồn", sortable: true, align: "right", render: (value) => formatNumber(value as number) },
            { key: "reserved_quantity", title: "Đã giữ", sortable: true, align: "right", render: (value) => <span className="text-amber-600">{formatNumber(value as number)}</span> },
            { key: "available_quantity", title: "Khả dụng", sortable: true, align: "right", render: (value) => <span className="font-semibold text-emerald-600">{formatNumber(value as number)}</span> },
          ]}
          searchKeys={["product_code", "product_name", "location_code", "location_name", "lot_number", "expiry_date"]}
          searchPlaceholder="Tìm SKU, tên, vị trí, lot, hạn dùng..."
          toolbar={
            <div className="flex flex-wrap gap-2">
              <select
                value={lotWarehouseFilter}
                onChange={(event) => setLotWarehouseFilter(event.target.value ? Number(event.target.value) : "")}
                className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                <option value="">Tất cả kho</option>
                {warehouseOptions.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
              </select>
              <button onClick={exportLots} disabled={!filteredLotDetails.length} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 disabled:opacity-50"><Download size={15} />Tải Excel</button>
              <select
                value={lotProductFilter}
                onChange={(event) => setLotProductFilter(event.target.value)}
                className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                <option value="Tất cả">Tất cả mã hàng</option>
                {stockLevels.map((stock) => <option key={stock.productCode} value={stock.productCode}>{stock.productCode}</option>)}
              </select>
            </div>
          }
        />
      )}
      {/* Drawer điều chỉnh tồn kho */}
      <Drawer open={adjustOpen} onClose={() => setAdjustOpen(false)} title="Điều chỉnh tồn kho" subtitle="Ghi nhận nhập/xuất/điều chỉnh thủ công vào sổ nhật ký">
        <div className="p-5 space-y-4">
          {adjError && (
            <div className="flex items-center gap-2 bg-red-50 text-red-700 rounded-xl px-3 py-2 text-sm">{adjError}</div>
          )}
          {adjSuccess && (
            <div className="flex items-center gap-2 bg-emerald-50 text-emerald-700 rounded-xl px-3 py-2 text-sm">{adjSuccess}</div>
          )}
          <label className="block">
            <span className="text-xs text-gray-500">Sản phẩm</span>
            <select value={adjProduct} onChange={(e) => setAdjProduct(e.target.value)} className="mt-1 w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500">
              <option value="">-- Chọn sản phẩm --</option>
              {stockLevels.map((s) => (
                <option key={s.productCode} value={s.productCode}>{s.productName} ({s.productCode}) - Tồn: {formatNumber(s.onHand)} {s.unit}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Loại giao dịch</span>
            <select value={adjType} onChange={(e) => setAdjType(e.target.value as LedgerType)} className="mt-1 w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500">
              {adjustTypes.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Số lượng</span>
            <input type="number" min={1} value={adjQty} onChange={(e) => setAdjQty(Math.max(1, Number(e.target.value) || 1))} className="mt-1 w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500" />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Kho</span>
            <select value={adjWarehouseId} onChange={(e) => setAdjWarehouseId(Number(e.target.value))} className="mt-1 w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500">
              <option value="">-- Chọn kho --</option>
              {warehouseOptions.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Vị trí kho</span>
            <select value={adjLocationId} onChange={(e) => setAdjLocationId(e.target.value ? Number(e.target.value) : "")} className="mt-1 w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500">
              <option value="">-- Chưa gán vị trí --</option>
              {locations.filter((location) => location.warehouse_id === adjWarehouseId && location.is_active).map((location) => (
                <option key={location.id} value={location.id}>{location.code}{location.name ? ` - ${location.name}` : ""}</option>
              ))}
            </select>
          </label>
          <label className="block">
              <span className="text-xs text-gray-500">Hạn sử dụng</span>
              <input type="date" value={adjExpiryDate} onChange={(e) => setAdjExpiryDate(e.target.value)} className="mt-1 w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500" />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Ghi chú</span>
            <textarea value={adjNote} onChange={(e) => setAdjNote(e.target.value)} rows={2} placeholder="Lý do điều chỉnh..." className="mt-1 w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 focus:bg-white" />
          </label>
          <button onClick={submitAdjust} className="w-full flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium rounded-lg py-2.5 transition-colors">
            Ghi phiếu & cập nhật tồn
          </button>
        </div>
      </Drawer>
    </div>
  );
}
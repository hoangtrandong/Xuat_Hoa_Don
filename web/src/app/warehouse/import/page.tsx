"use client";

import { useEffect, useState } from "react";
import { PackagePlus, Truck, PackageCheck, ClipboardList } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import DataTable, { Column } from "@/components/ui/DataTable";
import Badge from "@/components/ui/Badge";
import Drawer from "@/components/ui/Drawer";
import { ledgerLabels, type LedgerEntry, type StockLevel } from "@/lib/mock-inventory";
import { formatNumber, formatDateTime } from "@/lib/format";
import { API_URL } from "@/lib/api";

interface ApiStockLevel {
  product_id: number;
  product_code: string;
  product_name: string;
  unit: string;
  on_hand: number;
  reserved: number;
  available: number;
  reorder_level: number;
}

interface ApiTransaction {
  id: number;
  code: string;
  type: "OPENING" | "IN" | "OUT" | "ADJUST";
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
  name: string;
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
  };
}

function toLedgerEntry(item: ApiTransaction, stocks: Map<number, ApiStockLevel>, warehouses: Map<number, string>): LedgerEntry {
  const stock = stocks.get(item.product_id);
  return {
    id: item.id,
    code: item.code,
    type: item.type,
    productCode: stock?.product_code ?? String(item.product_id),
    productName: stock?.product_name ?? "Sản phẩm",
    unit: stock?.unit ?? "",
    warehouse: warehouses.get(item.warehouse_id) ?? `Kho #${item.warehouse_id}`,
    quantity: item.quantity,
    refType: item.ref_type ?? "",
    refCode: item.ref_code ?? "",
    createdAt: item.created_at,
    createdBy: item.created_by ?? "",
    note: item.note ?? "",
  };
}

export default function ImportPage() {
  const [version, setVersion] = useState(0);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [stockLevels, setStockLevels] = useState<StockLevel[]>([]);
  const [warehouses, setWarehouses] = useState<ApiWarehouse[]>([]);
  const [loadError, setLoadError] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [productCode, setProductCode] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [warehouseId, setWarehouseId] = useState<number | "">("");
  const [refCode, setRefCode] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [stockResponse, transactionResponse, warehouseResponse] = await Promise.all([
          fetch(`${API_URL}/inventory/stock-levels/`),
          fetch(`${API_URL}/inventory/transactions/`),
          fetch(`${API_URL}/inventory/warehouses/`),
        ]);
        if (!stockResponse.ok || !transactionResponse.ok || !warehouseResponse.ok) {
          throw new Error("Không thể tải dữ liệu kho từ API.");
        }
        const stocks = await stockResponse.json() as ApiStockLevel[];
        const transactions = await transactionResponse.json() as ApiTransaction[];
        const warehouseList = await warehouseResponse.json() as ApiWarehouse[];
        if (cancelled) return;
        const stockMap = new Map(stocks.map((item) => [item.product_id, item]));
        const warehouseMap = new Map(warehouseList.map((item) => [item.id, item.name]));
        setStockLevels(stocks.map(toStockLevel));
        setLedgerEntries(transactions.map((item) => toLedgerEntry(item, stockMap, warehouseMap)));
        setWarehouses(warehouseList);
        setLoadError("");
      } catch (loadErrorValue) {
        if (!cancelled) setLoadError(loadErrorValue instanceof Error ? loadErrorValue.message : "Không thể tải dữ liệu kho.");
      }
    }
    load();
    return () => { cancelled = true; };
  }, [version]);

  const inEntries = ledgerEntries.filter((entry) => entry.type === "IN" || entry.type === "OPENING");
  const qtyIn = inEntries.filter((entry) => entry.type === "IN").reduce((sum, entry) => sum + entry.quantity, 0);
  const poCount = new Set(inEntries.filter((entry) => entry.type === "IN").map((entry) => entry.refCode)).size;

  function openImport() {
    setProductCode("");
    setQuantity(1);
    setWarehouseId(warehouses[0]?.id ?? "");
    setRefCode("");
    setNote("");
    setError("");
    setSuccess("");
    setImportOpen(true);
  }

  async function submitImport() {
    setError("");
    setSuccess("");
    const stock = stockLevels.find((item) => item.productCode === productCode);
    if (!stock) { setError("Vui lòng chọn sản phẩm."); return; }
    if (!warehouseId) { setError("Vui lòng chọn kho nhập."); return; }
    if (quantity < 1) { setError("Số lượng phải lớn hơn 0."); return; }
    try {
      const response = await fetch(`${API_URL}/inventory/adjust/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "IN",
          warehouse_id: warehouseId,
          product_id: Number(stock.id),
          quantity,
          ref_type: "PO",
          ref_code: refCode.trim() || null,
          note: note.trim() || `Nhập kho ${stock.productName}`,
        }),
      });
      const result = await response.json() as { code?: string; detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "Không thể ghi phiếu nhập.");
      setSuccess(`Đã ghi phiếu nhập ${result.code ?? ""} vào PostgreSQL.`);
      setVersion((current) => current + 1);
      setTimeout(() => { setImportOpen(false); setSuccess(""); }, 900);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Không thể ghi phiếu nhập.");
    }
  }

  const columns: Column<LedgerEntry>[] = [
    { key: "code", title: "Mã phiếu nhập", sortable: true },
    { key: "createdAt", title: "Thời gian", sortable: true, render: (value) => <span className="text-xs text-gray-500">{formatDateTime(String(value))}</span> },
    { key: "type", title: "Loại", render: (value) => <Badge variant={value === "IN" ? "success" : "purple"}>{ledgerLabels[value as "IN"]}</Badge> },
    { key: "productName", title: "Sản phẩm", render: (value, row) => <div><p className="font-medium text-gray-900">{String(value)}</p><p className="text-xs text-gray-400">{row.productCode} · {row.warehouse}</p></div> },
    { key: "quantity", title: "Số lượng nhập", sortable: true, align: "right", render: (value) => <span className="font-bold text-emerald-600">+{formatNumber(value as number)}</span> },
    { key: "refCode", title: "Đơn nhập (PO)", render: (value, row) => <div><Badge variant="default">{row.refType}</Badge><p className="text-xs text-gray-400 mt-0.5">{String(value)}</p></div> },
    { key: "createdBy", title: "Người nhập" },
    { key: "note", title: "Ghi chú", render: (value) => <span className="text-xs text-gray-500">{String(value)}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Nhập kho" subtitle="Phiếu nhập kho từ nhà cung cấp và tồn đầu kỳ" actions={
        <button onClick={openImport} className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          <PackagePlus size={16} /> Tạo phiếu nhập
        </button>
      } />
      {loadError && <div className="bg-red-50 text-red-700 rounded-xl px-4 py-3 text-sm">{loadError}</div>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Phiếu nhập trong kỳ" value={inEntries.filter((entry) => entry.type === "IN").length} icon={<ClipboardList size={20} />} color="bg-sky-50 text-sky-600" />
        <StatCard label="Số lượng đã nhập" value={formatNumber(qtyIn)} icon={<Truck size={20} />} color="bg-emerald-50 text-emerald-600" />
        <StatCard label="Đơn PO liên quan" value={poCount} icon={<PackageCheck size={20} />} color="bg-purple-50 text-purple-600" />
        <StatCard label="Tồn đầu kỳ" value={inEntries.filter((entry) => entry.type === "OPENING").length} icon={<PackagePlus size={20} />} color="bg-amber-50 text-amber-600" />
      </div>
      <DataTable data={inEntries} columns={columns} searchKeys={["code", "productName", "productCode", "refCode", "createdBy"]} searchPlaceholder="Tìm phiếu nhập, sản phẩm, PO..." />
      <Drawer open={importOpen} onClose={() => setImportOpen(false)} title="Tạo phiếu nhập kho" subtitle="Ghi nhận nhập hàng và cập nhật tồn kho">
        <div className="p-5 space-y-4">
          {error && <div className="bg-red-50 text-red-700 rounded-xl px-3 py-2 text-sm">{error}</div>}
          {success && <div className="bg-emerald-50 text-emerald-700 rounded-xl px-3 py-2 text-sm">{success}</div>}
          <label className="block"><span className="text-xs text-gray-500">Sản phẩm</span><select value={productCode} onChange={(event) => setProductCode(event.target.value)} className="mt-1 w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg"><option value="">-- Chọn sản phẩm --</option>{stockLevels.map((stock) => <option key={stock.productCode} value={stock.productCode}>{stock.productName} ({stock.productCode})</option>)}</select></label>
          <label className="block"><span className="text-xs text-gray-500">Số lượng nhập</span><input type="number" min={1} value={quantity} onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))} className="mt-1 w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg" /></label>
          <label className="block"><span className="text-xs text-gray-500">Kho nhập</span><select value={warehouseId} onChange={(event) => setWarehouseId(Number(event.target.value))} className="mt-1 w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg"><option value="">-- Chọn kho --</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
          <label className="block"><span className="text-xs text-gray-500">Mã đơn nhập (tùy chọn)</span><input value={refCode} onChange={(event) => setRefCode(event.target.value)} placeholder="VD: PO-260906-001" className="mt-1 w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg" /></label>
          <label className="block"><span className="text-xs text-gray-500">Ghi chú</span><textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} placeholder="Ghi chú nhập hàng..." className="mt-1 w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg" /></label>
          <button onClick={submitImport} className="w-full bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium rounded-lg py-2.5">Ghi phiếu & cập nhật tồn</button>
        </div>
      </Drawer>
    </div>
  );
}

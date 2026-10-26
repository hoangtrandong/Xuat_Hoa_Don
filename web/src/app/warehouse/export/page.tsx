"use client";

import { useEffect, useState } from "react";// src/app/warehouse/export/page.tsx
import { PackageMinus, Truck, FileText, Boxes } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import DataTable, { Column } from "@/components/ui/DataTable";
import Badge from "@/components/ui/Badge";
import Drawer from "@/components/ui/Drawer";
import { ledgerLabels, type LedgerEntry, type StockLevel } from "@/lib/mock-inventory";
import { formatNumber, formatDateTime } from "@/lib/format";
import { API_URL, apiFetch } from "@/lib/api";
import { downloadExcel } from "@/lib/excel";

interface ApiStockLevel {
  product_id: number;
  product_code: string;
  product_name: string;
  category_name?: string | null;
  category?: string | null;
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
  code: string;
  name: string;
}

function toStockLevel(item: ApiStockLevel): StockLevel {
  return {
    id: String(item.product_id),
    productCode: item.product_code,
    productName: item.product_name,
    category: item.category_name || item.category || "",
    unit: item.unit,
    onHand: item.on_hand,
    reserved: item.reserved,
    available: item.available,
    reorderPoint: item.reorder_level,
    unitValue: 0,
    totalValue: 0,
  };
}

function toLedgerEntry(item: ApiTransaction, stocks: Map<number, ApiStockLevel>, warehouseNames: Map<number, string>): LedgerEntry {
  const stock = stocks.get(item.product_id);
  return {
    id: item.id,
    code: item.code,
    type: item.type,
    productCode: stock?.product_code ?? String(item.product_id),
    productName: stock?.product_name ?? "Sản phẩm",
    unit: stock?.unit ?? "",
    warehouse: warehouseNames.get(item.warehouse_id) ?? `Kho #${item.warehouse_id}`,
    quantity: item.quantity,
    refType: item.ref_type ?? "",
    refCode: item.ref_code ?? "",
    createdAt: item.created_at,
    createdBy: item.created_by ?? "",
    note: item.note ?? "",
  };
}

function useInventoryData(version: number, warehouseId: number | "") {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [stockLevels, setStockLevels] = useState<StockLevel[]>([]);
  const [warehouses, setWarehouses] = useState<ApiWarehouse[]>([]);
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [stockResponse, transactionResponse, warehouseResponse] = await Promise.all([
          apiFetch(`${API_URL}/inventory/stock-levels/${warehouseId ? `?warehouse_id=${warehouseId}` : ""}`),
          apiFetch(`${API_URL}/inventory/transactions/?txn_type=OUT`),
          apiFetch(`${API_URL}/inventory/warehouses/`),
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
        setEntries(transactions.map((item) => toLedgerEntry(item, stockMap, warehouseMap)));
        setWarehouses(warehouseList);
        setLoadError("");
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Không thể tải dữ liệu kho.");
      }
    }
    load();
    return () => { cancelled = true; };
  }, [version, warehouseId]);
  return { entries, stockLevels, warehouses, loadError };
}

export default function ExportPage() {
  const [version, setVersion] = useState(0);
  const [warehouseId, setWarehouseId] = useState<number | "">("");
  const { entries: ledgerEntries, stockLevels, warehouses, loadError } = useInventoryData(version, warehouseId);
  const [exportOpen, setExportOpen] = useState(false);
  const [productCode, setProductCode] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [refCode, setRefCode] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const outEntries = ledgerEntries.filter((e) => e.type === "OUT" || (e.type === "ADJUST" && e.quantity < 0));

  function exportOutEntries() {
    downloadExcel(outEntries.map((entry) => ({
      "Mã phiếu xuất": entry.code,
      "Thời gian": entry.createdAt,
      "Loại": ledgerLabels[entry.type as "OUT"],
      "Mã NPP": entry.productCode,
      "Sản phẩm": entry.productName,
      "Kho": entry.warehouse,
      "Số lượng xuất": Math.abs(entry.quantity),
      "Mã đơn bán": entry.refCode,
      "Người xuất": entry.createdBy,
      "Ghi chú": entry.note,
    })), `phieu-xuat-kho-${new Date().toISOString().slice(0, 10)}`, "Phiếu xuất");
  }

  const qtyOut = outEntries.reduce((s, e) => s + Math.abs(e.quantity), 0);
  const soCount = new Set(outEntries.filter((e) => e.type === "OUT").map((e) => e.refCode)).size;

  function openExport() {
    setProductCode("");
    setProductSearch("");
    setQuantity(1);
    setWarehouseId(warehouses[0]?.id ?? "");
    setRefCode("");
    setNote("");
    setError("");
    setSuccess("");
    setExportOpen(true);
  }

  const selectedStock = stockLevels.find((item) => item.productCode === productCode);
  const selectedProductLabel = selectedStock
    ? `${selectedStock.productCode} - ${selectedStock.productName}`
    : "";
  const filteredProducts = stockLevels.filter((stock) => {
    const query = productSearch.trim().toLowerCase();
    return !query
      || stock.productCode.toLowerCase().includes(query)
      || stock.productName.toLowerCase().includes(query);
  });
  const showProductResults = !selectedStock || productSearch !== selectedProductLabel;

  async function submitExport() {
    setError("");
    setSuccess("");
    const stock = selectedStock;
    if (!stock) {
      setError("Vui lòng chọn sản phẩm.");
      return;
    }
    if (quantity < 1) {
      setError("Số lượng phải lớn hơn 0.");
      return;
    }
    if (!warehouseId) {
      setError("Vui lòng chọn kho xuất.");
      return;
    }
    try {
      const response = await apiFetch(`${API_URL}/inventory/adjust/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "OUT",
          warehouse_id: warehouseId,
          product_id: Number(stock.id),
          quantity,
          ref_type: "SO",
          ref_code: refCode.trim() || null,
          note: note.trim() || `Xuất kho ${stock.productName}`,
        }),
      });
      const result = await response.json() as { code?: string; detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "Không thể ghi phiếu xuất.");
      setSuccess(`Đã ghi phiếu xuất ${result.code ?? ""} vào PostgreSQL.`);
      setVersion((current) => current + 1);
      setTimeout(() => { setExportOpen(false); setSuccess(""); }, 900);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Không thể ghi phiếu xuất.");
    }
  }

  const columns: Column<LedgerEntry>[] = [
    { key: "code", title: "Mã phiếu xuất", sortable: true },
    {
      key: "createdAt",
      title: "Thời gian",
      sortable: true,
      render: (val) => <span className="text-xs text-gray-500">{formatDateTime(String(val))}</span>,
    },
    {
      key: "type",
      title: "Loại",
      render: (val) => (
        <Badge variant={val === "OUT" ? "info" : "warning"}>{ledgerLabels[val as "OUT"]}</Badge>
      ),
    },
    {
      key: "productName",
      title: "Sản phẩm",
      render: (val, row) => (
        <div>
          <p className="font-medium text-gray-900">{String(val)}</p>
          <p className="text-xs text-gray-400">{row.productCode} · {row.warehouse}</p>
        </div>
      ),
    },
    {
      key: "quantity",
      title: "Số lượng xuất",
      sortable: true,
      align: "right",
      render: (val) => <span className="font-bold text-red-500">-{formatNumber(Math.abs(val as number))}</span>,
    },
    {
      key: "refCode",
      title: "Đơn bán (SO)",
      render: (val, row) => (
        <div>
          <Badge variant="default">{row.refType}</Badge>
          <p className="text-xs text-gray-400 mt-0.5">{String(val)}</p>
        </div>
      ),
    },
    { key: "createdBy", title: "Người xuất" },
    { key: "note", title: "Ghi chú", render: (val) => <span className="text-xs text-gray-500">{String(val)}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Xuất kho"
        subtitle="Phiếu xuất kho bán hàng theo đơn và điều chỉnh tồn"
        actions={
        <button onClick={openExport} className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            <PackageMinus size={16} />
            Tạo phiếu xuất
          </button>
        }
      />

      {loadError && <div className="bg-red-50 text-red-700 rounded-xl px-4 py-3 text-sm">{loadError}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Phiếu xuất trong kỳ" value={outEntries.filter((e) => e.type === "OUT").length} icon={<Boxes size={20} />} color="bg-sky-50 text-sky-600" />
        <StatCard label="Số lượng đã xuất" value={formatNumber(qtyOut)} icon={<Truck size={20} />} color="bg-rose-50 text-rose-600" />
        <StatCard label="Đơn bán liên quan" value={soCount} icon={<FileText size={20} />} color="bg-purple-50 text-purple-600" />
        <StatCard label="Điều chỉnh giảm" value={outEntries.filter((e) => e.type === "ADJUST").length} icon={<PackageMinus size={20} />} color="bg-amber-50 text-amber-600" />
      </div>

      <DataTable
        data={outEntries}
        columns={columns}
        searchKeys={["code", "productName", "productCode", "refCode", "createdBy"]}
        searchPlaceholder="Tìm phiếu xuất, sản phẩm, đơn bán..."
        toolbar={<button onClick={exportOutEntries} disabled={!outEntries.length} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 disabled:opacity-50"><FileText size={15} />Tải Excel</button>}
      />

      <Drawer open={exportOpen} onClose={() => setExportOpen(false)} title="Tạo phiếu xuất kho" subtitle="Ghi nhận xuất hàng và cập nhật tồn kho">
        <div className="p-5 space-y-4">
          {error && <div className="bg-red-50 text-red-700 rounded-xl px-3 py-2 text-sm">{error}</div>}
          {success && <div className="bg-emerald-50 text-emerald-700 rounded-xl px-3 py-2 text-sm">{success}</div>}
          <label className="block">
            <span className="text-xs text-gray-500">Sản phẩm</span>
            <input
              value={productSearch}
              onChange={(e) => {
                setProductSearch(e.target.value);
                setProductCode("");
                setError("");
              }}
              placeholder="Nhập mã SKU hoặc tên sản phẩm..."
              className="mt-1 w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            {showProductResults && (
              <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                {filteredProducts.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-gray-500">Không tìm thấy sản phẩm.</p>
                ) : (
                  filteredProducts.map((stock) => (
                    <button
                      key={stock.productCode}
                      type="button"
                      onClick={() => {
                        setProductCode(stock.productCode);
                        setProductSearch(`${stock.productCode} - ${stock.productName}`);
                        setError("");
                      }}
                      className={`block w-full px-3 py-2 text-left text-sm hover:bg-sky-50 ${
                        productCode === stock.productCode ? "bg-sky-50 text-sky-700" : "text-gray-700"
                      }`}
                    >
                      <span className="font-medium">{stock.productCode}</span>
                      <span className="ml-2">{stock.productName}</span>
                      <span className="float-right text-xs text-gray-500">{formatNumber(stock.onHand)} {stock.unit}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </label>
          {selectedStock && (
            <div className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">
              Tồn thực tế tại kho đã chọn: <strong>{formatNumber(selectedStock.onHand)} {selectedStock.unit}</strong>
              {selectedStock.reserved > 0 && ` · Đã giữ chỗ: ${formatNumber(selectedStock.reserved)} ${selectedStock.unit}`}
            </div>
          )}
          <label className="block">
            <span className="text-xs text-gray-500">Số lượng xuất</span>
            <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))} className="mt-1 w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500" />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Kho xuất</span>
            <select value={warehouseId} onChange={(e) => { setWarehouseId(Number(e.target.value)); setProductCode(""); setProductSearch(""); }} className="mt-1 w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500">
              <option value="">-- Chọn kho --</option>
              {warehouses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Mã đơn bán (bắt buộc để ghi công nợ KH)</span>
            <input value={refCode} onChange={(e) => setRefCode(e.target.value)} placeholder="VD: SO-260906-009" className="mt-1 w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500" />
            <p className="mt-1 text-xs text-gray-400">Khi xuất kho thành công kèm mã đơn, hệ thống ghi công nợ cho khách hàng của đơn đó.</p>
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Ghi chú</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Ghi chú xuất hàng..." className="mt-1 w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500" />
          </label>
          <button onClick={submitExport} className="w-full bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium rounded-lg py-2.5 transition-colors">
            Ghi phiếu & cập nhật tồn
          </button>
        </div>
      </Drawer>
    </div>
  );
}
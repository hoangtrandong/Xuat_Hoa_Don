"use client";

import { useEffect, useState } from "react";
import { PackagePlus, Truck, PackageCheck, ClipboardList, Upload, MapPin, AlertTriangle } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import DataTable, { Column } from "@/components/ui/DataTable";
import Badge from "@/components/ui/Badge";
import Drawer from "@/components/ui/Drawer";
import { ledgerLabels, type LedgerEntry, type StockLevel } from "@/lib/mock-inventory";
import { formatNumber, formatDateTime } from "@/lib/format";
import { API_URL, apiFetch } from "@/lib/api";

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
  document_date: string | null;
}

interface ApiWarehouse {
  id: number;
  name: string;
}

interface ImportAllocation { location_id: number; quantity: number }
interface ImportItem {
  product_id: number; sku: string; product_name: string; unit?: string | null;
  lot_number: string; expiry_date: string; source_location_code?: string | null;
  boxes_per_carton: number; cartons: number; loose_boxes: number; quantity: number; allocations: ImportAllocation[];
  actual_qty?: number | null;
  delivery_references?: string | null; po_references?: string | null;
  document_date?: string | null;
  invoice_number?: string | null; unit_price?: number | null; amount?: number | null; note?: string | null;
}
interface ApiLocation { id: number; warehouse_id: number; code: string; is_active: boolean }
interface SupplierDiscrepancy {
  id: number; warehouse_id: number; product_id: number; product_sku?: string | null; product_name?: string | null;
  type: "SHORTAGE" | "EXCESS";
  document_quantity: number; actual_quantity: number; quantity: number; remaining_quantity: number;
  lot_number: string | null; invoice_number: string | null; document_date: string | null; status: string;
}

function displayNumber(value: number | null | undefined, fallback = "-") {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : fallback;
}

function formatAllocationQty(totalBoxes: number, boxesPerCarton: number) {
  const perCarton = Math.max(1, Math.floor(boxesPerCarton) || 1);
  const cartons = Math.floor(totalBoxes / perCarton);
  const loose = totalBoxes % perCarton;
  if (perCarton <= 1 || totalBoxes <= 0) return `${Math.max(0, totalBoxes)} hộp`;
  if (cartons === 0) return `${loose} hộp`;
  if (loose === 0) return `${cartons} thùng`;
  return `${cartons} thùng + ${loose} hộp`;
}

function normalizeImportItem(item: ImportItem): ImportItem {
  const boxesPerCarton = Number.isFinite(item.boxes_per_carton) && item.boxes_per_carton > 0
    ? item.boxes_per_carton
    : 1;
  const quantity = Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 0;
  const cartons = Math.floor(quantity / boxesPerCarton);
  const looseBoxes = quantity % boxesPerCarton;
  return {
    ...item,
    boxes_per_carton: boxesPerCarton,
    cartons,
    loose_boxes: looseBoxes,
    quantity,
    unit_price: Number.isFinite(item.unit_price) ? item.unit_price : null,
    amount: Number.isFinite(item.amount) ? item.amount : null,
    allocations: Array.isArray(item.allocations) ? item.allocations : [],
  };
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
  const [receiptItems, setReceiptItems] = useState<ImportItem[]>([]);
  const [receiptWarehouseId, setReceiptWarehouseId] = useState<number | "">("");
  const [receiptLocations, setReceiptLocations] = useState<ApiLocation[]>([]);
  const [receiptDrafts, setReceiptDrafts] = useState<Record<number, { locationId: number | ""; cartons: number; looseBoxes: number }>>({});
  const [receiptUploading, setReceiptUploading] = useState(false);
  const [receiptConfirming, setReceiptConfirming] = useState(false);
  const [receiptDiscrepancies, setReceiptDiscrepancies] = useState<SupplierDiscrepancy[]>([]);

  async function loadReceiptLocations(warehouse: number | "") {
    if (!warehouse) { setReceiptLocations([]); return; }
    const response = await apiFetch(`${API_URL}/inventory/locations/?warehouse_id=${warehouse}`);
    if (!response.ok) throw new Error("Không thể tải vị trí kho.");
    setReceiptLocations(await response.json() as ApiLocation[]);
  }

  async function uploadReceipt(file: File) {
    if (!receiptWarehouseId) { setError("Vui lòng chọn kho nhập trước khi upload."); return; }
    setError(""); setSuccess(""); setReceiptUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await apiFetch(`${API_URL}/inventory/import/upload?warehouse_id=${receiptWarehouseId}`, { method: "POST", body });
      const result = await response.json() as ImportItem[] | { detail?: string };
      if (!response.ok) throw new Error("detail" in result ? result.detail ?? "Không thể đọc file nhập kho." : "Không thể đọc file nhập kho.");
      const items = (result as ImportItem[]).map(normalizeImportItem);
      setReceiptItems(items);
      setReceiptDrafts({});
      const discrepancyResponse = await apiFetch(`${API_URL}/inventory/supplier-discrepancies/?warehouse_id=${receiptWarehouseId}&status=OPEN`);
      if (discrepancyResponse.ok) {
        const discrepancies = await discrepancyResponse.json() as SupplierDiscrepancy[];
        const productIds = new Set(items.map((item) => item.product_id));
        setReceiptDiscrepancies(discrepancies.filter((item) => productIds.has(item.product_id)));
      } else {
        setReceiptDiscrepancies([]);
      }
      setSuccess(`Đã đọc ${items.length} dòng mã hàng + lot. Hãy phân bổ vị trí.`);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Không thể đọc file nhập kho.");
    } finally { setReceiptUploading(false); }
  }

  function updateReceiptActualQty(index: number, rawValue: number) {
    const value = Math.max(0, Math.floor(Number(rawValue) || 0));
    setReceiptItems((items) => items.map((current, itemIndex) => itemIndex === index
      ? { ...current, actual_qty: value, allocations: [] }
      : current));
    setReceiptDrafts((drafts) => {
      const next = { ...drafts };
      delete next[index];
      return next;
    });
    setError("");
  }

  function addReceiptAllocation(index: number) {
    const item = receiptItems[index];
    const draft = receiptDrafts[index];
    const boxesPerCarton = Math.max(1, item?.boxes_per_carton ?? 1);
    const allocated = (item?.allocations ?? []).reduce((sum, allocation) => sum + allocation.quantity, 0);
    const remaining = (item?.actual_qty ?? item?.quantity ?? 0) - allocated;
    const cartons = Math.max(0, Math.floor(Number(draft?.cartons) || 0));
    const looseBoxes = Math.max(0, Math.floor(Number(draft?.looseBoxes) || 0));
    const total = cartons * boxesPerCarton + looseBoxes;
    if (!item || !draft?.locationId) { setError("Vui lòng chọn vị trí kho."); return; }
    if (total < 1) { setError("Nhập số thùng hoặc số hộp lẻ lớn hơn 0."); return; }
    if (total > remaining) { setError(`Vượt quá số còn lại: còn ${remaining} hộp chưa xếp.`); return; }
    setReceiptItems((items) => items.map((current, itemIndex) => itemIndex === index
      ? { ...current, allocations: [...current.allocations, { location_id: Number(draft.locationId), quantity: total }] }
      : current));
    setReceiptDrafts((drafts) => ({ ...drafts, [index]: { locationId: "", cartons: 0, looseBoxes: 0 } }));
    setError("");
  }

  async function confirmReceiptImport() {
    setError(""); setSuccess("");
    if (!receiptWarehouseId || receiptItems.length === 0) { setError("Chưa có dữ liệu nhập kho."); return; }
    const incomplete = receiptItems.find((item) => item.allocations.reduce((sum, allocation) => sum + allocation.quantity, 0) !== (item.actual_qty ?? item.quantity));
    if (incomplete) { setError(`${incomplete.sku} / ${incomplete.lot_number} chưa được phân bổ đủ số hộp thực nhận.`); return; }
    setReceiptConfirming(true);
    try {
      const response = await apiFetch(`${API_URL}/inventory/import/confirm`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          warehouse_id: receiptWarehouseId,
          items: receiptItems,
          invoice_number: receiptItems[0]?.invoice_number || null,
          document_date: receiptItems[0]?.document_date || null,
          ref_code: receiptItems[0]?.invoice_number || refCode.trim() || null,
          note: note.trim() || null,
        }),
      });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "Không thể xác nhận nhập kho.");
      setReceiptItems([]); setReceiptDiscrepancies([]); setSuccess("Đã xác nhận nhập kho và cập nhật tồn theo từng vị trí.");
      setVersion((current) => current + 1);
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "Không thể xác nhận nhập kho.");
    } finally { setReceiptConfirming(false); }
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [stockResponse, transactionResponse, warehouseResponse] = await Promise.all([
          apiFetch(`${API_URL}/inventory/stock-levels/`),
          apiFetch(`${API_URL}/inventory/transactions/`),
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
      const response = await apiFetch(`${API_URL}/inventory/adjust/`, {
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
    { key: "code", title: "Mã giao dịch", sortable: true },
    { key: "createdAt", title: "Thời gian", sortable: true, render: (value) => <span className="text-xs text-gray-500">{formatDateTime(String(value))}</span> },
    { key: "type", title: "Loại", render: (value) => <Badge variant={value === "IN" ? "success" : "purple"}>{ledgerLabels[value as "IN"]}</Badge> },
    { key: "productName", title: "Sản phẩm", render: (value, row) => <div><p className="font-medium text-gray-900">{String(value)}</p><p className="text-xs text-gray-400">{row.productCode} · {row.warehouse}</p></div> },
    { key: "quantity", title: "Số lượng nhập", sortable: true, align: "right", render: (value) => <span className="font-bold text-emerald-600">+{formatNumber(value as number)}</span> },
    { key: "refCode", title: "PO liên quan", render: (value, row) => <div><Badge variant="default">{row.refType}</Badge><p className="text-xs text-gray-400 mt-0.5">{String(value)}</p></div> },
    { key: "createdBy", title: "Người nhập" },
    { key: "note", title: "Ghi chú", render: (value) => <span className="text-xs text-gray-500">{String(value)}</span> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Nhập kho" subtitle="Phiếu nhập kho từ nhà cung cấp và tồn đầu kỳ" actions={
        <div className="flex gap-2">
          <select value={receiptWarehouseId} onChange={(event) => { const value = Number(event.target.value) || ""; setReceiptWarehouseId(value); loadReceiptLocations(value).catch((e) => setError(e instanceof Error ? e.message : "Không thể tải vị trí kho.")); }} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm">
            <option value="">Chọn kho nhập</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
          </select>
          <label className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium cursor-pointer">
            <Upload size={16} /> {receiptUploading ? "Đang đọc…" : "Upload phiếu xếp hàng"}
            <input type="file" accept=".xlsx,.xlsm" className="hidden" disabled={receiptUploading || !receiptWarehouseId} onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadReceipt(file); event.target.value = ""; }} />
          </label>
          <button onClick={openImport} className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"><PackagePlus size={16} /> Tạo phiếu nhập</button>
        </div>
      } />
      {loadError && <div className="bg-red-50 text-red-700 rounded-xl px-4 py-3 text-sm">{loadError}</div>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Phiếu nhập trong kỳ" value={inEntries.filter((entry) => entry.type === "IN").length} icon={<ClipboardList size={20} />} color="bg-sky-50 text-sky-600" />
        <StatCard label="Số lượng đã nhập" value={formatNumber(qtyIn)} icon={<Truck size={20} />} color="bg-emerald-50 text-emerald-600" />
        <StatCard label="Đơn PO liên quan" value={poCount} icon={<PackageCheck size={20} />} color="bg-purple-50 text-purple-600" />
        <StatCard label="Tồn đầu kỳ" value={inEntries.filter((entry) => entry.type === "OPENING").length} icon={<PackagePlus size={20} />} color="bg-amber-50 text-amber-600" />
      </div>
      {receiptItems.length > 0 && <div className="bg-white rounded-xl border border-emerald-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div><h2 className="font-semibold">Phân bổ vị trí từ file Excel</h2><p className="text-xs text-gray-500 mt-1">Tồn kho quản lý theo hộp; số lượng trong cột Số Lượng là nguồn chính.</p><div className="text-xs text-gray-600 mt-2">Số hóa đơn: <b>{receiptItems[0]?.invoice_number || "-"}</b> · Ngày hóa đơn: <b>{receiptItems[0]?.document_date ? formatDateTime(receiptItems[0].document_date) : "-"}</b></div></div>
          <button disabled={receiptConfirming} onClick={() => confirmReceiptImport()} className="bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">{receiptConfirming ? "Đang ghi…" : "Xác nhận nhập kho"}</button>
        </div>
        <div className="px-5 py-3 bg-sky-50 border-b border-sky-100 space-y-2">
        <p className="text-xs text-sky-700">Số lượng chứng từ và thực nhận được đối chiếu riêng. Thủ kho chỉ phân bổ số hộp thực nhận.</p>
        {receiptDiscrepancies.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
          <div className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle size={16} /> Có nợ NCC cũ cần đối chiếu</div>
          <div className="mt-2 space-y-1 text-xs">{receiptDiscrepancies.map((item) => <div key={item.id}>
            {item.type === "SHORTAGE" ? "Thiếu" : "Thừa"} · {item.product_sku ?? `SP #${item.product_id}`}{item.product_name ? ` - ${item.product_name}` : ""} · còn {item.remaining_quantity} hộp · hóa đơn {item.invoice_number || "—"}
          </div>)}</div>
          <p className="mt-2 text-xs">Sau khi xác nhận nhập, mở “Theo dõi nợ NCC” để xem gợi ý và xác nhận bù trừ.</p>
        </div>}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {receiptItems.map((item) => (
              <div key={`${item.sku}-${item.lot_number}-summary`} className="rounded-lg bg-white border border-sky-100 px-3 py-2 text-sm">
                <div className="font-medium text-gray-800">{item.sku} - {item.product_name}</div>
                <div className="mt-1 grid grid-cols-3 gap-2 text-xs">
                  <span><b className="block text-gray-900">{displayNumber(item.cartons, "0")}</b>Tổng thùng</span>
                  <span><b className="block text-gray-900">{displayNumber(item.loose_boxes, "0")}</b>Hộp lẻ</span>
                  <span><b className="block text-gray-900">{displayNumber(item.quantity, "0")}</b>SL chứng từ</span>
                  <span><b className="block text-gray-900">{displayNumber(item.actual_qty ?? item.quantity, "0")}</b>SL thực nhận</span>
                </div>
                <div className="mt-1 text-[11px] text-gray-500">Quy đổi: {displayNumber(item.boxes_per_carton, "1")} hộp/thùng</div>
              </div>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left">Mã hàng</th>
                <th className="px-4 py-3 text-left">ĐVT</th>
                <th className="px-4 py-3 text-left">Lot</th>
                <th className="px-4 py-3 text-left">HSD</th>
                <th className="px-4 py-3 text-right">SL chứng từ</th>
                <th className="px-4 py-3 text-right">SL thực nhận</th>
                <th className="px-4 py-3 text-right">Chênh lệch</th>
                <th className="px-4 py-3 text-left">Phân bổ vị trí</th>
                <th className="px-4 py-3 text-left">Thêm vị trí</th>
              </tr>
            </thead>
            <tbody>
              {receiptItems.map((item, index) => {
                const actual = item.actual_qty ?? item.quantity;
                const difference = actual - item.quantity;
                const allocated = item.allocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
                const remainingForDraft = Math.max(0, actual - allocated);
                const defaultCartons = Math.floor(remainingForDraft / Math.max(1, item.boxes_per_carton));
                const defaultLoose = remainingForDraft % Math.max(1, item.boxes_per_carton);
                const draft = receiptDrafts[index] ?? {
                  locationId: "",
                  cartons: defaultCartons,
                  looseBoxes: defaultLoose,
                };
                return (
                  <tr key={`${item.sku}-${item.lot_number}`} className="border-t border-gray-50 align-top">
                    <td className="px-4 py-3">
                      <b>{item.sku}</b>
                      <div className="text-xs text-gray-500">{item.product_name}</div>
                      <div className="text-xs text-gray-400">Hóa đơn: {item.invoice_number || "-"}</div>
                      {item.note && <div className="text-xs text-gray-400">Ghi chú: {item.note}</div>}
                    </td>
                    <td className="px-4 py-3">{item.unit || "-"}</td>
                    <td className="px-4 py-3">{item.lot_number}</td>
                    <td className="px-4 py-3">{new Date(item.expiry_date).toLocaleDateString("vi-VN")}</td>
                    <td className="px-4 py-3 text-right font-medium">{displayNumber(item.quantity, "0")}</td>
                    <td className="px-4 py-3 text-right font-medium">
                      <input
                        type="number"
                        min={0}
                        value={actual}
                        onChange={(event) => updateReceiptActualQty(index, Number(event.target.value))}
                        className="w-20 border rounded px-2 py-1 text-xs text-right"
                      />
                      <div className={`text-xs ${difference === 0 ? "text-gray-500" : difference < 0 ? "text-red-600" : "text-amber-600"}`}>
                        {difference === 0 ? "Khớp" : difference < 0 ? `Thiếu ${Math.abs(difference)}` : `Thừa ${difference}`}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      {difference === 0
                        ? <Badge variant="default">Khớp</Badge>
                        : <Badge variant={difference < 0 ? "danger" : "warning"}>{difference > 0 ? `+${difference}` : difference}</Badge>}
                    </td>
                    <td className="px-4 py-3">
                      {item.allocations.length === 0
                        ? <span className="text-gray-400">Chưa phân bổ</span>
                        : item.allocations.map((allocation, allocationIndex) => (
                          <div key={`${allocation.location_id}-${allocationIndex}`} className="flex items-center gap-1 text-xs mb-1">
                            <MapPin size={12} />
                            {receiptLocations.find((location) => location.id === allocation.location_id)?.code ?? allocation.location_id}:
                            {" "}{formatAllocationQty(allocation.quantity, item.boxes_per_carton)}
                          </div>
                        ))}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <select value={draft.locationId} onChange={(event) => setReceiptDrafts((drafts) => ({
                          ...drafts,
                          [index]: { ...draft, locationId: Number(event.target.value) || "" },
                        }))} className="border rounded px-2 py-1 text-xs">
                          <option value="">Vị trí</option>
                          {receiptLocations.filter((location) => location.is_active).map((location) => (
                            <option key={location.id} value={location.id}>{location.code}</option>
                          ))}
                        </select>
                        <input type="number" min={0} max={Math.floor(remainingForDraft / Math.max(1, item.boxes_per_carton))} value={draft.cartons} onChange={(event) => setReceiptDrafts((drafts) => ({
                          ...drafts,
                          [index]: { ...draft, cartons: Math.max(0, Math.floor(Number(event.target.value) || 0)) },
                        }))} className="w-14 border rounded px-2 py-1 text-xs text-right" placeholder="Thùng" />
                        <span className="text-xs text-gray-400 self-center">th +</span>
                        <input type="number" min={0} max={remainingForDraft} value={draft.looseBoxes} onChange={(event) => setReceiptDrafts((drafts) => ({
                          ...drafts,
                          [index]: { ...draft, looseBoxes: Math.max(0, Math.floor(Number(event.target.value) || 0)) },
                        }))} className="w-14 border rounded px-2 py-1 text-xs text-right" placeholder="Lẻ" />
                        <span className="text-xs text-gray-500 self-center whitespace-nowrap">
                          = {draft.cartons * Math.max(1, item.boxes_per_carton) + draft.looseBoxes} hộp
                        </span>
                        <button onClick={() => addReceiptAllocation(index)} className="bg-sky-500 text-white rounded px-2 text-xs">+</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>}
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

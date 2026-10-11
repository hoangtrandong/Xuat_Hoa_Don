"use client";

import { useEffect, useMemo, useState } from "react";
import { PackagePlus, Truck, PackageCheck, ClipboardList, Upload, MapPin, CheckCircle2, ArrowLeftRight } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import DataTable, { Column } from "@/components/ui/DataTable";
import Badge from "@/components/ui/Badge";
import Drawer from "@/components/ui/Drawer";
import { ledgerLabels, type LedgerEntry, type StockLevel } from "@/lib/mock-inventory";
import { formatNumber, formatDateTime } from "@/lib/format";
import { API_URL, apiFetch } from "@/lib/api";

// ─── Interfaces ───────────────────────────────────────────────────────────────

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
  document_date: string | null;
}

interface ApiWarehouse { id: number; name: string }
interface ApiLocation  { id: number; warehouse_id: number; code: string; is_active: boolean }

interface ImportAllocation { location_id: number; quantity: number }
interface ImportItem {
  product_id: number; sku: string; product_name: string; unit?: string | null;
  lot_number: string; expiry_date: string; source_location_code?: string | null;
  boxes_per_carton: number; cartons: number; loose_boxes: number; quantity: number;
  allocations: ImportAllocation[];
  actual_qty?: number | null;
  delivery_references?: string | null; po_references?: string | null;
  document_date?: string | null;
  invoice_number?: string | null; unit_price?: number | null; amount?: number | null; note?: string | null;
}

interface SupplierDiscrepancy {
  id: number; warehouse_id: number; product_id: number;
  product_sku?: string | null; product_name?: string | null;
  type: "SHORTAGE" | "EXCESS";
  document_quantity: number; actual_quantity: number;
  quantity: number; remaining_quantity: number;
  lot_number: string | null; invoice_number: string | null;
  document_date: string | null; status: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
    ? item.boxes_per_carton : 1;
  const quantity = Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 0;
  return {
    ...item,
    boxes_per_carton: boxesPerCarton,
    cartons: Math.floor(quantity / boxesPerCarton),
    loose_boxes: quantity % boxesPerCarton,
    quantity,
    unit_price: Number.isFinite(item.unit_price) ? item.unit_price : null,
    amount: Number.isFinite(item.amount) ? item.amount : null,
    allocations: Array.isArray(item.allocations) ? item.allocations : [],
  };
}

function toStockLevel(item: ApiStockLevel): StockLevel {
  return {
    id: String(item.product_id), productCode: item.product_code,
    productName: item.product_name, category: item.category_name || item.category || "", unit: item.unit,
    onHand: item.on_hand, reserved: item.reserved, available: item.available,
    reorderPoint: item.reorder_level, unitValue: 0, totalValue: 0,
  };
}

function toLedgerEntry(
  item: ApiTransaction,
  stocks: Map<number, ApiStockLevel>,
  warehouses: Map<number, string>,
): LedgerEntry {
  const stock = stocks.get(item.product_id);
  return {
    id: item.id, code: item.code, type: item.type,
    productCode: stock?.product_code ?? String(item.product_id),
    productName: stock?.product_name ?? "Sản phẩm",
    unit: stock?.unit ?? "",
    warehouse: warehouses.get(item.warehouse_id) ?? `Kho #${item.warehouse_id}`,
    quantity: item.quantity, refType: item.ref_type ?? "", refCode: item.ref_code ?? "",
    createdAt: item.created_at, createdBy: item.created_by ?? "", note: item.note ?? "",
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ImportPage() {
  // ── dữ liệu chính ──
  const [version, setVersion] = useState(0);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [stockLevels, setStockLevels] = useState<StockLevel[]>([]);
  const [warehouses, setWarehouses] = useState<ApiWarehouse[]>([]);
  const [loadError, setLoadError] = useState("");

  // ── import thủ công (drawer) ──
  const [importOpen, setImportOpen] = useState(false);
  const [productCode, setProductCode] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [warehouseId, setWarehouseId] = useState<number | "">("");
  const [refCode, setRefCode] = useState("");
  const [note, setNote] = useState("");

  // ── upload phiếu xếp hàng ──
  const [receiptItems, setReceiptItems] = useState<ImportItem[]>([]);
  const [receiptWarehouseId, setReceiptWarehouseId] = useState<number | "">("");
  const [receiptLocations, setReceiptLocations] = useState<ApiLocation[]>([]);
  const [receiptDrafts, setReceiptDrafts] = useState<Record<number, { locationId: number | ""; cartons: number; looseBoxes: number }>>({});
  const [receiptUploading, setReceiptUploading] = useState(false);
  const [receiptConfirming, setReceiptConfirming] = useState(false);

  // ── nợ NCC có sẵn trong kho, group theo product_id ──
  const [existingDiscrepancies, setExistingDiscrepancies] = useState<SupplierDiscrepancy[]>([]);

  /**
   * itemOffsetSelections[itemIndex] = id của discrepancy cũ mà thủ kho
   * muốn bù trừ với chênh lệch của dòng hàng này.
   * "" = không bù trừ.
   */
  const [itemOffsetSelections, setItemOffsetSelections] = useState<Record<number, number | "">>({});

  // ── thông báo ──
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // ── group discrepancies theo product_id để tra cứu nhanh ──
  const discrepancyByProduct = useMemo(() => {
    const map: Record<number, { shortages: SupplierDiscrepancy[]; excesses: SupplierDiscrepancy[] }> = {};
    for (const d of existingDiscrepancies) {
      if (!map[d.product_id]) map[d.product_id] = { shortages: [], excesses: [] };
      if (d.type === "SHORTAGE") map[d.product_id].shortages.push(d);
      else map[d.product_id].excesses.push(d);
    }
    return map;
  }, [existingDiscrepancies]);

  // ─── Load dữ liệu kho ───────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [stockRes, txnRes, whRes] = await Promise.all([
          apiFetch(`${API_URL}/inventory/stock-levels/`),
          apiFetch(`${API_URL}/inventory/transactions/`),
          apiFetch(`${API_URL}/inventory/warehouses/`),
        ]);
        if (!stockRes.ok || !txnRes.ok || !whRes.ok) throw new Error("Không thể tải dữ liệu kho từ API.");
        const stocks    = await stockRes.json() as ApiStockLevel[];
        const txns      = await txnRes.json() as ApiTransaction[];
        const whList    = await whRes.json() as ApiWarehouse[];
        if (cancelled) return;
        const stockMap = new Map(stocks.map((s) => [s.product_id, s]));
        const whMap    = new Map(whList.map((w) => [w.id, w.name]));
        setStockLevels(stocks.map(toStockLevel));
        setLedgerEntries(txns.map((t) => toLedgerEntry(t, stockMap, whMap)));
        setWarehouses(whList);
        setLoadError("");
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Không thể tải dữ liệu kho.");
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [version]);

  // ─── Handlers ───────────────────────────────────────────────────────────────

  async function loadReceiptLocations(warehouse: number | "") {
    if (!warehouse) { setReceiptLocations([]); return; }
    const res = await apiFetch(`${API_URL}/inventory/locations/?warehouse_id=${warehouse}`);
    if (!res.ok) throw new Error("Không thể tải vị trí kho.");
    setReceiptLocations(await res.json() as ApiLocation[]);
  }

  async function uploadReceipt(file: File) {
    if (!receiptWarehouseId) { setError("Vui lòng chọn kho nhập trước khi upload."); return; }
    setError(""); setSuccess(""); setReceiptUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await apiFetch(
        `${API_URL}/inventory/import/upload?warehouse_id=${receiptWarehouseId}`,
        { method: "POST", body },
      );
      const result = await res.json() as ImportItem[] | { detail?: string };
      if (!res.ok) throw new Error("detail" in result ? (result.detail ?? "Không thể đọc file.") : "Không thể đọc file.");

      const items = (result as ImportItem[]).map(normalizeImportItem);
      setReceiptItems(items);
      setReceiptDrafts({});
      setItemOffsetSelections({});

      // Load cả OPEN lẫn PARTIAL — bỏ filter status để không bỏ sót nợ đã bù 1 phần
      // Lọc bỏ RESOLVED ở frontend, chỉ giữ khoản còn remaining_quantity > 0
      const [dResOpen, dResPartial] = await Promise.all([
        apiFetch(`${API_URL}/inventory/supplier-discrepancies/?warehouse_id=${receiptWarehouseId}&status=OPEN`),
        apiFetch(`${API_URL}/inventory/supplier-discrepancies/?warehouse_id=${receiptWarehouseId}&status=PARTIAL`),
      ]);
      const allDiscrepancies: SupplierDiscrepancy[] = [];
      if (dResOpen.ok) allDiscrepancies.push(...(await dResOpen.json() as SupplierDiscrepancy[]));
      if (dResPartial.ok) allDiscrepancies.push(...(await dResPartial.json() as SupplierDiscrepancy[]));
      const ids = new Set(items.map((i) => i.product_id));
      setExistingDiscrepancies(
        allDiscrepancies.filter((d) => ids.has(d.product_id) && d.remaining_quantity > 0),
      );
      setSuccess(`Đã đọc ${items.length} dòng mã hàng + lot. Hãy nhập SL thực nhận và phân bổ vị trí.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể đọc file nhập kho.");
    } finally { setReceiptUploading(false); }
  }

  function updateReceiptActualQty(index: number, rawValue: number) {
    const value = Math.max(0, Math.floor(Number(rawValue) || 0));
    setReceiptItems((items) => items.map((cur, i) =>
      i === index ? { ...cur, actual_qty: value, allocations: [] } : cur,
    ));
    setReceiptDrafts((drafts) => { const n = { ...drafts }; delete n[index]; return n; });
    // Reset offset selection khi SL thay đổi
    setItemOffsetSelections((sel) => { const n = { ...sel }; delete n[index]; return n; });
    setError("");
  }

  function addReceiptAllocation(index: number) {
    const item  = receiptItems[index];
    const draft = receiptDrafts[index];
    const bpc   = Math.max(1, item?.boxes_per_carton ?? 1);
    const allocated = (item?.allocations ?? []).reduce((s, a) => s + a.quantity, 0);
    const remaining = (item?.actual_qty ?? item?.quantity ?? 0) - allocated;
    const cartons   = Math.max(0, Math.floor(Number(draft?.cartons) || 0));
    const loose     = Math.max(0, Math.floor(Number(draft?.looseBoxes) || 0));
    const total     = cartons * bpc + loose;
    if (!item || !draft?.locationId) { setError("Vui lòng chọn vị trí kho."); return; }
    if (total < 1) { setError("Nhập số thùng hoặc số hộp lẻ lớn hơn 0."); return; }
    if (total > remaining) { setError(`Vượt quá số còn lại: còn ${remaining} hộp chưa xếp.`); return; }
    setReceiptItems((items) => items.map((cur, i) =>
      i === index
        ? { ...cur, allocations: [...cur.allocations, { location_id: Number(draft.locationId), quantity: total }] }
        : cur,
    ));
    setReceiptDrafts((drafts) => ({ ...drafts, [index]: { locationId: "", cartons: 0, looseBoxes: 0 } }));
    setError("");
  }

  async function confirmReceiptImport() {
    setError(""); setSuccess("");
    if (!receiptWarehouseId || receiptItems.length === 0) { setError("Chưa có dữ liệu nhập kho."); return; }
    const incomplete = receiptItems.find(
      (item) => item.allocations.reduce((s, a) => s + a.quantity, 0) !== (item.actual_qty ?? item.quantity),
    );
    if (incomplete) {
      setError(`${incomplete.sku} / ${incomplete.lot_number} chưa được phân bổ đủ số hộp thực nhận.`);
      return;
    }

    // Ghi nhớ các offset selection trước khi clear state
    const offsetSelections = { ...itemOffsetSelections };

    setReceiptConfirming(true);
    try {
      // ── Bước 1: Xác nhận nhập kho ──
      const res = await apiFetch(`${API_URL}/inventory/import/confirm`, {
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
      const result = await res.json() as { detail?: string };
      if (!res.ok) throw new Error(result.detail ?? "Không thể xác nhận nhập kho.");

      // ── Bước 2: Thực hiện bù trừ theo lựa chọn của thủ kho ──
      const offsetResults: { success: boolean; label: string }[] = [];

      for (const [indexStr, targetDiscrepancyId] of Object.entries(offsetSelections)) {
        if (!targetDiscrepancyId) continue;
        const index = Number(indexStr);
        const item  = receiptItems[index];
        if (!item) continue;

        const actual     = item.actual_qty ?? item.quantity;
        const difference = actual - item.quantity;
        if (difference === 0) continue;

        const targetDiscrepancy = existingDiscrepancies.find((d) => d.id === targetDiscrepancyId);
        if (!targetDiscrepancy) continue;

        // Sau khi import xong, load suggestions cho discrepancy target để lấy ID của discrepancy mới
        try {
          const suggestRes = await apiFetch(
            `${API_URL}/inventory/supplier-discrepancies/${targetDiscrepancyId}/offset-suggestions`,
          );
          if (!suggestRes.ok) continue;
          const suggestions = await suggestRes.json() as (SupplierDiscrepancy & { suggested_quantity: number })[];

          // Tìm discrepancy đối ứng (opposite type) vừa được tạo từ import này
          const oppositeType = targetDiscrepancy.type === "SHORTAGE" ? "EXCESS" : "SHORTAGE";
          // Lấy discrepancy mới nhất của sản phẩm này với type đối ứng
          const match = [...suggestions]
            .reverse()
            .find((s) => s.type === oppositeType && s.product_id === item.product_id);
          if (!match) continue;

          const shortageId = targetDiscrepancy.type === "SHORTAGE" ? targetDiscrepancy.id : match.id;
          const excessId   = targetDiscrepancy.type === "EXCESS"   ? targetDiscrepancy.id : match.id;
          const qty        = Math.min(match.suggested_quantity, Math.abs(difference));

          const offsetRes = await apiFetch(`${API_URL}/inventory/supplier-discrepancies/offsets/confirm`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ shortage_id: shortageId, excess_id: excessId, quantity: qty }),
          });
          const offsetResult = await offsetRes.json() as { detail?: string };
          offsetResults.push({
            success: offsetRes.ok,
            label: `${item.sku} ↔ HĐ ${targetDiscrepancy.invoice_number ?? targetDiscrepancyId}${!offsetRes.ok ? ` (${offsetResult.detail ?? "lỗi"})` : ""}`,
          });
        } catch {
          offsetResults.push({ success: false, label: `${item.sku}: lỗi không xác định` });
        }
      }

      // ── Dọn state ──
      setReceiptItems([]); setReceiptDrafts({});
      setExistingDiscrepancies([]); setItemOffsetSelections({});
      setVersion((v) => v + 1);

      const successCount = offsetResults.filter((r) => r.success).length;
      const failCount    = offsetResults.filter((r) => !r.success).length;
      let msg = "Đã xác nhận nhập kho và cập nhật tồn kho.";
      if (successCount > 0) msg += ` Bù trừ NCC: ${successCount} khoản thành công.`;
      if (failCount > 0)    msg += ` ${failCount} khoản bù trừ thất bại — kiểm tra trang Sổ Nợ NCC.`;
      setSuccess(msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể xác nhận nhập kho.");
    } finally { setReceiptConfirming(false); }
  }

  // ─── Import thủ công ────────────────────────────────────────────────────────

  function openImport() {
    setProductCode(""); setQuantity(1);
    setWarehouseId(warehouses[0]?.id ?? "");
    setRefCode(""); setNote(""); setError(""); setSuccess("");
    setImportOpen(true);
  }

  async function submitImport() {
    setError(""); setSuccess("");
    const stock = stockLevels.find((s) => s.productCode === productCode);
    if (!stock) { setError("Vui lòng chọn sản phẩm."); return; }
    if (!warehouseId) { setError("Vui lòng chọn kho nhập."); return; }
    if (quantity < 1) { setError("Số lượng phải lớn hơn 0."); return; }
    try {
      const res = await apiFetch(`${API_URL}/inventory/adjust/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "IN", warehouse_id: warehouseId, product_id: Number(stock.id),
          quantity, ref_type: "PO", ref_code: refCode.trim() || null,
          note: note.trim() || `Nhập kho ${stock.productName}`,
        }),
      });
      const result = await res.json() as { code?: string; detail?: string };
      if (!res.ok) throw new Error(result.detail ?? "Không thể ghi phiếu nhập.");
      setSuccess(`Đã ghi phiếu nhập ${result.code ?? ""} vào PostgreSQL.`);
      setVersion((v) => v + 1);
      setTimeout(() => { setImportOpen(false); setSuccess(""); }, 900);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể ghi phiếu nhập.");
    }
  }

  // ─── Computed ───────────────────────────────────────────────────────────────

  const inEntries = ledgerEntries.filter((e) => e.type === "IN" || e.type === "OPENING");
  const qtyIn     = inEntries.filter((e) => e.type === "IN").reduce((s, e) => s + e.quantity, 0);
  const poCount   = new Set(inEntries.filter((e) => e.type === "IN").map((e) => e.refCode)).size;

  const columns: Column<LedgerEntry>[] = [
    { key: "code", title: "Mã giao dịch", sortable: true },
    { key: "createdAt", title: "Thời gian", sortable: true, render: (v) => <span className="text-xs text-gray-500">{formatDateTime(String(v))}</span> },
    { key: "type", title: "Loại", render: (v) => <Badge variant={v === "IN" ? "success" : "purple"}>{ledgerLabels[v as "IN"]}</Badge> },
    { key: "productName", title: "Sản phẩm", render: (v, row) => <div><p className="font-medium text-gray-900">{String(v)}</p><p className="text-xs text-gray-400">{row.productCode} · {row.warehouse}</p></div> },
    { key: "quantity", title: "Số lượng nhập", sortable: true, align: "right", render: (v) => <span className="font-bold text-emerald-600">+{formatNumber(v as number)}</span> },
    { key: "refCode", title: "PO liên quan", render: (v, row) => <div><Badge variant="default">{row.refType}</Badge><p className="text-xs text-gray-400 mt-0.5">{String(v)}</p></div> },
    { key: "createdBy", title: "Người nhập" },
    { key: "note", title: "Ghi chú", render: (v) => <span className="text-xs text-gray-500">{String(v)}</span> },
  ];

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nhập kho"
        subtitle="Phiếu nhập kho từ nhà cung cấp và tồn đầu kỳ"
        actions={
          <div className="flex gap-2">
            <select
              value={receiptWarehouseId}
              onChange={(e) => {
                const v = Number(e.target.value) || "";
                setReceiptWarehouseId(v);
                loadReceiptLocations(v).catch((err) => setError(err instanceof Error ? err.message : "Không thể tải vị trí kho."));
              }}
              className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm"
            >
              <option value="">Chọn kho nhập</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <label className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium cursor-pointer">
              <Upload size={16} />
              {receiptUploading ? "Đang đọc…" : "Upload phiếu xếp hàng"}
              <input
                type="file" accept=".xlsx,.xlsm" className="hidden"
                disabled={receiptUploading || !receiptWarehouseId}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadReceipt(f); e.target.value = ""; }}
              />
            </label>
            <button onClick={openImport} className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-medium">
              <PackagePlus size={16} /> Tạo phiếu nhập
            </button>
          </div>
        }
      />

      {loadError && <div className="bg-red-50 text-red-700 rounded-xl px-4 py-3 text-sm">{loadError}</div>}
      {error   && <div className="bg-red-50 text-red-700 rounded-xl px-4 py-3 text-sm">{error}</div>}
      {success && <div className="bg-emerald-50 text-emerald-700 rounded-xl px-4 py-3 text-sm">{success}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Phiếu nhập trong kỳ" value={inEntries.filter((e) => e.type === "IN").length} icon={<ClipboardList size={20} />} color="bg-sky-50 text-sky-600" />
        <StatCard label="Số lượng đã nhập"    value={formatNumber(qtyIn)}                             icon={<Truck size={20} />}         color="bg-emerald-50 text-emerald-600" />
        <StatCard label="Đơn PO liên quan"    value={poCount}                                          icon={<PackageCheck size={20} />}  color="bg-purple-50 text-purple-600" />
        <StatCard label="Tồn đầu kỳ"          value={inEntries.filter((e) => e.type === "OPENING").length} icon={<PackagePlus size={20} />} color="bg-amber-50 text-amber-600" />
      </div>

      {/* ── Bảng phân bổ từ file Excel ── */}
      {receiptItems.length > 0 && (
        <div className="bg-white rounded-xl border border-emerald-100 overflow-hidden">
          {/* Header */}
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Phân bổ vị trí từ file Excel</h2>
              <p className="text-xs text-gray-500 mt-1">
                Tồn kho quản lý theo hộp. Nhập SL thực nhận, phân bổ vị trí.
                Nếu có chênh lệch, chọn hóa đơn nợ NCC cần bù trừ.
              </p>
              <div className="text-xs text-gray-600 mt-1">
                Số hóa đơn: <b>{receiptItems[0]?.invoice_number || "–"}</b>
                {" · "}Ngày: <b>{receiptItems[0]?.document_date ? formatDateTime(receiptItems[0].document_date) : "–"}</b>
              </div>
            </div>
            <button
              disabled={receiptConfirming}
              onClick={() => void confirmReceiptImport()}
              className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {receiptConfirming ? "Đang ghi…" : "Xác nhận nhập kho"}
            </button>
          </div>

          {/* Bảng chi tiết */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs">
                <tr>
                  <th className="px-4 py-3 text-left">Mã hàng</th>
                  <th className="px-4 py-3 text-left">ĐVT</th>
                  <th className="px-4 py-3 text-left">Lot</th>
                  <th className="px-4 py-3 text-left">HSD</th>
                  <th className="px-4 py-3 text-right">SL chứng từ</th>
                  <th className="px-4 py-3 text-right">SL thực nhận</th>
                  <th className="px-4 py-3 text-center">Chênh lệch</th>
                  <th className="px-4 py-3 text-left min-w-[220px]">Bù trừ nợ NCC</th>
                  <th className="px-4 py-3 text-left">Vị trí đã phân bổ</th>
                  <th className="px-4 py-3 text-left min-w-[260px]">Thêm vị trí</th>
                </tr>
              </thead>
              <tbody>
                {receiptItems.map((item, index) => {
                  const actual     = item.actual_qty ?? item.quantity;
                  const difference = actual - item.quantity;
                  const allocated  = item.allocations.reduce((s, a) => s + a.quantity, 0);
                  const remaining  = Math.max(0, actual - allocated);
                  const bpc        = Math.max(1, item.boxes_per_carton);
                  const draft      = receiptDrafts[index] ?? {
                    locationId: "", cartons: Math.floor(remaining / bpc), looseBoxes: remaining % bpc,
                  };

                  // Các khoản nợ NCC cũ của sản phẩm này để hiển thị trong dropdown
                  const productDebt = discrepancyByProduct[item.product_id];
                  // Nếu thừa (difference > 0) → chọn SHORTAGE cũ để bù
                  // Nếu thiếu (difference < 0) → chọn EXCESS cũ để bù
                  const offsetOptions: SupplierDiscrepancy[] =
                    difference > 0 ? (productDebt?.shortages ?? []) :
                    difference < 0 ? (productDebt?.excesses  ?? []) : [];

                  const selectedOffsetId = itemOffsetSelections[index] ?? "";
                  const selectedOffset   = existingDiscrepancies.find((d) => d.id === selectedOffsetId);

                  return (
                    <tr key={`${item.sku}-${item.lot_number}`} className="border-t border-gray-50 align-top hover:bg-gray-50/50">
                      {/* Mã hàng */}
                      <td className="px-4 py-3">
                        <b>{item.sku}</b>
                        <div className="text-xs text-gray-500">{item.product_name}</div>
                        <div className="text-xs text-gray-400">HĐ: {item.invoice_number || "–"}</div>
                        {item.note && <div className="text-xs text-gray-400">Ghi chú: {item.note}</div>}
                      </td>

                      {/* ĐVT */}
                      <td className="px-4 py-3">{item.unit || "–"}</td>

                      {/* Lot */}
                      <td className="px-4 py-3 whitespace-nowrap">{item.lot_number}</td>

                      {/* HSD */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        {new Date(item.expiry_date).toLocaleDateString("vi-VN")}
                      </td>

                      {/* SL chứng từ */}
                      <td className="px-4 py-3 text-right font-medium">{displayNumber(item.quantity, "0")}</td>

                      {/* SL thực nhận */}
                      <td className="px-4 py-3 text-right">
                        <input
                          type="number" min={0} value={actual}
                          onChange={(e) => updateReceiptActualQty(index, Number(e.target.value))}
                          className="w-20 border rounded px-2 py-1 text-xs text-right"
                        />
                        <div className={`text-xs mt-0.5 ${
                          difference === 0 ? "text-gray-400"
                          : difference < 0 ? "text-red-600 font-medium"
                          : "text-amber-600 font-medium"
                        }`}>
                          {difference === 0 ? "Khớp"
                            : difference < 0 ? `Thiếu ${Math.abs(difference)} hộp`
                            : `Thừa ${difference} hộp`}
                        </div>
                      </td>

                      {/* Chênh lệch badge */}
                      <td className="px-4 py-3 text-center">
                        {difference === 0
                          ? <Badge variant="default">Khớp</Badge>
                          : <Badge variant={difference < 0 ? "danger" : "warning"}>
                              {difference > 0 ? `+${difference}` : difference}
                            </Badge>}
                      </td>

                      {/* ── Bù trừ nợ NCC ── */}
                      <td className="px-4 py-3">
                        {difference === 0 ? (
                          <span className="text-xs text-gray-300">Không cần</span>
                        ) : offsetOptions.length === 0 ? (
                          <span className="text-xs text-gray-400 italic">
                            {difference > 0
                              ? "Không có nợ thiếu NCC để bù"
                              : "Không có hàng thừa NCC để bù"}
                          </span>
                        ) : (
                          <div className="space-y-1">
                            <label className="text-[11px] text-gray-500 font-medium flex items-center gap-1">
                              <ArrowLeftRight size={11} />
                              {difference > 0 ? "Bù vào nợ thiếu HĐ:" : "Bù từ hàng thừa HĐ:"}
                            </label>
                            <select
                              value={selectedOffsetId}
                              onChange={(e) => setItemOffsetSelections((s) => ({
                                ...s, [index]: Number(e.target.value) || "",
                              }))}
                              className="w-full border border-gray-200 rounded px-2 py-1 text-xs bg-white"
                            >
                              <option value="">— Không bù trừ —</option>
                              {offsetOptions.map((d) => (
                                <option key={d.id} value={d.id}>
                                  HĐ {d.invoice_number ?? `#${d.id}`}
                                  {" · "}còn {d.remaining_quantity} hộp
                                  {d.product_sku ? ` · ${d.product_sku}` : ""}
                                </option>
                              ))}
                            </select>
                            {selectedOffset && (
                              <div className="flex items-center gap-1 text-[11px] text-emerald-700 bg-emerald-50 rounded px-2 py-1">
                                <CheckCircle2 size={11} />
                                Sẽ bù {Math.min(Math.abs(difference), selectedOffset.remaining_quantity)} hộp
                                {" "}sau khi xác nhận nhập
                              </div>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Vị trí đã phân bổ */}
                      <td className="px-4 py-3">
                        {item.allocations.length === 0
                          ? <span className="text-gray-400 text-xs">Chưa phân bổ</span>
                          : item.allocations.map((a, ai) => (
                            <div key={`${a.location_id}-${ai}`} className="flex items-center gap-1 text-xs mb-1">
                              <MapPin size={12} />
                              {receiptLocations.find((l) => l.id === a.location_id)?.code ?? a.location_id}:
                              {" "}{formatAllocationQty(a.quantity, item.boxes_per_carton)}
                            </div>
                          ))}
                      </td>

                      {/* Thêm vị trí */}
                      <td className="px-4 py-3">
                        <div className="flex gap-1 flex-wrap">
                          <select
                            value={draft.locationId}
                            onChange={(e) => setReceiptDrafts((d) => ({
                              ...d, [index]: { ...draft, locationId: Number(e.target.value) || "" },
                            }))}
                            className="border rounded px-2 py-1 text-xs"
                          >
                            <option value="">Vị trí</option>
                            {receiptLocations.filter((l) => l.is_active).map((l) => (
                              <option key={l.id} value={l.id}>{l.code}</option>
                            ))}
                          </select>
                          <input
                            type="number" min={0}
                            max={Math.floor(remaining / bpc)}
                            value={draft.cartons}
                            onChange={(e) => setReceiptDrafts((d) => ({
                              ...d, [index]: { ...draft, cartons: Math.max(0, Math.floor(Number(e.target.value) || 0)) },
                            }))}
                            className="w-14 border rounded px-2 py-1 text-xs text-right" placeholder="Thùng"
                          />
                          <span className="text-xs text-gray-400 self-center">th +</span>
                          <input
                            type="number" min={0} max={remaining}
                            value={draft.looseBoxes}
                            onChange={(e) => setReceiptDrafts((d) => ({
                              ...d, [index]: { ...draft, looseBoxes: Math.max(0, Math.floor(Number(e.target.value) || 0)) },
                            }))}
                            className="w-14 border rounded px-2 py-1 text-xs text-right" placeholder="Lẻ"
                          />
                          <span className="text-xs text-gray-500 self-center whitespace-nowrap">
                            = {draft.cartons * bpc + draft.looseBoxes} hộp
                          </span>
                          <button
                            onClick={() => addReceiptAllocation(index)}
                            className="bg-sky-500 hover:bg-sky-600 text-white rounded px-2 text-xs"
                          >+</button>
                        </div>
                        {remaining > 0 && (
                          <div className="text-[11px] text-amber-600 mt-1">Còn {remaining} hộp chưa xếp</div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Sổ nhập kho ── */}
      <DataTable
        data={inEntries}
        columns={columns}
        searchKeys={["code", "productName", "productCode", "refCode", "createdBy"]}
        searchPlaceholder="Tìm phiếu nhập, sản phẩm, PO..."
      />

      {/* ── Drawer tạo phiếu thủ công ── */}
      <Drawer open={importOpen} onClose={() => setImportOpen(false)} title="Tạo phiếu nhập kho" subtitle="Ghi nhận nhập hàng và cập nhật tồn kho">
        <div className="p-5 space-y-4">
          {error   && <div className="bg-red-50 text-red-700 rounded-xl px-3 py-2 text-sm">{error}</div>}
          {success && <div className="bg-emerald-50 text-emerald-700 rounded-xl px-3 py-2 text-sm">{success}</div>}
          <label className="block">
            <span className="text-xs text-gray-500">Sản phẩm</span>
            <select value={productCode} onChange={(e) => setProductCode(e.target.value)} className="mt-1 w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg">
              <option value="">-- Chọn sản phẩm --</option>
              {stockLevels.map((s) => <option key={s.productCode} value={s.productCode}>{s.productName} ({s.productCode})</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Số lượng nhập</span>
            <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))} className="mt-1 w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg" />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Kho nhập</span>
            <select value={warehouseId} onChange={(e) => setWarehouseId(Number(e.target.value))} className="mt-1 w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg">
              <option value="">-- Chọn kho --</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Mã đơn nhập (tùy chọn)</span>
            <input value={refCode} onChange={(e) => setRefCode(e.target.value)} placeholder="VD: PO-260906-001" className="mt-1 w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg" />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">Ghi chú</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Ghi chú nhập hàng..." className="mt-1 w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg" />
          </label>
          <button onClick={() => void submitImport()} className="w-full bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium rounded-lg py-2.5">
            Ghi phiếu &amp; cập nhật tồn
          </button>
        </div>
      </Drawer>
    </div>
  );
}

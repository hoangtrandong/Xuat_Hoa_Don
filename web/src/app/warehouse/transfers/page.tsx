"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, Plus, RefreshCw, Trash2 } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Badge from "@/components/ui/Badge";
import { API_URL } from "@/lib/api";
import { formatDateTime, formatNumber } from "@/lib/format";

interface Warehouse { id: number; name: string }
interface Location { id: number; warehouse_id: number; code: string; is_active: boolean }
interface Product { id: number; sku: string; name: string }
interface Lot {
  id: number; warehouse_id: number; location_id: number | null; product_id: number;
  lot_number: string | null; expiry_date: string | null; quantity_on_hand: number;
}
interface TransferRow {
  product_id: number; source_location_id: number | ""; destination_location_id: number | ""; quantity: number;
  product_query: string;
}
interface Transfer {
  id: number; code: string; warehouse_id: number; status: string; note: string | null;
  created_by: string | null; created_at: string; confirmed_at: string | null;
  items: Array<{ product_id: number; lot_id: number; source_location_id: number; destination_location_id: number; quantity: number }>;
}

export default function LocationTransferPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [lots, setLots] = useState<Lot[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [warehouseId, setWarehouseId] = useState<number | "">("");
  const [rows, setRows] = useState<TransferRow[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const locationMap = useMemo(() => new Map(locations.map((location) => [location.id, location.code])), [locations]);
  const productMap = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const activeLocations = locations.filter((location) => location.is_active && location.warehouse_id === warehouseId);
  const warehouseLots = lots.filter((lot) => lot.warehouse_id === warehouseId && lot.quantity_on_hand > 0 && lot.location_id !== null);

  async function loadData() {
    setLoading(true);
    try {
      const responses = await Promise.all([
        fetch(`${API_URL}/inventory/warehouses/`),
        fetch(`${API_URL}/inventory/locations/`),
        fetch(`${API_URL}/products/`),
        fetch(`${API_URL}/inventory/lots/`),
        fetch(`${API_URL}/inventory/transfers/`),
      ]);
      if (responses.some((response) => !response.ok)) throw new Error("Không thể tải dữ liệu điều chuyển.");
      const [warehouseData, locationData, productData, lotData, transferData] = await Promise.all(
        responses.map((response) => response.json())
      ) as [Warehouse[], Location[], Product[], Lot[], Transfer[]];
      setWarehouses(warehouseData); setLocations(locationData); setProducts(productData);
      setLots(lotData); setTransfers(transferData);
      setWarehouseId((current) => current || warehouseData.find((warehouse) => /tổng/i.test(warehouse.name))?.id || warehouseData[0]?.id || "");
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Không thể tải dữ liệu điều chuyển.");
    } finally { setLoading(false); }
  }

  useEffect(() => { loadData(); }, []);

  function addRow() {
    setRows((current) => [...current, { product_id: 0, product_query: "", source_location_id: "", destination_location_id: "", quantity: 1 }]);
  }

  function updateRow(index: number, patch: Partial<TransferRow>) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  }

  function availableFor(productId: number, locationId: number | "") {
    return warehouseLots
      .filter((lot) => lot.product_id === productId && lot.location_id === locationId)
      .reduce((total, lot) => total + lot.quantity_on_hand, 0);
  }

  function previewLots(row: TransferRow) {
    return warehouseLots
      .filter((lot) => lot.product_id === row.product_id && lot.location_id === row.source_location_id)
      .sort((a, b) => (a.expiry_date || "9999").localeCompare(b.expiry_date || "9999"));
  }

  async function createAndConfirm() {
    setError(""); setSuccess("");
    if (!warehouseId || rows.length === 0) { setError("Chọn kho và thêm ít nhất một dòng điều chuyển."); return; }
    if (rows.some((row) => !row.product_id || !row.source_location_id || !row.destination_location_id || row.quantity < 1)) {
      setError("Mỗi dòng phải có mã hàng, vị trí nguồn, số lượng và vị trí đích."); return;
    }
    const invalid = rows.find((row) => row.source_location_id === row.destination_location_id || row.quantity > availableFor(row.product_id, row.source_location_id));
    if (invalid) { setError("Số lượng chuyển vượt tồn tại vị trí nguồn hoặc vị trí nguồn trùng vị trí đích."); return; }
    setSaving(true);
    try {
      const createResponse = await fetch(`${API_URL}/inventory/transfers/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ warehouse_id: warehouseId, items: rows.map(({ product_query: _productQuery, ...row }) => row), note: note.trim() || null, created_by: "admin" }),
      });
      const created = await createResponse.json() as Transfer & { detail?: string };
      if (!createResponse.ok) throw new Error(created.detail ?? "Không thể tạo phiếu điều chuyển.");
      const confirmResponse = await fetch(`${API_URL}/inventory/transfers/${created.id}/confirm`, { method: "POST" });
      const confirmed = await confirmResponse.json() as Transfer & { detail?: string };
      if (!confirmResponse.ok) throw new Error(confirmed.detail ?? "Không thể xác nhận phiếu điều chuyển.");
      setRows([]); setNote(""); setSuccess(`Đã xác nhận ${confirmed.code}. Lot đã được hệ thống tự phân bổ theo FEFO.`); await loadData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Không thể thực hiện điều chuyển.");
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Điều chuyển vị trí" subtitle="Kho → Mã hàng → Vị trí nguồn → Số lượng → Vị trí đích" actions={<button onClick={() => loadData()} className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50" title="Tải lại"><RefreshCw size={17} /></button>} />
      {(error || success) && <div className={`rounded-xl px-4 py-3 text-sm ${error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>{error || success}</div>}
      <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-4">
        <div className="flex items-end justify-between gap-4">
          <label className="block max-w-sm w-full"><span className="text-xs text-gray-500">1. Kho</span><select value={warehouseId} onChange={(event) => { setWarehouseId(Number(event.target.value) || ""); setRows([]); }} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm"><option value="">Chọn kho</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
          <button onClick={addRow} disabled={!warehouseId} className="flex items-center gap-2 bg-sky-500 text-white rounded-lg px-3 py-2 text-sm disabled:opacity-50"><Plus size={16} /> Thêm dòng</button>
        </div>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-gray-50 text-gray-500"><tr><th className="px-3 py-3 text-left">2. Mã hàng</th><th className="px-3 py-3 text-left">3. Vị trí nguồn</th><th className="px-3 py-3 text-right">Tồn tại nguồn</th><th className="px-3 py-3 text-right">4. Số lượng</th><th className="px-3 py-3 text-left">5. Vị trí đích</th><th className="w-10" /></tr></thead><tbody>{rows.map((row, index) => {
          const available = availableFor(row.product_id, row.source_location_id);
          const allocations = previewLots(row).reduce((result, lot) => { const remaining = row.quantity - result.used; const quantity = Math.max(0, Math.min(remaining, lot.quantity_on_hand)); return { used: result.used + quantity, rows: quantity ? [...result.rows, `${lot.lot_number || "Không lot"} · HSD ${lot.expiry_date ? new Date(lot.expiry_date).toLocaleDateString("vi-VN") : "-"}: ${quantity}`] : result.rows }; }, { used: 0, rows: [] as string[] });
          return <tr key={index} className="border-t align-top"><td className="px-3 py-3 min-w-56"><input list={`products-${index}`} value={row.product_query} onChange={(event) => { const query = event.target.value; const product = products.find((item) => item.sku.toLowerCase() === query.trim().toLowerCase()); updateRow(index, { product_query: query, product_id: product?.id || 0, source_location_id: "", destination_location_id: "" }); }} placeholder="Tìm theo mã sản phẩm" className="w-full border rounded px-2 py-2 text-xs" /><datalist id={`products-${index}`}>{products.map((product) => <option key={product.id} value={product.sku}>{product.name}</option>)}</datalist><div className="text-xs text-gray-500 mt-1">{productMap.get(row.product_id)?.name || "Nhập/chọn đúng mã SKU"}</div></td><td className="px-3 py-3 min-w-36"><select value={row.source_location_id} disabled={!row.product_id} onChange={(event) => updateRow(index, { source_location_id: Number(event.target.value) || "" })} className="w-full border rounded px-2 py-2 text-xs"><option value="">Chọn nguồn</option>{activeLocations.filter((location) => availableFor(row.product_id, location.id) > 0).map((location) => <option key={location.id} value={location.id}>{location.code}</option>)}</select></td><td className="px-3 py-3 text-right font-medium">{formatNumber(available)}<div className="text-xs text-gray-400">hộp</div></td><td className="px-3 py-3"><input type="number" min={1} max={available || 1} value={row.quantity} onChange={(event) => updateRow(index, { quantity: Number(event.target.value) || 1 })} className="w-24 border rounded px-2 py-2 text-right text-sm" /><div className="text-xs text-gray-400 mt-1">{allocations.rows.length ? `${allocations.rows.join("; ")}` : "FEFO tự động"}</div></td><td className="px-3 py-3"><select value={row.destination_location_id} disabled={!row.source_location_id} onChange={(event) => updateRow(index, { destination_location_id: Number(event.target.value) || "" })} className="border rounded px-2 py-2 text-xs"><option value="">Chọn đích</option>{activeLocations.filter((location) => location.id !== row.source_location_id).map((location) => <option key={location.id} value={location.id}>{location.code}</option>)}</select></td><td className="px-3 py-3"><button onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))} className="text-red-500 p-1" title="Xóa dòng"><Trash2 size={16} /></button></td></tr>;
        })}</tbody></table></div>
        {!rows.length && <div className="text-center text-sm text-gray-400 py-8">Chưa có dòng điều chuyển. Nhấn “Thêm dòng” để bắt đầu.</div>}
        <div className="flex items-end gap-3"><label className="block flex-1"><span className="text-xs text-gray-500">Ghi chú</span><input value={note} onChange={(event) => setNote(event.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" placeholder="Ví dụ: Sắp xếp lại khu vực A" /></label><button onClick={createAndConfirm} disabled={saving || loading || !rows.length} className="flex items-center gap-2 bg-emerald-500 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-50"><CheckCircle2 size={16} />{saving ? "Đang xử lý…" : "Xác nhận điều chuyển"}</button></div>
      </div>
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden"><div className="px-5 py-4 border-b font-semibold">Lịch sử điều chuyển</div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-gray-50 text-gray-500"><tr><th className="px-4 py-3 text-left">Mã phiếu</th><th className="px-4 py-3 text-left">Trạng thái</th><th className="px-4 py-3 text-left">Chi tiết lot</th><th className="px-4 py-3 text-left">Thời gian</th></tr></thead><tbody>{transfers.map((transfer) => <tr key={transfer.id} className="border-t"><td className="px-4 py-3 font-medium">{transfer.code}</td><td className="px-4 py-3"><Badge variant={transfer.status === "CONFIRMED" ? "success" : "warning"}>{transfer.status}</Badge></td><td className="px-4 py-3">{transfer.items.map((item, index) => <div key={index} className="text-xs">{productMap.get(item.product_id)?.sku ?? item.product_id} <ArrowRight size={12} className="inline mx-1" /> {locationMap.get(item.source_location_id) ?? item.source_location_id} → {locationMap.get(item.destination_location_id) ?? item.destination_location_id}: {formatNumber(item.quantity)} hộp</div>)}</td><td className="px-4 py-3 text-xs text-gray-500">{formatDateTime(transfer.confirmed_at || transfer.created_at)}</td></tr>)}</tbody></table></div>{!transfers.length && <div className="text-center text-sm text-gray-400 py-8">Chưa có phiếu điều chuyển.</div>}</div>
    </div>
  );
}

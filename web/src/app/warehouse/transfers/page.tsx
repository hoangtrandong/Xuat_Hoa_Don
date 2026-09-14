"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, MapPin, Plus, RefreshCw, Trash2 } from "lucide-react";
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
interface TransferItem {
  product_id: number; lot_id: number; source_location_id: number;
  destination_location_id: number | ""; quantity: number;
}
interface Transfer {
  id: number; code: string; warehouse_id: number; status: string; note: string | null;
  created_by: string | null; created_at: string; confirmed_at: string | null;
  items: TransferItem[];
}

export default function LocationTransferPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [lots, setLots] = useState<Lot[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [warehouseId, setWarehouseId] = useState<number | "">("");
  const [rows, setRows] = useState<TransferItem[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const locationMap = useMemo(() => new Map(locations.map((location) => [location.id, location.code])), [locations]);
  const productMap = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const activeLocations = locations.filter((location) => location.is_active && location.warehouse_id === warehouseId);
  const availableLots = lots.filter((lot) => lot.quantity_on_hand > 0 && lot.location_id !== null && lot.warehouse_id === warehouseId);

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
      setWarehouses(warehouseData);
      setLocations(locationData);
      setProducts(productData);
      setLots(lotData);
      setTransfers(transferData);
      setWarehouseId((current) => current || warehouseData[0]?.id || "");
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Không thể tải dữ liệu điều chuyển.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  function addRow() {
    setRows((current) => [...current, {
      product_id: 0, lot_id: 0, source_location_id: 0, destination_location_id: "", quantity: 1,
    }]);
  }

  function updateRow(index: number, patch: Partial<TransferItem>) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  }

  function selectLot(index: number, lotId: number) {
    const lot = availableLots.find((item) => item.id === lotId);
    updateRow(index, lot ? {
      lot_id: lot.id, product_id: lot.product_id, source_location_id: lot.location_id ?? 0,
      quantity: Math.min(rows[index]?.quantity || 1, lot.quantity_on_hand),
    } : { lot_id: 0, product_id: 0, source_location_id: 0 });
  }

  async function createAndConfirm() {
    setError(""); setSuccess("");
    if (!warehouseId || rows.length === 0) { setError("Chọn kho và thêm ít nhất một dòng điều chuyển."); return; }
    if (rows.some((row) => !row.lot_id || !row.destination_location_id || row.quantity < 1)) {
      setError("Mỗi dòng phải có lot nguồn, vị trí đích và số lượng hợp lệ."); return;
    }
    const invalid = rows.find((row) => {
      const lot = lots.find((item) => item.id === row.lot_id);
      return !lot || row.quantity > lot.quantity_on_hand || row.source_location_id === row.destination_location_id;
    });
    if (invalid) { setError("Kiểm tra lại số lượng tồn, vị trí nguồn và vị trí đích."); return; }
    setSaving(true);
    try {
      const createResponse = await fetch(`${API_URL}/inventory/transfers/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ warehouse_id: warehouseId, items: rows, note: note.trim() || null, created_by: "admin" }),
      });
      const created = await createResponse.json() as Transfer & { detail?: string };
      if (!createResponse.ok) throw new Error(created.detail ?? "Không thể tạo phiếu điều chuyển.");
      const confirmResponse = await fetch(`${API_URL}/inventory/transfers/${created.id}/confirm`, { method: "POST" });
      const confirmed = await confirmResponse.json() as Transfer & { detail?: string };
      if (!confirmResponse.ok) throw new Error(confirmed.detail ?? "Không thể xác nhận phiếu điều chuyển.");
      setRows([]); setNote(""); setSuccess(`Đã xác nhận ${confirmed.code}.`); await loadData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Không thể thực hiện điều chuyển.");
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Điều chuyển vị trí"
        subtitle="Di chuyển hàng giữa các vị trí trong cùng một kho, không làm thay đổi tổng tồn."
        actions={<button onClick={() => loadData()} className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50" title="Tải lại"><RefreshCw size={17} /></button>}
      />
      {(error || success) && <div className={`rounded-xl px-4 py-3 text-sm ${error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>{error || success}</div>}
      <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-4">
        <div className="flex items-end justify-between gap-4">
          <label className="block max-w-sm w-full"><span className="text-xs text-gray-500">Kho</span>
            <select value={warehouseId} onChange={(event) => { setWarehouseId(Number(event.target.value) || ""); setRows([]); }} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm">
              <option value="">Chọn kho</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
            </select>
          </label>
          <button onClick={addRow} disabled={!warehouseId} className="flex items-center gap-2 bg-sky-500 text-white rounded-lg px-3 py-2 text-sm disabled:opacity-50"><Plus size={16} /> Thêm dòng</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500"><tr><th className="px-3 py-3 text-left">Lot nguồn</th><th className="px-3 py-3 text-left">Nguồn</th><th className="px-3 py-3 text-right">Tồn</th><th className="px-3 py-3 text-right">SL chuyển</th><th className="px-3 py-3 text-left">Đích</th><th className="w-10" /></tr></thead>
            <tbody>{rows.map((row, index) => {
              const lot = lots.find((item) => item.id === row.lot_id);
              const product = productMap.get(row.product_id);
              return <tr key={index} className="border-t align-top">
                <td className="px-3 py-3 min-w-64"><select value={row.lot_id || ""} onChange={(event) => selectLot(index, Number(event.target.value))} className="w-full border rounded px-2 py-2 text-xs"><option value="">Chọn lot theo tồn</option>{availableLots.map((item) => <option key={item.id} value={item.id}>{productMap.get(item.product_id)?.sku ?? item.product_id} · {item.lot_number || "Không lot"} · HSD {item.expiry_date ? new Date(item.expiry_date).toLocaleDateString("vi-VN") : "-"}</option>)}</select><div className="text-xs text-gray-500 mt-1">{product?.name || "Chưa chọn sản phẩm"}</div></td>
                <td className="px-3 py-3 whitespace-nowrap"><MapPin size={13} className="inline mr-1" />{locationMap.get(row.source_location_id) || "-"}</td>
                <td className="px-3 py-3 text-right">{formatNumber(lot?.quantity_on_hand || 0)}</td>
                <td className="px-3 py-3"><input type="number" min={1} max={lot?.quantity_on_hand || 1} value={row.quantity} onChange={(event) => updateRow(index, { quantity: Number(event.target.value) || 1 })} className="w-24 border rounded px-2 py-2 text-right text-sm" /></td>
                <td className="px-3 py-3"><select value={row.destination_location_id} onChange={(event) => updateRow(index, { destination_location_id: Number(event.target.value) || "" })} className="border rounded px-2 py-2 text-xs"><option value="">Chọn vị trí đích</option>{activeLocations.filter((location) => location.id !== row.source_location_id).map((location) => <option key={location.id} value={location.id}>{location.code}</option>)}</select></td>
                <td className="px-3 py-3"><button onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))} className="text-red-500 p-1" title="Xóa dòng"><Trash2 size={16} /></button></td>
              </tr>;
            })}</tbody>
          </table>
          {!rows.length && <div className="text-center text-sm text-gray-400 py-8">Chưa có dòng điều chuyển. Nhấn “Thêm dòng” để bắt đầu.</div>}
        </div>
        <div className="flex items-end gap-3">
          <label className="block flex-1"><span className="text-xs text-gray-500">Ghi chú</span><input value={note} onChange={(event) => setNote(event.target.value)} className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" placeholder="Ví dụ: Sắp xếp lại khu vực A" /></label>
          <button onClick={createAndConfirm} disabled={saving || loading || !rows.length} className="flex items-center gap-2 bg-emerald-500 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-50"><CheckCircle2 size={16} />{saving ? "Đang xử lý…" : "Xác nhận điều chuyển"}</button>
        </div>
      </div>
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b font-semibold">Lịch sử điều chuyển</div>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-gray-50 text-gray-500"><tr><th className="px-4 py-3 text-left">Mã phiếu</th><th className="px-4 py-3 text-left">Trạng thái</th><th className="px-4 py-3 text-left">Chi tiết</th><th className="px-4 py-3 text-left">Thời gian</th></tr></thead><tbody>{transfers.map((transfer) => <tr key={transfer.id} className="border-t"><td className="px-4 py-3 font-medium">{transfer.code}</td><td className="px-4 py-3"><Badge variant={transfer.status === "CONFIRMED" ? "success" : "warning"}>{transfer.status}</Badge></td><td className="px-4 py-3">{transfer.items.map((item, index) => <div key={index} className="text-xs">{productMap.get(item.product_id)?.sku ?? item.product_id} <ArrowRight size={12} className="inline mx-1" /> {locationMap.get(item.source_location_id) ?? item.source_location_id} → {locationMap.get(Number(item.destination_location_id)) ?? item.destination_location_id}: {formatNumber(item.quantity)} hộp</div>)}</td><td className="px-4 py-3 text-xs text-gray-500">{formatDateTime(transfer.confirmed_at || transfer.created_at)}</td></tr>)}</tbody></table></div>
        {!transfers.length && <div className="text-center text-sm text-gray-400 py-8">Chưa có phiếu điều chuyển.</div>}
      </div>
    </div>
  );
}

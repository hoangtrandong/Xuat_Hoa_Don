"use client";

import { useEffect, useRef, useState } from "react";
import { ClipboardList, Download, Upload } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { API_URL } from "@/lib/api";

type Warehouse = { id: number; name: string };
type ProductOption = { id: number; sku: string; name: string };
type PreviewItem = {
  product_id: number; sku: string; product_name: string; quantity: number;
  requested_quantity_raw?: string | null; available_quantity: number; shortage_quantity: number;
  employee_allocations?: Record<string, unknown> | null;
};

export default function DeliveryRequestsPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<PreviewItem[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  async function load() {
    const [warehouseResponse, productResponse] = await Promise.all([
      fetch(`${API_URL}/inventory/warehouses/`),
      fetch(`${API_URL}/products/?limit=1000`),
    ]);
    if (!warehouseResponse.ok || !productResponse.ok) throw new Error("Không thể tải dữ liệu kho và sản phẩm.");
    setWarehouses(await warehouseResponse.json());
    setProductOptions(await productResponse.json());
  }

  useEffect(() => {
    const timer = window.setTimeout(() => load().catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Không thể tải dữ liệu.")), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function upload(file: File) {
    if (!warehouseId) {
      setError("Vui lòng chọn kho trước khi upload file Excel.");
      return;
    }
    setError(""); setMessage(""); setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("warehouse_id", warehouseId);
      const response = await fetch(`${API_URL}/delivery-requests/upload?warehouse_id=${encodeURIComponent(warehouseId)}`, { method: "POST", body });
        const result = await response.json() as PreviewItem[] | { detail?: string };
      if (!response.ok) throw new Error("detail" in result ? result.detail ?? "Không thể upload yêu cầu giao hàng." : "Không thể upload yêu cầu giao hàng.");
        setPreview(result as PreviewItem[]);
        setMessage("Đã tải bản xem trước. Chưa tạo yêu cầu giao hàng.");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Không thể upload file.");
    } finally {
      setUploading(false);
    }

  }

  async function confirmPreview() {
    setError("");
    const products = await (await fetch(`${API_URL}/products/?limit=1000`)).json() as Array<{ id: number; sku: string; name: string }>;
    const bySku = new Map(products.map((product) => [product.sku.toUpperCase(), product]));
    const items = preview.map((item) => {
      const product = bySku.get(item.sku.toUpperCase());
      if (!product) throw new Error(`Không tìm thấy SKU thay thế ${item.sku}.`);
      return { product_id: product.id, quantity: item.quantity, requested_quantity_raw: item.requested_quantity_raw, employee_allocations: item.employee_allocations };
    });
    const response = await fetch(`${API_URL}/delivery-requests/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ warehouse_id: Number(warehouseId), items }) });
    const result = await response.json() as { detail?: string; code?: string };
    if (!response.ok) { setError(result.detail ?? "Không thể tạo yêu cầu."); return; }
    setPreview([]);
    setMessage(`Đã xác nhận tạo yêu cầu ${result.code ?? ""}.`);
    await load();
  }

  async function checkStock() {
    const response = await fetch(`${API_URL}/inventory/stock-levels/?warehouse_id=${encodeURIComponent(warehouseId)}`);
    if (!response.ok) throw new Error("Không thể kiểm tra tồn kho.");
    const stocks = await response.json() as Array<{ product_id: number; available: number }>;
    setPreview((items) => items.map((item) => {
      const available = stocks.find((stock) => stock.product_id === item.product_id)?.available ?? 0;
      return { ...item, available_quantity: available, shortage_quantity: Math.max(0, item.quantity - available) };
    }));
    setMessage("Đã kiểm tra tồn kho. Chưa tìm vị trí.");
  }

  async function findLocations() {
    if (preview.some((item) => item.shortage_quantity > 0)) {
      setError("Danh sách còn sản phẩm thiếu tồn kho; hãy thay mã hoặc điều chỉnh số lượng trước.");
      return;
    }
    setMessage("Đã sẵn sàng tìm vị trí FEFO khi xác nhận yêu cầu.");
  }

  async function replacePreviewSku(index: number, sku: string) {
    const stockResponse = await fetch(`${API_URL}/inventory/stock-levels/?warehouse_id=${encodeURIComponent(warehouseId)}`);
    const stocks = await stockResponse.json() as Array<{ product_id: number; available: number }>;
    const product = productOptions.find((item) => item.sku.toUpperCase() === sku.trim().toUpperCase());
    if (!product) { setError(`Không tìm thấy mã thay thế ${sku}.`); return; }
    const available = stocks.find((stock) => stock.product_id === product.id)?.available ?? 0;
    const requestedQuantity = preview[index].quantity;
    setPreview((currentItems) => currentItems.map((item, itemIndex) => itemIndex === index
      ? { ...item, product_id: product.id, sku: product.sku, product_name: product.name, available_quantity: available, shortage_quantity: Math.max(0, requestedQuantity - available) }
      : item));
  }

  function selectPreviewSku(index: number, sku: string) {
    const product = productOptions.find((item) => item.sku.toUpperCase() === sku.trim().toUpperCase());
    if (!product) {
      setPreview((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, sku } : item));
      return;
    }
    setPreview((items) => items.map((item, itemIndex) => itemIndex === index
      ? { ...item, product_id: product.id, sku: product.sku, product_name: product.name }
      : item));
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Yêu cầu giao hàng" subtitle="Admin lập và phân bổ; thủ kho tiếp nhận và xác nhận hoàn thành" actions={
        <div className="flex gap-2 items-center">
          <select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm">
            <option value="">Chọn kho xuất</option>
            {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
          </select>
          <a href={`${API_URL}/delivery-requests/template`} className="flex items-center gap-2 border border-gray-200 bg-white px-3 py-2 rounded-lg text-sm"><Download size={16} />Tải mẫu</a>
          <button disabled={!warehouseId || uploading} onClick={() => fileInput.current?.click()} className="flex items-center gap-2 bg-sky-500 text-white px-3 py-2 rounded-lg text-sm disabled:opacity-50"><Upload size={16} />Upload Excel</button>
          <input ref={fileInput} type="file" accept=".xlsx,.xlsm" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload(file); event.target.value = ""; }} />
        </div>
      } />
      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>}
      {message && <div className="bg-emerald-50 text-emerald-700 rounded-lg px-4 py-3 text-sm">{message}</div>}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between"><div className="flex items-center gap-2"><ClipboardList size={18} className="text-sky-500" /><span className="font-semibold">Danh sách sản phẩm upload</span></div>{preview.length > 0 && <div className="flex gap-2"><button onClick={() => checkStock().catch((e) => setError(e instanceof Error ? e.message : "Không thể kiểm tra tồn kho."))} className="bg-amber-500 text-white px-3 py-2 rounded-lg text-sm">Check tồn</button><button onClick={() => findLocations()} className="bg-indigo-500 text-white px-3 py-2 rounded-lg text-sm">Tìm vị trí</button><button onClick={() => confirmPreview().catch((e) => setError(e instanceof Error ? e.message : "Không thể tạo yêu cầu."))} className="bg-emerald-500 text-white px-3 py-2 rounded-lg text-sm">Xác nhận tạo yêu cầu</button></div>}</div>
        {preview.length === 0 ? <div className="p-8 text-center text-sm text-gray-500">Chọn kho và upload Excel để xem danh sách sản phẩm.</div> : <div className="overflow-x-auto">
          <table className="w-full text-sm"><thead className="bg-gray-50 text-gray-500"><tr><th className="text-left px-5 py-3">Mã hàng</th><th className="text-left px-5 py-3">Tên sản phẩm</th><th className="text-right px-5 py-3">Số lượng yêu cầu</th><th className="text-right px-5 py-3">Tồn thực tế</th><th className="text-right px-5 py-3">Thiếu</th></tr></thead><tbody>{preview.map((item, index) => <tr key={`${item.sku}-${index}`} className={item.shortage_quantity > 0 ? "bg-red-50" : ""}><td className="px-5 py-2"><input list="delivery-product-options" value={item.sku} placeholder="Tìm mã SKU..." onChange={(event) => { const sku = event.target.value; selectPreviewSku(index, sku); }} onBlur={(event) => replacePreviewSku(index, event.target.value).catch(() => setError("Không thể kiểm tra mã thay thế."))} className="w-40 border rounded px-2 py-1" /><datalist id="delivery-product-options">{productOptions.map((product) => <option key={product.id} value={product.sku}>{product.name}</option>)}</datalist></td><td className="px-5 py-2">{item.product_name}</td><td className="px-5 py-2 text-right">{item.requested_quantity_raw ?? item.quantity}</td><td className="px-5 py-2 text-right">{item.available_quantity || "-"}</td><td className={`px-5 py-2 text-right font-medium ${item.shortage_quantity > 0 ? "text-red-600" : "text-gray-500"}`}>{item.shortage_quantity || "-"}</td></tr>)}</tbody></table>
        </div>}
      </div>
    </div>
  );
}

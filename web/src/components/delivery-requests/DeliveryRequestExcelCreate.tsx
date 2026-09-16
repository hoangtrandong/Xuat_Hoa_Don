"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardList, Download, MapPin, Upload } from "lucide-react";
import { API_URL } from "@/lib/api";

type Warehouse = { id: number; name: string };
type ProductOption = { id: number; sku: string; name: string };
type PreviewItem = {
  product_id: number; sku: string; product_name: string; quantity: number;
  requested_quantity_raw?: string | null; available_quantity: number; reserved_quantity?: number; shortage_quantity: number;
  employee_allocations?: Record<string, unknown> | null;
};

type PickRow = {
  location_code: string | null;
  location_id: number | null;
  lot_number: string | null;
  expiry_date: string | null;
  quantity: number;
  allocation_strategy: string;
};

type PlanItem = {
  product_id: number;
  sku: string;
  product_name: string;
  quantity: number;
  planned_quantity: number;
  shortage_quantity: number;
  picks: PickRow[];
};

type DeliveryRequestExcelCreateProps = {
  embedded?: boolean;
  onCreated?: (request: { id?: number; code?: string; status?: string }) => void | Promise<void>;
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("vi-VN");
}

export default function DeliveryRequestExcelCreate({ embedded = false, onCreated }: DeliveryRequestExcelCreateProps) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<PreviewItem[]>([]);
  const [plan, setPlan] = useState<PlanItem[] | null>(null);
  const [planning, setPlanning] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Precompute lookups/option nodes once so per-row renders stay O(1).
  const productOptionsBySku = useMemo(
    () => new Map(productOptions.map((product) => [product.sku.toUpperCase(), product])),
    [productOptions]
  );
  const productOptionElements = useMemo(
    () => productOptions.map((product) => (
      <option key={product.id} value={product.sku}>{product.name}</option>
    )),
    [productOptions]
  );

  async function load() {
    const [warehouseResponse, productResponse] = await Promise.all([
      fetch(`${API_URL}/inventory/warehouses/`),
      fetch(`${API_URL}/products/?limit=10000`),
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
        setPlan(null);
        setMessage("Đã tải bản xem trước. Chưa tạo yêu cầu giao hàng.");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Không thể upload file.");
    } finally {
      setUploading(false);
    }

  }

  async function confirmPreview() {
    setError("");
    const items = preview.map((item) => {
      // Ưu tiên product_id do backend xác thực lúc upload (đúng ngay cả khi SKU
      // nằm ngoài 1000 sản phẩm đầu). Tra SKU client chỉ là phương án dự phòng.
      const matched = productOptionsBySku.get(item.sku.trim().toUpperCase());
      const productId = matched ? matched.id : (item.product_id > 0 ? item.product_id : 0);
      if (productId <= 0) {
        throw new Error(`Không tìm thấy SKU ${item.sku} trong hệ thống. Hãy kiểm tra lại mã sản phẩm.`);
      }
      const planned = plan?.find((planItem) => (
        planItem.product_id === productId
        || planItem.sku.trim().toUpperCase() === item.sku.trim().toUpperCase()
      ));
      return {
        product_id: productId, quantity: item.quantity, requested_quantity_raw: item.requested_quantity_raw,
        employee_allocations: item.employee_allocations,
        planned_allocations: planned?.picks.map((pick) => ({
          location_code: pick.location_code,
          location_id: pick.location_id,
          lot_number: pick.lot_number,
          expiry_date: pick.expiry_date,
          quantity: pick.quantity,
          allocation_strategy: pick.allocation_strategy,
        })),
      };
    });
    const response = await fetch(`${API_URL}/delivery-requests/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ warehouse_id: Number(warehouseId), items }) });
    const result = await response.json() as { detail?: string; id?: number; code?: string; status?: string };
    if (!response.ok) { setError(result.detail ?? "Không thể tạo yêu cầu."); return; }
    // Tự động submit: FEFO khớp lô + đặt trước tồn kho, yêu cầu chuyển sang SUBMITTED
    // để thủ kho thấy trong "Hàng đợi xuất kho".
    let submitNote = "";
    if (result.id) {
      const submitResponse = await fetch(`${API_URL}/delivery-requests/${result.id}/submit`, { method: "POST" });
      const submitResult = await submitResponse.json().catch(() => ({})) as { detail?: string };
      if (!submitResponse.ok) {
        submitNote = ` Tuy nhiên gửi xác nhận thất bại: ${submitResult.detail ?? "lỗi không xác định"}.`;
      } else {
        submitNote = " Đã gửi xác nhận đến thủ kho.";
      }
    }
    setPreview([]);
    setPlan(null);
    setMessage(`Đã tạo yêu cầu ${result.code ?? ""}.${submitNote}`);
    await load();
    await onCreated?.(result);
  }

  async function checkStock() {
    setPlan(null);
    const response = await fetch(`${API_URL}/inventory/stock-levels/?warehouse_id=${encodeURIComponent(warehouseId)}`);
    if (!response.ok) throw new Error("Không thể kiểm tra tồn kho.");
    const stocks = await response.json() as Array<{ product_id: number; available: number; reserved?: number }>;
    const availableByProduct = new Map(stocks.map((stock) => [stock.product_id, stock.available]));
    const reservedByProduct = new Map(stocks.map((stock) => [stock.product_id, stock.reserved ?? 0]));
    setPreview((items) => items.map((item) => {
      const available = availableByProduct.get(item.product_id) ?? 0;
      return { ...item, available_quantity: available, reserved_quantity: reservedByProduct.get(item.product_id) ?? 0, shortage_quantity: Math.max(0, item.quantity - available) };
    }));
    setMessage("Đã kiểm tra tồn kho (po odjęciu rezerwacji). Chưa tìm vị trí.");
  }

  async function findLocations() {
    setError(""); setPlan(null); setPlanning(true);
    if (preview.some((item) => item.shortage_quantity > 0)) {
      setError("Danh sách còn sản phẩm thiếu tồn kho; hãy thay mã hoặc điều chỉnh số lượng trước.");
      setPlanning(false);
      return;
    }
    try {
      const items = preview.map((item) => {
        // Ưu tiên product_id do backend xác thực lúc upload (đúng ngay cả khi SKU
        // nằm ngoài 1000 sản phẩm đầu). Tra SKU client chỉ là phương án dự phòng.
        const matched = productOptionsBySku.get(item.sku.trim().toUpperCase());
        const productId = matched ? matched.id : (item.product_id > 0 ? item.product_id : 0);
        if (productId <= 0) {
          throw new Error(`Không tìm thấy SKU ${item.sku} trong hệ thống. Hãy kiểm tra lại mã sản phẩm.`);
        }
        return { product_id: productId, quantity: item.quantity };
      });
      const response = await fetch(`${API_URL}/delivery-requests/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ warehouse_id: Number(warehouseId), items }),
      });
      const result = await response.json() as PlanItem[] | { detail?: string };
      if (!response.ok) throw new Error("detail" in result ? result.detail ?? "Không thể lập kế hoạch FEFO." : "Không thể lập kế hoạch FEFO.");
      const planItems = result as PlanItem[];
      setPlan(planItems);
      const totalShort = planItems.reduce((sum, planItem) => sum + planItem.shortage_quantity, 0);
      setMessage(totalShort > 0 ? `Đã lập kế hoạch lấy hàng FEFO (thiếu ${totalShort} đơn vị).` : "Đã lập kế hoạch lấy hàng FEFO.");
    } catch (planError) {
      setError(planError instanceof Error ? planError.message : "Không thể lập kế hoạch.");
    } finally {
      setPlanning(false);
    }
  }

  async function replacePreviewSku(index: number, sku: string) {
    setPlan(null);
    const stockResponse = await fetch(`${API_URL}/inventory/stock-levels/?warehouse_id=${encodeURIComponent(warehouseId)}`);
    const stocks = await stockResponse.json() as Array<{ product_id: number; available: number }>;
    const availableByProduct = new Map(stocks.map((stock) => [stock.product_id, stock.available]));
    const product = productOptionsBySku.get(sku.trim().toUpperCase());
    if (!product) { setError(`Không tìm thấy mã thay thế ${sku}.`); return; }
    const available = availableByProduct.get(product.id) ?? 0;
    const requestedQuantity = preview[index].quantity;
    setPreview((currentItems) => currentItems.map((item, itemIndex) => itemIndex === index
      ? { ...item, product_id: product.id, sku: product.sku, product_name: product.name, available_quantity: available, shortage_quantity: Math.max(0, requestedQuantity - available) }
      : item));
  }

  function selectPreviewSku(index: number, sku: string) {
    setPlan(null);
    const product = productOptionsBySku.get(sku.trim().toUpperCase());
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
      {/* Single datalist for all SKU inputs — rendering one per preview row created
          rows × {productOptions.length} option nodes and duplicate ids. */}
      <datalist id="delivery-product-options">{productOptionElements}</datalist>
      {!embedded && (
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Yêu cầu giao hàng</h1>
            <p className="text-sm text-gray-500">Admin lập và phân bổ; thủ kho tiếp nhận và xác nhận hoàn thành</p>
          </div>
          <div className="flex gap-2 items-center">
            <select value={warehouseId} onChange={(event) => { setWarehouseId(event.target.value); setPlan(null); }} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm">
              <option value="">Chọn kho xuất</option>
              {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
            </select>
            <a href={`${API_URL}/delivery-requests/template`} className="flex items-center gap-2 border border-gray-200 bg-white px-3 py-2 rounded-lg text-sm"><Download size={16} />Tải mẫu</a>
            <button disabled={!warehouseId || uploading} onClick={() => fileInput.current?.click()} className="flex items-center gap-2 bg-sky-500 text-white px-3 py-2 rounded-lg text-sm disabled:opacity-50"><Upload size={16} />Upload Excel</button>
            <input ref={fileInput} type="file" accept=".xlsx,.xlsm" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload(file); event.target.value = ""; }} />
          </div>
        </div>
      )}
      {embedded && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h3 className="font-semibold text-gray-900">Tạo yêu cầu từ Excel</h3>
            <p className="text-sm text-gray-500">Chọn kho, tải mẫu, upload Excel để xem trước và tạo yêu cầu xuất hàng.</p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
          <select value={warehouseId} onChange={(event) => { setWarehouseId(event.target.value); setPlan(null); }} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm">
            <option value="">Chọn kho xuất</option>
            {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
          </select>
          <a href={`${API_URL}/delivery-requests/template`} className="flex items-center gap-2 border border-gray-200 bg-white px-3 py-2 rounded-lg text-sm"><Download size={16} />Tải mẫu</a>
          <button disabled={!warehouseId || uploading} onClick={() => fileInput.current?.click()} className="flex items-center gap-2 bg-sky-500 text-white px-3 py-2 rounded-lg text-sm disabled:opacity-50"><Upload size={16} />Upload Excel</button>
          <input ref={fileInput} type="file" accept=".xlsx,.xlsm" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload(file); event.target.value = ""; }} />
        </div>
        </div>
      )}
      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>}
      {message && <div className="bg-emerald-50 text-emerald-700 rounded-lg px-4 py-3 text-sm">{message}</div>}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between"><div className="flex items-center gap-2"><ClipboardList size={18} className="text-sky-500" /><span className="font-semibold">Danh sách sản phẩm upload</span></div>{preview.length > 0 && <div className="flex gap-2"><button onClick={() => checkStock().catch((e) => setError(e instanceof Error ? e.message : "Không thể kiểm tra tồn kho."))} className="bg-amber-500 text-white px-3 py-2 rounded-lg text-sm">Check tồn</button><button disabled={planning} onClick={() => findLocations()} className="bg-indigo-500 text-white px-3 py-2 rounded-lg text-sm disabled:opacity-50">{planning ? "Đang tìm…" : "Tìm vị trí"}</button><button onClick={() => confirmPreview().catch((e) => setError(e instanceof Error ? e.message : "Không thể tạo yêu cầu."))} className="bg-emerald-500 text-white px-3 py-2 rounded-lg text-sm">Xác nhận tạo yêu cầu</button></div>}</div>
        {preview.length === 0 ? <div className="p-8 text-center text-sm text-gray-500">Chọn kho và upload Excel để xem danh sách sản phẩm.</div> : <div className="overflow-x-auto">
          <table className="w-full text-sm"><thead className="bg-gray-50 text-gray-500"><tr><th className="text-left px-5 py-3">Mã hàng</th><th className="text-left px-5 py-3">Tên sản phẩm</th><th className="text-right px-5 py-3">Số lượng yêu cầu</th><th className="text-right px-5 py-3">Tồn thực tế</th><th className="text-right px-5 py-3">Zarezerwowane</th><th className="text-right px-5 py-3">Thiếu</th></tr></thead><tbody>{preview.map((item, index) => <tr key={`${item.sku}-${index}`} className={item.shortage_quantity > 0 ? "bg-red-50" : ""}><td className="px-5 py-2"><input list="delivery-product-options" value={item.sku} placeholder="Tìm mã SKU..." onChange={(event) => { const sku = event.target.value; selectPreviewSku(index, sku); }} onBlur={(event) => replacePreviewSku(index, event.target.value).catch(() => setError("Không thể kiểm tra mã thay thế."))} className="w-40 border rounded px-2 py-1" /></td><td className="px-5 py-2">{item.product_name}</td><td className="px-5 py-2 text-right">{item.requested_quantity_raw ?? item.quantity}</td><td className="px-5 py-2 text-right">{item.available_quantity || "-"}</td><td className="px-5 py-2 text-right">{item.reserved_quantity || "-"}</td><td className={`px-5 py-2 text-right font-medium ${item.shortage_quantity > 0 ? "text-red-600" : "text-gray-500"}`}>{item.shortage_quantity || "-"}</td></tr>)}</tbody></table>
        </div>}
      </div>
      {plan && plan.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2"><MapPin size={18} className="text-indigo-500" /><span className="font-semibold">Kế hoạch lấy hàng FEFO</span></div>
            <button onClick={() => setPlan(null)} className="text-xs text-gray-400 hover:text-gray-600">Ẩn</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="text-left px-5 py-3">Mã hàng</th>
                  <th className="text-left px-5 py-3">Tên sản phẩm</th>
                  <th className="text-left px-5 py-3">Vị trí</th>
                  <th className="text-left px-5 py-3">Lô</th>
                  <th className="text-left px-5 py-3">HSD</th>
                  <th className="text-right px-5 py-3">SL lấy</th>
                </tr>
              </thead>
              <tbody>
                {plan.map((item) =>
                  item.picks.length === 0 ? (
                    <tr key={item.sku} className="bg-red-50">
                      <td className="px-5 py-2 font-medium">{item.sku}</td>
                      <td className="px-5 py-2">{item.product_name}</td>
                      <td colSpan={4} className="px-5 py-2 text-red-600">Thiếu {item.shortage_quantity} đơn vị</td>
                    </tr>
                  ) : (
                    item.picks.map((pick, pickIndex) => (
                      <tr key={`${item.sku}-${pickIndex}`} className={pickIndex === 0 ? "" : "border-t border-gray-50"}>
                        {pickIndex === 0 && <td rowSpan={item.picks.length} className="px-5 py-2 font-medium">{item.sku}</td>}
                        {pickIndex === 0 && <td rowSpan={item.picks.length} className="px-5 py-2">{item.product_name}</td>}
                        <td className="px-5 py-2">{pick.location_code ?? "-"}</td>
                        <td className="px-5 py-2">{pick.lot_number ?? "-"}</td>
                        <td className="px-5 py-2">{pick.expiry_date ? formatDate(pick.expiry_date) : "-"}</td>
                        <td className="px-5 py-2 text-right">{pick.quantity}</td>
                      </tr>
                    ))
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardList, Download, MapPin, Upload } from "lucide-react";
import { API_URL, apiFetch } from "@/lib/api";
import { splitCartons } from "@/lib/format";
import * as XLSX from "xlsx";

type Warehouse = { id: number; name: string };
type ProductOption = { id: number; sku: string; name: string };
type PreviewItem = {
  product_id: number;
  sku: string;
  product_name: string;
  boxes_per_carton?: number;
  quantity: number;
  cartons?: number;
  loose_boxes?: number;
  requested_quantity_raw?: string | null;
  available_quantity: number;
  reserved_quantity?: number;
  shortage_quantity: number;
  employee_allocations?: Record<string, { quantity?: number }> | null;
  borrowed_employee_offsets?: {
    external_employee_code: string;
    external_employee_name?: string | null;
    employee_id?: number | null;
    quantity: number;
    amount: number;
  }[];
  dms_skus?: string[];
};

type PickRow = {
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

type EmployeeSummary = {
  employee_id: number | null;
  employee_code: string;
  employee_name: string | null;
  column_key?: string | null;
  weight_ton: number;
  order_count: number;
  amount: number;
  pending_debt?: number;
  debt_limit?: number;
  current_debt?: number;
  projected_debt?: number;
  is_over_limit?: boolean;
};

export type DeliveryOrder = {
  order_date: string | null;
  order_number: string;
  employee_id: number | null;
  employee_code: string;
  employee_name: string | null;
  customer_code: string | null;
  customer_name: string | null;
  amount: number;
  payment_status: string;
  payment_method?: string | null;
};


type PlanItem = {
  product_id: number;
  sku: string;
  product_name: string;
  boxes_per_carton?: number;
  quantity: number;
  cartons?: number;
  loose_boxes?: number;
  planned_quantity: number;
  shortage_quantity: number;
  picks: PickRow[];
};
type ReconciledOrder = {
  order_number: string;
  status: string;
  order_date: string | null;
  employee_code: string;
  employee_name: string;
  customer_code: string;
  customer_name: string;
  source_order_code?: string | null;
  dms_amount: number;
  nvgh_amount: number | null;
  selected_amount: number;
  amount_source: string;
  difference: number | null;
  products: { dms_sku: string; dms_name: string; npp_code: string; npp_name: string; quantity: number }[];
};
type SendOrderCandidate = { id: number; code: string; status: string; customer_code: string; customer_name: string; total: number; created_at: string | null; products: string[] };

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
  const [employeeSummaries, setEmployeeSummaries] = useState<EmployeeSummary[]>([]);
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [orderSearch, setOrderSearch] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [issues, setIssues] = useState<string[]>([]);
  const [ordersReconciliation, setOrdersReconciliation] = useState<ReconciledOrder[]>([]);
  const [borrowEntries, setBorrowEntries] = useState<{ employee_id?: number | null; external_employee_code?: string; external_employee_name?: string | null; product_id: number; quantity: number; amount: number; note?: string }[]>([]);
  const [importHash, setImportHash] = useState("");
  const [importFilename, setImportFilename] = useState("");
  const [isNewWorkbook, setIsNewWorkbook] = useState(false);
  const [canCreate, setCanCreate] = useState(false);
  const [acknowledgeWarnings, setAcknowledgeWarnings] = useState(false);
  const [sendOrderCandidates, setSendOrderCandidates] = useState<Record<string, SendOrderCandidate[]>>({});
  const [sendOrderMappings, setSendOrderMappings] = useState<Record<string, number>>({});
  const [selectedUploadFile, setSelectedUploadFile] = useState<File | null>(null);
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
      apiFetch(`${API_URL}/inventory/warehouses/`),
      apiFetch(`${API_URL}/products/?limit=10000`),
    ]);
    if (!warehouseResponse.ok || !productResponse.ok) throw new Error("Không thể tải dữ liệu kho và sản phẩm.");
    setWarehouses(await warehouseResponse.json());
    setProductOptions(await productResponse.json());
  }

  async function buildPlan(items: PreviewItem[], selectedWarehouseId: string): Promise<PlanItem[]> {
    const response = await apiFetch(`${API_URL}/delivery-requests/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        warehouse_id: Number(selectedWarehouseId),
        items: items.map((item) => ({ product_id: item.product_id, quantity: item.quantity })),
      }),
    });
    const result = await response.json() as PlanItem[] | { detail?: string };
    if (!response.ok) throw new Error("detail" in result ? result.detail ?? "Không thể lập kế hoạch FEFO." : "Không thể lập kế hoạch FEFO.");
    return result as PlanItem[];
  }

  async function loadStock(items: PreviewItem[], selectedWarehouseId: string): Promise<PreviewItem[]> {
    const response = await apiFetch(`${API_URL}/inventory/stock-levels/?warehouse_id=${encodeURIComponent(selectedWarehouseId)}`);
    if (!response.ok) throw new Error("Không thể kiểm tra tồn kho.");
    const stocks = await response.json() as Array<{ product_id: number; available: number; reserved?: number }>;
    const availableByProduct = new Map(stocks.map((stock) => [stock.product_id, stock.available]));
    const reservedByProduct = new Map(stocks.map((stock) => [stock.product_id, stock.reserved ?? 0]));
    return items.map((item) => ({
      ...item,
      available_quantity: availableByProduct.get(item.product_id) ?? 0,
      reserved_quantity: reservedByProduct.get(item.product_id) ?? 0,
      shortage_quantity: Math.max(0, item.quantity - (availableByProduct.get(item.product_id) ?? 0)),
    }));
  }

  function clearPreview() {
    setPreview([]);
    setEmployeeSummaries([]);
    setOrders([]);
    setWarnings([]);
    setIssues([]);
    setOrdersReconciliation([]);
    setBorrowEntries([]);
    setImportHash("");
    setImportFilename("");
    setPlan(null);
    setCanCreate(false);
    setAcknowledgeWarnings(false);
    setSendOrderCandidates({});
    setSendOrderMappings({});
    setIsNewWorkbook(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => load().catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Không thể tải dữ liệu.")), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function upload(file: File, selectedSendMappings: Record<string, number> = {}) {
    if (!warehouseId) {
      setError("Vui lòng chọn kho trước khi upload file Excel.");
      return;
    }
    setError(""); setMessage(""); setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("warehouse_id", warehouseId);
      clearPreview();
      const query = new URLSearchParams({ warehouse_id: warehouseId });
      if (Object.keys(selectedSendMappings).length) query.set("send_order_mappings", JSON.stringify(selectedSendMappings));
      const response = await apiFetch(`${API_URL}/delivery-requests/upload?${query.toString()}`, { method: "POST", body });
      const result = await response.json() as {
        items?: PreviewItem[];
        employee_summaries?: EmployeeSummary[];
        orders?: DeliveryOrder[];
        warnings?: string[];
        issues?: string[];
        order_reconciliation?: ReconciledOrder[];
        borrow_entries?: { employee_id?: number | null; external_employee_code?: string; external_employee_name?: string | null; product_id: number; quantity: number; amount: number; note?: string }[];
        import_hash?: string;
        filename?: string;
        can_create?: boolean;
        send_order_candidates?: Record<string, SendOrderCandidate[]>;
        detail?: string;
      };
      if (!response.ok) throw new Error(result.detail ?? "Không thể upload yêu cầu giao hàng.");
      const items = result.items ?? [];
      setPreview(items);
      setEmployeeSummaries(result.employee_summaries ?? []);
      setOrders(result.orders ?? []);
      setWarnings(result.warnings ?? []);
      setAcknowledgeWarnings(false);
      setIssues(result.issues ?? []);
      setOrdersReconciliation(result.order_reconciliation ?? []);
      setBorrowEntries(result.borrow_entries ?? []);
      setImportHash(result.import_hash ?? "");
      setImportFilename(result.filename ?? file.name);
      setCanCreate(result.can_create ?? items.length > 0);
      setIsNewWorkbook(Array.isArray(result.order_reconciliation));
      setSendOrderCandidates(result.send_order_candidates ?? {});
      setSendOrderMappings(selectedSendMappings);
      if (items.length) {
        const [planned, stockedItems] = await Promise.all([
          buildPlan(items, warehouseId),
          loadStock(items, warehouseId),
        ]);
        setPlan(planned);
        setPreview(stockedItems.map((item) => {
          const itemPlan = planned.find((entry) => entry.product_id === item.product_id);
          return { ...item, shortage_quantity: itemPlan?.shortage_quantity ?? item.quantity };
        }));
      }
      setMessage("Đã đọc danh sách đơn, tra dữ liệu DMS và tổng hợp phân bổ theo NVGH. Kiểm tra tồn kho trước khi xác nhận.");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Không thể upload file.");
    } finally {
      setUploading(false);
    }
  }

  function reanalyzeWithMappings() {
    if (!selectedUploadFile) {
      setError("Hãy chọn lại file yêu cầu trước khi phân tích các ghép nối.");
      return;
    }
    upload(selectedUploadFile, sendOrderMappings);
  }

  function chooseFile(file: File) {
    setSelectedUploadFile(file);
    setSendOrderMappings({});
    upload(file, {});
  }

  async function confirmPreview() {
    setError("");
    if (warnings.length > 0 && !acknowledgeWarnings) {
      setError("Hãy xác nhận đã kiểm tra các cảnh báo/chênh lệch trước khi tiếp tục.");
      return;
    }
    if (issues.length > 0 || !canCreate) {
      setError("Hãy xử lý các lỗi đối chiếu trước khi xác nhận tạo yêu cầu.");
      return;
    }
    if (!preview.length && borrowEntries.length > 0) {
      const response = await apiFetch(`${API_URL}/employee-borrowing/import-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          import_hash: importHash,
          filename: importFilename,
          entries: borrowEntries,
        }),
      });
      const result = await response.json() as { detail?: string; batch_id?: number };
      if (!response.ok) {
        setError(result.detail ?? "Không thể đưa các đơn mượn số vào hàng chờ vay mượn.");
        return;
      }
      clearPreview();
      setMessage("Đã ghi nhận các đơn Mượn Số vào sổ Hàng vay mượn NVBH.");
      return;
    }
    if (preview.length === 0) {
      setError("File không có sản phẩm cần xuất hoặc ghi nhận vay mượn.");
      return;
    }
    if (!plan || plan.some((item) => item.shortage_quantity > 0 || item.planned_quantity !== item.quantity)) {
      setError("Hãy tính FEFO lại và xử lý đủ tồn kho trước khi gửi yêu cầu.");
      return;
    }
    const items = preview.map((item) => {
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
        borrowed_employee_offsets: item.borrowed_employee_offsets,
        planned_allocations: planned?.picks.map((pick) => ({
          lot_id: pick.lot_id,
          location_code: pick.location_code,
          location_id: pick.location_id,
          lot_number: pick.lot_number,
          expiry_date: pick.expiry_date,
          quantity: pick.quantity,
          allocation_strategy: pick.allocation_strategy,
        })),
      };
    });
    const payload = {
      warehouse_id: Number(warehouseId),
      items,
      employee_summaries: employeeSummaries.length > 0 ? employeeSummaries : undefined,
      orders: orders.length > 0 ? orders : undefined,
      borrow_entries: borrowEntries.length ? borrowEntries : undefined,
      borrow_import_hash: borrowEntries.length ? importHash : undefined,
      borrow_filename: borrowEntries.length ? importFilename : undefined,
    };
    const response = await apiFetch(`${API_URL}/delivery-requests/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json() as { detail?: string; id?: number; code?: string; status?: string };
    if (!response.ok) { setError(result.detail ?? "Không thể tạo yêu cầu."); return; }
    // Tự động submit sau khi kế hoạch FEFO đã được lưu cùng yêu cầu.
    // để thủ kho thấy trong "Hàng đợi xuất kho".
    let submitNote = "";
    if (result.id) {
      const submitResponse = await apiFetch(`${API_URL}/delivery-requests/${result.id}/submit`, { method: "POST" });
      const submitResult = await submitResponse.json().catch(() => ({})) as { detail?: string };
      if (!submitResponse.ok) {
        submitNote = ` Tuy nhiên gửi xác nhận thất bại: ${submitResult.detail ?? "lỗi không xác định"}.`;
      } else {
        submitNote = " Đã gửi xác nhận đến thủ kho.";
      }
    }
    setPreview([]);
    setOrders([]);
    setOrdersReconciliation([]);
    setBorrowEntries([]);
    setPlan(null);
    setMessage(`Đã tạo yêu cầu ${result.code ?? ""}.${submitNote}`);
    await load();
    await onCreated?.(result);
  }

  function downloadSummary() {
    if (!preview.length || !plan || plan.some((item) => item.shortage_quantity > 0)) return;
    const drivers = employeeSummaries.map((employee) => employee.employee_code);
    const rows: (string | number)[][] = [
      ["PHIẾU TỔNG HỢP GIAO HÀNG THEO NHÓM XE"],
      ["Nguồn dữ liệu: DMS"],
      ["STT", "Mã hàng", "Tên sản phẩm", "Vị trí lấy hàng", "HSD tương ứng", "Tổng xuất (thùng/hộp)", "Số lượng theo từng NVGH"],
      ["", "", "", "", "", "", ...employeeSummaries.map((employee) => `${employee.employee_code} (${employee.employee_name ?? ""})`)],
    ];
    preview.forEach((item, index) => {
      const bpc = Math.max(1, item.boxes_per_carton ?? 1);
      const split = (quantity: number) => `${Math.floor(quantity / bpc)}/${quantity % bpc}`;
      const allocations = item.employee_allocations ?? {};
      const itemPlan = plan.find((planned) => (
        planned.product_id === item.product_id
        || planned.sku.trim().toUpperCase() === item.sku.trim().toUpperCase()
      ));
      const picksByLocationAndExpiry = new Map<string, { location: string; expiry: string; quantity: number }>();
      for (const pick of itemPlan?.picks ?? []) {
        const location = pick.location_code || "—";
        const expiry = pick.expiry_date
          ? formatDate(pick.expiry_date.split("T")[0])
          : "—";
        const key = `${location}\u0000${expiry}`;
        const current = picksByLocationAndExpiry.get(key);
        if (current) current.quantity += pick.quantity;
        else picksByLocationAndExpiry.set(key, { location, expiry, quantity: pick.quantity });
      }
      const pickDetails = [...picksByLocationAndExpiry.values()];
      rows.push([
        index + 1,
        item.sku,
        item.product_name,
        pickDetails.map((pick) => `${pick.location}: ${split(pick.quantity)}`).join("\n") || "—",
        pickDetails.map((pick) => `${pick.location}: ${pick.expiry}`).join("\n") || "—",
        split(item.quantity),
        ...drivers.map((code) => {
          const allocation = allocations[code];
          return allocation?.quantity ? split(allocation.quantity) : "";
        }),
      ]);
    });
    const totalQuantities = [
      "",
      "",
      "TỔNG SỐ LƯỢNG (đơn vị)",
      "",
      "",
      preview.reduce((sum, item) => sum + item.quantity, 0),
      ...employeeSummaries.map((employee) => preview.reduce((sum, item) => (
        sum + (item.employee_allocations?.[employee.employee_code]?.quantity ?? 0)
      ), 0)),
    ];
    rows.push(totalQuantities);
    rows.push(["", "", "TỔNG ĐƠN HÀNG (đơn)", "", "", orders.length, ...employeeSummaries.map((employee) => employee.order_count)]);
    rows.push([
      "",
      "",
      "TỔNG CỘNG (ngàn đồng)",
      "",
      "",
      Math.round(employeeSummaries.reduce((sum, employee) => sum + employee.amount, 0) / 1000),
      ...employeeSummaries.map((employee) => Math.round(employee.amount / 1000)),
    ]);
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet["!cols"] = [
      { wch: 10 },
      { wch: 18 },
      { wch: 38 },
      { wch: 24 },
      { wch: 28 },
      { wch: 24 },
      { wch: 28 },
      ...drivers.map(() => ({ wch: 18 })),
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "PhieuGiaoHang");
    XLSX.writeFile(workbook, "BC_THGH_NhomXe.xlsx");
  }

  async function checkStock() {
    setPlan(null);
    const updatedItems = await loadStock(preview, warehouseId);
    setPreview(updatedItems);
    setMessage("Đã kiểm tra tồn kho (sau khi trừ lượng giữ chỗ). Chưa tìm vị trí.");
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
      const response = await apiFetch(`${API_URL}/delivery-requests/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ warehouse_id: Number(warehouseId), items }),
      });
      const result = await response.json() as PlanItem[] | { detail?: string };
      if (!response.ok) throw new Error("detail" in result ? result.detail ?? "Không thể lập kế hoạch FEFO." : "Không thể lập kế hoạch FEFO.");
      const planItems = result as PlanItem[];
      setPlan(planItems);
      setPreview((current) => current.map((item) => {
        const planned = planItems.find((planItem) => planItem.product_id === item.product_id);
        return planned ? { ...item, shortage_quantity: planned.shortage_quantity } : item;
      }));
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
    const stockResponse = await apiFetch(`${API_URL}/inventory/stock-levels/?warehouse_id=${encodeURIComponent(warehouseId)}`);
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
            <p className="text-xs text-amber-700">Mượn Số lấy NVBH từ DMS; Trả Số xuất hàng và ghi công nợ cho NVGH trong file, đồng thời bù trừ hàng vay của NVBH trên DMS.</p>
          </div>
          <div className="flex gap-2 items-center">
            <select value={warehouseId} onChange={(event) => { setWarehouseId(event.target.value); setPlan(null); }} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm">
              <option value="">Chọn kho xuất</option>
              {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
            </select>
            <button disabled={!warehouseId || uploading} onClick={() => fileInput.current?.click()} className="flex items-center gap-2 bg-sky-500 text-white px-3 py-2 rounded-lg text-sm disabled:opacity-50"><Upload size={16} />Upload file yêu cầu mới</button>
            <input ref={fileInput} type="file" accept=".xlsx,.xlsm" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) chooseFile(file); event.target.value = ""; }} />
          </div>
        </div>
      )}
      {embedded && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h3 className="font-semibold text-gray-900">Tạo yêu cầu từ Excel</h3>
            <p className="text-sm text-gray-500">Upload file có sheet DSDonHang; hệ thống tra dữ liệu DMS, tổng hợp sản phẩm theo NVGH và lập FEFO.</p>
            <p className="text-xs text-amber-700">Mượn Số lấy NVBH từ DMS; Trả Số ghi công nợ cho NVGH trong file và bù trừ hàng vay của NVBH trên DMS.</p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
          <select value={warehouseId} onChange={(event) => { setWarehouseId(event.target.value); setPlan(null); }} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm">
            <option value="">Chọn kho xuất</option>
            {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
          </select>
          <button disabled={!warehouseId || uploading} onClick={() => fileInput.current?.click()} className="flex items-center gap-2 bg-sky-500 text-white px-3 py-2 rounded-lg text-sm disabled:opacity-50"><Upload size={16} />Upload file yêu cầu mới</button>
          <input ref={fileInput} type="file" accept=".xlsx,.xlsm" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) chooseFile(file); event.target.value = ""; }} />
        </div>
        </div>
      )}
      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>}
      {message && <div className="bg-emerald-50 text-emerald-700 rounded-lg px-4 py-3 text-sm">{message}</div>}

      {warnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-4 text-sm space-y-1">
          <div className="font-semibold flex items-center gap-1.5 text-amber-900">
            <span>⚠️ Cảnh báo công nợ & dữ liệu kiểm tra:</span>
          </div>
          <ul className="list-disc list-inside space-y-0.5">
            {warnings.map((w, idx) => (
              <li key={idx}>{w}</li>
            ))}
          </ul>
          <label className="mt-3 flex items-start gap-2 border-t border-amber-200 pt-3 font-medium">
            <input type="checkbox" checked={acknowledgeWarnings} onChange={(event) => setAcknowledgeWarnings(event.target.checked)} />
            <span>Tôi đã đối chiếu các cảnh báo/chênh lệch và xác nhận tiếp tục với nguồn thành tiền đã chọn.</span>
          </label>
        </div>
      )}

      {issues.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold">Cần xử lý trước khi tạo yêu cầu</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {issues.map((issue, index) => <li key={`${index}-${issue}`}>{issue}</li>)}
          </ul>
        </div>
      )}

      {isNewWorkbook && Object.keys(sendOrderCandidates).length > 0 && (
        <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
              <p className="text-sm font-semibold text-amber-900">Cần ghép đơn Gửi Số với đơn nội bộ</p>
              {Object.entries(sendOrderCandidates).map(([orderNumber, candidates]) => {
                const sourceOrder = ordersReconciliation.find((order) => order.order_number === orderNumber);
                return (
                  <div key={orderNumber} className="grid gap-2 md:grid-cols-[180px_1fr] md:items-center">
                    <span className="text-xs text-gray-700">Gửi Số {orderNumber} · {sourceOrder?.customer_name ?? sourceOrder?.customer_code ?? "Khách hàng"}</span>
                    <select
                      value={sendOrderMappings[orderNumber.toLowerCase()] ?? ""}
                      onChange={(event) => setSendOrderMappings((current) => ({ ...current, [orderNumber.toLowerCase()]: Number(event.target.value) || 0 }))}
                      className="rounded border border-gray-200 bg-white px-2 py-1.5 text-xs"
                    >
                      <option value="">Chọn đơn hàng nội bộ</option>
                      {candidates.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.code} · {candidate.customer_name} · {candidate.total.toLocaleString("vi-VN")} đ · {candidate.products.join(", ")}
                        </option>
                      ))}
                    </select>
                    {candidates.length === 0 && <span className="text-xs text-red-700 md:col-start-2">Chưa có đơn nội bộ của khách hàng này. Hãy tạo đơn trước rồi tải lại file.</span>}
                  </div>
                );
              })}
              <button
                type="button"
                disabled={uploading || !Object.values(sendOrderMappings).some(Boolean)}
                onClick={reanalyzeWithMappings}
                className="rounded bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {uploading ? "Đang phân tích…" : "Áp dụng ghép nối và phân tích lại"}
              </button>
        </div>
      )}

      {isNewWorkbook && preview.length > 0 && employeeSummaries.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-gray-50 px-5 py-4">
            <div>
              <h4 className="font-semibold text-gray-900">Phiếu tổng hợp giao hàng theo nhóm xe</h4>
              <p className="text-xs text-gray-500">Số lượng và tiền được tổng hợp từ dữ liệu DMS, phân bổ theo NVGH trong sheet DSDonHang.</p>
            </div>
            <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-medium text-sky-800">{employeeSummaries.length} NVGH</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-xs">
              <thead className="border-b bg-gray-50 text-gray-600">
                <tr>
                  <th rowSpan={2} className="px-3 py-2 text-left">STT</th>
                  <th rowSpan={2} className="px-3 py-2 text-left">Mã hàng</th>
                  <th rowSpan={2} className="px-3 py-2 text-left">Tên sản phẩm</th>
                  <th rowSpan={2} className="px-3 py-2 text-right">Tổng xuất<br />(thùng/hộp)</th>
                  <th colSpan={employeeSummaries.length} className="px-3 py-2 text-center">Số lượng theo từng NVGH (thùng/hộp)</th>
                </tr>
                <tr>
                  {employeeSummaries.map((employee) => (
                    <th key={employee.employee_code} className="min-w-28 px-3 py-2 text-center">
                      <span className="block font-semibold text-gray-800">{employee.employee_code}</span>
                      <span className="block font-normal text-gray-500">{employee.employee_name}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {preview.map((item, index) => {
                  const bpc = Math.max(1, item.boxes_per_carton ?? 1);
                  const split = (quantity: number) => {
                    const cartons = Math.floor(quantity / bpc);
                    return `${cartons}/${quantity % bpc}`;
                  };
                  return (
                    <tr key={`${item.sku}-${index}`} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-500">{index + 1}</td>
                      <td className="px-3 py-2 font-mono font-medium text-gray-800">{item.sku}</td>
                      <td className="px-3 py-2">{item.product_name}</td>
                      <td className="px-3 py-2 text-right font-semibold">{split(item.quantity)}</td>
                      {employeeSummaries.map((employee) => {
                        const quantity = item.employee_allocations?.[employee.employee_code]?.quantity ?? 0;
                        return <td key={employee.employee_code} className="px-3 py-2 text-center">{quantity > 0 ? split(quantity) : "—"}</td>;
                      })}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-semibold text-gray-800">
                <tr>
                  <td colSpan={3} className="px-3 py-2 text-right">TỔNG SỐ LƯỢNG (đơn vị)</td>
                  <td className="px-3 py-2 text-right">{preview.reduce((sum, item) => sum + item.quantity, 0).toLocaleString("vi-VN")}</td>
                  {employeeSummaries.map((employee) => (
                    <td key={employee.employee_code} className="px-3 py-2 text-right">
                      {preview.reduce((sum, item) => sum + (item.employee_allocations?.[employee.employee_code]?.quantity ?? 0), 0).toLocaleString("vi-VN")}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td colSpan={3} className="px-3 py-2 text-right">TỔNG ĐƠN HÀNG (đơn)</td>
                  <td className="px-3 py-2 text-right">{orders.length}</td>
                  {employeeSummaries.map((employee) => <td key={employee.employee_code} className="px-3 py-2 text-right">{employee.order_count}</td>)}
                </tr>
                <tr>
                  <td colSpan={3} className="px-3 py-2 text-right">TỔNG CỘNG (ngàn đồng)</td>
                  <td className="px-3 py-2 text-right">{Math.round(employeeSummaries.reduce((sum, employee) => sum + employee.amount, 0) / 1000).toLocaleString("vi-VN")}</td>
                  {employeeSummaries.map((employee) => <td key={employee.employee_code} className="px-3 py-2 text-right">{Math.round(employee.amount / 1000).toLocaleString("vi-VN")}</td>)}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {employeeSummaries.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
            <div>
              <h4 className="font-semibold text-gray-900">Tổng hợp thành tiền theo NVGH</h4>
              <p className="text-xs text-gray-500">Số tiền lấy từ DMS; công nợ chỉ ghi nhận khi thủ kho xác nhận xuất hàng thành công.</p>
            </div>
            <span className="text-xs font-medium px-2.5 py-1 bg-sky-100 text-sky-800 rounded-full">
              {employeeSummaries.length} nhân viên
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50/50 text-gray-500 border-b border-gray-100">
                <tr>
                  <th className="text-left px-5 py-3">Mã NV</th>
                  <th className="text-left px-5 py-3">Tên NV</th>
                  {!isNewWorkbook && <th className="text-right px-5 py-3">Khối lượng (tấn)</th>}
                  <th className="text-right px-5 py-3">Số đơn hàng</th>
                  <th className="text-right px-5 py-3">Tiền xuất kho</th>
                  <th className="text-right px-5 py-3">Nợ hiện tại</th>
                  <th className="text-right px-5 py-3">Phiếu chờ xuất</th>
                  <th className="text-right px-5 py-3">Dự kiến nợ sau xuất</th>
                  <th className="text-center px-5 py-3">Hạn mức (500tr)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {employeeSummaries.map((s, index) => (
                  <tr key={`${s.employee_code}-${index}`} className={s.is_over_limit ? "bg-amber-50/40" : ""}>
                    <td className="px-5 py-2.5 font-medium text-gray-900">{s.employee_code}</td>
                    <td className="px-5 py-2.5 text-gray-700">{s.employee_name || "—"}</td>
                    {!isNewWorkbook && <td className="px-5 py-2.5 text-right font-mono text-gray-600">{s.weight_ton.toFixed(3)}</td>}
                    <td className="px-5 py-2.5 text-right font-mono text-gray-600">{s.order_count}</td>
                    <td className="px-5 py-2.5 text-right font-semibold text-gray-900">{s.amount.toLocaleString("vi-VN")} đ</td>
                    <td className="px-5 py-2.5 text-right text-gray-600">{(s.current_debt || 0).toLocaleString("vi-VN")} đ</td>
                    <td className="px-5 py-2.5 text-right text-amber-700">{(s.pending_debt || 0).toLocaleString("vi-VN")} đ</td>
                    <td className={`px-5 py-2.5 text-right font-semibold ${s.is_over_limit ? "text-amber-700" : "text-gray-900"}`}>
                      {(s.projected_debt || 0).toLocaleString("vi-VN")} đ
                    </td>
                    <td className="px-5 py-2.5 text-center">
                      {s.is_over_limit ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                          ⚠️ Vượt hạn mức
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800">
                          An toàn
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(borrowEntries.length > 0 || preview.some((item) => (item.borrowed_employee_offsets?.length ?? 0) > 0)) && (
        <div className="bg-white rounded-xl border border-rose-100 overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-rose-100 bg-rose-50/40 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="font-semibold text-gray-900">Tổng hợp Mượn Số & Trả Số (chuyển sang Hàng vay mượn NVBH)</h4>
              <p className="text-xs text-gray-600">
                Đơn <span className="font-semibold text-rose-700">Mượn Số</span> ghi nhận âm ngay khi tạo yêu cầu; đơn{" "}
                <span className="font-semibold text-emerald-700">Trả Số</span> sẽ tự động ghi nhận dương và bù trừ khi Thủ kho hoàn tất xuất kho thực tế.
              </p>
            </div>
            <span className="text-xs font-medium px-2.5 py-1 bg-rose-100 text-rose-800 rounded-full">
              {borrowEntries.length} dòng Mượn Số ·{" "}
              {preview.reduce((sum, item) => sum + (item.borrowed_employee_offsets?.length ?? 0), 0)} dòng Trả Số
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50/80 text-gray-500 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-2.5">Trạng thái</th>
                  <th className="text-left px-4 py-2.5">Mã NVBH (DMS)</th>
                  <th className="text-left px-4 py-2.5">Tên NVBH</th>
                  <th className="text-left px-4 py-2.5">Sản phẩm (NPP)</th>
                  <th className="text-right px-4 py-2.5">Số lượng (hộp)</th>
                  <th className="text-right px-4 py-2.5">Thành tiền</th>
                  <th className="text-left px-4 py-2.5">Ghi chú / Thời điểm ghi nhận</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {borrowEntries.map((entry, idx) => {
                  const prod = productOptions.find((p) => p.id === entry.product_id);
                  return (
                    <tr key={`borrow-${idx}`} className="hover:bg-rose-50/20">
                      <td className="px-4 py-2">
                        <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-700 border border-rose-200">
                          Mượn Số
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono font-medium text-gray-900">{entry.external_employee_code || "—"}</td>
                      <td className="px-4 py-2 text-gray-800">{entry.external_employee_name || "—"}</td>
                      <td className="px-4 py-2 text-gray-700">
                        {prod ? `${prod.sku} — ${prod.name}` : `ID #${entry.product_id}`}
                      </td>
                      <td className="px-4 py-2 text-right font-semibold text-rose-700">
                        {entry.quantity.toLocaleString("vi-VN")}
                      </td>
                      <td className="px-4 py-2 text-right font-semibold text-rose-700">
                        {entry.amount.toLocaleString("vi-VN")} đ
                      </td>
                      <td className="px-4 py-2 text-gray-600">
                        {entry.note || "Ghi nhận ngay khi tạo yêu cầu"}
                      </td>
                    </tr>
                  );
                })}
                {preview.flatMap((item) =>
                  (item.borrowed_employee_offsets ?? []).map((offset, idx) => (
                    <tr key={`offset-${item.product_id}-${idx}`} className="hover:bg-emerald-50/20">
                      <td className="px-4 py-2">
                        <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
                          Trả Số
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono font-medium text-gray-900">{offset.external_employee_code}</td>
                      <td className="px-4 py-2 text-gray-800">{offset.external_employee_name || "—"}</td>
                      <td className="px-4 py-2 text-gray-700">
                        <span className="font-mono font-semibold text-emerald-700">{item.sku}</span> — {item.product_name}
                      </td>
                      <td className="px-4 py-2 text-right font-semibold text-emerald-700">
                        +{offset.quantity.toLocaleString("vi-VN")}
                      </td>
                      <td className="px-4 py-2 text-right font-semibold text-emerald-700">
                        +{offset.amount.toLocaleString("vi-VN")} đ
                      </td>
                      <td className="px-4 py-2 text-gray-600">
                        Ghi nhận & bù trừ khi Thủ kho hoàn tất xuất kho
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {orders.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100 bg-gray-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h4 className="font-semibold text-gray-900">Danh sách đơn đủ điều kiện xuất kho</h4>
              <p className="text-xs text-gray-500">
                Khớp {orders.length} đơn hàng với dữ liệu đơn hàng hệ thống. Tổng giá trị:{" "}
                <span className="font-semibold text-gray-900">
                  {orders.reduce((sum, o) => sum + o.amount, 0).toLocaleString("vi-VN")} đ
                </span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Tìm số đơn, KH, NVGH..."
                value={orderSearch}
                onChange={(e) => setOrderSearch(e.target.value)}
                className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <span className="text-xs font-medium px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-full whitespace-nowrap">
                {orders.length} đơn
              </span>
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50/80 text-gray-500 sticky top-0 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-2.5">STT</th>
                  <th className="text-left px-4 py-2.5">Ngày đơn</th>
                  <th className="text-left px-4 py-2.5">Số đơn hàng</th>
                  <th className="text-left px-4 py-2.5">NVGH</th>
                  <th className="text-left px-4 py-2.5">Mã KH</th>
                  <th className="text-left px-4 py-2.5">Tên khách hàng</th>
                  <th className="text-right px-4 py-2.5">Số tiền</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orders
                  .filter((o) => {
                    if (!orderSearch) return true;
                    const q = orderSearch.toLowerCase();
                    return (
                      o.order_number.toLowerCase().includes(q) ||
                      (o.customer_name && o.customer_name.toLowerCase().includes(q)) ||
                      (o.customer_code && o.customer_code.toLowerCase().includes(q)) ||
                      o.employee_code.toLowerCase().includes(q)
                    );
                  })
                  .map((o, idx) => (
                    <tr key={`${o.order_number}-${idx}`} className="hover:bg-gray-50/60">
                      <td className="px-4 py-2 text-gray-400">{idx + 1}</td>
                      <td className="px-4 py-2 text-gray-600">{o.order_date || "—"}</td>
                      <td className="px-4 py-2 font-mono font-medium text-sky-700">{o.order_number}</td>
                      <td className="px-4 py-2 text-gray-700">
                        <span className="font-medium text-gray-900">{o.employee_code}</span>
                        {o.employee_name && <span className="text-gray-400 ml-1">({o.employee_name})</span>}
                      </td>
                      <td className="px-4 py-2 font-mono text-gray-600">{o.customer_code || "—"}</td>
                      <td className="px-4 py-2 text-gray-800">{o.customer_name || "—"}</td>
                      <td className="px-4 py-2 text-right font-semibold text-gray-900">
                        {o.amount.toLocaleString("vi-VN")} đ
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}


      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gray-50/50">
          <div className="flex items-center gap-2">
            <ClipboardList size={18} className="text-sky-500" />
            <span className="font-semibold text-gray-900">Danh sách sản phẩm upload</span>
          </div>
          {(preview.length > 0 || borrowEntries.length > 0) && (
            <div className="flex flex-wrap gap-2">
              {preview.length > 0 && <button
                onClick={() => checkStock().catch((e) => setError(e instanceof Error ? e.message : "Không thể kiểm tra tồn kho."))}
                className="bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition"
              >
                Check tồn kho
              </button>}
              {preview.length > 0 && <button
                disabled={planning}
                onClick={() => findLocations()}
                className="bg-indigo-500 hover:bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50 transition"
              >
                {planning ? "Đang tìm…" : "Tìm vị trí (FEFO)"}
              </button>}
              {preview.length > 0 && <button
                disabled={!plan || plan.some((item) => item.shortage_quantity > 0) || planning}
                onClick={downloadSummary}
                className="inline-flex items-center gap-1 bg-white border border-gray-200 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download size={14} /> Tải chi tiết BC_THGH_NhomXe
              </button>}
              <button
                disabled={!canCreate || (warnings.length > 0 && !acknowledgeWarnings) || (preview.length > 0 && (!plan || plan.some((item) => item.shortage_quantity > 0))) || planning}
                onClick={() => confirmPreview().catch((e) => setError(e instanceof Error ? e.message : "Không thể tạo yêu cầu."))}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition shadow-xs disabled:cursor-not-allowed disabled:opacity-50"
              >
                Xác nhận tạo yêu cầu
              </button>
            </div>
          )}
        </div>

        {preview.length > 0 && (
          <div className="grid grid-cols-3 gap-3 p-3.5 bg-sky-50/50 border-b border-gray-100">
            <div className="text-center">
              <span className="text-[11px] font-semibold text-sky-800 uppercase block">Tổng Thùng Nguyên</span>
              <span className="text-xl font-black text-sky-950 mt-0.5 block">
                {preview.reduce((s, it) => s + (it.cartons ?? splitCartons(it.quantity, it.boxes_per_carton).cartons), 0).toLocaleString("vi-VN")}{" "}
                <span className="text-xs font-normal text-sky-700">thùng</span>
              </span>
            </div>
            <div className="text-center border-x border-sky-200">
              <span className="text-[11px] font-semibold text-amber-800 uppercase block">Tổng Hộp Lẻ</span>
              <span className="text-xl font-black text-amber-950 mt-0.5 block">
                {preview.reduce((s, it) => s + (it.loose_boxes ?? splitCartons(it.quantity, it.boxes_per_carton).looseBoxes), 0).toLocaleString("vi-VN")}{" "}
                <span className="text-xs font-normal text-amber-700">hộp</span>
              </span>
            </div>
            <div className="text-center">
              <span className="text-[11px] font-semibold text-gray-600 uppercase block">Tổng Quy Đổi</span>
              <span className="text-xl font-black text-gray-900 mt-0.5 block">
                {preview.reduce((s, it) => s + it.quantity, 0).toLocaleString("vi-VN")}{" "}
                <span className="text-xs font-normal text-gray-500">hộp ({preview.length} SKU)</span>
              </span>
            </div>
          </div>
        )}

        {preview.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            Chọn kho và upload Excel để xem danh sách sản phẩm.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-600 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-3">Mã hàng</th>
                  <th className="text-left px-4 py-3">Tên sản phẩm</th>
                  {isNewWorkbook && <th className="text-left px-4 py-3">Mã DMS nguồn</th>}
                  <th className="text-center px-3 py-3 w-20">Quy cách</th>
                  <th className="text-right px-3 py-3 bg-sky-50 font-bold text-sky-900 w-24">Thùng (T)</th>
                  <th className="text-right px-3 py-3 bg-amber-50 font-bold text-amber-900 w-20">Lẻ (H)</th>
                  <th className="text-right px-4 py-3">Tổng yêu cầu</th>
                  <th className="text-right px-4 py-3">Tồn khả dụng</th>
                  <th className="text-right px-4 py-3">Đã giữ chỗ</th>
                  {isNewWorkbook && <th className="text-left px-4 py-3">Vị trí lấy</th>}
                  {isNewWorkbook && <th className="text-left px-4 py-3">HSD theo vị trí</th>}
                  <th className="text-right px-4 py-3">Thiếu</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {preview.map((item, index) => {
                  const { cartons, looseBoxes, bpc } = splitCartons(item.quantity, item.boxes_per_carton);
                  return (
                    <tr key={`${item.sku}-${index}`} className={item.shortage_quantity > 0 ? "bg-red-50/70" : "hover:bg-gray-50/60"}>
                      <td className="px-4 py-2">
                        {isNewWorkbook
                          ? <span className="font-mono font-semibold text-emerald-700">{item.sku}</span>
                          : <input
                            list="delivery-product-options"
                            value={item.sku}
                            placeholder="Tìm SKU..."
                            onChange={(event) => selectPreviewSku(index, event.target.value)}
                            onBlur={(event) => replacePreviewSku(index, event.target.value).catch(() => setError("Không thể kiểm tra mã thay thế."))}
                            className="w-36 border border-gray-200 rounded px-2 py-1 font-mono font-medium bg-white"
                          />}
                      </td>
                      <td className="px-4 py-2 font-medium text-gray-800">{item.product_name}</td>
                      {isNewWorkbook && <td className="px-4 py-2 font-mono text-gray-600">{item.dms_skus?.join(", ") || "—"}</td>}
                      <td className="px-3 py-2 text-center text-gray-500">{bpc} H/T</td>
                      <td className="px-3 py-2 text-right font-black text-sky-950 bg-sky-50/40">
                        {cartons > 0 ? cartons.toLocaleString("vi-VN") : "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-bold text-amber-900 bg-amber-50/40">
                        {looseBoxes > 0 ? looseBoxes : "—"}
                      </td>
                      <td className="px-4 py-2 text-right font-semibold text-gray-900">
                        {item.quantity.toLocaleString("vi-VN")}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-600">{item.available_quantity || "-"}</td>
                      <td className="px-4 py-2 text-right text-gray-600">{item.reserved_quantity || "-"}</td>
                      {isNewWorkbook && (() => {
                        const planned = plan?.find((plannedItem) => plannedItem.product_id === item.product_id);
                        return <>
                          <td className="px-4 py-2 text-gray-700">
                            {planned?.picks.length
                              ? planned.picks.map((pick, pickIndex) => {
                                const split = splitCartons(pick.quantity, item.boxes_per_carton);
                                return <div key={`${pick.location_id}-${pickIndex}`} className="whitespace-nowrap">{pick.location_code ?? "Chưa rõ vị trí"}: {split.cartons}/{split.looseBoxes}</div>;
                              })
                              : <span className={planned?.shortage_quantity ? "font-medium text-red-600" : "text-gray-400"}>{planned?.shortage_quantity ? "Không đủ tồn" : "Chưa tính FEFO"}</span>}
                          </td>
                          <td className="px-4 py-2 text-gray-600">
                            {planned?.picks.length
                              ? planned.picks.map((pick, pickIndex) => <div key={`${pick.location_id}-expiry-${pickIndex}`} className="whitespace-nowrap">{pick.expiry_date ? formatDate(pick.expiry_date) : "—"}</div>)
                              : "—"}
                          </td>
                        </>;
                      })()}
                      <td className={`px-4 py-2 text-right font-semibold ${item.shortage_quantity > 0 ? "text-red-600" : "text-gray-400"}`}>
                        {item.shortage_quantity || "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {plan && plan.length > 0 && !isNewWorkbook && (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
            <div className="flex items-center gap-2">
              <MapPin size={18} className="text-indigo-500" />
              <span className="font-semibold text-gray-900">Kế hoạch lấy hàng FEFO (HSD gần nhất trước)</span>
            </div>
            <button onClick={() => setPlan(null)} className="text-xs text-gray-400 hover:text-gray-600 font-medium">
              Ẩn
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-600 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-3">Mã hàng</th>
                  <th className="text-left px-4 py-3">Tên sản phẩm</th>
                  <th className="text-left px-4 py-3">Vị trí</th>
                  <th className="text-left px-4 py-3">HSD</th>
                  <th className="text-right px-3 py-3 bg-sky-50 font-bold text-sky-900 w-24">Thùng (T)</th>
                  <th className="text-right px-3 py-3 bg-amber-50 font-bold text-amber-900 w-20">Lẻ (H)</th>
                  <th className="text-right px-4 py-3">Tổng SL lấy</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {plan.map((item) =>
                  item.picks.length === 0 ? (
                    <tr key={item.sku} className="bg-red-50">
                      <td className="px-4 py-2 font-medium font-mono">{item.sku}</td>
                      <td className="px-4 py-2">{item.product_name}</td>
                      <td colSpan={5} className="px-4 py-2 text-red-600 font-semibold">
                        Thiếu {item.shortage_quantity} đơn vị
                      </td>
                    </tr>
                  ) : (
                    item.picks.map((pick, pickIndex) => {
                      const { cartons, looseBoxes } = splitCartons(pick.quantity, item.boxes_per_carton);
                      return (
                        <tr key={`${item.sku}-${pickIndex}`} className={pickIndex === 0 ? "" : "border-t border-gray-50"}>
                          {pickIndex === 0 && <td rowSpan={item.picks.length} className="px-4 py-2 font-medium font-mono">{item.sku}</td>}
                          {pickIndex === 0 && <td rowSpan={item.picks.length} className="px-4 py-2 font-medium text-gray-800">{item.product_name}</td>}
                          <td className="px-4 py-2 font-medium text-gray-800">{pick.location_code ?? "-"}</td>
                          <td className="px-4 py-2 text-gray-600">{pick.expiry_date ? formatDate(pick.expiry_date) : "-"}</td>
                          <td className="px-3 py-2 text-right font-black text-sky-950 bg-sky-50/40">
                            {cartons > 0 ? cartons : "—"}
                          </td>
                          <td className="px-3 py-2 text-right font-bold text-amber-900 bg-amber-50/40">
                            {looseBoxes > 0 ? looseBoxes : "—"}
                          </td>
                          <td className="px-4 py-2 text-right font-bold text-gray-900">
                            {pick.quantity.toLocaleString("vi-VN")}
                          </td>
                        </tr>
                      );
                    })
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

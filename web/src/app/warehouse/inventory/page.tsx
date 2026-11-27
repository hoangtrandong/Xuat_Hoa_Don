"use client";
// src/app/warehouse/inventory/page.tsx
import { useEffect, useRef, useState } from "react";
import { Boxes, CircleDollarSign, TriangleAlert, ArrowDownUp, Warehouse as WarehouseIcon, SlidersHorizontal, Download, Package, Upload, Trash2, CheckCircle2, AlertTriangle, Loader2, X } from "lucide-react";
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
  invoice_product_id?: number | null;
  invoice_product_code?: string | null;
  invoice_product_name?: string | null;
  category_id?: number | null;
  category_name?: string | null;
  category?: string | null;
  unit: string;
  on_hand: number;
  reserved: number;
  available: number;
  locked_quantity?: number;
  reorder_level: number;
  lot_count?: number;
  earliest_expiry?: string | null;
  locations?: string | null;
}

interface ApiCategory {
  id: number;
  name: string;
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

function toStockLevel(item: ApiStockLevel, categoryName?: string): StockLevel {
  const cat = item.category_name || item.category || categoryName || "";
  return {
    id: String(item.product_id),
    productCode: item.product_code,
    productName: item.product_name,
    category: cat || "Chưa phân loại",
    unit: item.unit,
    onHand: item.on_hand,
    reserved: item.reserved,
    available: item.available,
    lockedQuantity: item.locked_quantity,
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
  const [categoryOptions, setCategoryOptions] = useState<ApiCategory[]>([]);
  const [ledgerEntriesState, setLedgerEntriesState] = useState<LedgerEntry[]>([]);
  const [locations, setLocations] = useState<ApiLocation[]>([]);
  const [lots, setLots] = useState<ApiLot[]>([]);
  const [lotDetails, setLotDetails] = useState<ApiLotDetail[]>([]);
  const [lotProductFilter, setLotProductFilter] = useState("Tất cả");
  const [lotWarehouseFilter, setLotWarehouseFilter] = useState<number | "">("");
  const [loadError, setLoadError] = useState("");
  const [toastMsg, setToastMsg] = useState("");
  const [stockMetaById, setStockMetaById] = useState<Record<string, { productId: number; invoiceProductId: number | null }>>({});

  // Chọn nhiều để xóa tồn kho
  const [selectedStockIds, setSelectedStockIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleteWarehouseId, setBulkDeleteWarehouseId] = useState<number | "">("");
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteError, setBulkDeleteError] = useState("");

  // Modal Upload Excel Tồn đầu kỳ
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadWarehouseId, setUploadWarehouseId] = useState<number | "">("");
  const [uploadMode, setUploadMode] = useState<"ADD" | "REPLACE">("ADD");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadingOpening, setUploadingOpening] = useState(false);
  const [uploadOpeningError, setUploadOpeningError] = useState("");
  const [uploadWarnings, setUploadWarnings] = useState<string[]>([]);
  const openingFileRef = useRef<HTMLInputElement>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(""), 5000);
  };

  useEffect(() => {
    let cancelled = false;
    async function loadInventory() {
      try {
        const [stockResponse, transactionResponse, warehouseResponse, locationResponse, lotResponse, lotDetailResponse, categoryResponse] = await Promise.all([
          apiFetch(`${API_URL}/inventory/stock-levels/`),
          apiFetch(`${API_URL}/inventory/transactions/`),
          apiFetch(`${API_URL}/inventory/warehouses/`),
          apiFetch(`${API_URL}/inventory/locations/`),
          apiFetch(`${API_URL}/inventory/lots/`),
          apiFetch(`${API_URL}/inventory/lot-details/`),
          apiFetch(`${API_URL}/products/categories/`),
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
        const loadedCategories = categoryResponse.ok ? (await categoryResponse.json() as ApiCategory[]) : [];
        if (cancelled) return;
        setCategoryOptions(loadedCategories);
        const categoryMap = new Map(loadedCategories.map((c) => [c.id, c.name]));
        const stockMap = new Map(stocks.map((item) => [item.product_id, item]));
        const warehouseMap = new Map(warehouses.map((item) => [item.id, item.name]));
        setStockLevels(stocks.map((item) => toStockLevel(item, item.category_id ? categoryMap.get(item.category_id) : undefined)));
        const meta: Record<string, { productId: number; invoiceProductId: number | null }> = {};
        for (const s of stocks) {
          meta[String(s.product_id)] = {
            productId: s.product_id,
            invoiceProductId: s.invoice_product_id ?? null,
          };
        }
        setStockMetaById(meta);
        setSelectedStockIds(new Set());
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

  const filteredStock = stockLevels.filter((s) => categoryFilter === "Tất cả" || s.category === categoryFilter);
  const totalStockQuantity = filteredStock.reduce((s, i) => s + (Number(i.onHand) || 0), 0);
  const totalValue = filteredStock.reduce((s, i) => s + i.totalValue, 0);
  const lowStock = filteredStock.filter((s) => s.onHand <= s.reorderPoint).length;
  const todayTx = ledgerEntriesState.filter((e) => e.createdAt.startsWith(new Date().toISOString().slice(0, 10))).length;
  const categories = Array.from(
    new Set([
      ...categoryOptions.map((c) => c.name),
      ...stockLevels.map((s) => s.category).filter(Boolean),
    ])
  ).filter((c) => c && c.trim() !== "");
  function toggleSelectStock(id: string) {
    setSelectedStockIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllFilteredStock() {
    setSelectedStockIds(new Set(filteredStock.map((s) => s.id)));
  }

  function clearSelectedStock() {
    setSelectedStockIds(new Set());
  }

  async function handleDownloadOpeningTemplate() {
    try {
      const res = await apiFetch(`${API_URL}/inventory/opening-stock/template`);
      if (!res.ok) throw new Error("Không thể tải file mẫu tồn đầu kỳ.");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "mau-ton-kho-dau-ky.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Lỗi khi tải file mẫu.");
    }
  }

  async function handleUploadOpeningStock() {
    if (!uploadWarehouseId) {
      setUploadOpeningError("Vui lòng chọn kho để khởi tạo tồn đầu kỳ.");
      return;
    }
    if (!uploadFile) {
      setUploadOpeningError("Vui lòng chọn file Excel (.xlsx, .xls).");
      return;
    }
    setUploadingOpening(true);
    setUploadOpeningError("");
    setUploadWarnings([]);
    try {
      const fd = new FormData();
      fd.append("file", uploadFile);
      const res = await apiFetch(
        `${API_URL}/inventory/opening-stock/upload?warehouse_id=${uploadWarehouseId}&mode=${uploadMode}`,
        { method: "POST", body: fd }
      );
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        detail?: string;
        errors?: string[];
      };
      if (!res.ok) throw new Error(data.detail || "Không thể upload file tồn đầu kỳ.");
      if (data.errors && data.errors.length > 0) {
        setUploadWarnings(data.errors);
      }
      showToast(data.message || "Khởi tạo tồn kho đầu kỳ thành công.");
      refresh();
      if (!data.errors || data.errors.length === 0) {
        setUploadOpen(false);
        setUploadFile(null);
        if (openingFileRef.current) openingFileRef.current.value = "";
      }
    } catch (err) {
      setUploadOpeningError(err instanceof Error ? err.message : "Lỗi khi upload file tồn đầu kỳ.");
    } finally {
      setUploadingOpening(false);
    }
  }

  async function handleConfirmBulkDelete() {
    if (selectedStockIds.size === 0) return;
    setBulkDeleting(true);
    setBulkDeleteError("");
    try {
      const productIds: number[] = [];
      const invoiceProductIds: number[] = [];
      for (const sid of selectedStockIds) {
        const meta = stockMetaById[sid];
        if (!meta) continue;
        if (meta.invoiceProductId && meta.invoiceProductId > 0) {
          invoiceProductIds.push(meta.invoiceProductId);
        }
        if (meta.productId > 0) {
          productIds.push(meta.productId);
        }
      }
      const res = await apiFetch(`${API_URL}/inventory/stock/bulk-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          warehouse_id: bulkDeleteWarehouseId === "" ? null : Number(bulkDeleteWarehouseId),
          product_ids: productIds,
          invoice_product_ids: invoiceProductIds,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; detail?: string };
      if (!res.ok) throw new Error(data.detail || "Không thể xóa tồn kho.");
      setBulkDeleteOpen(false);
      setSelectedStockIds(new Set());
      showToast(data.message || "Đã xóa tồn kho các sản phẩm đã chọn.");
      refresh();
    } catch (err) {
      setBulkDeleteError(err instanceof Error ? err.message : "Lỗi khi xóa tồn kho.");
    } finally {
      setBulkDeleting(false);
    }
  }

  const allFilteredSelected =
    filteredStock.length > 0 && filteredStock.every((s) => selectedStockIds.has(s.id));

  const stockColumns: Column<StockLevel>[] = [
    {
      key: "id",
      title: "✓",
      align: "center",
      render: (_, row) => (
        <input
          type="checkbox"
          checked={selectedStockIds.has(row.id)}
          onChange={(e) => {
            e.stopPropagation();
            toggleSelectStock(row.id);
          }}
          aria-label={`Chọn ${row.productCode}`}
          className="h-3.5 w-3.5 cursor-pointer rounded border-slate-300 text-sky-600 focus:ring-sky-500"
        />
      ),
    },
    { key: "productCode", title: "Mã SP XHĐ", sortable: true },
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
      title: "Tồn thực tế",
      sortable: true,
      align: "right",
      render: (val, row) => (
        <div className="flex flex-col items-end">
          <span className="font-semibold text-gray-900">{formatNumber(val as number)}</span>
          {row.lockedQuantity ? (
             <span title="Hàng bị khóa do thừa chứng từ chờ xử lý bù trừ" className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded flex items-center gap-1 mt-1 cursor-help whitespace-nowrap">
               🔒 Khóa {formatNumber(row.lockedQuantity)}
             </span>
          ) : null}
        </div>
      ),
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
  const filteredLedger = ledgerEntriesState.filter((e) => typeFilter === "Tất cả" || e.type === typeFilter);
  const filteredLotDetails = lotDetails
    .filter((lot) => lotProductFilter === "Tất cả" || lot.product_code === lotProductFilter)
    .filter((lot) => !lotWarehouseFilter || lot.warehouse_id === lotWarehouseFilter);

  function exportStock() {
    downloadExcel(filteredStock.map((stock) => ({
      "Mã SP XHĐ": stock.productCode,
      "Sản phẩm": stock.productName,
      "Danh mục": stock.category,
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
      "Mã SP XHĐ": entry.productCode,
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
      "Mã SP XHĐ": lot.product_code,
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
        subtitle="Bảng tồn kho theo Mã SP XHĐ, quản lý Lô HSD (FEFO), Vị trí kho và Nhật ký giao dịch"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleDownloadOpeningTemplate()}
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <Download size={14} /> Tải mẫu Tồn đầu kỳ
            </button>
            <button
              type="button"
              onClick={() => {
                setUploadWarehouseId(warehouseOptions[0]?.id ?? "");
                setUploadMode("ADD");
                setUploadFile(null);
                setUploadOpeningError("");
                setUploadWarnings([]);
                setUploadOpen(true);
              }}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white px-3 py-2 text-xs font-semibold transition-colors"
            >
              <Upload size={14} /> Upload Tồn đầu kỳ
            </button>
            <button onClick={openAdjust} className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-700 text-white px-3 py-2 rounded-lg text-xs font-semibold transition-colors">
              <SlidersHorizontal size={14} />
              Điều chỉnh tồn
            </button>
          </div>
        }
      />

      {toastMsg && (
        <div className="flex items-center justify-between rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-xs font-semibold text-emerald-800">
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 size={15} className="text-emerald-600" /> {toastMsg}
          </span>
          <button type="button" onClick={() => setToastMsg("")} className="text-emerald-700 hover:text-emerald-900">
            <X size={14} />
          </button>
        </div>
      )}
      {loadError && <div className="bg-red-50 text-red-700 rounded-xl px-4 py-3 text-sm">{loadError}</div>}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard
          label="Số lượng tồn kho"
          value={formatNumber(totalStockQuantity)}
          sub={categoryFilter !== "Tất cả" ? `Theo: ${categoryFilter}` : "Toàn bộ kho"}
          icon={<Package size={20} />}
          color="bg-blue-50 text-blue-600"
        />
        <StatCard
          label="Tổng SKU"
          value={filteredStock.length}
          sub={categoryFilter !== "Tất cả" ? "Đang lọc danh mục" : undefined}
          icon={<Boxes size={20} />}
          color="bg-purple-50 text-purple-600"
        />
        <StatCard
          label="Giá trị tồn kho"
          value={formatVND(totalValue)}
          icon={<CircleDollarSign size={20} />}
          color="bg-sky-50 text-sky-600"
        />
        <StatCard
          label="SKU thiếu (≤ điểm đặt lại)"
          value={lowStock}
          icon={<TriangleAlert size={20} />}
          color="bg-amber-50 text-amber-600"
        />
        <StatCard
          label="Giao dịch hôm nay"
          value={todayTx}
          icon={<ArrowDownUp size={20} />}
          color="bg-emerald-50 text-emerald-600"
        />
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
        <div className="space-y-2.5">
          {selectedStockIds.size > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-900">
              <div className="flex flex-wrap items-center gap-2">
                <span>
                  Đã chọn <strong>{formatNumber(selectedStockIds.size)}</strong> sản phẩm
                </span>
                {!allFilteredSelected && (
                  <button
                    type="button"
                    onClick={selectAllFilteredStock}
                    className="rounded border border-sky-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-sky-700 hover:bg-sky-100"
                  >
                    Chọn tất cả {formatNumber(filteredStock.length)} sản phẩm
                  </button>
                )}
                <button
                  type="button"
                  onClick={clearSelectedStock}
                  className="text-[11px] font-semibold text-slate-600 underline hover:text-slate-800"
                >
                  Bỏ chọn
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  setBulkDeleteWarehouseId("");
                  setBulkDeleteError("");
                  setBulkDeleteOpen(true);
                }}
                className="inline-flex items-center gap-1 rounded bg-red-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-red-800"
              >
                <Trash2 size={12} /> Xóa tồn đã chọn ({selectedStockIds.size})
              </button>
            </div>
          )}
          <DataTable
            data={filteredStock}
            columns={stockColumns}
            searchKeys={["productCode", "productName", "category", "locations", "earliestExpiry"]}
            searchPlaceholder="Tìm Mã SP XHĐ, tên sản phẩm, vị trí..."
            toolbar={
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={allFilteredSelected ? clearSelectedStock : selectAllFilteredStock}
                  disabled={filteredStock.length === 0}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                >
                  {allFilteredSelected ? "Bỏ chọn tất cả" : `Chọn tất cả (${filteredStock.length})`}
                </button>
                <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
                  <option value="Tất cả">Tất cả danh mục</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <button onClick={exportStock} disabled={!filteredStock.length} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 disabled:opacity-50">
                  <Download size={15} />Tải Excel
                </button>
              </div>
            }
          />
        </div>
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
            { key: "product_code", title: "Mã SP XHĐ", sortable: true },
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

      {/* MODAL UPLOAD EXCEL TỒN ĐẦU KỲ (Chuẩn CreateOrderForm) */}
      {uploadOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => {
            if (!uploadingOpening) setUploadOpen(false);
          }}
        >
          <div
            className="w-full max-w-xl border border-slate-400 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between bg-[#14263d] px-3 py-2 text-white">
              <div className="flex items-center gap-2">
                <Upload size={17} className="text-red-500" />
                <h2 className="text-xs font-bold uppercase tracking-wide text-white">
                  Upload Excel Khởi Tạo Tồn Kho Đầu Kỳ (Theo Mã SP XHĐ)
                </h2>
              </div>
              <button
                type="button"
                disabled={uploadingOpening}
                onClick={() => setUploadOpen(false)}
                className="rounded p-1 text-white hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </header>

            <div className="space-y-3 border-b border-slate-200 px-3 py-3">
              <div className="rounded border border-sky-200 bg-sky-50/70 px-2.5 py-2 text-[11px] text-sky-900">
                File mẫu gồm các cột: <strong>Mã SP XHĐ</strong>, <strong>Vị trí kho</strong> (tự tạo nếu chưa có), <strong>Số lô</strong>, <strong>Hạn sử dụng</strong> (VD: <code>31/12/2026</code>), <strong>Số lượng tồn đầu</strong>.
              </div>

              {uploadOpeningError && (
                <div className="flex items-center gap-2 rounded border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
                  <AlertTriangle size={14} className="shrink-0 text-red-600" />
                  <span>{uploadOpeningError}</span>
                </div>
              )}

              {uploadWarnings.length > 0 && (
                <div className="max-h-28 overflow-y-auto rounded border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900 space-y-0.5">
                  <div className="font-bold">Một số dòng bị bỏ qua:</div>
                  {uploadWarnings.map((w, i) => (
                    <div key={i}>• {w}</div>
                  ))}
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                    Kho khởi tạo tồn đầu <span className="text-red-600">*</span>
                  </label>
                  <select
                    value={uploadWarehouseId}
                    onChange={(e) => setUploadWarehouseId(e.target.value ? Number(e.target.value) : "")}
                    className="w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  >
                    <option value="">-- Chọn kho --</option>
                    {warehouseOptions.map((w) => (
                      <option key={w.id} value={w.id}>
                        [{w.code}] {w.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                    Chế độ nạp tồn kho
                  </label>
                  <select
                    value={uploadMode}
                    onChange={(e) => setUploadMode(e.target.value as "ADD" | "REPLACE")}
                    className="w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  >
                    <option value="ADD">Cộng dồn vào tồn hiện có (Khuyên dùng)</option>
                    <option value="REPLACE">Ghi đè (Xóa tồn cũ của các mã trong file rồi nạp mới)</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-dashed border-slate-300 bg-slate-50 p-3">
                <input
                  ref={openingFileRef}
                  type="file"
                  accept=".xlsx,.xlsm,.xls"
                  onChange={(e) => {
                    setUploadFile(e.target.files?.[0] ?? null);
                    setUploadOpeningError("");
                  }}
                  className="text-xs file:mr-2 file:rounded file:border-0 file:bg-sky-600 file:px-2.5 py-1 file:text-xs file:font-semibold file:text-white hover:file:bg-sky-700"
                />
                <button
                  type="button"
                  onClick={() => void handleDownloadOpeningTemplate()}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700 underline hover:text-sky-900"
                >
                  <Download size={13} /> Tải file Excel mẫu
                </button>
              </div>
            </div>

            <footer className="flex items-center justify-between gap-3 border-t border-slate-300 bg-slate-100 px-3 py-2">
              <span className="text-[10px] text-slate-500">
                {uploadFile ? `Đã chọn: ${uploadFile.name}` : "Chưa chọn file Excel"}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={uploadingOpening}
                  onClick={() => setUploadOpen(false)}
                  className="rounded bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800"
                >
                  Đóng
                </button>
                <button
                  type="button"
                  disabled={uploadingOpening || !uploadFile || !uploadWarehouseId}
                  onClick={() => void handleUploadOpeningStock()}
                  className="inline-flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {uploadingOpening ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                  Xác nhận khởi tạo tồn
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}

      {/* MODAL XÁC NHẬN XÓA TỒN KHO HÀNG LOẠT (Chuẩn CreateOrderForm) */}
      {bulkDeleteOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => {
            if (!bulkDeleting) setBulkDeleteOpen(false);
          }}
        >
          <div
            className="w-full max-w-md border border-slate-400 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between bg-[#14263d] px-3 py-2 text-white">
              <div className="flex items-center gap-2">
                <Trash2 size={17} className="text-red-500" />
                <h2 className="text-xs font-bold uppercase tracking-wide text-white">
                  Xác Nhận Xóa Tồn Kho ({selectedStockIds.size} Sản Phẩm)
                </h2>
              </div>
              <button
                type="button"
                disabled={bulkDeleting}
                onClick={() => setBulkDeleteOpen(false)}
                className="rounded p-1 text-white hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </header>

            <div className="space-y-2.5 border-b border-slate-200 px-3 py-3 text-xs text-slate-700">
              <p>
                Bạn có chắc muốn đưa tồn kho về <strong>0</strong> cho{" "}
                <strong>{selectedStockIds.size} sản phẩm</strong> đã chọn? Các lô đang được giữ chỗ bởi phiếu xuất chưa hoàn tất sẽ tự động được bảo vệ (không xóa).
              </p>

              <div>
                <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                  Phạm vi kho cần xóa tồn
                </label>
                <select
                  value={bulkDeleteWarehouseId}
                  onChange={(e) => setBulkDeleteWarehouseId(e.target.value ? Number(e.target.value) : "")}
                  className="w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                >
                  <option value="">Tất cả các kho</option>
                  {warehouseOptions.map((w) => (
                    <option key={w.id} value={w.id}>
                      Chỉ kho [{w.code}] {w.name}
                    </option>
                  ))}
                </select>
              </div>

              {bulkDeleteError && (
                <div className="flex items-center gap-1.5 rounded border border-red-300 bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
                  <AlertTriangle size={13} className="shrink-0" />
                  <span>{bulkDeleteError}</span>
                </div>
              )}
            </div>

            <footer className="flex items-center justify-between gap-3 border-t border-slate-300 bg-slate-100 px-3 py-2">
              <span className="text-[10px] text-slate-500">
                * Thao tác được ghi nhận vào Sổ nhật ký kho.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={bulkDeleting}
                  onClick={() => setBulkDeleteOpen(false)}
                  className="rounded bg-slate-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-600"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  disabled={bulkDeleting}
                  onClick={() => void handleConfirmBulkDelete()}
                  className="inline-flex items-center gap-1.5 rounded bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800 disabled:bg-slate-300"
                >
                  {bulkDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  Xác nhận xóa tồn
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
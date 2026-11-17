"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Package,
  Plus,
  Download,
  Upload,
  Pencil,
  Trash2,
  RefreshCw,
  Search,
  X,
  Check,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Eye,
  RotateCcw,
  FileSpreadsheet,
  ChevronLeft,
  ChevronRight,
  Layers,
  Building2,
  FileText,
} from "lucide-react";
import AuthenticatedDownloadLink from "@/components/ui/AuthenticatedDownloadLink";
import { formatNumber, formatUnitPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { API_URL, apiFetch } from "@/lib/api";
import { downloadExcel } from "@/lib/excel";

const inputCls =
  "w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-100";

type CategoryOption = {
  id: number;
  code?: string | null;
  name: string;
};

type UnitOption = {
  id: number;
  code?: string | null;
  name: string;
};

type ApiProductItem = {
  id: number;
  sku: string;
  name: string;
  category_id: number;
  category_code?: string | null;
  category_name?: string | null;
  unit_id: number;
  unit_code?: string | null;
  unit_name?: string | null;
  supplier?: string | null;
  base_price: number;
  cost_price: number;
  boxes_per_carton: number;
  reorder_level?: number;
  status: string;
  npp_code?: string | null;
  representative_sku?: string | null;
  representative_name?: string | null;
  order_count?: number;
  total_ordered_qty?: number;
  purchase_invoice_count?: number;
  total_purchased_qty?: number;
  sync_source?: string;
  distributors?: ProductDistributor[];
};

type ProductDistributor = {
  code: string;
  name: string;
};

type ProductRow = {
  id: number;
  code: string;
  nppCode: string;
  name: string;
  category_id: number;
  categoryCode: string;
  category: string;
  unit_id: number;
  unitCode: string;
  unit: string;
  supplier: string;
  price: number;
  cost_price: number;
  boxes_per_carton: number;
  reorder_level: number;
  status: string;
  representative_sku: string;
  representative_name: string;
  order_count: number;
  total_ordered_qty: number;
  purchase_invoice_count: number;
  total_purchased_qty: number;
  sync_source: "ORDER_SYNC" | "PURCHASE_INVOICE" | "DMS_AND_CQT" | "MANUAL";
  distributors: ProductDistributor[];
};

type SortField =
  | "code"
  | "nppCode"
  | "name"
  | "category"
  | "unit"
  | "boxes_per_carton"
  | "supplier"
  | "price"
  | "cost_price"
  | "activity";

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

export default function ProductsPage() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Bộ lọc tra cứu
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("ALL");
  const [distributorFilter, setDistributorFilter] = useState<string>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [supplierFilter, setSupplierFilter] = useState<string>("ALL");
  const [unitFilter, setUnitFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  // Sắp xếp & Phân trang
  const [sortField, setSortField] = useState<SortField>("code");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [pageSize, setPageSize] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Chọn dòng & Modal
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductRow | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; code: string; name: string } | null>(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);

  // Chỉnh sửa nhanh inline Mã NPP trực tiếp trên bảng
  const [editingNppId, setEditingNppId] = useState<number | null>(null);
  const [inlineNppCode, setInlineNppCode] = useState<string>("");
  const [savingNppId, setSavingNppId] = useState<number | null>(null);

  const [form, setForm] = useState({
    sku: "",
    npp_code: "",
    name: "",
    category_id: "",
    unit_id: "",
    supplier: "Vinamilk",
    base_price: "0",
    cost_price: "0",
    boxes_per_carton: "1",
    reorder_level: "20",
    status: "active",
  });

  const [editForm, setEditForm] = useState({
    sku: "",
    npp_code: "",
    name: "",
    category_id: "",
    unit_id: "",
    supplier: "",
    base_price: "0",
    cost_price: "0",
    boxes_per_carton: "1",
    reorder_level: "20",
    status: "active",
  });

  const [bannerMsg, setBannerMsg] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);
  const [modalError, setModalError] = useState("");

  const fileInput = useRef<HTMLInputElement>(null);

  const loadCatalog = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const [categoryResponse, unitResponse, productResponse] = await Promise.all([
        apiFetch(`${API_URL}/products/categories/`),
        apiFetch(`${API_URL}/products/units/`),
        apiFetch(`${API_URL}/products/?limit=10000`),
      ]);
      if (!categoryResponse.ok || !unitResponse.ok || !productResponse.ok) {
        throw new Error("Không thể tải danh mục ngành hàng, đơn vị tính và danh sách SKU.");
      }
      const loadedCategories = (await categoryResponse.json()) as CategoryOption[];
      const loadedUnits = (await unitResponse.json()) as UnitOption[];
      const loadedProducts = (await productResponse.json()) as ApiProductItem[];

      setCategories(loadedCategories);
      setUnits(loadedUnits);

      const catById = new Map(loadedCategories.map((c) => [c.id, c]));
      const unitById = new Map(loadedUnits.map((u) => [u.id, u]));

      const mappedRows: ProductRow[] = loadedProducts.map((product) => {
        const catObj = catById.get(product.category_id);
        const unitObj = unitById.get(product.unit_id);
        const rawSource = (product.sync_source || "MANUAL").toUpperCase();
        const syncSource: ProductRow["sync_source"] =
          rawSource === "DMS_AND_CQT" || rawSource === "ORDER_SYNC" || rawSource === "PURCHASE_INVOICE"
            ? rawSource
            : "MANUAL";

        return {
          id: product.id,
          code: product.sku,
          nppCode: product.npp_code || "",
          name: product.name,
          category_id: product.category_id,
          categoryCode: product.category_code || catObj?.code || "",
          category: product.category_name || catObj?.name || "Chưa phân loại",
          unit_id: product.unit_id,
          unitCode: product.unit_code || unitObj?.code || "",
          unit: product.unit_name || unitObj?.name || "Hộp",
          supplier: (product.supplier || "Vinamilk").trim(),
          price: Number(product.base_price ?? 0),
          cost_price: Number(product.cost_price ?? 0),
          boxes_per_carton: Math.max(1, Number(product.boxes_per_carton ?? 1)),
          reorder_level: Number(product.reorder_level ?? 20),
          status: product.status || "active",
          representative_sku: product.representative_sku || "",
          representative_name: product.representative_name || "",
          order_count: Number(product.order_count ?? 0),
          total_ordered_qty: Number(product.total_ordered_qty ?? 0),
          purchase_invoice_count: Number(product.purchase_invoice_count ?? 0),
          total_purchased_qty: Number(product.total_purchased_qty ?? 0),
          sync_source: syncSource,
          distributors: product.distributors ?? [],
        };
      });

      setProducts(mappedRows);
      setForm((prev) => ({
        ...prev,
        category_id: prev.category_id || String(loadedCategories[0]?.id ?? "1"),
        unit_id: prev.unit_id || String(loadedUnits[0]?.id ?? "1"),
      }));
    } catch (loadErr) {
      setBannerMsg({
        type: "error",
        text: loadErr instanceof Error ? loadErr.message : "Không thể tải dữ liệu danh sách SKU.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog(true);
  }, [loadCatalog]);

  async function handleSyncFromSystem() {
    setSyncing(true);
    setBannerMsg({
      type: "info",
      text: "Đang quét và đồng bộ mã sản phẩm (SKU), tên sản phẩm, ĐVT, đơn giá từ Đơn hàng DMS & Hóa đơn mua vào CQT...",
    });
    try {
      const response = await apiFetch(`${API_URL}/products/sync-from-system`, {
        method: "POST",
      });
      const result = (await response.json()) as {
        added?: number;
        updated?: number;
        total_products?: number;
        from_orders?: number;
        from_purchase_invoices?: number;
        detail?: string;
      };
      if (!response.ok) {
        throw new Error(result.detail ?? "Không thể đồng bộ SKU từ hệ thống.");
      }
      await loadCatalog(false);
      setBannerMsg({
        type: "success",
        text: `Đồng bộ hoàn tất: Tổng ${result.total_products ?? 0} SKU trong hệ thống (Quét ${result.from_orders ?? 0} mã từ Đơn hàng DMS, ${result.from_purchase_invoices ?? 0} mã từ Hóa đơn CQT · Thêm mới ${result.added ?? 0} SKU, cập nhật ${result.updated ?? 0} SKU).`,
      });
    } catch (err) {
      setBannerMsg({
        type: "error",
        text: err instanceof Error ? err.message : "Lỗi khi đồng bộ SKU từ hệ thống.",
      });
    } finally {
      setSyncing(false);
    }
  }

  async function uploadProducts(file: File) {
    setSyncing(true);
    setBannerMsg(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await apiFetch(`${API_URL}/products/upload`, {
        method: "POST",
        body,
      });
      const result = (await response.json()) as {
        imported?: number;
        updated?: number;
        representative_updated?: number;
        detail?: string;
      };
      if (!response.ok) {
        throw new Error(result.detail ?? "Không thể nhập danh sách SKU từ file Excel.");
      }
      await loadCatalog(false);
      setBannerMsg({
        type: "success",
        text: `Nhập file Excel thành công: Đã thêm mới ${result.imported ?? 0} SKU, cập nhật ${result.updated ?? 0} SKU và xử lý ${result.representative_updated ?? 0} liên kết đại diện.`,
      });
    } catch (uploadErr) {
      setBannerMsg({
        type: "error",
        text: uploadErr instanceof Error ? uploadErr.message : "Không thể tải lên file Excel.",
      });
    } finally {
      setSyncing(false);
    }
  }

  async function createProduct(e: React.FormEvent) {
    e.preventDefault();
    setModalError("");
    if (!form.sku.trim() || !form.name.trim()) {
      setModalError("Mã SKU và Tên sản phẩm là bắt buộc.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await apiFetch(`${API_URL}/products/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: form.sku.trim().toUpperCase(),
          npp_code: form.npp_code.trim().toUpperCase() || null,
          name: form.name.trim(),
          category_id: Number(form.category_id || categories[0]?.id || 1),
          unit_id: Number(form.unit_id || units[0]?.id || 1),
          supplier: form.supplier.trim() || "Vinamilk",
          base_price: Number(form.base_price) || 0,
          cost_price: Number(form.cost_price) || 0,
          boxes_per_carton: Math.max(1, Number(form.boxes_per_carton) || 1),
          reorder_level: Math.max(0, Number(form.reorder_level) || 20),
          status: form.status || "active",
        }),
      });
      const result = (await response.json()) as { detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "Không thể tạo mới SKU.");
      setCreateOpen(false);
      await loadCatalog(false);
      setBannerMsg({
        type: "success",
        text: `Đã thêm mới mã sản phẩm ${form.sku.trim().toUpperCase()} - ${form.name.trim()} thành công.`,
      });
    } catch (err) {
      setModalError(err instanceof Error ? err.message : "Không thể tạo SKU.");
    } finally {
      setSubmitting(false);
    }
  }

  async function updateProduct(e: React.FormEvent) {
    e.preventDefault();
    setModalError("");
    if (!editingProduct) return;
    if (!editForm.sku.trim() || !editForm.name.trim()) {
      setModalError("Mã SKU và Tên sản phẩm không được để trống.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await apiFetch(`${API_URL}/products/${editingProduct.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: editForm.sku.trim().toUpperCase(),
          npp_code: editForm.npp_code.trim().toUpperCase() || null,
          name: editForm.name.trim(),
          category_id: Number(editForm.category_id),
          unit_id: Number(editForm.unit_id),
          supplier: editForm.supplier.trim() || null,
          base_price: Number(editForm.base_price) || 0,
          cost_price: Number(editForm.cost_price) || 0,
          boxes_per_carton: Math.max(1, Number(editForm.boxes_per_carton) || 1),
          reorder_level: Math.max(0, Number(editForm.reorder_level) || 20),
          status: editForm.status,
        }),
      });
      const result = (await response.json()) as { detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "Không thể cập nhật SKU.");
      setEditOpen(false);
      setEditingProduct(null);
      await loadCatalog(false);
      setBannerMsg({
        type: "success",
        text: `Đã cập nhật thông tin SKU ${editForm.sku.trim().toUpperCase()} thành công.`,
      });
    } catch (err) {
      setModalError(err instanceof Error ? err.message : "Không thể cập nhật SKU.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveNppCode(product: ProductRow, newNppCode: string) {
    const formatted = newNppCode.trim().toUpperCase();
    if (formatted === (product.nppCode || "")) {
      setEditingNppId(null);
      return;
    }
    setSavingNppId(product.id);
    try {
      const res = await apiFetch(`${API_URL}/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: product.code,
          npp_code: formatted || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Không thể cập nhật Mã NPP.");
      }
      setProducts((prev) =>
        prev.map((p) => (p.id === product.id ? { ...p, nppCode: formatted } : p))
      );
      setBannerMsg({
        type: "success",
        text: `Đã cập nhật Mã NPP cho sản phẩm ${product.code} thành "${formatted || "(trống)"}".`,
      });
      setEditingNppId(null);
    } catch (err) {
      setBannerMsg({
        type: "error",
        text: err instanceof Error ? err.message : "Lỗi khi cập nhật Mã NPP.",
      });
    } finally {
      setSavingNppId(null);
    }
  }

  async function deleteProduct(productId: number, skuCode: string) {
    setSubmitting(true);
    try {
      const response = await apiFetch(`${API_URL}/products/${productId}`, {
        method: "DELETE",
      });
      const result = (await response.json().catch(() => ({}))) as { detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "Không thể xóa SKU.");
      setDeleteConfirm(null);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(productId);
        return next;
      });
      await loadCatalog(false);
      setBannerMsg({
        type: "success",
        text: `Đã xóa mã sản phẩm ${skuCode} khỏi danh mục.`,
      });
    } catch (err) {
      setBannerMsg({
        type: "error",
        text: err instanceof Error ? err.message : "Không thể xóa SKU.",
      });
      setDeleteConfirm(null);
    } finally {
      setSubmitting(false);
    }
  }

  async function bulkDeleteProducts() {
    if (selectedIds.size === 0) return;
    setSubmitting(true);
    try {
      const response = await apiFetch(`${API_URL}/products/bulk-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Array.from(selectedIds)),
      });
      const result = (await response.json().catch(() => ({}))) as {
        deleted?: number;
        detail?: string;
      };
      if (!response.ok) throw new Error(result.detail ?? "Không thể xóa các SKU đã chọn.");
      const count = result.deleted ?? selectedIds.size;
      setBulkDeleteConfirm(false);
      setSelectedIds(new Set());
      await loadCatalog(false);
      setBannerMsg({
        type: "success",
        text: `Đã xóa thành công ${count} mã sản phẩm đã chọn.`,
      });
    } catch (err) {
      setBannerMsg({
        type: "error",
        text: err instanceof Error ? err.message : "Không thể xóa hàng loạt SKU.",
      });
      setBulkDeleteConfirm(false);
    } finally {
      setSubmitting(false);
    }
  }

  function openCreateModal() {
    setModalError("");
    setForm({
      sku: "",
      npp_code: "",
      name: "",
      category_id: String(categories[0]?.id ?? "1"),
      unit_id: String(units[0]?.id ?? "1"),
      supplier: supplierOptions[0]?.name || "Vinamilk",
      base_price: "0",
      cost_price: "0",
      boxes_per_carton: "1",
      reorder_level: "20",
      status: "active",
    });
    setCreateOpen(true);
  }

  function openEditModal(product: ProductRow) {
    setModalError("");
    setEditingProduct(product);
    setEditForm({
      sku: product.code,
      npp_code: product.nppCode || "",
      name: product.name,
      category_id: String(product.category_id),
      unit_id: String(product.unit_id),
      supplier: product.supplier,
      base_price: String(product.price),
      cost_price: String(product.cost_price),
      boxes_per_carton: String(product.boxes_per_carton),
      reorder_level: String(product.reorder_level),
      status: product.status,
    });
    setEditOpen(true);
  }

  // Danh sách Nhà cung cấp động kèm số lượng SKU
  const supplierOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of products) {
      const sup = (p.supplier || "Chưa xác định").trim();
      counts.set(sup, (counts.get(sup) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "vi"));
  }, [products]);

  const distributorOptions = useMemo(() => {
    const options = new Map<string, { name: string; count: number }>();
    for (const product of products) {
      for (const distributor of product.distributors) {
        const existing = options.get(distributor.code);
        options.set(distributor.code, {
          name: distributor.name,
          count: (existing?.count ?? 0) + 1,
        });
      }
    }
    return Array.from(options, ([code, value]) => ({ code, ...value }))
      .sort((a, b) => a.name.localeCompare(b.name, "vi"));
  }, [products]);

  // Số lượng SKU theo danh mục
  const categoryCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const p of products) {
      counts.set(p.category_id, (counts.get(p.category_id) || 0) + 1);
    }
    return counts;
  }, [products]);

  // Thống kê tổng quan
  const stats = useMemo(() => {
    let activeCount = 0;
    let fromOrdersCount = 0;
    let fromPurchaseCount = 0;
    let pricedCount = 0;
    for (const p of products) {
      if (p.status === "active") activeCount++;
      if (p.sync_source === "ORDER_SYNC" || p.sync_source === "DMS_AND_CQT") fromOrdersCount++;
      if (p.sync_source === "PURCHASE_INVOICE" || p.sync_source === "DMS_AND_CQT") fromPurchaseCount++;
      if (p.price > 0 || p.cost_price > 0) pricedCount++;
    }
    return {
      total: products.length,
      activeCount,
      fromOrdersCount,
      fromPurchaseCount,
      pricedCount,
      zeroPriceCount: products.length - pricedCount,
      supplierCount: supplierOptions.length,
    };
  }, [products, supplierOptions]);

  // Lọc và sắp xếp danh sách sản phẩm
  const filteredProducts = useMemo(() => {
    const q = normalizeSearchText(searchQuery.trim());
    const filtered = products.filter((p) => {
      if (sourceFilter === "SYNCED_ALL" && p.sync_source === "MANUAL") return false;
      if (sourceFilter === "ORDER_SYNC" && p.sync_source !== "ORDER_SYNC" && p.sync_source !== "DMS_AND_CQT") {
        return false;
      }
      if (
        sourceFilter === "PURCHASE_INVOICE" &&
        p.sync_source !== "PURCHASE_INVOICE" &&
        p.sync_source !== "DMS_AND_CQT"
      ) {
        return false;
      }
      if (sourceFilter === "MANUAL" && p.sync_source !== "MANUAL") return false;

      if (distributorFilter !== "ALL" && !p.distributors.some((distributor) => distributor.code === distributorFilter)) {
        return false;
      }
      if (categoryFilter !== "ALL" && String(p.category_id) !== categoryFilter) return false;
      if (supplierFilter !== "ALL" && p.supplier !== supplierFilter) return false;
      if (unitFilter !== "ALL" && p.unit !== unitFilter) return false;

      if (statusFilter === "active" && p.status !== "active") return false;
      if (statusFilter === "inactive" && p.status !== "inactive") return false;
      if (statusFilter === "HAS_PRICE" && p.price <= 0 && p.cost_price <= 0) return false;
      if (statusFilter === "ZERO_PRICE" && (p.price > 0 || p.cost_price > 0)) return false;

      if (q) {
        const haystack = normalizeSearchText(
          `${p.code} ${p.nppCode} ${p.name} ${p.supplier} ${p.category} ${p.unit} ${p.representative_sku} ${p.distributors.map((distributor) => `${distributor.code} ${distributor.name}`).join(" ")}`
        );
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      let cmp = 0;
      if (sortField === "code") cmp = a.code.localeCompare(b.code, "vi");
      else if (sortField === "nppCode") cmp = a.nppCode.localeCompare(b.nppCode, "vi");
      else if (sortField === "name") cmp = a.name.localeCompare(b.name, "vi");
      else if (sortField === "category") cmp = a.category.localeCompare(b.category, "vi");
      else if (sortField === "unit") cmp = a.unit.localeCompare(b.unit, "vi");
      else if (sortField === "boxes_per_carton") cmp = a.boxes_per_carton - b.boxes_per_carton;
      else if (sortField === "supplier") cmp = a.supplier.localeCompare(b.supplier, "vi");
      else if (sortField === "price") cmp = a.price - b.price;
      else if (sortField === "cost_price") cmp = a.cost_price - b.cost_price;
      else if (sortField === "activity") {
        cmp =
          a.order_count +
          a.purchase_invoice_count -
          (b.order_count + b.purchase_invoice_count);
      }
      return sortOrder === "asc" ? cmp : -cmp;
    });

    return filtered;
  }, [
    products,
    searchQuery,
    sourceFilter,
    distributorFilter,
    categoryFilter,
    supplierFilter,
    unitFilter,
    statusFilter,
    sortField,
    sortOrder,
  ]);

  // Reset trang khi đổi bộ lọc
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, sourceFilter, distributorFilter, categoryFilter, supplierFilter, unitFilter, statusFilter, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pagedProducts = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredProducts.slice(start, start + pageSize);
  }, [filteredProducts, safePage, pageSize]);

  const filteredTotals = useMemo(() => {
    let totalOrderedQty = 0;
    let totalPurchasedQty = 0;
    let withPriceCount = 0;
    for (const p of filteredProducts) {
      totalOrderedQty += p.total_ordered_qty;
      totalPurchasedQty += p.total_purchased_qty;
      if (p.price > 0) withPriceCount++;
    }
    return {
      totalOrderedQty,
      totalPurchasedQty,
      withPriceCount,
    };
  }, [filteredProducts]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortOrder(field === "price" || field === "cost_price" || field === "activity" ? "desc" : "asc");
    }
  }

  function renderSortIcon(field: SortField) {
    if (sortField !== field) return <ArrowUpDown size={11} className="text-slate-400" />;
    return sortOrder === "asc" ? (
      <ArrowUp size={11} className="text-sky-700" />
    ) : (
      <ArrowDown size={11} className="text-sky-700" />
    );
  }

  function toggleSelectProduct(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectPage() {
    const pageIds = pagedProducts.map((p) => p.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        pageIds.forEach((id) => next.delete(id));
      } else {
        pageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  function resetFilters() {
    setSearchQuery("");
    setSourceFilter("ALL");
    setDistributorFilter("ALL");
    setCategoryFilter("ALL");
    setSupplierFilter("ALL");
    setUnitFilter("ALL");
    setStatusFilter("ALL");
  }

  function exportProducts() {
    if (filteredProducts.length === 0) return;
    downloadExcel(
      filteredProducts.map((product, index) => ({
        STT: index + 1,
        "Mã SKU": product.code,
        "Mã NPP nội bộ": product.nppCode || product.code,
        "Nhà phân phối": product.distributors.map((distributor) => `${distributor.code} - ${distributor.name}`).join(" / "),
        "Tên sản phẩm": product.name,
        "Mã danh mục": product.categoryCode,
        "Danh mục ngành hàng": product.category,
        ĐVT: product.unit,
        "Quy cách (Hộp/Thùng)": product.boxes_per_carton,
        "Nhà cung cấp": product.supplier,
        "Nguồn đồng bộ":
          product.sync_source === "DMS_AND_CQT"
            ? "Đơn hàng DMS & HĐ CQT"
            : product.sync_source === "ORDER_SYNC"
            ? "Đơn hàng DMS"
            : product.sync_source === "PURCHASE_INVOICE"
            ? "Hóa đơn mua vào CQT"
            : "Tạo thủ công",
        "Số đơn DMS": product.order_count,
        "Tổng SL bán DMS": product.total_ordered_qty,
        "Số HĐ mua vào CQT": product.purchase_invoice_count,
        "Giá bán (VNĐ)": product.price,
        "Giá vốn / Giá nhập (VNĐ)": product.cost_price,
        "Trạng thái": product.status === "active" ? "Đang kinh doanh" : "Ngừng kinh doanh",
      })),
      `Danh_sach_SKU_${new Date().toISOString().slice(0, 10)}`,
      "Danh sách SKU"
    );
  }

  const allPageChecked =
    pagedProducts.length > 0 && pagedProducts.every((p) => selectedIds.has(p.id));

  return (
    <div className="space-y-3">
      {/* KHUNG CHÍNH CHUẨN ENTERPRISE (CreateOrderForm Standard) */}
      <div className="border border-slate-400 bg-white shadow-lg">
        {/* 1. HEADER MODAL / FORM */}
        <header className="bg-[#14263d] px-3 py-2 text-white flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Package size={17} className="text-red-500" />
            <h1 className="text-xs font-bold uppercase tracking-wide text-white">
              Danh Mục Hàng Hóa & Mã Sản Phẩm Đồng Bộ Hệ Thống (SKU)
            </h1>
            <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-sky-200">
              {stats.total} SKU
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={handleSyncFromSystem}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 rounded bg-sky-600 hover:bg-sky-700 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:bg-slate-400"
              title="Quét và lấy toàn bộ mã sản phẩm, tên sản phẩm từ Đơn hàng DMS & Hóa đơn mua vào CQT"
            >
              {syncing ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <RefreshCw size={13} />
              )}
              Đồng bộ SKU từ hệ thống
            </button>

            <AuthenticatedDownloadLink
              href={`${API_URL}/products/template`}
              className="inline-flex items-center gap-1 rounded bg-white/10 hover:bg-white/20 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors"
            >
              <Download size={12} />
              Mẫu Excel
            </AuthenticatedDownloadLink>

            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={syncing}
              className="inline-flex items-center gap-1 rounded bg-white/10 hover:bg-white/20 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors disabled:opacity-50"
            >
              <Upload size={12} />
              Nhập Excel
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,.xlsm"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadProducts(file);
                event.target.value = "";
              }}
            />

            <button
              type="button"
              onClick={exportProducts}
              disabled={filteredProducts.length === 0}
              className="inline-flex items-center gap-1 rounded bg-white/10 hover:bg-white/20 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors disabled:opacity-50"
            >
              <FileSpreadsheet size={12} />
              Xuất Excel ({filteredProducts.length})
            </button>

            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center gap-1 rounded bg-emerald-600 hover:bg-emerald-700 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors"
            >
              <Plus size={13} />
              Thêm mới SKU
            </button>
          </div>
        </header>

        {/* THÔNG BÁO TRẠNG THÁI */}
        {bannerMsg && (
          <div
            role="alert"
            className={cn(
              "mx-3 mt-2 flex items-center justify-between gap-2 border px-3 py-1.5 text-xs",
              bannerMsg.type === "error"
                ? "border-red-300 bg-red-50 text-red-800"
                : bannerMsg.type === "success"
                ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                : "border-sky-300 bg-sky-50 text-sky-800"
            )}
          >
            <div className="flex items-center gap-2">
              {bannerMsg.type === "error" ? (
                <AlertTriangle size={14} className="shrink-0 text-red-600" />
              ) : bannerMsg.type === "success" ? (
                <CheckCircle2 size={14} className="shrink-0 text-emerald-600" />
              ) : (
                <Loader2 size={14} className="shrink-0 animate-spin text-sky-600" />
              )}
              <span>{bannerMsg.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setBannerMsg(null)}
              className="rounded p-0.5 hover:bg-black/5"
            >
              <X size={13} />
            </button>
          </div>
        )}

        {/* 2. THANH CHỈ SỐ NGHIỆP VỤ (COMPACT KPI STRIP) */}
        <section className="border-b border-slate-200 bg-slate-50/90 px-3 py-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            <button
              type="button"
              onClick={() => setSourceFilter("ALL")}
              className={cn(
                "flex items-center justify-between rounded border px-2.5 py-1.5 text-left transition-colors",
                sourceFilter === "ALL"
                  ? "border-sky-600 bg-sky-50/80"
                  : "border-slate-300 bg-white hover:border-sky-400"
              )}
            >
              <div>
                <p className="text-[10px] font-semibold uppercase text-slate-500">Tổng danh mục SKU</p>
                <p className="text-sm font-bold text-slate-900">
                  {formatNumber(stats.total)}{" "}
                  <span className="text-[10px] font-normal text-emerald-700">
                    ({stats.activeCount} đang bán)
                  </span>
                </p>
              </div>
              <Package size={16} className="text-sky-700" />
            </button>

            <button
              type="button"
              onClick={() =>
                setSourceFilter((prev) => (prev === "ORDER_SYNC" ? "ALL" : "ORDER_SYNC"))
              }
              className={cn(
                "flex items-center justify-between rounded border px-2.5 py-1.5 text-left transition-colors",
                sourceFilter === "ORDER_SYNC"
                  ? "border-sky-600 bg-sky-50/80"
                  : "border-slate-300 bg-white hover:border-sky-400"
              )}
            >
              <div>
                <p className="text-[10px] font-semibold uppercase text-slate-500">
                  Từ Đơn hàng DMS
                </p>
                <p className="text-sm font-bold text-sky-800">
                  {formatNumber(stats.fromOrdersCount)}{" "}
                  <span className="text-[10px] font-normal text-slate-500">mã SP</span>
                </p>
              </div>
              <Layers size={16} className="text-sky-600" />
            </button>

            <button
              type="button"
              onClick={() =>
                setSourceFilter((prev) =>
                  prev === "PURCHASE_INVOICE" ? "ALL" : "PURCHASE_INVOICE"
                )
              }
              className={cn(
                "flex items-center justify-between rounded border px-2.5 py-1.5 text-left transition-colors",
                sourceFilter === "PURCHASE_INVOICE"
                  ? "border-sky-600 bg-sky-50/80"
                  : "border-slate-300 bg-white hover:border-sky-400"
              )}
            >
              <div>
                <p className="text-[10px] font-semibold uppercase text-slate-500">
                  Từ Hóa đơn mua CQT
                </p>
                <p className="text-sm font-bold text-emerald-700">
                  {formatNumber(stats.fromPurchaseCount)}{" "}
                  <span className="text-[10px] font-normal text-slate-500">mã SP</span>
                </p>
              </div>
              <FileText size={16} className="text-emerald-600" />
            </button>

            <button
              type="button"
              onClick={() =>
                setStatusFilter((prev) => (prev === "HAS_PRICE" ? "ALL" : "HAS_PRICE"))
              }
              className={cn(
                "flex items-center justify-between rounded border px-2.5 py-1.5 text-left transition-colors",
                statusFilter === "HAS_PRICE"
                  ? "border-sky-600 bg-sky-50/80"
                  : "border-slate-300 bg-white hover:border-sky-400"
              )}
            >
              <div>
                <p className="text-[10px] font-semibold uppercase text-slate-500">
                  SKU đã có đơn giá
                </p>
                <p className="text-sm font-bold text-slate-800">
                  {formatNumber(stats.pricedCount)}{" "}
                  <span className="text-[10px] font-normal text-amber-700">
                    ({stats.zeroPriceCount} KM/0đ)
                  </span>
                </p>
              </div>
              <CheckCircle2 size={16} className="text-emerald-600" />
            </button>

            <div className="flex items-center justify-between rounded border border-slate-300 bg-white px-2.5 py-1.5">
              <div>
                <p className="text-[10px] font-semibold uppercase text-slate-500">
                  Ngành hàng chuẩn
                </p>
                <p className="text-sm font-bold text-slate-800">
                  {categories.length}{" "}
                  <span className="text-[10px] font-normal text-slate-500">nhóm ngành</span>
                </p>
              </div>
              <Link
                href="/products/categories"
                className="text-[10px] font-semibold text-sky-700 hover:underline"
              >
                Chi tiết
              </Link>
            </div>

            <div className="flex items-center justify-between rounded border border-slate-300 bg-white px-2.5 py-1.5">
              <div>
                <p className="text-[10px] font-semibold uppercase text-slate-500">
                  Nhà cung cấp ({stats.supplierCount})
                </p>
                <p className="truncate text-xs font-bold text-slate-800">
                  {supplierOptions.map((s) => s.name).join(", ") || "Vinamilk"}
                </p>
              </div>
              <Building2 size={16} className="shrink-0 text-amber-600" />
            </div>
          </div>
        </section>

        {/* 3. BỘ LỌC TRA CỨU ĐA CHIỀU */}
        <section className="border-b border-slate-200 px-3 py-2.5">
          <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2 xl:grid-cols-7">
            <div className="sm:col-span-2 xl:col-span-2">
              <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                Tìm kiếm Mã sản phẩm (SKU) / Tên hàng hóa / Mã NPP
              </label>
              <div className="relative">
                <Search
                  size={13}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Nhập mã SKU (VD: 01TD03, 04ED33, 1277436) hoặc tên sản phẩm..."
                  className={cn(inputCls, "pl-7 pr-6")}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                    title="Xóa tìm kiếm"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                Nguồn đồng bộ hệ thống
              </label>
              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
                className={inputCls}
              >
                <option value="ALL">Tất cả nguồn ({stats.total})</option>
                <option value="SYNCED_ALL">
                  Đã đồng bộ từ hệ thống ({stats.fromOrdersCount + stats.fromPurchaseCount})
                </option>
                <option value="ORDER_SYNC">
                  Đồng bộ từ Đơn hàng DMS ({stats.fromOrdersCount})
                </option>
                <option value="PURCHASE_INVOICE">
                  Đồng bộ từ Hóa đơn mua vào CQT ({stats.fromPurchaseCount})
                </option>
                <option value="MANUAL">Tạo thủ công / Upload Excel</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                Nhà phân phối (NPP)
              </label>
              <select
                value={distributorFilter}
                onChange={(e) => setDistributorFilter(e.target.value)}
                className={inputCls}
              >
                <option value="ALL">Tất cả NPP ({distributorOptions.length})</option>
                {distributorOptions.map((distributor) => (
                  <option key={distributor.code} value={distributor.code}>
                    {distributor.name} ({distributor.count} SKU)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                Nhà cung cấp (NCC)
              </label>
              <select
                value={supplierFilter}
                onChange={(e) => setSupplierFilter(e.target.value)}
                className={inputCls}
              >
                <option value="ALL">Tất cả Nhà cung cấp ({supplierOptions.length})</option>
                {supplierOptions.map((sup) => (
                  <option key={sup.name} value={sup.name}>
                    {sup.name} ({sup.count} SKU)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                Danh mục ngành hàng
              </label>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className={inputCls}
              >
                <option value="ALL">Tất cả ngành hàng ({categories.length})</option>
                {categories.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name} ({categoryCounts.get(c.id) || 0})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                Đơn vị tính & Trạng thái giá
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                <select
                  value={unitFilter}
                  onChange={(e) => setUnitFilter(e.target.value)}
                  className={inputCls}
                >
                  <option value="ALL">Mọi ĐVT</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.name}>
                      {u.name}
                    </option>
                  ))}
                </select>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className={inputCls}
                >
                  <option value="ALL">Mọi TT</option>
                  <option value="active">Đang bán</option>
                  <option value="inactive">Ngừng bán</option>
                  <option value="HAS_PRICE">Có giá bán</option>
                  <option value="ZERO_PRICE">Hàng KM / 0đ</option>
                </select>
              </div>
            </div>
          </div>

          {/* Thanh phím tắt lọc nhanh theo ngành hàng & thao tác hàng loạt */}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[10px] font-semibold text-slate-500 mr-1">
                Ngành hàng nhanh:
              </span>
              <button
                type="button"
                onClick={() => setCategoryFilter("ALL")}
                className={cn(
                  "rounded px-2 py-0.5 text-[10px] font-semibold transition-colors",
                  categoryFilter === "ALL"
                    ? "bg-[#14263d] text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                )}
              >
                Tất cả ({products.length})
              </button>
              {categories
                .filter((c) => (categoryCounts.get(c.id) || 0) > 0)
                .map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() =>
                      setCategoryFilter((prev) =>
                        prev === String(cat.id) ? "ALL" : String(cat.id)
                      )
                    }
                    className={cn(
                      "rounded px-2 py-0.5 text-[10px] font-semibold transition-colors",
                      categoryFilter === String(cat.id)
                        ? "bg-sky-600 text-white"
                        : "bg-slate-100 text-slate-700 hover:bg-sky-50 hover:text-sky-700"
                    )}
                  >
                    {cat.code ? `${cat.code} (${categoryCounts.get(cat.id) || 0})` : cat.name}
                  </button>
                ))}
            </div>

            <div className="flex items-center gap-2">
              {selectedIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => setBulkDeleteConfirm(true)}
                  className="inline-flex items-center gap-1 rounded bg-red-700 hover:bg-red-800 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors"
                >
                  <Trash2 size={12} />
                  Xóa đã chọn ({selectedIds.size})
                </button>
              )}

              {(searchQuery ||
                sourceFilter !== "ALL" ||
                distributorFilter !== "ALL" ||
                categoryFilter !== "ALL" ||
                supplierFilter !== "ALL" ||
                unitFilter !== "ALL" ||
                statusFilter !== "ALL") && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white hover:bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700 transition-colors"
                >
                  <RotateCcw size={11} />
                  Đặt lại bộ lọc
                </button>
              )}

              <Link
                href="/products/company-management"
                className="inline-flex items-center gap-1 rounded border border-sky-200 bg-sky-50 hover:bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-800 transition-colors"
              >
                <Building2 size={11} />
                Quản lý mã NPP nội bộ
              </Link>
            </div>
          </div>
        </section>

        {/* 4. BẢNG DỮ LIỆU DANH SÁCH SẢN PHẨM (SKU) */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600 uppercase">
              <tr className="border-b border-slate-300">
                <th className="w-8 px-2 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={allPageChecked}
                    onChange={toggleSelectPage}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                    title="Chọn tất cả trên trang"
                  />
                </th>
                <th className="w-10 px-2 py-2 text-center">STT</th>
                <th className="px-2.5 py-2">
                  <button
                    type="button"
                    onClick={() => handleSort("code")}
                    className="inline-flex items-center gap-1 font-semibold uppercase text-slate-700 hover:text-sky-700"
                  >
                    Mã sản phẩm (SKU) {renderSortIcon("code")}
                  </button>
                </th>
                <th className="px-2.5 py-2">
                  <button
                    type="button"
                    onClick={() => handleSort("nppCode")}
                    className="inline-flex items-center gap-1 font-semibold uppercase text-slate-700 hover:text-sky-700"
                    title="Mã sản phẩm nội bộ theo Nhà phân phối (cho phép sửa trực tiếp)"
                  >
                    Mã NPP {renderSortIcon("nppCode")}
                  </button>
                </th>
                <th className="px-2.5 py-2">Nhà phân phối</th>
                <th className="px-2.5 py-2">
                  <button
                    type="button"
                    onClick={() => handleSort("name")}
                    className="inline-flex items-center gap-1 font-semibold uppercase text-slate-700 hover:text-sky-700"
                  >
                    Tên sản phẩm / Hàng hóa {renderSortIcon("name")}
                  </button>
                </th>
                <th className="px-2.5 py-2">
                  <button
                    type="button"
                    onClick={() => handleSort("category")}
                    className="inline-flex items-center gap-1 font-semibold uppercase text-slate-700 hover:text-sky-700"
                  >
                    Ngành hàng {renderSortIcon("category")}
                  </button>
                </th>
                <th className="px-2 py-2 text-center">
                  <button
                    type="button"
                    onClick={() => handleSort("unit")}
                    className="inline-flex items-center gap-1 font-semibold uppercase text-slate-700 hover:text-sky-700"
                  >
                    ĐVT {renderSortIcon("unit")}
                  </button>
                </th>
                <th className="px-2 py-2 text-center">
                  <button
                    type="button"
                    onClick={() => handleSort("boxes_per_carton")}
                    className="inline-flex items-center gap-1 font-semibold uppercase text-slate-700 hover:text-sky-700"
                    title="Số đơn vị (Hộp/Lon/Chai/Gói) trong 1 Thùng"
                  >
                    Quy cách {renderSortIcon("boxes_per_carton")}
                  </button>
                </th>
                <th className="px-2.5 py-2">
                  <button
                    type="button"
                    onClick={() => handleSort("supplier")}
                    className="inline-flex items-center gap-1 font-semibold uppercase text-slate-700 hover:text-sky-700"
                  >
                    Nhà cung cấp {renderSortIcon("supplier")}
                  </button>
                </th>
                <th className="px-2.5 py-2">
                  <button
                    type="button"
                    onClick={() => handleSort("activity")}
                    className="inline-flex items-center gap-1 font-semibold uppercase text-slate-700 hover:text-sky-700"
                  >
                    Nguồn đồng bộ & Phát sinh {renderSortIcon("activity")}
                  </button>
                </th>
                <th className="px-2.5 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => handleSort("price")}
                    className="inline-flex items-center justify-end gap-1 font-semibold uppercase text-slate-700 hover:text-sky-700"
                  >
                    Giá bán {renderSortIcon("price")}
                  </button>
                </th>
                <th className="px-2 py-2 text-center">Trạng thái</th>
                <th className="w-24 px-2 py-2 text-center">Thao tác</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={14} className="px-4 py-10 text-center text-xs text-slate-500">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 size={15} className="animate-spin text-sky-600" />
                      Đang đồng bộ và tải danh sách mã sản phẩm (SKU) từ hệ thống...
                    </span>
                  </td>
                </tr>
              ) : pagedProducts.length === 0 ? (
                <tr>
                  <td colSpan={14} className="px-4 py-10 text-center text-xs text-slate-500">
                    Không tìm thấy mã sản phẩm (SKU) nào khớp với điều kiện lọc hiện tại.
                  </td>
                </tr>
              ) : (
                pagedProducts.map((row, idx) => {
                  const stt = (safePage - 1) * pageSize + idx + 1;
                  const isSelected = selectedIds.has(row.id);
                  return (
                    <tr
                      key={row.id}
                      onClick={() => openEditModal(row)}
                      className={cn(
                        "cursor-pointer border-b border-slate-100 even:bg-amber-50/40 hover:bg-sky-50/50 text-[11px] transition-colors",
                        isSelected && "!bg-sky-100/70"
                      )}
                    >
                      <td
                        className="px-2 py-1.5 text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectProduct(row.id)}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                        />
                      </td>

                      <td className="px-2 py-1.5 text-center font-medium text-slate-500">
                        {stt}
                      </td>

                      <td className="px-2.5 py-1.5 whitespace-nowrap">
                        <span className="font-mono font-bold text-sky-800">
                          {row.code}
                        </span>
                      </td>

                      {/* CỘT MÃ NPP NỘI BỘ VỚI INLINE EDIT */}
                      <td
                        className="px-2.5 py-1.5 whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {editingNppId === row.id ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              autoFocus
                              value={inlineNppCode}
                              onChange={(e) => setInlineNppCode(e.target.value.toUpperCase())}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  void handleSaveNppCode(row, inlineNppCode);
                                } else if (e.key === "Escape") {
                                  setEditingNppId(null);
                                }
                              }}
                              disabled={savingNppId === row.id}
                              placeholder="Mã NPP"
                              className="h-6 w-28 rounded border border-sky-400 bg-white px-1.5 font-mono text-[11px] font-bold uppercase text-slate-800 focus:outline-none focus:ring-1 focus:ring-sky-500"
                            />
                            <button
                              type="button"
                              disabled={savingNppId === row.id}
                              onClick={() => void handleSaveNppCode(row, inlineNppCode)}
                              className="rounded bg-sky-600 p-1 text-white hover:bg-sky-700 disabled:bg-slate-300"
                              title="Lưu mã NPP (Enter)"
                            >
                              {savingNppId === row.id ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <Check size={12} />
                              )}
                            </button>
                            <button
                              type="button"
                              disabled={savingNppId === row.id}
                              onClick={() => setEditingNppId(null)}
                              className="rounded bg-slate-200 p-1 text-slate-600 hover:bg-slate-300"
                              title="Hủy (Esc)"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ) : (
                          <div className="group flex items-center gap-1.5">
                            {row.nppCode ? (
                              <span
                                className="rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-800"
                                title={`Mã NPP nội bộ: ${row.nppCode}`}
                              >
                                {row.nppCode}
                              </span>
                            ) : (
                              <span className="text-[10px] italic text-slate-400">—</span>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setEditingNppId(row.id);
                                setInlineNppCode(row.nppCode || "");
                              }}
                              className="rounded p-0.5 text-slate-400 opacity-60 hover:bg-sky-50 hover:text-sky-700 hover:opacity-100 group-hover:opacity-100 transition-opacity"
                              title="Chỉnh sửa mã NPP nội bộ"
                            >
                              <Pencil size={11} />
                            </button>
                          </div>
                        )}
                      </td>

                      <td className="px-2.5 py-1.5">
                        {row.distributors.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {row.distributors.map((distributor) => (
                              <span
                                key={distributor.code}
                                title={`${distributor.code} · ${distributor.name}`}
                                className="max-w-56 truncate rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-800"
                              >
                                {distributor.name}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[10px] italic text-slate-400">Chưa xác định</span>
                        )}
                      </td>

                      <td className="px-2.5 py-1.5">
                        <div className="font-semibold text-slate-800">{row.name}</div>
                        {row.representative_sku && row.representative_sku !== row.code && (
                          <div className="text-[10px] text-slate-500">
                            SKU đại diện: <span className="font-mono font-semibold">{row.representative_sku}</span>
                            {row.representative_name ? ` · ${row.representative_name}` : ""}
                          </div>
                        )}
                      </td>

                      <td className="px-2.5 py-1.5 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                          {row.categoryCode && (
                            <strong className="text-sky-800">{row.categoryCode}</strong>
                          )}
                          <span className="max-w-[160px] truncate" title={row.category}>
                            {row.category.replace(/^[A-Z]\s*-\s*/, "")}
                          </span>
                        </span>
                      </td>

                      <td className="px-2 py-1.5 text-center font-semibold text-slate-700">
                        {row.unit}
                      </td>

                      <td className="px-2 py-1.5 text-center font-semibold text-slate-700">
                        {row.boxes_per_carton > 1 ? (
                          <span className="rounded bg-amber-100/80 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
                            {row.boxes_per_carton} {row.unit}/Thùng
                          </span>
                        ) : (
                          <span className="text-slate-400">1</span>
                        )}
                      </td>

                      <td className="px-2.5 py-1.5 whitespace-nowrap">
                        <span
                          className={cn(
                            "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold",
                            row.supplier === "Vinamilk"
                              ? "bg-sky-50 text-sky-800 border border-sky-200"
                              : row.supplier === "FrieslandCampina"
                              ? "bg-indigo-50 text-indigo-800 border border-indigo-200"
                              : "bg-slate-100 text-slate-700 border border-slate-200"
                          )}
                        >
                          {row.supplier || "—"}
                        </span>
                      </td>

                      <td className="px-2.5 py-1.5 whitespace-nowrap">
                        {row.sync_source === "DMS_AND_CQT" ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-sky-800">
                              • DMS: {row.order_count} đơn ({formatNumber(row.total_ordered_qty)} {row.unit})
                            </span>
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-800">
                              • CQT: {row.purchase_invoice_count} HĐ ({formatNumber(row.total_purchased_qty)} {row.unit})
                            </span>
                          </div>
                        ) : row.sync_source === "ORDER_SYNC" ? (
                          <span className="inline-flex items-center gap-1 rounded bg-sky-50 border border-sky-200 px-1.5 py-0.5 text-[10px] font-medium text-sky-800">
                            Đơn DMS: <strong>{row.order_count}</strong> đơn · SL:{" "}
                            <strong>{formatNumber(row.total_ordered_qty)}</strong>
                          </span>
                        ) : row.sync_source === "PURCHASE_INVOICE" ? (
                          <span className="inline-flex items-center gap-1 rounded bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
                            HĐ mua CQT: <strong>{row.purchase_invoice_count}</strong> HĐ · SL:{" "}
                            <strong>{formatNumber(row.total_purchased_qty)}</strong>
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400">Thủ công / Excel</span>
                        )}
                      </td>

                      <td className="px-2.5 py-1.5 text-right font-medium text-slate-700 whitespace-nowrap">
                        {row.price > 0 ? (
                          <span className="font-semibold text-slate-900">
                            {formatUnitPrice(row.price, 4)}
                          </span>
                        ) : (
                          <span className="text-[10px] italic text-amber-700">
                            {formatUnitPrice(0, 4)} (Hàng KM)
                          </span>
                        )}
                      </td>

                      <td className="px-2 py-1.5 text-center whitespace-nowrap">
                        {row.status === "active" ? (
                          <span className="inline-flex items-center rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                            Đang bán
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                            Ngừng bán
                          </span>
                        )}
                      </td>

                      <td
                        className="px-2 py-1.5 text-center whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center justify-center gap-1">
                          <Link
                            href={`/products/${row.id}`}
                            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
                            title="Xem chi tiết thẻ kho & lịch sử sản phẩm"
                          >
                            <Eye size={13} />
                          </Link>
                          <button
                            type="button"
                            onClick={() => openEditModal(row)}
                            className="rounded p-1 text-slate-500 hover:bg-sky-50 hover:text-sky-700 transition-colors"
                            title="Chỉnh sửa thông tin SKU"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setDeleteConfirm({
                                id: row.id,
                                code: row.code,
                                name: row.name,
                              })
                            }
                            className="rounded p-1 text-slate-500 hover:bg-red-50 hover:text-red-700 transition-colors"
                            title="Xóa SKU"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>

            {/* TỔNG KẾT CHÂN BẢNG (tfoot) */}
            <tfoot className="border-t border-slate-200 bg-slate-50 text-[10px] font-semibold text-slate-600">
              <tr>
                <td colSpan={5} className="px-3 py-2">
                  Tổng cộng danh sách đang lọc:{" "}
                  <strong className="text-slate-900">{formatNumber(filteredProducts.length)}</strong>{" "}
                  mã sản phẩm (SKU) · Có giá bán:{" "}
                  <strong className="text-emerald-700">
                    {formatNumber(filteredTotals.withPriceCount)}
                  </strong>{" "}
                  SKU
                </td>
                <td colSpan={4} className="px-2.5 py-2 text-right">
                  Tổng sản lượng giao dịch từ hệ thống:
                </td>
                <td className="px-2.5 py-2">
                  <span className="text-sky-800">
                    Bán DMS: {formatNumber(filteredTotals.totalOrderedQty)}
                  </span>
                  {filteredTotals.totalPurchasedQty > 0 && (
                    <span className="ml-2 text-emerald-800">
                      · Nhập CQT: {formatNumber(filteredTotals.totalPurchasedQty)}
                    </span>
                  )}
                </td>
                <td colSpan={4} className="px-3 py-2 text-right text-slate-500">
                  Hiển thị {pagedProducts.length} / {filteredProducts.length} SKU
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* 5. THANH TÁC VỤ DƯỚI CÙNG (FOOTER ACTION BAR) */}
        <footer className="border-t border-slate-300 bg-slate-100 px-3 py-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
            <span>
              * Hệ thống tự động trích xuất và đồng bộ mã SKU, tên hàng hóa, ĐVT, đơn giá từ Đơn hàng
              DMS và Hóa đơn mua vào Cổng Thuế.
            </span>
            <label className="inline-flex items-center gap-1 font-semibold text-slate-700">
              Hiển thị:
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] text-slate-800 focus:border-sky-500 focus:outline-none"
              >
                <option value={25}>25 dòng</option>
                <option value={50}>50 dòng</option>
                <option value={100}>100 dòng</option>
                <option value={200}>200 dòng</option>
                <option value={1000}>Tất cả</option>
              </select>
            </label>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold text-slate-600 mr-1">
              Trang {safePage} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white hover:bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft size={13} />
              Trước
            </button>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white hover:bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Sau
              <ChevronRight size={13} />
            </button>
          </div>
        </footer>
      </div>

      {/* MODAL THÊM MỚI SKU (Chuẩn CreateOrderForm) */}
      {createOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setCreateOpen(false)}
        >
          <div
            className="w-full max-w-2xl border border-slate-400 bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="bg-[#14263d] px-3 py-2 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Plus size={17} className="text-red-500" />
                <h2 className="text-xs font-bold uppercase tracking-wide text-white">
                  Thêm Mới Mã Sản Phẩm (SKU)
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded p-1 text-white hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </header>

            <form onSubmit={createProduct}>
              {modalError && (
                <div className="mx-3 mt-2 flex items-center gap-2 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  <AlertTriangle size={14} />
                  <span>{modalError}</span>
                </div>
              )}

              <section className="border-b border-slate-200 px-3 py-2.5">
                <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2 xl:grid-cols-4">
                  <label className="text-[10px] font-semibold text-slate-600 block">
                    Mã sản phẩm (SKU) <span className="text-red-600">*</span>
                    <input
                      required
                      value={form.sku}
                      onChange={(e) => setForm({ ...form, sku: e.target.value.toUpperCase() })}
                      placeholder="VD: 01TD03"
                      className={cn(inputCls, "mt-0.5 font-mono font-bold uppercase")}
                    />
                  </label>

                  <label className="text-[10px] font-semibold text-slate-600 block">
                    Mã NPP (Nội bộ)
                    <input
                      value={form.npp_code}
                      onChange={(e) => setForm({ ...form, npp_code: e.target.value.toUpperCase() })}
                      placeholder="VD: NPP-01TD03"
                      className={cn(inputCls, "mt-0.5 font-mono font-bold uppercase")}
                    />
                  </label>

                  <label className="text-[10px] font-semibold text-slate-600 block sm:col-span-2">
                    Tên sản phẩm đầy đủ <span className="text-red-600">*</span>
                    <input
                      required
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="VD: Sữa đặc có đường Ông Thọ đỏ 380g"
                      className={cn(inputCls, "mt-0.5")}
                    />
                  </label>

                  <label className="text-[10px] font-semibold text-slate-600 block sm:col-span-2">
                    Danh mục ngành hàng
                    <select
                      value={form.category_id}
                      onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                      className={cn(inputCls, "mt-0.5")}
                    >
                      {categories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="text-[10px] font-semibold text-slate-600 block">
                    Đơn vị tính (ĐVT)
                    <select
                      value={form.unit_id}
                      onChange={(e) => setForm({ ...form, unit_id: e.target.value })}
                      className={cn(inputCls, "mt-0.5")}
                    >
                      {units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} ({u.code})
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="text-[10px] font-semibold text-slate-600 block">
                    Nhà cung cấp
                    <input
                      list="sku-suppliers-datalist"
                      value={form.supplier}
                      onChange={(e) => setForm({ ...form, supplier: e.target.value })}
                      placeholder="VD: Vinamilk"
                      className={cn(inputCls, "mt-0.5")}
                    />
                    <datalist id="sku-suppliers-datalist">
                      {supplierOptions.map((s) => (
                        <option key={s.name} value={s.name} />
                      ))}
                    </datalist>
                  </label>

                  <label className="text-[10px] font-semibold text-slate-600 block">
                    Giá bán niêm yết (VNĐ)
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={form.base_price}
                      onChange={(e) => setForm({ ...form, base_price: e.target.value })}
                      className={cn(inputCls, "mt-0.5 text-right font-semibold")}
                    />
                  </label>

                  <label className="text-[10px] font-semibold text-slate-600 block">
                    Giá vốn nhập kho (VNĐ)
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={form.cost_price}
                      onChange={(e) => setForm({ ...form, cost_price: e.target.value })}
                      className={cn(inputCls, "mt-0.5 text-right font-semibold")}
                    />
                  </label>

                  <label className="text-[10px] font-semibold text-slate-600 block">
                    Quy cách (Số hộp/thùng)
                    <input
                      type="number"
                      min={1}
                      value={form.boxes_per_carton}
                      onChange={(e) => setForm({ ...form, boxes_per_carton: e.target.value })}
                      className={cn(inputCls, "mt-0.5 text-center font-semibold")}
                    />
                  </label>

                  <label className="text-[10px] font-semibold text-slate-600 block">
                    Trạng thái kinh doanh
                    <select
                      value={form.status}
                      onChange={(e) => setForm({ ...form, status: e.target.value })}
                      className={cn(inputCls, "mt-0.5")}
                    >
                      <option value="active">Đang kinh doanh</option>
                      <option value="inactive">Ngừng kinh doanh</option>
                    </select>
                  </label>
                </div>
              </section>

              <footer className="border-t border-slate-300 bg-slate-100 px-3 py-2 flex items-center justify-between gap-3">
                <span className="text-[10px] text-slate-500">
                  Mã SKU sẽ tự động chuẩn hóa in hoa và dùng chung cho Đơn hàng & Xuất hóa đơn.
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCreateOpen(false)}
                    className="rounded bg-red-700 hover:bg-red-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
                  >
                    Đóng
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex items-center gap-1.5 rounded bg-sky-600 hover:bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {submitting ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <CheckCircle2 size={13} />
                    )}
                    Lưu mã SKU
                  </button>
                </div>
              </footer>
            </form>
          </div>
        </div>
      )}

      {/* MODAL CHỈNH SỬA SKU (Chuẩn CreateOrderForm) */}
      {editOpen && editingProduct && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            setEditOpen(false);
            setEditingProduct(null);
          }}
        >
          <div
            className="w-full max-w-2xl border border-slate-400 bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="bg-[#14263d] px-3 py-2 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Pencil size={17} className="text-red-500" />
                <h2 className="text-xs font-bold uppercase tracking-wide text-white">
                  Cập Nhật Thông Tin Sản Phẩm · {editingProduct.code}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditOpen(false);
                  setEditingProduct(null);
                }}
                className="rounded p-1 text-white hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </header>

            <form onSubmit={updateProduct}>
              {modalError && (
                <div className="mx-3 mt-2 flex items-center gap-2 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  <AlertTriangle size={14} />
                  <span>{modalError}</span>
                </div>
              )}

              <section className="border-b border-slate-200 px-3 py-2.5">
                <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2 xl:grid-cols-4">
                  <label className="text-[10px] font-semibold text-slate-600 block">
                    Mã sản phẩm (SKU) <span className="text-red-600">*</span>
                    <input
                      required
                      value={editForm.sku}
                      onChange={(e) =>
                        setEditForm({ ...editForm, sku: e.target.value.toUpperCase() })
                      }
                      className={cn(inputCls, "mt-0.5 font-mono font-bold uppercase")}
                    />
                  </label>

                  <label className="text-[10px] font-semibold text-slate-600 block">
                    Mã NPP (Nội bộ)
                    <input
                      value={editForm.npp_code}
                      onChange={(e) =>
                        setEditForm({ ...editForm, npp_code: e.target.value.toUpperCase() })
                      }
                      placeholder="VD: NPP-01TD03"
                      className={cn(inputCls, "mt-0.5 font-mono font-bold uppercase")}
                    />
                  </label>

                  <label className="text-[10px] font-semibold text-slate-600 block sm:col-span-2">
                    Tên sản phẩm đầy đủ <span className="text-red-600">*</span>
                    <input
                      required
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      className={cn(inputCls, "mt-0.5")}
                    />
                  </label>

                  <label className="text-[10px] font-semibold text-slate-600 block sm:col-span-2">
                    Danh mục ngành hàng
                    <select
                      value={editForm.category_id}
                      onChange={(e) =>
                        setEditForm({ ...editForm, category_id: e.target.value })
                      }
                      className={cn(inputCls, "mt-0.5")}
                    >
                      {categories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="text-[10px] font-semibold text-slate-600 block">
                    Đơn vị tính (ĐVT)
                    <select
                      value={editForm.unit_id}
                      onChange={(e) => setEditForm({ ...editForm, unit_id: e.target.value })}
                      className={cn(inputCls, "mt-0.5")}
                    >
                      {units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} ({u.code})
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="text-[10px] font-semibold text-slate-600 block">
                    Nhà cung cấp
                    <input
                      list="sku-suppliers-datalist-edit"
                      value={editForm.supplier}
                      onChange={(e) =>
                        setEditForm({ ...editForm, supplier: e.target.value })
                      }
                      className={cn(inputCls, "mt-0.5")}
                    />
                    <datalist id="sku-suppliers-datalist-edit">
                      {supplierOptions.map((s) => (
                        <option key={s.name} value={s.name} />
                      ))}
                    </datalist>
                  </label>

                  <label className="text-[10px] font-semibold text-slate-600 block">
                    Giá bán niêm yết (VNĐ)
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={editForm.base_price}
                      onChange={(e) =>
                        setEditForm({ ...editForm, base_price: e.target.value })
                      }
                      className={cn(inputCls, "mt-0.5 text-right font-semibold")}
                    />
                  </label>

                  <label className="text-[10px] font-semibold text-slate-600 block">
                    Giá vốn nhập kho (VNĐ)
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={editForm.cost_price}
                      onChange={(e) =>
                        setEditForm({ ...editForm, cost_price: e.target.value })
                      }
                      className={cn(inputCls, "mt-0.5 text-right font-semibold")}
                    />
                  </label>

                  <label className="text-[10px] font-semibold text-slate-600 block">
                    Quy cách (Số hộp/thùng)
                    <input
                      type="number"
                      min={1}
                      value={editForm.boxes_per_carton}
                      onChange={(e) =>
                        setEditForm({ ...editForm, boxes_per_carton: e.target.value })
                      }
                      className={cn(inputCls, "mt-0.5 text-center font-semibold")}
                    />
                  </label>

                  <label className="text-[10px] font-semibold text-slate-600 block">
                    Trạng thái kinh doanh
                    <select
                      value={editForm.status}
                      onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                      className={cn(inputCls, "mt-0.5")}
                    >
                      <option value="active">Đang kinh doanh</option>
                      <option value="inactive">Ngừng kinh doanh</option>
                    </select>
                  </label>
                </div>

                {/* Thông tin thống kê phát sinh thực tế của SKU */}
                <div className="mt-3 rounded border border-sky-100 bg-sky-50/60 px-3 py-2 text-[11px] text-slate-700 flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <strong>Thống kê đồng bộ:</strong> Xuất hiện trong{" "}
                    <strong className="text-sky-800">{editingProduct.order_count}</strong> đơn hàng
                    DMS (Tổng SL:{" "}
                    <strong>{formatNumber(editingProduct.total_ordered_qty)}</strong>{" "}
                    {editingProduct.unit}) và{" "}
                    <strong className="text-emerald-800">
                      {editingProduct.purchase_invoice_count}
                    </strong>{" "}
                    hóa đơn mua vào CQT.
                  </span>
                  <Link
                    href={`/products/${editingProduct.id}`}
                    className="font-semibold text-sky-700 hover:underline"
                  >
                    Xem trang chi tiết SKU →
                  </Link>
                </div>
              </section>

              <footer className="border-t border-slate-300 bg-slate-100 px-3 py-2 flex items-center justify-between gap-3">
                <span className="text-[10px] text-slate-500">
                  ID hệ thống: #{editingProduct.id}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditOpen(false);
                      setEditingProduct(null);
                    }}
                    className="rounded bg-red-700 hover:bg-red-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex items-center gap-1.5 rounded bg-sky-600 hover:bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {submitting ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <CheckCircle2 size={13} />
                    )}
                    Cập nhật SKU
                  </button>
                </div>
              </footer>
            </form>
          </div>
        </div>
      )}

      {/* MODAL XÁC NHẬN XÓA 1 SKU */}
      {deleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setDeleteConfirm(null)}
        >
          <div
            className="w-full max-w-md border border-slate-400 bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="bg-[#14263d] px-3 py-2 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trash2 size={17} className="text-red-500" />
                <h2 className="text-xs font-bold uppercase tracking-wide text-white">
                  Xác Nhận Xóa Mã Sản Phẩm (SKU)
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                className="rounded p-1 text-white hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </header>

            <div className="border-b border-slate-200 px-3 py-3 text-xs text-slate-700 space-y-1.5">
              <p>
                Bạn có chắc chắn muốn xóa mã sản phẩm{" "}
                <strong className="font-mono text-sky-800">{deleteConfirm.code}</strong> (
                <strong>{deleteConfirm.name}</strong>) khỏi danh mục?
              </p>
              <p className="text-[11px] text-slate-500">
                Lưu ý: Nếu mã sản phẩm này vẫn nằm trong đơn hàng đồng bộ, hệ thống có thể tự động
                khôi phục lại khi chạy đồng bộ từ đơn hàng.
              </p>
            </div>

            <footer className="border-t border-slate-300 bg-slate-100 px-3 py-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                className="rounded border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => deleteProduct(deleteConfirm.id, deleteConfirm.code)}
                className="inline-flex items-center gap-1.5 rounded bg-red-700 hover:bg-red-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-50"
              >
                {submitting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                Xác nhận xóa
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* MODAL XÁC NHẬN XÓA HÀNG LOẠT */}
      {bulkDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setBulkDeleteConfirm(false)}
        >
          <div
            className="w-full max-w-md border border-slate-400 bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="bg-[#14263d] px-3 py-2 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trash2 size={17} className="text-red-500" />
                <h2 className="text-xs font-bold uppercase tracking-wide text-white">
                  Xác Nhận Xóa Hàng Loạt ({selectedIds.size} SKU)
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setBulkDeleteConfirm(false)}
                className="rounded p-1 text-white hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </header>

            <div className="border-b border-slate-200 px-3 py-3 text-xs text-slate-700">
              Bạn có chắc chắn muốn xóa <strong>{selectedIds.size}</strong> mã sản phẩm (SKU) đã
              chọn?
            </div>

            <footer className="border-t border-slate-300 bg-slate-100 px-3 py-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setBulkDeleteConfirm(false)}
                className="rounded border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={bulkDeleteProducts}
                className="inline-flex items-center gap-1.5 rounded bg-red-700 hover:bg-red-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-50"
              >
                {submitting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                Xóa {selectedIds.size} SKU
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

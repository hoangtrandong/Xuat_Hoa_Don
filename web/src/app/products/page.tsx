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
  ChevronDown,
  Layers,
  Building2,
  FileText,
  Tag,
  Link2,
} from "lucide-react";
import AuthenticatedDownloadLink from "@/components/ui/AuthenticatedDownloadLink";
import { formatNumber, formatUnitPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { API_URL, apiFetch } from "@/lib/api";
import { downloadExcel } from "@/lib/excel";
import { useAuthSession } from "@/lib/auth-session";
import { useDistributorContext } from "@/lib/distributor-context";

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
  vat_rate?: number | null;
  vat_rate_source?: string | null;
  boxes_per_carton: number;
  reorder_level?: number;
  status: string;
  npp_code?: string | null;
  internal_name?: string | null;
  internal_unit?: string | null;
  representative_sku?: string | null;
  representative_name?: string | null;
  order_count?: number;
  total_ordered_qty?: number;
  purchase_invoice_count?: number;
  total_purchased_qty?: number;
  sync_source?: string;
  distributors?: ProductDistributor[];
  managed_companies?: ProductManagedCompany[];
  row_key?: string | null;
  row_company_id?: number | null;
  row_company_code?: string | null;
  row_company_name?: string | null;
  row_company_short_name?: string | null;
  row_company_tax_code?: string | null;
  row_company_is_primary?: boolean | null;
  row_company_npp_code?: string | null;
  row_company_purchased_qty?: number | null;
  row_company_has_conversion?: boolean | null;
  mst_count?: number;
};

type ProductDistributor = {
  code: string;
  name: string;
};

type ProductManagedCompany = {
  company_id: number;
  company_code: string;
  company_name: string;
  short_name?: string | null;
  tax_code?: string | null;
  invoice_item_mode?: string;
  source?: string;
  is_primary: boolean;
  npp_code?: string | null;
  company_product_code?: string | null;
  invoice_name_override?: string | null;
  invoice_unit_name?: string | null;
  conversion_num: number;
  conversion_den: number;
  total_purchased_qty?: number;
  last_purchased_at?: string | null;
};

type CompanyOption = {
  id: number;
  code: string;
  name: string;
  short_name?: string | null;
  tax_code?: string | null;
  invoice_item_mode?: string;
};

type ProductRow = {
  rowKey: string;
  id: number;
  code: string;
  nppCode: string;
  internal_name: string;
  internal_unit: string;
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
  vat_rate: number | null;
  vat_rate_source: string;
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
  managed_companies: ProductManagedCompany[];
  rowCompanyId: number | null;
  rowCompanyCode: string;
  rowCompanyName: string;
  rowCompanyShortName: string;
  rowCompanyTaxCode: string;
  rowCompanyIsPrimary: boolean;
  rowCompanyPurchasedQty: number;
  rowCompanyHasConversion: boolean;
  mstCount: number;
  _searchKey?: string;
};

type NppProductOption = {
  id?: number;
  code: string;
  name: string;
  supplier: string;
  unit: string;
  unitPrice: number;
  orderCount: number;
  mappedSku: string;
  companyName: string;
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

function buildProductSearchKey(p: {
  code: string;
  nppCode: string;
  name: string;
  supplier: string;
  category: string;
  unit: string;
  representative_sku: string;
  distributors?: ProductDistributor[];
}): string {
  const distText = (p.distributors || []).map((d) => `${d.code} ${d.name}`).join(" ");
  return normalizeSearchText(
    `${p.code} ${p.nppCode} ${p.name} ${p.supplier} ${p.category} ${p.unit} ${p.representative_sku} ${distText}`
  );
}

export default function ProductsPage() {
  const authSession = useAuthSession();
  const { effectiveDistributorId, effectiveDistributor } = useDistributorContext();
  const isSuperAdmin = authSession.isSuperAdmin || !authSession.distributorCode;

  const [products, setProducts] = useState<ProductRow[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Bộ lọc tra cứu
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [distributorFilter, setDistributorFilter] = useState<string>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [supplierFilter, setSupplierFilter] = useState<string>("ALL");
  const [unitFilter, setUnitFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  // Tự động gán và khóa NPP đối với tài khoản Nhà phân phối
  useEffect(() => {
    if (!isSuperAdmin && authSession.distributorCode) {
      setDistributorFilter(authSession.distributorCode);
    } else if (isSuperAdmin) {
      setDistributorFilter(effectiveDistributor?.code || "ALL");
      setCurrentPage(1);
    }
  }, [isSuperAdmin, authSession.distributorCode, effectiveDistributor?.code]);

  // Sắp xếp & Phân trang Server-side
  const [sortField, setSortField] = useState<SortField>("code");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [pageSize, setPageSize] = useState<number>(20);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalItems, setTotalItems] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  // Thống kê & Tuỳ chọn bộ lọc Server
  const [stats, setStats] = useState({
    total: 0,
    activeCount: 0,
    fromOrdersCount: 0,
    fromPurchaseCount: 0,
    pricedCount: 0,
    zeroPriceCount: 0,
    supplierCount: 0,
  });
  const [supplierOptions, setSupplierOptions] = useState<{ name: string; count: number }[]>([]);
  const [categoryCounts, setCategoryCounts] = useState<Map<number, number>>(new Map());
  const [distributorOptions, setDistributorOptions] = useState<{ code: string; name: string }[]>([]);

  // Debounce tìm kiếm 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(searchInput);
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Chọn dòng & Modal
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductRow | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; code: string; name: string } | null>(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);

  // Chỉnh sửa nhanh inline Mã NPP trực tiếp trên bảng (theo từng dòng SKU–MST)
  const [editingNppKey, setEditingNppKey] = useState<string | null>(null);
  const [inlineNppCode, setInlineNppCode] = useState<string>("");
  const [savingNppKey, setSavingNppKey] = useState<string | null>(null);

  // Danh sách mã sản phẩm NPP nội bộ (từ đơn hàng DMS / web NCC)
  const [nppProductOptions, setNppProductOptions] = useState<NppProductOption[]>([]);
  const [editNppSearchQuery, setEditNppSearchQuery] = useState("");
  const [showEditNppDropdown, setShowEditNppDropdown] = useState(false);
  const [editNppFilterTab, setEditNppFilterTab] = useState<"ALL" | "UNMAPPED" | "MAPPED">("ALL");
  const editNppContainerRef = useRef<HTMLDivElement>(null);

  const [createNppSearchQuery, setCreateNppSearchQuery] = useState("");
  const [showCreateNppDropdown, setShowCreateNppDropdown] = useState(false);
  const [createNppFilterTab, setCreateNppFilterTab] = useState<"ALL" | "UNMAPPED" | "MAPPED">("ALL");
  const createNppContainerRef = useRef<HTMLDivElement>(null);

  const editNppSearchInputRef = useRef<HTMLInputElement>(null);
  const createNppSearchInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    sku: "",
    npp_code: "",
    name: "",
    category_id: "",
    unit_id: "",
    supplier: "Vinamilk",
    base_price: "0",
    cost_price: "0",
    vat_rate: "",
    boxes_per_carton: "1",
    reorder_level: "20",
    status: "active",
  });

  const [editForm, setEditForm] = useState({
    sku: "",
    npp_code: "",
    internal_name: "",
    internal_unit: "",
    name: "",
    category_id: "",
    unit_id: "",
    supplier: "",
    base_price: "0",
    cost_price: "0",
    vat_rate: "",
    boxes_per_carton: "1",
    reorder_level: "20",
    status: "active",
  });

  // Danh mục Công ty quản lý & bộ lọc
  const [companyOptions, setCompanyOptions] = useState<CompanyOption[]>([]);
  const [companyFilter, setCompanyFilter] = useState<string>("ALL");
  const [internalCodeFilter, setInternalCodeFilter] = useState<"ALL" | "MAPPED" | "UNMAPPED">("ALL");
  const [bulkCompanyId, setBulkCompanyId] = useState<string>("");
  const [bulkAssigningCompany, setBulkAssigningCompany] = useState(false);

  const [bannerMsg, setBannerMsg] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);
  const [modalError, setModalError] = useState("");

  const fileInput = useRef<HTMLInputElement>(null);

  const loadFilterOptions = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_URL}/products/filter-options`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.suppliers)) setSupplierOptions(data.suppliers);
        if (Array.isArray(data.distributors)) setDistributorOptions(data.distributors);
        if (data.category_counts && typeof data.category_counts === "object") {
          const map = new Map<number, number>();
          for (const [k, v] of Object.entries(data.category_counts)) {
            map.set(Number(k), Number(v));
          }
          setCategoryCounts(map);
        }
      }
    } catch {
      // ignore
    }
  }, [effectiveDistributorId]);

  const loadMetadata = useCallback(async () => {
    try {
      const companyQuery =
        effectiveDistributorId !== null
          ? `?limit=5000&distributor_id=${effectiveDistributorId}`
          : "?limit=5000";
      const invoiceProdQuery =
        effectiveDistributorId !== null ? `?distributor_id=${effectiveDistributorId}` : "";
      const [categoryResponse, unitResponse, invoiceProductsResponse, companiesResponse] = await Promise.all([
        apiFetch(`${API_URL}/products/categories/`),
        apiFetch(`${API_URL}/products/units/`),
        apiFetch(`${API_URL}/invoice-products${invoiceProdQuery}`).catch(() => null),
        apiFetch(`${API_URL}/companies/${companyQuery}`).catch(() => null),
      ]);
      if (companiesResponse && companiesResponse.ok) {
        const loadedCompanies = (await companiesResponse.json().catch(() => [])) as CompanyOption[];
        if (Array.isArray(loadedCompanies)) {
          setCompanyOptions(loadedCompanies);
        }
      }
      if (categoryResponse.ok) {
        const loadedCategories = (await categoryResponse.json()) as CategoryOption[];
        setCategories(loadedCategories);
        setForm((prev) => ({
          ...prev,
          category_id: prev.category_id || String(loadedCategories[0]?.id ?? "1"),
        }));
      }
      if (unitResponse.ok) {
        const loadedUnits = (await unitResponse.json()) as UnitOption[];
        setUnits(loadedUnits);
        setForm((prev) => ({
          ...prev,
          unit_id: prev.unit_id || String(loadedUnits[0]?.id ?? "1"),
        }));
      }

      if (invoiceProductsResponse && invoiceProductsResponse.ok) {
        const rawIps = (await invoiceProductsResponse.json().catch(() => [])) as Array<Record<string, unknown>>;
        if (Array.isArray(rawIps)) {
          const opts: NppProductOption[] = rawIps
            .filter((ip) => Boolean(ip.code))
            .map((ip) => ({
              id: Number(ip.id),
              code: String(ip.code || "").trim().toUpperCase(),
              name: String(ip.name || "").trim(),
              supplier: String(ip.supplier || "").trim(),
              unit: String(ip.unit_name || "Hộp").trim(),
              unitPrice: 0,
              orderCount: Number(ip.dms_product_count || 0),
              mappedSku: Number(ip.cqt_sku_count || 0) > 0 ? `${ip.cqt_sku_count} SKU` : "",
              companyName: "",
            }));
          setNppProductOptions(opts);
        }
      }
    } catch {
      // ignore
    }
  }, [effectiveDistributorId]);

  const loadCatalog = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(currentPage),
        page_size: String(pageSize),
        sort_field: sortField,
        sort_order: sortOrder,
      });
      if (searchQuery.trim()) params.set("search", searchQuery.trim());
      if (categoryFilter !== "ALL") params.set("category_id", categoryFilter);
      if (supplierFilter !== "ALL") params.set("supplier", supplierFilter);
      if (unitFilter !== "ALL") params.set("unit", unitFilter);
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (companyFilter === "UNASSIGNED") {
        params.set("company_id", "0");
      } else if (companyFilter !== "ALL") {
        params.set("company_id", companyFilter);
      }
      if (internalCodeFilter === "MAPPED") {
        params.set("has_internal_code", "true");
      } else if (internalCodeFilter === "UNMAPPED") {
        params.set("has_internal_code", "false");
      }
      if (!isSuperAdmin && authSession.distributorCode) {
        params.set("distributor_code", authSession.distributorCode);
      } else if (distributorFilter !== "ALL") {
        params.set("distributor_code", distributorFilter);
      }

      const res = await apiFetch(`${API_URL}/products/paged?${params.toString()}`);
      if (!res.ok) throw new Error("Không thể tải danh sách SKU.");
      const data = await res.json();

      const catById = new Map(categories.map((c) => [c.id, c]));
      const unitById = new Map(units.map((u) => [u.id, u]));

      const mappedRows: ProductRow[] = (data.items || []).map((product: ApiProductItem) => {
        const catObj = catById.get(product.category_id);
        const unitObj = unitById.get(product.unit_id);
        const rawSource = (product.sync_source || "MANUAL").toUpperCase();
        const syncSource: ProductRow["sync_source"] =
          rawSource === "DMS_AND_CQT" || rawSource === "ORDER_SYNC" || rawSource === "PURCHASE_INVOICE"
            ? rawSource
            : "MANUAL";

        const rowCompanyId = product.row_company_id ?? null;
        const row: ProductRow = {
          rowKey: product.row_key || `${product.id}:${rowCompanyId ?? 0}`,
          id: product.id,
          code: product.sku,
          nppCode: (rowCompanyId != null ? product.row_company_npp_code : product.npp_code) || "",
          internal_name: product.internal_name || "",
          internal_unit: product.internal_unit || "",
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
          vat_rate: product.vat_rate != null ? Number(product.vat_rate) : null,
          vat_rate_source: product.vat_rate_source || "MANUAL",
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
          managed_companies: product.managed_companies ?? [],
          rowCompanyId,
          rowCompanyCode: product.row_company_code || "",
          rowCompanyName: product.row_company_name || "",
          rowCompanyShortName: product.row_company_short_name || "",
          rowCompanyTaxCode: product.row_company_tax_code || "",
          rowCompanyIsPrimary: Boolean(product.row_company_is_primary),
          rowCompanyPurchasedQty: Number(product.row_company_purchased_qty ?? 0),
          rowCompanyHasConversion: Boolean(product.row_company_has_conversion),
          mstCount: Number(product.mst_count ?? (product.managed_companies?.length || 0)),
        };
        row._searchKey = buildProductSearchKey(row);
        return row;
      });

      setProducts(mappedRows);
      setTotalItems(data.total || 0);
      setTotalPages(data.total_pages || 1);
      if (data.stats) {
        setStats({
          total: data.stats.total || 0,
          activeCount: data.stats.active_count || 0,
          pricedCount: data.stats.priced_count || 0,
          zeroPriceCount: data.stats.zero_price_count || 0,
          supplierCount: data.stats.supplier_count || 0,
          fromOrdersCount: 0,
          fromPurchaseCount: 0,
        });
      }
    } catch (loadErr) {
      setBannerMsg({
        type: "error",
        text: loadErr instanceof Error ? loadErr.message : "Không thể tải dữ liệu danh sách SKU.",
      });
    } finally {
      setLoading(false);
    }
  }, [
    currentPage,
    pageSize,
    sortField,
    sortOrder,
    searchQuery,
    categoryFilter,
    supplierFilter,
    unitFilter,
    statusFilter,
    companyFilter,
    internalCodeFilter,
    distributorFilter,
    isSuperAdmin,
    authSession.distributorCode,
    categories,
    units,
  ]);

  useEffect(() => {
    void loadMetadata();
    void loadFilterOptions();
  }, [loadMetadata, loadFilterOptions]);

  useEffect(() => {
    void loadCatalog(true);
  }, [loadCatalog]);

  async function handleSyncFromSystem() {
    setSyncing(true);
    setBannerMsg({
      type: "info",
      text: "Đang đồng bộ danh mục SKU từ Hóa đơn mua vào CQT và cập nhật Mã NPP nội bộ từ Đơn hàng DMS...",
    });
    try {
      const response = await apiFetch(`${API_URL}/products/sync-from-system`, {
        method: "POST",
      });
      const result = (await response.json()) as {
        added?: number;
        updated?: number;
        dms_mapped?: number;
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
        text: `Đồng bộ hoàn tất: ${result.added ?? 0} SKU mới từ Hóa đơn CQT, ${result.dms_mapped ?? 0} Mã NPP cập nhật từ DMS. Tổng: ${result.total_products ?? 0} SKU.`,
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
      const result = (await response.json()) as ApiProductItem & { detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "Không thể tạo mới SKU.");
      
      const catObj = categories.find((c) => c.id === Number(form.category_id || 1));
      const unitObj = units.find((u) => u.id === Number(form.unit_id || 1));
      const newRow: ProductRow = {
        rowKey: `${result.id}:0`,
        id: result.id,
        code: form.sku.trim().toUpperCase(),
        nppCode: form.npp_code.trim().toUpperCase() || "",
        internal_name: "",
        internal_unit: "",
        name: form.name.trim(),
        category_id: Number(form.category_id || 1),
        categoryCode: catObj?.code || "",
        category: catObj?.name || "Chưa phân loại",
        unit_id: Number(form.unit_id || 1),
        unitCode: unitObj?.code || "",
        unit: unitObj?.name || "Hộp",
        supplier: form.supplier.trim() || "Vinamilk",
        price: Number(form.base_price) || 0,
        cost_price: Number(form.cost_price) || 0,
        vat_rate: null,
        vat_rate_source: "MANUAL",
        boxes_per_carton: Math.max(1, Number(form.boxes_per_carton) || 1),
        reorder_level: Math.max(0, Number(form.reorder_level) || 20),
        status: form.status || "active",
        representative_sku: "",
        representative_name: "",
        order_count: 0,
        total_ordered_qty: 0,
        purchase_invoice_count: 0,
        total_purchased_qty: 0,
        sync_source: "MANUAL",
        distributors: [],
        managed_companies: [],
        rowCompanyId: null,
        rowCompanyCode: "",
        rowCompanyName: "",
        rowCompanyShortName: "",
        rowCompanyTaxCode: "",
        rowCompanyIsPrimary: false,
        rowCompanyPurchasedQty: 0,
        rowCompanyHasConversion: false,
        mstCount: 0,
      };
      newRow._searchKey = buildProductSearchKey(newRow);
      setProducts((prev) => [newRow, ...prev]);
      setCreateOpen(false);
      setBannerMsg({
        type: "success",
        text: `Đã thêm mới mã sản phẩm ${newRow.code} - ${newRow.name} thành công.`,
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
      const formattedNpp = editForm.npp_code.trim().toUpperCase() || null;
      const patchBody: Record<string, unknown> = {
        sku: editForm.sku.trim().toUpperCase(),
        internal_name: editForm.internal_name.trim() || null,
        internal_unit: editForm.internal_unit.trim() || null,
        name: editForm.name.trim(),
        category_id: Number(editForm.category_id),
        unit_id: Number(editForm.unit_id),
        supplier: editForm.supplier.trim() || null,
        base_price: Number(editForm.base_price) || 0,
        cost_price: Number(editForm.cost_price) || 0,
        vat_rate: editForm.vat_rate === "" ? null : Number(editForm.vat_rate),
        vat_rate_source: editForm.vat_rate === "" ? "MANUAL" : "MANUAL",
        boxes_per_carton: Math.max(1, Number(editForm.boxes_per_carton) || 1),
        reorder_level: Math.max(0, Number(editForm.reorder_level) || 20),
        status: editForm.status,
      };
      // Nếu dòng chưa gắn MST nào thì lưu npp_code trực tiếp trên SKU; ngược lại lưu riêng theo cặp (SKU, MST)
      if (editingProduct.rowCompanyId == null) {
        patchBody.npp_code = formattedNpp;
      }

      const response = await apiFetch(`${API_URL}/products/${editingProduct.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchBody),
      });
      const result = (await response.json()) as { detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "Không thể cập nhật SKU.");

      if (editingProduct.rowCompanyId != null) {
        const nppResp = await apiFetch(
          `${API_URL}/products/${editingProduct.id}/companies/${editingProduct.rowCompanyId}/npp-code`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ npp_code: formattedNpp }),
          }
        );
        if (!nppResp.ok) {
          const errData = (await nppResp.json().catch(() => ({}))) as { detail?: string };
          throw new Error(errData.detail ?? "Không thể cập nhật Mã NPP cho MST này.");
        }
      }

      const updatedSku = editForm.sku.trim().toUpperCase();
      setEditOpen(false);
      setEditingProduct(null);
      await loadCatalog(false);
      setBannerMsg({
        type: "success",
        text:
          editingProduct.rowCompanyId != null
            ? `Đã cập nhật SKU ${updatedSku} (MST ${editingProduct.rowCompanyTaxCode || editingProduct.rowCompanyCode}) thành công.`
            : `Đã cập nhật thông tin SKU ${updatedSku} thành công.`,
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
      setEditingNppKey(null);
      return;
    }
    setSavingNppKey(product.rowKey);
    try {
      const matchedIp = formatted
        ? nppProductOptions.find((opt) => opt.code.trim().toUpperCase() === formatted)
        : null;

      if (formatted && !matchedIp?.id) {
        throw new Error(
          `Mã SP xuất hóa đơn "${formatted}" chưa có trong Danh sách SP xuất hóa đơn. Vui lòng tạo trước hoặc chọn từ danh sách gợi ý.`
        );
      }

      const res = await apiFetch(`${API_URL}/products/${product.id}/invoice-product`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoice_product_id: matchedIp?.id ?? null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Không thể gán Mã SP xuất hóa đơn cho SKU này.");
      }

      setProducts((prev) =>
        prev.map((p) => {
          if (p.id !== product.id) return p;
          const nextManaged = (p.managed_companies || []).map((mc) => ({
            ...mc,
            npp_code: formatted || null,
          }));
          const updated = {
            ...p,
            nppCode: formatted,
            internal_name: matchedIp?.name || "",
            internal_unit: matchedIp?.unit || "",
            managed_companies: nextManaged,
          };
          updated._searchKey = buildProductSearchKey(updated);
          return updated;
        })
      );
      setBannerMsg({
        type: "success",
        text: formatted
          ? `Đã gán SKU ${product.code} → Mã SP xuất hóa đơn "${formatted}" (${matchedIp?.name || ""}).`
          : `Đã gỡ Mã SP xuất hóa đơn khỏi SKU ${product.code}.`,
      });
      setEditingNppKey(null);
    } catch (err) {
      setBannerMsg({
        type: "error",
        text: err instanceof Error ? err.message : "Lỗi khi cập nhật Mã SP xuất hóa đơn.",
      });
    } finally {
      setSavingNppKey(null);
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
      setProducts((prev) => prev.filter((p) => p.id !== productId));
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
      setProducts((prev) => prev.filter((p) => !selectedIds.has(p.id)));
      setSelectedIds(new Set());
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
    setCreateNppSearchQuery("");
    setShowCreateNppDropdown(false);
    setForm({
      sku: "",
      npp_code: "",
      name: "",
      category_id: String(categories[0]?.id ?? "1"),
      unit_id: String(units[0]?.id ?? "1"),
      supplier: supplierOptions[0]?.name || "Vinamilk",
      base_price: "0",
      cost_price: "0",
      vat_rate: "",
      boxes_per_carton: "1",
      reorder_level: "20",
      status: "active",
    });
    setCreateOpen(true);
  }

  function openEditModal(product: ProductRow) {
    setModalError("");
    setEditingProduct(product);
    setEditNppSearchQuery("");
    setShowEditNppDropdown(false);
    setEditForm({
      sku: product.code,
      npp_code: product.nppCode || "",
      internal_name: product.internal_name || "",
      internal_unit: product.internal_unit || "",
      name: product.name,
      category_id: String(product.category_id),
      unit_id: String(product.unit_id),
      supplier: product.supplier,
      base_price: String(product.price),
      cost_price: String(product.cost_price),
      vat_rate: product.vat_rate != null ? String(product.vat_rate) : "",
      boxes_per_carton: String(product.boxes_per_carton),
      reorder_level: String(product.reorder_level),
      status: product.status,
    });
    setEditOpen(true);
  }

  // Đếm số lượng mã NPP đã ghép / chưa ghép
  const nppUnmappedCount = useMemo(
    () => nppProductOptions.filter((x) => !x.mappedSku).length,
    [nppProductOptions]
  );
  const nppMappedCount = useMemo(
    () => nppProductOptions.filter((x) => Boolean(x.mappedSku)).length,
    [nppProductOptions]
  );

  // Tự động đóng dropdown khi click ra ngoài hoặc bấm Escape
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (editNppContainerRef.current && !editNppContainerRef.current.contains(e.target as Node)) {
        setShowEditNppDropdown(false);
      }
      if (createNppContainerRef.current && !createNppContainerRef.current.contains(e.target as Node)) {
        setShowCreateNppDropdown(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setShowEditNppDropdown(false);
        setShowCreateNppDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // Tự động focus nhanh mượt khi mở dropdown mã NPP mà không gây giật lag
  useEffect(() => {
    if (showEditNppDropdown) {
      requestAnimationFrame(() => {
        editNppSearchInputRef.current?.focus();
      });
    }
  }, [showEditNppDropdown]);

  useEffect(() => {
    if (showCreateNppDropdown) {
      requestAnimationFrame(() => {
        createNppSearchInputRef.current?.focus();
      });
    }
  }, [showCreateNppDropdown]);

  // Lọc danh sách mã NPP nội bộ khi tìm kiếm trong Modal Chỉnh sửa SKU
  const filteredEditNppOptions = useMemo(() => {
    let list = nppProductOptions;
    if (editNppFilterTab === "UNMAPPED") {
      list = list.filter(
        (item) =>
          !item.mappedSku ||
          (editingProduct && item.mappedSku.toUpperCase() === editingProduct.code.toUpperCase())
      );
    } else if (editNppFilterTab === "MAPPED") {
      list = list.filter((item) => Boolean(item.mappedSku));
    }
    const q = editNppSearchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (item) =>
        item.code.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        item.supplier.toLowerCase().includes(q)
    );
  }, [nppProductOptions, editNppFilterTab, editNppSearchQuery, editingProduct]);

  // Thông tin chi tiết mã NPP đã chọn trong editForm
  const selectedEditNppItem = useMemo(() => {
    if (!editForm.npp_code) return null;
    return (
      nppProductOptions.find(
        (item) => item.code.toUpperCase() === editForm.npp_code.toUpperCase()
      ) || null
    );
  }, [nppProductOptions, editForm.npp_code]);

  // Lọc danh sách mã NPP nội bộ khi tìm kiếm trong Modal Thêm mới SKU
  const filteredCreateNppOptions = useMemo(() => {
    let list = nppProductOptions;
    if (createNppFilterTab === "UNMAPPED") {
      list = list.filter((item) => !item.mappedSku);
    } else if (createNppFilterTab === "MAPPED") {
      list = list.filter((item) => Boolean(item.mappedSku));
    }
    const q = createNppSearchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (item) =>
        item.code.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        item.supplier.toLowerCase().includes(q)
    );
  }, [nppProductOptions, createNppFilterTab, createNppSearchQuery]);

  // Thông tin chi tiết mã NPP đã chọn trong form thêm mới
  const selectedCreateNppItem = useMemo(() => {
    if (!form.npp_code) return null;
    return (
      nppProductOptions.find(
        (item) => item.code.toUpperCase() === form.npp_code.toUpperCase()
      ) || null
    );
  }, [nppProductOptions, form.npp_code]);

  const pagedProducts = products;
  const filteredProducts = products;
  const safePage = currentPage;

  const filteredTotals = useMemo(() => {
    let totalOrderedQty = 0;
    let totalPurchasedQty = 0;
    let withPriceCount = 0;
    for (const p of products) {
      totalOrderedQty += p.total_ordered_qty;
      totalPurchasedQty += p.total_purchased_qty;
      if (p.price > 0) withPriceCount++;
    }
    return {
      totalOrderedQty,
      totalPurchasedQty,
      withPriceCount,
    };
  }, [products]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortOrder(field === "price" || field === "cost_price" || field === "activity" ? "desc" : "asc");
    }
    setCurrentPage(1);
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
    setSearchInput("");
    setSearchQuery("");
    setDistributorFilter(isSuperAdmin ? "ALL" : (authSession.distributorCode || "ALL"));
    setCompanyFilter("ALL");
    setInternalCodeFilter("ALL");
    setCategoryFilter("ALL");
    setSupplierFilter("ALL");
    setUnitFilter("ALL");
    setStatusFilter("ALL");
    setCurrentPage(1);
  }

  async function exportProducts() {
    if (totalItems === 0) return;
    setIsExporting(true);
    setBannerMsg(null);
    try {
      const params = new URLSearchParams({
        page: "1",
        page_size: String(Math.max(1000, totalItems)),
        sort_field: sortField,
        sort_order: sortOrder,
      });
      if (searchQuery.trim()) params.set("search", searchQuery.trim());
      if (categoryFilter !== "ALL") params.set("category_id", categoryFilter);
      if (supplierFilter !== "ALL") params.set("supplier", supplierFilter);
      if (unitFilter !== "ALL") params.set("unit", unitFilter);
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (companyFilter === "UNASSIGNED") {
        params.set("company_id", "0");
      } else if (companyFilter !== "ALL") {
        params.set("company_id", companyFilter);
      }
      if (internalCodeFilter === "MAPPED") {
        params.set("has_internal_code", "true");
      } else if (internalCodeFilter === "UNMAPPED") {
        params.set("has_internal_code", "false");
      }
      if (!isSuperAdmin && authSession.distributorCode) {
        params.set("distributor_code", authSession.distributorCode);
      } else if (distributorFilter !== "ALL") {
        params.set("distributor_code", distributorFilter);
      }

      const res = await apiFetch(`${API_URL}/products/paged?${params.toString()}`);
      if (!res.ok) throw new Error("Không thể tải toàn bộ danh sách sản phẩm theo bộ lọc.");
      const data = await res.json();
      const rawItems: ApiProductItem[] = data.items || [];

      const catById = new Map(categories.map((c) => [c.id, c]));
      const unitById = new Map(units.map((u) => [u.id, u]));

      const activeDistCode = !isSuperAdmin
        ? authSession.distributorCode
        : (distributorFilter !== "ALL" ? distributorFilter : "");

      const exportRows = rawItems.map((product, index) => {
        const catObj = catById.get(product.category_id);
        const unitObj = unitById.get(product.unit_id);
        const dists = product.distributors || [];
        const matchedDist = activeDistCode
          ? dists.find((d) => d.code.toUpperCase() === activeDistCode.toUpperCase())
          : dists[0];
        const distName = matchedDist?.name || dists[0]?.name || "Chưa xác định";

        return {
          STT: index + 1,
          "Nhà phân phối": distName,
          "MST đầu vào (CQT)": product.row_company_tax_code || product.row_company_code || "",
          "Công ty quản lý": product.row_company_short_name || product.row_company_name || "",
          "Mã SKU": product.sku,
          "Mã NPP nội bộ": (product.row_company_id != null ? product.row_company_npp_code : product.npp_code) || "",
          "Tên sản phẩm": product.name,
          "Mã danh mục": product.category_code || catObj?.code || "",
          "Danh mục ngành hàng": product.category_name || catObj?.name || "Chưa phân loại",
          ĐVT: product.unit_name || unitObj?.name || "Hộp",
          "Quy cách (Hộp/Thùng)": Math.max(1, Number(product.boxes_per_carton ?? 1)),
          "Nhà cung cấp": (product.supplier || "Vinamilk").trim(),
          "Giá bán / ĐVT (VNĐ)": Number(product.base_price ?? 0),
          "Trạng thái": product.status === "active" ? "Đang kinh doanh" : "Ngừng kinh doanh",
        };
      });

      downloadExcel(
        exportRows,
        `Danh_sach_SKU_${new Date().toISOString().slice(0, 10)}`,
        "Danh sách SKU"
      );
    } catch (err) {
      setBannerMsg({
        type: "error",
        text: err instanceof Error ? err.message : "Lỗi khi xuất file Excel.",
      });
    } finally {
      setIsExporting(false);
    }
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
              Sản Phẩm Đầu Vào (SKU Đồng Bộ Từ CQT)
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
              disabled={isExporting || totalItems === 0}
              className="inline-flex items-center gap-1 rounded bg-white/10 hover:bg-white/20 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors disabled:opacity-50"
              title={`Xuất toàn bộ ${totalItems} SKU theo bộ lọc ra file Excel`}
            >
              {isExporting ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <FileSpreadsheet size={12} />
              )}
              Xuất Excel ({totalItems})
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
            <div className="flex items-center justify-between rounded border border-slate-300 bg-white px-2.5 py-1.5">
              <div>
                <p className="text-[10px] font-semibold uppercase text-slate-500">Tổng danh mục SKU</p>
                <p className="text-sm font-bold text-slate-900">
                  {formatNumber(stats.total)}{" "}
                  <span className="text-[10px] font-normal text-slate-500">sản phẩm</span>
                </p>
              </div>
              <Package size={16} className="text-sky-700" />
            </div>

            <div className="flex items-center justify-between rounded border border-slate-300 bg-white px-2.5 py-1.5">
              <div>
                <p className="text-[10px] font-semibold uppercase text-slate-500">Đang kinh doanh</p>
                <p className="text-sm font-bold text-emerald-700">
                  {formatNumber(stats.activeCount)}{" "}
                  <span className="text-[10px] font-normal text-slate-500">SKU</span>
                </p>
              </div>
              <CheckCircle2 size={16} className="text-emerald-600" />
            </div>

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
                  Có giá bán / ĐVT
                </p>
                <p className="text-sm font-bold text-slate-800">
                  {formatNumber(stats.pricedCount)}{" "}
                  <span className="text-[10px] font-normal text-slate-500">SKU</span>
                </p>
              </div>
              <Check size={16} className="text-sky-600" />
            </button>

            <button
              type="button"
              onClick={() =>
                setStatusFilter((prev) => (prev === "ZERO_PRICE" ? "ALL" : "ZERO_PRICE"))
              }
              className={cn(
                "flex items-center justify-between rounded border px-2.5 py-1.5 text-left transition-colors",
                statusFilter === "ZERO_PRICE"
                  ? "border-sky-600 bg-sky-50/80"
                  : "border-slate-300 bg-white hover:border-sky-400"
              )}
            >
              <div>
                <p className="text-[10px] font-semibold uppercase text-slate-500">
                  Hàng khuyến mại (KM)
                </p>
                <p className="text-sm font-bold text-amber-700">
                  {formatNumber(stats.zeroPriceCount)}{" "}
                  <span className="text-[10px] font-normal text-slate-500">SKU</span>
                </p>
              </div>
              <AlertTriangle size={16} className="text-amber-600" />
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
          <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2 xl:grid-cols-6">
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
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Nhập mã SKU (VD: 01TD03, 04ED33, 1277436) hoặc tên sản phẩm..."
                  className={cn(inputCls, "pl-7 pr-6")}
                />
                {searchInput && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchInput("");
                      setSearchQuery("");
                      setCurrentPage(1);
                    }}
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
                Nhà phân phối (theo Phạm vi NPP)
              </label>
              <div
                className="w-full min-w-0 rounded border border-sky-200 bg-sky-50/60 px-2 py-1 text-xs font-semibold text-sky-900 truncate"
                title={
                  effectiveDistributor
                    ? `[${effectiveDistributor.code}] ${effectiveDistributor.name}`
                    : isSuperAdmin
                    ? "Tất cả Nhà phân phối"
                    : authSession.distributorName || authSession.distributorCode
                }
              >
                {effectiveDistributor
                  ? `[${effectiveDistributor.code}] ${effectiveDistributor.name}`
                  : isSuperAdmin
                  ? "Tất cả Nhà phân phối"
                  : authSession.distributorName || authSession.distributorCode}
              </div>
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
                MST đầu vào (CQT)
              </label>
              <select
                value={companyFilter}
                onChange={(e) => {
                  setCompanyFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className={inputCls}
              >
                <option value="ALL">Tất cả Công ty ({companyOptions.length})</option>
                <option value="UNASSIGNED">Chưa có Công ty quản lý</option>
                {companyOptions.map((comp) => (
                  <option key={comp.id} value={String(comp.id)}>
                    {comp.tax_code ? `[${comp.tax_code}] ` : ""}
                    {comp.short_name || comp.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                Trạng thái Mã nội bộ
              </label>
              <select
                value={internalCodeFilter}
                onChange={(e) => {
                  setInternalCodeFilter(e.target.value as "ALL" | "MAPPED" | "UNMAPPED");
                  setCurrentPage(1);
                }}
                className={inputCls}
              >
                <option value="ALL">Tất cả SKU</option>
                <option value="MAPPED">Đã gán Mã nội bộ</option>
                <option value="UNMAPPED">Chưa gán Mã nội bộ</option>
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
                <>
                  {companyOptions.length > 0 && (
                    <div className="inline-flex items-center gap-1 rounded border border-sky-300 bg-sky-50 px-1.5 py-0.5">
                      <select
                        value={bulkCompanyId}
                        onChange={(e) => setBulkCompanyId(e.target.value)}
                        className="rounded border border-sky-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-700 max-w-[170px] focus:outline-none"
                      >
                        <option value="">Gán Cty quản lý...</option>
                        {companyOptions.map((c) => (
                          <option key={c.id} value={String(c.id)}>
                            {c.tax_code ? `[${c.tax_code}] ` : ""}
                            {c.short_name || c.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={!bulkCompanyId || bulkAssigningCompany}
                        onClick={async () => {
                          if (!bulkCompanyId || selectedIds.size === 0) return;
                          setBulkAssigningCompany(true);
                          try {
                            const resp = await apiFetch(`${API_URL}/products/bulk-assign-company`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                product_ids: Array.from(selectedIds),
                                company_id: Number(bulkCompanyId),
                                set_as_primary: true,
                              }),
                            });
                            const data = (await resp.json().catch(() => ({}))) as {
                              updated?: number;
                              company_name?: string;
                              detail?: string;
                            };
                            if (!resp.ok) throw new Error(data.detail || "Không thể gán công ty hàng loạt.");
                            setBannerMsg({
                              type: "success",
                              text: `Đã gán Công ty quản lý "${data.company_name || ""}" cho ${data.updated ?? selectedIds.size} SKU.`,
                            });
                            setBulkCompanyId("");
                            setSelectedIds(new Set());
                            void loadCatalog(false);
                          } catch (e) {
                            setBannerMsg({
                              type: "error",
                              text: e instanceof Error ? e.message : "Lỗi khi gán công ty quản lý hàng loạt.",
                            });
                          } finally {
                            setBulkAssigningCompany(false);
                          }
                        }}
                        className="inline-flex items-center gap-1 rounded bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 px-2 py-0.5 text-[11px] font-semibold text-white transition-colors"
                      >
                        {bulkAssigningCompany ? <Loader2 size={11} className="animate-spin" /> : <Building2 size={11} />}
                        Gán ({selectedIds.size})
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setBulkDeleteConfirm(true)}
                    className="inline-flex items-center gap-1 rounded bg-red-700 hover:bg-red-800 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors"
                  >
                    <Trash2 size={12} />
                    Xóa đã chọn ({selectedIds.size})
                  </button>
                </>
              )}

              {(searchQuery ||
                (isSuperAdmin ? distributorFilter !== "ALL" : false) ||
                companyFilter !== "ALL" ||
                internalCodeFilter !== "ALL" ||
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
                href="/products/invoice-products"
                className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 transition-colors"
              >
                <FileText size={11} />
                Sản phẩm XHĐ
              </Link>
              <Link
                href="/products/company-management"
                className="inline-flex items-center gap-1 rounded border border-sky-200 bg-sky-50 hover:bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-800 transition-colors"
              >
                <Building2 size={11} />
                Sản phẩm DMS
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
                <th className="px-2.5 py-2">Nhà phân phối</th>
                <th className="px-2.5 py-2" title="Pháp nhân & Mã số thuế đứng tên mua vào trên Hóa đơn CQT hoặc được gán quản lý SKU">
                  MST đầu vào (CQT)
                </th>
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
                    title="Mã sản phẩm xuất hóa đơn chuẩn (chọn trực tiếp từ Danh sách SP xuất hóa đơn)"
                  >
                    Mã SP xuất HĐ {renderSortIcon("nppCode")}
                  </button>
                </th>
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
                    Quy cách (ĐVT/Thùng) {renderSortIcon("boxes_per_carton")}
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
                <th className="px-2.5 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => handleSort("price")}
                    className="inline-flex items-center justify-end gap-1 font-semibold uppercase text-slate-700 hover:text-sky-700"
                  >
                    Giá bán / ĐVT {renderSortIcon("price")}
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
                      key={row.rowKey}
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

                      {/* CỘT NHÀ PHÂN PHỐI HIỂN THỊ ĐẦU TIÊN (MỖI DÒNG CHỈ 1 NPP) */}
                      <td className="px-2.5 py-1.5 whitespace-nowrap">
                        {(() => {
                          const activeCode = !isSuperAdmin
                            ? authSession.distributorCode
                            : (distributorFilter !== "ALL" ? distributorFilter : "");
                          const matchedDist = activeCode
                            ? row.distributors.find((d) => d.code.toUpperCase() === activeCode.toUpperCase())
                            : row.distributors[0];
                          const distName = matchedDist?.name || row.distributors[0]?.name;
                          return distName ? (
                            <span
                              title={distName}
                              className="max-w-44 truncate inline-block rounded border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-800"
                            >
                              {distName}
                            </span>
                          ) : (
                            <span className="text-[10px] italic text-slate-400">Chưa xác định</span>
                          );
                        })()}
                      </td>

                      {/* CỘT CÔNG TY QUẢN LÝ / MST ĐẦU VÀO (MỖI MST LÀ 1 DÒNG RIÊNG BIỆT) */}
                      <td className="px-2.5 py-1.5 max-w-[220px]">
                        {row.rowCompanyId != null ? (
                          <div
                            className="min-w-0"
                            title={`${row.rowCompanyTaxCode || row.rowCompanyCode} - ${row.rowCompanyName}${
                              row.rowCompanyPurchasedQty > 0
                                ? ` (Nhập CQT: ${formatNumber(row.rowCompanyPurchasedQty)})`
                                : ""
                            }`}
                          >
                            <div className="flex items-center gap-1">
                              <span className="font-mono text-[11px] font-bold text-slate-800">
                                {row.rowCompanyTaxCode || row.rowCompanyCode}
                              </span>
                              {row.rowCompanyHasConversion && (
                                <span
                                  className="rounded bg-sky-100 border border-sky-200 px-1 py-0 text-[9px] font-bold text-sky-800"
                                  title="Dòng MST này có cấu hình đổi quy cách / tên riêng khi xuất HĐ"
                                >
                                  QĐ
                                </span>
                              )}
                            </div>
                            <div className="truncate text-[10px] text-slate-500">
                              {row.rowCompanyShortName || row.rowCompanyName}
                            </div>
                          </div>
                        ) : (
                          <span className="text-[10px] italic text-slate-400">—</span>
                        )}
                      </td>

                      <td className="px-2.5 py-1.5 whitespace-nowrap">
                        <span className="font-mono font-bold text-sky-800">
                          {row.code}
                        </span>
                      </td>

                      {/* CỘT MÃ NPP NỘI BỘ THEO TỪNG MST VỚI INLINE EDIT */}
                      <td
                        className="px-2.5 py-1.5 whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {editingNppKey === row.rowKey ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              autoFocus
                              list="sku-npp-options-datalist"
                              value={inlineNppCode}
                              onChange={(e) => setInlineNppCode(e.target.value.toUpperCase())}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  void handleSaveNppCode(row, inlineNppCode);
                                } else if (e.key === "Escape") {
                                  setEditingNppKey(null);
                                }
                              }}
                              disabled={savingNppKey === row.rowKey}
                              placeholder="Mã NPP"
                              className="h-6 w-28 rounded border border-sky-400 bg-white px-1.5 font-mono text-[11px] font-bold uppercase text-slate-800 focus:outline-none focus:ring-1 focus:ring-sky-500"
                            />
                            <button
                              type="button"
                              disabled={savingNppKey === row.rowKey}
                              onClick={() => void handleSaveNppCode(row, inlineNppCode)}
                              className="rounded bg-sky-600 p-1 text-white hover:bg-sky-700 disabled:bg-slate-300"
                              title="Lưu mã NPP (Enter)"
                            >
                              {savingNppKey === row.rowKey ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <Check size={12} />
                              )}
                            </button>
                            <button
                              type="button"
                              disabled={savingNppKey === row.rowKey}
                              onClick={() => setEditingNppKey(null)}
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
                                title={
                                  row.rowCompanyTaxCode
                                    ? `Mã NPP nội bộ cho MST ${row.rowCompanyTaxCode}: ${row.nppCode}`
                                    : `Mã NPP nội bộ: ${row.nppCode}`
                                }
                              >
                                {row.nppCode}
                              </span>
                            ) : (
                              <span className="text-[10px] italic text-slate-400">—</span>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setEditingNppKey(row.rowKey);
                                setInlineNppCode(row.nppCode || "");
                              }}
                              className="rounded p-0.5 text-slate-400 opacity-60 hover:bg-sky-50 hover:text-sky-700 hover:opacity-100 group-hover:opacity-100 transition-opacity"
                              title={
                                row.rowCompanyTaxCode
                                  ? `Gán / sửa Mã NPP nội bộ cho MST ${row.rowCompanyTaxCode}`
                                  : "Chỉnh sửa mã NPP nội bộ"
                              }
                            >
                              <Pencil size={11} />
                            </button>
                          </div>
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
                            {row.boxes_per_carton}
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

                      {/* GIÁ BÁN THEO ĐVT */}
                      <td className="px-2.5 py-1.5 text-right font-medium text-slate-700 whitespace-nowrap">
                        {row.price > 0 ? (
                          <div className="flex items-center justify-end gap-1">
                            <span className="font-semibold text-slate-900">
                              {formatUnitPrice(row.price, 4)}
                            </span>
                            <span className="text-[10px] font-medium text-slate-500">
                              / {row.unit}
                            </span>
                            {row.vat_rate !== null && (
                              <span
                                title={`Thuế suất VAT (${row.vat_rate_source === "PURCHASE_INVOICE" ? "Tự học từ CQT" : "Thủ công"})`}
                                className="rounded border border-violet-200 bg-violet-50 px-1 py-0 text-[9px] font-bold text-violet-700"
                              >
                                {row.vat_rate < 0 ? "KCT" : `VAT ${row.vat_rate}%`}
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-1">
                            <span className="text-[10px] italic text-amber-700">
                              {formatUnitPrice(0, 4)}
                            </span>
                            <span className="text-[10px] font-medium text-slate-500">
                              / {row.unit} (KM)
                            </span>
                          </div>
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
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] text-slate-800 focus:border-sky-500 focus:outline-none"
              >
                <option value={20}>20 dòng</option>
                <option value={50}>50 dòng</option>
                <option value={100}>100 dòng</option>
                <option value={200}>200 dòng</option>
              </select>
            </label>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold text-slate-600 mr-1">
              Trang {safePage} / {totalPages} (Tổng {formatNumber(totalItems)} SKU)
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
            className="w-full max-w-6xl border border-slate-400 bg-white shadow-2xl max-h-[92vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="bg-[#14263d] px-4 py-2.5 text-white flex items-center justify-between shrink-0">
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

            <form onSubmit={createProduct} className="flex flex-col flex-1 overflow-y-auto">
              {modalError && (
                <div className="mx-3 mt-2 flex items-center gap-2 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  <AlertTriangle size={14} />
                  <span>{modalError}</span>
                </div>
              )}

              {/* KHỐI 1: ĐỊNH DANH SẢN PHẨM & LIÊN KẾT MÃ NPP NỘI BỘ */}
              <section className="border-b border-slate-200 bg-slate-50/40 p-4">
                <div className="text-[11px] font-bold text-sky-800 uppercase flex items-center gap-1.5 mb-3">
                  <Layers size={13} className="text-sky-600" />
                  <span>1. Định danh sản phẩm & Ghép nối Mã SP NPP</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5">
                  {/* Mã SKU */}
                  <div className="md:col-span-4">
                    <label className="text-[10px] font-semibold text-slate-600 block mb-1">
                      Mã sản phẩm (SKU) <span className="text-red-600">*</span>
                    </label>
                    <input
                      required
                      value={form.sku}
                      onChange={(e) => setForm({ ...form, sku: e.target.value.toUpperCase() })}
                      placeholder="VD: 01TD03"
                      className={cn(inputCls, "font-mono font-bold uppercase text-sky-900 bg-white")}
                    />
                    <span className="text-[10px] text-slate-400 mt-0.5 block">
                      Mã SKU chính dùng quản lý kho & hóa đơn CQT
                    </span>
                  </div>

                  {/* Combobox Mã SP NPP chuyên nghiệp */}
                  <div className="md:col-span-8" ref={createNppContainerRef}>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] font-semibold text-slate-600 flex items-center gap-1.5">
                        <Link2 size={12} className="text-sky-600" />
                        <span>Mã SP NPP (Nội bộ / Web NCC)</span>
                      </label>
                      <span className="text-[10px] text-slate-500">
                        {nppProductOptions.length} mã NPP trong hệ thống
                      </span>
                    </div>

                    {/* TRƯỜNG HỢP 1: ĐÃ CHỌN MÃ NPP */}
                    {form.npp_code ? (
                      <div className="flex items-center justify-between gap-3 rounded border border-sky-300 bg-sky-50/80 p-2 shadow-sm">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1 rounded bg-sky-700 px-2 py-0.5 font-mono text-xs font-bold text-white shadow-sm">
                              <Link2 size={11} />
                              {form.npp_code}
                            </span>
                            <span className="font-semibold text-xs text-slate-800 truncate">
                              {selectedCreateNppItem?.name || "Sản phẩm NPP nội bộ"}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-600">
                            <span>
                              Nhà cung cấp: <strong className="text-slate-800">{selectedCreateNppItem?.supplier || "—"}</strong>
                            </span>
                            <span>
                              ĐVT: <strong className="text-slate-800">{selectedCreateNppItem?.unit || "—"}</strong>
                            </span>
                            {selectedCreateNppItem?.unitPrice ? (
                              <span>
                                Đơn giá NCC:{" "}
                                <strong className="text-emerald-700">
                                  {formatNumber(selectedCreateNppItem.unitPrice)} đ
                                </strong>
                              </span>
                            ) : null}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setCreateNppSearchQuery("");
                              setShowCreateNppDropdown(true);
                            }}
                            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white hover:bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm transition-colors"
                          >
                            <Pencil size={11} /> Đổi mã
                          </button>
                          <button
                            type="button"
                            onClick={() => setForm({ ...form, npp_code: "" })}
                            className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 hover:bg-red-100 px-2.5 py-1 text-xs font-medium text-red-600 transition-colors"
                            title="Bỏ liên kết mã NPP"
                          >
                            <X size={11} /> Bỏ gắn
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* TRƯỜNG HỢP 2: CHƯA CHỌN MÃ NPP */
                      <div className="relative">
                        <Search
                          size={13}
                          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                        />
                        <input
                          type="text"
                          value={createNppSearchQuery}
                          onChange={(e) => {
                            setCreateNppSearchQuery(e.target.value);
                            setShowCreateNppDropdown(true);
                          }}
                          onFocus={() => setShowCreateNppDropdown(true)}
                          placeholder="Tìm kiếm theo mã NPP nội bộ hoặc tên sản phẩm để gắn vào SKU..."
                          className={cn(inputCls, "pl-8 pr-24 text-xs font-medium")}
                        />
                        <button
                          type="button"
                          onClick={() => setShowCreateNppDropdown(!showCreateNppDropdown)}
                          className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold text-sky-700 hover:text-sky-900 rounded bg-sky-50 hover:bg-sky-100 border border-sky-200"
                        >
                          <Search size={11} /> Tìm chọn
                          <ChevronDown size={11} />
                        </button>
                      </div>
                    )}

                    {/* POPUP DROPDOWN TÌM KIẾM MÃ NPP */}
                    <div className={cn("relative", !showCreateNppDropdown && "hidden")}>
                      <div className="absolute left-0 right-0 top-1.5 z-[70] rounded-md border border-slate-300 bg-white shadow-2xl overflow-hidden flex flex-col">
                        <div className="p-2 border-b border-slate-200 bg-slate-50 space-y-1.5">
                          <div className="relative">
                            <Search
                              size={13}
                              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                            />
                            <input
                              ref={createNppSearchInputRef}
                              type="text"
                              value={createNppSearchQuery}
                              onChange={(e) => setCreateNppSearchQuery(e.target.value)}
                              placeholder="Gõ mã hoặc tên sản phẩm NPP để lọc nhanh..."
                              className="w-full rounded border border-slate-300 bg-white pl-8 pr-7 py-1 text-xs text-slate-800 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none"
                            />
                              {createNppSearchQuery && (
                                <button
                                  type="button"
                                  onClick={() => setCreateNppSearchQuery("")}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                >
                                  <X size={12} />
                                </button>
                              )}
                            </div>
                            <div className="flex items-center justify-between text-[11px]">
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => setCreateNppFilterTab("ALL")}
                                  className={cn(
                                    "px-2 py-0.5 rounded text-[10px] font-semibold transition-colors",
                                    createNppFilterTab === "ALL"
                                      ? "bg-sky-600 text-white"
                                      : "bg-slate-200 text-slate-700 hover:bg-slate-300"
                                  )}
                                >
                                  Tất cả ({nppProductOptions.length})
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setCreateNppFilterTab("UNMAPPED")}
                                  className={cn(
                                    "px-2 py-0.5 rounded text-[10px] font-semibold transition-colors",
                                    createNppFilterTab === "UNMAPPED"
                                      ? "bg-sky-600 text-white"
                                      : "bg-slate-200 text-slate-700 hover:bg-slate-300"
                                  )}
                                >
                                  Chưa ghép SKU ({nppUnmappedCount})
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setCreateNppFilterTab("MAPPED")}
                                  className={cn(
                                    "px-2 py-0.5 rounded text-[10px] font-semibold transition-colors",
                                    createNppFilterTab === "MAPPED"
                                      ? "bg-sky-600 text-white"
                                      : "bg-slate-200 text-slate-700 hover:bg-slate-300"
                                  )}
                                >
                                  Đã ghép ({nppMappedCount})
                                </button>
                              </div>
                              <span className="text-slate-500 text-[10px]">
                                Kết quả: <strong>{filteredCreateNppOptions.length}</strong> mã
                              </span>
                            </div>
                          </div>

                          <div className="overflow-y-auto max-h-64 divide-y divide-slate-100">
                            {filteredCreateNppOptions.length === 0 ? (
                              <div className="p-4 text-center text-xs text-slate-400">
                                Không tìm thấy mã sản phẩm NPP nào phù hợp.
                              </div>
                            ) : (
                              filteredCreateNppOptions.slice(0, 50).map((npp) => {
                                const isSelected =
                                  form.npp_code.toUpperCase() === npp.code.toUpperCase();

                                return (
                                  <div
                                    key={npp.code}
                                    onClick={() => {
                                      setForm((prev) => ({
                                        ...prev,
                                        npp_code: npp.code,
                                        name: prev.name ? prev.name : npp.name,
                                        supplier: prev.supplier || npp.supplier,
                                      }));
                                      setShowCreateNppDropdown(false);
                                      setCreateNppSearchQuery("");
                                    }}
                                    className={cn(
                                      "p-2.5 hover:bg-sky-50/80 cursor-pointer transition-colors flex items-center justify-between gap-3 text-left",
                                      isSelected && "bg-sky-100/70 border-l-4 border-sky-600"
                                    )}
                                  >
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-2">
                                        <span className="font-mono text-xs font-bold text-sky-800 bg-sky-50 border border-sky-200 px-1.5 py-0.5 rounded">
                                          {npp.code}
                                        </span>
                                        <span className="text-xs font-semibold text-slate-800 truncate">
                                          {npp.name}
                                        </span>
                                        {isSelected ? (
                                          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-800">
                                            ✓ Đang chọn
                                          </span>
                                        ) : npp.mappedSku ? (
                                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-800">
                                            Đã ghép: {npp.mappedSku}
                                          </span>
                                        ) : (
                                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-500">
                                            Chưa ghép
                                          </span>
                                        )}
                                      </div>
                                      <div className="mt-1 flex items-center gap-3 text-[10px] text-slate-500">
                                        <span>
                                          NCC: <strong className="text-slate-700">{npp.supplier}</strong>
                                        </span>
                                        {npp.unit && (
                                          <span>
                                            ĐVT: <strong className="text-slate-700">{npp.unit}</strong>
                                          </span>
                                        )}
                                        {npp.orderCount > 0 && (
                                          <span>
                                            Đơn đặt: <strong>{npp.orderCount}</strong>
                                          </span>
                                        )}
                                        {npp.companyName && (
                                          <span>NPP: {npp.companyName}</span>
                                        )}
                                      </div>
                                    </div>

                                    <div className="text-right shrink-0">
                                      {npp.unitPrice > 0 && (
                                        <div className="text-xs font-bold text-slate-800 font-mono">
                                          {formatNumber(npp.unitPrice)} đ
                                        </div>
                                      )}
                                      {isSelected ? (
                                        <span className="inline-block mt-0.5 rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm">
                                          Đang chọn ✓
                                        </span>
                                      ) : (
                                        <span className="inline-block mt-0.5 rounded bg-sky-600 hover:bg-sky-700 px-2 py-0.5 text-[10px] font-semibold text-white transition-colors">
                                          Chọn ↵
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })
                            )}
                            {filteredCreateNppOptions.length > 50 && (
                              <div className="p-2 text-center text-[10px] text-slate-500 bg-slate-50 border-t border-slate-100">
                                Đang hiển thị 50 / {filteredCreateNppOptions.length} mã. Nhập thêm từ khóa để tìm chính xác hơn.
                              </div>
                            )}
                          </div>

                          <div className="p-1.5 border-t border-slate-200 bg-slate-50 text-[10px] text-slate-500 flex items-center justify-between px-3">
                            <span>Nhấn vào dòng bất kỳ để chọn mã NPP</span>
                            <button
                              type="button"
                              onClick={() => setShowCreateNppDropdown(false)}
                              className="font-semibold text-sky-600 hover:underline"
                            >
                              Đóng [Esc]
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                  {/* Tên sản phẩm */}
                  <div className="col-span-12">
                    <label className="text-[10px] font-semibold text-slate-600 block mb-1">
                      Tên sản phẩm đầy đủ (Tên hiển thị) <span className="text-red-600">*</span>
                    </label>
                    <input
                      required
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="VD: Sữa đặc có đường Ông Thọ đỏ 380g"
                      className={cn(inputCls, "text-xs font-medium")}
                    />
                  </div>
                </div>
              </section>

              {/* KHỐI 2: THÔNG TIN PHÂN LOẠI & NHÀ CUNG CẤP */}
              <section className="border-b border-slate-200 p-4">
                <div className="text-[11px] font-bold text-sky-800 uppercase flex items-center gap-1.5 mb-3">
                  <Building2 size={13} className="text-sky-600" />
                  <span>2. Phân loại, Đơn vị tính & Nhà cung cấp</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                  <label className="text-[10px] font-semibold text-slate-600 block">
                    Danh mục ngành hàng
                    <select
                      value={form.category_id}
                      onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                      className={cn(inputCls, "mt-1")}
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
                      className={cn(inputCls, "mt-1")}
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
                      className={cn(inputCls, "mt-1")}
                    />
                    <datalist id="sku-suppliers-datalist">
                      {supplierOptions.map((s) => (
                        <option key={s.name} value={s.name} />
                      ))}
                    </datalist>
                  </label>

                  <label className="text-[10px] font-semibold text-slate-600 block">
                    Quy cách (Số hộp/thùng)
                    <input
                      type="number"
                      min={1}
                      value={form.boxes_per_carton}
                      onChange={(e) => setForm({ ...form, boxes_per_carton: e.target.value })}
                      className={cn(inputCls, "mt-1 text-center font-semibold")}
                    />
                  </label>
                </div>
              </section>

              {/* KHỐI 3: GIÁ BÁN & CHÍNH SÁCH TỒN KHO */}
              <section className="border-b border-slate-200 p-4">
                <div className="text-[11px] font-bold text-sky-800 uppercase flex items-center gap-1.5 mb-3">
                  <Tag size={13} className="text-sky-600" />
                  <span>3. Giá bán niêm yết & Chính sách tồn kho</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                  <label className="text-[10px] font-semibold text-slate-600 block">
                    Giá bán niêm yết (VNĐ)
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={form.base_price}
                      onChange={(e) => setForm({ ...form, base_price: e.target.value })}
                      className={cn(inputCls, "mt-1 text-right font-semibold")}
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
                      className={cn(inputCls, "mt-1 text-right font-semibold")}
                    />
                  </label>

                  <label className="text-[10px] font-semibold text-slate-600 block">
                    Tồn kho tối thiểu (Tái đặt)
                    <input
                      type="number"
                      min={0}
                      value={form.reorder_level}
                      onChange={(e) => setForm({ ...form, reorder_level: e.target.value })}
                      className={cn(inputCls, "mt-1 text-center font-semibold")}
                    />
                  </label>

                  <label className="text-[10px] font-semibold text-slate-600 block">
                    Thuế suất VAT (Học từ CQT / Xuất HĐ)
                    <select
                      value={editForm.vat_rate}
                      onChange={(e) => setEditForm({ ...editForm, vat_rate: e.target.value })}
                      className={cn(inputCls, "mt-1")}
                    >
                      <option value="">Mặc định theo hóa đơn (8%)</option>
                      <option value="0">0% (Thuế suất 0%)</option>
                      <option value="5">5%</option>
                      <option value="8">8%</option>
                      <option value="10">10%</option>
                      <option value="-1">KCT (Không chịu thuế)</option>
                    </select>
                  </label>

                  <label className="text-[10px] font-semibold text-slate-600 block">
                    Trạng thái kinh doanh
                    <select
                      value={form.status}
                      onChange={(e) => setForm({ ...form, status: e.target.value })}
                      className={cn(inputCls, "mt-1")}
                    >
                      <option value="active">Đang kinh doanh</option>
                      <option value="inactive">Ngừng kinh doanh</option>
                    </select>
                  </label>
                </div>
              </section>

              <footer className="border-t border-slate-300 bg-slate-100 px-4 py-2.5 flex items-center justify-between gap-3 shrink-0">
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
                    className="inline-flex items-center gap-1.5 rounded bg-sky-600 hover:bg-sky-700 px-4 py-1.5 text-xs font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:bg-slate-300"
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
            className="w-full max-w-6xl border border-slate-400 bg-white shadow-2xl max-h-[92vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="bg-[#14263d] px-4 py-2.5 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Pencil size={17} className="text-red-500" />
                <h2 className="text-xs font-bold uppercase tracking-wide text-white">
                  Cập Nhật Thông Tin Sản Phẩm · SKU: {editingProduct.code}
                </h2>
                {editingProduct.rowCompanyId != null && (
                  <span
                    className="rounded bg-amber-500/20 text-amber-200 border border-amber-400/30 px-2 py-0.5 text-[10px] font-mono"
                    title={editingProduct.rowCompanyName}
                  >
                    MST: {editingProduct.rowCompanyTaxCode || editingProduct.rowCompanyCode}
                    {editingProduct.rowCompanyShortName ? ` · ${editingProduct.rowCompanyShortName}` : ""}
                  </span>
                )}
                {editingProduct.sync_source && (
                  <span className="rounded bg-sky-500/20 text-sky-200 border border-sky-400/30 px-2 py-0.5 text-[10px] font-mono">
                    Nguồn: {editingProduct.sync_source}
                  </span>
                )}
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

            <form onSubmit={updateProduct} className="flex flex-col flex-1 overflow-y-auto">
              {modalError && (
                <div className="mx-4 mt-3 flex items-center gap-2 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  <AlertTriangle size={14} />
                  <span>{modalError}</span>
                </div>
              )}

              {/* KHỐI 1: ĐỊNH DANH SẢN PHẨM & LIÊN KẾT MÃ NPP NỘI BỘ */}
              <section className="border-b border-slate-200 bg-slate-50/40 p-4">
                <div className="text-[11px] font-bold text-sky-800 uppercase flex items-center gap-1.5 mb-3">
                  <Layers size={13} className="text-sky-600" />
                  <span>1. Định danh sản phẩm & Ghép nối Mã SP NPP</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5">
                  {/* Mã SKU CQT */}
                  <div className="md:col-span-4">
                    <label className="text-[10px] font-semibold text-slate-600 block mb-1">
                      Mã sản phẩm (SKU) <span className="text-red-600">*</span>
                    </label>
                    <input
                      required
                      value={editForm.sku}
                      onChange={(e) =>
                        setEditForm({ ...editForm, sku: e.target.value.toUpperCase() })
                      }
                      className={cn(inputCls, "font-mono font-bold uppercase text-sky-900 bg-white")}
                    />
                    <span className="text-[10px] text-slate-400 mt-0.5 block">
                      Mã SKU đồng bộ từ Cơ quan Thuế (CQT) hoặc hệ thống
                    </span>
                  </div>

                  {/* Combobox Mã SP NPP chuyên nghiệp */}
                  <div className="md:col-span-8" ref={editNppContainerRef}>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] font-semibold text-slate-600 flex items-center gap-1.5">
                        <Link2 size={12} className="text-sky-600" />
                        <span>
                          Mã SP NPP nội bộ
                          {editingProduct.rowCompanyTaxCode
                            ? ` (cho MST ${editingProduct.rowCompanyTaxCode})`
                            : " (Nội bộ / Web NCC)"}
                        </span>
                      </label>
                      <span className="text-[10px] text-slate-500">
                        {nppProductOptions.length} mã NPP trong hệ thống
                      </span>
                    </div>

                    {/* TRƯỜNG HỢP 1: ĐÃ CHỌN MÃ NPP -> HIỂN THỊ THẺ CHỌN CHUYÊN NGHIỆP */}
                    {editForm.npp_code ? (
                      <div className="flex items-center justify-between gap-3 rounded border border-sky-300 bg-sky-50/80 p-2 shadow-sm">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1 rounded bg-sky-700 px-2 py-0.5 font-mono text-xs font-bold text-white shadow-sm">
                              <Link2 size={11} />
                              {editForm.npp_code}
                            </span>
                            <span className="font-semibold text-xs text-slate-800 truncate">
                              {selectedEditNppItem?.name || "Sản phẩm NPP nội bộ"}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-600">
                            <span>
                              Nhà cung cấp: <strong className="text-slate-800">{selectedEditNppItem?.supplier || "—"}</strong>
                            </span>
                            <span>
                              ĐVT: <strong className="text-slate-800">{selectedEditNppItem?.unit || "—"}</strong>
                            </span>
                            {selectedEditNppItem?.unitPrice ? (
                              <span>
                                Đơn giá NCC:{" "}
                                <strong className="text-emerald-700">
                                  {formatNumber(selectedEditNppItem.unitPrice)} đ
                                </strong>
                              </span>
                            ) : null}
                            {selectedEditNppItem?.orderCount ? (
                              <span>
                                Đơn đặt DMS:{" "}
                                <strong className="text-sky-800">
                                  {selectedEditNppItem.orderCount} đơn
                                </strong>
                              </span>
                            ) : null}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setEditNppSearchQuery("");
                              setShowEditNppDropdown(true);
                            }}
                            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white hover:bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm transition-colors"
                          >
                            <Pencil size={11} /> Đổi mã khác
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditForm({ ...editForm, npp_code: "" })}
                            className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 hover:bg-red-100 px-2.5 py-1 text-xs font-medium text-red-600 transition-colors"
                            title="Bỏ liên kết mã NPP"
                          >
                            <X size={11} /> Bỏ gắn
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* TRƯỜNG HỢP 2: CHƯA CHỌN MÃ NPP -> KHUNG TÌM KIẾM TÍCH HỢP */
                      <div className="relative">
                        <Search
                          size={13}
                          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                        />
                        <input
                          type="text"
                          value={editNppSearchQuery}
                          onChange={(e) => {
                            setEditNppSearchQuery(e.target.value);
                            setShowEditNppDropdown(true);
                          }}
                          onFocus={() => setShowEditNppDropdown(true)}
                          placeholder="Tìm kiếm theo mã NPP nội bộ hoặc tên sản phẩm để gắn vào SKU..."
                          className={cn(inputCls, "pl-8 pr-24 text-xs font-medium")}
                        />
                        <button
                          type="button"
                          onClick={() => setShowEditNppDropdown(!showEditNppDropdown)}
                          className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold text-sky-700 hover:text-sky-900 rounded bg-sky-50 hover:bg-sky-100 border border-sky-200"
                        >
                          <Search size={11} /> Tìm chọn
                          <ChevronDown size={11} />
                        </button>
                      </div>
                    )}

                    {/* POPUP DROPDOWN TÌM KIẾM MÃ NPP CHUYÊN NGHIỆP */}
                    <div className={cn("relative", !showEditNppDropdown && "hidden")}>
                      <div className="absolute left-0 right-0 top-1.5 z-[70] rounded-md border border-slate-300 bg-white shadow-2xl overflow-hidden flex flex-col">
                        {/* Header: Input tìm kiếm & Tabs lọc */}
                        <div className="p-2 border-b border-slate-200 bg-slate-50 space-y-1.5">
                          <div className="relative">
                            <Search
                              size={13}
                              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                            />
                            <input
                              ref={editNppSearchInputRef}
                              type="text"
                              value={editNppSearchQuery}
                              onChange={(e) => setEditNppSearchQuery(e.target.value)}
                              placeholder="Gõ mã hoặc tên sản phẩm NPP để lọc nhanh..."
                              className="w-full rounded border border-slate-300 bg-white pl-8 pr-7 py-1 text-xs text-slate-800 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none"
                            />
                              {editNppSearchQuery && (
                                <button
                                  type="button"
                                  onClick={() => setEditNppSearchQuery("")}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                >
                                  <X size={12} />
                                </button>
                              )}
                            </div>
                            <div className="flex items-center justify-between text-[11px]">
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => setEditNppFilterTab("ALL")}
                                  className={cn(
                                    "px-2 py-0.5 rounded text-[10px] font-semibold transition-colors",
                                    editNppFilterTab === "ALL"
                                      ? "bg-sky-600 text-white"
                                      : "bg-slate-200 text-slate-700 hover:bg-slate-300"
                                  )}
                                >
                                  Tất cả ({nppProductOptions.length})
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditNppFilterTab("UNMAPPED")}
                                  className={cn(
                                    "px-2 py-0.5 rounded text-[10px] font-semibold transition-colors",
                                    editNppFilterTab === "UNMAPPED"
                                      ? "bg-sky-600 text-white"
                                      : "bg-slate-200 text-slate-700 hover:bg-slate-300"
                                  )}
                                >
                                  Chưa ghép SKU ({nppUnmappedCount})
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditNppFilterTab("MAPPED")}
                                  className={cn(
                                    "px-2 py-0.5 rounded text-[10px] font-semibold transition-colors",
                                    editNppFilterTab === "MAPPED"
                                      ? "bg-sky-600 text-white"
                                      : "bg-slate-200 text-slate-700 hover:bg-slate-300"
                                  )}
                                >
                                  Đã ghép ({nppMappedCount})
                                </button>
                              </div>
                              <span className="text-slate-500 text-[10px]">
                                Kết quả: <strong>{filteredEditNppOptions.length}</strong> mã
                              </span>
                            </div>
                          </div>

                          {/* Danh sách cuộn */}
                          <div className="overflow-y-auto max-h-64 divide-y divide-slate-100">
                            {filteredEditNppOptions.length === 0 ? (
                              <div className="p-4 text-center text-xs text-slate-400">
                                Không tìm thấy mã sản phẩm NPP nào phù hợp.
                              </div>
                            ) : (
                              filteredEditNppOptions.slice(0, 50).map((npp) => {
                                const isSelected =
                                  editForm.npp_code.toUpperCase() === npp.code.toUpperCase();
                                const isPreviouslySavedOnCurrent =
                                  !isSelected &&
                                  editingProduct &&
                                  npp.mappedSku &&
                                  npp.mappedSku.toUpperCase() === editingProduct.code.toUpperCase();
                                const isMappedToOther =
                                  !isSelected &&
                                  npp.mappedSku &&
                                  (!editingProduct ||
                                    npp.mappedSku.toUpperCase() !==
                                      editingProduct.code.toUpperCase());

                                return (
                                  <div
                                    key={npp.code}
                                    onClick={() => {
                                      setEditForm({ ...editForm, npp_code: npp.code });
                                      setShowEditNppDropdown(false);
                                      setEditNppSearchQuery("");
                                    }}
                                    className={cn(
                                      "p-2.5 hover:bg-sky-50/80 cursor-pointer transition-colors flex items-center justify-between gap-3 text-left",
                                      isSelected && "bg-sky-100/70 border-l-4 border-sky-600"
                                    )}
                                  >
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-2">
                                        <span className="font-mono text-xs font-bold text-sky-800 bg-sky-50 border border-sky-200 px-1.5 py-0.5 rounded">
                                          {npp.code}
                                        </span>
                                        <span className="text-xs font-semibold text-slate-800 truncate">
                                          {npp.name}
                                        </span>
                                        {isSelected ? (
                                          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-800">
                                            ✓ Đang chọn cho SKU này
                                          </span>
                                        ) : isPreviouslySavedOnCurrent ? (
                                          <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[9px] font-medium text-sky-800">
                                            Đang lưu ở SKU này
                                          </span>
                                        ) : isMappedToOther ? (
                                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-800">
                                            Đã ghép: {npp.mappedSku}
                                          </span>
                                        ) : (
                                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-500">
                                            Chưa ghép
                                          </span>
                                        )}
                                      </div>
                                      <div className="mt-1 flex items-center gap-3 text-[10px] text-slate-500">
                                        <span>
                                          NCC: <strong className="text-slate-700">{npp.supplier}</strong>
                                        </span>
                                        {npp.unit && (
                                          <span>
                                            ĐVT: <strong className="text-slate-700">{npp.unit}</strong>
                                          </span>
                                        )}
                                        {npp.orderCount > 0 && (
                                          <span>
                                            Đơn đặt: <strong>{npp.orderCount}</strong>
                                          </span>
                                        )}
                                        {npp.companyName && (
                                          <span>NPP: {npp.companyName}</span>
                                        )}
                                      </div>
                                    </div>

                                    <div className="text-right shrink-0">
                                      {npp.unitPrice > 0 && (
                                        <div className="text-xs font-bold text-slate-800 font-mono">
                                          {formatNumber(npp.unitPrice)} đ
                                        </div>
                                      )}
                                      {isSelected ? (
                                        <span className="inline-block mt-0.5 rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm">
                                          Đang chọn ✓
                                        </span>
                                      ) : (
                                        <span className="inline-block mt-0.5 rounded bg-sky-600 hover:bg-sky-700 px-2 py-0.5 text-[10px] font-semibold text-white transition-colors">
                                          Chọn ↵
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })
                            )}
                            {filteredEditNppOptions.length > 50 && (
                              <div className="p-2 text-center text-[10px] text-slate-500 bg-slate-50 border-t border-slate-100">
                                Đang hiển thị 50 / {filteredEditNppOptions.length} mã. Nhập thêm từ khóa để tìm chính xác hơn.
                              </div>
                            )}
                          </div>

                          {/* Footer dropdown */}
                          <div className="p-1.5 border-t border-slate-200 bg-slate-50 text-[10px] text-slate-500 flex items-center justify-between px-3">
                            <span>Nhấn vào dòng bất kỳ để chọn mã NPP</span>
                            <button
                              type="button"
                              onClick={() => setShowEditNppDropdown(false)}
                              className="font-semibold text-sky-600 hover:underline"
                            >
                              Đóng [Esc]
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                  {/* Tên sản phẩm đầy đủ */}
                  <div className="col-span-12">
                    <label className="text-[10px] font-semibold text-slate-600 block mb-1">
                      Tên sản phẩm gốc (Theo hóa đơn đầu vào CQT) <span className="text-red-600">*</span>
                    </label>
                    <input
                      required
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      className={cn(inputCls, "text-xs font-medium")}
                    />
                  </div>

                  {/* Tên nội bộ & ĐVT nội bộ */}
                  <div className="col-span-12 md:col-span-9">
                    <label className="text-[10px] font-semibold text-slate-600 block mb-1">
                      Tên sản phẩm nội bộ (Dùng khi Công ty chọn xuất HĐ theo Mã nội bộ)
                    </label>
                    <input
                      value={editForm.internal_name}
                      onChange={(e) => setEditForm({ ...editForm, internal_name: e.target.value })}
                      placeholder="Để trống sẽ dùng Tên sản phẩm gốc phía trên..."
                      className={cn(inputCls, "text-xs")}
                    />
                  </div>
                  <div className="col-span-12 md:col-span-3">
                    <label className="text-[10px] font-semibold text-slate-600 block mb-1">
                      ĐVT nội bộ (tuỳ chọn)
                    </label>
                    <input
                      value={editForm.internal_unit}
                      onChange={(e) => setEditForm({ ...editForm, internal_unit: e.target.value })}
                      placeholder="VD: Hộp, Lốc, Thùng..."
                      className={cn(inputCls, "text-xs")}
                    />
                  </div>
                </div>
              </section>

              {/* KHỐI 2: THÔNG TIN PHÂN LOẠI & NHÀ CUNG CẤP */}
              <section className="border-b border-slate-200 p-4">
                <div className="text-[11px] font-bold text-sky-800 uppercase flex items-center gap-1.5 mb-3">
                  <Building2 size={13} className="text-sky-600" />
                  <span>2. Phân loại, Đơn vị tính & Nhà cung cấp</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                  <label className="text-[10px] font-semibold text-slate-600 block">
                    Danh mục ngành hàng
                    <select
                      value={editForm.category_id}
                      onChange={(e) =>
                        setEditForm({ ...editForm, category_id: e.target.value })
                      }
                      className={cn(inputCls, "mt-1")}
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
                      className={cn(inputCls, "mt-1")}
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
                      className={cn(inputCls, "mt-1")}
                    />
                    <datalist id="sku-suppliers-datalist-edit">
                      {supplierOptions.map((s) => (
                        <option key={s.name} value={s.name} />
                      ))}
                    </datalist>
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
                      className={cn(inputCls, "mt-1 text-center font-semibold")}
                    />
                  </label>
                </div>
              </section>

              {/* KHỐI 3: GIÁ BÁN & CHÍNH SÁCH TỒN KHO */}
              <section className="border-b border-slate-200 p-4">
                <div className="text-[11px] font-bold text-sky-800 uppercase flex items-center gap-1.5 mb-3">
                  <Tag size={13} className="text-sky-600" />
                  <span>3. Giá bán niêm yết & Chính sách tồn kho</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
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
                      className={cn(inputCls, "mt-1 text-right font-semibold")}
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
                      className={cn(inputCls, "mt-1 text-right font-semibold")}
                    />
                  </label>

                  <label className="text-[10px] font-semibold text-slate-600 block">
                    Tồn kho tối thiểu (Tái đặt)
                    <input
                      type="number"
                      min={0}
                      value={editForm.reorder_level}
                      onChange={(e) =>
                        setEditForm({ ...editForm, reorder_level: e.target.value })
                      }
                      className={cn(inputCls, "mt-1 text-center font-semibold")}
                    />
                  </label>

                  <label className="text-[10px] font-semibold text-slate-600 block">
                    Thuế suất VAT (Học từ CQT / Xuất HĐ)
                    <select
                      value={editForm.vat_rate}
                      onChange={(e) => setEditForm({ ...editForm, vat_rate: e.target.value })}
                      className={cn(inputCls, "mt-1")}
                    >
                      <option value="">Mặc định theo hóa đơn (8%)</option>
                      <option value="0">0% (Thuế suất 0%)</option>
                      <option value="5">5%</option>
                      <option value="8">8%</option>
                      <option value="10">10%</option>
                      <option value="-1">KCT (Không chịu thuế)</option>
                    </select>
                  </label>

                  <label className="text-[10px] font-semibold text-slate-600 block">
                    Trạng thái kinh doanh
                    <select
                      value={editForm.status}
                      onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                      className={cn(inputCls, "mt-1")}
                    >
                      <option value="active">Đang kinh doanh</option>
                      <option value="inactive">Ngừng kinh doanh</option>
                    </select>
                  </label>
                </div>
              </section>

              {/* KHỐI 4: THỐNG KÊ PHÁT SINH THỰC TẾ CỦA SKU */}
              <section className="px-4 py-3 bg-sky-50/40">
                <div className="rounded border border-sky-200 bg-white p-3 text-[11px] text-slate-700 flex flex-wrap items-center justify-between gap-3 shadow-sm">
                  <div className="flex items-center gap-4">
                    <div>
                      <span className="text-slate-500 block text-[10px]">Đơn hàng DMS:</span>
                      <strong className="text-sky-800 text-xs">
                        {editingProduct.order_count} đơn
                      </strong>{" "}
                      ({formatNumber(editingProduct.total_ordered_qty)} {editingProduct.unit})
                    </div>
                    <div className="h-6 w-px bg-slate-200" />
                    <div>
                      <span className="text-slate-500 block text-[10px]">Hóa đơn mua vào CQT:</span>
                      <strong className="text-emerald-800 text-xs">
                        {editingProduct.purchase_invoice_count} hóa đơn
                      </strong>{" "}
                      ({formatNumber(editingProduct.total_purchased_qty)} {editingProduct.unit})
                    </div>
                    {editingProduct.distributors && editingProduct.distributors.length > 0 && (
                      <>
                        <div className="h-6 w-px bg-slate-200" />
                        <div>
                          <span className="text-slate-500 block text-[10px]">Nhà phân phối:</span>
                          <strong className="text-slate-800 text-xs">
                            {editingProduct.distributors.map((d) => d.name).join(", ")}
                          </strong>
                        </div>
                      </>
                    )}
                  </div>

                  <Link
                    href={`/products/${editingProduct.id}`}
                    className="inline-flex items-center gap-1 font-semibold text-xs text-sky-700 hover:text-sky-900 hover:underline"
                  >
                    Xem chi tiết SKU →
                  </Link>
                </div>
              </section>

              <footer className="border-t border-slate-300 bg-slate-100 px-4 py-2.5 flex items-center justify-between gap-3 shrink-0">
                <span className="text-[10px] text-slate-500">
                  ID hệ thống: #{editingProduct.id} · Mã SKU: {editingProduct.code}
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
                    className="inline-flex items-center gap-1.5 rounded bg-sky-600 hover:bg-sky-700 px-4 py-1.5 text-xs font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:bg-slate-300"
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

      {/* DATALIST GỢI Ý MÃ NPP NỘI BỘ TOÀN HỆ THỐNG */}
      <datalist id="sku-npp-options-datalist">
        {nppProductOptions.map((npp, idx) => (
          <option key={`${npp.code}-${idx}`} value={npp.code}>
            {npp.name} ({npp.supplier}{npp.unit ? ` - ${npp.unit}` : ""})
          </option>
        ))}
      </datalist>
    </div>
  );
}

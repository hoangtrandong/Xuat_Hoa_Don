"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Database,
  Download,
  FileSpreadsheet,
  History,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  TrendingDown,
  Upload,
  X,
} from "lucide-react";
import { API_URL, apiFetch } from "@/lib/api";
import { formatNumber, formatVND } from "@/lib/format";

interface MstBreakdownItem {
  tax_code: string;
  company_name: string;
  sku: string;
  invoice_product_code?: string;
  product_name: string;
  unit_name: string;
  conversion_factor?: number;
  vat_rate: number | null;
  opening_as_of_date: string | null;
  opening_qty: number;
  opening_amount: number;
  input_qty: number;
  input_amount: number;
  output_qty: number;
  output_amount: number;
  official_output_qty: number;
  draft_output_qty: number;
  adjustment_qty: number;
  balance_qty: number;
  avg_unit_cost: number;
  avg_sale_price: number;
  cogs_amount: number;
  ending_inventory_value: number;
  is_below_cost: boolean;
  has_chronological_negative: boolean;
  min_running_balance: number;
  status: "NEGATIVE" | "LOW" | "OK";
}

interface TaxInventoryRow {
  tax_code: string;
  company_name: string;
  mst_list?: Array<{ tax_code: string; company_name: string }>;
  default_company_tax_code?: string | null;
  default_company_name?: string | null;
  sku: string;
  npp_code?: string;
  invoice_product_id?: number | null;
  has_invoice_product?: boolean;
  invoice_product_code?: string;
  invoice_product_name?: string;
  invoice_product_codes?: string[];
  has_npp_code?: boolean;
  cqt_skus?: string[];
  mst_count?: number;
  negative_mst_count?: number;
  has_vat_mismatch?: boolean;
  has_unit_mismatch?: boolean;
  product_name: string;
  unit_name: string;
  vat_rate: number | null;
  opening_as_of_date: string | null;
  opening_qty: number;
  opening_amount: number;
  input_qty: number;
  input_amount: number;
  output_qty: number;
  output_amount: number;
  official_output_qty: number;
  draft_output_qty: number;
  adjustment_qty: number;
  balance_qty: number;
  avg_unit_cost: number;
  avg_sale_price: number;
  cogs_amount: number;
  ending_inventory_value: number;
  is_below_cost: boolean;
  has_chronological_negative: boolean;
  min_running_balance: number;
  status: "NEGATIVE" | "LOW" | "OK";
  other_mst_stocks: Array<{ tax_code: string; company_name: string; balance_qty: number }>;
  mst_breakdown?: MstBreakdownItem[];
}

interface TaxInventoryResponse {
  group_by?: "NPP_SKU" | "MST_SKU";
  summary: {
    total_records: number;
    filtered_records: number;
    negative_count: number;
    low_count: number;
    ok_count: number;
    chrono_negative_count: number;
    below_cost_count: number;
    unmapped_invoice_product_count?: number;
    mst_count: number;
    total_opening_amount: number;
    total_input_amount: number;
    total_output_amount: number;
    total_cogs_amount: number;
    total_ending_inventory_value: number;
  };
  data_quality?: {
    missing_xml_invoices_count: number;
    unmapped_sku_items_count: number;
  };
  pagination?: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
  };
  available_msts: Array<{ tax_code: string; company_name: string }>;
  items: TaxInventoryRow[];
}

interface CardEntry {
  tx_date: string;
  doc_type: "INPUT" | "OUTPUT" | "ADJUSTMENT" | "DRAFT";
  status: string;
  invoice_symbol: string;
  invoice_number: string;
  partner_tax_code: string;
  partner_name: string;
  unit_name: string;
  qty_in: number;
  qty_out: number;
  unit_price: number;
  amount: number;
  running_balance: number;
  is_negative_point: boolean;
  note: string;
}

interface TaxCardResponse {
  tax_code: string;
  sku: string;
  opening_as_of_date: string | null;
  opening_qty: number;
  closing_qty: number;
  entries: CardEntry[];
}

interface DailyLedgerRow {
  date: string;
  opening_qty: number;
  input_qty: number;
  input_amount: number;
  output_qty: number;
  output_amount: number;
  closing_qty: number;
  is_negative: boolean;
  has_activity: boolean;
}

interface DailyLedgerResponse {
  sku: string;
  tax_code: string;
  product_name: string;
  unit_name: string;
  from_date: string;
  to_date: string;
  cqt_skus: string[];
  summary: {
    period_opening_qty: number;
    total_input_qty: number;
    total_input_amount: number;
    total_output_qty: number;
    total_output_amount: number;
    period_closing_qty: number;
    negative_days_count: number;
    active_days_count: number;
    total_days: number;
  };
  days: DailyLedgerRow[];
}

interface OpeningBalanceRow {
  id: number;
  tax_code: string;
  sku: string;
  product_name: string;
  unit_name: string;
  as_of_date: string;
  opening_qty: number;
  opening_amount: number;
  note: string;
}

interface UnmappedItemRow {
  id: number;
  invoice_date: string;
  invoice_symbol: string;
  invoice_number: string;
  buyer_tax_code: string;
  seller_name: string;
  product_name: string;
  unit_name: string;
  quantity: number;
  amount_before_tax: number;
}

const inputCls =
  "w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-100";

export default function TaxInventoryByMstPanel({ distributorId }: { distributorId: number | null }) {
  const [data, setData] = useState<TaxInventoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingMapping, setExportingMapping] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [groupBy, setGroupBy] = useState<"NPP_SKU" | "MST_SKU">("NPP_SKU");
  const [selectedMst, setSelectedMst] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "" | "NEGATIVE" | "LOW" | "OK" | "CHRONO_NEGATIVE" | "BELOW_COST" | "UNMAPPED"
  >("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [includeDraft, setIncludeDraft] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  // Modal 0: Chi tiết theo từng MST khi click vào 1 Mã SP nội bộ NPP
  const [selectedNppRow, setSelectedNppRow] = useState<TaxInventoryRow | null>(null);

  // Modal 1: Drill-down Thẻ kho thuế
  const [selectedCardRow, setSelectedCardRow] = useState<{
    tax_code: string;
    company_name: string;
    sku: string;
    product_name: string;
    unit_name: string;
  } | null>(null);
  const [cardData, setCardData] = useState<TaxCardResponse | null>(null);
  const [cardLoading, setCardLoading] = useState(false);
  const [cardError, setCardError] = useState("");

  // Modal 1b: Nhật ký N-X-T từng ngày (Daily Ledger)
  const [dailyTarget, setDailyTarget] = useState<{
    sku: string;
    tax_code: string;
    product_name: string;
    unit_name: string;
  } | null>(null);
  const [dailyFrom, setDailyFrom] = useState("");
  const [dailyTo, setDailyTo] = useState("");
  const [dailyOnlyActive, setDailyOnlyActive] = useState(false);
  const [dailyData, setDailyData] = useState<DailyLedgerResponse | null>(null);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [dailyExporting, setDailyExporting] = useState(false);
  const [dailyError, setDailyError] = useState("");

  // Modal 2: Tồn đầu kỳ TK 156
  const [showOpeningModal, setShowOpeningModal] = useState(false);
  const [openingList, setOpeningList] = useState<OpeningBalanceRow[]>([]);
  const [openingLoading, setOpeningLoading] = useState(false);
  const [openingSaving, setOpeningSaving] = useState(false);
  const [openingError, setOpeningError] = useState("");
  const [obTaxCode, setObTaxCode] = useState("");
  const [obSku, setObSku] = useState("");
  const [obProductName, setObProductName] = useState("");
  const [obUnit, setObUnit] = useState("THUNG");
  const [obDate, setObDate] = useState(() => `${new Date().getFullYear()}-01-01`);
  const [obQty, setObQty] = useState("");
  const [obAmount, setObAmount] = useState("");
  const [obNote, setObNote] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Modal 3: Ánh xạ dòng hàng thiếu SKU (MHHDVu trống)
  const [showUnmappedModal, setShowUnmappedModal] = useState(false);
  const [unmappedList, setUnmappedList] = useState<UnmappedItemRow[]>([]);
  const [unmappedLoading, setUnmappedLoading] = useState(false);
  const [unmappedError, setUnmappedError] = useState("");
  const [skuInputs, setSkuInputs] = useState<Record<number, string>>({});
  const [mappingId, setMappingId] = useState<number | null>(null);
  const [applySameName, setApplySameName] = useState(true);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const buildQueryParams = useCallback(
    (forExport = false) => {
      const params = new URLSearchParams();
      if (distributorId !== null) params.set("distributor_id", String(distributorId));
      params.set("group_by", groupBy);
      if (selectedMst) params.set("company_tax_code", selectedMst);
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (statusFilter) params.set("status_filter", statusFilter);
      if (fromDate) params.set("from_date", fromDate);
      if (toDate) params.set("to_date", toDate);
      params.set("include_draft", includeDraft ? "true" : "false");
      if (!forExport) {
        params.set("page", String(page));
        params.set("page_size", String(pageSize));
      }
      return params;
    },
    [distributorId, groupBy, selectedMst, debouncedSearch, statusFilter, fromDate, toDate, includeDraft, page],
  );

  const load = useCallback(async () => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError("");
    try {
      const params = buildQueryParams(false);
      const res = await apiFetch(`${API_URL}/einvoice/tax-inventory?${params.toString()}`, {
        signal: controller.signal,
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(err.detail || "Không thể tải sổ tồn kho thuế.");
      }
      const json = (await res.json()) as TaxInventoryResponse;
      setData(json);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        return;
      }
      setError(e instanceof Error ? e.message : "Lỗi tải dữ liệu tồn kho thuế.");
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
      }
    }
  }, [buildQueryParams]);

  useEffect(() => {
    void load();
    return () => {
      abortRef.current?.abort();
    };
  }, [load]);

  async function handleExportExcel() {
    setExporting(true);
    setError("");
    try {
      const params = buildQueryParams(true);
      const res = await apiFetch(`${API_URL}/einvoice/tax-inventory/export?${params.toString()}`);
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(err.detail || "Không thể xuất file Excel sổ tồn kho thuế.");
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const suffix = selectedMst ? `_${selectedMst}` : "";
      a.download = `So_Ton_Kho_Thue${suffix}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi xuất Excel.");
    } finally {
      setExporting(false);
    }
  }

  async function handleExportSkuMapping() {
    setExportingMapping(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (distributorId !== null) params.set("distributor_id", String(distributorId));
      if (selectedMst) params.set("company_tax_code", selectedMst);
      const res = await apiFetch(
        `${API_URL}/einvoice/tax-inventory/sku-mapping-explanation/export?${params.toString()}`,
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(err.detail || "Không thể xuất Bảng giải trình ánh xạ mã hàng.");
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "Bang_Giai_Trinh_Anh_Xa_Ma_Hang_Thue.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi xuất Bảng giải trình mã hàng.");
    } finally {
      setExportingMapping(false);
    }
  }

  function isoDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function shiftSingleDay(delta: number) {
    const base = fromDate ? new Date(`${fromDate}T00:00:00`) : new Date();
    base.setDate(base.getDate() + delta);
    const next = isoDate(base);
    setFromDate(next);
    setToDate(next);
    setPage(1);
  }

  function setTodayRange() {
    const today = isoDate(new Date());
    setFromDate(today);
    setToDate(today);
    setPage(1);
  }

  function setCurrentMonthRange() {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    setFromDate(isoDate(first));
    setToDate(isoDate(now));
    setPage(1);
  }

  const loadDailyLedger = useCallback(
    async (
      target: { sku: string; tax_code: string },
      fDate: string,
      tDate: string,
      onlyAct: boolean,
    ) => {
      if (!fDate || !tDate) return;
      setDailyLoading(true);
      setDailyError("");
      try {
        const params = new URLSearchParams();
        params.set("sku", target.sku);
        params.set("from_date", fDate);
        params.set("to_date", tDate);
        if (target.tax_code && target.tax_code !== "ALL") params.set("tax_code", target.tax_code);
        if (distributorId !== null) params.set("distributor_id", String(distributorId));
        params.set("include_draft", includeDraft ? "true" : "false");
        params.set("only_active_days", onlyAct ? "true" : "false");
        const res = await apiFetch(`${API_URL}/einvoice/tax-inventory/daily?${params.toString()}`);
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { detail?: string };
          throw new Error(err.detail || "Không tải được nhật ký N-X-T từng ngày.");
        }
        setDailyData((await res.json()) as DailyLedgerResponse);
      } catch (e) {
        setDailyError(e instanceof Error ? e.message : "Lỗi tải nhật ký từng ngày.");
      } finally {
        setDailyLoading(false);
      }
    },
    [distributorId, includeDraft],
  );

  function openDailyModal(target: { sku: string; tax_code: string; product_name: string; unit_name: string }) {
    const now = new Date();
    const fDate = fromDate || isoDate(new Date(now.getFullYear(), now.getMonth(), 1));
    const tDate = toDate || isoDate(now);
    setDailyTarget(target);
    setDailyFrom(fDate);
    setDailyTo(tDate);
    setDailyData(null);
    void loadDailyLedger(target, fDate, tDate, dailyOnlyActive);
  }

  async function handleExportDailyExcel() {
    if (!dailyTarget || !dailyFrom || !dailyTo) return;
    setDailyExporting(true);
    setDailyError("");
    try {
      const params = new URLSearchParams();
      params.set("sku", dailyTarget.sku);
      params.set("from_date", dailyFrom);
      params.set("to_date", dailyTo);
      if (dailyTarget.tax_code && dailyTarget.tax_code !== "ALL") params.set("tax_code", dailyTarget.tax_code);
      if (distributorId !== null) params.set("distributor_id", String(distributorId));
      params.set("include_draft", includeDraft ? "true" : "false");
      params.set("only_active_days", dailyOnlyActive ? "true" : "false");
      const res = await apiFetch(`${API_URL}/einvoice/tax-inventory/daily/export?${params.toString()}`);
      if (!res.ok) throw new Error("Không xuất được file Excel nhật ký từng ngày.");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Nhat_Ky_NXT_Ngay_${dailyTarget.sku}_${dailyFrom}_${dailyTo}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setDailyError(e instanceof Error ? e.message : "Lỗi xuất Excel.");
    } finally {
      setDailyExporting(false);
    }
  }

  async function openStockCard(row: {
    tax_code: string;
    company_name: string;
    sku: string;
    product_name: string;
    unit_name: string;
  }) {
    setSelectedCardRow(row);
    setCardData(null);
    setCardError("");
    setCardLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("tax_code", row.tax_code);
      params.set("sku", row.sku);
      if (distributorId !== null) params.set("distributor_id", String(distributorId));
      if (fromDate) params.set("from_date", fromDate);
      if (toDate) params.set("to_date", toDate);
      params.set("include_draft", includeDraft ? "true" : "false");
      const res = await apiFetch(`${API_URL}/einvoice/tax-inventory/card?${params.toString()}`);
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(err.detail || "Không thể tải thẻ kho thuế chi tiết.");
      }
      setCardData((await res.json()) as TaxCardResponse);
    } catch (e) {
      setCardError(e instanceof Error ? e.message : "Lỗi tải thẻ kho thuế.");
    } finally {
      setCardLoading(false);
    }
  }

  // --- Opening Balance Handlers ---
  const loadOpeningBalances = useCallback(async () => {
    setOpeningLoading(true);
    setOpeningError("");
    try {
      const params = new URLSearchParams();
      if (distributorId !== null) params.set("distributor_id", String(distributorId));
      if (selectedMst) params.set("tax_code", selectedMst);
      const res = await apiFetch(`${API_URL}/einvoice/tax-inventory/opening-balances?${params.toString()}`);
      if (!res.ok) throw new Error("Không tải được danh sách tồn đầu kỳ.");
      setOpeningList((await res.json()) as OpeningBalanceRow[]);
    } catch (e) {
      setOpeningError(e instanceof Error ? e.message : "Lỗi tải tồn đầu kỳ.");
    } finally {
      setOpeningLoading(false);
    }
  }, [distributorId, selectedMst]);

  function openOpeningModal() {
    setShowOpeningModal(true);
    setObTaxCode(selectedMst || data?.available_msts?.[0]?.tax_code || "");
    void loadOpeningBalances();
  }

  async function saveOpeningBalance() {
    setOpeningError("");
    if (!obTaxCode.trim() || !obSku.trim() || !obDate) {
      setOpeningError("Vui lòng nhập đầy đủ MST, Mã SKU và Ngày chốt.");
      return;
    }
    setOpeningSaving(true);
    try {
      const res = await apiFetch(`${API_URL}/einvoice/tax-inventory/opening-balances`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          distributor_id: distributorId,
          tax_code: obTaxCode.trim(),
          sku: obSku.trim().toUpperCase(),
          product_name: obProductName.trim() || null,
          unit_name: obUnit.trim() || null,
          as_of_date: obDate,
          opening_qty: Number(obQty || 0),
          opening_amount: Number(obAmount || 0),
          note: obNote.trim() || null,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { detail?: string };
      if (!res.ok) throw new Error(json.detail || "Không lưu được tồn đầu kỳ.");
      setObSku("");
      setObProductName("");
      setObQty("");
      setObAmount("");
      setObNote("");
      await loadOpeningBalances();
      void load();
    } catch (e) {
      setOpeningError(e instanceof Error ? e.message : "Lỗi lưu tồn đầu kỳ.");
    } finally {
      setOpeningSaving(false);
    }
  }

  async function deleteOpeningRow(id: number) {
    try {
      const res = await apiFetch(`${API_URL}/einvoice/tax-inventory/opening-balances/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Không xóa được bản ghi.");
      await loadOpeningBalances();
      void load();
    } catch (e) {
      setOpeningError(e instanceof Error ? e.message : "Lỗi xóa bản ghi.");
    }
  }

  async function downloadOpeningTemplate() {
    try {
      const res = await apiFetch(`${API_URL}/einvoice/tax-inventory/opening-balances/template`);
      if (!res.ok) throw new Error("Không tải được file mẫu.");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "Mau_Ton_Dau_Ky_Thue_MST.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setOpeningError(e instanceof Error ? e.message : "Lỗi tải file mẫu.");
    }
  }

  async function handleImportOpeningExcel(file: File) {
    setOpeningSaving(true);
    setOpeningError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const params = new URLSearchParams();
      if (distributorId !== null) params.set("distributor_id", String(distributorId));
      const res = await apiFetch(
        `${API_URL}/einvoice/tax-inventory/opening-balances/import-excel?${params.toString()}`,
        { method: "POST", body: form },
      );
      const json = (await res.json().catch(() => ({}))) as {
        imported?: number;
        errors?: string[];
        detail?: string;
      };
      if (!res.ok) throw new Error(json.detail || "Lỗi import Excel tồn đầu kỳ.");
      setNotice(
        `Đã import thành công ${json.imported ?? 0} dòng tồn đầu kỳ${
          json.errors && json.errors.length > 0 ? ` (${json.errors.length} dòng lỗi)` : ""
        }.`,
      );
      await loadOpeningBalances();
      void load();
    } catch (e) {
      setOpeningError(e instanceof Error ? e.message : "Lỗi import Excel.");
    } finally {
      setOpeningSaving(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // --- Unmapped SKU Handlers ---
  async function openUnmappedModal() {
    setShowUnmappedModal(true);
    setUnmappedLoading(true);
    setUnmappedError("");
    try {
      const params = new URLSearchParams();
      if (distributorId !== null) params.set("distributor_id", String(distributorId));
      const res = await apiFetch(`${API_URL}/einvoice/tax-inventory/unmapped-items?${params.toString()}`);
      if (!res.ok) throw new Error("Không tải được danh sách dòng hàng thiếu SKU.");
      setUnmappedList((await res.json()) as UnmappedItemRow[]);
    } catch (e) {
      setUnmappedError(e instanceof Error ? e.message : "Lỗi tải danh sách.");
    } finally {
      setUnmappedLoading(false);
    }
  }

  async function handleMapSku(itemId: number) {
    const skuVal = (skuInputs[itemId] || "").trim().toUpperCase();
    if (!skuVal) {
      setUnmappedError("Vui lòng nhập mã SKU trước khi lưu.");
      return;
    }
    setMappingId(itemId);
    setUnmappedError("");
    try {
      const params = new URLSearchParams();
      if (distributorId !== null) params.set("distributor_id", String(distributorId));
      const res = await apiFetch(
        `${API_URL}/einvoice/tax-inventory/unmapped-items/${itemId}/map-sku?${params.toString()}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sku: skuVal, apply_same_name: applySameName }),
        },
      );
      const json = (await res.json().catch(() => ({}))) as { updated_count?: number; detail?: string };
      if (!res.ok) throw new Error(json.detail || "Không thể ánh xạ SKU.");
      setNotice(`Đã gán mã SKU ${skuVal} cho ${json.updated_count ?? 1} dòng hàng mua vào.`);
      await openUnmappedModal();
      void load();
    } catch (e) {
      setUnmappedError(e instanceof Error ? e.message : "Lỗi ánh xạ SKU.");
    } finally {
      setMappingId(null);
    }
  }

  const summary = data?.summary;
  const quality = data?.data_quality;
  const pagination = data?.pagination;
  const rows = data?.items ?? [];
  const showOpeningCol = Boolean(fromDate || toDate || rows.some((r) => r.opening_qty !== 0));

  const pageTotalInputQty = rows.reduce((s, r) => s + r.input_qty, 0);
  const pageTotalOutputQty = rows.reduce((s, r) => s + r.output_qty, 0);

  return (
    <div className="border border-slate-400 bg-white shadow-sm">
      {/* Header chuẩn enterprise */}
      <div className="bg-[#14263d] px-3 py-2 text-white flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Building2 size={17} className="text-red-500" />
          <span className="text-xs font-bold uppercase tracking-wide text-white">
            {groupBy === "NPP_SKU"
              ? "Sổ Tồn Kho Thuế Tổng Hợp Theo Mã SP Xuất Hóa Đơn (TK 156)"
              : "Sổ Nhập – Xuất – Tồn Thuế Chi Tiết Theo Từng MST × Mã SP Xuất HĐ (TK 156)"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded border border-white/20 bg-white/10 p-0.5 text-[10px] font-semibold">
            <button
              type="button"
              onClick={() => {
                setGroupBy("NPP_SKU");
                setPage(1);
              }}
              className={`rounded px-2 py-0.5 transition-colors ${
                groupBy === "NPP_SKU" ? "bg-sky-600 text-white" : "text-slate-200 hover:bg-white/10"
              }`}
            >
              Theo Mã SP xuất HĐ
            </button>
            <button
              type="button"
              onClick={() => {
                setGroupBy("MST_SKU");
                setPage(1);
              }}
              className={`rounded px-2 py-0.5 transition-colors ${
                groupBy === "MST_SKU" ? "bg-sky-600 text-white" : "text-slate-200 hover:bg-white/10"
              }`}
            >
              Tách theo MST
            </button>
          </div>
          <button
            type="button"
            onClick={openOpeningModal}
            className="inline-flex items-center gap-1.5 rounded bg-amber-600 hover:bg-amber-700 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors"
          >
            <Database size={12} />
            Tồn đầu kỳ (TK 156)
          </button>
          <button
            type="button"
            onClick={() => void handleExportSkuMapping()}
            disabled={exportingMapping || loading}
            title="Xuất Excel Bảng Giải Trình Ánh Xạ & Quy Đổi Mã Hàng Đầu Vào – Đầu Ra phục vụ quyết toán thuế"
            className="inline-flex items-center gap-1.5 rounded bg-violet-600 hover:bg-violet-700 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors disabled:opacity-60"
          >
            {exportingMapping ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            Bảng giải trình mã hàng
          </button>
          <button
            type="button"
            onClick={() => void handleExportExcel()}
            disabled={exporting || loading}
            className="inline-flex items-center gap-1.5 rounded bg-emerald-600 hover:bg-emerald-700 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors disabled:opacity-60"
          >
            {exporting ? <Loader2 size={12} className="animate-spin" /> : <FileSpreadsheet size={12} />}
            Xuất Excel
          </button>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded bg-sky-600 hover:bg-sky-700 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors disabled:opacity-60"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Làm mới
          </button>
        </div>
      </div>

      {/* Banner thông báo thành công */}
      {notice && (
        <div className="border-b border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] text-emerald-800 flex items-center justify-between">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")} className="text-emerald-700 hover:text-emerald-900">
            <X size={13} />
          </button>
        </div>
      )}

      {/* Cảnh báo chất lượng dữ liệu đầu vào + Nút ánh xạ SKU ngay */}
      {((quality && (quality.missing_xml_invoices_count > 0 || quality.unmapped_sku_items_count > 0)) ||
        (summary?.unmapped_invoice_product_count ?? 0) > 0) && (
        <div className="border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-900 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1 font-bold text-amber-800">
              <AlertTriangle size={13} className="text-amber-600" /> Lưu ý dữ liệu đầu vào CQT:
            </span>
            {(summary?.unmapped_invoice_product_count ?? 0) > 0 && (
              <span>
                Có <b>{formatNumber(summary?.unmapped_invoice_product_count ?? 0)}</b> SKU đầu vào chưa gán <strong>Mã SP xuất hóa đơn</strong>.
              </span>
            )}
            {quality && quality.missing_xml_invoices_count > 0 && (
              <span>
                Có <b>{formatNumber(quality.missing_xml_invoices_count)}</b> HĐ mua vào chưa tải XML.
              </span>
            )}
            {quality && quality.unmapped_sku_items_count > 0 && (
              <span>
                Có <b>{formatNumber(quality.unmapped_sku_items_count)}</b> dòng hàng mua vào thiếu mã SKU (MHHDVu trống).
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {(summary?.unmapped_invoice_product_count ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => {
                  setStatusFilter(statusFilter === "UNMAPPED" ? "" : ("UNMAPPED" as typeof statusFilter));
                  setPage(1);
                }}
                className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold ${
                  statusFilter === "UNMAPPED"
                    ? "bg-red-700 text-white"
                    : "bg-orange-600 hover:bg-orange-700 text-white"
                }`}
              >
                <Link2 size={11} />{" "}
                {statusFilter === "UNMAPPED" ? "Đang lọc: Chưa gán SP xuất HĐ (Bỏ lọc)" : "Lọc SKU chưa gán SP xuất HĐ"}
              </button>
            )}
            {quality && quality.unmapped_sku_items_count > 0 && (
              <button
                type="button"
                onClick={() => void openUnmappedModal()}
                className="inline-flex items-center gap-1 rounded bg-amber-700 hover:bg-amber-800 px-2 py-0.5 text-[10px] font-semibold text-white"
              >
                <Link2 size={11} /> Ánh xạ SKU ngay
              </button>
            )}
          </div>
        </div>
      )}

      {/* Thống kê tổng quan (6 thẻ KPI click được) */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2 border-b border-slate-200 px-3 py-2.5 bg-slate-50/70">
        <button
          type="button"
          onClick={() => {
            setStatusFilter("");
            setPage(1);
          }}
          className={`text-left rounded border px-2.5 py-2 transition-all ${
            statusFilter === ""
              ? "border-sky-500 bg-white ring-1 ring-sky-400"
              : "border-slate-200 bg-white hover:border-slate-300"
          }`}
        >
          <div className="text-[10px] font-semibold uppercase text-slate-500">Tổng dòng (MST×SKU)</div>
          <div className="text-base font-bold text-slate-800">{formatNumber(summary?.total_records ?? 0)}</div>
          <div className="text-[10px] text-slate-400">{summary?.mst_count ?? 0} pháp nhân / MST</div>
        </button>

        <button
          type="button"
          onClick={() => {
            setStatusFilter(statusFilter === "NEGATIVE" ? "" : "NEGATIVE");
            setPage(1);
          }}
          className={`text-left rounded border px-2.5 py-2 transition-all ${
            statusFilter === "NEGATIVE"
              ? "border-red-600 bg-red-50 ring-1 ring-red-500"
              : "border-red-200 bg-red-50/60 hover:border-red-300"
          }`}
        >
          <div className="text-[10px] font-semibold uppercase text-red-700 flex items-center gap-1">
            <ShieldAlert size={11} /> Âm kho thuế
          </div>
          <div className="text-base font-bold text-red-700">{formatNumber(summary?.negative_count ?? 0)}</div>
          <div className="text-[10px] text-red-600">Xuất vượt đầu vào</div>
        </button>

        <button
          type="button"
          onClick={() => {
            setStatusFilter(statusFilter === "CHRONO_NEGATIVE" ? "" : "CHRONO_NEGATIVE");
            setPage(1);
          }}
          className={`text-left rounded border px-2.5 py-2 transition-all ${
            statusFilter === "CHRONO_NEGATIVE"
              ? "border-orange-600 bg-orange-50 ring-1 ring-orange-500"
              : "border-orange-200 bg-orange-50/60 hover:border-orange-300"
          }`}
        >
          <div className="text-[10px] font-semibold uppercase text-orange-800 flex items-center gap-1">
            <Clock size={11} /> Âm thời điểm
          </div>
          <div className="text-base font-bold text-orange-800">
            {formatNumber(summary?.chrono_negative_count ?? 0)}
          </div>
          <div className="text-[10px] text-orange-700">Xuất trước ngày nhập</div>
        </button>

        <button
          type="button"
          onClick={() => {
            setStatusFilter(statusFilter === "BELOW_COST" ? "" : "BELOW_COST");
            setPage(1);
          }}
          className={`text-left rounded border px-2.5 py-2 transition-all ${
            statusFilter === "BELOW_COST"
              ? "border-rose-600 bg-rose-50 ring-1 ring-rose-500"
              : "border-rose-200 bg-rose-50/60 hover:border-rose-300"
          }`}
        >
          <div className="text-[10px] font-semibold uppercase text-rose-800 flex items-center gap-1">
            <TrendingDown size={11} /> Bán dưới giá vốn
          </div>
          <div className="text-base font-bold text-rose-800">{formatNumber(summary?.below_cost_count ?? 0)}</div>
          <div className="text-[10px] text-rose-700">Rủi ro ấn định TNDN</div>
        </button>

        <button
          type="button"
          onClick={() => {
            setStatusFilter(statusFilter === "LOW" ? "" : "LOW");
            setPage(1);
          }}
          className={`text-left rounded border px-2.5 py-2 transition-all ${
            statusFilter === "LOW"
              ? "border-amber-600 bg-amber-50 ring-1 ring-amber-500"
              : "border-amber-200 bg-amber-50/60 hover:border-amber-300"
          }`}
        >
          <div className="text-[10px] font-semibold uppercase text-amber-800 flex items-center gap-1">
            <AlertTriangle size={11} /> Tồn thấp (≤ 5)
          </div>
          <div className="text-base font-bold text-amber-800">{formatNumber(summary?.low_count ?? 0)}</div>
          <div className="text-[10px] text-amber-700">An toàn: {formatNumber(summary?.ok_count ?? 0)}</div>
        </button>

        <div className="rounded border border-emerald-200 bg-emerald-50/60 px-2.5 py-2">
          <div className="text-[10px] font-semibold uppercase text-emerald-800">Trị giá tồn TK 156</div>
          <div className="text-sm font-bold text-emerald-800 truncate" title={formatVND(summary?.total_ending_inventory_value ?? 0)}>
            {formatVND(summary?.total_ending_inventory_value ?? 0)}
          </div>
          <div className="text-[10px] text-emerald-700 truncate" title={formatVND(summary?.total_input_amount ?? 0)}>
            Tổng nhập: {formatVND(summary?.total_input_amount ?? 0)}
          </div>
        </div>
      </div>

      {/* Bộ lọc chuẩn grid */}
      <div className="border-b border-slate-200 px-3 py-2.5 grid gap-x-3 gap-y-2 sm:grid-cols-2 xl:grid-cols-5 items-end">
        <div>
          <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
            Tìm theo Mã SP XHĐ / Tên SP XHĐ / MST / Công ty
          </label>
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Nhập mã SP XHĐ, tên SP XHĐ, MST hoặc tên công ty..."
              className={`${inputCls} pl-6`}
            />
          </div>
        </div>

        <div>
          <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
            Lọc theo Pháp nhân / MST
          </label>
          <select
            value={selectedMst}
            onChange={(e) => {
              setSelectedMst(e.target.value);
              setPage(1);
            }}
            className={inputCls}
          >
            <option value="">Tất cả MST ({data?.available_msts.length ?? 0})</option>
            {(data?.available_msts ?? []).map((m) => (
              <option key={m.tax_code} value={m.tax_code}>
                [{m.tax_code}] {m.company_name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">Từ ngày (Kỳ báo cáo)</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              setPage(1);
            }}
            className={inputCls}
          />
        </div>

        <div>
          <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">Đến ngày</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value);
              setPage(1);
            }}
            className={inputCls}
          />
        </div>

        <div className="flex items-center gap-2 pb-1">
          <input
            id="include-draft-tax"
            type="checkbox"
            checked={includeDraft}
            onChange={(e) => {
              setIncludeDraft(e.target.checked);
              setPage(1);
            }}
            className="h-3.5 w-3.5 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
          />
          <label htmlFor="include-draft-tax" className="text-xs font-semibold text-slate-700 cursor-pointer">
            Gồm HĐ Nháp (DRAFT)
          </label>
        </div>

        {/* Thanh chuyển ngày nhanh để check N-X-T từng ngày */}
        <div className="sm:col-span-2 xl:col-span-5 flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-100 text-[11px]">
          <span className="text-[10px] font-semibold text-slate-500 mr-1">Chọn nhanh theo ngày:</span>
          <button
            type="button"
            onClick={() => shiftSingleDay(-1)}
            className="inline-flex items-center gap-0.5 rounded border border-slate-300 bg-white hover:bg-slate-100 px-2 py-0.5 font-semibold text-slate-700"
          >
            <ChevronLeft size={12} /> Ngày trước
          </button>
          <button
            type="button"
            onClick={setTodayRange}
            className="rounded border border-sky-300 bg-sky-50 hover:bg-sky-100 px-2 py-0.5 font-semibold text-sky-800"
          >
            Hôm nay
          </button>
          <button
            type="button"
            onClick={() => shiftSingleDay(1)}
            className="inline-flex items-center gap-0.5 rounded border border-slate-300 bg-white hover:bg-slate-100 px-2 py-0.5 font-semibold text-slate-700"
          >
            Ngày sau <ChevronRight size={12} />
          </button>
          <button
            type="button"
            onClick={setCurrentMonthRange}
            className="rounded border border-slate-300 bg-white hover:bg-slate-100 px-2 py-0.5 font-semibold text-slate-700"
          >
            Tháng này
          </button>
          {(fromDate || toDate) && (
            <button
              type="button"
              onClick={() => {
                setFromDate("");
                setToDate("");
                setPage(1);
              }}
              className="rounded border border-red-200 bg-red-50 hover:bg-red-100 px-2 py-0.5 font-semibold text-red-700"
            >
              Tất cả thời gian
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mx-3 my-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Bảng dữ liệu */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600 uppercase">
            <tr className="border-b border-slate-200">
              <th className="px-2.5 py-2">Mã SP XHĐ</th>
              <th className="px-2.5 py-2">Tên SP XHĐ</th>
              <th className="px-2.5 py-2">MST</th>
              <th className="px-2.5 py-2">Tên công ty quản lý</th>
              <th className="px-2 py-2 text-center">ĐVT/VAT</th>
              {showOpeningCol && <th className="px-2.5 py-2 text-right">Đầu kỳ</th>}
              <th className="px-2.5 py-2 text-right">Nhập CQT</th>
              <th className="px-2.5 py-2 text-right">Xuất HĐĐT</th>
              <th className="px-2.5 py-2 text-right">Tồn / TK 156</th>
              <th className="px-2.5 py-2">Trạng thái &amp; Cảnh báo</th>
              <th className="px-2 py-2 text-center">{groupBy === "NPP_SKU" ? "Theo MST" : "Thẻ kho"}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10 + (showOpeningCol ? 1 : 0)} className="px-4 py-8 text-center text-xs text-slate-500">
                  <span className="inline-flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin text-sky-600" /> Đang tính tồn kho thuế (TK 156)...
                  </span>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={10 + (showOpeningCol ? 1 : 0)} className="px-4 py-8 text-center text-xs text-slate-500">
                  Chưa có dữ liệu Nhập – Xuất Thuế khớp với bộ lọc.
                </td>
              </tr>
            ) : (
              rows.map((r, idx) => {
                const displayCode = r.invoice_product_code || r.npp_code || r.sku;
                const displayName = r.invoice_product_name || r.product_name;
                let mstItems: Array<{ tax_code: string; company_name: string }> = [];
                if (r.mst_list && r.mst_list.length > 0) {
                  mstItems = r.mst_list;
                } else if (r.mst_breakdown && r.mst_breakdown.length > 0) {
                  const seen = new Map<string, string>();
                  for (const b of r.mst_breakdown) {
                    const tc = (b.tax_code || "").trim();
                    if (tc && !seen.has(tc)) {
                      seen.set(tc, (b.company_name || "").trim() || `MST ${tc}`);
                    }
                  }
                  mstItems = Array.from(seen.entries()).map(([tax_code, company_name]) => ({
                    tax_code,
                    company_name,
                  }));
                } else if (r.tax_code && r.tax_code !== "ALL") {
                  mstItems = [{ tax_code: r.tax_code, company_name: r.company_name }];
                }
                const allMstsTooltip = mstItems.map((m) => `${m.tax_code} - ${m.company_name}`).join("\n");

                return (
                <tr
                  key={`${groupBy}::${r.tax_code}::${displayCode}::${r.sku}::${idx}`}
                  onClick={() => {
                    if (groupBy === "NPP_SKU") {
                      setSelectedNppRow(r);
                    } else {
                      void openStockCard(r);
                    }
                  }}
                  className="border-b border-slate-100 even:bg-amber-50/40 hover:bg-sky-50/60 text-[11px] cursor-pointer"
                >
                  <td className="px-2.5 py-1.5 whitespace-nowrap">
                    <div className="font-mono font-bold text-sky-800">{displayCode}</div>
                    {r.cqt_skus &&
                      r.cqt_skus.length > 0 &&
                      !(r.cqt_skus.length === 1 && r.cqt_skus[0] === displayCode) && (
                        <div
                          className="text-[10px] font-mono text-slate-400"
                          title={`Mã CQT: ${r.cqt_skus.join(", ")}`}
                        >
                          CQT: {r.cqt_skus.slice(0, 2).join(", ")}
                          {r.cqt_skus.length > 2 ? ` +${r.cqt_skus.length - 2}` : ""}
                        </div>
                      )}
                    {r.has_invoice_product === false && (
                      <div className="text-[9px] font-semibold text-amber-700">Chưa gán SP XHĐ</div>
                    )}
                  </td>
                  <td className="px-2.5 py-1.5 text-slate-800 font-medium max-w-[260px] truncate" title={displayName}>
                    {displayName}
                  </td>
                  <td className="px-2.5 py-1.5 whitespace-nowrap" title={allMstsTooltip}>
                    {mstItems.length > 0 ? (
                      <div className="space-y-0.5">
                        {mstItems.map((m) => (
                          <div key={m.tax_code} className="font-mono font-bold text-slate-800 leading-tight">
                            {m.tax_code}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="font-mono text-slate-400">{r.default_company_tax_code || "—"}</span>
                    )}
                  </td>
                  <td className="px-2.5 py-1.5 max-w-[220px]" title={allMstsTooltip}>
                    {mstItems.length > 0 ? (
                      <div className="space-y-0.5">
                        {mstItems.map((m) => (
                          <div key={m.tax_code} className="truncate text-slate-700 font-medium leading-tight">
                            {m.company_name}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-slate-400">{r.default_company_name || "—"}</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-center whitespace-nowrap">
                    <span className="font-semibold text-slate-700">{r.unit_name || "—"}</span>
                    {r.vat_rate !== null && (
                      <span className="ml-1 rounded bg-violet-50 border border-violet-200 px-1 text-[9px] font-bold text-violet-700">
                        {r.vat_rate < 0 ? "KCT" : `${r.vat_rate}%`}
                      </span>
                    )}
                  </td>
                  {showOpeningCol && (
                    <td className="px-2.5 py-1.5 text-right whitespace-nowrap">
                      <div className="font-medium text-slate-700">{formatNumber(r.opening_qty)}</div>
                      {r.opening_amount > 0 && (
                        <div className="text-[10px] text-slate-400">{formatVND(r.opening_amount)}</div>
                      )}
                    </td>
                  )}
                  <td className="px-2.5 py-1.5 text-right whitespace-nowrap">
                    <div className="font-semibold text-emerald-700">{formatNumber(r.input_qty)}</div>
                    <div className="text-[10px] text-slate-400">{formatVND(r.input_amount)}</div>
                  </td>
                  <td className="px-2.5 py-1.5 text-right whitespace-nowrap">
                    <div className="font-semibold text-slate-700">{formatNumber(r.output_qty)}</div>
                    <div className="text-[10px] text-slate-400">{formatVND(r.output_amount)}</div>
                    {r.draft_output_qty !== 0 && (
                      <div className="text-[9px] text-amber-700">Nháp: {formatNumber(r.draft_output_qty)}</div>
                    )}
                    {r.adjustment_qty !== 0 && (
                      <div className="text-[9px] text-sky-600">ĐC trả: {formatNumber(r.adjustment_qty)}</div>
                    )}
                  </td>
                  <td className="px-2.5 py-1.5 text-right whitespace-nowrap">
                    <div
                      className={`font-bold ${
                        r.status === "NEGATIVE"
                          ? "text-red-700"
                          : r.status === "LOW"
                          ? "text-amber-700"
                          : "text-emerald-700"
                      }`}
                    >
                      {formatNumber(r.balance_qty)}
                    </div>
                    <div className="text-[10px] font-medium text-slate-500" title="Trị giá tồn kho thuế cuối kỳ (TK 156)">
                      {formatVND(r.ending_inventory_value)}
                    </div>
                  </td>
                  <td className="px-2.5 py-1.5">
                    <div className="space-y-0.5">
                      {r.status === "NEGATIVE" ? (
                        <span className="inline-flex items-center gap-1 rounded bg-red-100 border border-red-300 px-1.5 py-0.5 text-[10px] font-bold text-red-800">
                          <ShieldAlert size={11} /> Âm kho thuế
                        </span>
                      ) : r.status === "LOW" ? (
                        <span className="inline-flex items-center gap-1 rounded bg-amber-100 border border-amber-300 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                          Sắp hết tồn
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded bg-emerald-100 border border-emerald-200 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                          Đủ đầu vào
                        </span>
                      )}
                      {groupBy === "NPP_SKU" && (r.negative_mst_count ?? 0) > 0 && r.status !== "NEGATIVE" && (
                        <div>
                          <span className="inline-flex items-center gap-1 rounded bg-red-50 border border-red-200 px-1.5 py-0.5 text-[9px] font-bold text-red-700">
                            {r.negative_mst_count} MST con đang âm
                          </span>
                        </div>
                      )}
                      {r.has_chronological_negative && r.status !== "NEGATIVE" && (
                        <div>
                          <span className="inline-flex items-center gap-1 rounded bg-orange-100 border border-orange-300 px-1.5 py-0.5 text-[9px] font-bold text-orange-800">
                            <Clock size={10} /> Âm thời điểm ({formatNumber(r.min_running_balance)})
                          </span>
                        </div>
                      )}
                      {groupBy === "NPP_SKU" && r.has_vat_mismatch && (
                        <div>
                          <span className="inline-flex items-center gap-1 rounded bg-red-100 border border-red-300 px-1.5 py-0.5 text-[9px] font-bold text-red-800">
                            <AlertTriangle size={10} /> Lệch VAT trong nhóm!
                          </span>
                        </div>
                      )}
                      {groupBy === "NPP_SKU" && r.has_unit_mismatch && (
                        <div>
                          <span className="inline-flex items-center gap-1 rounded bg-amber-100 border border-amber-300 px-1.5 py-0.5 text-[9px] font-bold text-amber-800">
                            <AlertTriangle size={10} /> Khác ĐVT chưa quy đổi
                          </span>
                        </div>
                      )}
                      {r.is_below_cost && (
                        <div>
                          <span
                            className="inline-flex items-center gap-1 rounded bg-rose-100 border border-rose-300 px-1.5 py-0.5 text-[9px] font-bold text-rose-800"
                            title={`Đơn giá bán BQ (${formatVND(r.avg_sale_price)}) thấp hơn giá vốn BQ (${formatVND(r.avg_unit_cost)})`}
                          >
                            <TrendingDown size={10} /> Bán dưới giá vốn
                          </span>
                        </div>
                      )}
                      {groupBy === "MST_SKU" && r.status === "NEGATIVE" && r.other_mst_stocks.length > 0 && (
                        <div className="text-[10px] text-sky-700">
                          MST khác:{" "}
                          {r.other_mst_stocks
                            .slice(0, 2)
                            .map((x) => `${x.tax_code} (+${formatNumber(x.balance_qty)})`)
                            .join(", ")}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-center whitespace-nowrap">
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openDailyModal({
                            sku: displayCode,
                            tax_code: groupBy === "NPP_SKU" ? "ALL" : r.tax_code,
                            product_name: displayName,
                            unit_name: r.unit_name,
                          });
                        }}
                        title="Xem Nhật ký Tồn đầu ngày – Nhập – Xuất – Tồn cuối ngày"
                        className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800"
                      >
                        <Calendar size={11} /> Ngày
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (groupBy === "NPP_SKU") {
                            setSelectedNppRow(r);
                          } else {
                            void openStockCard(r);
                          }
                        }}
                        className="inline-flex items-center gap-1 rounded border border-sky-200 bg-sky-50 hover:bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800"
                      >
                        {groupBy === "NPP_SKU" ? (
                          <>
                            <Building2 size={11} /> {r.mst_count ?? 1} MST
                          </>
                        ) : (
                          <>
                            <History size={11} /> Thẻ kho
                          </>
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t border-slate-200 bg-slate-50 text-[10px] font-semibold text-slate-600">
              <tr>
                <td colSpan={5 + (showOpeningCol ? 1 : 0)} className="px-2.5 py-2 text-right uppercase">
                  Tổng bộ lọc ({formatNumber(summary?.filtered_records ?? rows.length)} dòng):
                </td>
                <td className="px-2.5 py-2 text-right">
                  <div className="text-emerald-700 font-bold">{formatNumber(pageTotalInputQty)}</div>
                  <div>{formatVND(summary?.total_input_amount ?? 0)}</div>
                </td>
                <td className="px-2.5 py-2 text-right">
                  <div className="text-slate-700 font-bold">{formatNumber(pageTotalOutputQty)}</div>
                  <div>{formatVND(summary?.total_output_amount ?? 0)}</div>
                </td>
                <td className="px-2.5 py-2 text-right font-bold text-emerald-800">
                  {formatVND(summary?.total_ending_inventory_value ?? 0)}
                </td>
                <td colSpan={2} className="px-2.5 py-2 text-[10px] text-slate-500">
                  {groupBy === "NPP_SKU"
                    ? "Click dòng bất kỳ để xem chi tiết theo từng MST"
                    : "Click dòng bất kỳ để mở Thẻ kho thuế"}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Phân trang */}
      {pagination && pagination.total_pages > 1 && (
        <div className="border-t border-slate-200 bg-slate-50 px-3 py-2 flex items-center justify-between text-xs text-slate-600">
          <span>
            Hiển thị trang <b>{pagination.page}</b> / <b>{pagination.total_pages}</b> ({formatNumber(pagination.total)}{" "}
            dòng)
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={pagination.page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white hover:bg-slate-100 px-2 py-1 text-[11px] font-semibold disabled:opacity-40"
            >
              <ChevronLeft size={12} /> Trước
            </button>
            <button
              type="button"
              disabled={pagination.page >= pagination.total_pages || loading}
              onClick={() => setPage((p) => Math.min(pagination.total_pages, p + 1))}
              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white hover:bg-slate-100 px-2 py-1 text-[11px] font-semibold disabled:opacity-40"
            >
              Sau <ChevronRight size={12} />
            </button>
          </div>
        </div>
      )}

      {/* MODAL 0: Chi tiết phân bổ Tồn Kho Thuế theo từng MST của 1 Mã SP nội bộ NPP */}
      {selectedNppRow && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setSelectedNppRow(null)}
        >
          <div
            className="w-full max-w-5xl border border-slate-400 bg-white shadow-lg max-h-[88vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-[#14263d] px-3 py-2 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Building2 size={17} className="text-red-500" />
                <span className="text-xs font-bold uppercase tracking-wide text-white">
                  Chi Tiết Tồn Kho Thuế Theo Từng MST · Mã SP XHĐ {selectedNppRow.invoice_product_code || selectedNppRow.npp_code || selectedNppRow.sku}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedNppRow(null)}
                className="rounded p-1 text-white hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </div>

            <div className="border-b border-sky-100 bg-sky-50/60 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <div className="font-bold text-sky-900">
                {selectedNppRow.invoice_product_name || selectedNppRow.product_name} ({selectedNppRow.unit_name || "ĐVT"})
              </div>
              <div className="flex flex-wrap items-center gap-4 font-semibold text-slate-700">
                <span>Tổng Nhập: {formatNumber(selectedNppRow.input_qty)}</span>
                <span>Tổng Xuất: {formatNumber(selectedNppRow.output_qty)}</span>
                <span
                  className={
                    selectedNppRow.balance_qty < 0 ? "text-red-700 font-bold" : "text-emerald-700 font-bold"
                  }
                >
                  Tổng Tồn: {formatNumber(selectedNppRow.balance_qty)} ({formatVND(selectedNppRow.ending_inventory_value)})
                </span>
              </div>
            </div>

            <div className="overflow-y-auto flex-1">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600 uppercase sticky top-0">
                    <tr className="border-b border-slate-200">
                      <th className="px-2.5 py-2">MST</th>
                      <th className="px-2.5 py-2">Tên công ty quản lý</th>
                      <th className="px-2.5 py-2">Mã SP XHĐ</th>
                      <th className="px-2.5 py-2 text-right">Đầu kỳ</th>
                      <th className="px-2.5 py-2 text-right">Nhập CQT</th>
                      <th className="px-2.5 py-2 text-right">Xuất HĐĐT</th>
                      <th className="px-2.5 py-2 text-right">Tồn kho / TK 156</th>
                      <th className="px-2.5 py-2">Trạng thái</th>
                      <th className="px-2 py-2 text-center">Thẻ kho</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedNppRow.mst_breakdown ?? []).map((b) => (
                      <tr
                        key={`${b.tax_code}::${b.sku}`}
                        className="border-b border-slate-100 even:bg-amber-50/40 hover:bg-sky-50/60 text-[11px]"
                      >
                        <td className="px-2.5 py-1.5 font-mono font-bold text-slate-800 whitespace-nowrap">
                          {b.tax_code}
                        </td>
                        <td className="px-2.5 py-1.5 max-w-[220px] truncate text-slate-700 font-medium" title={b.company_name}>
                          {b.company_name}
                        </td>
                        <td className="px-2.5 py-1.5 font-mono font-bold text-sky-800 whitespace-nowrap">
                          <div>{b.invoice_product_code || b.sku}</div>
                          {b.invoice_product_code && b.invoice_product_code !== b.sku && (
                            <div className="text-[9px] font-normal text-slate-400">
                              CQT: {b.sku}
                            </div>
                          )}
                          {(b.conversion_factor ?? 1) > 1 && (
                            <div className="text-[9px] font-semibold text-violet-700">
                              Quy đổi: ×{b.conversion_factor} ({b.unit_name})
                            </div>
                          )}
                        </td>
                        <td className="px-2.5 py-1.5 text-right whitespace-nowrap">
                          {formatNumber(b.opening_qty)}
                        </td>
                        <td className="px-2.5 py-1.5 text-right whitespace-nowrap">
                          <div className="font-semibold text-emerald-700">{formatNumber(b.input_qty)}</div>
                          <div className="text-[10px] text-slate-400">{formatVND(b.input_amount)}</div>
                        </td>
                        <td className="px-2.5 py-1.5 text-right whitespace-nowrap">
                          <div className="font-semibold text-slate-700">{formatNumber(b.output_qty)}</div>
                          <div className="text-[10px] text-slate-400">{formatVND(b.output_amount)}</div>
                        </td>
                        <td className="px-2.5 py-1.5 text-right whitespace-nowrap">
                          <div
                            className={`font-bold ${
                              b.status === "NEGATIVE"
                                ? "text-red-700"
                                : b.status === "LOW"
                                ? "text-amber-700"
                                : "text-emerald-700"
                            }`}
                          >
                            {formatNumber(b.balance_qty)}
                          </div>
                          <div className="text-[10px] text-slate-500">{formatVND(b.ending_inventory_value)}</div>
                        </td>
                        <td className="px-2.5 py-1.5 whitespace-nowrap">
                          {b.status === "NEGATIVE" ? (
                            <span className="inline-flex items-center gap-1 rounded bg-red-100 border border-red-300 px-1.5 py-0.5 text-[10px] font-bold text-red-800">
                              <ShieldAlert size={11} /> Âm kho
                            </span>
                          ) : b.status === "LOW" ? (
                            <span className="inline-flex items-center gap-1 rounded bg-amber-100 border border-amber-300 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                              Tồn thấp
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded bg-emerald-100 border border-emerald-200 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                              Đủ đầu vào
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-center whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() =>
                              void openStockCard({
                                tax_code: b.tax_code,
                                company_name: b.company_name,
                                sku: b.sku,
                                product_name: b.product_name,
                                unit_name: b.unit_name,
                              })
                            }
                            className="inline-flex items-center gap-1 rounded border border-sky-200 bg-sky-50 hover:bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-800"
                          >
                            <History size={11} /> Thẻ kho
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="border-t border-slate-300 bg-slate-100 px-3 py-2 flex items-center justify-between gap-3 shrink-0">
              <span className="text-[10px] text-slate-500">
                Bấm nút &ldquo;Thẻ kho&rdquo; trên từng MST để xem chi tiết từng hóa đơn Nhập – Xuất theo trục thời gian.
              </span>
              <button
                type="button"
                onClick={() => setSelectedNppRow(null)}
                className="rounded bg-red-700 hover:bg-red-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1b: Nhật Ký Nhập – Xuất – Tồn Thuế Theo Từng Ngày */}
      {dailyTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setDailyTarget(null)}
        >
          <div
            className="w-full max-w-5xl border border-slate-400 bg-white shadow-lg max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-[#14263d] px-3 py-2 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Calendar size={17} className="text-red-500" />
                <span className="text-xs font-bold uppercase tracking-wide text-white">
                  Nhật Ký Tồn Đầu – Nhập – Xuất – Tồn Cuối Từng Ngày · {dailyTarget.sku}
                  {dailyTarget.tax_code !== "ALL" ? ` · MST ${dailyTarget.tax_code}` : " · Tổng Hợp NPP"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setDailyTarget(null)}
                className="rounded p-1 text-white hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </div>

            <div className="border-b border-sky-100 bg-sky-50/60 px-3 py-2 flex flex-wrap items-end justify-between gap-2 text-[11px]">
              <div>
                <div className="font-bold text-sky-900">
                  {dailyTarget.product_name} ({dailyTarget.unit_name || "ĐVT"})
                </div>
                {dailyData && (
                  <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold text-slate-700 mt-0.5">
                    <span>Đầu kỳ: {formatNumber(dailyData.summary.period_opening_qty)}</span>
                    <span className="text-emerald-700">Nhập: +{formatNumber(dailyData.summary.total_input_qty)}</span>
                    <span className="text-slate-700">Xuất: -{formatNumber(dailyData.summary.total_output_qty)}</span>
                    <span className={dailyData.summary.period_closing_qty < 0 ? "text-red-700 font-bold" : "text-emerald-700 font-bold"}>
                      Cuối kỳ: {formatNumber(dailyData.summary.period_closing_qty)}
                    </span>
                    {dailyData.summary.negative_days_count > 0 && (
                      <span className="rounded bg-red-100 border border-red-300 px-1.5 py-0.5 text-[10px] font-bold text-red-800">
                        {dailyData.summary.negative_days_count} ngày âm kho!
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <label className="text-[10px] font-semibold text-slate-600 block">Từ ngày</label>
                  <input
                    type="date"
                    value={dailyFrom}
                    onChange={(e) => {
                      setDailyFrom(e.target.value);
                      void loadDailyLedger(dailyTarget, e.target.value, dailyTo, dailyOnlyActive);
                    }}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-slate-600 block">Đến ngày</label>
                  <input
                    type="date"
                    value={dailyTo}
                    onChange={(e) => {
                      setDailyTo(e.target.value);
                      void loadDailyLedger(dailyTarget, dailyFrom, e.target.value, dailyOnlyActive);
                    }}
                    className={inputCls}
                  />
                </div>
                <label className="inline-flex items-center gap-1.5 pb-1 text-[11px] font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={dailyOnlyActive}
                    onChange={(e) => {
                      setDailyOnlyActive(e.target.checked);
                      void loadDailyLedger(dailyTarget, dailyFrom, dailyTo, e.target.checked);
                    }}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-sky-600"
                  />
                  Chỉ ngày có phát sinh
                </label>
                <button
                  type="button"
                  disabled={dailyExporting || dailyLoading}
                  onClick={() => void handleExportDailyExcel()}
                  className="inline-flex items-center gap-1 rounded bg-emerald-600 hover:bg-emerald-700 px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-60"
                >
                  {dailyExporting ? <Loader2 size={12} className="animate-spin" /> : <FileSpreadsheet size={12} />}
                  Xuất Excel
                </button>
              </div>
            </div>

            <div className="overflow-y-auto flex-1">
              {dailyLoading ? (
                <div className="py-10 text-center text-xs text-slate-500">
                  <span className="inline-flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin text-sky-600" /> Đang tính tồn kho thuế theo từng ngày...
                  </span>
                </div>
              ) : dailyError ? (
                <div className="m-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {dailyError}
                </div>
              ) : !dailyData || dailyData.days.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-500">
                  Không có dữ liệu ngày nào khớp với bộ lọc.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left">
                    <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600 uppercase sticky top-0">
                      <tr className="border-b border-slate-200">
                        <th className="px-2.5 py-2">Ngày</th>
                        <th className="px-2.5 py-2 text-right">Tồn đầu ngày</th>
                        <th className="px-2.5 py-2 text-right">Nhập trong ngày</th>
                        <th className="px-2.5 py-2 text-right">Xuất trong ngày</th>
                        <th className="px-2.5 py-2 text-right">Tồn cuối ngày</th>
                        <th className="px-2.5 py-2 text-center">Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyData.days.map((d) => (
                        <tr
                          key={d.date}
                          className={`border-b border-slate-100 text-[11px] ${
                            d.is_negative
                              ? "bg-red-50/80 hover:bg-red-100/70"
                              : d.has_activity
                              ? "bg-sky-50/30 hover:bg-sky-50/70"
                              : "even:bg-amber-50/30 hover:bg-slate-50"
                          }`}
                        >
                          <td className="px-2.5 py-1.5 font-mono font-semibold text-slate-800 whitespace-nowrap">
                            {d.date}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-medium text-slate-700">
                            {formatNumber(d.opening_qty)}
                          </td>
                          <td className="px-2.5 py-1.5 text-right whitespace-nowrap">
                            {d.input_qty !== 0 ? (
                              <>
                                <div className="font-semibold text-emerald-700">+{formatNumber(d.input_qty)}</div>
                                <div className="text-[10px] text-slate-400">{formatVND(d.input_amount)}</div>
                              </>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                          <td className="px-2.5 py-1.5 text-right whitespace-nowrap">
                            {d.output_qty !== 0 ? (
                              <>
                                <div className="font-semibold text-slate-700">-{formatNumber(d.output_qty)}</div>
                                <div className="text-[10px] text-slate-400">{formatVND(d.output_amount)}</div>
                              </>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                          <td
                            className={`px-2.5 py-1.5 text-right font-bold whitespace-nowrap ${
                              d.is_negative ? "text-red-700" : "text-emerald-700"
                            }`}
                          >
                            {formatNumber(d.closing_qty)}
                          </td>
                          <td className="px-2.5 py-1.5 text-center whitespace-nowrap">
                            {d.is_negative ? (
                              <span className="inline-flex items-center gap-1 rounded bg-red-100 border border-red-300 px-1.5 py-0.5 text-[9px] font-bold text-red-800">
                                <ShieldAlert size={10} /> Âm kho thuế
                              </span>
                            ) : d.has_activity ? (
                              <span className="rounded bg-sky-100 border border-sky-200 px-1.5 py-0.5 text-[9px] font-semibold text-sky-800">
                                Có phát sinh
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-400">Ổn định</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="border-t border-slate-300 bg-slate-100 px-3 py-2 flex items-center justify-between gap-3 shrink-0">
              <span className="text-[10px] text-slate-500">
                Các ngày bị tô đỏ là ngày tồn cuối ngày bị âm (rủi ro thanh tra thuế xuất trước khi có đầu vào).
              </span>
              <button
                type="button"
                onClick={() => setDailyTarget(null)}
                className="rounded bg-red-700 hover:bg-red-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: Drill-down Thẻ Kho Thuế Chi Tiết */}
      {selectedCardRow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setSelectedCardRow(null)}
        >
          <div
            className="w-full max-w-5xl border border-slate-400 bg-white shadow-lg max-h-[88vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-[#14263d] px-3 py-2 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <History size={17} className="text-red-500" />
                <span className="text-xs font-bold uppercase tracking-wide text-white">
                  Thẻ Kho Thuế Chi Tiết · MST {selectedCardRow.tax_code} · SKU {selectedCardRow.sku}
                </span>
              </div>
              <button type="button" onClick={() => setSelectedCardRow(null)} className="rounded p-1 text-white hover:bg-white/10">
                <X size={16} />
              </button>
            </div>

            <div className="border-b border-sky-100 bg-sky-50/60 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <div className="font-bold text-sky-900">
                {selectedCardRow.product_name} ({selectedCardRow.unit_name || "ĐVT"}) — {selectedCardRow.company_name}
              </div>
              {cardData && (
                <div className="flex items-center gap-4 font-semibold text-slate-700">
                  <span>
                    Đầu kỳ{cardData.opening_as_of_date ? ` (${cardData.opening_as_of_date})` : ""}:{" "}
                    {formatNumber(cardData.opening_qty)}
                  </span>
                  <span className={cardData.closing_qty < 0 ? "text-red-700 font-bold" : "text-emerald-700 font-bold"}>
                    Tồn cuối kỳ: {formatNumber(cardData.closing_qty)}
                  </span>
                </div>
              )}
            </div>

            <div className="overflow-y-auto flex-1">
              {cardLoading ? (
                <div className="py-10 text-center text-xs text-slate-500">
                  <span className="inline-flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin text-sky-600" /> Đang tải lịch sử chứng từ...
                  </span>
                </div>
              ) : cardError ? (
                <div className="m-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{cardError}</div>
              ) : !cardData || cardData.entries.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-500">Không có phát sinh chứng từ trong kỳ.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left">
                    <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600 uppercase sticky top-0">
                      <tr className="border-b border-slate-200">
                        <th className="px-2.5 py-2">Ngày CT</th>
                        <th className="px-2 py-2">Loại</th>
                        <th className="px-2.5 py-2">Ký hiệu / Số HĐ</th>
                        <th className="px-2.5 py-2">Đối tác (NCC / KH)</th>
                        <th className="px-2 py-2 text-right">SL Nhập</th>
                        <th className="px-2 py-2 text-right">SL Xuất</th>
                        <th className="px-2.5 py-2 text-right">Thành tiền</th>
                        <th className="px-2.5 py-2 text-right">Tồn lũy kế</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cardData.entries.map((ev, idx) => (
                        <tr
                          key={`${ev.doc_type}-${ev.invoice_number}-${idx}`}
                          className={`border-b border-slate-100 text-[11px] ${
                            ev.is_negative_point
                              ? "bg-red-50/70 hover:bg-red-100/60"
                              : "even:bg-amber-50/40 hover:bg-sky-50/50"
                          }`}
                        >
                          <td className="px-2.5 py-1.5 font-mono whitespace-nowrap">{ev.tx_date || "—"}</td>
                          <td className="px-2 py-1.5 whitespace-nowrap">
                            {ev.doc_type === "INPUT" ? (
                              <span className="rounded bg-emerald-100 border border-emerald-200 px-1.5 py-0.5 text-[9px] font-bold text-emerald-800">
                                NHẬP CQT
                              </span>
                            ) : ev.doc_type === "ADJUSTMENT" ? (
                              <span className="rounded bg-sky-100 border border-sky-200 px-1.5 py-0.5 text-[9px] font-bold text-sky-800">
                                ĐC TRẢ
                              </span>
                            ) : ev.doc_type === "DRAFT" ? (
                              <span className="rounded bg-amber-100 border border-amber-300 px-1.5 py-0.5 text-[9px] font-bold text-amber-800">
                                NHÁP
                              </span>
                            ) : (
                              <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[9px] font-bold text-slate-700">
                                XUẤT HĐ
                              </span>
                            )}
                          </td>
                          <td className="px-2.5 py-1.5 font-mono font-semibold text-slate-800 whitespace-nowrap">
                            {ev.invoice_symbol ? `${ev.invoice_symbol} - ` : ""}
                            {ev.invoice_number}
                          </td>
                          <td className="px-2.5 py-1.5 max-w-[240px]">
                            <div className="truncate font-medium text-slate-800" title={ev.partner_name}>
                              {ev.partner_name || "—"}
                            </div>
                            {ev.partner_tax_code && (
                              <div className="text-[10px] font-mono text-slate-400">MST: {ev.partner_tax_code}</div>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-right font-semibold text-emerald-700">
                            {ev.qty_in !== 0 ? formatNumber(ev.qty_in) : "—"}
                          </td>
                          <td className="px-2 py-1.5 text-right font-semibold text-slate-700">
                            {ev.qty_out !== 0 ? formatNumber(ev.qty_out) : "—"}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-medium text-slate-700 whitespace-nowrap">
                            {formatVND(ev.amount)}
                          </td>
                          <td
                            className={`px-2.5 py-1.5 text-right font-bold whitespace-nowrap ${
                              ev.is_negative_point ? "text-red-700" : "text-slate-800"
                            }`}
                          >
                            {formatNumber(ev.running_balance)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="border-t border-slate-300 bg-slate-100 px-3 py-2 flex items-center justify-between gap-3 shrink-0">
              <span className="text-[10px] text-slate-500">
                Dòng tô đỏ thể hiện thời điểm tồn kho thuế bị âm (xuất trước khi có hóa đơn đầu vào).
              </span>
              <button
                type="button"
                onClick={() => setSelectedCardRow(null)}
                className="rounded bg-red-700 hover:bg-red-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Quản lý & Import Tồn Đầu Kỳ TK 156 (Chuẩn GEMINI.md) */}
      {showOpeningModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowOpeningModal(false)}
        >
          <div
            className="w-full max-w-5xl border border-slate-400 bg-white shadow-lg max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-[#14263d] px-3 py-2 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Database size={17} className="text-red-500" />
                <span className="text-xs font-bold uppercase tracking-wide text-white">
                  Khai Báo &amp; Import Tồn Kho Thuế Đầu Kỳ (TK 156) Theo MST
                </span>
              </div>
              <button type="button" onClick={() => setShowOpeningModal(false)} className="rounded p-1 text-white hover:bg-white/10">
                <X size={16} />
              </button>
            </div>

            <div className="overflow-y-auto flex-1">
              {/* Form nhập nhanh 1 dòng */}
              <div className="border-b border-sky-100 bg-sky-50/60 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-sky-800 uppercase">
                  Thêm / Cập nhật số dư đầu kỳ (Chứng từ trước ngày chốt sẽ không cộng lặp)
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void downloadOpeningTemplate()}
                    className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white hover:bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-700"
                  >
                    <Download size={12} /> Tải file mẫu Excel
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleImportOpeningExcel(f);
                    }}
                  />
                  <button
                    type="button"
                    disabled={openingSaving}
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1 rounded bg-emerald-600 hover:bg-emerald-700 px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-60"
                  >
                    <Upload size={12} /> Import Excel
                  </button>
                </div>
              </div>

              <div className="border-b border-slate-200 px-3 py-2.5 grid gap-x-3 gap-y-2 sm:grid-cols-2 xl:grid-cols-4">
                <div>
                  <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">MST Pháp nhân *</label>
                  <input
                    value={obTaxCode}
                    onChange={(e) => setObTaxCode(e.target.value)}
                    placeholder="VD: 2900000001"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">Mã SKU CQT *</label>
                  <input
                    value={obSku}
                    onChange={(e) => setObSku(e.target.value)}
                    placeholder="VD: SKU01"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">Tên hàng hóa</label>
                  <input
                    value={obProductName}
                    onChange={(e) => setObProductName(e.target.value)}
                    placeholder="Tên sản phẩm..."
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">ĐVT</label>
                  <input value={obUnit} onChange={(e) => setObUnit(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">Ngày chốt đầu kỳ *</label>
                  <input type="date" value={obDate} onChange={(e) => setObDate(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">SL tồn đầu kỳ *</label>
                  <input
                    type="number"
                    step="any"
                    value={obQty}
                    onChange={(e) => setObQty(e.target.value)}
                    placeholder="0"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">Giá trị TK 156 (VND)</label>
                  <input
                    type="number"
                    step="any"
                    value={obAmount}
                    onChange={(e) => setObAmount(e.target.value)}
                    placeholder="0"
                    className={inputCls}
                  />
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">Ghi chú</label>
                    <input
                      value={obNote}
                      onChange={(e) => setObNote(e.target.value)}
                      placeholder="BCTC năm trước..."
                      className={inputCls}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={openingSaving}
                    onClick={() => void saveOpeningBalance()}
                    className="inline-flex items-center gap-1 rounded bg-sky-600 hover:bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white shrink-0 disabled:bg-slate-300"
                  >
                    {openingSaving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Lưu
                  </button>
                </div>
              </div>

              {openingError && (
                <div className="mx-3 my-2 rounded border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">
                  {openingError}
                </div>
              )}

              {/* Bảng tồn đầu kỳ đã khai báo */}
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600 uppercase">
                    <tr className="border-b border-slate-200">
                      <th className="px-2.5 py-2">MST</th>
                      <th className="px-2.5 py-2">Mã SKU</th>
                      <th className="px-2.5 py-2">Tên hàng</th>
                      <th className="px-2 py-2 text-center">Ngày chốt</th>
                      <th className="px-2.5 py-2 text-right">SL đầu kỳ</th>
                      <th className="px-2.5 py-2 text-right">Giá trị TK 156</th>
                      <th className="px-2.5 py-2">Ghi chú</th>
                      <th className="px-2 py-2 text-center">Xóa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openingLoading ? (
                      <tr>
                        <td colSpan={8} className="py-6 text-center text-xs text-slate-500">
                          Đang tải danh sách tồn đầu kỳ...
                        </td>
                      </tr>
                    ) : openingList.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-6 text-center text-xs text-slate-500">
                          Chưa khai báo số dư tồn đầu kỳ nào.
                        </td>
                      </tr>
                    ) : (
                      openingList.map((r) => (
                        <tr key={r.id} className="border-b border-slate-100 even:bg-amber-50/40 hover:bg-sky-50/50 text-[11px]">
                          <td className="px-2.5 py-1.5 font-mono font-bold text-slate-800">{r.tax_code}</td>
                          <td className="px-2.5 py-1.5 font-mono font-bold text-sky-800">{r.sku}</td>
                          <td className="px-2.5 py-1.5 text-slate-700 max-w-[220px] truncate">{r.product_name || "—"}</td>
                          <td className="px-2 py-1.5 text-center font-mono">{r.as_of_date}</td>
                          <td className="px-2.5 py-1.5 text-right font-semibold text-emerald-700">
                            {formatNumber(r.opening_qty)} {r.unit_name}
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-medium text-slate-700">
                            {formatVND(r.opening_amount)}
                          </td>
                          <td className="px-2.5 py-1.5 text-slate-500 max-w-[160px] truncate">{r.note || "—"}</td>
                          <td className="px-2 py-1.5 text-center">
                            <button
                              type="button"
                              onClick={() => void deleteOpeningRow(r.id)}
                              className="rounded p-1 text-red-600 hover:bg-red-50"
                              title="Xóa bản ghi"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="border-t border-slate-300 bg-slate-100 px-3 py-2 flex items-center justify-between gap-3 shrink-0">
              <span className="text-[10px] text-slate-500">
                Tổng cộng {openingList.length} dòng số dư đầu kỳ đã khai báo.
              </span>
              <button
                type="button"
                onClick={() => setShowOpeningModal(false)}
                className="rounded bg-red-700 hover:bg-red-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Ánh xạ dòng hàng mua vào thiếu mã SKU (MHHDVu trống) */}
      {showUnmappedModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowUnmappedModal(false)}
        >
          <div
            className="w-full max-w-5xl border border-slate-400 bg-white shadow-lg max-h-[88vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-[#14263d] px-3 py-2 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Link2 size={17} className="text-red-500" />
                <span className="text-xs font-bold uppercase tracking-wide text-white">
                  Ánh Xạ Mã SKU Cho Dòng Hàng Mua Vào CQT Bị Trống MHHDVu
                </span>
              </div>
              <button type="button" onClick={() => setShowUnmappedModal(false)} className="rounded p-1 text-white hover:bg-white/10">
                <X size={16} />
              </button>
            </div>

            <div className="border-b border-sky-100 bg-sky-50/60 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <span className="font-bold text-sky-900">
                Các dòng hàng dưới đây bị bỏ qua khỏi sổ tồn kho vì XML của NCC không có mã hàng (MHHDVu).
              </span>
              <label className="inline-flex items-center gap-1.5 font-semibold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={applySameName}
                  onChange={(e) => setApplySameName(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-sky-600"
                />
                Tự động gán cho tất cả dòng có cùng tên hàng
              </label>
            </div>

            {unmappedError && (
              <div className="mx-3 mt-2 rounded border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">
                {unmappedError}
              </div>
            )}

            <div className="overflow-y-auto flex-1">
              <table className="w-full border-collapse text-left">
                <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600 uppercase sticky top-0">
                  <tr className="border-b border-slate-200">
                    <th className="px-2.5 py-2">Ngày / Số HĐ</th>
                    <th className="px-2.5 py-2">Nhà cung cấp</th>
                    <th className="px-2.5 py-2">Tên hàng hóa trên XML</th>
                    <th className="px-2 py-2 text-right">SL / Thành tiền</th>
                    <th className="px-2.5 py-2 w-48">Gán Mã SKU chuẩn</th>
                  </tr>
                </thead>
                <tbody>
                  {unmappedLoading ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-xs text-slate-500">
                        Đang tải danh sách dòng hàng thiếu SKU...
                      </td>
                    </tr>
                  ) : unmappedList.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-xs text-emerald-700 font-semibold">
                        Tất cả dòng hàng mua vào đã có mã SKU đầy đủ!
                      </td>
                    </tr>
                  ) : (
                    unmappedList.map((it) => (
                      <tr key={it.id} className="border-b border-slate-100 even:bg-amber-50/40 hover:bg-sky-50/50 text-[11px]">
                        <td className="px-2.5 py-1.5 whitespace-nowrap">
                          <div className="font-mono font-semibold text-slate-800">{it.invoice_number}</div>
                          <div className="text-[10px] text-slate-400">{it.invoice_date}</div>
                        </td>
                        <td className="px-2.5 py-1.5 max-w-[180px] truncate" title={it.seller_name}>
                          {it.seller_name}
                        </td>
                        <td className="px-2.5 py-1.5 font-medium text-slate-800 max-w-[260px]">
                          {it.product_name}
                        </td>
                        <td className="px-2 py-1.5 text-right whitespace-nowrap">
                          <div className="font-semibold text-emerald-700">
                            {formatNumber(it.quantity)} {it.unit_name}
                          </div>
                          <div className="text-[10px] text-slate-400">{formatVND(it.amount_before_tax)}</div>
                        </td>
                        <td className="px-2.5 py-1.5">
                          <div className="flex items-center gap-1.5">
                            <input
                              value={skuInputs[it.id] || ""}
                              onChange={(e) => setSkuInputs({ ...skuInputs, [it.id]: e.target.value })}
                              placeholder="Nhập SKU..."
                              className={`${inputCls} font-mono uppercase`}
                            />
                            <button
                              type="button"
                              disabled={mappingId === it.id}
                              onClick={() => void handleMapSku(it.id)}
                              className="inline-flex items-center gap-1 rounded bg-sky-600 hover:bg-sky-700 px-2.5 py-1 text-[11px] font-semibold text-white shrink-0 disabled:bg-slate-300"
                            >
                              {mappingId === it.id ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                              Gán
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="border-t border-slate-300 bg-slate-100 px-3 py-2 flex items-center justify-between gap-3 shrink-0">
              <span className="text-[10px] text-slate-500">
                Đang hiển thị {unmappedList.length} dòng hàng chưa có mã SKU (đã tự động bỏ qua dòng chiết khấu/ghi chú TChat 3, 4).
              </span>
              <button
                type="button"
                onClick={() => setShowUnmappedModal(false)}
                className="rounded bg-red-700 hover:bg-red-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

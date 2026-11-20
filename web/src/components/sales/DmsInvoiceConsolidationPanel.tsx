"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Filter,
  Layers,
  Loader2,
  Package,
  RefreshCw,
  ShieldAlert,
  Users,
  X,
} from "lucide-react";
import Badge from "@/components/ui/Badge";
import { API_URL, apiFetch } from "@/lib/api";
import { formatVND } from "@/lib/format";

const inputCls =
  "w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-100";

interface ConsolidatedItem {
  line_number: number;
  product_code: string;
  source_product_code: string;
  product_name: string;
  unit_name: string;
  is_promo: boolean;
  is_registered: boolean;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  amount_before_tax: number;
  vat_rate: number;
  vat_amount: number;
  total_amount: number;
}

interface ConsolidatedGroup {
  group_key: string;
  is_valid: boolean;
  validation_errors: string[];
  missing_flags: string[];
  company_id: number | null;
  company_code: string;
  company_name: string;
  company_tax_code: string;
  identity_type: "TAX_CODE" | "CITIZEN_ID" | "MISSING_ID";
  identity_value: string;
  buyer_name: string;
  buyer_tax_code: string;
  buyer_citizen_id: string;
  buyer_address: string;
  buyer_email: string;
  buyer_phone: string;
  customer_codes: string[];
  customer_count: number;
  order_numbers: string[];
  order_count: number;
  suppliers: string[];
  item_count: number;
  items: ConsolidatedItem[];
  subtotal_before_tax: number;
  vat_amount: number;
  total_payment: number;
}

interface ProviderOption {
  code: string;
  name: string;
  ext: string;
}

interface CompanySummaryOption {
  id: number;
  code: string;
  name: string;
  tax_code: string;
}

interface ConsolidationResponse {
  from_date: string;
  to_date: string;
  date_field: string;
  distributor_id: number | null;
  default_vat_rate: number;
  summary: {
    total_groups: number;
    valid_groups: number;
    invalid_groups: number;
    total_orders: number;
    total_customers: number;
    total_before_tax: number;
    total_vat: number;
    total_payment: number;
    companies: CompanySummaryOption[];
  };
  groups: ConsolidatedGroup[];
  supported_providers: ProviderOption[];
}

interface DmsInvoiceConsolidationPanelProps {
  distributorId: number | null;
  distributorLabel?: string;
}

function formatDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function DmsInvoiceConsolidationPanel({
  distributorId,
  distributorLabel,
}: DmsInvoiceConsolidationPanelProps) {
  const todayStr = useMemo(() => formatDateInput(new Date()), []);
  const weekAgoStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return formatDateInput(d);
  }, []);

  const [fromDate, setFromDate] = useState<string>(weekAgoStr);
  const [toDate, setToDate] = useState<string>(todayStr);
  const [dateField, setDateField] = useState<"order_created_date" | "delivery_date">(
    "order_created_date",
  );
  const [companyId, setCompanyId] = useState<string>("ALL");
  const [vatRate, setVatRate] = useState<number>(8);
  const [excludeInvoiced, setExcludeInvoiced] = useState<boolean>(true);
  const [validityFilter, setValidityFilter] = useState<"ALL" | "VALID" | "INVALID">("ALL");

  const [companyOptions, setCompanyOptions] = useState<CompanySummaryOption[]>([]);
  const [data, setData] = useState<ConsolidationResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [message, setMessage] = useState<string>("");

  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({});

  // Modal Xuất file HĐĐT
  const [exportModalOpen, setExportModalOpen] = useState<boolean>(false);
  const [provider, setProvider] = useState<string>("VIETTEL");
  const [customNote, setCustomNote] = useState<string>("");
  const [splitByCompany, setSplitByCompany] = useState<boolean>(true);
  const [exporting, setExporting] = useState<boolean>(false);
  const [exportError, setExportError] = useState<string>("");

  // Nạp danh sách Công ty quản lý của NPP đang chọn
  useEffect(() => {
    const params = new URLSearchParams({ limit: "5000" });
    if (distributorId !== null) params.set("distributor_id", String(distributorId));
    apiFetch(`${API_URL}/companies/?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Array<Record<string, unknown>>) => {
        const mapped = list.map((c) => ({
          id: Number(c.id),
          code: String(c.code ?? ""),
          name: String(c.name ?? ""),
          tax_code: String(c.tax_code ?? ""),
        }));
        setCompanyOptions(mapped);
        setCompanyId((prev) =>
          prev === "ALL" || mapped.some((c) => String(c.id) === prev) ? prev : "ALL",
        );
      })
      .catch(() => {});
  }, [distributorId]);

  const fetchConsolidation = useCallback(async () => {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const params = new URLSearchParams({
        from_date: fromDate,
        to_date: toDate,
        date_field: dateField,
        default_vat_rate: String(vatRate),
        exclude_invoiced: String(excludeInvoiced),
      });
      if (distributorId !== null) params.set("distributor_id", String(distributorId));
      if (companyId !== "ALL") params.set("company_id", companyId);

      const res = await apiFetch(`${API_URL}/einvoice/dms-consolidation?${params.toString()}`);
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.detail || "Không thể tổng hợp đơn hàng DMS.");
      }
      const typed = payload as ConsolidationResponse;
      setData(typed);
      // Tự động tích chọn tất cả các nhóm hợp lệ để kế toán có thể xuất nhanh
      setSelectedKeys(typed.groups.filter((g) => g.is_valid).map((g) => g.group_key));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi khi tổng hợp đơn hàng DMS.");
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, dateField, vatRate, excludeInvoiced, distributorId, companyId]);

  useEffect(() => {
    void fetchConsolidation();
  }, [fetchConsolidation]);

  function applyQuickRange(kind: "today" | "yesterday" | "7days" | "month") {
    const now = new Date();
    if (kind === "today") {
      const s = formatDateInput(now);
      setFromDate(s);
      setToDate(s);
    } else if (kind === "yesterday") {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      const s = formatDateInput(y);
      setFromDate(s);
      setToDate(s);
    } else if (kind === "7days") {
      const past = new Date(now);
      past.setDate(past.getDate() - 6);
      setFromDate(formatDateInput(past));
      setToDate(formatDateInput(now));
    } else {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      setFromDate(formatDateInput(first));
      setToDate(formatDateInput(now));
    }
  }

  const visibleGroups = useMemo(() => {
    if (!data) return [];
    if (validityFilter === "VALID") return data.groups.filter((g) => g.is_valid);
    if (validityFilter === "INVALID") return data.groups.filter((g) => !g.is_valid);
    return data.groups;
  }, [data, validityFilter]);

  const validGroups = useMemo(
    () => (data ? data.groups.filter((g) => g.is_valid) : []),
    [data],
  );

  const selectedGroups = useMemo(
    () => (data ? data.groups.filter((g) => selectedKeys.includes(g.group_key) && g.is_valid) : []),
    [data, selectedKeys],
  );

  const selectedCompaniesCount = useMemo(() => {
    const set = new Set(selectedGroups.map((g) => g.company_code || "NONE"));
    return set.size;
  }, [selectedGroups]);

  const selectedTotalPayment = useMemo(
    () => selectedGroups.reduce((sum, g) => sum + g.total_payment, 0),
    [selectedGroups],
  );

  function toggleGroup(key: string) {
    setSelectedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  function toggleSelectAllValid() {
    if (selectedKeys.length === validGroups.length && validGroups.length > 0) {
      setSelectedKeys([]);
    } else {
      setSelectedKeys(validGroups.map((g) => g.group_key));
    }
  }

  function toggleExpand(key: string) {
    setExpandedKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleExportFile() {
    if (selectedGroups.length === 0) {
      setExportError("Chưa có nhóm hóa đơn hợp lệ nào được chọn.");
      return;
    }
    setExporting(true);
    setExportError("");
    setMessage("");
    try {
      const res = await apiFetch(`${API_URL}/einvoice/dms-consolidation/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_date: fromDate,
          to_date: toDate,
          date_field: dateField,
          distributor_id: distributorId,
          company_id: companyId !== "ALL" ? Number(companyId) : null,
          default_vat_rate: vatRate,
          exclude_invoiced: excludeInvoiced,
          group_keys: selectedGroups.map((g) => g.group_key),
          provider,
          custom_note: customNote.trim(),
          split_by_company: splitByCompany,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "Không thể xuất file hóa đơn điện tử.");
      }

      const disp = res.headers.get("Content-Disposition") || "";
      const match = disp.match(/filename="?([^"]+)"?/i);
      const ext = provider === "VIETTEL" ? "xls" : "xlsx";
      const fallbackName = `HD_${provider}_${fromDate}_${toDate}.${selectedCompaniesCount > 1 && splitByCompany ? "zip" : ext}`;
      const filename = match?.[1] || fallbackName;

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      setMessage(
        `Đã xuất thành công ${selectedGroups.length} nhóm hóa đơn (${filename}) theo mẫu ${provider}.`,
      );
      setExportModalOpen(false);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Lỗi khi xuất file HĐĐT.");
    } finally {
      setExporting(false);
    }
  }

  const providers: ProviderOption[] = data?.supported_providers?.length
    ? data.supported_providers
    : [
        { code: "VIETTEL", name: "Viettel S-Invoice (Mẫu C26TTD .xls)", ext: "xls" },
        { code: "MISA", name: "MISA meInvoice (Mẫu nhập khẩu .xlsx)", ext: "xlsx" },
        { code: "VNPT", name: "VNPT Invoice (Mẫu nhập khẩu .xlsx)", ext: "xlsx" },
        { code: "EASYINVOICE", name: "EasyInvoice (Mẫu nhập khẩu .xlsx)", ext: "xlsx" },
      ];

  return (
    <div className="space-y-4">
      {/* Khung bộ lọc chuẩn CreateOrderForm */}
      <div className="border border-slate-400 bg-white shadow-sm">
        <div className="bg-[#14263d] px-3 py-2 text-white flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Calendar size={16} className="text-red-500" />
            <span className="text-xs font-bold uppercase tracking-wide">
              Tổng hợp đơn hàng DMS & Tự động gom Hóa đơn theo MST / CCCD & Công ty quản lý
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {(
              [
                ["today", "Hôm nay"],
                ["yesterday", "Hôm qua"],
                ["7days", "7 ngày"],
                ["month", "Tháng này"],
              ] as const
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => applyQuickRange(k)}
                className="rounded bg-white/10 hover:bg-white/20 px-2 py-0.5 text-[10px] font-semibold text-white transition-colors"
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        <div className="px-3 py-2.5 grid gap-x-3 gap-y-2 sm:grid-cols-2 xl:grid-cols-6 items-end">
          <div>
            <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
              Từ ngày
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className={inputCls}
            />
          </div>

          <div>
            <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
              Đến ngày
            </label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className={inputCls}
            />
          </div>

          <div>
            <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
              Tiêu chí ngày lọc
            </label>
            <select
              value={dateField}
              onChange={(e) =>
                setDateField(e.target.value as "order_created_date" | "delivery_date")
              }
              className={inputCls}
            >
              <option value="order_created_date">Ngày tạo đơn DMS</option>
              <option value="delivery_date">Ngày giao hàng</option>
            </select>
          </div>

          <div>
            <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
              Công ty quản lý
            </label>
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className={inputCls}
            >
              <option value="ALL">Tất cả công ty ({companyOptions.length})</option>
              {companyOptions.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.code} · {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
              Thuế suất GTGT mặc định
            </label>
            <select
              value={vatRate}
              onChange={(e) => setVatRate(Number(e.target.value))}
              className={inputCls}
            >
              <option value={0}>0%</option>
              <option value={5}>5%</option>
              <option value={8}>8% (Nghị định giảm thuế)</option>
              <option value={10}>10%</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void fetchConsolidation()}
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded bg-sky-600 hover:bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:bg-slate-300"
            >
              {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              Tổng hợp dữ liệu
            </button>
          </div>
        </div>

        <div className="border-t border-slate-200 bg-slate-50 px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <label className="inline-flex items-center gap-1.5 text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={excludeInvoiced}
              onChange={(e) => setExcludeInvoiced(e.target.checked)}
              className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
            />
            Chỉ lấy các đơn hàng DMS <strong>chưa xuất hóa đơn</strong>
          </label>
          <div className="flex items-center gap-2">
            <span className="text-slate-500 flex items-center gap-1">
              <Filter size={12} /> Trạng thái hồ sơ:
            </span>
            {(
              [
                ["ALL", `Tất cả (${data?.summary.total_groups ?? 0})`],
                ["VALID", `Đủ điều kiện (${data?.summary.valid_groups ?? 0})`],
                ["INVALID", `Thiếu thông tin (${data?.summary.invalid_groups ?? 0})`],
              ] as const
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setValidityFilter(k)}
                className={`rounded px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                  validityFilter === k
                    ? "bg-[#14263d] text-white"
                    : "bg-white border border-slate-300 text-slate-600 hover:bg-slate-100"
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 flex items-center gap-2">
          <AlertTriangle size={15} /> {error}
        </div>
      )}
      {message && (
        <div className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 flex items-center gap-2">
          <CheckCircle2 size={15} /> {message}
        </div>
      )}

      {/* Cảnh báo bắt buộc đăng ký thông tin trước khi xuất */}
      {data && data.summary.invalid_groups > 0 && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 space-y-2">
          <div className="flex items-start gap-2">
            <ShieldAlert size={17} className="text-red-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-bold text-red-800">
                Có {data.summary.invalid_groups} nhóm hóa đơn CHƯA ĐỦ ĐIỀU KIỆN XUẤT do thiếu thông tin bắt buộc!
              </p>
              <p className="text-[11px] text-amber-900">
                Hệ thống đã tự động khóa nút chọn xuất đối với các nhóm chưa đăng ký đầy đủ{" "}
                <strong>Sản phẩm (SKU CQT)</strong>, <strong>Thông tin Khách hàng (MST/CCCD)</strong>, hoặc{" "}
                <strong>Công ty quản lý</strong>. Vui lòng hoàn tất đăng ký tại các danh mục sau rồi bấm{" "}
                <em>Tổng hợp dữ liệu</em> lại:
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pl-6">
            <Link
              href="/customers"
              className="inline-flex items-center gap-1 rounded border border-amber-400 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-100"
            >
              <Users size={12} /> Đăng ký Khách hàng (MST/CCCD) <ExternalLink size={11} />
            </Link>
            <Link
              href="/customers/companies"
              className="inline-flex items-center gap-1 rounded border border-amber-400 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-100"
            >
              <Building2 size={12} /> Đăng ký Công ty quản lý <ExternalLink size={11} />
            </Link>
            <Link
              href="/products"
              className="inline-flex items-center gap-1 rounded border border-amber-400 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-100"
            >
              <Package size={12} /> Đăng ký Sản phẩm (SKU CQT) <ExternalLink size={11} />
            </Link>
          </div>
        </div>
      )}

      {/* KPI tóm tắt */}
      {data && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded border border-slate-300 bg-white px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase text-slate-500">Hóa đơn dự kiến sau gom</p>
            <p className="text-lg font-bold text-slate-900 mt-0.5">
              {data.summary.total_groups}{" "}
              <span className="text-xs font-semibold text-emerald-600">
                ({data.summary.valid_groups} hợp lệ)
              </span>
            </p>
          </div>
          <div className="rounded border border-slate-300 bg-white px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase text-slate-500">Đơn DMS & Mã KH đã gom</p>
            <p className="text-lg font-bold text-sky-700 mt-0.5">
              {data.summary.total_orders} đơn{" "}
              <span className="text-xs font-normal text-slate-500">
                / {data.summary.total_customers} mã KH
              </span>
            </p>
          </div>
          <div className="rounded border border-slate-300 bg-white px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase text-slate-500">Tiền hàng trước thuế</p>
            <p className="text-lg font-bold text-slate-800 mt-0.5">
              {formatVND(data.summary.total_before_tax)}
            </p>
          </div>
          <div className="rounded border border-slate-300 bg-white px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase text-slate-500">Tổng thanh toán (gồm VAT)</p>
            <p className="text-lg font-bold text-emerald-700 mt-0.5">
              {formatVND(data.summary.total_payment)}
            </p>
          </div>
        </div>
      )}

      {/* Bảng kết quả tổng hợp & gom nhóm */}
      <div className="border border-slate-400 bg-white shadow-sm">
        <div className="border-b border-sky-100 bg-sky-50/70 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Layers size={15} className="text-sky-700" />
            <span className="text-[11px] font-bold uppercase text-sky-900">
              Danh sách Hóa đơn đã gom tự động ({visibleGroups.length})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-600">
              Đã chọn: <strong>{selectedGroups.length}</strong> nhóm hợp lệ ({formatVND(selectedTotalPayment)})
            </span>
            <button
              type="button"
              disabled={selectedGroups.length === 0}
              onClick={() => {
                setExportError("");
                setExportModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded bg-emerald-600 hover:bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <FileSpreadsheet size={14} /> Xuất file theo mẫu HĐĐT ({selectedGroups.length})
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600 uppercase">
              <tr className="border-b border-slate-200">
                <th className="px-2.5 py-2 w-8 text-center">
                  <input
                    type="checkbox"
                    aria-label="Chọn tất cả nhóm hợp lệ"
                    disabled={validGroups.length === 0}
                    checked={validGroups.length > 0 && selectedKeys.length === validGroups.length}
                    onChange={toggleSelectAllValid}
                  />
                </th>
                <th className="px-2 py-2 w-7"></th>
                <th className="px-2.5 py-2">Công ty quản lý</th>
                <th className="px-2.5 py-2">Khách hàng / Định danh gom</th>
                <th className="px-2.5 py-2 text-center">Mã KH gom</th>
                <th className="px-2.5 py-2 text-center">Số đơn DMS</th>
                <th className="px-2.5 py-2 text-right">Trước thuế</th>
                <th className="px-2.5 py-2 text-right">Thuế GTGT</th>
                <th className="px-2.5 py-2 text-right">Tổng cộng</th>
                <th className="px-2.5 py-2">Trạng thái kiểm tra</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-xs text-slate-500">
                    <Loader2 size={18} className="animate-spin inline mr-2 text-sky-600" />
                    Đang tổng hợp và gom nhóm đơn hàng DMS...
                  </td>
                </tr>
              )}
              {!loading && visibleGroups.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-xs text-slate-500">
                    Không có đơn hàng DMS nào trong khoảng ngày {fromDate} → {toDate}.
                  </td>
                </tr>
              )}
              {!loading &&
                visibleGroups.map((grp) => {
                  const isExpanded = Boolean(expandedKeys[grp.group_key]);
                  const isChecked = selectedKeys.includes(grp.group_key);
                  return (
                    <>
                      <tr
                        key={grp.group_key}
                        onClick={() => toggleExpand(grp.group_key)}
                        className={`border-b border-slate-100 text-[11px] cursor-pointer transition-colors ${
                          !grp.is_valid
                            ? "bg-red-50/40 hover:bg-red-50/70"
                            : "even:bg-amber-50/40 hover:bg-sky-50/50"
                        }`}
                      >
                        <td
                          className="px-2.5 py-2 text-center"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            disabled={!grp.is_valid}
                            checked={isChecked && grp.is_valid}
                            title={
                              grp.is_valid
                                ? "Chọn xuất hóa đơn này"
                                : "Chưa đủ thông tin đăng ký (Khách hàng / Công ty QL / Sản phẩm)"
                            }
                            onChange={() => toggleGroup(grp.group_key)}
                          />
                        </td>
                        <td className="px-2 py-2 text-slate-500">
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </td>
                        <td className="px-2.5 py-2">
                          {grp.company_code ? (
                            <div>
                              <span className="font-mono text-[10px] font-bold text-sky-800 bg-sky-50 border border-sky-200 rounded px-1 py-0.5">
                                {grp.company_code}
                              </span>
                              <p className="text-[11px] text-slate-700 font-medium truncate max-w-[180px]">
                                {grp.company_name}
                              </p>
                            </div>
                          ) : (
                            <Badge variant="danger">Chưa gán Công ty QL</Badge>
                          )}
                        </td>
                        <td className="px-2.5 py-2">
                          <p className="font-semibold text-slate-900">{grp.buyer_name}</p>
                          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                            {grp.buyer_tax_code ? (
                              <span className="font-mono text-[10px] bg-indigo-50 text-indigo-800 border border-indigo-200 rounded px-1">
                                MST: {grp.buyer_tax_code}
                              </span>
                            ) : grp.buyer_citizen_id ? (
                              <span className="font-mono text-[10px] bg-purple-50 text-purple-800 border border-purple-200 rounded px-1">
                                CCCD: {grp.buyer_citizen_id}
                              </span>
                            ) : (
                              <span className="text-[10px] text-red-600 font-semibold">
                                Thiếu MST & CCCD
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-2.5 py-2 text-center font-semibold">
                          <Badge variant={grp.customer_count > 1 ? "purple" : "default"}>
                            {grp.customer_count > 1
                              ? `Gộp ${grp.customer_count} mã KH`
                              : grp.customer_codes[0] || "—"}
                          </Badge>
                        </td>
                        <td className="px-2.5 py-2 text-center font-semibold text-slate-700">
                          {grp.order_count} đơn
                        </td>
                        <td className="px-2.5 py-2 text-right font-medium text-slate-700">
                          {formatVND(grp.subtotal_before_tax)}
                        </td>
                        <td className="px-2.5 py-2 text-right font-medium text-slate-600">
                          {formatVND(grp.vat_amount)}
                        </td>
                        <td className="px-2.5 py-2 text-right font-bold text-slate-900">
                          {formatVND(grp.total_payment)}
                        </td>
                        <td className="px-2.5 py-2">
                          {grp.is_valid ? (
                            <Badge variant="success">Đủ điều kiện xuất</Badge>
                          ) : (
                            <Badge variant="danger">
                              Thiếu {grp.validation_errors.length} mục
                            </Badge>
                          )}
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr key={`${grp.group_key}-detail`} className="bg-slate-50/90 border-b border-slate-200">
                          <td colSpan={10} className="px-4 py-3 space-y-2.5">
                            {!grp.is_valid && (
                              <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-800 space-y-1">
                                <p className="font-bold flex items-center gap-1.5">
                                  <AlertTriangle size={13} /> Lý do chưa cho phép xuất hóa đơn:
                                </p>
                                <ul className="list-disc pl-5 space-y-0.5">
                                  {grp.validation_errors.map((errText, idx) => (
                                    <li key={idx}>{errText}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            <div className="flex flex-wrap gap-4 text-[11px] text-slate-600">
                              <span>
                                <strong>Các mã KH được gom:</strong>{" "}
                                <span className="font-mono text-slate-800">
                                  {grp.customer_codes.join(", ")}
                                </span>
                              </span>
                              <span>
                                <strong>Số đơn DMS:</strong>{" "}
                                <span className="font-mono text-slate-800">
                                  {grp.order_numbers.join(", ")}
                                </span>
                              </span>
                              {grp.buyer_address && (
                                <span>
                                  <strong>Địa chỉ:</strong> {grp.buyer_address}
                                </span>
                              )}
                            </div>

                            <div className="overflow-x-auto border border-slate-200 bg-white">
                              <table className="w-full border-collapse text-left text-[11px]">
                                <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600">
                                  <tr className="border-b border-slate-200">
                                    <th className="px-2 py-1.5 w-10 text-center">STT</th>
                                    <th className="px-2 py-1.5">Mã SKU CQT</th>
                                    <th className="px-2 py-1.5">Tên hàng hóa / dịch vụ</th>
                                    <th className="px-2 py-1.5 text-center">ĐVT</th>
                                    <th className="px-2 py-1.5 text-center">SL</th>
                                    <th className="px-2 py-1.5 text-right">Đơn giá</th>
                                    <th className="px-2 py-1.5 text-right">Thành tiền</th>
                                    <th className="px-2 py-1.5 text-center">VAT</th>
                                    <th className="px-2 py-1.5 text-right">Tổng tiền</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {grp.items.map((it) => (
                                    <tr
                                      key={`${it.line_number}-${it.product_code}`}
                                      className={`border-b border-slate-100 ${
                                        !it.is_registered ? "bg-red-50/60" : ""
                                      }`}
                                    >
                                      <td className="px-2 py-1 text-center">{it.line_number}</td>
                                      <td className="px-2 py-1 font-mono font-semibold">
                                        {it.product_code}
                                        {!it.is_registered && (
                                          <span className="ml-1.5 rounded bg-red-100 px-1 text-[9px] text-red-700">
                                            Chưa đăng ký
                                          </span>
                                        )}
                                      </td>
                                      <td className="px-2 py-1">{it.product_name}</td>
                                      <td className="px-2 py-1 text-center">{it.unit_name}</td>
                                      <td className="px-2 py-1 text-center font-semibold">{it.quantity}</td>
                                      <td className="px-2 py-1 text-right">{formatVND(it.unit_price)}</td>
                                      <td className="px-2 py-1 text-right font-medium">
                                        {formatVND(it.amount_before_tax)}
                                      </td>
                                      <td className="px-2 py-1 text-center">{it.vat_rate}%</td>
                                      <td className="px-2 py-1 text-right font-semibold">
                                        {formatVND(it.total_amount)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Xuất file theo mẫu HĐĐT (chuẩn CreateOrderForm.tsx - GEMINI.md) */}
      {exportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-xl border border-slate-400 bg-white shadow-lg">
            <div className="bg-[#14263d] px-3 py-2 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileSpreadsheet size={17} className="text-red-500" />
                <span className="text-xs font-bold uppercase tracking-wide text-white">
                  Xuất File Hóa Đơn Điện Tử Theo Mẫu Nhà Cung Cấp
                </span>
              </div>
              <button
                type="button"
                onClick={() => setExportModalOpen(false)}
                className="rounded p-1 text-white hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-3.5 space-y-3">
              <div className="rounded border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 space-y-0.5">
                <p>
                  Đang xuất <strong>{selectedGroups.length} nhóm hóa đơn hợp lệ</strong>{" "}
                  ({selectedCompaniesCount} Công ty quản lý) — Tổng thanh toán:{" "}
                  <strong>{formatVND(selectedTotalPayment)}</strong>
                </p>
                {distributorLabel && (
                  <p className="text-[11px] text-sky-700">Phạm vi NPP: {distributorLabel}</p>
                )}
              </div>

              <div>
                <label className="text-[10px] font-semibold text-slate-600 block mb-1">
                  Chọn mẫu Hóa đơn điện tử <span className="text-red-600">*</span>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {providers.map((p) => (
                    <button
                      key={p.code}
                      type="button"
                      onClick={() => setProvider(p.code)}
                      className={`text-left rounded border px-2.5 py-2 text-xs transition-colors ${
                        provider === p.code
                          ? "border-sky-600 bg-sky-50 font-bold text-sky-900 ring-1 ring-sky-500"
                          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span>{p.code}</span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-600">
                          .{p.ext}
                        </span>
                      </div>
                      <p className="text-[10px] font-normal text-slate-500 mt-0.5">{p.name}</p>
                    </button>
                  ))}
                </div>
              </div>

              {selectedCompaniesCount > 1 && (
                <label className="flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={splitByCompany}
                    onChange={(e) => setSplitByCompany(e.target.checked)}
                  />
                  <span>
                    Tự động tách mỗi <strong>Công ty quản lý</strong> thành 1 file riêng và nén thành{" "}
                    <strong>.ZIP</strong> (khuyến nghị khi nạp lên từng tài khoản HĐĐT)
                  </span>
                </label>
              )}

              <div>
                <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                  Ghi chú bổ sung trên hóa đơn (tùy chọn)
                </label>
                <input
                  placeholder="VD: Xuất hóa đơn bán hàng theo bảng kê ngày..."
                  value={customNote}
                  onChange={(e) => setCustomNote(e.target.value)}
                  className={inputCls}
                />
              </div>

              {exportError && (
                <div className="rounded border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
                  {exportError}
                </div>
              )}
            </div>

            <div className="border-t border-slate-300 bg-slate-100 px-3 py-2 flex items-center justify-between gap-3">
              <span className="text-[10px] text-slate-500">
                Chỉ các nhóm đã đủ thông tin KH, Công ty QL & SKU CQT mới được xuất file.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setExportModalOpen(false)}
                  className="rounded bg-red-700 hover:bg-red-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
                >
                  Đóng
                </button>
                <button
                  type="button"
                  disabled={exporting || selectedGroups.length === 0}
                  onClick={() => void handleExportFile()}
                  className="inline-flex items-center gap-1.5 rounded bg-sky-600 hover:bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                  {exporting ? "Đang tạo file..." : `Tải file mẫu ${provider}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

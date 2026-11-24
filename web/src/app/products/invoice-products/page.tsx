"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FileSpreadsheet,
  Search,
  X,
  Loader2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Upload,
  Download,
  Plus,
  Receipt,
  Link2,
  Building2,
} from "lucide-react";
import * as XLSX from "xlsx";
import { API_URL, apiFetch } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { downloadExcel } from "@/lib/excel";
import { useDistributorContext } from "@/lib/distributor-context";

const inputCls =
  "w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-100";

type InvoiceProductRow = {
  id: number;
  distributor_id: number | null;
  code: string;
  name: string;
  unit_name: string;
  vat_rate: number | null;
  supplier: string;
  default_company_id: number | null;
  default_company_code: string | null;
  default_company_name: string | null;
  note: string | null;
  status: string;
  cqt_sku_count: number;
  dms_product_count: number;
};

type CompanyOption = {
  id: number;
  code: string;
  name: string;
  short_name?: string | null;
};

type ExcelPreviewRow = {
  stt: number;
  code: string;
  name: string;
  unit_name: string;
  vat_rate: string;
  supplier: string;
  note: string;
  action_type: "Thêm mới" | "Cập nhật";
};

function formatVatLabel(vat: number | null): string {
  if (vat === null || vat === undefined) return "Mặc định";
  if (vat < 0) return "KCT";
  return `${vat}%`;
}

export default function InvoiceProductsPage() {
  const { effectiveDistributorId: activeDistributorId } = useDistributorContext();
  const [rows, setRows] = useState<InvoiceProductRow[]>([]);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [toastMessage, setToastMessage] = useState<string>("");

  const [searchQuery, setSearchQuery] = useState<string>("");
  const [supplierFilter, setSupplierFilter] = useState<string>("ALL");
  const [companyFilter, setCompanyFilter] = useState<string>("ALL");
  const [mappingFilter, setMappingFilter] = useState<"ALL" | "MAPPED_BOTH" | "UNMAPPED_CQT" | "UNMAPPED_DMS">("ALL");
  const [pageSize, setPageSize] = useState<number>(25);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkCompanyId, setBulkCompanyId] = useState<string>("");
  const [bulkAssigning, setBulkAssigning] = useState<boolean>(false);

  // Modal Thêm / Sửa
  const [formModalOpen, setFormModalOpen] = useState<boolean>(false);
  const [editingRow, setEditingRow] = useState<InvoiceProductRow | null>(null);
  const [formCode, setFormCode] = useState<string>("");
  const [formName, setFormName] = useState<string>("");
  const [formUnit, setFormUnit] = useState<string>("Hộp");
  const [formVat, setFormVat] = useState<string>("");
  const [formSupplier, setFormSupplier] = useState<string>("");
  const [formCompanyId, setFormCompanyId] = useState<string>("");
  const [formNote, setFormNote] = useState<string>("");
  const [savingForm, setSavingForm] = useState<boolean>(false);
  const [formError, setFormError] = useState<string>("");

  // Modal Xóa
  const [deletingRow, setDeletingRow] = useState<InvoiceProductRow | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [bulkDeleting, setBulkDeleting] = useState<boolean>(false);

  // Modal Upload Excel
  const [showUploadModal, setShowUploadModal] = useState<boolean>(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewRows, setPreviewRows] = useState<ExcelPreviewRow[]>([]);
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(""), 4000);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams();
      if (activeDistributorId !== null) {
        qs.set("distributor_id", String(activeDistributorId));
      }
      const compQs = activeDistributorId !== null ? `?limit=5000&distributor_id=${activeDistributorId}` : "?limit=5000";
      const [res, resComp] = await Promise.all([
        apiFetch(`${API_URL}/invoice-products?${qs.toString()}`),
        apiFetch(`${API_URL}/companies/${compQs}`).catch(() => null),
      ]);
      if (!res.ok) throw new Error("Không thể tải danh sách sản phẩm xuất hóa đơn.");
      const data = (await res.json()) as InvoiceProductRow[];
      setRows(data);
      setSelectedIds([]);
      if (resComp && resComp.ok) {
        const compList = (await resComp.json().catch(() => [])) as Array<Record<string, unknown>>;
        setCompanies(
          compList.map((c) => ({
            id: Number(c.id),
            code: String(c.code ?? ""),
            name: String(c.name ?? ""),
            short_name: c.short_name ? String(c.short_name) : null,
          }))
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi khi tải dữ liệu.");
    } finally {
      setLoading(false);
    }
  }, [activeDistributorId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const supplierOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      if (r.supplier) s.add(r.supplier);
    }
    return Array.from(s).sort();
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((r) => {
      if (supplierFilter !== "ALL" && r.supplier !== supplierFilter) return false;
      if (companyFilter === "ASSIGNED" && !r.default_company_id) return false;
      if (companyFilter === "UNASSIGNED" && r.default_company_id) return false;
      if (companyFilter !== "ALL" && companyFilter !== "ASSIGNED" && companyFilter !== "UNASSIGNED") {
        if (String(r.default_company_id) !== companyFilter) return false;
      }
      if (mappingFilter === "MAPPED_BOTH" && (r.cqt_sku_count === 0 || r.dms_product_count === 0)) return false;
      if (mappingFilter === "UNMAPPED_CQT" && r.cqt_sku_count > 0) return false;
      if (mappingFilter === "UNMAPPED_DMS" && r.dms_product_count > 0) return false;
      if (q) {
        const hit =
          r.code.toLowerCase().includes(q) ||
          r.name.toLowerCase().includes(q) ||
          (r.unit_name || "").toLowerCase().includes(q) ||
          (r.supplier || "").toLowerCase().includes(q) ||
          (r.default_company_code || "").toLowerCase().includes(q) ||
          (r.default_company_name || "").toLowerCase().includes(q) ||
          (r.note || "").toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [rows, searchQuery, supplierFilter, companyFilter, mappingFilter]);

  const stats = useMemo(() => {
    let mappedCqt = 0;
    let mappedDms = 0;
    for (const r of rows) {
      if (r.cqt_sku_count > 0) mappedCqt++;
      if (r.dms_product_count > 0) mappedDms++;
    }
    return {
      total: rows.length,
      mappedCqt,
      mappedDms,
      suppliers: supplierOptions.length,
    };
  }, [rows, supplierOptions]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pagedRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, safePage, pageSize]);

  const openCreateModal = () => {
    setEditingRow(null);
    setFormCode("");
    setFormName("");
    setFormUnit("Hộp");
    setFormVat("");
    setFormSupplier("");
    setFormCompanyId("");
    setFormNote("");
    setFormError("");
    setFormModalOpen(true);
  };

  const openEditModal = (row: InvoiceProductRow) => {
    setEditingRow(row);
    setFormCode(row.code);
    setFormName(row.name);
    setFormUnit(row.unit_name || "Hộp");
    setFormVat(row.vat_rate === null || row.vat_rate === undefined ? "" : String(row.vat_rate));
    setFormSupplier(row.supplier || "");
    setFormCompanyId(row.default_company_id ? String(row.default_company_id) : "");
    setFormNote(row.note || "");
    setFormError("");
    setFormModalOpen(true);
  };

  const handleBulkAssignCompany = async () => {
    if (selectedIds.length === 0) return;
    setBulkAssigning(true);
    setError("");
    try {
      const targetCompId = bulkCompanyId === "__CLEAR__" ? null : (bulkCompanyId ? Number(bulkCompanyId) : null);
      if (bulkCompanyId === "") {
        setError("Vui lòng chọn Công ty quản lý trước khi bấm gán hàng loạt.");
        setBulkAssigning(false);
        return;
      }
      const res = await apiFetch(`${API_URL}/invoice-products/bulk-assign-company`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds, company_id: targetCompId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Không thể gán Công ty QL hàng loạt.");
      showToast(data.message || "Đã gán Công ty QL thành công.");
      setBulkCompanyId("");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi khi gán Công ty QL hàng loạt.");
    } finally {
      setBulkAssigning(false);
    }
  };

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formCode.trim() || !formName.trim()) {
      setFormError("Mã SP xuất hóa đơn và Tên SP xuất hóa đơn không được để trống.");
      return;
    }
    setSavingForm(true);
    setFormError("");
    try {
      const parsedVat = formVat === "" ? null : Number(formVat);
      const body: Record<string, unknown> = {
        code: formCode.trim().toUpperCase(),
        name: formName.trim(),
        unit_name: formUnit.trim() || "Hộp",
        vat_rate: Number.isNaN(parsedVat) ? null : parsedVat,
        supplier: formSupplier.trim(),
        default_company_id: formCompanyId ? Number(formCompanyId) : null,
        note: formNote.trim() || null,
      };
      if (!editingRow && activeDistributorId !== null) {
        body.distributor_id = activeDistributorId;
      }

      const url = editingRow
        ? `${API_URL}/invoice-products/${editingRow.id}`
        : `${API_URL}/invoice-products`;
      const res = await apiFetch(url, {
        method: editingRow ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "Không thể lưu sản phẩm xuất hóa đơn.");
      }
      setFormModalOpen(false);
      showToast(editingRow ? "Đã cập nhật sản phẩm xuất hóa đơn." : "Đã thêm mới sản phẩm xuất hóa đơn.");
      await loadData();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Lỗi khi lưu dữ liệu.");
    } finally {
      setSavingForm(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingRow) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`${API_URL}/invoice-products/${deletingRow.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "Không thể xóa sản phẩm xuất hóa đơn.");
      }
      setDeletingRow(null);
      showToast(`Đã xóa mã SP xuất hóa đơn ${deletingRow.code}.`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi khi xóa.");
    } finally {
      setDeleting(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Xác nhận xóa ${selectedIds.length} sản phẩm xuất hóa đơn đã chọn?`)) return;
    setBulkDeleting(true);
    try {
      const res = await apiFetch(`${API_URL}/invoice-products/bulk-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds }),
      });
      if (!res.ok) throw new Error("Không thể xóa hàng loạt.");
      showToast(`Đã xóa ${selectedIds.length} sản phẩm xuất hóa đơn.`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi khi xóa hàng loạt.");
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const res = await apiFetch(`${API_URL}/invoice-products/template`);
      if (!res.ok) throw new Error("Không thể tải file mẫu.");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "mau-danh-sach-sp-xuat-hoa-don.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi tải file mẫu.");
    }
  };

  const handleExportExcel = () => {
    const exportData = filteredRows.map((r, i) => ({
      STT: i + 1,
      "Mã SP Xuất Hóa Đơn": r.code,
      "Tên SP Xuất Hóa Đơn": r.name,
      "ĐVT Xuất HĐ": r.unit_name,
      "Thuế suất VAT (%)": formatVatLabel(r.vat_rate),
      "Nhà cung cấp": r.supplier,
      "Mã Công ty QL": r.default_company_code || "",
      "Công ty QL mặc định": r.default_company_name || "",
      "Số SKU CQT đã gán": r.cqt_sku_count,
      "Số Mã DMS đã gán": r.dms_product_count,
      "Ghi chú": r.note || "",
    }));
    downloadExcel(exportData, "danh-sach-sp-xuat-hoa-don.xlsx", "SP_Xuat_Hoa_Don");
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setUploadError("");
    setPreviewRows([]);
    if (!file) {
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
      if (!rawRows || rawRows.length < 2) {
        setUploadError("File Excel không có dòng dữ liệu nào.");
        return;
      }
      const headers = (rawRows[0] as unknown[]).map((c) => String(c || "").trim().toLowerCase());
      const findIdx = (keys: string[], fallback: number) => {
        const idx = headers.findIndex((h) => keys.some((k) => h.includes(k)));
        return idx >= 0 ? idx : fallback;
      };
      const codeIdx = findIdx(["mã sp xuất hóa đơn", "mã sp xuất hđ", "mã sp", "code", "sku"], 1);
      const nameIdx = findIdx(["tên sp xuất hóa đơn", "tên sản phẩm", "tên sp", "name"], 2);
      const unitIdx = findIdx(["đvt", "đơn vị", "unit"], 3);
      const vatIdx = findIdx(["vat", "thuế"], 4);
      const suppIdx = findIdx(["nhà cung cấp", "ncc", "supplier"], 5);
      const noteIdx = findIdx(["ghi chú", "note"], 6);

      const existingSet = new Set(rows.map((r) => r.code.trim().toUpperCase()));
      const parsed: ExcelPreviewRow[] = [];
      let stt = 1;
      for (let i = 1; i < rawRows.length; i++) {
        const r = rawRows[i] as unknown[];
        if (!r || r.every((v) => v === undefined || v === null || String(v).trim() === "")) continue;
        const code = String(r[codeIdx] ?? "").trim().toUpperCase();
        if (!code || code.includes("MÃ SP")) continue;
        parsed.push({
          stt: stt++,
          code,
          name: String(r[nameIdx] ?? "").trim() || code,
          unit_name: String(r[unitIdx] ?? "").trim() || "Hộp",
          vat_rate: String(r[vatIdx] ?? "").trim(),
          supplier: String(r[suppIdx] ?? "").trim(),
          note: String(r[noteIdx] ?? "").trim(),
          action_type: existingSet.has(code) ? "Cập nhật" : "Thêm mới",
        });
      }
      setPreviewRows(parsed);
    } catch {
      setUploadError("Không thể đọc file Excel. Vui lòng kiểm tra đúng định dạng .xlsx.");
    }
  };

  const handleConfirmUpload = async () => {
    if (!selectedFile) return;
    setUploading(true);
    setUploadError("");
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      const qs = activeDistributorId !== null ? `?distributor_id=${activeDistributorId}` : "";
      const res = await apiFetch(`${API_URL}/invoice-products/upload${qs}`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "Upload thất bại.");
      }
      const data = await res.json();
      setShowUploadModal(false);
      setSelectedFile(null);
      setPreviewRows([]);
      showToast(data.message || "Tải lên thành công.");
      await loadData();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Lỗi khi tải lên.");
    } finally {
      setUploading(false);
    }
  };

  const toggleSelectAllPage = () => {
    const pageIds = pagedRows.map((r) => r.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !pageIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...pageIds])));
    }
  };

  const toggleSelectOne = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <div className="space-y-3 p-3">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-300 bg-[#14263d] px-3 py-2 text-white shadow-sm">
        <div className="flex items-center gap-2">
          <Receipt size={18} className="text-red-500" />
          <div>
            <h1 className="text-xs font-bold uppercase tracking-wide">
              Sản phẩm XHĐ (Chuẩn trung tâm)
            </h1>
            <p className="text-[10px] text-slate-300">
              Dùng chung cho toàn bộ Công ty quản lý thuộc NPP • Làm chuẩn ánh xạ từ SKU CQT đầu vào, Mã SP DMS đầu ra &amp; quản lý Tồn kho Thuế
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-1 rounded bg-sky-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-700"
          >
            <Plus size={13} /> Thêm mới
          </button>
          <button
            type="button"
            onClick={handleDownloadTemplate}
            className="inline-flex items-center gap-1 rounded border border-slate-500 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
          >
            <Download size={13} /> Tải file mẫu
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedFile(null);
              setPreviewRows([]);
              setUploadError("");
              setShowUploadModal(true);
            }}
            className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            <Upload size={13} /> Upload Excel
          </button>
          <button
            type="button"
            onClick={handleExportExcel}
            className="inline-flex items-center gap-1 rounded bg-amber-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
          >
            <FileSpreadsheet size={13} /> Xuất Excel
          </button>
          <button
            type="button"
            onClick={() => void loadData()}
            className="inline-flex items-center gap-1 rounded border border-slate-500 bg-slate-800 px-2 py-1.5 text-xs text-white hover:bg-slate-700"
            title="Làm mới"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {toastMessage && (
        <div className="flex items-center gap-2 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
          <CheckCircle2 size={14} /> {toastMessage}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded border border-slate-300 bg-white px-3 py-2 shadow-sm">
          <div className="text-[10px] font-semibold uppercase text-slate-500">Tổng SP xuất hóa đơn</div>
          <div className="mt-0.5 text-base font-bold text-slate-800">{formatNumber(stats.total)}</div>
        </div>
        <div className="rounded border border-slate-300 bg-white px-3 py-2 shadow-sm">
          <div className="text-[10px] font-semibold uppercase text-slate-500">Đã gán SKU CQT (đầu vào)</div>
          <div className="mt-0.5 text-base font-bold text-sky-700">{formatNumber(stats.mappedCqt)}</div>
        </div>
        <div className="rounded border border-slate-300 bg-white px-3 py-2 shadow-sm">
          <div className="text-[10px] font-semibold uppercase text-slate-500">Đã gán Mã SP DMS (đầu ra)</div>
          <div className="mt-0.5 text-base font-bold text-emerald-700">{formatNumber(stats.mappedDms)}</div>
        </div>
        <div className="rounded border border-slate-300 bg-white px-3 py-2 shadow-sm">
          <div className="text-[10px] font-semibold uppercase text-slate-500">Nhà cung cấp</div>
          <div className="mt-0.5 text-base font-bold text-amber-700">{formatNumber(stats.suppliers)}</div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-2 rounded border border-slate-300 bg-white p-2.5 shadow-sm">
        <div className="relative min-w-[240px] flex-1">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            placeholder="Tìm theo Mã SP xuất HĐ, Tên sản phẩm, ĐVT, NCC..."
            className={`${inputCls} pl-7`}
          />
        </div>
        <select
          value={supplierFilter}
          onChange={(e) => {
            setSupplierFilter(e.target.value);
            setCurrentPage(1);
          }}
          className={`${inputCls} w-auto min-w-[140px]`}
        >
          <option value="ALL">Tất cả NCC</option>
          {supplierOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={companyFilter}
          onChange={(e) => {
            setCompanyFilter(e.target.value);
            setCurrentPage(1);
          }}
          className={`${inputCls} w-auto min-w-[170px]`}
        >
          <option value="ALL">Tất cả Công ty QL</option>
          <option value="ASSIGNED">Đã gán Công ty QL</option>
          <option value="UNASSIGNED">Chưa gán Công ty QL</option>
          {companies.map((c) => (
            <option key={c.id} value={String(c.id)}>
              [{c.code}] {c.short_name || c.name}
            </option>
          ))}
        </select>
        <select
          value={mappingFilter}
          onChange={(e) => {
            setMappingFilter(e.target.value as typeof mappingFilter);
            setCurrentPage(1);
          }}
          className={`${inputCls} w-auto min-w-[170px]`}
        >
          <option value="ALL">Tất cả trạng thái gán</option>
          <option value="MAPPED_BOTH">Đã gán đủ CQT &amp; DMS</option>
          <option value="UNMAPPED_CQT">Chưa có SKU CQT gán vào</option>
          <option value="UNMAPPED_DMS">Chưa có Mã DMS gán vào</option>
        </select>
        {selectedIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 rounded border border-sky-300 bg-sky-50 px-2 py-1">
            <select
              value={bulkCompanyId}
              onChange={(e) => setBulkCompanyId(e.target.value)}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800"
            >
              <option value="">-- Chọn Công ty QL gán nhanh --</option>
              {companies.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  [{c.code}] {c.short_name || c.name}
                </option>
              ))}
              <option value="__CLEAR__">Gỡ Công ty QL mặc định</option>
            </select>
            <button
              type="button"
              disabled={bulkAssigning || !bulkCompanyId}
              onClick={() => void handleBulkAssignCompany()}
              className="inline-flex items-center gap-1 rounded bg-sky-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-sky-700 disabled:bg-slate-300"
            >
              {bulkAssigning ? <Loader2 size={12} className="animate-spin" /> : <Building2 size={12} />}
              Gán Công ty ({selectedIds.length})
            </button>
            <button
              type="button"
              disabled={bulkDeleting}
              onClick={() => void handleBulkDelete()}
              className="inline-flex items-center gap-1 rounded bg-red-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-800 disabled:bg-slate-300"
            >
              <Trash2 size={12} /> Xóa ({selectedIds.length})
            </button>
          </div>
        )}
      </div>

      {/* Data Table */}
      <div className="overflow-hidden rounded border border-slate-300 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-100 text-[10px] font-semibold uppercase text-slate-600">
                <th className="w-8 px-2 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={pagedRows.length > 0 && pagedRows.every((r) => selectedIds.includes(r.id))}
                    onChange={toggleSelectAllPage}
                  />
                </th>
                <th className="w-10 px-2 py-2 text-center">STT</th>
                <th className="px-2 py-2">Mã SP Xuất HĐ</th>
                <th className="px-2 py-2">Tên SP Xuất Hóa Đơn</th>
                <th className="px-2 py-2 text-center">ĐVT chuẩn</th>
                <th className="px-2 py-2 text-center">VAT</th>
                <th className="px-2 py-2">Nhà cung cấp</th>
                <th className="px-2 py-2">Công ty QL mặc định</th>
                <th className="px-2 py-2 text-center">SKU CQT gán</th>
                <th className="px-2 py-2 text-center">Mã DMS gán</th>
                <th className="px-2 py-2">Ghi chú</th>
                <th className="w-20 px-2 py-2 text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-xs text-slate-500">
                    <Loader2 size={16} className="mr-1.5 inline animate-spin" /> Đang tải dữ liệu...
                  </td>
                </tr>
              ) : pagedRows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-xs text-slate-500">
                    Chưa có sản phẩm xuất hóa đơn nào. Nhấn <strong>Thêm mới</strong> hoặc <strong>Upload Excel</strong> để khởi tạo.
                  </td>
                </tr>
              ) : (
                pagedRows.map((row, idx) => (
                  <tr
                    key={row.id}
                    className="border-b border-slate-100 text-[11px] even:bg-amber-50/40 hover:bg-sky-50/50"
                  >
                    <td className="px-2 py-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(row.id)}
                        onChange={() => toggleSelectOne(row.id)}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-center text-slate-500">
                      {(safePage - 1) * pageSize + idx + 1}
                    </td>
                    <td className="px-2 py-1.5 font-mono font-bold text-sky-800">{row.code}</td>
                    <td className="px-2 py-1.5 font-medium text-slate-800">{row.name}</td>
                    <td className="px-2 py-1.5 text-center font-semibold text-slate-700">{row.unit_name}</td>
                    <td className="px-2 py-1.5 text-center">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                        {formatVatLabel(row.vat_rate)}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-slate-600">{row.supplier || "—"}</td>
                    <td className="px-2 py-1.5">
                      {row.default_company_code ? (
                        <span className="inline-flex items-center gap-1 rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800">
                          <span className="font-mono font-bold">{row.default_company_code}</span>
                          <span className="max-w-[140px] truncate">{row.default_company_name}</span>
                        </span>
                      ) : (
                        <span className="text-[10px] italic text-slate-400">Chưa gán</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <span
                        className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          row.cqt_sku_count > 0
                            ? "bg-sky-100 text-sky-800"
                            : "bg-slate-100 text-slate-400"
                        }`}
                      >
                        <Link2 size={10} /> {row.cqt_sku_count}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <span
                        className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          row.dms_product_count > 0
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-slate-100 text-slate-400"
                        }`}
                      >
                        <Link2 size={10} /> {row.dms_product_count}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-slate-500">{row.note || "—"}</td>
                    <td className="px-2 py-1.5 text-center">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEditModal(row)}
                          className="rounded p-1 text-sky-700 hover:bg-sky-100"
                          title="Chỉnh sửa"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingRow(row)}
                          className="rounded p-1 text-red-600 hover:bg-red-100"
                          title="Xóa"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
          <div>
            Hiển thị <strong>{pagedRows.length}</strong> / <strong>{filteredRows.length}</strong> sản phẩm xuất hóa đơn
          </div>
          <div className="flex items-center gap-2">
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px]"
            >
              {[25, 50, 100, 200].map((n) => (
                <option key={n} value={n}>
                  {n} / trang
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="rounded border border-slate-300 bg-white p-1 hover:bg-slate-100 disabled:opacity-40"
            >
              <ChevronLeft size={13} />
            </button>
            <span>
              Trang <strong>{safePage}</strong> / {totalPages}
            </span>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="rounded border border-slate-300 bg-white p-1 hover:bg-slate-100 disabled:opacity-40"
            >
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* Modal Thêm mới / Sửa chuẩn CreateOrderForm */}
      {formModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3">
          <form
            onSubmit={handleSaveForm}
            className="w-full max-w-2xl overflow-hidden border border-slate-400 bg-white shadow-lg"
          >
            <div className="flex items-center justify-between bg-[#14263d] px-3 py-2 text-white">
              <div className="flex items-center gap-2">
                <Receipt size={17} className="text-red-500" />
                <span className="text-xs font-bold uppercase tracking-wide text-white">
                  {editingRow ? "Chỉnh sửa sản phẩm xuất hóa đơn" : "Thêm mới sản phẩm xuất hóa đơn"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setFormModalOpen(false)}
                className="rounded p-1 text-white hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </div>

            <div className="border-b border-slate-200 px-3 py-2.5">
              {formError && (
                <div className="mb-2 rounded border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
                  {formError}
                </div>
              )}
              <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2">
                <div>
                  <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                    Mã SP Xuất Hóa Đơn (*)
                  </label>
                  <input
                    type="text"
                    required
                    value={formCode}
                    onChange={(e) => setFormCode(e.target.value)}
                    placeholder="VD: 01TD03"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                    ĐVT Xuất HĐ (Đơn vị nhỏ nhất) (*)
                  </label>
                  <input
                    type="text"
                    required
                    value={formUnit}
                    onChange={(e) => setFormUnit(e.target.value)}
                    placeholder="VD: Hộp, Lon, Chai, Gói..."
                    className={inputCls}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                    Tên SP Xuất Hóa Đơn (*)
                  </label>
                  <input
                    type="text"
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="VD: Sữa tươi tiệt trùng có đường Vinamilk 180ml"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                    Thuế suất VAT (%)
                  </label>
                  <select
                    value={formVat}
                    onChange={(e) => setFormVat(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">Mặc định theo hóa đơn</option>
                    <option value="0">0%</option>
                    <option value="5">5%</option>
                    <option value="8">8%</option>
                    <option value="10">10%</option>
                    <option value="-1">KCT (Không chịu thuế)</option>
                  </select>
                </div>
                <div>
                  <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                    Nhà cung cấp / Nhãn hàng
                  </label>
                  <input
                    type="text"
                    value={formSupplier}
                    onChange={(e) => setFormSupplier(e.target.value)}
                    placeholder="VD: Vinamilk, Nazzy..."
                    className={inputCls}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                    Công ty quản lý xuất HĐ mặc định (dùng khi NPP phân bổ theo Sản phẩm)
                  </label>
                  <select
                    value={formCompanyId}
                    onChange={(e) => setFormCompanyId(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">[-- Chưa gán (lấy theo Khách hàng hoặc gán sau) --]</option>
                    {companies.map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        [{c.code}] {c.short_name || c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                    Ghi chú
                  </label>
                  <input
                    type="text"
                    value={formNote}
                    onChange={(e) => setFormNote(e.target.value)}
                    placeholder="Ghi chú nội bộ (nếu có)"
                    className={inputCls}
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-slate-300 bg-slate-100 px-3 py-2">
              <span className="text-[10px] text-slate-500">
                Mã SP xuất hóa đơn dùng chung cho tất cả Công ty QL thuộc NPP.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFormModalOpen(false)}
                  className="rounded bg-red-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-800"
                >
                  Đóng
                </button>
                <button
                  type="submit"
                  disabled={savingForm}
                  className="inline-flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {savingForm ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                  {editingRow ? "Lưu thay đổi" : "Thêm mới"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Modal Xác nhận Xóa */}
      {deletingRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3">
          <div className="w-full max-w-md overflow-hidden border border-slate-400 bg-white shadow-lg">
            <div className="flex items-center justify-between bg-[#14263d] px-3 py-2 text-white">
              <div className="flex items-center gap-2">
                <AlertTriangle size={17} className="text-red-500" />
                <span className="text-xs font-bold uppercase tracking-wide text-white">
                  Xác nhận xóa SP xuất hóa đơn
                </span>
              </div>
              <button
                type="button"
                onClick={() => setDeletingRow(null)}
                className="rounded p-1 text-white hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </div>
            <div className="px-3 py-3 text-xs text-slate-700">
              Bạn có chắc chắn muốn xóa mã SP xuất hóa đơn{" "}
              <strong className="text-red-700">{deletingRow.code}</strong> ({deletingRow.name})?
              {(deletingRow.cqt_sku_count > 0 || deletingRow.dms_product_count > 0) && (
                <p className="mt-1.5 rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-800">
                  Lưu ý: Đang có {deletingRow.cqt_sku_count} SKU CQT và {deletingRow.dms_product_count} Mã SP DMS gán vào mã này. Khi xóa, các liên kết đó sẽ được gỡ tự động.
                </p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-300 bg-slate-100 px-3 py-2">
              <button
                type="button"
                onClick={() => setDeletingRow(null)}
                className="rounded bg-slate-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void handleDelete()}
                className="inline-flex items-center gap-1.5 rounded bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800 disabled:bg-slate-300"
              >
                {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Xóa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Upload Excel chuẩn CreateOrderForm */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3">
          <div className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden border border-slate-400 bg-white shadow-lg">
            <div className="flex items-center justify-between bg-[#14263d] px-3 py-2 text-white">
              <div className="flex items-center gap-2">
                <Upload size={17} className="text-red-500" />
                <span className="text-xs font-bold uppercase tracking-wide text-white">
                  Upload Excel Danh sách SP xuất hóa đơn
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowUploadModal(false)}
                className="rounded p-1 text-white hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 space-y-2.5 overflow-y-auto px-3 py-2.5">
              {uploadError && (
                <div className="rounded border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
                  {uploadError}
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-dashed border-slate-300 bg-slate-50 p-3">
                <div>
                  <div className="text-xs font-semibold text-slate-700">Chọn file Excel (.xlsx)</div>
                  <div className="text-[10px] text-slate-500">
                    Hệ thống tự động Thêm mới nếu chưa có mã, hoặc Cập nhật nếu Mã SP xuất hóa đơn đã tồn tại.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadTemplate}
                    className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    <Download size={12} /> Tải file mẫu
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xlsm,.xls"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1 rounded bg-sky-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-sky-700"
                  >
                    <Upload size={12} /> Chọn file
                  </button>
                </div>
              </div>

              {previewRows.length > 0 && (
                <div className="overflow-x-auto rounded border border-slate-200">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="bg-slate-100 text-[10px] font-semibold text-slate-600">
                        <th className="px-2 py-1.5">STT</th>
                        <th className="px-2 py-1.5">Mã SP Xuất HĐ</th>
                        <th className="px-2 py-1.5">Tên SP Xuất HĐ</th>
                        <th className="px-2 py-1.5">ĐVT</th>
                        <th className="px-2 py-1.5">VAT</th>
                        <th className="px-2 py-1.5">NCC</th>
                        <th className="px-2 py-1.5">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.slice(0, 100).map((r) => (
                        <tr
                          key={r.stt}
                          className="border-b border-slate-100 text-[11px] even:bg-amber-50/40"
                        >
                          <td className="px-2 py-1">{r.stt}</td>
                          <td className="px-2 py-1 font-mono font-bold text-sky-800">{r.code}</td>
                          <td className="px-2 py-1">{r.name}</td>
                          <td className="px-2 py-1">{r.unit_name}</td>
                          <td className="px-2 py-1">{r.vat_rate || "—"}</td>
                          <td className="px-2 py-1">{r.supplier || "—"}</td>
                          <td className="px-2 py-1">
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                r.action_type === "Thêm mới"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-amber-100 text-amber-800"
                              }`}
                            >
                              {r.action_type}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {previewRows.length > 100 && (
                    <div className="bg-slate-50 px-2 py-1 text-[10px] text-slate-500">
                      Hiển thị 100/{previewRows.length} dòng đầu tiên...
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-slate-300 bg-slate-100 px-3 py-2">
              <span className="text-[10px] text-slate-500">
                {selectedFile ? `File: ${selectedFile.name} (${previewRows.length} dòng)` : "Chưa chọn file"}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="rounded bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800"
                >
                  Đóng
                </button>
                <button
                  type="button"
                  disabled={!selectedFile || previewRows.length === 0 || uploading}
                  onClick={() => void handleConfirmUpload()}
                  className="inline-flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {uploading ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                  Xác nhận tải lên
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

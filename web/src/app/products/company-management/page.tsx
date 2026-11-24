"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  Search,
  X,
  Loader2,
  FileSpreadsheet,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Upload,
  Download,
  Info,
  Check,
  Plus,
  Link2,
} from "lucide-react";
import * as XLSX from "xlsx";
import { API_URL, apiFetch } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { downloadExcel } from "@/lib/excel";
import { useDistributorContext } from "@/lib/distributor-context";

const inputCls =
  "w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-100";

type DistributorProductRow = {
  id: number;
  distributor_id: number | null;
  distributor_name: string;
  distributor_sku: string;
  distributor_product_name: string;
  invoice_product_id: number | null;
  invoice_product_code: string | null;
  invoice_product_name: string | null;
  invoice_product_unit: string | null;
  invoice_product_vat_rate: number | null;
  conversion_num: number;
  conversion_den: number;
  supplier: string;
  unit: string;
  company_id: number | null;
  company_code: string | null;
  company_name: string | null;
  status: string;
};

type InvoiceProductOption = {
  id: number;
  code: string;
  name: string;
  unit_name: string;
  vat_rate: number | null;
  supplier: string;
};

type CompanyOption = {
  id: number;
  code: string;
  name: string;
};

type ExcelPreviewRow = {
  stt: number;
  distributor_name: string;
  distributor_sku: string;
  distributor_product_name: string;
  invoice_product_code: string;
  invoice_product_name: string;
  conversion_ratio: string;
  supplier: string;
  company_code: string;
  company_name: string;
  action_type: "Thêm mới" | "Cập nhật";
};

export default function DmsProductCatalogPage() {
  const { effectiveDistributorId: activeDistributorId } = useDistributorContext();
  const [rows, setRows] = useState<DistributorProductRow[]>([]);
  const [invoiceProducts, setInvoiceProducts] = useState<InvoiceProductOption[]>([]);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [supplierFilter, setSupplierFilter] = useState<string>("ALL");
  const [mappingFilter, setMappingFilter] = useState<"ALL" | "MAPPED" | "UNMAPPED">("ALL");
  const [companyFilter, setCompanyFilter] = useState<string>("ALL");
  const [pageSize, setPageSize] = useState<number>(20);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [error, setError] = useState<string>("");
  const [toastMessage, setToastMessage] = useState<string>("");

  // Modal Gán nhanh SP xuất hóa đơn + Quy đổi ĐVT
  const [mappingRow, setMappingRow] = useState<DistributorProductRow | null>(null);
  const [mapSearch, setMapSearch] = useState<string>("");
  const [mapSelectedIpId, setMapSelectedIpId] = useState<number | null>(null);
  const [mapConvNum, setMapConvNum] = useState<number>(1);
  const [mapConvDen, setMapConvDen] = useState<number>(1);
  const [savingMap, setSavingMap] = useState<boolean>(false);

  // Modal Thêm mới / Chỉnh sửa
  const [isCreatingNew, setIsCreatingNew] = useState<boolean>(false);
  const [editingRow, setEditingRow] = useState<DistributorProductRow | null>(null);
  const [editSku, setEditSku] = useState<string>("");
  const [editName, setEditName] = useState<string>("");
  const [editUnit, setEditUnit] = useState<string>("THUNG");
  const [editInvoiceProductId, setEditInvoiceProductId] = useState<string>("");
  const [editConvNum, setEditConvNum] = useState<number>(1);
  const [editConvDen, setEditConvDen] = useState<number>(1);
  const [editDistributor, setEditDistributor] = useState<string>("");
  const [editSupplier, setEditSupplier] = useState<string>("");
  const [editCompanyId, setEditCompanyId] = useState<string>("");
  const [savingEdit, setSavingEdit] = useState<boolean>(false);
  const [editError, setEditError] = useState<string>("");

  // Modal Xóa
  const [deletingRow, setDeletingRow] = useState<DistributorProductRow | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string>("");

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
      const distQs = activeDistributorId !== null ? `?distributor_id=${activeDistributorId}` : "";
      const [resProducts, resInvoiceProducts, resCompanies] = await Promise.all([
        apiFetch(`${API_URL}/product-groups/distributor-products${distQs}`),
        apiFetch(`${API_URL}/invoice-products${distQs}`),
        apiFetch(`${API_URL}/companies/?limit=5000`),
      ]);

      if (!resProducts.ok) throw new Error("Không thể tải danh sách mã sản phẩm DMS.");
      const data = (await resProducts.json()) as DistributorProductRow[];
      setRows(data);

      if (resInvoiceProducts.ok) {
        const ips = (await resInvoiceProducts.json()) as InvoiceProductOption[];
        setInvoiceProducts(ips);
      }

      if (resCompanies.ok) {
        const compsData = (await resCompanies.json()) as Array<Record<string, unknown>>;
        setCompanies(
          compsData.map((c) => ({
            id: Number(c.id),
            code: String(c.code ?? ""),
            name: String(c.name ?? ""),
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

  const filterOptions = useMemo(() => {
    const supps = new Set<string>();
    for (const r of rows) {
      if (r.supplier) supps.add(r.supplier);
    }
    return { suppliers: Array.from(supps).sort() };
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((row) => {
      if (supplierFilter !== "ALL" && row.supplier !== supplierFilter) return false;
      if (mappingFilter === "MAPPED" && !row.invoice_product_id) return false;
      if (mappingFilter === "UNMAPPED" && row.invoice_product_id) return false;
      if (companyFilter === "ASSIGNED" && !row.company_id) return false;
      if (companyFilter === "UNASSIGNED" && row.company_id) return false;
      if (companyFilter !== "ALL" && companyFilter !== "ASSIGNED" && companyFilter !== "UNASSIGNED") {
        if (String(row.company_id) !== companyFilter) return false;
      }
      if (q) {
        const hit =
          row.distributor_sku.toLowerCase().includes(q) ||
          row.distributor_product_name.toLowerCase().includes(q) ||
          (row.invoice_product_code || "").toLowerCase().includes(q) ||
          (row.invoice_product_name || "").toLowerCase().includes(q) ||
          (row.supplier || "").toLowerCase().includes(q) ||
          (row.company_code || "").toLowerCase().includes(q) ||
          (row.company_name || "").toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [rows, searchQuery, supplierFilter, mappingFilter, companyFilter]);

  const stats = useMemo(() => {
    let mappedIp = 0;
    let unmappedIp = 0;
    let converted = 0;
    for (const r of rows) {
      if (r.invoice_product_id) mappedIp++;
      else unmappedIp++;
      if ((r.conversion_num || 1) !== (r.conversion_den || 1)) converted++;
    }
    return {
      total: rows.length,
      mappedIp,
      unmappedIp,
      converted,
      suppliersCount: filterOptions.suppliers.length,
    };
  }, [rows, filterOptions]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pagedRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, safePage, pageSize]);

  const filteredInvoiceProducts = useMemo(() => {
    const q = mapSearch.trim().toLowerCase();
    if (!q) return invoiceProducts.slice(0, 80);
    return invoiceProducts
      .filter(
        (ip) =>
          ip.code.toLowerCase().includes(q) ||
          ip.name.toLowerCase().includes(q) ||
          (ip.unit_name || "").toLowerCase().includes(q) ||
          (ip.supplier || "").toLowerCase().includes(q)
      )
      .slice(0, 80);
  }, [invoiceProducts, mapSearch]);

  function openQuickMapModal(row: DistributorProductRow) {
    setMappingRow(row);
    setMapSearch("");
    setMapSelectedIpId(row.invoice_product_id);
    setMapConvNum(Math.max(1, row.conversion_num || 1));
    setMapConvDen(Math.max(1, row.conversion_den || 1));
  }

  async function handleSaveQuickMap() {
    if (!mappingRow) return;
    setSavingMap(true);
    try {
      const res = await apiFetch(
        `${API_URL}/product-groups/distributor-products/${mappingRow.id}/invoice-product`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            invoice_product_id: mapSelectedIpId,
            conversion_num: Math.max(1, Number(mapConvNum) || 1),
            conversion_den: Math.max(1, Number(mapConvDen) || 1),
          }),
        }
      );
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "Không thể cập nhật gán SP xuất hóa đơn.");
      }
      const updated = (await res.json()) as DistributorProductRow;
      setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setMappingRow(null);
      showToast(
        updated.invoice_product_code
          ? `Đã gán mã DMS '${updated.distributor_sku}' → SP xuất HĐ '${updated.invoice_product_code}' (tỷ lệ ${updated.conversion_num}/${updated.conversion_den}).`
          : `Đã gỡ SP xuất hóa đơn khỏi mã DMS '${updated.distributor_sku}'.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi khi lưu ánh xạ.");
    } finally {
      setSavingMap(false);
    }
  }

  function openCreateModal() {
    setIsCreatingNew(true);
    setEditingRow(null);
    setEditSku("");
    setEditName("");
    setEditUnit("THUNG");
    setEditInvoiceProductId("");
    setEditConvNum(1);
    setEditConvDen(1);
    setEditDistributor("");
    setEditSupplier("Vinamilk");
    setEditCompanyId("");
    setEditError("");
  }

  function openEditModal(row: DistributorProductRow) {
    setIsCreatingNew(false);
    setEditingRow(row);
    setEditSku(row.distributor_sku);
    setEditName(row.distributor_product_name);
    setEditUnit(row.unit || "HOP");
    setEditInvoiceProductId(row.invoice_product_id ? String(row.invoice_product_id) : "");
    setEditConvNum(Math.max(1, row.conversion_num || 1));
    setEditConvDen(Math.max(1, row.conversion_den || 1));
    setEditDistributor(row.distributor_name);
    setEditSupplier(row.supplier);
    setEditCompanyId(row.company_id ? String(row.company_id) : "");
    setEditError("");
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!isCreatingNew && !editingRow) return;
    if (!editSku.trim() || !editName.trim()) {
      setEditError("Mã SP DMS và Tên sản phẩm DMS không được để trống.");
      return;
    }

    setSavingEdit(true);
    setEditError("");
    try {
      const cleanSku = editSku.trim().toUpperCase();
      const selectedIpId = editInvoiceProductId ? Number(editInvoiceProductId) : null;
      const selectedIp = selectedIpId ? invoiceProducts.find((ip) => ip.id === selectedIpId) : null;

      if (isCreatingNew) {
        const res = await apiFetch(`${API_URL}/product-groups/distributor-products`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            distributor_id: activeDistributorId,
            distributor_sku: cleanSku,
            distributor_product_name: editName.trim(),
            unit: editUnit.trim().toUpperCase() || "HOP",
            invoice_product_id: selectedIpId,
            invoice_product_code: selectedIp ? selectedIp.code : null,
            invoice_product_name: selectedIp ? selectedIp.name : null,
            conversion_num: Math.max(1, Number(editConvNum) || 1),
            conversion_den: Math.max(1, Number(editConvDen) || 1),
            distributor_name: editDistributor.trim(),
            supplier: editSupplier.trim() || "Vinamilk",
            company_id: editCompanyId ? Number(editCompanyId) : null,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Không thể thêm mới mã sản phẩm DMS.");
        setRows((prev) => [data as DistributorProductRow, ...prev]);
        showToast(`Đã thêm mới mã SP DMS '${cleanSku}'.`);
        setIsCreatingNew(false);
        return;
      }

      if (!editingRow) return;
      const res = await apiFetch(`${API_URL}/product-groups/distributor-products`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingRow.id,
          original_code: editingRow.distributor_sku,
          distributor_sku: cleanSku,
          distributor_product_name: editName.trim(),
          unit: editUnit.trim().toUpperCase() || "HOP",
          invoice_product_id: selectedIpId,
          invoice_product_code: selectedIp ? selectedIp.code : null,
          invoice_product_name: selectedIp ? selectedIp.name : null,
          conversion_num: Math.max(1, Number(editConvNum) || 1),
          conversion_den: Math.max(1, Number(editConvDen) || 1),
          distributor_name: editDistributor.trim(),
          supplier: editSupplier.trim() || "Vinamilk",
          company_id: editCompanyId ? Number(editCompanyId) : null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Không thể cập nhật mã sản phẩm DMS.");
      showToast(`Đã cập nhật mã SP DMS '${cleanSku}'.`);
      setEditingRow(null);
      await loadData();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Lỗi khi lưu dữ liệu.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleConfirmDelete() {
    if (!deletingRow) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const res = await apiFetch(
        `${API_URL}/product-groups/distributor-products/${deletingRow.id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Không thể xóa mã sản phẩm DMS.");
      }
      setRows((prev) => prev.filter((r) => r.id !== deletingRow.id));
      showToast(`Đã xóa mã SP DMS '${deletingRow.distributor_sku}'.`);
      setDeletingRow(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Lỗi khi xóa mã sản phẩm.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setUploadError("");
    setPreviewRows([]);

    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

      if (!rawData || rawData.length < 2) {
        setUploadError("File Excel không có dữ liệu hoặc thiếu dòng tiêu đề.");
        return;
      }

      const headers = (rawData[0] || []).map((c) => String(c || "").trim().toLowerCase());
      let skuIdx = -1;
      let nameIdx = -1;
      let invoiceCodeIdx = -1;
      let invoiceNameIdx = -1;
      let ratioIdx = -1;
      let distIdx = -1;
      let supplierIdx = -1;
      let compCodeIdx = -1;

      headers.forEach((h, idx) => {
        if (
          h.includes("mã sp xuất hóa đơn") ||
          h.includes("mã sản phẩm xuất hóa đơn") ||
          h.includes("mã xuất hóa đơn") ||
          h.includes("mã sp xuất hđ") ||
          h.includes("invoice_product_code")
        ) {
          invoiceCodeIdx = idx;
        } else if (
          h.includes("mã sp dms") ||
          h.includes("mã sp npp") ||
          h.includes("mã sp") ||
          h.includes("distributor_sku") ||
          h.includes("sku")
        ) {
          skuIdx = idx;
        } else if (
          h.includes("tên sản phẩm xuất hóa đơn") ||
          h.includes("tên sp xuất hóa đơn") ||
          h.includes("invoice_product_name")
        ) {
          invoiceNameIdx = idx;
        } else if (
          h.includes("tên sản phẩm") ||
          h.includes("tên sp") ||
          h.includes("distributor_product_name")
        ) {
          nameIdx = idx;
        } else if (h.includes("tỷ lệ") || h.includes("quy đổi") || h.includes("conversion")) {
          ratioIdx = idx;
        } else if (h.includes("nhà phân phối") || h.includes("distributor")) {
          distIdx = idx;
        } else if (h.includes("nhà cung cấp") || h.includes("supplier") || h.includes("ncc")) {
          supplierIdx = idx;
        } else if (h.includes("mã công ty") || h.includes("company_code") || h.includes("mã cty")) {
          compCodeIdx = idx;
        }
      });

      if (skuIdx === -1) skuIdx = 2 < headers.length ? 2 : 0;
      if (nameIdx === -1) nameIdx = 3 < headers.length ? 3 : 1;

      const companyMap = new Map(companies.map((c) => [c.code.toUpperCase(), c]));
      const existingKeySet = new Set(
        rows.map((r) => `${r.distributor_sku.toUpperCase()}::${r.company_id ?? "NONE"}`)
      );

      const previewList: ExcelPreviewRow[] = [];
      for (let i = 1; i < rawData.length; i++) {
        const row = rawData[i];
        if (!row || row.length === 0) continue;
        const sku = String(row[skuIdx] || "").trim().toUpperCase();
        if (!sku || sku.includes("BẮT BUỘC") || sku.includes("MÃ SP")) continue;

        const name = String(row[nameIdx] || "").trim() || `Sản phẩm ${sku}`;
        const invoiceCode =
          invoiceCodeIdx !== -1 && row[invoiceCodeIdx]
            ? String(row[invoiceCodeIdx]).trim().toUpperCase()
            : "";
        const invoiceName =
          invoiceNameIdx !== -1 && row[invoiceNameIdx] ? String(row[invoiceNameIdx]).trim() : "";
        const ratio = ratioIdx !== -1 && row[ratioIdx] ? String(row[ratioIdx]).trim() : "1/1";
        const dist = distIdx !== -1 && row[distIdx] ? String(row[distIdx]).trim() : "";
        const supplier =
          supplierIdx !== -1 && row[supplierIdx] ? String(row[supplierIdx]).trim() : "Vinamilk";
        const compCode =
          compCodeIdx !== -1 && row[compCodeIdx] ? String(row[compCodeIdx]).trim().toUpperCase() : "";
        const matchedComp = compCode ? companyMap.get(compCode) : null;
        const compName = matchedComp ? matchedComp.name : compCode ? "Mã chưa khớp công ty QL" : "";
        const upsertKey = `${sku}::${matchedComp ? matchedComp.id : "NONE"}`;

        previewList.push({
          stt: previewList.length + 1,
          distributor_name: dist,
          distributor_sku: sku,
          distributor_product_name: name,
          invoice_product_code: invoiceCode,
          invoice_product_name: invoiceName,
          conversion_ratio: ratio,
          supplier: supplier || "Vinamilk",
          company_code: compCode,
          company_name: compName,
          action_type: existingKeySet.has(upsertKey) ? "Cập nhật" : "Thêm mới",
        });
      }

      if (previewList.length === 0) {
        setUploadError("Không tìm thấy dòng dữ liệu sản phẩm hợp lệ trong file Excel.");
      } else {
        setPreviewRows(previewList);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Lỗi khi đọc file Excel.");
    }
  }

  async function handleExecuteUpload() {
    if (!selectedFile) return;
    setUploading(true);
    setUploadError("");
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      const qs = activeDistributorId !== null ? `?distributor_id=${activeDistributorId}` : "";
      const res = await apiFetch(`${API_URL}/product-groups/distributor-products/upload${qs}`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Tải lên file không thành công.");

      showToast(data.message || "Tải lên và cập nhật danh sách mã SP DMS thành công!");
      setShowUploadModal(false);
      setSelectedFile(null);
      setPreviewRows([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadData();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Lỗi khi tải file lên máy chủ.");
    } finally {
      setUploading(false);
    }
  }

  async function handleDownloadTemplate() {
    try {
      const res = await apiFetch(`${API_URL}/product-groups/distributor-products/template`);
      if (!res.ok) throw new Error("Không thể tải file mẫu.");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "mau-danh-sach-ma-sp-dms.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi khi tải file mẫu.");
    }
  }

  function handleExportExcel() {
    if (filteredRows.length === 0) return;
    const excelData = filteredRows.map((r, idx) => ({
      STT: idx + 1,
      "Nhà phân phối": r.distributor_name || "",
      "Mã SP DMS": r.distributor_sku,
      "Tên Sản Phẩm DMS": r.distributor_product_name,
      "ĐVT DMS": r.unit || "HOP",
      "Mã SP Xuất Hóa Đơn": r.invoice_product_code || "",
      "Tên Sản Phẩm Xuất Hóa Đơn": r.invoice_product_name || "",
      "ĐVT Xuất HĐ": r.invoice_product_unit || "",
      "Tỷ lệ quy đổi": `${r.conversion_num || 1}/${r.conversion_den || 1}`,
      "Nhà cung cấp": r.supplier || "",
      "Mã Công ty QL": r.company_code || "",
      "Tên Công ty QL": r.company_name || "",
    }));
    downloadExcel(
      excelData,
      `Danh_sach_ma_SP_DMS_${new Date().toISOString().slice(0, 10)}`,
      "DS Mã SP DMS"
    );
  }

  return (
    <div className="space-y-3">
      {toastMessage && (
        <div className="flex items-center justify-between rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 shadow-sm">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 size={15} className="text-emerald-600" />
            {toastMessage}
          </span>
          <button type="button" onClick={() => setToastMessage("")} className="text-emerald-600 hover:text-emerald-800">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="border border-slate-400 bg-white shadow-lg">
        {/* 1. HEADER */}
        <header className="flex flex-wrap items-center justify-between gap-2 bg-[#14263d] px-3 py-2 text-white">
          <div className="flex items-center gap-2">
            <Building2 size={17} className="text-red-500" />
            <div>
              <h1 className="text-xs font-bold uppercase tracking-wide text-white">
                Danh Sách Mã Sản Phẩm DMS (Vinamilk, Nazzy...)
              </h1>
              <p className="text-[10px] text-slate-300">
                Gán Mã SP DMS → Mã SP xuất hóa đơn chuẩn &amp; cấu hình tỷ lệ quy đổi về đơn vị nhỏ nhất
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center gap-1 rounded bg-sky-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-sky-700"
            >
              <Plus size={12} /> Thêm mới
            </button>
            <button
              type="button"
              onClick={() => void handleDownloadTemplate()}
              className="inline-flex items-center gap-1 rounded bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-white/20"
            >
              <Download size={12} /> Tải file mẫu
            </button>
            <button
              type="button"
              onClick={() => {
                setShowUploadModal(true);
                setSelectedFile(null);
                setPreviewRows([]);
                setUploadError("");
              }}
              className="inline-flex items-center gap-1 rounded bg-emerald-700 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-emerald-800"
            >
              <Upload size={12} /> Upload Excel
            </button>
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={filteredRows.length === 0}
              className="inline-flex items-center gap-1 rounded bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-white/20 disabled:opacity-50"
            >
              <FileSpreadsheet size={12} /> Xuất Excel ({filteredRows.length})
            </button>
            <button
              type="button"
              onClick={() => void loadData()}
              disabled={loading}
              className="rounded p-1 text-white transition-colors hover:bg-white/10"
              title="Làm mới"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </header>

        {/* 2. KPI STATS */}
        <section className="grid grid-cols-2 divide-x divide-slate-200 border-b border-slate-200 bg-slate-50/60 text-center text-xs sm:grid-cols-5">
          <div className="px-3 py-2">
            <span className="block text-[10px] font-semibold uppercase text-slate-500">Tổng Mã SP DMS</span>
            <span className="text-sm font-bold text-slate-800">{formatNumber(stats.total)}</span>
          </div>
          <div className="px-3 py-2">
            <span className="block text-[10px] font-semibold uppercase text-emerald-700">Đã gán SP xuất HĐ</span>
            <span className="text-sm font-bold text-emerald-700">{formatNumber(stats.mappedIp)}</span>
          </div>
          <div className="px-3 py-2">
            <span className="block text-[10px] font-semibold uppercase text-red-700">Chưa gán SP xuất HĐ</span>
            <span className="text-sm font-bold text-red-700">{formatNumber(stats.unmappedIp)}</span>
          </div>
          <div className="px-3 py-2">
            <span className="block text-[10px] font-semibold uppercase text-violet-700">Có tỷ lệ quy đổi</span>
            <span className="text-sm font-bold text-violet-700">{formatNumber(stats.converted)}</span>
          </div>
          <div className="px-3 py-2">
            <span className="block text-[10px] font-semibold uppercase text-slate-500">Nhà cung cấp</span>
            <span className="text-sm font-bold text-sky-700">{stats.suppliersCount}</span>
          </div>
        </section>

        {/* 3. BỘ LỌC */}
        <section className="border-b border-slate-200 bg-white px-3 py-2.5">
          <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                Tìm kiếm Mã SP DMS, Tên SP, Mã SP xuất HĐ
              </label>
              <div className="relative">
                <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                  placeholder="Nhập mã SP DMS, tên sản phẩm, mã xuất HĐ..."
                  className={`${inputCls} pl-7 pr-7`}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                Trạng thái gán SP xuất hóa đơn
              </label>
              <select
                value={mappingFilter}
                onChange={(e) => {
                  setMappingFilter(e.target.value as typeof mappingFilter);
                  setCurrentPage(1);
                }}
                className={inputCls}
              >
                <option value="ALL">Tất cả ({rows.length})</option>
                <option value="MAPPED">Đã gán SP xuất HĐ ({stats.mappedIp})</option>
                <option value="UNMAPPED">Chưa gán SP xuất HĐ ({stats.unmappedIp})</option>
              </select>
            </div>

            <div>
              <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">Nhà cung cấp (DMS)</label>
              <select
                value={supplierFilter}
                onChange={(e) => {
                  setSupplierFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className={inputCls}
              >
                <option value="ALL">Tất cả Nhà cung cấp</option>
                {filterOptions.suppliers.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">Công ty Quản lý</label>
              <select
                value={companyFilter}
                onChange={(e) => {
                  setCompanyFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className={inputCls}
              >
                <option value="ALL">Tất cả Công ty QL</option>
                <option value="ASSIGNED">Đã gán Công ty QL</option>
                <option value="UNASSIGNED">Dùng chung (Chưa gán riêng)</option>
                {companies.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.code} - {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* 4. BẢNG DỮ LIỆU */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead className="bg-slate-100 text-[10px] font-semibold uppercase text-slate-600">
              <tr className="border-b border-slate-300">
                <th className="w-10 px-2 py-2 text-center">STT</th>
                <th className="px-2.5 py-2">Mã SP DMS</th>
                <th className="px-2.5 py-2">Tên Sản Phẩm DMS</th>
                <th className="px-2 py-2 text-center">ĐVT DMS</th>
                <th className="px-2.5 py-2">SP Xuất Hóa Đơn (Đã gán)</th>
                <th className="px-2 py-2 text-center">Tỷ lệ quy đổi</th>
                <th className="px-2 py-2">Nhà cung cấp</th>
                <th className="px-2 py-2">Công ty QL</th>
                <th className="w-24 px-2 py-2 text-center">Thao tác</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-xs text-slate-500">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 size={15} className="animate-spin text-sky-600" />
                      Đang tải danh sách mã sản phẩm DMS...
                    </span>
                  </td>
                </tr>
              ) : pagedRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-xs text-slate-500">
                    {error || "Chưa có mã sản phẩm DMS nào."}
                  </td>
                </tr>
              ) : (
                pagedRows.map((row, idx) => {
                  const stt = (safePage - 1) * pageSize + idx + 1;
                  const ratioChanged = (row.conversion_num || 1) !== (row.conversion_den || 1);
                  return (
                    <tr
                      key={row.id}
                      className="border-b border-slate-100 text-[11px] transition-colors even:bg-amber-50/40 hover:bg-sky-50/50"
                    >
                      <td className="px-2 py-1.5 text-center font-medium text-slate-500">{stt}</td>

                      <td className="whitespace-nowrap px-2.5 py-1.5 font-mono font-bold text-sky-800">
                        <span className="rounded border border-sky-300 bg-sky-50 px-1.5 py-0.5">
                          {row.distributor_sku}
                        </span>
                      </td>

                      <td className="px-2.5 py-1.5 font-medium text-slate-800">
                        {row.distributor_product_name}
                      </td>

                      <td className="px-2 py-1.5 text-center text-[10px] font-semibold text-slate-600">
                        {row.unit || "HOP"}
                      </td>

                      <td className="px-2.5 py-1.5">
                        {row.invoice_product_id && row.invoice_product_code ? (
                          <button
                            type="button"
                            onClick={() => openQuickMapModal(row)}
                            className="group flex max-w-[300px] items-center gap-1.5 rounded border border-emerald-200 bg-emerald-50/70 px-2 py-0.5 text-left hover:border-emerald-400 hover:bg-emerald-100/70"
                            title="Bấm để đổi SP xuất hóa đơn hoặc tỷ lệ quy đổi"
                          >
                            <span className="shrink-0 font-mono text-[10px] font-bold text-emerald-800">
                              {row.invoice_product_code}
                            </span>
                            <span className="truncate text-[10px] text-slate-700">
                              {row.invoice_product_name}
                            </span>
                            {row.invoice_product_unit && (
                              <span className="shrink-0 rounded bg-white px-1 text-[9px] font-semibold text-slate-500">
                                {row.invoice_product_unit}
                              </span>
                            )}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openQuickMapModal(row)}
                            className="inline-flex items-center gap-1 rounded border border-red-300 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700 hover:bg-red-100"
                          >
                            <Link2 size={11} /> Chưa gán — Bấm để gán
                          </button>
                        )}
                      </td>

                      <td className="whitespace-nowrap px-2 py-1.5 text-center">
                        <button
                          type="button"
                          onClick={() => openQuickMapModal(row)}
                          className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                            ratioChanged
                              ? "border border-violet-300 bg-violet-50 text-violet-800"
                              : "bg-slate-100 text-slate-600"
                          }`}
                          title="Bấm để chỉnh tỷ lệ quy đổi ĐVT"
                        >
                          {row.conversion_num || 1}/{row.conversion_den || 1}
                        </button>
                      </td>

                      <td className="whitespace-nowrap px-2 py-1.5">
                        <span className="inline-block rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                          {row.supplier || "Vinamilk"}
                        </span>
                      </td>

                      <td className="px-2 py-1.5">
                        {row.company_code ? (
                          <span className="inline-block rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800">
                            {row.company_code}
                          </span>
                        ) : (
                          <span className="text-[10px] italic text-slate-400">Dùng chung</span>
                        )}
                      </td>

                      <td className="whitespace-nowrap px-2 py-1.5 text-center">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openQuickMapModal(row)}
                            className="rounded p-1 text-emerald-700 hover:bg-emerald-100"
                            title="Gán SP xuất hóa đơn & tỷ lệ quy đổi"
                          >
                            <Link2 size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModal(row)}
                            className="rounded p-1 text-sky-600 hover:bg-sky-100"
                            title="Chỉnh sửa thông tin mã SP DMS"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDeletingRow(row);
                              setDeleteError("");
                            }}
                            className="rounded p-1 text-red-600 hover:bg-red-100"
                            title="Xóa mã SP DMS"
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
          </table>
        </div>

        {/* 5. FOOTER PHÂN TRANG */}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-300 bg-slate-100 px-3 py-2">
          <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
            <span>
              * Mã SP DMS phải được gán vào <strong>Danh sách SP xuất hóa đơn</strong> trước khi tổng hợp xuất hóa đơn.
            </span>
            <label className="inline-flex items-center gap-1 font-semibold text-slate-700">
              Hiển thị:
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] text-slate-800"
              >
                <option value={20}>20 dòng</option>
                <option value={50}>50 dòng</option>
                <option value={100}>100 dòng</option>
                <option value={200}>200 dòng</option>
              </select>
            </label>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="mr-1 text-[11px] font-semibold text-slate-600">
              Trang {safePage} / {totalPages} (Tổng {formatNumber(filteredRows.length)} mã)
            </span>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronLeft size={13} /> Trước
            </button>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Sau <ChevronRight size={13} />
            </button>
          </div>
        </footer>
      </div>

      {/* MODAL GÁN NHANH SP XUẤT HÓA ĐƠN & TỶ LỆ QUY ĐỔI (Standard CreateOrderForm) */}
      {mappingRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden border border-slate-400 bg-white shadow-2xl">
            <header className="flex items-center justify-between bg-[#14263d] px-3 py-2 text-white">
              <div className="flex items-center gap-2">
                <Link2 size={17} className="text-red-500" />
                <h2 className="text-xs font-bold uppercase tracking-wide text-white">
                  Gán SP Xuất Hóa Đơn &amp; Quy Đổi ĐVT cho Mã DMS: {mappingRow.distributor_sku}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setMappingRow(null)}
                className="rounded p-1 text-white hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </header>

            <div className="flex-1 space-y-3 overflow-y-auto p-3">
              <div className="rounded border border-sky-200 bg-sky-50/70 px-3 py-2 text-xs text-sky-900">
                <div>
                  <strong>Mã SP DMS:</strong> <span className="font-mono">{mappingRow.distributor_sku}</span> ({mappingRow.unit || "HOP"})
                </div>
                <div className="mt-0.5">
                  <strong>Tên SP DMS:</strong> {mappingRow.distributor_product_name}
                </div>
              </div>

              {/* Tỷ lệ quy đổi */}
              <div className="grid gap-3 rounded border border-slate-200 bg-slate-50 p-2.5 sm:grid-cols-2">
                <div>
                  <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                    Tử số quy đổi (1 ĐVT DMS bằng bao nhiêu ĐVT xuất HĐ?)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={mapConvNum}
                    onChange={(e) => setMapConvNum(Math.max(1, Number(e.target.value) || 1))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                    Mẫu số quy đổi (mặc định = 1)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={mapConvDen}
                    onChange={(e) => setMapConvDen(Math.max(1, Number(e.target.value) || 1))}
                    className={inputCls}
                  />
                </div>
                <div className="text-[10px] text-slate-600 sm:col-span-2">
                  Công thức: <strong>SL xuất HĐ = SL trên đơn DMS × ({mapConvNum} / {mapConvDen})</strong>. Ví dụ: bán 1 Thùng = 48 Hộp thì nhập Tử = 48, Mẫu = 1.
                </div>
              </div>

              {/* Tìm & chọn SP xuất hóa đơn */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-semibold uppercase text-slate-600">
                    Chọn Sản phẩm xuất hóa đơn chuẩn
                  </label>
                  {mapSelectedIpId !== null && (
                    <button
                      type="button"
                      onClick={() => setMapSelectedIpId(null)}
                      className="text-[10px] font-semibold text-red-600 hover:underline"
                    >
                      Bỏ chọn (Gỡ gán)
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={mapSearch}
                    onChange={(e) => setMapSearch(e.target.value)}
                    placeholder="Gõ Mã SP xuất HĐ hoặc Tên SP để lọc nhanh..."
                    className={`${inputCls} pl-7`}
                  />
                </div>
                <div className="max-h-56 overflow-y-auto rounded border border-slate-200">
                  {filteredInvoiceProducts.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-500">
                      Không tìm thấy SP xuất hóa đơn nào. Hãy thêm tại mục <strong>Danh sách SP xuất hóa đơn</strong>.
                    </div>
                  ) : (
                    filteredInvoiceProducts.map((ip) => {
                      const active = mapSelectedIpId === ip.id;
                      return (
                        <button
                          key={ip.id}
                          type="button"
                          onClick={() => setMapSelectedIpId(ip.id)}
                          className={`flex w-full items-center justify-between border-b border-slate-100 px-2.5 py-1.5 text-left text-[11px] last:border-b-0 ${
                            active ? "bg-sky-100 font-semibold text-sky-900" : "hover:bg-slate-50"
                          }`}
                        >
                          <div className="min-w-0 flex-1 pr-2">
                            <span className="mr-2 font-mono font-bold text-sky-800">{ip.code}</span>
                            <span className="text-slate-800">{ip.name}</span>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                              {ip.unit_name}
                            </span>
                            {active && <Check size={14} className="text-sky-700" />}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            <footer className="flex items-center justify-between gap-3 border-t border-slate-300 bg-slate-100 px-3 py-2">
              <span className="text-[10px] text-slate-500">
                {mapSelectedIpId
                  ? `Đang chọn ID #${mapSelectedIpId} (tỷ lệ ${mapConvNum}/${mapConvDen})`
                  : "Chưa chọn SP xuất hóa đơn"}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMappingRow(null)}
                  className="rounded bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800"
                >
                  Đóng
                </button>
                <button
                  type="button"
                  disabled={savingMap}
                  onClick={() => void handleSaveQuickMap()}
                  className="inline-flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:bg-slate-300"
                >
                  {savingMap ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                  Lưu gán SP xuất HĐ
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}

      {/* MODAL THÊM MỚI / CHỈNH SỬA MÃ SP DMS */}
      {(isCreatingNew || editingRow) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xl border border-slate-400 bg-white shadow-2xl">
            <header className="flex items-center justify-between bg-[#14263d] px-3 py-2 text-white">
              <div className="flex items-center gap-2">
                {isCreatingNew ? <Plus size={17} className="text-red-500" /> : <Pencil size={17} className="text-red-500" />}
                <h2 className="text-xs font-bold uppercase tracking-wide text-white">
                  {isCreatingNew ? "Thêm Mới Mã Sản Phẩm DMS" : "Chỉnh Sửa Mã Sản Phẩm DMS"}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsCreatingNew(false);
                  setEditingRow(null);
                }}
                className="rounded p-1 text-white hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </header>

            <form onSubmit={handleSaveEdit}>
              <div className="space-y-3 p-3.5">
                {editError && (
                  <div className="flex items-center gap-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">
                    <AlertTriangle size={14} className="shrink-0 text-red-600" />
                    <span>{editError}</span>
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                      Mã SP DMS <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={editSku}
                      onChange={(e) => setEditSku(e.target.value.toUpperCase())}
                      placeholder="VD: 01SB10"
                      className={inputCls}
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">ĐVT trên DMS</label>
                    <input
                      type="text"
                      value={editUnit}
                      onChange={(e) => setEditUnit(e.target.value)}
                      placeholder="THUNG, LOC, HOP..."
                      className={inputCls}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                      Tên Sản Phẩm DMS <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className={inputCls}
                      required
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                      Gán Sản Phẩm Xuất Hóa Đơn chuẩn
                    </label>
                    <select
                      value={editInvoiceProductId}
                      onChange={(e) => setEditInvoiceProductId(e.target.value)}
                      className={inputCls}
                    >
                      <option value="">[-- Chưa gán SP xuất hóa đơn --]</option>
                      {invoiceProducts.map((ip) => (
                        <option key={ip.id} value={String(ip.id)}>
                          [{ip.code}] {ip.name} ({ip.unit_name})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                      Tỷ lệ quy đổi (Tử số)
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={editConvNum}
                      onChange={(e) => setEditConvNum(Math.max(1, Number(e.target.value) || 1))}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                      Tỷ lệ quy đổi (Mẫu số)
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={editConvDen}
                      onChange={(e) => setEditConvDen(Math.max(1, Number(e.target.value) || 1))}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">Nhà cung cấp (DMS)</label>
                    <input
                      type="text"
                      value={editSupplier}
                      onChange={(e) => setEditSupplier(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">Công ty Quản lý</label>
                    <select
                      value={editCompanyId}
                      onChange={(e) => setEditCompanyId(e.target.value)}
                      className={inputCls}
                    >
                      <option value="">[-- Dùng chung toàn NPP --]</option>
                      {companies.map((c) => (
                        <option key={c.id} value={String(c.id)}>
                          [{c.code}] {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <footer className="flex items-center justify-between gap-3 border-t border-slate-300 bg-slate-100 px-3 py-2">
                <span className="text-[10px] text-slate-500">
                  SL xuất HĐ = SL DMS × ({editConvNum}/{editConvDen})
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsCreatingNew(false);
                      setEditingRow(null);
                    }}
                    className="rounded bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800"
                  >
                    Đóng
                  </button>
                  <button
                    type="submit"
                    disabled={savingEdit}
                    className="inline-flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:bg-slate-300"
                  >
                    {savingEdit ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                    {isCreatingNew ? "Thêm mới" : "Lưu thay đổi"}
                  </button>
                </div>
              </footer>
            </form>
          </div>
        </div>
      )}

      {/* MODAL UPLOAD EXCEL */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col border border-slate-400 bg-white shadow-2xl">
            <header className="flex shrink-0 items-center justify-between bg-[#14263d] px-3 py-2 text-white">
              <div className="flex items-center gap-2">
                <Upload size={17} className="text-red-500" />
                <h2 className="text-xs font-bold uppercase tracking-wide text-white">
                  Upload Danh Sách Mã Sản Phẩm DMS Từ Excel
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowUploadModal(false)}
                className="rounded p-1 text-white hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </header>

            <div className="space-y-3 overflow-y-auto p-3.5">
              <div className="space-y-1 rounded border border-sky-200 bg-sky-50/70 p-2.5 text-[11px] text-sky-900">
                <div className="flex items-center gap-1.5 font-bold">
                  <Info size={14} className="text-sky-700" /> Hướng dẫn Upload Danh sách mã SP DMS:
                </div>
                <p>
                  File mẫu hỗ trợ cột <strong>Mã SP DMS</strong>, <strong>Tên Sản Phẩm DMS</strong>, <strong>Mã SP Xuất Hóa Đơn</strong> (tự động nối vào Danh sách SP xuất HĐ nếu trùng mã) và <strong>Tỷ lệ quy đổi</strong> (VD: <code>48/1</code> hoặc <code>48</code>).
                </p>
              </div>

              {uploadError && (
                <div className="flex items-center gap-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">
                  <AlertTriangle size={14} className="shrink-0 text-red-600" />
                  <span>{uploadError}</span>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-dashed border-slate-300 bg-slate-50 p-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xlsm,.xls"
                  onChange={handleFileSelect}
                  className="text-xs file:mr-2 file:rounded file:border-0 file:bg-sky-600 file:px-2.5 file:py-1 file:text-xs file:font-semibold file:text-white hover:file:bg-sky-700"
                />
                <button
                  type="button"
                  onClick={() => void handleDownloadTemplate()}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700 underline hover:text-sky-900"
                >
                  <Download size={13} /> Tải file Excel mẫu
                </button>
              </div>

              {previewRows.length > 0 && (
                <div className="max-h-60 overflow-y-auto rounded border border-slate-200">
                  <table className="w-full border-collapse text-left text-[11px]">
                    <thead className="sticky top-0 bg-slate-100 text-[10px] font-semibold uppercase text-slate-600">
                      <tr className="border-b border-slate-300">
                        <th className="px-2 py-1.5 text-center">STT</th>
                        <th className="px-2 py-1.5">Mã SP DMS</th>
                        <th className="px-2 py-1.5">Tên SP DMS</th>
                        <th className="px-2 py-1.5">Mã SP Xuất HĐ</th>
                        <th className="px-2 py-1.5 text-center">Quy đổi</th>
                        <th className="px-2 py-1.5">NCC</th>
                        <th className="px-2 py-1.5 text-center">Phân loại</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.slice(0, 100).map((p, idx) => (
                        <tr key={idx} className="border-b border-slate-100 even:bg-amber-50/40">
                          <td className="px-2 py-1 text-center text-slate-500">{p.stt}</td>
                          <td className="px-2 py-1 font-mono font-bold text-sky-800">{p.distributor_sku}</td>
                          <td className="px-2 py-1">{p.distributor_product_name}</td>
                          <td className="px-2 py-1 font-mono font-bold text-emerald-700">
                            {p.invoice_product_code || <span className="font-normal italic text-slate-400">Chưa gán</span>}
                          </td>
                          <td className="px-2 py-1 text-center font-mono">{p.conversion_ratio}</td>
                          <td className="px-2 py-1">{p.supplier}</td>
                          <td className="px-2 py-1 text-center">
                            <span
                              className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                                p.action_type === "Thêm mới"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-sky-100 text-sky-800"
                              }`}
                            >
                              {p.action_type}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-300 bg-slate-100 px-3 py-2">
              <span className="text-[10px] text-slate-500">
                {selectedFile ? `Đã chọn: ${selectedFile.name} (${previewRows.length} dòng)` : "Vui lòng chọn file Excel"}
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
                  onClick={() => void handleExecuteUpload()}
                  disabled={uploading || previewRows.length === 0}
                  className="inline-flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:bg-slate-300"
                >
                  {uploading ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  Xác nhận tải lên ({previewRows.length})
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}

      {/* MODAL XÓA */}
      {deletingRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md border border-slate-400 bg-white shadow-2xl">
            <header className="flex items-center justify-between bg-[#14263d] px-3 py-2 text-white">
              <div className="flex items-center gap-2">
                <Trash2 size={17} className="text-red-500" />
                <h2 className="text-xs font-bold uppercase tracking-wide text-white">Xác Nhận Xóa Mã SP DMS</h2>
              </div>
              <button type="button" onClick={() => setDeletingRow(null)} className="rounded p-1 text-white hover:bg-white/10">
                <X size={16} />
              </button>
            </header>
            <div className="space-y-2 p-3.5 text-xs text-slate-700">
              {deleteError && (
                <div className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">{deleteError}</div>
              )}
              <p>
                Bạn có chắc chắn muốn xóa mã SP DMS <strong>{deletingRow.distributor_sku}</strong> ({deletingRow.distributor_product_name})?
              </p>
            </div>
            <footer className="flex items-center justify-end gap-2 border-t border-slate-300 bg-slate-100 px-3 py-2">
              <button
                type="button"
                onClick={() => setDeletingRow(null)}
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDelete()}
                disabled={deleting}
                className="inline-flex items-center gap-1.5 rounded bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-50"
              >
                {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Xác nhận Xóa
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

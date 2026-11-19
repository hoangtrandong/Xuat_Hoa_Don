"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
} from "lucide-react";
import * as XLSX from "xlsx";
import { API_URL, apiFetch } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { downloadExcel } from "@/lib/excel";

const inputCls =
  "w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-100";

type DistributorProductRow = {
  id: number;
  distributor_name: string;
  distributor_sku: string;
  distributor_product_name: string;
  supplier: string;
  unit: string;
  company_id: number | null;
  company_code: string | null;
  company_name: string | null;
  status: string;
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
  supplier: string;
  company_code: string;
  company_name: string;
  action_type: "Thêm mới" | "Cập nhật";
};

export default function ProductCompanyManagementPage() {
  const [rows, setRows] = useState<DistributorProductRow[]>([]);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [distributorFilter, setDistributorFilter] = useState<string>("ALL");
  const [supplierFilter, setSupplierFilter] = useState<string>("ALL");
  const [companyFilter, setCompanyFilter] = useState<string>("ALL");
  const [pageSize, setPageSize] = useState<number>(20);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [error, setError] = useState<string>("");
  const [toastMessage, setToastMessage] = useState<string>("");

  // State Chỉnh sửa Modal
  const [editingRow, setEditingRow] = useState<DistributorProductRow | null>(null);
  const [editSku, setEditSku] = useState<string>("");
  const [editName, setEditName] = useState<string>("");
  const [editDistributor, setEditDistributor] = useState<string>("");
  const [editSupplier, setEditSupplier] = useState<string>("");
  const [editCompanyId, setEditCompanyId] = useState<string>("");
  const [savingEdit, setSavingEdit] = useState<boolean>(false);
  const [editError, setEditError] = useState<string>("");

  // State Xóa Modal
  const [deletingRow, setDeletingRow] = useState<DistributorProductRow | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string>("");

  // State Upload Excel Modal
  const [showUploadModal, setShowUploadModal] = useState<boolean>(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewRows, setPreviewRows] = useState<ExcelPreviewRow[]>([]);
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [resProducts, resCompanies] = await Promise.all([
        apiFetch(`${API_URL}/product-groups/distributor-products`),
        apiFetch(`${API_URL}/companies/?limit=5000`),
      ]);

      if (!resProducts.ok) throw new Error("Không thể tải danh sách mã sản phẩm NPP nội bộ.");
      const data = (await resProducts.json()) as DistributorProductRow[];
      setRows(data);

      if (resCompanies.ok) {
        const compsData = (await resCompanies.json()) as Array<Record<string, unknown>>;
        const mappedComps: CompanyOption[] = compsData.map((c) => ({
          id: Number(c.id),
          code: String(c.code ?? ""),
          name: String(c.name ?? ""),
        }));
        setCompanies(mappedComps);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi khi tải dữ liệu.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  // Lọc dữ liệu
  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((row) => {
      if (distributorFilter !== "ALL" && row.distributor_name !== distributorFilter) return false;
      if (supplierFilter !== "ALL" && row.supplier !== supplierFilter) return false;
      if (companyFilter === "ASSIGNED" && !row.company_id) return false;
      if (companyFilter === "UNASSIGNED" && row.company_id) return false;
      if (companyFilter !== "ALL" && companyFilter !== "ASSIGNED" && companyFilter !== "UNASSIGNED") {
        if (String(row.company_id) !== companyFilter) return false;
      }

      if (q) {
        const match =
          row.distributor_sku.toLowerCase().includes(q) ||
          row.distributor_product_name.toLowerCase().includes(q) ||
          row.distributor_name.toLowerCase().includes(q) ||
          row.supplier.toLowerCase().includes(q) ||
          (row.company_code && row.company_code.toLowerCase().includes(q)) ||
          (row.company_name && row.company_name.toLowerCase().includes(q));
        if (!match) return false;
      }
      return true;
    });
  }, [rows, searchQuery, distributorFilter, supplierFilter, companyFilter]);

  // Danh sách các NPP và NCC duy nhất để lọc
  const filterOptions = useMemo(() => {
    const dists = new Set<string>();
    const supps = new Set<string>();
    for (const r of rows) {
      if (r.distributor_name) dists.add(r.distributor_name);
      if (r.supplier) supps.add(r.supplier);
    }
    return {
      distributors: Array.from(dists),
      suppliers: Array.from(supps),
    };
  }, [rows]);

  // Thống kê KPI
  const stats = useMemo(() => {
    const total = rows.length;
    let assigned = 0;
    let unassigned = 0;
    for (const r of rows) {
      if (r.company_id) assigned++;
      else unassigned++;
    }
    return {
      total,
      distributorsCount: filterOptions.distributors.length,
      suppliersCount: filterOptions.suppliers.length,
      assignedCount: assigned,
      unassignedCount: unassigned,
    };
  }, [rows, filterOptions]);

  // Phân trang
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pagedRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, safePage, pageSize]);

  // Mở modal sửa
  function openEditModal(row: DistributorProductRow) {
    setEditingRow(row);
    setEditSku(row.distributor_sku);
    setEditName(row.distributor_product_name);
    setEditDistributor(row.distributor_name);
    setEditSupplier(row.supplier);
    setEditCompanyId(row.company_id ? String(row.company_id) : "");
    setEditError("");
  }

  // Lưu chỉnh sửa
  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingRow) return;
    if (!editSku.trim() || !editName.trim()) {
      setEditError("Mã SP NPP và Tên sản phẩm không được để trống.");
      return;
    }

    setSavingEdit(true);
    setEditError("");
    try {
      const selectedComp = companies.find((c) => String(c.id) === editCompanyId);
      const res = await apiFetch(`${API_URL}/product-groups/distributor-products`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingRow.id,
          original_code: editingRow.distributor_sku,
          distributor_sku: editSku.trim().toUpperCase(),
          distributor_product_name: editName.trim(),
          distributor_name: editDistributor.trim() || "Nhà Phân Phối Mai Gold",
          supplier: editSupplier.trim() || "Vinamilk",
          company_id: editCompanyId ? Number(editCompanyId) : null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Không thể cập nhật mã sản phẩm NPP.");

      // Cập nhật Optimistic vào State
      setRows((prev) =>
        prev.map((r) =>
          r.id === editingRow.id
            ? {
                ...r,
                distributor_sku: editSku.trim().toUpperCase(),
                distributor_product_name: editName.trim(),
                distributor_name: editDistributor.trim() || "Nhà Phân Phối Mai Gold",
                supplier: editSupplier.trim() || "Vinamilk",
                company_id: editCompanyId ? Number(editCompanyId) : null,
                company_code: selectedComp ? selectedComp.code : null,
                company_name: selectedComp ? selectedComp.name : null,
              }
            : r
        )
      );

      setToastMessage(`Đã cập nhật mã sản phẩm NPP '${editSku.trim().toUpperCase()}' thành công.`);
      setTimeout(() => setToastMessage(""), 4000);
      setEditingRow(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Lỗi khi cập nhật.");
    } finally {
      setSavingEdit(false);
    }
  }

  // Xóa mã SP NPP
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
        throw new Error(data.detail || "Không thể xóa mã sản phẩm NPP.");
      }

      setRows((prev) => prev.filter((r) => r.id !== deletingRow.id));
      setToastMessage(`Đã xóa mã sản phẩm NPP '${deletingRow.distributor_sku}' khỏi danh mục.`);
      setTimeout(() => setToastMessage(""), 4000);
      setDeletingRow(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Lỗi khi xóa mã sản phẩm.");
    } finally {
      setDeleting(false);
    }
  }

  // Đọc file Excel xem trước trong modal upload
  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setUploadError("");
    setPreviewRows([]);

    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const sheetName = wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];
      const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

      if (!rawData || rawData.length < 2) {
        setUploadError("File Excel không có dữ liệu hoặc thiếu dòng tiêu đề.");
        return;
      }

      const headers = (rawData[0] || []).map((c) => String(c || "").trim().toLowerCase());

      let skuIdx = -1;
      let nameIdx = -1;
      let distIdx = -1;
      let supplierIdx = -1;
      let compCodeIdx = -1;

      headers.forEach((h, idx) => {
        if (h.includes("mã sp npp") || h.includes("mã sp") || h.includes("distributor_sku") || h.includes("sku")) {
          skuIdx = idx;
        } else if (h.includes("tên sản phẩm") || h.includes("tên sp") || h.includes("distributor_name") || h.includes("distributor_product_name")) {
          nameIdx = idx;
        } else if (h.includes("nhà phân phối") || h.includes("distributor") || h.includes("npp")) {
          distIdx = idx;
        } else if (h.includes("nhà cung cấp") || h.includes("supplier") || h.includes("ncc")) {
          supplierIdx = idx;
        } else if (h.includes("mã công ty ql") || h.includes("mã công ty") || h.includes("company_code") || h.includes("mã cty")) {
          compCodeIdx = idx;
        }
      });

      if (skuIdx === -1) skuIdx = 2 < headers.length ? 2 : 0;
      if (nameIdx === -1) nameIdx = 3 < headers.length ? 3 : 1;

      const existingMap = new Map(rows.map((r) => [r.distributor_sku.toUpperCase(), r]));
      const companyMap = new Map(companies.map((c) => [c.code.toUpperCase(), c]));

      const previewList: ExcelPreviewRow[] = [];
      for (let i = 1; i < rawData.length; i++) {
        const row = rawData[i];
        if (!row || row.length === 0) continue;

        const sku = String(row[skuIdx] || "").trim().toUpperCase();
        if (!sku || sku.includes("BẮT BUỘC") || sku.includes("MÃ SP")) continue;

        const name = String(row[nameIdx] || "").trim() || `Sản phẩm ${sku}`;
        const dist = distIdx !== -1 && row[distIdx] ? String(row[distIdx]).trim() : "Nhà Phân Phối Mai Gold";
        const supplier = supplierIdx !== -1 && row[supplierIdx] ? String(row[supplierIdx]).trim() : "Vinamilk";
        const compCode = compCodeIdx !== -1 && row[compCodeIdx] ? String(row[compCodeIdx]).trim().toUpperCase() : "";
        const matchedComp = compCode ? companyMap.get(compCode) : null;
        const compName = matchedComp ? matchedComp.name : compCode ? "Mã chưa khớp công ty QL" : "";

        const actionType: ExcelPreviewRow["action_type"] = existingMap.has(sku) ? "Cập nhật" : "Thêm mới";

        previewList.push({
          stt: previewList.length + 1,
          distributor_name: dist || "Nhà Phân Phối Mai Gold",
          distributor_sku: sku,
          distributor_product_name: name,
          supplier: supplier || "Vinamilk",
          company_code: compCode,
          company_name: compName,
          action_type: actionType,
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

  // Thực thi Upload Excel lên Server
  async function handleExecuteUpload() {
    if (!selectedFile) return;
    setUploading(true);
    setUploadError("");
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const res = await apiFetch(`${API_URL}/product-groups/distributor-products/upload`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Tải lên file không thành công.");
      }

      setToastMessage(data.message || "Tải lên và cập nhật danh sách mã sản phẩm NPP thành công!");
      setTimeout(() => setToastMessage(""), 5000);
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

  // Tải file Excel mẫu 7 cột chuẩn
  function handleDownloadTemplate() {
    const templateRows = [
      {
        STT: 1,
        "Nhà phân phối": "Nhà Phân Phối Mai Gold",
        "Mã SP NPP": "01TD03",
        "Tên Sản Phẩm NPP": "Sữa tươi tiệt trùng có đường 180ml",
        "Nhà cung cấp": "Vinamilk",
        "Mã Công ty QL": "CT01",
        "Tên Công ty QL": "Công ty TNHH Phân Phối Mai Gold",
      },
      {
        STT: 2,
        "Nhà phân phối": "Nhà Phân Phối Mai Gold",
        "Mã SP NPP": "07KD12",
        "Tên Sản Phẩm NPP": "Sữa chua ăn lựu đỏ 100g",
        "Nhà cung cấp": "Vinamilk",
        "Mã Công ty QL": "",
        "Tên Công ty QL": "",
      },
      {
        STT: 3,
        "Nhà phân phối": "Nhà Phân Phối Mai Gold",
        "Mã SP NPP": "01SX11",
        "Tên Sản Phẩm NPP": "Sữa dinh dưỡng Optimum Gold 110ml",
        "Nhà cung cấp": "Vinamilk",
        "Mã Công ty QL": "",
        "Tên Công ty QL": "",
      },
    ];
    downloadExcel(templateRows, "mau_danh_sach_ma_sp_npp_noi_bo", "DS Mã SP NPP");
  }

  // Xuất Excel toàn bộ dữ liệu khớp bộ lọc
  function handleExportExcel() {
    if (filteredRows.length === 0) return;
    const excelData = filteredRows.map((r, idx) => ({
      STT: idx + 1,
      "Nhà phân phối": r.distributor_name || "Nhà Phân Phối Mai Gold",
      "Mã SP NPP": r.distributor_sku,
      "Tên Sản Phẩm NPP": r.distributor_product_name,
      "Nhà cung cấp": r.supplier || "Vinamilk",
      "Mã Công ty QL": r.company_code || "",
      "Tên Công ty QL": r.company_name || "",
    }));
    downloadExcel(
      excelData,
      `Quan_ly_ma_NPP_noi_bo_${new Date().toISOString().slice(0, 10)}`,
      "Mã SP NPP Nội Bộ"
    );
  }

  return (
    <div className="space-y-3">
      {/* Toast thông báo */}
      {toastMessage && (
        <div className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 flex items-center justify-between shadow-sm animate-in fade-in-50">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 size={15} className="text-emerald-600" />
            {toastMessage}
          </span>
          <button
            type="button"
            onClick={() => setToastMessage("")}
            className="text-emerald-600 hover:text-emerald-800"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* KHUNG CHÍNH CHUẨN ENTERPRISE (CreateOrderForm Standard) */}
      <div className="border border-slate-400 bg-white shadow-lg">
        {/* 1. HEADER FORM */}
        <header className="bg-[#14263d] px-3 py-2 text-white flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Building2 size={17} className="text-red-500" />
            <h1 className="text-xs font-bold uppercase tracking-wide text-white">
              Quản Lý Mã Sản Phẩm Nhà Phân Phối Nội Bộ
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadTemplate}
              className="inline-flex items-center gap-1 rounded bg-white/10 hover:bg-white/20 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors"
              title="Tải file Excel mẫu gồm 7 cột chuẩn để nhập dữ liệu"
            >
              <Download size={12} />
              Tải file mẫu
            </button>

            <button
              type="button"
              onClick={() => {
                setShowUploadModal(true);
                setSelectedFile(null);
                setPreviewRows([]);
                setUploadError("");
              }}
              className="inline-flex items-center gap-1 rounded bg-emerald-700 hover:bg-emerald-800 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors shadow-sm"
              title="Upload file Excel để thêm mới và chỉnh sửa hàng loạt nhiều mã SP NPP"
            >
              <Upload size={12} />
              Upload thêm & Sửa hàng loạt
            </button>

            <button
              type="button"
              onClick={handleExportExcel}
              disabled={filteredRows.length === 0}
              className="inline-flex items-center gap-1 rounded bg-white/10 hover:bg-white/20 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors disabled:opacity-50"
            >
              <FileSpreadsheet size={12} />
              Xuất Excel ({filteredRows.length})
            </button>

            <button
              type="button"
              onClick={() => void loadData()}
              disabled={loading}
              className="rounded p-1 text-white hover:bg-white/10 transition-colors"
              title="Làm mới danh sách"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </header>

        {/* 2. THỐNG KÊ NHANH (KPI STATS) */}
        <section className="grid grid-cols-2 sm:grid-cols-5 divide-x divide-slate-200 border-b border-slate-200 bg-slate-50/60 text-center text-xs">
          <div className="py-2 px-3">
            <span className="block text-[10px] font-semibold text-slate-500 uppercase">
              Tổng Mã SP NPP
            </span>
            <span className="text-sm font-bold text-slate-800">
              {formatNumber(stats.total)}
            </span>
          </div>
          <div className="py-2 px-3">
            <span className="block text-[10px] font-semibold text-slate-500 uppercase">
              Nhà phân phối
            </span>
            <span className="text-sm font-bold text-indigo-700">
              {stats.distributorsCount}
            </span>
          </div>
          <div className="py-2 px-3">
            <span className="block text-[10px] font-semibold text-slate-500 uppercase">
              Nhà cung cấp
            </span>
            <span className="text-sm font-bold text-sky-700">
              {stats.suppliersCount}
            </span>
          </div>
          <div className="py-2 px-3">
            <span className="block text-[10px] font-semibold text-emerald-700 uppercase">
              Đã gán Công ty QL
            </span>
            <span className="text-sm font-bold text-emerald-700">
              {formatNumber(stats.assignedCount)}
            </span>
          </div>
          <div className="py-2 px-3">
            <span className="block text-[10px] font-semibold text-amber-700 uppercase">
              Chưa gán Công ty QL
            </span>
            <span className="text-sm font-bold text-amber-700">
              {formatNumber(stats.unassignedCount)}
            </span>
          </div>
        </section>

        {/* 3. BỘ LỌC TÌM KIẾM */}
        <section className="border-b border-slate-200 px-3 py-2.5 bg-white">
          <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                Tìm kiếm mã SP, tên SP hoặc Công ty QL
              </label>
              <div className="relative">
                <Search
                  size={13}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                  placeholder="Nhập mã SP, tên sản phẩm, công ty..."
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
              <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                Nhà phân phối
              </label>
              <select
                value={distributorFilter}
                onChange={(e) => {
                  setDistributorFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className={inputCls}
              >
                <option value="ALL">Tất cả Nhà phân phối</option>
                {filterOptions.distributors.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                Nhà cung cấp
              </label>
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
              <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                Trạng thái gán Công ty Quản lý
              </label>
              <select
                value={companyFilter}
                onChange={(e) => {
                  setCompanyFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className={inputCls}
              >
                <option value="ALL">Tất cả trạng thái</option>
                <option value="ASSIGNED">Đã gán Công ty QL</option>
                <option value="UNASSIGNED">Chưa gán Công ty QL</option>
                {companies.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.code} - {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* 4. BẢNG DỮ LIỆU ĐÚNG 7 CỘT CHUẨN */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600 uppercase">
              <tr className="border-b border-slate-300">
                <th className="w-12 px-2 py-2 text-center">STT</th>
                <th className="px-2.5 py-2">Nhà phân phối</th>
                <th className="px-2.5 py-2">Mã SP NPP</th>
                <th className="px-2.5 py-2">Tên Sản Phẩm NPP</th>
                <th className="px-2.5 py-2">Nhà cung cấp</th>
                <th className="px-2.5 py-2">Mã Công ty QL</th>
                <th className="px-2.5 py-2">Tên Công ty QL</th>
                <th className="w-24 px-2 py-2 text-center">Thao tác</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-xs text-slate-500">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 size={15} className="animate-spin text-sky-600" />
                      Đang tải danh sách mã sản phẩm NPP nội bộ...
                    </span>
                  </td>
                </tr>
              ) : pagedRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-xs text-slate-500">
                    {error || "Chưa có mã sản phẩm NPP nào. Hãy bấm 'Upload thêm & Sửa hàng loạt' hoặc tải file mẫu để tải lên."}
                  </td>
                </tr>
              ) : (
                pagedRows.map((row, idx) => {
                  const stt = (safePage - 1) * pageSize + idx + 1;
                  return (
                    <tr
                      key={row.id}
                      className="border-b border-slate-100 even:bg-amber-50/40 hover:bg-sky-50/50 text-[11px] transition-colors"
                    >
                      <td className="px-2 py-1.5 text-center font-medium text-slate-500">
                        {stt}
                      </td>

                      <td className="px-2.5 py-1.5 whitespace-nowrap">
                        <span className="inline-block rounded border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-800">
                          {row.distributor_name || "Nhà Phân Phối Mai Gold"}
                        </span>
                      </td>

                      <td className="px-2.5 py-1.5 whitespace-nowrap font-mono font-bold text-sky-800">
                        <span className="rounded bg-sky-50 border border-sky-300 px-1.5 py-0.5">
                          {row.distributor_sku}
                        </span>
                      </td>

                      <td className="px-2.5 py-1.5 font-medium text-slate-800">
                        {row.distributor_product_name}
                      </td>

                      <td className="px-2.5 py-1.5 whitespace-nowrap">
                        <span className="inline-block rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                          {row.supplier || "Vinamilk"}
                        </span>
                      </td>

                      <td className="px-2.5 py-1.5 whitespace-nowrap font-mono">
                        {row.company_code ? (
                          <span className="inline-block rounded border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-[10px] font-bold text-sky-800">
                            {row.company_code}
                          </span>
                        ) : (
                          <span className="text-slate-400 text-[10px] italic">—</span>
                        )}
                      </td>

                      <td className="px-2.5 py-1.5">
                        {row.company_name ? (
                          <span className="inline-block rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                            {row.company_name}
                          </span>
                        ) : (
                          <span className="inline-block rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                            Chưa gán Công ty QL
                          </span>
                        )}
                      </td>

                      <td className="px-2 py-1.5 text-center whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEditModal(row)}
                            className="rounded p-1 text-sky-600 hover:bg-sky-100 hover:text-sky-800 transition-colors"
                            title="Chỉnh sửa thông tin & gán Công ty QL"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDeletingRow(row);
                              setDeleteError("");
                            }}
                            className="rounded p-1 text-red-600 hover:bg-red-100 hover:text-red-800 transition-colors"
                            title="Xóa mã sản phẩm NPP"
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
        <footer className="border-t border-slate-300 bg-slate-100 px-3 py-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
            <span>
              * Dữ liệu mã sản phẩm NPP nội bộ do người dùng upload & gán Công ty Quản lý xuất hóa đơn.
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
              Trang {safePage} / {totalPages} (Tổng {formatNumber(filteredRows.length)} mã)
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

      {/* MODAL CHỈNH SỬA MÃ SP NPP & GÁN CÔNG TY QUẢN LÝ (Standard GEMINI.md) */}
      {editingRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-in fade-in-50">
          <div className="w-full max-w-xl border border-slate-400 bg-white shadow-2xl">
            <header className="bg-[#14263d] px-3 py-2 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Pencil size={17} className="text-red-500" />
                <h2 className="text-xs font-bold uppercase tracking-wide text-white">
                  Chỉnh Sửa Mã SP NPP & Gán Công Ty Quản Lý
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setEditingRow(null)}
                className="rounded p-1 text-white hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </header>

            <form onSubmit={handleSaveEdit}>
              <div className="p-3.5 space-y-3">
                {editError && (
                  <div className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800 flex items-center gap-2">
                    <AlertTriangle size={14} className="shrink-0 text-red-600" />
                    <span>{editError}</span>
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                      Mã SP NPP <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={editSku}
                      onChange={(e) => setEditSku(e.target.value.toUpperCase())}
                      className={inputCls}
                      required
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                      Nhà phân phối
                    </label>
                    <input
                      type="text"
                      value={editDistributor}
                      onChange={(e) => setEditDistributor(e.target.value)}
                      className={inputCls}
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                      Tên Sản Phẩm NPP <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className={inputCls}
                      required
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                      Nhà cung cấp
                    </label>
                    <input
                      type="text"
                      value={editSupplier}
                      onChange={(e) => setEditSupplier(e.target.value)}
                      className={inputCls}
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                      Công ty Quản lý (Khớp từ Đăng ký quản lý)
                    </label>
                    <select
                      value={editCompanyId}
                      onChange={(e) => setEditCompanyId(e.target.value)}
                      className={inputCls}
                    >
                      <option value="">[-- Chưa gán Công ty Quản lý --]</option>
                      {companies.map((c) => (
                        <option key={c.id} value={String(c.id)}>
                          [{c.code}] - {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="rounded bg-sky-50 border border-sky-200 p-2 text-[11px] text-sky-800 flex items-start gap-1.5">
                  <Info size={14} className="shrink-0 mt-0.5 text-sky-600" />
                  <span>
                    Nếu chọn <strong>[-- Chưa gán Công ty Quản lý --]</strong>, sản phẩm sẽ để trống và chưa thuộc công ty con nào phụ trách xuất hóa đơn.
                  </span>
                </div>
              </div>

              <footer className="border-t border-slate-300 bg-slate-100 px-3 py-2 flex items-center justify-between gap-3">
                <span className="text-[10px] text-slate-500">
                  Mã gốc: <strong>{editingRow.distributor_sku}</strong>
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingRow(null)}
                    className="rounded bg-red-700 hover:bg-red-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
                  >
                    Hủy bỏ
                  </button>
                  <button
                    type="submit"
                    disabled={savingEdit}
                    className="inline-flex items-center gap-1.5 rounded bg-sky-600 hover:bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {savingEdit ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <CheckCircle2 size={13} />
                    )}
                    Lưu thay đổi
                  </button>
                </div>
              </footer>
            </form>
          </div>
        </div>
      )}

      {/* MODAL UPLOAD THÊM & CHỈNH SỬA HÀNG LOẠT TỪ EXCEL (Standard GEMINI.md) */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-in fade-in-50">
          <div className="w-full max-w-4xl max-h-[90vh] flex flex-col border border-slate-400 bg-white shadow-2xl">
            <header className="bg-[#14263d] px-3 py-2 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Upload size={17} className="text-red-500" />
                <h2 className="text-xs font-bold uppercase tracking-wide text-white">
                  Upload Thêm Mới & Chỉnh Sửa Hàng Loạt Từ Excel
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

            <div className="p-3.5 space-y-3 overflow-y-auto">
              <div className="rounded border border-sky-200 bg-sky-50/70 p-3 text-xs text-sky-900 space-y-1.5">
                <div className="font-bold flex items-center gap-1.5 text-sky-950">
                  <Info size={14} className="text-sky-700" />
                  Quy tắc Thêm mới & Chỉnh sửa hàng loạt:
                </div>
                <ul className="list-disc list-inside space-y-0.5 text-[11px] text-slate-700">
                  <li>
                    <strong>File Excel gồm 7 cột:</strong> STT, Nhà phân phối, Mã SP NPP, Tên Sản Phẩm NPP, Nhà cung cấp, Mã Công ty QL, Tên Công ty QL.
                  </li>
                  <li>
                    <strong>Mã Công ty QL:</strong> Khớp theo mã của Công ty trong <em>Đăng ký quản lý</em>. Nếu để trống thì hệ thống sẽ <strong>để trống (chưa gán)</strong>.
                  </li>
                  <li>
                    <strong>Chỉnh sửa hàng loạt:</strong> Nếu Mã SP NPP đã có trong danh mục, hệ thống sẽ tự động cập nhật lại thông tin từ file Excel (Bulk Edit). Nếu mã chưa có, hệ thống sẽ thêm mới.
                  </li>
                </ul>
              </div>

              {uploadError && (
                <div className="rounded border border-red-300 bg-red-50 p-2.5 text-xs text-red-800 flex items-center gap-2">
                  <AlertTriangle size={15} className="shrink-0 text-red-600" />
                  <span>{uploadError}</span>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 border border-dashed border-slate-300 rounded p-3 bg-slate-50">
                <div className="flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xlsm,.xls"
                    onChange={handleFileSelect}
                    className="text-xs file:mr-2 file:py-1 file:px-2.5 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-sky-600 file:text-white hover:file:bg-sky-700"
                  />
                  {selectedFile && (
                    <span className="text-[11px] font-semibold text-slate-700">
                      ({formatNumber(previewRows.length)} dòng dữ liệu)
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleDownloadTemplate}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700 hover:text-sky-900 underline"
                >
                  <Download size={13} />
                  Tải file Excel mẫu 7 cột
                </button>
              </div>

              {/* BẢNG XEM TRƯỚC (PREVIEW) */}
              {previewRows.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                    <span>Xem trước dữ liệu tải lên ({previewRows.length} dòng):</span>
                    <span className="text-[11px] text-slate-500">
                      {previewRows.filter((r) => r.action_type === "Thêm mới").length} Thêm mới,{" "}
                      {previewRows.filter((r) => r.action_type === "Cập nhật").length} Cập nhật hàng loạt
                    </span>
                  </div>

                  <div className="max-h-60 overflow-y-auto border border-slate-200 rounded">
                    <table className="w-full border-collapse text-left text-[11px]">
                      <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600 uppercase sticky top-0">
                        <tr className="border-b border-slate-300">
                          <th className="px-2 py-1.5 text-center w-10">STT</th>
                          <th className="px-2 py-1.5">Nhà phân phối</th>
                          <th className="px-2 py-1.5">Mã SP NPP</th>
                          <th className="px-2 py-1.5">Tên Sản Phẩm NPP</th>
                          <th className="px-2 py-1.5">Nhà cung cấp</th>
                          <th className="px-2 py-1.5">Mã Công ty QL</th>
                          <th className="px-2 py-1.5">Tên Công ty QL</th>
                          <th className="px-2 py-1.5 text-center w-24">Phân loại</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((p, idx) => (
                          <tr
                            key={idx}
                            className="border-b border-slate-100 even:bg-slate-50/50 hover:bg-sky-50/50"
                          >
                            <td className="px-2 py-1 text-center text-slate-500">{p.stt}</td>
                            <td className="px-2 py-1 whitespace-nowrap">{p.distributor_name}</td>
                            <td className="px-2 py-1 font-mono font-bold text-sky-800 whitespace-nowrap">
                              {p.distributor_sku}
                            </td>
                            <td className="px-2 py-1">{p.distributor_product_name}</td>
                            <td className="px-2 py-1 whitespace-nowrap">{p.supplier}</td>
                            <td className="px-2 py-1 font-mono whitespace-nowrap">
                              {p.company_code ? (
                                <span className="font-semibold text-sky-800">{p.company_code}</span>
                              ) : (
                                <span className="text-slate-400 italic">Để trống</span>
                              )}
                            </td>
                            <td className="px-2 py-1">
                              {p.company_name ? (
                                <span className="text-emerald-700">{p.company_name}</span>
                              ) : (
                                <span className="text-amber-600 italic">Chưa gán</span>
                              )}
                            </td>
                            <td className="px-2 py-1 text-center whitespace-nowrap">
                              <span
                                className={`inline-block px-1.5 py-0.5 text-[9px] font-bold rounded uppercase ${
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
                </div>
              )}
            </div>

            <footer className="border-t border-slate-300 bg-slate-100 px-3 py-2 flex items-center justify-between gap-3 shrink-0">
              <span className="text-[10px] text-slate-500">
                {selectedFile ? `Đã chọn: ${selectedFile.name}` : "Vui lòng chọn file Excel"}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="rounded bg-red-700 hover:bg-red-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
                >
                  Đóng
                </button>
                <button
                  type="button"
                  onClick={handleExecuteUpload}
                  disabled={uploading || previewRows.length === 0}
                  className="inline-flex items-center gap-1.5 rounded bg-sky-600 hover:bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {uploading ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Check size={13} />
                  )}
                  Xác nhận Tải lên & Cập nhật ({previewRows.length})
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}

      {/* MODAL XÁC NHẬN XÓA (Standard GEMINI.md) */}
      {deletingRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-in fade-in-50">
          <div className="w-full max-w-md border border-slate-400 bg-white shadow-2xl">
            <header className="bg-[#14263d] px-3 py-2 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trash2 size={17} className="text-red-500" />
                <h2 className="text-xs font-bold uppercase tracking-wide text-white">
                  Xác Nhận Xóa Mã Sản Phẩm NPP
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setDeletingRow(null)}
                className="rounded p-1 text-white hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </header>

            <div className="p-3.5 space-y-2 text-xs text-slate-700">
              {deleteError && (
                <div className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800 flex items-center gap-2">
                  <AlertTriangle size={14} className="shrink-0 text-red-600" />
                  <span>{deleteError}</span>
                </div>
              )}

              <p>
                Bạn có chắc chắn muốn xóa mã sản phẩm NPP <strong>{deletingRow.distributor_sku}</strong> không?
              </p>
              <div className="rounded bg-slate-100 p-2 text-[11px] space-y-1">
                <div>
                  <span className="text-slate-500">Tên SP:</span> <strong>{deletingRow.distributor_product_name}</strong>
                </div>
                <div>
                  <span className="text-slate-500">Nhà phân phối:</span> {deletingRow.distributor_name}
                </div>
                <div>
                  <span className="text-slate-500">Công ty QL:</span>{" "}
                  {deletingRow.company_name || <em className="text-amber-600">Chưa gán</em>}
                </div>
              </div>
            </div>

            <footer className="border-t border-slate-300 bg-slate-100 px-3 py-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeletingRow(null)}
                className="rounded border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleting}
                className="inline-flex items-center gap-1.5 rounded bg-red-700 hover:bg-red-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-50"
              >
                {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                Xác nhận Xóa
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

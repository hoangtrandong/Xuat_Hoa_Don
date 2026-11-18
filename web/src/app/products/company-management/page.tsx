"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Building2,
  Search,
  X,
  Loader2,
  FileSpreadsheet,
  Layers,
  ArrowRight,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Truck,
  Pencil,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Upload,
  Download,
} from "lucide-react";
import * as XLSX from "xlsx";
import { API_URL, apiFetch } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { downloadExcel } from "@/lib/excel";

const inputCls =
  "w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-100";

type CompanyAssignment = {
  id: number;
  company_id: number;
  company_name: string;
  role: string;
  status: string;
  distributor_sku?: string | null;
  distributor_name?: string | null;
};

type ProductCompanyRow = {
  product_group_id: number;
  group_name: string;
  representative_sku: string;
  representative_name: string;
  member_skus: string[];
  member_names: string[];
  companies: CompanyAssignment[];
  supplier?: string | null;
  order_count?: number;
  total_ordered_qty?: number;
  unit_price?: number;
  unit?: string | null;
};

type ExcelPreviewRow = {
  code: string;
  name: string;
  unit: string;
  supplier: string;
  distributor: string;
};

export default function ProductCompanyManagementPage() {
  const [rows, setRows] = useState<ProductCompanyRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [supplierFilter, setSupplierFilter] = useState<string>("ALL");
  const [pageSize, setPageSize] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [error, setError] = useState<string>("");
  const [toastMessage, setToastMessage] = useState<string>("");

  // State Chỉnh sửa
  const [editingRow, setEditingRow] = useState<ProductCompanyRow | null>(null);
  const [editOrigCode, setEditOrigCode] = useState<string>("");
  const [editNewCode, setEditNewCode] = useState<string>("");
  const [editName, setEditName] = useState<string>("");
  const [editUnit, setEditUnit] = useState<string>("");
  const [savingEdit, setSavingEdit] = useState<boolean>(false);
  const [editError, setEditError] = useState<string>("");

  // State Xóa
  const [deletingRow, setDeletingRow] = useState<ProductCompanyRow | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string>("");

  // State Upload Excel
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
      const res = await apiFetch(`${API_URL}/product-groups/products/company-links`);
      if (!res.ok) throw new Error("Không thể tải danh sách mã sản phẩm từ web NCC.");
      const data = (await res.json()) as ProductCompanyRow[];
      setRows(data);
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
      const dmsCode = (row.companies[0]?.distributor_sku || row.member_skus[0] || "").toLowerCase();
      const dmsName = (row.companies[0]?.distributor_name || row.group_name || "").toLowerCase();
      const supplier = (row.supplier || "").toLowerCase();
      const compName = (row.companies[0]?.company_name || "").toLowerCase();

      if (supplierFilter !== "ALL" && (row.supplier || "Vinamilk") !== supplierFilter) return false;

      if (q) {
        const match =
          dmsCode.includes(q) ||
          dmsName.includes(q) ||
          supplier.includes(q) ||
          compName.includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [rows, searchQuery, supplierFilter]);

  // Thống kê KPI
  const stats = useMemo(() => {
    const distributors = new Set<string>();
    const suppliers = new Set<string>();

    for (const r of rows) {
      const compName = r.companies[0]?.company_name;
      if (compName) distributors.add(compName);
      if (r.supplier) suppliers.add(r.supplier);
    }

    return {
      total: rows.length,
      distributorCount: distributors.size || 1,
      supplierCount: suppliers.size || 1,
    };
  }, [rows]);

  // Phân trang
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pagedRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, safePage, pageSize]);

  // Mở modal sửa
  function openEditModal(row: ProductCompanyRow) {
    const code = row.companies[0]?.distributor_sku || row.member_skus[0] || "";
    const name = row.companies[0]?.distributor_name || row.group_name || "";
    setEditingRow(row);
    setEditOrigCode(code);
    setEditNewCode(code);
    setEditName(name);
    setEditUnit(row.unit || "HOP");
    setEditError("");
  }

  // Lưu chỉnh sửa
  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editNewCode.trim()) {
      setEditError("Mã sản phẩm NPP không được để trống.");
      return;
    }
    setSavingEdit(true);
    setEditError("");
    try {
      const res = await apiFetch(`${API_URL}/product-groups/distributor-products`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          original_code: editOrigCode,
          new_code: editNewCode.trim().toUpperCase(),
          distributor_name: editName.trim() || null,
          unit: editUnit.trim().toUpperCase() || null,
          supplier: editingRow?.supplier || "Vinamilk",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Không thể cập nhật mã sản phẩm NPP.");

      setToastMessage(data.message || "Cập nhật mã sản phẩm NPP thành công.");
      setTimeout(() => setToastMessage(""), 3500);
      setEditingRow(null);
      await loadData();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Lỗi khi lưu thông tin.");
    } finally {
      setSavingEdit(false);
    }
  }

  // Mở modal xóa
  function openDeleteModal(row: ProductCompanyRow) {
    setDeletingRow(row);
    setDeleteError("");
  }

  // Thực hiện xóa
  async function handleConfirmDelete() {
    if (!deletingRow) return;
    const code = deletingRow.companies[0]?.distributor_sku || deletingRow.member_skus[0] || "";
    if (!code) return;

    setDeleting(true);
    setDeleteError("");
    try {
      const res = await apiFetch(`${API_URL}/product-groups/distributor-products/${encodeURIComponent(code)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Không thể xóa mã sản phẩm NPP.");

      setToastMessage(data.message || `Đã xóa mã sản phẩm '${code}' thành công.`);
      setTimeout(() => setToastMessage(""), 3500);
      setDeletingRow(null);
      await loadData();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Lỗi khi xóa mã sản phẩm.");
    } finally {
      setDeleting(false);
    }
  }

  // Xử lý khi chọn file Excel upload
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setUploadError("");
    setPreviewRows([]);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const wb = XLSX.read(arrayBuffer, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });

      if (jsonData.length < 2) {
        setUploadError("File Excel không có dữ liệu để xử lý.");
        return;
      }

      const headers = (jsonData[0] || []).map((h) => String(h || "").trim().toLowerCase());
      let codeIdx = -1;
      let nameIdx = -1;
      let unitIdx = -1;
      let supplierIdx = -1;
      let distIdx = -1;

      headers.forEach((h, idx) => {
        if (h.includes("mã") || h.includes("code") || h.includes("sku")) codeIdx = idx;
        else if (h.includes("tên") || h.includes("name") || h.includes("sản phẩm")) nameIdx = idx;
        else if (h.includes("đvt") || h.includes("unit") || h.includes("dvt")) unitIdx = idx;
        else if (h.includes("cung cấp") || h.includes("supplier") || h.includes("ncc")) supplierIdx = idx;
        else if (h.includes("phân phối") || h.includes("distributor") || h.includes("npp")) distIdx = idx;
      });

      if (codeIdx === -1) codeIdx = 0;

      const parsed: ExcelPreviewRow[] = [];
      for (let i = 1; i < jsonData.length; i++) {
        const row = jsonData[i];
        if (!row || row.length === 0) continue;
        const c = String(row[codeIdx] || "").trim().toUpperCase();
        if (!c) continue;
        const n = nameIdx !== -1 && row[nameIdx] ? String(row[nameIdx]).trim() : `Sản phẩm ${c}`;
        const u = unitIdx !== -1 && row[unitIdx] ? String(row[unitIdx]).trim().toUpperCase() : "HOP";
        const s = supplierIdx !== -1 && row[supplierIdx] ? String(row[supplierIdx]).trim() : "Vinamilk";
        const d = distIdx !== -1 && row[distIdx] ? String(row[distIdx]).trim() : "Nhà Phân Phối Mai Gold";
        parsed.push({ code: c, name: n, unit: u, supplier: s, distributor: d });
      }

      if (parsed.length === 0) {
        setUploadError("Không tìm thấy dòng mã sản phẩm hợp lệ nào trong file.");
      } else {
        setPreviewRows(parsed);
      }
    } catch (err) {
      setUploadError("Không thể đọc nội dung file Excel: " + (err instanceof Error ? err.message : ""));
    }
  }

  // Gửi file lên backend
  async function handleSubmitUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFile) {
      setUploadError("Vui lòng chọn một file Excel (.xlsx, .xls).");
      return;
    }

    setUploading(true);
    setUploadError("");

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const res = await fetch(`${API_URL}/product-groups/distributor-products/upload`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Tải lên file không thành công.");
      }

      setToastMessage(data.message || `Đã thêm thành công ${data.added || previewRows.length} mã sản phẩm NPP.`);
      setTimeout(() => setToastMessage(""), 4500);
      setShowUploadModal(false);
      setSelectedFile(null);
      setPreviewRows([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadData();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Lỗi khi tải file lên server.");
    } finally {
      setUploading(false);
    }
  }

  // Tải file Excel mẫu
  function handleDownloadTemplate() {
    const templateRows = [
      {
        "Mã SP NPP": "01TD03",
        "Tên sản phẩm": "Sữa tươi tiệt trùng có đường 180ml",
        "ĐVT": "HOP",
        "Nhà cung cấp": "Vinamilk",
        "Nhà phân phối": "Nhà Phân Phối Mai Gold",
      },
      {
        "Mã SP NPP": "07KD12",
        "Tên sản phẩm": "Sữa chua ăn lựu đỏ 100g",
        "ĐVT": "HOP",
        "Nhà cung cấp": "Vinamilk",
        "Nhà phân phối": "Nhà Phân Phối Mai Gold",
      },
      {
        "Mã SP NPP": "01SX11",
        "Tên sản phẩm": "Sữa dinh dưỡng Optimum Gold 110ml",
        "ĐVT": "HOP",
        "Nhà cung cấp": "Vinamilk",
        "Nhà phân phối": "Nhà Phân Phối Mai Gold",
      },
    ];
    downloadExcel(templateRows, "mau-danh-sach-ma-sp-npp");
  }

  function handleExportExcel() {
    if (filteredRows.length === 0) return;
    const excelData = filteredRows.map((r, idx) => {
      const dmsCode = r.companies[0]?.distributor_sku || r.member_skus[0] || "";
      const dmsName = r.companies[0]?.distributor_name || r.group_name || "";
      return {
        STT: idx + 1,
        "Nhà phân phối": r.companies[0]?.company_name || "Nhà Phân Phối Mai Gold",
        "Mã SP Web NCC (Mã NPP)": dmsCode,
        "Tên SP theo Web NCC": dmsName,
        "Nhà cung cấp": r.supplier || "Vinamilk",
        "ĐVT": r.unit || "HOP",
      };
    });
    downloadExcel(excelData, `Quan_ly_ma_NPP_noi_bo_${new Date().toISOString().slice(0, 10)}`);
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
            <div>
              <span className="text-xs font-bold uppercase tracking-wide text-white">
                Quản Lý Mã Sản Phẩm Nhà Phân Phối Nội Bộ
              </span>
              <span className="ml-2 text-[10px] text-sky-200">
                (Đồng bộ từ Đơn hàng Web NCC hoặc Upload danh mục nội bộ)
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/products"
              className="inline-flex items-center gap-1 rounded bg-white/10 hover:bg-white/20 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors"
            >
              <ArrowRight size={12} />
              Sang Danh sách SKU (CQT)
            </Link>

            <button
              type="button"
              onClick={handleDownloadTemplate}
              className="inline-flex items-center gap-1 rounded bg-white/10 hover:bg-white/20 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors"
              title="Tải file Excel mẫu để nhập danh sách mã SP NPP"
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
              title="Upload file Excel để thêm danh sách mã sản phẩm NPP"
            >
              <Upload size={12} />
              Tải lên Excel
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
              onClick={loadData}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded bg-sky-600 hover:bg-sky-700 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors disabled:bg-slate-500"
            >
              {loading ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
              Làm mới
            </button>
          </div>
        </header>

        {/* 2. THANH CHỈ SỐ NGHIỆP VỤ (COMPACT KPI STRIP) */}
        <section className="border-b border-slate-200 bg-slate-50/90 px-3 py-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="flex items-center justify-between rounded border border-slate-300 bg-white px-2.5 py-1.5">
              <div>
                <p className="text-[10px] font-semibold uppercase text-slate-500">
                  Mã SP từ Web NCC
                </p>
                <p className="text-sm font-bold text-sky-900">
                  {formatNumber(stats.total)}{" "}
                  <span className="text-[10px] font-normal text-slate-500">mã hàng</span>
                </p>
              </div>
              <Layers size={16} className="text-sky-700" />
            </div>

            <div className="flex items-center justify-between rounded border border-slate-300 bg-white px-2.5 py-1.5">
              <div>
                <p className="text-[10px] font-semibold uppercase text-slate-500">
                  Nhà Phân Phối
                </p>
                <p className="text-sm font-bold text-indigo-900">
                  {formatNumber(stats.distributorCount)}{" "}
                  <span className="text-[10px] font-normal text-slate-500">đơn vị</span>
                </p>
              </div>
              <Building2 size={16} className="text-indigo-600" />
            </div>

            <div className="flex items-center justify-between rounded border border-slate-300 bg-white px-2.5 py-1.5">
              <div>
                <p className="text-[10px] font-semibold uppercase text-slate-500">
                  Nhà Cung Cấp
                </p>
                <p className="text-sm font-bold text-emerald-800">
                  {formatNumber(stats.supplierCount)}{" "}
                  <span className="text-[10px] font-normal text-slate-500">đơn vị</span>
                </p>
              </div>
              <Truck size={16} className="text-emerald-600" />
            </div>
          </div>
        </section>

        {/* 3. BỘ LỌC TRA CỨU */}
        <section className="border-b border-slate-200 px-3 py-2">
          <div className="grid gap-x-3 gap-y-2 sm:grid-cols-3 xl:grid-cols-4">
            <div className="sm:col-span-2 xl:col-span-3">
              <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                Tìm kiếm Mã SP Web NCC / Tên sản phẩm / Nhà phân phối
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
                  placeholder="Nhập mã sản phẩm web NCC (VD: 01TD03, 07KD12, 01SX11) hoặc tên hàng, nhà phân phối..."
                  className={`${inputCls} pl-7 pr-6`}
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
                Nhà cung cấp
              </label>
              <select
                value={supplierFilter}
                onChange={(e) => setSupplierFilter(e.target.value)}
                className={inputCls}
              >
                <option value="ALL">Tất cả Nhà cung cấp</option>
                <option value="Vinamilk">Vinamilk</option>
                <option value="FrieslandCampina">FrieslandCampina</option>
                <option value="KiotViet">KiotViet</option>
              </select>
            </div>
          </div>
        </section>

        {/* 4. BẢNG DỮ LIỆU MÃ SẢN PHẨM WEB NCC (MÃ NPP NỘI BỘ) */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600 uppercase">
              <tr className="border-b border-slate-300">
                <th className="w-10 px-2 py-2 text-center">STT</th>
                <th className="px-2.5 py-2">Nhà phân phối</th>
                <th className="px-2.5 py-2">Mã SP Web NCC (Mã NPP)</th>
                <th className="px-2.5 py-2">Tên sản phẩm theo Web NCC</th>
                <th className="px-2.5 py-2">Nhà cung cấp</th>
                <th className="px-2.5 py-2 text-center">ĐVT</th>
                <th className="w-24 px-2 py-2 text-center">Thao tác</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-xs text-slate-500">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 size={15} className="animate-spin text-sky-600" />
                      Đang tải danh sách mã sản phẩm đồng bộ từ web nhà cung cấp...
                    </span>
                  </td>
                </tr>
              ) : pagedRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-xs text-slate-500">
                    {error || "Không có mã sản phẩm nào khớp với điều kiện lọc hiện tại."}
                  </td>
                </tr>
              ) : (
                pagedRows.map((row, idx) => {
                  const stt = (safePage - 1) * pageSize + idx + 1;
                  const dmsCode = row.companies[0]?.distributor_sku || row.member_skus[0] || "—";
                  const dmsName = row.companies[0]?.distributor_name || row.group_name || "—";
                  const compName = row.companies[0]?.company_name || "Nhà Phân Phối Mai Gold";

                  return (
                    <tr
                      key={row.product_group_id || idx}
                      className="border-b border-slate-100 even:bg-amber-50/40 hover:bg-sky-50/50 text-[11px] transition-colors"
                    >
                      <td className="px-2 py-1.5 text-center font-medium text-slate-500">
                        {stt}
                      </td>

                      <td className="px-2.5 py-1.5 whitespace-nowrap">
                        <span className="inline-block rounded border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-800">
                          {compName}
                        </span>
                      </td>

                      <td className="px-2.5 py-1.5 whitespace-nowrap font-mono font-bold text-sky-800">
                        <span className="rounded bg-sky-50 border border-sky-300 px-1.5 py-0.5">
                          {dmsCode}
                        </span>
                      </td>

                      <td className="px-2.5 py-1.5 font-medium text-slate-800">
                        {dmsName}
                      </td>

                      <td className="px-2.5 py-1.5 whitespace-nowrap">
                        <span className="inline-block rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                          {row.supplier || "Vinamilk"}
                        </span>
                      </td>

                      <td className="px-2.5 py-1.5 text-center font-semibold text-slate-700">
                        {row.unit || "HOP"}
                      </td>

                      <td className="px-2 py-1.5 text-center whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEditModal(row)}
                            className="inline-flex items-center gap-1 rounded bg-sky-600 hover:bg-sky-700 px-2 py-1 text-[10px] font-semibold text-white transition-colors"
                            title="Chỉnh sửa thông tin mã NPP"
                          >
                            <Pencil size={11} />
                            Sửa
                          </button>
                          <button
                            type="button"
                            onClick={() => openDeleteModal(row)}
                            className="inline-flex items-center gap-1 rounded bg-red-600 hover:bg-red-700 px-2 py-1 text-[10px] font-semibold text-white transition-colors"
                            title="Xóa mã NPP khỏi danh mục"
                          >
                            <Trash2 size={11} />
                            Xóa
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
        <div className="border-t border-slate-300 bg-slate-100 px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="text-slate-600 text-[11px]">
            Hiển thị <strong>{filteredRows.length > 0 ? (safePage - 1) * pageSize + 1 : 0}</strong> -{" "}
            <strong>{Math.min(safePage * pageSize, filteredRows.length)}</strong> trên tổng số{" "}
            <strong>{formatNumber(filteredRows.length)}</strong> mã sản phẩm từ web NCC
          </div>

          <div className="flex items-center gap-2">
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
            >
              <option value={20}>20 dòng / trang</option>
              <option value={50}>50 dòng / trang</option>
              <option value={100}>100 dòng / trang</option>
            </select>

            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="rounded border border-slate-300 bg-white p-1 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="px-2 text-xs font-semibold text-slate-700">
                {safePage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="rounded border border-slate-300 bg-white p-1 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* MODAL: TẢI LÊN EXCEL THÊM DANH SÁCH MÃ SP NPP                         */}
      {/* ===================================================================== */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={handleSubmitUpload}
            className="w-full max-w-2xl border border-slate-400 bg-white shadow-xl animate-in fade-in-50 zoom-in-95"
          >
            {/* Header Modal */}
            <div className="bg-[#14263d] px-3 py-2 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Upload size={17} className="text-emerald-400" />
                <span className="text-xs font-bold uppercase tracking-wide text-white">
                  Tải Lên Danh Sách Mã Sản Phẩm NPP (Excel)
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

            {/* Body */}
            <div className="border-b border-slate-200 px-4 py-3 space-y-3">
              {uploadError && (
                <div className="rounded border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs text-red-700 flex items-center gap-1.5">
                  <AlertTriangle size={14} className="shrink-0" />
                  <span>{uploadError}</span>
                </div>
              )}

              {/* Hướng dẫn và Nút tải mẫu */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-sky-200 bg-sky-50/70 p-2.5 text-xs">
                <div>
                  <p className="font-semibold text-sky-900">
                    Quy chuẩn file Excel:
                  </p>
                  <p className="text-[11px] text-slate-600">
                    Cột: <strong>Mã SP NPP</strong>, <strong>Tên sản phẩm</strong>, <strong>ĐVT</strong>, <strong>Nhà cung cấp</strong>, <strong>Nhà phân phối</strong>.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleDownloadTemplate}
                  className="inline-flex items-center gap-1 rounded border border-sky-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-sky-800 hover:bg-sky-50 shadow-sm"
                >
                  <Download size={12} />
                  Tải file Excel mẫu
                </button>
              </div>

              {/* Ô chọn file */}
              <div>
                <label className="text-[10px] font-semibold text-slate-600 block mb-1">
                  Chọn file dữ liệu Excel (.xlsx, .xls) <span className="text-red-500">*</span>
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx, .xls, .xlsm"
                  onChange={handleFileChange}
                  className="w-full text-xs text-slate-700 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-sky-50 file:text-sky-700 hover:file:bg-sky-100 cursor-pointer border border-dashed border-slate-300 p-2 rounded bg-slate-50"
                  required
                />
              </div>

              {/* Preview Bảng dữ liệu */}
              {previewRows.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-700">
                      Xem trước dữ liệu ({previewRows.length} mã sản phẩm được nhận diện):
                    </span>
                    <span className="text-[10px] text-slate-500">
                      Hiển thị tối đa 5 dòng đầu
                    </span>
                  </div>

                  <div className="max-h-48 overflow-y-auto border border-slate-200 rounded">
                    <table className="w-full border-collapse text-left text-[11px]">
                      <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600 sticky top-0">
                        <tr className="border-b border-slate-200">
                          <th className="px-2 py-1 text-center w-8">#</th>
                          <th className="px-2 py-1">Mã SP NPP</th>
                          <th className="px-2 py-1">Tên sản phẩm</th>
                          <th className="px-2 py-1 text-center">ĐVT</th>
                          <th className="px-2 py-1">Nhà cung cấp</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.slice(0, 5).map((row, i) => (
                          <tr key={i} className="border-b border-slate-100 even:bg-slate-50">
                            <td className="px-2 py-1 text-center text-slate-400">{i + 1}</td>
                            <td className="px-2 py-1 font-mono font-bold text-sky-800">{row.code}</td>
                            <td className="px-2 py-1 text-slate-800 truncate max-w-xs">{row.name}</td>
                            <td className="px-2 py-1 text-center">{row.unit}</td>
                            <td className="px-2 py-1 text-slate-600">{row.supplier}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Footer Action Bar */}
            <div className="border-t border-slate-300 bg-slate-100 px-3 py-2 flex items-center justify-between gap-3">
              <span className="text-[10px] text-slate-500">
                {previewRows.length > 0
                  ? `Sẵn sàng nạp ${previewRows.length} mã vào danh mục nội bộ.`
                  : "Vui lòng chọn file Excel để bắt đầu."}
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
                  type="submit"
                  disabled={uploading || previewRows.length === 0}
                  className="inline-flex items-center gap-1.5 rounded bg-sky-600 hover:bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {uploading ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Upload size={13} />
                  )}
                  {uploading ? "Đang xử lý..." : `Xác nhận tải lên (${previewRows.length})`}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: CHỈNH SỬA MÃ SẢN PHẨM NPP NỘI BỘ (CreateOrderForm Standard)      */}
      {/* ===================================================================== */}
      {editingRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={handleSaveEdit}
            className="w-full max-w-lg border border-slate-400 bg-white shadow-lg animate-in fade-in-50 zoom-in-95"
          >
            {/* Header Modal */}
            <div className="bg-[#14263d] px-3 py-2 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Pencil size={17} className="text-sky-400" />
                <span className="text-xs font-bold uppercase tracking-wide text-white">
                  Chỉnh Sửa Mã Sản Phẩm NPP Nội Bộ
                </span>
              </div>
              <button
                type="button"
                onClick={() => setEditingRow(null)}
                className="rounded p-1 text-white hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="border-b border-slate-200 px-3 py-3 space-y-3">
              {editError && (
                <div className="rounded border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs text-red-700 flex items-center gap-1.5">
                  <AlertTriangle size={14} />
                  <span>{editError}</span>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                    Mã SP NPP (Mã Web NCC) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={editNewCode}
                    onChange={(e) => setEditNewCode(e.target.value.toUpperCase())}
                    className={`${inputCls} font-mono font-bold text-sky-800`}
                    placeholder="VD: 01TD03..."
                    required
                  />
                  <span className="text-[9px] text-slate-500 mt-0.5 block">
                    Mã gốc: <strong className="font-mono">{editOrigCode}</strong>
                  </span>
                </div>

                <div>
                  <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                    Đơn vị tính (ĐVT)
                  </label>
                  <input
                    type="text"
                    value={editUnit}
                    onChange={(e) => setEditUnit(e.target.value.toUpperCase())}
                    className={inputCls}
                    placeholder="VD: HOP, THUNG, CHAI..."
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                  Tên sản phẩm theo Web NCC (hoặc NPP)
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className={inputCls}
                  placeholder="Nhập tên sản phẩm..."
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2 text-xs bg-slate-50 p-2 rounded border border-slate-200">
                <div>
                  <span className="text-[10px] text-slate-500 block">Nhà cung cấp</span>
                  <span className="font-semibold text-slate-700">
                    {editingRow.supplier || "Vinamilk"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">Nhà phân phối</span>
                  <span className="font-semibold text-indigo-700">
                    {editingRow.companies[0]?.company_name || "Nhà Phân Phối Mai Gold"}
                  </span>
                </div>
              </div>
            </div>

            {/* Footer Action Bar */}
            <div className="border-t border-slate-300 bg-slate-100 px-3 py-2 flex items-center justify-between gap-3">
              <span className="text-[10px] text-slate-500">
                Cập nhật thông tin mã NPP trên toàn hệ thống nội bộ.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditingRow(null)}
                  className="rounded bg-red-700 hover:bg-red-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
                >
                  Đóng
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
            </div>
          </form>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: XÁC NHẬN XÓA MÃ SẢN PHẨM NPP                                   */}
      {/* ===================================================================== */}
      {deletingRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md border border-slate-400 bg-white shadow-lg animate-in fade-in-50 zoom-in-95">
            {/* Header Modal */}
            <div className="bg-[#14263d] px-3 py-2 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trash2 size={17} className="text-red-500" />
                <span className="text-xs font-bold uppercase tracking-wide text-white">
                  Xác Nhận Xóa Mã Sản Phẩm NPP
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

            {/* Body */}
            <div className="border-b border-slate-200 px-4 py-3 space-y-2">
              {deleteError && (
                <div className="rounded border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs text-red-700 flex items-center gap-1.5">
                  <AlertTriangle size={14} />
                  <span>{deleteError}</span>
                </div>
              )}

              <p className="text-xs text-slate-700 leading-relaxed">
                Bạn có chắc chắn muốn xóa mã sản phẩm này khỏi danh mục NPP nội bộ?
              </p>

              <div className="rounded border border-red-200 bg-red-50/60 p-2.5 text-xs">
                <p className="font-semibold text-red-900">
                  Mã SP NPP:{" "}
                  <span className="font-mono font-bold text-red-700">
                    {deletingRow.companies[0]?.distributor_sku || deletingRow.member_skus[0]}
                  </span>
                </p>
                <p className="text-slate-700 mt-0.5">
                  Tên sản phẩm:{" "}
                  <strong>{deletingRow.companies[0]?.distributor_name || deletingRow.group_name}</strong>
                </p>
                <p className="text-slate-500 text-[10px] mt-0.5">
                  Nhà cung cấp: {deletingRow.supplier || "Vinamilk"} · ĐVT: {deletingRow.unit || "HOP"}
                </p>
              </div>

              <p className="text-[10px] text-amber-700 italic">
                * Hành động này sẽ gỡ mã sản phẩm này khỏi danh mục nội bộ và hủy các liên kết mã tương ứng.
              </p>
            </div>

            {/* Footer Action Bar */}
            <div className="border-t border-slate-300 bg-slate-100 px-3 py-2 flex items-center justify-between gap-3">
              <span className="text-[10px] text-slate-500">
                Thao tác không thể hoàn tác.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDeletingRow(null)}
                  className="rounded bg-slate-200 hover:bg-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors"
                >
                  Hủy bỏ
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  disabled={deleting}
                  className="inline-flex items-center gap-1.5 rounded bg-red-700 hover:bg-red-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {deleting ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Trash2 size={13} />
                  )}
                  Xác nhận xóa
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

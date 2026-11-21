"use client";
// src/app/customers/companies/page.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2, CheckCircle2, Users, ShieldAlert, Plus, Download, Upload,
  Phone, MapPin, Hash, CreditCard, Loader2, X, FileSpreadsheet, RefreshCw, FileText,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import AuthenticatedDownloadLink from "@/components/ui/AuthenticatedDownloadLink";
import StatCard from "@/components/ui/StatCard";
import DataTable, { Column } from "@/components/ui/DataTable";
import Badge from "@/components/ui/Badge";
import Drawer from "@/components/ui/Drawer";
import { API_URL, apiFetch } from "@/lib/api";
import { getInitials } from "@/lib/format";
import { useDistributorContext } from "@/lib/distributor-context";

interface CompanyRow {
  id: string;
  distributor_id: number | null;
  distributor_code: string;
  distributor_name: string;
  code: string;
  name: string;
  short_name: string;
  tax_code: string;
  phone: string;
  address: string;
  invoice_item_mode: "TAX_INPUT" | "INTERNAL";
  sync_source: "MANUAL" | "GDT_CQT";
  status: "active" | "inactive";
  customer_count: number;
  created_at: string;
  shared?: boolean;
}

const emptyForm = {
  distributor_id: "",
  code: "",
  name: "",
  short_name: "",
  tax_code: "",
  phone: "",
  address: "",
  invoice_item_mode: "TAX_INPUT" as "TAX_INPUT" | "INTERNAL",
  status: "active",
};

const inputCls =
  "w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-100";

export default function CompaniesPage() {
  const router = useRouter();
  const {
    distributors,
    effectiveDistributorId,
    effectiveDistributor,
    isSuperAdmin,
    isAllDistributorsMode,
  } = useDistributorContext();

  const [rows, setRows] = useState<CompanyRow[]>([]);
  const [selected, setSelected] = useState<CompanyRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingSyncSource, setEditingSyncSource] = useState<"MANUAL" | "GDT_CQT">("MANUAL");
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [syncingCqt, setSyncingCqt] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  // Upload Excel Modal state (đảm bảo kế toán luôn biết rõ đang nhập vào NPP nào)
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadDistId, setUploadDistId] = useState<string>("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams({ limit: "5000" });
    if (effectiveDistributorId !== null) {
      params.set("distributor_id", String(effectiveDistributorId));
    }
    apiFetch(`${API_URL}/companies/?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Array<Record<string, unknown>>) => {
        const base: Array<Omit<CompanyRow, "shared">> = list.map((row) => ({
          id: String(row.id),
          distributor_id: row.distributor_id != null ? Number(row.distributor_id) : null,
          distributor_code: String(row.distributor_code ?? ""),
          distributor_name: String(row.distributor_name ?? ""),
          code: String(row.code ?? ""),
          name: String(row.name ?? ""),
          short_name: String(row.short_name ?? ""),
          tax_code: String(row.tax_code ?? ""),
          phone: String(row.phone ?? ""),
          address: String(row.address ?? ""),
          invoice_item_mode: (row.invoice_item_mode === "INTERNAL" ? "INTERNAL" : "TAX_INPUT") as CompanyRow["invoice_item_mode"],
          sync_source: (row.sync_source === "GDT_CQT" ? "GDT_CQT" : "MANUAL") as CompanyRow["sync_source"],
          status: (row.status === "inactive" ? "inactive" : "active") as CompanyRow["status"],
          customer_count: Number(row.customer_count ?? 0),
          created_at: String(row.created_at ?? ""),
        }));
        const counts: Record<string, number> = {};
        base.forEach((c) => {
          if (c.tax_code) {
            const key = `${c.distributor_id ?? "none"}::${c.tax_code}`;
            counts[key] = (counts[key] ?? 0) + 1;
          }
        });
        setRows(
          base.map((c) => {
            const key = `${c.distributor_id ?? "none"}::${c.tax_code}`;
            return { ...c, shared: Boolean(c.tax_code && (counts[key] ?? 0) > 1) };
          }),
        );
      })
      .catch(() => setError("Không thể tải danh sách công ty quản lý."));
  }, [effectiveDistributorId]);

  useEffect(() => {
    load();
  }, [load]);

  async function syncFromCqt() {
    setError("");
    setMessage("");
    setSyncingCqt(true);
    try {
      const qs = effectiveDistributorId !== null ? `?distributor_id=${effectiveDistributorId}` : "";
      const response = await apiFetch(`${API_URL}/companies/sync-from-cqt${qs}`, {
        method: "POST",
      });
      const result = (await response.json()) as {
        companies_created?: number;
        companies_updated?: number;
        sku_links_upserted?: number;
        detail?: string;
      };
      if (!response.ok) throw new Error(result.detail ?? "Không thể đồng bộ từ Hóa đơn CQT.");
      setMessage(
        `Đã đồng bộ từ HĐĐT CQT: +${result.companies_created ?? 0} công ty mới, cập nhật ${result.companies_updated ?? 0} công ty, liên kết ${result.sku_links_upserted ?? 0} SKU.`,
      );
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể đồng bộ từ Hóa đơn CQT.");
    } finally {
      setSyncingCqt(false);
    }
  }

  function openUploadModal() {
    setUploadError("");
    setUploadFile(null);
    setUploadDistId(effectiveDistributorId !== null ? String(effectiveDistributorId) : "");
    setUploadOpen(true);
  }

  async function submitUploadCompanies() {
    setUploadError("");
    const targetDistId = effectiveDistributorId !== null
      ? effectiveDistributorId
      : uploadDistId
        ? Number(uploadDistId)
        : null;
    if (!targetDistId) {
      setUploadError("Vui lòng chọn Nhà phân phối cần nhập danh sách công ty.");
      return;
    }
    if (!uploadFile) {
      setUploadError("Vui lòng chọn file Excel (.xlsx hoặc .xlsm).");
      return;
    }
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", uploadFile);
      const response = await apiFetch(
        `${API_URL}/companies/upload?distributor_id=${targetDistId}`,
        { method: "POST", body },
      );
      const result = (await response.json()) as { imported?: number; detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "Không thể nhập file công ty.");
      const distLabel = distributors.find((d) => d.id === targetDistId)?.name || `NPP #${targetDistId}`;
      setMessage(`Đã nhập ${result.imported ?? 0} công ty vào ${distLabel}.`);
      setUploadOpen(false);
      load();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Không thể tải file Excel.");
    } finally {
      setUploading(false);
    }
  }

  async function saveCompany() {
    setError("");
    setMessage("");
    const targetDistId = isSuperAdmin
      ? (form.distributor_id ? Number(form.distributor_id) : null)
      : effectiveDistributorId;
    if (!targetDistId) {
      setError("Vui lòng chọn Nhà phân phối sở hữu công ty quản lý này.");
      return;
    }
    setSaving(true);
    try {
      const response = await apiFetch(`${API_URL}/companies/${editingId ? editingId : ""}`, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          distributor_id: targetDistId,
          status: form.status || "active",
        }),
      });
      const result = (await response.json()) as { detail?: string; code?: string; tax_code?: string | null };
      if (!response.ok) throw new Error(result.detail ?? "Không thể lưu công ty.");
      setMessage(editingId ? "Đã cập nhật công ty." : `Đã tạo công ty ${result.code}.`);
      setCreateOpen(false);
      setEditingId(null);
      setSelected(null);
      setError("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể lưu công ty.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteCompany(company: CompanyRow) {
    if (!window.confirm(`Xóa công ty ${company.name}? Các mã khách hàng sẽ không bị xóa.`)) return;
    const response = await apiFetch(`${API_URL}/companies/${company.id}`, { method: "DELETE" });
    const result = (await response.json().catch(() => ({}))) as { detail?: string };
    if (!response.ok) throw new Error(result.detail ?? "Không thể xóa công ty.");
    setRows((current) => current.filter((item) => item.id !== company.id));
    setSelected(null);
    setMessage("Đã xóa công ty quản lý.");
  }

  function openCreate() {
    setEditingId(null);
    setEditingSyncSource("MANUAL");
    setForm({
      ...emptyForm,
      distributor_id: effectiveDistributorId !== null ? String(effectiveDistributorId) : "",
    });
    setError("");
    setCreateOpen(true);
  }

  function openEdit(company: CompanyRow) {
    setEditingId(company.id);
    setEditingSyncSource(company.sync_source || "MANUAL");
    setForm({
      distributor_id: company.distributor_id != null
        ? String(company.distributor_id)
        : effectiveDistributorId !== null
          ? String(effectiveDistributorId)
          : "",
      code: company.code,
      name: company.name,
      short_name: company.short_name || "",
      tax_code: company.tax_code,
      phone: company.phone,
      address: company.address,
      invoice_item_mode: company.invoice_item_mode || "TAX_INPUT",
      status: company.status,
    });
    setError("");
    setCreateOpen(true);
  }

  const filteredRows = useMemo(() => {
    if (statusFilter === "ALL") return rows;
    return rows.filter((r) => r.status === statusFilter);
  }, [rows, statusFilter]);

  const activeCount = rows.filter((c) => c.status === "active").length;
  const sharedCount = rows.filter((c) => c.shared).length;
  const managedCodes = rows.reduce((sum, c) => sum + (c.customer_count || 0), 0);

  const columns = useMemo<Column<CompanyRow>[]>(() => {
    const cols: Column<CompanyRow>[] = [];
    if (isAllDistributorsMode) {
      cols.push({
        key: "distributor_code",
        title: "Nhà phân phối",
        sortable: true,
        render: (_, row) =>
          row.distributor_code ? (
            <div className="min-w-0">
              <span className="inline-flex items-center rounded bg-sky-50 border border-sky-200 px-1.5 py-0.5 text-[10px] font-mono font-bold text-sky-800">
                {row.distributor_code}
              </span>
              <p className="text-[11px] text-slate-500 truncate max-w-[180px]">{row.distributor_name}</p>
            </div>
          ) : (
            <Badge variant="warning">Chưa gán NPP</Badge>
          ),
      });
    }
    cols.push(
      { key: "code", title: "Mã công ty", sortable: true },
      {
        key: "name",
        title: "Tên công ty",
        sortable: true,
        render: (_, row) => (
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="truncate font-medium text-slate-800">{row.name}</span>
            {row.sync_source === "GDT_CQT" && (
              <span
                title="Đã xác thực & đồng bộ từ Hóa đơn điện tử CQT"
                className="shrink-0 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700"
              >
                CQT
              </span>
            )}
          </div>
        ),
      },
      {
        key: "tax_code",
        title: "Mã số thuế",
        render: (_, row) =>
          row.tax_code ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="text-gray-700 font-mono text-xs">{row.tax_code}</span>
              {row.shared && <Badge variant="warning">Dùng chung</Badge>}
            </span>
          ) : (
            <span className="text-gray-400">—</span>
          ),
      },
      {
        key: "invoice_item_mode",
        title: "Quy tắc xuất HĐ",
        sortable: true,
        render: (_, row) =>
          row.invoice_item_mode === "INTERNAL" ? (
            <Badge variant="info">Theo Mã nội bộ</Badge>
          ) : (
            <Badge variant="default">Theo Mã đầu vào CQT</Badge>
          ),
      },
      {
        key: "customer_count",
        title: "Số KH quản lý",
        align: "center",
        render: (val, row) => (
          <button
            type="button"
            title="Xem danh sách mã khách hàng thuộc công ty này"
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/customers?company_id=${row.id}`);
            }}
            className="hover:opacity-80 transition-opacity"
          >
            <Badge variant={(val as number) > 0 ? "info" : "default"}>{String(val)}</Badge>
          </button>
        ),
      },
      { key: "phone", title: "Điện thoại" },
      {
        key: "status",
        title: "Trạng thái",
        sortable: true,
        render: (val) =>
          val === "active" ? <Badge variant="success">Hoạt động</Badge> : <Badge variant="danger">Ngưng giao</Badge>,
      },
    );
    return cols;
  }, [isAllDistributorsMode, router]);

  const activeUploadDistributor = distributors.find(
    (d) => d.id === (effectiveDistributorId ?? (uploadDistId ? Number(uploadDistId) : null)),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Công ty quản lý"
        subtitle={
          effectiveDistributor
            ? `Danh sách công ty quản lý / xuất hóa đơn thuộc NPP [${effectiveDistributor.code}] ${effectiveDistributor.name}`
            : "Công ty xuất hóa đơn, công ty con phân tách theo từng Nhà phân phối — nhiều công ty có thể dùng chung một MST"
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={syncingCqt}
              onClick={() => void syncFromCqt()}
              className="flex items-center gap-2 bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-60"
            >
              {syncingCqt ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              Đồng bộ từ HĐĐT CQT
            </button>
            <AuthenticatedDownloadLink
              href={`${API_URL}/companies/template`}
              className="flex items-center gap-2 border border-gray-200 bg-white text-gray-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-50"
            >
              <Download size={16} />Tải mẫu Excel
            </AuthenticatedDownloadLink>
            <button
              onClick={openUploadModal}
              className="flex items-center gap-2 border border-gray-200 bg-white text-gray-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-50"
            >
              <Upload size={16} />Upload Excel
            </button>
            <button
              onClick={openCreate}
              className="flex items-center gap-2 border border-sky-300 bg-sky-50 hover:bg-sky-100 text-sky-800 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <Plus size={16} />Thêm thủ công
            </button>
          </div>
        }
      />

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>}
      {message && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg px-4 py-3 text-sm">{message}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Tổng công ty" value={rows.length} icon={<Building2 size={20} />} color="bg-sky-50 text-sky-600" />
        <StatCard label="Đang hoạt động" value={activeCount} icon={<CheckCircle2 size={20} />} color="bg-emerald-50 text-emerald-600" />
        <StatCard label="Công ty dùng chung MST" value={sharedCount} icon={<ShieldAlert size={20} />} color="bg-amber-50 text-amber-600" />
        <StatCard label="Mã KH đang quản lý" value={managedCodes} icon={<Users size={20} />} color="bg-purple-50 text-purple-600" />
      </div>

      <DataTable
        data={filteredRows}
        columns={columns}
        searchKeys={["code", "name", "tax_code", "phone", "address", "distributor_code", "distributor_name"]}
        searchPlaceholder="Tìm mã, tên công ty, MST, NPP..."
        onRowClick={(row) => setSelected(row)}
        emptyMessage="Chưa có công ty quản lý nào trong phạm vi Nhà phân phối này"
        toolbar={
          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-medium focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="ALL">Tất cả trạng thái</option>
              <option value="active">Hoạt động</option>
              <option value="inactive">Ngưng giao</option>
            </select>
            <button
              onClick={openCreate}
              className="flex items-center gap-2 bg-sky-600 hover:bg-sky-700 text-white px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors"
            >
              <Plus size={15} />Thêm công ty
            </button>
          </div>
        }
      />

      {/* Drawer Thêm/Sửa Công ty */}
      <Drawer open={createOpen} onClose={() => setCreateOpen(false)} title={editingId ? "Sửa công ty" : "Thêm công ty"} subtitle="Công ty quản lý / xuất hóa đơn theo Nhà phân phối">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void saveCompany();
          }}
          className="p-4 space-y-3"
        >
          {error && <div className="bg-red-50 text-red-700 rounded border border-red-200 px-3 py-2 text-xs">{error}</div>}

          <div>
            <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
              Nhà phân phối (Tenant) <span className="text-red-600">*</span>
            </label>
            {isSuperAdmin ? (
              <select
                required
                value={form.distributor_id}
                onChange={(e) => setForm({ ...form, distributor_id: e.target.value })}
                className={inputCls}
              >
                <option value="">— Chọn Nhà phân phối —</option>
                {distributors.map((d) => (
                  <option key={d.id} value={String(d.id)}>
                    [{d.code}] {d.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                disabled
                value={
                  effectiveDistributor
                    ? `[${effectiveDistributor.code}] ${effectiveDistributor.name}`
                    : "Nhà phân phối hiện tại"
                }
                className={inputCls}
              />
            )}
          </div>

          <div>
            <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
              Mã công ty <span className="text-red-600">*</span>
            </label>
            <input
              required
              disabled={Boolean(editingId)}
              placeholder="VD: CT001, CT002, 2902292227..."
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.trim() })}
              className={inputCls}
            />
            <span className="text-[10px] text-slate-400 mt-0.5 block">
              Mã định danh duy nhất trong phạm vi Nhà phân phối này
            </span>
          </div>

          {editingId && editingSyncSource === "GDT_CQT" && (
            <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
              <strong>Đã xác thực CQT:</strong> Tên pháp nhân và Mã số thuế được khóa theo dữ liệu Cơ quan Thuế. Bạn vẫn có thể cấu hình Tên rút gọn, Quy tắc xuất HĐ và thông tin liên hệ.
            </div>
          )}

          <div>
            <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
              Tên công ty quản lý <span className="text-red-600">*</span>
            </label>
            <input
              required
              disabled={Boolean(editingId) && editingSyncSource === "GDT_CQT"}
              placeholder="VD: Công ty TNHH Phân Phối Mai Gold"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputCls}
            />
          </div>

          <div>
            <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
              Mã số thuế (MST) <span className="text-red-600">*</span>
            </label>
            <input
              required
              disabled={Boolean(editingId) && editingSyncSource === "GDT_CQT"}
              placeholder="VD: 2902292227 (bắt buộc để khớp dữ liệu CQT)"
              value={form.tax_code}
              onChange={(e) => setForm({ ...form, tax_code: e.target.value.trim() })}
              className={inputCls}
            />
          </div>

          <div>
            <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
              Số điện thoại liên hệ
            </label>
            <input
              placeholder="VD: 0238 3123 456"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className={inputCls}
            />
          </div>

          <div>
            <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
              Địa chỉ kinh doanh / xuất hóa đơn
            </label>
            <input
              placeholder="VD: Khối 3, Thị trấn Đô Lương, Nghệ An"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className={inputCls}
            />
          </div>

          <div>
            <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
              Tên rút gọn hiển thị (tuỳ chọn)
            </label>
            <input
              placeholder="VD: TRUNG DONG VINAGOLD"
              value={form.short_name}
              onChange={(e) => setForm({ ...form, short_name: e.target.value })}
              className={inputCls}
            />
          </div>

          <div>
            <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
              Quy tắc Tên &amp; Mã hàng khi xuất Hóa đơn điện tử
            </label>
            <select
              value={form.invoice_item_mode}
              onChange={(e) =>
                setForm({
                  ...form,
                  invoice_item_mode: e.target.value === "INTERNAL" ? "INTERNAL" : "TAX_INPUT",
                })
              }
              className={inputCls}
            >
              <option value="TAX_INPUT">Xuất theo Mã &amp; Tên đầu vào CQT (Mặc định)</option>
              <option value="INTERNAL">Xuất theo Mã &amp; Tên nội bộ (SKU đã gán)</option>
            </select>
            <span className="text-[10px] text-slate-400 mt-0.5 block">
              Có thể ghi đè riêng từng sản phẩm (kể cả đổi quy cách/ĐVT) trong Danh sách SKU.
            </span>
          </div>

          <div>
            <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
              Trạng thái hoạt động
            </label>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
              className={inputCls}
            >
              <option value="active">Hoạt động (Active)</option>
              <option value="inactive">Ngưng giao (Inactive)</option>
            </select>
          </div>

          <div className="pt-2 border-t border-slate-200 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="rounded bg-red-700 hover:bg-red-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded bg-sky-600 hover:bg-sky-700 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {saving ? (
                <>
                  <Loader2 size={13} className="animate-spin" /> Đang lưu...
                </>
              ) : (
                <>
                  <CheckCircle2 size={13} /> {editingId ? "Cập nhật công ty" : "Lưu công ty"}
                </>
              )}
            </button>
          </div>
        </form>
      </Drawer>

      {/* Modal Upload Excel chuẩn CreateOrderForm (GEMINI.md) */}
      {uploadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg border border-slate-400 bg-white shadow-lg">
            <div className="bg-[#14263d] px-3 py-2 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileSpreadsheet size={17} className="text-red-500" />
                <span className="text-xs font-bold uppercase tracking-wide text-white">
                  Nhập Excel Danh Sách Công Ty Quản Lý
                </span>
              </div>
              <button
                type="button"
                onClick={() => setUploadOpen(false)}
                className="rounded p-1 text-white hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-3.5 space-y-3">
              {activeUploadDistributor ? (
                <div className="rounded border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
                  Dữ liệu sẽ được nhập vào Nhà phân phối:{" "}
                  <strong className="font-bold">
                    [{activeUploadDistributor.code}] {activeUploadDistributor.name}
                  </strong>
                  {activeUploadDistributor.tax_code && (
                    <span className="ml-1.5 font-mono text-[11px] text-sky-700">
                      (MST: {activeUploadDistributor.tax_code})
                    </span>
                  )}
                </div>
              ) : (
                <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Vui lòng chọn đúng Nhà phân phối trước khi tải file Excel để tránh nhập nhầm dữ liệu.
                </div>
              )}

              {isSuperAdmin && effectiveDistributorId === null && (
                <div>
                  <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                    Chọn Nhà phân phối đích <span className="text-red-600">*</span>
                  </label>
                  <select
                    value={uploadDistId}
                    onChange={(e) => setUploadDistId(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">— Chọn Nhà phân phối —</option>
                    {distributors.map((d) => (
                      <option key={d.id} value={String(d.id)}>
                        [{d.code}] {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                  File Excel (.xlsx, .xlsm) <span className="text-red-600">*</span>
                </label>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".xlsx,.xlsm"
                  onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                  className={inputCls}
                />
              </div>

              {uploadError && (
                <div className="rounded border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
                  {uploadError}
                </div>
              )}
            </div>

            <div className="border-t border-slate-300 bg-slate-100 px-3 py-2 flex items-center justify-between gap-3">
              <span className="text-[10px] text-slate-500">
                Mã công ty trùng trong cùng NPP sẽ được cập nhật thông tin.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setUploadOpen(false)}
                  className="rounded bg-red-700 hover:bg-red-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
                >
                  Đóng
                </button>
                <button
                  type="button"
                  disabled={uploading || !uploadFile || !(effectiveDistributorId || uploadDistId)}
                  onClick={() => void submitUploadCompanies()}
                  className="inline-flex items-center gap-1.5 rounded bg-sky-600 hover:bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {uploading ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                  {uploading ? "Đang nhập..." : "Xác nhận nhập Excel"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Drawer Chi tiết Công ty */}
      <Drawer open={selected !== null} onClose={() => setSelected(null)} title="Chi tiết công ty" subtitle={selected?.name}>
        {selected && (
          <div className="p-5 space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-sky-500 flex items-center justify-center flex-shrink-0">
                <span className="text-white font-bold text-sm">{getInitials(selected.name)}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-gray-900 text-sm truncate">{selected.name}</p>
                <p className="text-xs text-gray-400">{selected.code}</p>
              </div>
              <Badge variant={selected.status === "active" ? "success" : "danger"}>
                {selected.status === "active" ? "Hoạt động" : "Ngưng giao"}
              </Badge>
            </div>

            <div className="rounded-xl border border-gray-100 divide-y divide-gray-50">
              <InfoRow
                icon={<Building2 size={14} />}
                label="Nhà phân phối"
                value={
                  selected.distributor_code
                    ? `[${selected.distributor_code}] ${selected.distributor_name}`
                    : "Chưa gán NPP"
                }
              />
              <InfoRow icon={<Hash size={14} />} label="Mã số thuế" value={selected.tax_code || "—"} extra={selected.shared ? <Badge variant="warning">Dùng chung</Badge> : undefined} />
              <InfoRow
                icon={<FileText size={14} />}
                label="Quy tắc xuất HĐ"
                value={selected.invoice_item_mode === "INTERNAL" ? "Theo Mã & Tên nội bộ" : "Theo Mã & Tên đầu vào CQT"}
              />
              <InfoRow icon={<Phone size={14} />} label="Điện thoại" value={selected.phone || "—"} />
              <InfoRow icon={<MapPin size={14} />} label="Địa chỉ" value={selected.address || "—"} />
              <InfoRow icon={<CreditCard size={14} />} label="Mã KH quản lý" value={String(selected.customer_count)} />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => openEdit(selected)} className="rounded-lg border border-sky-200 py-2 text-sm font-medium text-sky-600 hover:bg-sky-50">Sửa công ty</button>
              <button onClick={() => deleteCompany(selected).catch((e: unknown) => setError(e instanceof Error ? e.message : "Không thể xóa công ty."))} className="rounded-lg border border-red-200 py-2 text-sm font-medium text-red-600 hover:bg-red-50">Xóa công ty</button>
            </div>
            <button
              type="button"
              onClick={() => router.push(`/customers?company_id=${selected.id}`)}
              className="w-full rounded-lg bg-sky-50 border border-sky-200 py-2 text-xs font-semibold text-sky-700 hover:bg-sky-100 transition-colors"
            >
              Xem {selected.customer_count} mã khách hàng thuộc công ty này →
            </button>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function InfoRow({ icon, label, value, extra }: { icon: React.ReactNode; label: string; value: string; extra?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <span className="text-gray-400 flex-shrink-0 mt-0.5">{icon}</span>
      <span className="text-xs text-gray-400 w-28 flex-shrink-0 leading-5">{label}</span>
      <span className="text-xs text-gray-800 font-medium leading-5 break-words flex-1">{value}</span>
      {extra}
    </div>
  );
}

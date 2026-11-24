"use client";
// src/app/customers/page.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Users, CheckCircle2, Wallet, AlertTriangle, Plus, Download, Upload,
  X, FileSpreadsheet, Loader2,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import AuthenticatedDownloadLink from "@/components/ui/AuthenticatedDownloadLink";
import StatCard from "@/components/ui/StatCard";
import DataTable, { Column } from "@/components/ui/DataTable";
import Badge from "@/components/ui/Badge";
import Drawer from "@/components/ui/Drawer";
import CustomerDetail from "@/components/customers/CustomerDetail";
import type { Customer, CustomerCompanyInfo } from "@/lib/mock-customers";
import { formatCustomerCode, formatVND } from "@/lib/format";
import { cn } from "@/lib/utils";
import { API_URL, apiFetch } from "@/lib/api";
import { downloadExcel } from "@/lib/excel";
import { useDistributorContext } from "@/lib/distributor-context";

const customerTypes = ["Đại lý", "Cửa hàng", "Nhà phân phối", "HORECA"];

const inputCls =
  "w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-100";

function typeVariant(type: string) {
  if (type === "Nhà phân phối") return "purple";
  if (type === "Đại lý") return "info";
  if (type === "HORECA") return "warning";
  return "default";
}

interface CompanyOption {
  id: string;
  distributorId: number | null;
  code: string;
  name: string;
}

const emptyForm = {
  distributor_id: "",
  code: "",
  name: "",
  type: "RETAIL",
  tier: "B",
  email: "",
  citizen_id: "",
  tax_code: "",
  status: "active",
  store_id: "",
  store_route: "",
  company_ids: [] as string[],
  manager_code: "",
};

function mapApiCustomer(row: Record<string, unknown>): Customer {
  const rawCompanies = Array.isArray(row.companies)
    ? (row.companies as Array<Record<string, unknown>>)
    : [];
  const companies: CustomerCompanyInfo[] = rawCompanies.map((c) => ({
    id: String(c.id),
    code: String(c.code ?? ""),
    name: String(c.name ?? ""),
    taxCode: c.tax_code ? String(c.tax_code) : undefined,
    isPrimary: Boolean(c.is_primary),
  }));
  if (companies.length === 0 && row.company_id != null) {
    companies.push({
      id: String(row.company_id),
      code: String(row.company_code ?? ""),
      name: String(row.company_name ?? ""),
      isPrimary: true,
    });
  }
  const companyIds = companies.map((c) => c.id);
  const companyCodeJoined = companies.map((c) => c.code).filter(Boolean).join(", ");
  const companyNameJoined = companies.map((c) => c.name).filter(Boolean).join(", ");

  return {
    id: String(row.id),
    distributorId: row.distributor_id != null ? String(row.distributor_id) : "",
    distributorCode: String(row.distributor_code ?? ""),
    distributorName: String(row.distributor_name ?? ""),
    code: String(row.code ?? ""),
    name: String(row.name ?? ""),
    type:
      row.type === "DISTRIBUTOR"
        ? "Nhà phân phối"
        : row.type === "WHOLESALE"
          ? "Đại lý"
          : row.type === "HORECA"
            ? "HORECA"
            : "Cửa hàng",
    tier: String(row.tier ?? "B") as Customer["tier"],
    contactName: "",
    email: String(row.email ?? ""),
    citizenId: String(row.citizen_id ?? ""),
    taxCode: String(row.tax_code ?? ""),
    address: String(row.address ?? ""),
    district: "",
    status: row.status === "inactive" ? "inactive" : "active",
    debitBalance: Number(row.current_debt ?? 0),
    totalSpend: 0,
    createdAt: String(row.created_at ?? ""),
    staffCode: String(row.staff_code ?? ""),
    staffName: String(row.staff_name ?? ""),
    managerCode: String(row.manager_code ?? ""),
    managerName: String(row.manager_name ?? ""),
    storeId: row.store_id != null ? String(row.store_id) : "",
    companyId: companyIds[0] ?? (row.company_id != null ? String(row.company_id) : ""),
    companyIds,
    companies,
    storeCode: String(row.store_code ?? ""),
    storeName: String(row.store_name ?? ""),
    storeRoute: String(row.store_route ?? ""),
    companyCode: companyCodeJoined || String(row.company_code ?? ""),
    companyName: companyNameJoined || String(row.company_name ?? ""),
  };
}

export default function CustomersPage() {
  const router = useRouter();
  const {
    distributors,
    effectiveDistributorId,
    effectiveDistributor,
    isSuperAdmin,
    isAllDistributorsMode,
  } = useDistributorContext();

  const [typeFilter, setTypeFilter] = useState("Tất cả");
  const [statusFilter, setStatusFilter] = useState("Tất cả");
  const [companyFilter, setCompanyFilter] = useState("ALL");
  const [bulkCompanyId, setBulkCompanyId] = useState("");
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [customerRows, setCustomerRows] = useState<Customer[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createMessage, setCreateMessage] = useState("");

  // Upload Excel Modal state
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadDistId, setUploadDistId] = useState<string>("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadCompanyMode, setUploadCompanyMode] = useState<"replace" | "append">("replace");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const [storeOptions, setStoreOptions] = useState<Array<{ id: string; code: string; name: string; route: string }>>([]);
  const [companyOptions, setCompanyOptions] = useState<CompanyOption[]>([]);
  const [managerOptions, setManagerOptions] = useState<Array<{ code: string; name: string }>>([]);

  // Đọc ?company_id= nếu người dùng bấm từ trang Công ty quản lý sang
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const cid = params.get("company_id");
    if (cid) setCompanyFilter(cid);
  }, []);

  const loadCustomersAndCompanies = useCallback(() => {
    const params = new URLSearchParams({ limit: "5000" });
    if (effectiveDistributorId !== null) {
      params.set("distributor_id", String(effectiveDistributorId));
    }
    const qs = params.toString();

    apiFetch(`${API_URL}/customers/?${qs}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Không thể tải danh sách khách hàng.");
        return response.json() as Promise<Array<Record<string, unknown>>>;
      })
      .then((rows) => setCustomerRows(rows.map(mapApiCustomer)))
      .catch((error: unknown) =>
        setCreateError(error instanceof Error ? error.message : "Không thể tải khách hàng."),
      );

    apiFetch(`${API_URL}/companies/?${qs}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Array<Record<string, unknown>>) => {
        const mapped: CompanyOption[] = rows.map((row) => ({
          id: String(row.id),
          distributorId: row.distributor_id != null ? Number(row.distributor_id) : null,
          code: String(row.code ?? ""),
          name: String(row.name ?? ""),
        }));
        setCompanyOptions(mapped);
        // Nếu companyFilter hiện tại không còn thuộc NPP đang chọn thì reset
        setCompanyFilter((prev) =>
          prev === "ALL" || mapped.some((c) => c.id === prev) ? prev : "ALL",
        );
      });
  }, [effectiveDistributorId]);

  useEffect(() => {
    loadCustomersAndCompanies();
  }, [loadCustomersAndCompanies]);

  useEffect(() => {
    apiFetch(`${API_URL}/stores/?limit=5000`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Array<Record<string, unknown>>) =>
        setStoreOptions(
          rows.map((row) => ({
            id: String(row.id),
            code: String(row.code ?? ""),
            name: String(row.name ?? ""),
            route: String(row.route ?? ""),
          })),
        ),
      );

    apiFetch(`${API_URL}/employees/?limit=5000`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Không thể tải danh sách nhân viên.");
        return response.json() as Promise<Array<Record<string, unknown>>>;
      })
      .then((rows) =>
        setManagerOptions(
          rows
            .filter((row) => String(row.code ?? "").trim().toUpperCase().startsWith("NV"))
            .map((row) => ({ code: String(row.code), name: String(row.name ?? "") }))
            .sort((a, b) => a.code.localeCompare(b.code)),
        ),
      )
      .catch((error: unknown) =>
        setCreateError(error instanceof Error ? error.message : "Không thể tải danh sách nhân viên."),
      );
  }, []);

  function openUploadModal() {
    setUploadError("");
    setUploadFile(null);
    setUploadCompanyMode("replace");
    setUploadDistId(effectiveDistributorId !== null ? String(effectiveDistributorId) : "");
    setUploadOpen(true);
  }

  async function submitUploadCustomers() {
    setUploadError("");
    const targetDistId = effectiveDistributorId !== null
      ? effectiveDistributorId
      : uploadDistId
        ? Number(uploadDistId)
        : null;
    if (!targetDistId) {
      setUploadError("Vui lòng chọn Nhà phân phối cần nhập danh sách khách hàng.");
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
        `${API_URL}/customers/upload?distributor_id=${targetDistId}&company_update_mode=${uploadCompanyMode}`,
        { method: "POST", body },
      );
      const result = (await response.json()) as {
        imported?: number;
        created?: number;
        updated?: number;
        detail?: string;
      };
      if (!response.ok) throw new Error(result.detail ?? "Không thể tải danh sách khách hàng.");
      const distLabel = distributors.find((d) => d.id === targetDistId)?.name || `NPP #${targetDistId}`;
      const createdCount = result.created ?? result.imported ?? 0;
      const updatedCount = result.updated ?? 0;
      setCreateMessage(
        `Đã xử lý file Excel vào ${distLabel}: thêm mới ${createdCount} khách hàng, cập nhật ${updatedCount} khách hàng.`,
      );
      setUploadOpen(false);
      loadCustomersAndCompanies();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Không thể tải file Excel.");
    } finally {
      setUploading(false);
    }
  }

  // Danh sách công ty quản lý lọc theo NPP đang chọn trên form Thêm/Sửa (chống gắn chéo Tenant)
  const formCompanyOptions = useMemo(() => {
    const formDistId = isSuperAdmin
      ? (form.distributor_id ? Number(form.distributor_id) : null)
      : effectiveDistributorId;
    if (!formDistId) return companyOptions;
    return companyOptions.filter(
      (c) => c.distributorId === null || c.distributorId === formDistId,
    );
  }, [companyOptions, form.distributor_id, isSuperAdmin, effectiveDistributorId]);

  async function createCustomer() {
    setCreateError("");
    setCreateMessage("");
    const targetDistId = isSuperAdmin
      ? (form.distributor_id ? Number(form.distributor_id) : null)
      : effectiveDistributorId;
    if (!targetDistId) {
      setCreateError("Vui lòng chọn Nhà phân phối sở hữu mã khách hàng này.");
      return;
    }
    setSaving(true);
    try {
      const companyIdsNum = form.company_ids.map((id) => Number(id)).filter((n) => Number.isFinite(n));
      const response = await apiFetch(`${API_URL}/customers/${editingId ? editingId : ""}`, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          distributor_id: targetDistId,
          store_id: form.store_id ? Number(form.store_id) : null,
          store_route: form.store_id ? form.store_route : null,
          company_id: companyIdsNum[0] ?? null,
          company_ids: companyIdsNum,
          manager_name: managerOptions.find((employee) => employee.code === form.manager_code)?.name ?? null,
        }),
      });
      const result = (await response.json()) as Record<string, unknown> & { detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "Không thể tạo khách hàng.");
      const mapped = mapApiCustomer(result);
      setCustomerRows((current) => {
        const next = editingId
          ? current.map((item) => (item.id === editingId ? { ...item, ...mapped } : item))
          : [mapped, ...current];
        if (mapped.storeId) {
          return next.map((item) =>
            item.storeId === mapped.storeId ? { ...item, storeRoute: mapped.storeRoute } : item,
          );
        }
        return next;
      });
      if (mapped.storeId) {
        setStoreOptions((prev) =>
          prev.map((s) => (s.id === mapped.storeId ? { ...s, route: mapped.storeRoute ?? "" } : s)),
        );
      }
      setCreateMessage(
        editingId ? "Đã cập nhật khách hàng." : "Đã tạo khách hàng thành công trong PostgreSQL.",
      );
      setCreateOpen(false);
      setEditingId(null);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Không thể tạo khách hàng.");
    } finally {
      setSaving(false);
    }
  }

  function openCreate() {
    setEditingId(null);
    setForm({
      ...emptyForm,
      distributor_id: effectiveDistributorId !== null ? String(effectiveDistributorId) : "",
      company_ids:
        companyFilter !== "ALL" && companyFilter !== "UNASSIGNED" ? [companyFilter] : [],
    });
    setCreateError("");
    setCreateOpen(true);
  }

  function openEdit(customer: Customer) {
    setEditingId(customer.id);
    const existingCompanyIds =
      customer.companyIds && customer.companyIds.length > 0
        ? customer.companyIds
        : customer.companyId
          ? [customer.companyId]
          : [];
    setForm({
      distributor_id:
        customer.distributorId ||
        (effectiveDistributorId !== null ? String(effectiveDistributorId) : ""),
      code: customer.code,
      name: customer.name,
      type:
        customer.type === "Cửa hàng"
          ? "RETAIL"
          : customer.type === "Đại lý"
            ? "WHOLESALE"
            : customer.type === "Nhà phân phối"
              ? "DISTRIBUTOR"
              : "HORECA",
      tier: customer.tier,
      email: customer.email,
      citizen_id: customer.citizenId ?? "",
      tax_code: customer.taxCode ?? "",
      status: customer.status,
      store_id: customer.storeId ?? "",
      store_route: customer.storeRoute ?? "",
      company_ids: existingCompanyIds,
      manager_code: customer.managerCode ?? "",
    });
    setSelected(null);
    setCreateError("");
    setCreateOpen(true);
  }

  async function deleteCustomer(customer: Customer) {
    if (!window.confirm(`Xóa khách hàng ${customer.name}?`)) return;
    const response = await apiFetch(`${API_URL}/customers/${customer.id}`, { method: "DELETE" });
    const result = (await response.json().catch(() => ({}))) as { detail?: string };
    if (!response.ok) throw new Error(result.detail ?? "Không thể xóa khách hàng.");
    setCustomerRows((current) => current.filter((item) => item.id !== customer.id));
    setSelected(null);
    setCreateMessage("Đã xóa khách hàng.");
  }

  const filtered = useMemo(
    () =>
      customerRows.filter((c) => {
        if (typeFilter !== "Tất cả" && c.type !== typeFilter) return false;
        if (statusFilter !== "Tất cả" && c.status !== statusFilter) return false;
        const cIds =
          c.companyIds && c.companyIds.length > 0
            ? c.companyIds
            : c.companyId
              ? [c.companyId]
              : [];
        if (companyFilter === "UNASSIGNED") {
          if (cIds.length > 0) return false;
        } else if (companyFilter !== "ALL" && !cIds.includes(companyFilter)) {
          return false;
        }
        return true;
      }),
    [customerRows, typeFilter, statusFilter, companyFilter],
  );

  const activeCount = filtered.filter((c) => c.status === "active").length;
  const debtCount = filtered.filter((c) => c.debitBalance > 0).length;
  const totalDebt = filtered.reduce((s, c) => s + c.debitBalance, 0);

  function exportCustomers() {
    downloadExcel(
      filtered.map((customer) => ({
        "Mã NPP": customer.distributorCode ?? "",
        "Tên NPP": customer.distributorName ?? "",
        "Mã KH": customer.code,
        "Tên khách hàng": customer.name,
        "Mã NVQL": customer.managerCode ?? "",
        "Tên NVQL": customer.managerName ?? "",
        "Loại": customer.type,
        "Hạng": customer.tier,
        "CCCD": customer.citizenId ?? "",
        "Mã số thuế": customer.taxCode ?? "",
        "Cửa hàng": customer.storeName,
        "Mã cửa hàng": customer.storeCode,
        "Tuyến": customer.storeRoute ?? "",
        "Công ty quản lý": customer.companyName,
        "Mã công ty": customer.companyCode,
        "Công nợ": customer.debitBalance,
        "Trạng thái": customer.status === "active" ? "Hoạt động" : "Ngưng giao",
      })),
      `khach-hang-${new Date().toISOString().slice(0, 10)}`,
      "Khách hàng",
    );
  }

  const columns = useMemo<Column<Customer>[]>(() => {
    const cols: Column<Customer>[] = [];
    if (isAllDistributorsMode) {
      cols.push({
        key: "distributorCode",
        title: "Nhà phân phối",
        sortable: true,
        render: (_, row) =>
          row.distributorCode ? (
            <div className="min-w-0">
              <span className="inline-flex items-center rounded bg-sky-50 border border-sky-200 px-1.5 py-0.5 text-[10px] font-mono font-bold text-sky-800">
                {row.distributorCode}
              </span>
              <p className="text-[11px] text-slate-500 truncate max-w-[150px]">{row.distributorName}</p>
            </div>
          ) : (
            <Badge variant="warning">Chưa gán NPP</Badge>
          ),
      });
    }
    cols.push(
      {
        key: "code",
        title: "Mã KH",
        sortable: true,
        render: (value) => {
          const code = String(value ?? "");
          return (
            <span className="font-mono" title={code}>
              {formatCustomerCode(code)}
            </span>
          );
        },
      },
      {
        key: "name",
        title: "Tên khách hàng",
        sortable: true,
        render: (_, row) => (
          <div>
            <p className="font-medium text-gray-900">{row.name}</p>
            <p className="text-xs text-gray-400">{row.address || row.district}</p>
          </div>
        ),
      },
      {
        key: "managerCode",
        title: "Mã NVQL",
        sortable: true,
        render: (val) =>
          val ? (
            <span className="font-mono text-xs font-semibold text-gray-700">{String(val)}</span>
          ) : (
            <span className="text-gray-400">—</span>
          ),
      },
      {
        key: "managerName",
        title: "Tên NVQL",
        sortable: true,
        render: (val) =>
          val ? (
            <span className="font-medium text-gray-800">{String(val)}</span>
          ) : (
            <span className="text-gray-400">—</span>
          ),
      },
      {
        key: "type",
        title: "Loại",
        sortable: true,
        render: (val) => <Badge variant={typeVariant(String(val))}>{String(val)}</Badge>,
      },
      { key: "citizenId", title: "CCCD" },
      { key: "taxCode", title: "Mã số thuế" },
      {
        key: "storeName",
        title: "Cửa hàng",
        sortable: true,
        render: (_, row) =>
          row.storeCode ? (
            <div>
              <p className="text-gray-800 font-medium">{row.storeName}</p>
              <p className="text-xs text-gray-400">{row.storeCode}</p>
            </div>
          ) : (
            <Badge variant="default">Chưa gán</Badge>
          ),
      },
      {
        key: "storeRoute",
        title: "Tuyến",
        sortable: true,
        render: (val) =>
          val ? <Badge variant="info">{String(val)}</Badge> : <span className="text-gray-400">—</span>,
      },
      {
        key: "companyName",
        title: "Công ty quản lý",
        sortable: true,
        render: (_, row) => {
          const list = row.companies && row.companies.length > 0 ? row.companies : null;
          if (list) {
            return (
              <div className="flex flex-wrap gap-1 max-w-[260px]">
                {list.map((comp) => (
                  <Badge key={comp.id} variant="info">
                    {comp.name || comp.code}
                  </Badge>
                ))}
              </div>
            );
          }
          return row.companyName ? (
            <Badge variant="info">{row.companyName}</Badge>
          ) : (
            <Badge variant="default">Chưa gán</Badge>
          );
        },
      },
      {
        key: "debitBalance",
        title: "Công nợ",
        sortable: true,
        align: "right",
        render: (val) => (
          <span className={cn((val as number) > 0 ? "text-red-600 font-semibold" : "text-gray-400")}>
            {formatVND(val as number)}
          </span>
        ),
      },
      {
        key: "status",
        title: "Trạng thái",
        sortable: true,
        render: (val) =>
          val === "active" ? (
            <Badge variant="success">Hoạt động</Badge>
          ) : (
            <Badge variant="danger">Ngưng giao</Badge>
          ),
      },
    );
    return cols;
  }, [isAllDistributorsMode]);

  const activeUploadDistributor = distributors.find(
    (d) => d.id === (effectiveDistributorId ?? (uploadDistId ? Number(uploadDistId) : null)),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Khách hàng & Đại lý"
        subtitle={
          effectiveDistributor
            ? `Danh sách mã khách hàng thuộc NPP [${effectiveDistributor.code}] ${effectiveDistributor.name}`
            : "Quản lý danh sách mã khách hàng phân tách theo Nhà phân phối và Công ty quản lý"
        }
        actions={
          <div className="flex gap-2">
            <AuthenticatedDownloadLink
              href={`${API_URL}/customers/template`}
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
              onClick={exportCustomers}
              disabled={filtered.length === 0}
              className="flex items-center gap-2 border border-gray-200 bg-white text-gray-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              <Download size={16} />Tải Excel
            </button>
            <button
              onClick={openCreate}
              className="flex items-center gap-2 bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <Plus size={16} />
              Thêm khách hàng
            </button>
          </div>
        }
      />

      {createError && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          {createError}
        </div>
      )}
      {createMessage && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg px-4 py-3 text-sm">
          {createMessage}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Tổng khách hàng" value={filtered.length} icon={<Users size={20} />} color="bg-sky-50 text-sky-600" />
        <StatCard label="Đang hoạt động" value={activeCount} icon={<CheckCircle2 size={20} />} color="bg-emerald-50 text-emerald-600" />
        <StatCard label="Khách đang nợ" value={debtCount} icon={<AlertTriangle size={20} />} color="bg-amber-50 text-amber-600" />
        <StatCard label="Tổng công nợ" value={formatVND(totalDebt)} icon={<Wallet size={20} />} color="bg-rose-50 text-rose-600" />
      </div>

      <DataTable
        data={filtered}
        columns={columns}
        searchKeys={[
          "code",
          "name",
          "managerCode",
          "managerName",
          "district",
          "storeCode",
          "storeName",
          "storeRoute",
          "companyName",
          "distributorCode",
          "distributorName",
        ]}
        searchPlaceholder="Tìm mã, tên khách hàng, mã/tên NVQL, tuyến, NPP..."
        onRowClick={(row) => setSelected(row)}
        emptyMessage="Không có khách hàng phù hợp trong phạm vi Nhà phân phối này"
        toolbar={
          <>
            <select
              value={companyFilter}
              onChange={(e) => setCompanyFilter(e.target.value)}
              className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-medium focus:outline-none focus:ring-2 focus:ring-sky-500 max-w-[230px]"
            >
              <option value="ALL">Tất cả công ty quản lý ({companyOptions.length})</option>
              <option value="UNASSIGNED">Chưa gán công ty quản lý</option>
              {companyOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.name}
                </option>
              ))}
            </select>
            {companyOptions.length > 0 && filtered.length > 0 && (
              <div className="flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50/70 px-2 py-1">
                <select
                  value={bulkCompanyId}
                  onChange={(e) => setBulkCompanyId(e.target.value)}
                  className="bg-white border border-sky-200 rounded px-2 py-1 text-xs font-medium text-slate-700 max-w-[180px] focus:outline-none focus:ring-1 focus:ring-sky-500"
                >
                  <option value="">Gán nhanh công ty...</option>
                  {companyOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} · {c.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!bulkCompanyId || bulkAssigning}
                  onClick={async () => {
                    if (!bulkCompanyId) return;
                    const comp = companyOptions.find((c) => c.id === bulkCompanyId);
                    if (
                      !window.confirm(
                        `Thêm Công ty quản lý "${comp?.name || bulkCompanyId}" cho ${filtered.length} khách hàng đang hiển thị? (Giữ nguyên các công ty đã gán trước đó)`,
                      )
                    ) {
                      return;
                    }
                    setBulkAssigning(true);
                    setCreateError("");
                    setCreateMessage("");
                    try {
                      const resp = await apiFetch(`${API_URL}/customers/bulk-assign-company`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          customer_ids: filtered.map((c) => Number(c.id)),
                          company_id: Number(bulkCompanyId),
                          mode: "add",
                        }),
                      });
                      const data = (await resp.json().catch(() => ({}))) as { updated?: number; detail?: string };
                      if (!resp.ok) throw new Error(data.detail || "Không thể gán công ty hàng loạt.");
                      setCreateMessage(`Đã gán công ty quản lý cho ${data.updated ?? filtered.length} khách hàng.`);
                      setBulkCompanyId("");
                      loadCustomersAndCompanies();
                    } catch (e) {
                      setCreateError(e instanceof Error ? e.message : "Lỗi khi gán công ty hàng loạt.");
                    } finally {
                      setBulkAssigning(false);
                    }
                  }}
                  className="rounded bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 px-2.5 py-1 text-xs font-semibold text-white whitespace-nowrap transition-colors"
                >
                  {bulkAssigning ? "Đang gán..." : `Gán (${filtered.length} KH)`}
                </button>
              </div>
            )}
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-medium focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="Tất cả">Tất cả loại</option>
              {customerTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-medium focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="Tất cả">Tất cả trạng thái</option>
              <option value="active">Hoạt động</option>
              <option value="inactive">Ngưng giao</option>
            </select>
          </>
        }
      />

      {/* Drawer Thêm/Sửa Khách hàng */}
      <Drawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={editingId ? "Sửa khách hàng" : "Thêm khách hàng"}
        subtitle="Phân loại theo Nhà phân phối & Công ty quản lý"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void createCustomer();
          }}
          className="p-4 space-y-2.5"
        >
          {createError && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded px-3 py-2 text-xs">
              {createError}
            </div>
          )}

          <div>
            <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
              Nhà phân phối (Tenant) <span className="text-red-600">*</span>
            </label>
            {isSuperAdmin ? (
              <select
                required
                value={form.distributor_id}
                onChange={(e) =>
                  setForm({
                    ...form,
                    distributor_id: e.target.value,
                    company_ids: [], // Reset Công ty quản lý khi đổi NPP để chống gắn chéo Tenant
                  })
                }
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

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                Mã khách hàng <span className="text-red-600">*</span>
              </label>
              <input
                required
                disabled={Boolean(editingId)}
                placeholder="VD: KH-0001"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                className={inputCls}
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                Loại khách hàng
              </label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className={inputCls}
              >
                <option value="RETAIL">Cửa hàng</option>
                <option value="DISTRIBUTOR">Nhà phân phối</option>
                <option value="WHOLESALE">Đại lý</option>
                <option value="HORECA">HORECA</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
              Tên khách hàng <span className="text-red-600">*</span>
            </label>
            <input
              required
              placeholder="Tên khách hàng / Tên xuất hóa đơn"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputCls}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-0.5">
              <label className="text-[10px] font-semibold text-slate-600 block">
                Công ty quản lý / Xuất hóa đơn (chọn nhiều, thuộc NPP đang chọn)
              </label>
              {form.company_ids.length > 0 && (
                <span className="text-[10px] font-semibold text-sky-700">
                  Đã chọn {form.company_ids.length}
                </span>
              )}
            </div>
            {form.company_ids.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1.5">
                {form.company_ids.map((cid, idx) => {
                  const comp = companyOptions.find((c) => c.id === cid);
                  return (
                    <span
                      key={cid}
                      className="inline-flex items-center gap-1 rounded bg-sky-50 border border-sky-200 px-1.5 py-0.5 text-[10px] font-medium text-sky-800"
                    >
                      <span>
                        {comp ? `${comp.code} · ${comp.name}` : `#${cid}`}
                        {idx === 0 && form.company_ids.length > 1 ? " (Chính)" : ""}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            company_ids: prev.company_ids.filter((id) => id !== cid),
                          }))
                        }
                        className="text-sky-600 hover:text-red-600"
                        aria-label="Bỏ công ty"
                      >
                        <X size={10} />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            <div className="max-h-36 overflow-y-auto rounded border border-slate-300 bg-white divide-y divide-slate-100">
              {formCompanyOptions.length === 0 ? (
                <p className="px-2 py-2 text-[11px] text-slate-400">
                  Chưa có công ty quản lý nào thuộc Nhà phân phối này.
                </p>
              ) : (
                formCompanyOptions.map((c) => {
                  const checked = form.company_ids.includes(c.id);
                  return (
                    <label
                      key={c.id}
                      className={cn(
                        "flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer hover:bg-sky-50/60",
                        checked && "bg-sky-50/50",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const isChecked = e.target.checked;
                          setForm((prev) => ({
                            ...prev,
                            company_ids: isChecked
                              ? [...prev.company_ids, c.id]
                              : prev.company_ids.filter((id) => id !== c.id),
                          }));
                        }}
                        className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                      />
                      <span className="font-mono text-[11px] font-semibold text-slate-700">{c.code}</span>
                      <span className="text-slate-700 truncate">{c.name}</span>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                Cửa hàng liên kết
              </label>
              <select
                value={form.store_id}
                onChange={(e) => {
                  const storeId = e.target.value;
                  const matchedStore = storeOptions.find((s) => s.id === storeId);
                  setForm({
                    ...form,
                    store_id: storeId,
                    store_route: matchedStore ? matchedStore.route : "",
                  });
                }}
                className={inputCls}
              >
                <option value="">— Chọn cửa hàng —</option>
                {storeOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} · {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                Tuyến bán hàng
              </label>
              <input
                disabled={!form.store_id}
                placeholder={form.store_id ? "VD: Tuyến 1..." : "Chọn cửa hàng trước"}
                value={form.store_route}
                onChange={(e) => setForm({ ...form, store_route: e.target.value })}
                className={inputCls}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">CCCD</label>
              <input
                placeholder="Tùy chọn"
                value={form.citizen_id}
                onChange={(e) => setForm({ ...form, citizen_id: e.target.value })}
                className={inputCls}
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                Mã số thuế
              </label>
              <input
                placeholder="Tùy chọn"
                value={form.tax_code}
                onChange={(e) => setForm({ ...form, tax_code: e.target.value })}
                className={inputCls}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">NVQL</label>
              <select
                value={form.manager_code}
                onChange={(e) => setForm({ ...form, manager_code: e.target.value })}
                className={inputCls}
              >
                <option value="">— Chọn NVQL —</option>
                {managerOptions.map((employee) => (
                  <option key={employee.code} value={employee.code}>
                    {employee.code} · {employee.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">Hạng / Trạng thái</label>
              <div className="grid grid-cols-2 gap-1.5">
                <select
                  value={form.tier}
                  onChange={(e) => setForm({ ...form, tier: e.target.value })}
                  className={inputCls}
                >
                  <option>A</option>
                  <option>B</option>
                  <option>C</option>
                </select>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className={inputCls}
                >
                  <option value="active">Hoạt động</option>
                  <option value="inactive">Ngưng</option>
                </select>
              </div>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">Email nhận hóa đơn</label>
            <input
              placeholder="Tùy chọn"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className={inputCls}
            />
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
              {saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
              {saving ? "Đang lưu..." : editingId ? "Cập nhật khách hàng" : "Lưu khách hàng"}
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
                  Nhập Excel Danh Sách Khách Hàng
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
                  Vui lòng chọn đúng Nhà phân phối trước khi tải file Excel để đảm bảo phân tách dữ liệu.
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
                  Xử lý cột Công ty quản lý khi cập nhật KH đã có
                </label>
                <select
                  value={uploadCompanyMode}
                  onChange={(e) => setUploadCompanyMode(e.target.value as "replace" | "append")}
                  className={inputCls}
                >
                  <option value="replace">Cập nhật danh sách công ty đúng theo file upload (Mặc định)</option>
                  <option value="append">Giữ nguyên công ty hiện có & bổ sung thêm công ty mới từ file</option>
                </select>
              </div>

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

              <div className="rounded border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] text-slate-600 space-y-0.5">
                <p>
                  • <strong>Chưa có Mã KH</strong>: Tự động thêm mới khách hàng.
                </p>
                <p>
                  • <strong>Đã có Mã KH</strong>: Tự động cập nhật các trường có dữ liệu theo file upload.
                </p>
                <p>
                  • <strong>Nhiều công ty quản lý</strong>: Nhập nhiều mã cách nhau bởi dấu <code className="font-mono">,</code> hoặc <code className="font-mono">;</code> (VD: <code className="font-mono">CT001, CT002</code>), hoặc tách thành nhiều dòng cùng Mã KH.
                </p>
              </div>

              {uploadError && (
                <div className="rounded border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
                  {uploadError}
                </div>
              )}
            </div>

            <div className="border-t border-slate-300 bg-slate-100 px-3 py-2 flex items-center justify-between gap-3">
              <span className="text-[10px] text-slate-500">
                Hỗ trợ thêm mới, cập nhật & gán nhiều công ty quản lý trong cùng NPP.
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
                  onClick={() => void submitUploadCustomers()}
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

      <Drawer
        open={selected !== null}
        onClose={() => setSelected(null)}
        title="Chi tiết khách hàng"
        subtitle={selected?.name}
      >
        {selected && (
          <CustomerDetail
            customer={selected}
            onCreateOrder={() => {
              setSelected(null);
              router.push(`/sales/create?customer=${selected.code}`);
            }}
            onEdit={() => openEdit(selected)}
            onDelete={() =>
              deleteCustomer(selected).catch((error: unknown) =>
                setCreateError(error instanceof Error ? error.message : "Không thể xóa khách hàng."),
              )
            }
          />
        )}
      </Drawer>
    </div>
  );
}

"use client";
// src/app/employees/page.tsx
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { UsersRound, Users, Target, Phone as PhoneIcon, MapPin, CalendarDays, TrendingUp, Mail, Download, Upload, Pencil, Trash2 } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import AuthenticatedDownloadLink from "@/components/ui/AuthenticatedDownloadLink";
import StatCard from "@/components/ui/StatCard";
import DataTable, { Column } from "@/components/ui/DataTable";
import Badge from "@/components/ui/Badge";
import Drawer from "@/components/ui/Drawer";
import ProgressBar from "@/components/ui/ProgressBar";
import { type Employee } from "@/lib/mock-employees";
import { formatVND, formatDate, getInitials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { API_URL, apiFetch } from "@/lib/api";

interface EmployeeRow extends Employee {
  backendId: number;
  accountUsername: string | null;
  debtLimit: number;
}

interface BackendEmployee {
  id: number;
  code: string;
  name: string;
  nickname: string | null;
  position: string;
  phone: string;
  email: string | null;
  territory_id: number | null;
  target: number;
  debt_limit: number;
  status: string;
  join_date: string | null;
  account_username: string | null;
}

interface DebtLimitChange {
  id: number;
  employee_code: string;
  old_limit: number;
  new_limit: number;
  reason: string;
  changed_by: string | null;
  changed_at: string;
}

const DEFAULT_POSITION = "Nhân viên kinh doanh";
const emptyForm = { code: "", name: "", nickname: "", position: DEFAULT_POSITION, phone: "", email: "", target: "0", debt_limit: "500000000", debt_limit_reason: "", status: "active" };

const VALID_POSITIONS = [
  "Nhân viên kinh doanh",
  "Admin",
  "Sales Admin",
  "Kế toán",
  "Thủ kho",
];

function normalizePosition(position: string): string {
  return position || DEFAULT_POSITION;
}

function mergeWithMock(list: BackendEmployee[]): EmployeeRow[] {
  const sorted = [...list].sort((a, b) =>
    a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: "base" })
  );
  return sorted.map((item) => ({
    territory: "—", routes: [] as string[], orders: 0, customersServed: 0,
    newCustomersTarget: 0, newCustomers: 0, visitTarget: 0, visits: 0, achieved: 0,
    avatar: item.name.split(" ").map((word) => word[0]).filter(Boolean).slice(-2).join("").toUpperCase(),
    id: String(item.id),
    backendId: item.id,
    code: item.code,
    name: item.name,
    nickname: item.nickname ?? null,
    position: normalizePosition(item.position) as Employee["position"],
    phone: item.phone,
    email: item.email ?? "",
    status: (item.status as Employee["status"]) ?? "active",
    joinDate: item.join_date ?? new Date().toISOString(),
    target: item.target,
    debtLimit: item.debt_limit ?? 500000000,
    accountUsername: item.account_username,
  }));
}

const avatarColors = ["bg-sky-500", "bg-purple-500", "bg-amber-500", "bg-emerald-500", "bg-rose-500", "bg-indigo-500"];

const BASE_POSITION_OPTIONS = [
  "Admin",
  "Sales Admin",
  "Đội xe",
  "Thủ kho",
  "Kế toán nội bộ",
  "Kế toán thuế",
  "NVKD Sữa Vinamilk",
  "NVKD Gấu Đỏ",
  "NVKD Nutricare",
  "NVKD Nabati",
  "NVKD Bỉm Mofix",
  "NVKD Thanh An",
  "NVKD Xilitol",
  "Nhân viên kinh doanh",
];

function positionVariant(position: string): "default" | "success" | "warning" | "danger" | "info" | "purple" {
  if (position === "Admin") return "danger";
  if (position.includes("Sales Admin")) return "purple";
  if (position.includes("Kế toán")) return "warning";
  if (position.includes("Thủ kho")) return "info";
  if (position.includes("Đội xe")) return "info";
  if (position.includes("Vinamilk")) return "success";
  if (position.includes("NVKD")) return "purple";
  return "default";
}

export default function EmployeesPage() {
  const [positionFilter, setPositionFilter] = useState("Tất cả");
  const [selected, setSelected] = useState<EmployeeRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [employeesList, setEmployeesList] = useState<EmployeeRow[]>([]);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [createError, setCreateError] = useState("");
  const [createMessage, setCreateMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [createAccount, setCreateAccount] = useState(false);
  const [credentials, setCredentials] = useState<{ username: string; password: string } | null>(null);
  const [originalDebtLimit, setOriginalDebtLimit] = useState<number | null>(null);
  const [debtLimitHistory, setDebtLimitHistory] = useState<DebtLimitChange[]>([]);
  const [debtLimitHistoryLoading, setDebtLimitHistoryLoading] = useState(false);
  const [debtLimitHistoryError, setDebtLimitHistoryError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  async function load() {
    setLoadError("");
    try {
      const response = await apiFetch(`${API_URL}/employees/?limit=1000`);
      if (!response.ok) throw new Error("Không thể tải danh sách nhân viên.");
      const data = await response.json() as BackendEmployee[];
      setEmployeesList(mergeWithMock(data));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Không thể tải danh sách nhân viên.");
    }
  }

  useEffect(() => { void load(); }, []);

  function openCreate() {
    setOriginalDebtLimit(null);
    setEditingId(null); setForm(emptyForm); setCreateError(""); setCreateOpen(true);
  }

  function openEdit(employee: EmployeeRow) {
    setSelected(null);
    setOriginalDebtLimit(employee.debtLimit);
    setEditingId(employee.backendId);
    setForm({
      code: employee.code, name: employee.name, nickname: employee.nickname ?? "", position: employee.position, phone: employee.phone,
      email: employee.email ?? "", target: String(employee.target ?? 0),
      debt_limit: String(employee.debtLimit), debt_limit_reason: "", status: employee.status,
    });
    setCreateError(""); setCreateOpen(true);
  }

  async function saveEmployee() {
    setCreateError(""); setCreateMessage(""); setActionError("");
    if (!form.code.trim() || !form.name.trim()) { setCreateError("Mã và họ tên nhân viên không được để trống."); return; }
    const changingDebtLimit = editingId !== null && Number(form.debt_limit) !== originalDebtLimit;
    if (changingDebtLimit && !form.debt_limit_reason.trim()) {
      setCreateError("Vui lòng ghi lý do khi thay đổi hạn mức công nợ.");
      return;
    }
    try {
      const payload = {
        code: form.code.trim(), name: form.name.trim(), nickname: form.nickname.trim() || null, position: form.position,
        phone: form.phone.trim(), email: form.email.trim() || null,
        target: Number(form.target) || 0, debt_limit: Number(form.debt_limit) || 0, status: form.status,
        ...(changingDebtLimit ? { debt_limit_reason: form.debt_limit_reason.trim() } : {}),
        ...(editingId ? {} : { create_account: createAccount }),
      };
      const response = await apiFetch(`${API_URL}/employees/${editingId ?? ""}`, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as { detail?: string; initial_username?: string | null; initial_password?: string | null };
      if (!response.ok) throw new Error(typeof result.detail === "string" ? result.detail : "Không thể lưu nhân viên.");
      setCreateMessage(editingId ? "Đã cập nhật nhân viên." : "Đã thêm nhân viên.");
      setCredentials(result.initial_username && result.initial_password ? { username: result.initial_username, password: result.initial_password } : null);
      setCreateAccount(false);
      setCreateOpen(false); setEditingId(null); setSelected(null); setForm(emptyForm);
      await load();
    } catch (e) { setCreateError(e instanceof Error ? e.message : "Không thể lưu nhân viên."); }
  }

  async function openProfile(employee: EmployeeRow) {
    setSelected(employee);
    setDebtLimitHistory([]);
    setDebtLimitHistoryError("");
    setDebtLimitHistoryLoading(true);
    try {
      const response = await apiFetch(`${API_URL}/employees/${employee.backendId}/debt-limit-history`);
      if (!response.ok) throw new Error("Không thể tải lịch sử thay đổi hạn mức.");
      setDebtLimitHistory(await response.json() as DebtLimitChange[]);
    } catch (e) {
      setDebtLimitHistoryError(e instanceof Error ? e.message : "Không thể tải lịch sử hạn mức.");
    } finally {
      setDebtLimitHistoryLoading(false);
    }
  }

  async function deleteEmployee(employee: EmployeeRow) {
    if (!window.confirm(`Xóa nhân viên ${employee.name} (${employee.code})?`)) return;
    setActionError(""); setCreateMessage("");
    const response = await apiFetch(`${API_URL}/employees/${employee.backendId}`, { method: "DELETE" });
    if (!response.ok) {
      const result = await response.json().catch(() => ({})) as { detail?: string };
      setActionError(typeof result.detail === "string" ? result.detail : "Không thể xóa nhân viên.");
      setSelected(null);
      return;
    }
    setSelected(null);
    setCreateMessage(`Đã xóa nhân viên ${employee.name}.`);
    await load();
  }

  async function uploadEmployees(file: File) {
    setActionError(""); setCreateMessage("");
    const body = new FormData();
    body.append("file", file);
    const response = await apiFetch(`${API_URL}/employees/upload`, { method: "POST", body });
    const result = await response.json() as { created?: number; updated?: number; detail?: string };
    if (!response.ok) throw new Error(typeof result.detail === "string" ? result.detail : "Không thể nhập file nhân viên.");
    setCreateMessage(`Đã nhập file: thêm mới ${result.created ?? 0}, cập nhật ${result.updated ?? 0} nhân viên.`);
    await load();
  }

  const dynamicPositions = Array.from(new Set([
    ...BASE_POSITION_OPTIONS,
    ...employeesList.map((e) => e.position),
  ])).filter(Boolean);

  const positionOptions = dynamicPositions.map((pos) => ({ value: pos, label: pos }));

  const nvkd = employeesList.filter((e) => e.position.includes("NVKD") || e.position.includes("kinh doanh") || e.position.includes("xe")).length;
  const totalAchieved = employeesList.reduce((s, e) => s + e.achieved, 0);
  const reached = employeesList.filter((e) => e.achieved >= e.target * 0.9).length;

  const filtered = employeesList.filter(
    (e) => positionFilter === "Tất cả" || e.position === positionFilter
  );

  const columns: Column<EmployeeRow>[] = [
    {
      key: "code",
      title: "Mã NV",
      sortable: true,
      render: (val) => <span className="font-semibold text-gray-500">{String(val)}</span>,
    },
    {
      key: "name",
      title: "Họ và tên đầy đủ",
      sortable: true,
      render: (_, row) => (
        <div className="flex items-center gap-2.5">
          <div className={cn("w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0", avatarColors[employeesList.findIndex((e) => e.code === row.code) % avatarColors.length])}>
            <span className="text-white text-xs font-bold">{getInitials(row.name)}</span>
          </div>
          <div>
            <p className="font-medium text-gray-900">{row.name}</p>
            <p className="text-xs text-gray-400">{row.phone}</p>
          </div>
        </div>
      ),
    },
    {
      key: "nickname",
      title: "Tên gọi",
      sortable: true,
      render: (val) => (
        val ? (
          <span className="font-semibold text-sky-700 bg-sky-50 px-2.5 py-1 rounded-md text-xs border border-sky-200">
            {String(val)}
          </span>
        ) : (
          <span className="text-gray-300 text-xs italic">—</span>
        )
      ),
    },
    {
      key: "position",
      title: "Vị trí",
      sortable: true,
      render: (val) => <Badge variant={positionVariant(String(val))}>{String(val)}</Badge>,
    },
    { key: "territory", title: "Khu vực", sortable: true },
    {
      key: "account",
      title: "Tài khoản đăng nhập",
      render: (_, row) =>
        row.accountUsername
          ? <Badge variant="success">{row.accountUsername}</Badge>
          : (
            <Link
              href={`/system?employee=${row.backendId}`}
              onClick={(event) => event.stopPropagation()}
              className="text-sky-600 hover:underline text-xs font-medium whitespace-nowrap"
            >
              <span className="text-gray-400 mr-2">Chưa có tài khoản</span>+ Tạo tài khoản
            </Link>
          ),
    },
    {
      key: "target",
      title: "Mục tiêu tháng",
      sortable: true,
      align: "right",
      render: (val) => <span className="text-gray-600">{formatVND(val as number)}</span>,
    },
    {
      key: "achieved",
      title: "Đạt được",
      sortable: true,
      align: "right",
      render: (val) => <span className="font-semibold text-gray-900">{formatVND(val as number)}</span>,
    },
    {
      key: "achieved",
      title: "% Đạt KPI",
      render: (_, row) => {
        const pct = row.target > 0 ? (row.achieved / row.target) * 100 : 0;
        const over = row.target > 0 && pct >= 100;
        const near = row.target > 0 && pct >= 90;
        return (
          <div className="w-28">
            <ProgressBar
              value={row.achieved}
              max={row.target}
              color={over ? "bg-emerald-500" : near ? "bg-sky-500" : "bg-amber-500"}
            />
            <p className={cn("text-xs font-bold mt-1", over ? "text-emerald-600" : near ? "text-sky-600" : "text-amber-600")}>
              {pct.toFixed(0)}%
            </p>
          </div>
        );
      },
    },
    {
      key: "status",
      title: "Trạng thái",
      sortable: true,
      render: (val) =>
        val === "active" ? <Badge variant="success">Đang làm việc</Badge> : <Badge variant="danger">Đã nghỉ</Badge>,
    },
    {
      key: "actions",
      title: "Thao tác",
      align: "center",
      render: (_, row) => (
        <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => openEdit(row)}
            className="p-1.5 text-gray-500 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition-colors"
            title="Sửa nhân viên"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={() => void deleteEmployee(row)}
            className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            title="Xóa nhân viên"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nhân viên & Vị trí"
        subtitle="Nhân viên bán hàng của công ty — người nhận hàng khi giao xuất theo phiếu Excel"
        actions={
          <div className="flex gap-2">
            <AuthenticatedDownloadLink href={`${API_URL}/employees/template`} className="flex items-center gap-2 border border-gray-200 bg-white text-gray-700 px-3 py-2 rounded-lg text-sm font-medium"><Download size={16} />Tải mẫu Excel</AuthenticatedDownloadLink>
            <button onClick={() => fileInput.current?.click()} className="flex items-center gap-2 border border-gray-200 bg-white text-gray-700 px-3 py-2 rounded-lg text-sm font-medium"><Upload size={16} />Upload Excel</button>
            <input ref={fileInput} type="file" accept=".xlsx,.xlsm" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadEmployees(file).catch((e: unknown) => setActionError(e instanceof Error ? e.message : "Không thể tải file Excel.")); event.target.value = ""; }} />
            <button onClick={openCreate} className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
              <UsersRound size={16} />
              Thêm nhân viên
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Tổng nhân viên" value={employeesList.length} icon={<UsersRound size={20} />} color="bg-sky-50 text-sky-600" />
        <StatCard label="NV Kinh doanh" value={nvkd} icon={<Users size={20} />} color="bg-purple-50 text-purple-600" />
        <StatCard label="Đạt ≥ 90% mục tiêu" value={reached} icon={<Target size={20} />} color="bg-emerald-50 text-emerald-600" />
        <StatCard label="Tổng doanh số tháng" value={formatVND(totalAchieved)} icon={<TrendingUp size={20} />} color="bg-amber-50 text-amber-600" />
      </div>

      <DataTable
        data={filtered}
        columns={columns}
        defaultSortKey="code"
        defaultSortDir="asc"
        searchKeys={["code", "name", "nickname", "phone", "territory", "email"]}
        searchPlaceholder="Tìm mã NV, họ tên, tên gọi, SĐT..."
        onRowClick={(row) => void openProfile(row)}
        toolbar={
          <select
            value={positionFilter}
            onChange={(e) => setPositionFilter(e.target.value)}
            className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="Tất cả">Tất cả vị trí ({employeesList.length})</option>
            {positionOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label} ({employeesList.filter((e) => e.position === opt.value).length})
              </option>
            ))}
          </select>
        }
      />
      {loadError && <div className="bg-red-50 text-red-700 rounded-lg px-4 py-3 text-sm">{loadError}</div>}
      {actionError && <div className="bg-red-50 text-red-700 rounded-lg px-4 py-3 text-sm">{actionError}</div>}
      {createMessage && <div className="bg-emerald-50 text-emerald-700 rounded-lg px-4 py-3 text-sm">{createMessage}</div>}
      {credentials && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-4 py-3 text-sm flex items-start justify-between gap-4">
          <div>
            <p className="font-semibold">Thông tin đăng nhập — chỉ hiển thị một lần, hãy gửi cho nhân viên</p>
            <p className="mt-1">Tên đăng nhập: <code className="font-mono font-bold">{credentials.username}</code> · Mật khẩu tạm: <code className="font-mono font-bold">{credentials.password}</code></p>
            <p className="text-xs mt-1">Nhân viên sẽ phải đổi mật khẩu ở lần đăng nhập đầu tiên.</p>
          </div>
          <button onClick={() => setCredentials(null)} className="text-xs font-medium underline whitespace-nowrap">Đã ghi lại</button>
        </div>
      )}
      <Drawer open={createOpen} onClose={() => setCreateOpen(false)} title={editingId ? "Sửa nhân viên" : "Thêm nhân viên"} subtitle="Nhân viên bán hàng của công ty (nhận hàng theo phiếu giao xuất)">
        <div className="p-5 space-y-4">
          {createError && <div className="bg-red-50 text-red-700 rounded-lg px-3 py-2 text-sm">{createError}</div>}
          <label className="block text-xs font-medium text-gray-500">Mã nhân viên
            <input placeholder="VD: NV100" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="mt-1 w-full px-3 py-2 text-sm border rounded-lg" />
          </label>
          <label className="block text-xs font-medium text-gray-500">Họ và tên đầy đủ
            <input placeholder="VD: Mai Chí Trung" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full px-3 py-2 text-sm border rounded-lg" />
          </label>
          <label className="block text-xs font-medium text-gray-500">Tên gọi / Biệt danh (tùy chọn)
            <input placeholder="VD: Trung NPP, Tịnh xe, Hằng VNM..." value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} className="mt-1 w-full px-3 py-2 text-sm border rounded-lg" />
          </label>
          <label className="block text-xs font-medium text-gray-500">Vị trí
            <select value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} className="mt-1 w-full px-3 py-2 text-sm border rounded-lg">
              {positionOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-gray-500">Số điện thoại
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="mt-1 w-full px-3 py-2 text-sm border rounded-lg" />
          </label>
          <label className="block text-xs font-medium text-gray-500">Email (tùy chọn)
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="mt-1 w-full px-3 py-2 text-sm border rounded-lg" />
          </label>
          <label className="block text-xs font-medium text-gray-500">Mục tiêu tháng (VNĐ)
            <input type="number" min={0} value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} className="mt-1 w-full px-3 py-2 text-sm border rounded-lg" />
          </label>
          <label className="block text-xs font-medium text-gray-500">Hạn mức nợ (VNĐ)
            <input type="number" min={0} value={form.debt_limit} onChange={(e) => setForm({ ...form, debt_limit: e.target.value })} className="mt-1 w-full px-3 py-2 text-sm border rounded-lg" />
          </label>
          {editingId && Number(form.debt_limit) !== originalDebtLimit && (
            <label className="block text-xs font-medium text-gray-500 sm:col-span-2">Lý do thay đổi hạn mức
              <textarea required value={form.debt_limit_reason} onChange={(e) => setForm({ ...form, debt_limit_reason: e.target.value })} rows={2} className="mt-1 w-full px-3 py-2 text-sm border rounded-lg" placeholder="Ví dụ: điều chỉnh theo phê duyệt của quản lý" />
            </label>
          )}
          <label className="block text-xs font-medium text-gray-500">Trạng thái
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="mt-1 w-full px-3 py-2 text-sm border rounded-lg">
              <option value="active">Đang làm việc</option>
              <option value="inactive">Đã nghỉ (khóa tài khoản đăng nhập)</option>
            </select>
          </label>
          {!editingId && (
            <label className="flex items-start gap-2 text-sm text-gray-700 bg-gray-50 rounded-lg p-3">
              <input type="checkbox" checked={createAccount} onChange={(e) => setCreateAccount(e.target.checked)} className="mt-0.5" />
              <span>
                Tạo kèm tài khoản đăng nhập
                <span className="block text-xs text-gray-400 mt-0.5">
                  Tên đăng nhập = mã nhân viên. Mật khẩu tạm tự sinh, bắt buộc đổi ở lần đăng nhập đầu.
                  Quyền hệ thống được gán tự động tương ứng theo Vị trí ({form.position}).
                </span>
              </span>
            </label>
          )}
          <button onClick={saveEmployee} className="w-full bg-sky-500 text-white rounded-lg py-2.5 text-sm font-medium">{editingId ? "Lưu thay đổi" : "Lưu nhân viên"}</button>
        </div>
      </Drawer>

      <Drawer
        open={selected !== null}
        onClose={() => setSelected(null)}
        title="Hồ sơ nhân viên"
        subtitle={selected?.position}
      >
        {selected && <EmployeeProfile employee={selected} debtLimitHistory={debtLimitHistory} historyLoading={debtLimitHistoryLoading} historyError={debtLimitHistoryError} onEdit={() => openEdit(selected)} onDelete={() => void deleteEmployee(selected)} />}
      </Drawer>
    </div>
  );
}

function EmployeeProfile({ employee, debtLimitHistory, historyLoading, historyError, onEdit, onDelete }: {
  employee: Employee;
  debtLimitHistory: DebtLimitChange[];
  historyLoading: boolean;
  historyError: string;
  onEdit: () => void;
  onDelete: () => void;
}) {

  return (
    <div className="p-5 space-y-5">
      <div className="flex gap-2">
        <button onClick={onEdit} className="flex-1 flex items-center justify-center gap-2 border border-gray-200 rounded-lg py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"><Pencil size={14} />Sửa thông tin</button>
        <button onClick={onDelete} className="flex-1 flex items-center justify-center gap-2 border border-red-200 rounded-lg py-2 text-sm font-medium text-red-600 hover:bg-red-50"><Trash2 size={14} />Xóa</button>
      </div>
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-sky-500 flex items-center justify-center flex-shrink-0">
          <span className="text-white font-bold text-sm">{getInitials(employee.name)}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-gray-900 text-sm">
            {employee.name}
            {employee.nickname && (
              <span className="ml-2 font-semibold text-xs text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded border border-sky-100">
                {employee.nickname}
              </span>
            )}
          </p>
          <p className="text-xs text-gray-400">{employee.code} · {employee.territory}</p>
        </div>
        <Badge variant={employee.status === "active" ? "success" : "danger"}>
          {employee.status === "active" ? "Đang làm việc" : "Đã nghỉ"}
        </Badge>
      </div>

      <div className="rounded-xl border border-gray-100 divide-y divide-gray-50">
        <InfoRow icon={<PhoneIcon size={14} />} text={employee.phone} />
        <InfoRow icon={<Mail size={14} />} text={employee.email} />
        <InfoRow icon={<MapPin size={14} />} text={employee.territory} />
        <InfoRow icon={<CalendarDays size={14} />} text={formatDate(employee.joinDate)} />
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="rounded-xl bg-sky-50 p-3">
          <p className="text-lg font-bold text-sky-600">{employee.orders}</p>
          <p className="text-xs text-gray-400 mt-0.5">Đơn hàng</p>
        </div>
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-800">Lịch sử hạn mức công nợ</h3>
          {historyLoading ? <p className="text-xs text-gray-500">Đang tải lịch sử...</p>
            : historyError ? <p className="text-xs text-red-600">{historyError}</p>
              : debtLimitHistory.length === 0 ? <p className="text-xs text-gray-500">Chưa có lần điều chỉnh nào được ghi nhận.</p>
                : <div className="space-y-2">{debtLimitHistory.map((change) => (
                  <div key={change.id} className="rounded-lg border border-gray-100 p-3 text-xs space-y-1">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium text-gray-800">{formatVND(change.old_limit)} → {formatVND(change.new_limit)}</span>
                      <span className="text-gray-400">{formatDate(change.changed_at)}</span>
                    </div>
                    <p className="text-gray-600">{change.reason}</p>
                    <p className="text-gray-400">Thực hiện bởi {change.changed_by || "Không xác định"}</p>
                  </div>
                ))}</div>}
        </section>
        <div className="rounded-xl bg-purple-50 p-3">
          <p className="text-lg font-bold text-purple-600">{employee.customersServed}</p>
          <p className="text-xs text-gray-400 mt-0.5">Khách mua</p>
        </div>
        <div className="rounded-xl bg-emerald-50 p-3">
          <p className="text-lg font-bold text-emerald-600">{employee.newCustomers}</p>
          <p className="text-xs text-gray-400 mt-0.5">Khách mới</p>
        </div>
      </div>

      <KpiRow label="Doanh số" value={employee.achieved} max={employee.target} format={formatVND} />
      <KpiRow label="Khách hàng mới" value={employee.newCustomers} max={employee.newCustomersTarget} format={(n) => String(Math.round(n))} />
      <KpiRow label="Lượt viếng thăm" value={employee.visits} max={employee.visitTarget} format={(n) => String(Math.round(n))} />
    </div>
  );
}

function InfoRow({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <span className="text-gray-400">{icon}</span>
      <span className="text-xs text-gray-800 font-medium">{text}</span>
    </div>
  );
}

function KpiRow({ label, value, max, format }: { label: string; value: number; max: number; format: (n: number) => string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  const over = max > 0 && pct >= 100;
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1.5">
        <span className="text-gray-500 font-medium">{label}</span>
        <span className="text-gray-800 font-semibold">
          {format(value)} / {format(max)} ({pct.toFixed(0)}%)
        </span>
      </div>
      <ProgressBar value={value} max={max} color={over ? "bg-emerald-500" : pct >= 90 ? "bg-sky-500" : "bg-amber-500"} />
    </div>
  );
}
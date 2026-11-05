"use client";
/* eslint-disable react-hooks/set-state-in-effect */
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
  vinamilkCode: string | null;
}

interface BackendEmployee {
  id: number;
  code: string;
  vinamilk_code: string | null;
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

const DEFAULT_POSITION = "NhÃ¢n viÃªn kinh doanh";
const emptyForm = { code: "", name: "", nickname: "", position: DEFAULT_POSITION, phone: "", email: "", vinamilk_code: "", target: "0", debt_limit: "500000000", debt_limit_reason: "", status: "active" };

const VALID_POSITIONS = [
  "NhÃ¢n viÃªn kinh doanh",
  "Admin",
  "Sales Admin",
  "Káº¿ toÃ¡n",
  "Thá»§ kho",
];

function normalizePosition(position: string): string {
  return position || DEFAULT_POSITION;
}

function mergeWithMock(list: BackendEmployee[]): EmployeeRow[] {
  const sorted = [...list].sort((a, b) =>
    a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: "base" })
  );
  return sorted.map((item) => ({
    territory: "â€”", routes: [] as string[], orders: 0, customersServed: 0,
    newCustomersTarget: 0, newCustomers: 0, visitTarget: 0, visits: 0, achieved: 0,
    avatar: item.name.split(" ").map((word) => word[0]).filter(Boolean).slice(-2).join("").toUpperCase(),
    id: String(item.id),
    backendId: item.id,
    code: item.code,
    vinamilkCode: item.vinamilk_code ?? null,
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
  "Äá»™i xe",
  "Thá»§ kho",
  "Káº¿ toÃ¡n ná»™i bá»™",
  "Káº¿ toÃ¡n thuáº¿",
  "NVKD Sá»¯a Vinamilk",
  "NVKD Gáº¥u Äá»",
  "NVKD Nutricare",
  "NVKD Nabati",
  "NVKD Bá»‰m Mofix",
  "NVKD Thanh An",
  "NVKD Xilitol",
  "NhÃ¢n viÃªn kinh doanh",
];

function positionVariant(position: string): "default" | "success" | "warning" | "danger" | "info" | "purple" {
  if (position === "Admin") return "danger";
  if (position.includes("Sales Admin")) return "purple";
  if (position.includes("Káº¿ toÃ¡n")) return "warning";
  if (position.includes("Thá»§ kho")) return "info";
  if (position.includes("Äá»™i xe")) return "info";
  if (position.includes("Vinamilk")) return "success";
  if (position.includes("NVKD")) return "purple";
  return "default";
}

export default function EmployeesPage() {
  const [positionFilter, setPositionFilter] = useState("Táº¥t cáº£");
  const [selected, setSelected] = useState<EmployeeRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [employeesList, setEmployeesList] = useState<EmployeeRow[]>([]);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [createError, setCreateError] = useState("");
  const [createMessage, setCreateMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [createAccount, setCreateAccount] = useState(true);
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
      if (!response.ok) throw new Error("KhÃ´ng thá»ƒ táº£i danh sÃ¡ch nhÃ¢n viÃªn.");
      const data = await response.json() as BackendEmployee[];
      setEmployeesList(mergeWithMock(data));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "KhÃ´ng thá»ƒ táº£i danh sÃ¡ch nhÃ¢n viÃªn.");
    }
  }

  useEffect(() => { void load(); }, []);

  function openCreate() {
    setOriginalDebtLimit(null);
    setEditingId(null); setForm(emptyForm); setCreateAccount(true); setCreateError(""); setCreateOpen(true);
  }

  function openEdit(employee: EmployeeRow) {
    setSelected(null);
    setOriginalDebtLimit(employee.debtLimit);
    setEditingId(employee.backendId);
    setForm({
      code: employee.code, name: employee.name, nickname: employee.nickname ?? "", position: employee.position, phone: employee.phone,
      email: employee.email ?? "", vinamilk_code: employee.vinamilkCode ?? "", target: String(employee.target ?? 0),
      debt_limit: String(employee.debtLimit), debt_limit_reason: "", status: employee.status,
    });
    setCreateError(""); setCreateOpen(true);
  }

  async function saveEmployee() {
    setCreateError(""); setCreateMessage(""); setActionError("");
    if (!form.code.trim() || !form.name.trim()) { setCreateError("MÃ£ vÃ  há» tÃªn nhÃ¢n viÃªn khÃ´ng Ä‘Æ°á»£c Ä‘á»ƒ trá»‘ng."); return; }
    const changingDebtLimit = editingId !== null && Number(form.debt_limit) !== originalDebtLimit;
    if (changingDebtLimit && !form.debt_limit_reason.trim()) {
      setCreateError("Vui lÃ²ng ghi lÃ½ do khi thay Ä‘á»•i háº¡n má»©c cÃ´ng ná»£.");
      return;
    }
    try {
      const payload = {
        code: form.code.trim(), name: form.name.trim(), nickname: form.nickname.trim() || null, position: form.position,
        phone: form.phone.trim(), email: form.email.trim() || null, vinamilk_code: form.vinamilk_code.trim() || null,
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
      if (!response.ok) throw new Error(typeof result.detail === "string" ? result.detail : "KhÃ´ng thá»ƒ lÆ°u nhÃ¢n viÃªn.");
      setCreateMessage(editingId ? "ÄÃ£ cáº­p nháº­t nhÃ¢n viÃªn." : "ÄÃ£ thÃªm nhÃ¢n viÃªn.");
      setCredentials(result.initial_username && result.initial_password ? { username: result.initial_username, password: result.initial_password } : null);
      setCreateAccount(false);
      setCreateOpen(false); setEditingId(null); setSelected(null); setForm(emptyForm);
      await load();
    } catch (e) { setCreateError(e instanceof Error ? e.message : "KhÃ´ng thá»ƒ lÆ°u nhÃ¢n viÃªn."); }
  }

  async function openProfile(employee: EmployeeRow) {
    setSelected(employee);
    setDebtLimitHistory([]);
    setDebtLimitHistoryError("");
    setDebtLimitHistoryLoading(true);
    try {
      const response = await apiFetch(`${API_URL}/employees/${employee.backendId}/debt-limit-history`);
      if (!response.ok) throw new Error("KhÃ´ng thá»ƒ táº£i lá»‹ch sá»­ thay Ä‘á»•i háº¡n má»©c.");
      setDebtLimitHistory(await response.json() as DebtLimitChange[]);
    } catch (e) {
      setDebtLimitHistoryError(e instanceof Error ? e.message : "KhÃ´ng thá»ƒ táº£i lá»‹ch sá»­ háº¡n má»©c.");
    } finally {
      setDebtLimitHistoryLoading(false);
    }
  }

  async function deleteEmployee(employee: EmployeeRow) {
    if (!window.confirm(`XÃ³a nhÃ¢n viÃªn ${employee.name} (${employee.code})?`)) return;
    setActionError(""); setCreateMessage("");
    const response = await apiFetch(`${API_URL}/employees/${employee.backendId}`, { method: "DELETE" });
    if (!response.ok) {
      const result = await response.json().catch(() => ({})) as { detail?: string };
      setActionError(typeof result.detail === "string" ? result.detail : "KhÃ´ng thá»ƒ xÃ³a nhÃ¢n viÃªn.");
      setSelected(null);
      return;
    }
    setSelected(null);
    setCreateMessage(`ÄÃ£ xÃ³a nhÃ¢n viÃªn ${employee.name}.`);
    await load();
  }

  async function uploadEmployees(file: File) {
    setActionError(""); setCreateMessage("");
    const body = new FormData();
    body.append("file", file);
    const response = await apiFetch(`${API_URL}/employees/upload`, { method: "POST", body });
    const result = await response.json() as { created?: number; updated?: number; detail?: string };
    if (!response.ok) throw new Error(typeof result.detail === "string" ? result.detail : "KhÃ´ng thá»ƒ nháº­p file nhÃ¢n viÃªn.");
    setCreateMessage(`ÄÃ£ nháº­p file: thÃªm má»›i ${result.created ?? 0}, cáº­p nháº­t ${result.updated ?? 0} nhÃ¢n viÃªn.`);
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
    (e) => positionFilter === "Táº¥t cáº£" || e.position === positionFilter
  );

  const columns: Column<EmployeeRow>[] = [
    {
      key: "code",
      title: "MÃ£ NV",
      sortable: true,
      render: (val) => <span className="font-semibold text-gray-500">{String(val)}</span>,
    },
    {
      key: "name",
      title: "Há» vÃ  tÃªn Ä‘áº§y Ä‘á»§",
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
      title: "TÃªn gá»i",
      sortable: true,
      render: (val) => (
        val ? (
          <span className="font-semibold text-sky-700 bg-sky-50 px-2.5 py-1 rounded-md text-xs border border-sky-200">
            {String(val)}
          </span>
        ) : (
          <span className="text-gray-300 text-xs italic">â€”</span>
        )
      ),
    },
    {
      key: "position",
      title: "Vá»‹ trÃ­",
      sortable: true,
      render: (val) => <Badge variant={positionVariant(String(val))}>{String(val)}</Badge>,
    },
    { key: "territory", title: "Khu vá»±c", sortable: true },
    {
      key: "account",
      title: "TÃ i khoáº£n Ä‘Äƒng nháº­p",
      render: (_, row) =>
        row.accountUsername
          ? <Badge variant="success">{row.accountUsername}</Badge>
          : (
            <Link
              href={`/system?employee=${row.backendId}`}
              onClick={(event) => event.stopPropagation()}
              className="text-sky-600 hover:underline text-xs font-medium whitespace-nowrap"
            >
              <span className="text-gray-400 mr-2">ChÆ°a cÃ³ tÃ i khoáº£n</span>+ Táº¡o tÃ i khoáº£n
            </Link>
          ),
    },
    {
      key: "target",
      title: "Má»¥c tiÃªu thÃ¡ng",
      sortable: true,
      align: "right",
      render: (val) => <span className="text-gray-600">{formatVND(val as number)}</span>,
    },
    {
      key: "achieved",
      title: "Äáº¡t Ä‘Æ°á»£c",
      sortable: true,
      align: "right",
      render: (val) => <span className="font-semibold text-gray-900">{formatVND(val as number)}</span>,
    },
    {
      key: "achieved",
      title: "% Äáº¡t KPI",
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
      title: "Tráº¡ng thÃ¡i",
      sortable: true,
      render: (val) =>
        val === "active" ? <Badge variant="success">Äang lÃ m viá»‡c</Badge> : <Badge variant="danger">ÄÃ£ nghá»‰</Badge>,
    },
    {
      key: "actions",
      title: "Thao tÃ¡c",
      align: "center",
      render: (_, row) => (
        <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => openEdit(row)}
            className="p-1.5 text-gray-500 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition-colors"
            title="Sá»­a nhÃ¢n viÃªn"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={() => void deleteEmployee(row)}
            className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            title="XÃ³a nhÃ¢n viÃªn"
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
        title="NhÃ¢n viÃªn & Vá»‹ trÃ­"
        subtitle="NhÃ¢n viÃªn bÃ¡n hÃ ng cá»§a cÃ´ng ty â€” ngÆ°á»i nháº­n hÃ ng khi giao xuáº¥t theo phiáº¿u Excel"
        actions={
          <div className="flex gap-2">
            <AuthenticatedDownloadLink href={`${API_URL}/employees/template`} className="flex items-center gap-2 border border-gray-200 bg-white text-gray-700 px-3 py-2 rounded-lg text-sm font-medium"><Download size={16} />Táº£i máº«u Excel</AuthenticatedDownloadLink>
            <button onClick={() => fileInput.current?.click()} className="flex items-center gap-2 border border-gray-200 bg-white text-gray-700 px-3 py-2 rounded-lg text-sm font-medium"><Upload size={16} />Upload Excel</button>
            <input ref={fileInput} type="file" accept=".xlsx,.xlsm" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadEmployees(file).catch((e: unknown) => setActionError(e instanceof Error ? e.message : "KhÃ´ng thá»ƒ táº£i file Excel.")); event.target.value = ""; }} />
            <button onClick={openCreate} className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
              <UsersRound size={16} />
              ThÃªm nhÃ¢n viÃªn
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Tá»•ng nhÃ¢n viÃªn" value={employeesList.length} icon={<UsersRound size={20} />} color="bg-sky-50 text-sky-600" />
        <StatCard label="NV Kinh doanh" value={nvkd} icon={<Users size={20} />} color="bg-purple-50 text-purple-600" />
        <StatCard label="Äáº¡t â‰¥ 90% má»¥c tiÃªu" value={reached} icon={<Target size={20} />} color="bg-emerald-50 text-emerald-600" />
        <StatCard label="Tá»•ng doanh sá»‘ thÃ¡ng" value={formatVND(totalAchieved)} icon={<TrendingUp size={20} />} color="bg-amber-50 text-amber-600" />
      </div>

      <DataTable
        data={filtered}
        columns={columns}
        defaultSortKey="code"
        defaultSortDir="asc"
        searchKeys={["code", "name", "nickname", "phone", "territory", "email"]}
        searchPlaceholder="TÃ¬m mÃ£ NV, há» tÃªn, tÃªn gá»i, SÄT..."
        onRowClick={(row) => void openProfile(row)}
        toolbar={
          <select
            value={positionFilter}
            onChange={(e) => setPositionFilter(e.target.value)}
            className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="Táº¥t cáº£">Táº¥t cáº£ vá»‹ trÃ­ ({employeesList.length})</option>
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
            <p className="font-semibold">ThÃ´ng tin Ä‘Äƒng nháº­p â€” chá»‰ hiá»ƒn thá»‹ má»™t láº§n, hÃ£y gá»­i cho nhÃ¢n viÃªn</p>
            <p className="mt-1">TÃªn Ä‘Äƒng nháº­p: <code className="font-mono font-bold">{credentials.username}</code> Â· Máº­t kháº©u táº¡m: <code className="font-mono font-bold">{credentials.password}</code></p>
            <p className="text-xs mt-1">NhÃ¢n viÃªn sáº½ pháº£i Ä‘á»•i máº­t kháº©u á»Ÿ láº§n Ä‘Äƒng nháº­p Ä‘áº§u tiÃªn.</p>
          </div>
          <button onClick={() => setCredentials(null)} className="text-xs font-medium underline whitespace-nowrap">ÄÃ£ ghi láº¡i</button>
        </div>
      )}
      <Drawer open={createOpen} onClose={() => setCreateOpen(false)} title={editingId ? "Sá»­a nhÃ¢n viÃªn" : "ThÃªm nhÃ¢n viÃªn"} subtitle="NhÃ¢n viÃªn bÃ¡n hÃ ng cá»§a cÃ´ng ty (nháº­n hÃ ng theo phiáº¿u giao xuáº¥t)">
        <div className="p-5 space-y-4">
          {createError && <div className="bg-red-50 text-red-700 rounded-lg px-3 py-2 text-sm">{createError}</div>}
          <label className="block text-xs font-medium text-gray-500">MÃ£ nhÃ¢n viÃªn
            <input placeholder="VD: NV100" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="mt-1 w-full px-3 py-2 text-sm border rounded-lg" />
          </label>
          <label className="block text-xs font-medium text-gray-500">Há» vÃ  tÃªn Ä‘áº§y Ä‘á»§
            <input placeholder="VD: Mai ChÃ­ Trung" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full px-3 py-2 text-sm border rounded-lg" />
          </label>
          <label className="block text-xs font-medium text-gray-500">TÃªn gá»i / Biá»‡t danh (tÃ¹y chá»n)
            <input placeholder="VD: Trung NPP, Tá»‹nh xe, Háº±ng VNM..." value={form.nickname} onChange={(e) => setForm({ ...form, nickname: e.target.value })} className="mt-1 w-full px-3 py-2 text-sm border rounded-lg" />
          </label>
          <label className="block text-xs font-medium text-gray-500">MÃ£ NVBH trÃªn DMS (Vinamilk, tÃ¹y chá»n)
            <input placeholder="VD: 0000032253" value={form.vinamilk_code} onChange={(e) => setForm({ ...form, vinamilk_code: e.target.value })} className="mt-1 w-full px-3 py-2 text-sm border rounded-lg" />
            <span className="mt-1 block text-[11px] font-normal text-gray-400">DÃ¹ng Ä‘á»ƒ tá»± liÃªn káº¿t nhÃ¢n viÃªn khi nháº­p Ä‘Æ¡n MÆ°á»£n Sá»‘/Tráº£ Sá»‘ tá»« DMS.</span>
          </label>
          <label className="block text-xs font-medium text-gray-500">Vá»‹ trÃ­
            <select value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} className="mt-1 w-full px-3 py-2 text-sm border rounded-lg">
              {positionOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-gray-500">Sá»‘ Ä‘iá»‡n thoáº¡i
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="mt-1 w-full px-3 py-2 text-sm border rounded-lg" />
          </label>
          <label className="block text-xs font-medium text-gray-500">Email (tÃ¹y chá»n)
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="mt-1 w-full px-3 py-2 text-sm border rounded-lg" />
          </label>
          <label className="block text-xs font-medium text-gray-500">Má»¥c tiÃªu thÃ¡ng (VNÄ)
            <input type="number" min={0} value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} className="mt-1 w-full px-3 py-2 text-sm border rounded-lg" />
          </label>
          <label className="block text-xs font-medium text-gray-500">Háº¡n má»©c ná»£ (VNÄ)
            <input type="number" min={0} value={form.debt_limit} onChange={(e) => setForm({ ...form, debt_limit: e.target.value })} className="mt-1 w-full px-3 py-2 text-sm border rounded-lg" />
          </label>
          {editingId && Number(form.debt_limit) !== originalDebtLimit && (
            <label className="block text-xs font-medium text-gray-500 sm:col-span-2">LÃ½ do thay Ä‘á»•i háº¡n má»©c
              <textarea required value={form.debt_limit_reason} onChange={(e) => setForm({ ...form, debt_limit_reason: e.target.value })} rows={2} className="mt-1 w-full px-3 py-2 text-sm border rounded-lg" placeholder="VÃ­ dá»¥: Ä‘iá»u chá»‰nh theo phÃª duyá»‡t cá»§a quáº£n lÃ½" />
            </label>
          )}
          <label className="block text-xs font-medium text-gray-500">Tráº¡ng thÃ¡i
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="mt-1 w-full px-3 py-2 text-sm border rounded-lg">
              <option value="active">Äang lÃ m viá»‡c</option>
              <option value="inactive">ÄÃ£ nghá»‰ (khÃ³a tÃ i khoáº£n Ä‘Äƒng nháº­p)</option>
            </select>
          </label>
          {!editingId && (
            <label className="flex items-start gap-2 text-sm text-gray-700 bg-gray-50 rounded-lg p-3">
              <input type="checkbox" checked={createAccount} onChange={(e) => setCreateAccount(e.target.checked)} className="mt-0.5" />
              <span>
                Táº¡o kÃ¨m tÃ i khoáº£n Ä‘Äƒng nháº­p
                <span className="block text-xs text-gray-400 mt-0.5">
                  TÃªn Ä‘Äƒng nháº­p = mÃ£ nhÃ¢n viÃªn. Máº­t kháº©u táº¡m tá»± sinh, báº¯t buá»™c Ä‘á»•i á»Ÿ láº§n Ä‘Äƒng nháº­p Ä‘áº§u.
                  Quyá»n há»‡ thá»‘ng Ä‘Æ°á»£c gÃ¡n tá»± Ä‘á»™ng tÆ°Æ¡ng á»©ng theo Vá»‹ trÃ­ ({form.position}).
                </span>
              </span>
            </label>
          )}
          <button onClick={saveEmployee} className="w-full bg-sky-500 text-white rounded-lg py-2.5 text-sm font-medium">{editingId ? "LÆ°u thay Ä‘á»•i" : "LÆ°u nhÃ¢n viÃªn"}</button>
        </div>
      </Drawer>

      <Drawer
        open={selected !== null}
        onClose={() => setSelected(null)}
        title="Há»“ sÆ¡ nhÃ¢n viÃªn"
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
        <button onClick={onEdit} className="flex-1 flex items-center justify-center gap-2 border border-gray-200 rounded-lg py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"><Pencil size={14} />Sá»­a thÃ´ng tin</button>
        <button onClick={onDelete} className="flex-1 flex items-center justify-center gap-2 border border-red-200 rounded-lg py-2 text-sm font-medium text-red-600 hover:bg-red-50"><Trash2 size={14} />XÃ³a</button>
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
          <p className="text-xs text-gray-400">{employee.code} Â· {employee.territory}</p>
        </div>
        <Badge variant={employee.status === "active" ? "success" : "danger"}>
          {employee.status === "active" ? "Äang lÃ m viá»‡c" : "ÄÃ£ nghá»‰"}
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
          <p className="text-xs text-gray-400 mt-0.5">ÄÆ¡n hÃ ng</p>
        </div>
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-800">Lá»‹ch sá»­ háº¡n má»©c cÃ´ng ná»£</h3>
          {historyLoading ? <p className="text-xs text-gray-500">Äang táº£i lá»‹ch sá»­...</p>
            : historyError ? <p className="text-xs text-red-600">{historyError}</p>
              : debtLimitHistory.length === 0 ? <p className="text-xs text-gray-500">ChÆ°a cÃ³ láº§n Ä‘iá»u chá»‰nh nÃ o Ä‘Æ°á»£c ghi nháº­n.</p>
                : <div className="space-y-2">{debtLimitHistory.map((change) => (
                  <div key={change.id} className="rounded-lg border border-gray-100 p-3 text-xs space-y-1">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium text-gray-800">{formatVND(change.old_limit)} â†’ {formatVND(change.new_limit)}</span>
                      <span className="text-gray-400">{formatDate(change.changed_at)}</span>
                    </div>
                    <p className="text-gray-600">{change.reason}</p>
                    <p className="text-gray-400">Thá»±c hiá»‡n bá»Ÿi {change.changed_by || "KhÃ´ng xÃ¡c Ä‘á»‹nh"}</p>
                  </div>
                ))}</div>}
        </section>
        <div className="rounded-xl bg-purple-50 p-3">
          <p className="text-lg font-bold text-purple-600">{employee.customersServed}</p>
          <p className="text-xs text-gray-400 mt-0.5">KhÃ¡ch mua</p>
        </div>
        <div className="rounded-xl bg-emerald-50 p-3">
          <p className="text-lg font-bold text-emerald-600">{employee.newCustomers}</p>
          <p className="text-xs text-gray-400 mt-0.5">KhÃ¡ch má»›i</p>
        </div>
      </div>

      <KpiRow label="Doanh sá»‘" value={employee.achieved} max={employee.target} format={formatVND} />
      <KpiRow label="KhÃ¡ch hÃ ng má»›i" value={employee.newCustomers} max={employee.newCustomersTarget} format={(n) => String(Math.round(n))} />
      <KpiRow label="LÆ°á»£t viáº¿ng thÄƒm" value={employee.visits} max={employee.visitTarget} format={(n) => String(Math.round(n))} />
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
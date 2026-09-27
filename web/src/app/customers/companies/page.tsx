"use client";
// src/app/customers/companies/page.tsx
import { useEffect, useRef, useState } from "react";
import {
  Building2, CheckCircle2, Users, ShieldAlert, Plus, Download, Upload,
  Phone, MapPin, Hash, CreditCard,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import AuthenticatedDownloadLink from "@/components/ui/AuthenticatedDownloadLink";
import StatCard from "@/components/ui/StatCard";
import DataTable, { Column } from "@/components/ui/DataTable";
import Badge from "@/components/ui/Badge";
import Drawer from "@/components/ui/Drawer";
import { API_URL, apiFetch } from "@/lib/api";
import { getInitials } from "@/lib/format";

interface CompanyRow {
  id: string;
  code: string;
  name: string;
  tax_code: string;
  phone: string;
  address: string;
  status: "active" | "inactive";
  customer_count: number;
  created_at: string;
  shared?: boolean;
}

const emptyForm = { code: "", name: "", tax_code: "", phone: "", address: "", status: "active" };

export default function CompaniesPage() {
  const [rows, setRows] = useState<CompanyRow[]>([]);
  const [selected, setSelected] = useState<CompanyRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  function load() {
    apiFetch(`${API_URL}/companies/?limit=5000`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Array<Record<string, unknown>>) => {
        const base: Array<Omit<CompanyRow, "shared">> = list.map((row) => ({
          id: String(row.id), code: String(row.code ?? ""), name: String(row.name ?? ""),
          tax_code: String(row.tax_code ?? ""), phone: String(row.phone ?? ""),
          address: String(row.address ?? ""),
          status: (row.status === "inactive" ? "inactive" : "active") as CompanyRow["status"],
          customer_count: Number(row.customer_count ?? 0),
          created_at: String(row.created_at ?? ""),
        }));
        const counts: Record<string, number> = {};
        base.forEach((c) => { if (c.tax_code) counts[c.tax_code] = (counts[c.tax_code] ?? 0) + 1; });
        setRows(base.map((c) => ({ ...c, shared: Boolean(c.tax_code && counts[c.tax_code]! > 1) })));
      })
      .catch(() => setError("Không thể tải danh sách công ty quản lý."));
  }

  useEffect(() => { load(); }, []);

  async function uploadCompanies(file: File) {
    const body = new FormData();
    body.append("file", file);
    const response = await apiFetch(`${API_URL}/companies/upload`, { method: "POST", body });
    const result = await response.json() as { imported?: number; detail?: string };
    if (!response.ok) throw new Error(result.detail ?? "Không thể nhập file công ty.");
    setMessage(`Đã nhập ${result.imported ?? 0} công ty.`);
    load();
  }

  async function saveCompany() {
    setError(""); setMessage("");
    try {
      const response = await apiFetch(`${API_URL}/companies/${editingId ? editingId : ""}`, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, status: form.status || "active" }),
      });
      const result = await response.json() as { detail?: string; code?: string; tax_code?: string | null };
      if (!response.ok) throw new Error(result.detail ?? "Không thể lưu công ty.");
      setMessage(editingId ? "Đã cập nhật công ty." : `Đã tạo công ty ${result.code}.`);
      setCreateOpen(false); setEditingId(null); setSelected(null); setError("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể lưu công ty.");
    }
  }

  async function deleteCompany(company: CompanyRow) {
    if (!window.confirm(`Xóa công ty ${company.name}? Các mã khách hàng sẽ không bị xóa.`)) return;
    const response = await apiFetch(`${API_URL}/companies/${company.id}`, { method: "DELETE" });
    const result = await response.json().catch(() => ({})) as { detail?: string };
    if (!response.ok) throw new Error(result.detail ?? "Không thể xóa công ty.");
    setRows((current) => current.filter((item) => item.id !== company.id));
    setSelected(null);
    setMessage("Đã xóa công ty quản lý.");
  }

  function openEdit(company: CompanyRow) {
    setEditingId(company.id);
    setForm({
      code: company.code, name: company.name, tax_code: company.tax_code,
      phone: company.phone, address: company.address, status: company.status,
    });
    setCreateOpen(true);
  }

  const activeCount = rows.filter((c) => c.status === "active").length;
  const sharedCount = rows.filter((c) => c.shared).length;
  const managedCodes = rows.reduce((sum, c) => sum + (c.customer_count || 0), 0);
const columns: Column<CompanyRow>[] = [
    { key: "code", title: "Mã công ty", sortable: true },
    { key: "name", title: "Tên công ty", sortable: true },
    {
      key: "tax_code",
      title: "Mã số thuế",
      render: (_, row) =>
        row.tax_code ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="text-gray-700">{row.tax_code}</span>
            {row.shared && <Badge variant="warning">Dùng chung</Badge>}
          </span>
        ) : (
          <span className="text-gray-400">—</span>
        ),
    },
    {
      key: "customer_count",
      title: "Số KH quản lý",
      align: "center",
      render: (val) => <Badge variant={(val as number) > 0 ? "info" : "default"}>{String(val)}</Badge>,
    },
    { key: "phone", title: "Điện thoại" },
    {
      key: "status",
      title: "Trạng thái",
      sortable: true,
      render: (val) =>
        val === "active" ? <Badge variant="success">Hoạt động</Badge> : <Badge variant="danger">Ngưng giao</Badge>,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Công ty quản lý"
        subtitle="Công ty xuất hóa đơn, công ty con của đơn vị phân phối — nhiều công ty có thể dùng chung một mã số thuế"
        actions={
          <div className="flex gap-2">
            <AuthenticatedDownloadLink href={`${API_URL}/companies/template`} className="flex items-center gap-2 border border-gray-200 bg-white text-gray-700 px-3 py-2 rounded-lg text-sm font-medium"><Download size={16} />Tải mẫu Excel</AuthenticatedDownloadLink>
            <button onClick={() => fileInput.current?.click()} className="flex items-center gap-2 border border-gray-200 bg-white text-gray-700 px-3 py-2 rounded-lg text-sm font-medium"><Upload size={16} />Upload Excel</button>
            <input ref={fileInput} type="file" accept=".xlsx,.xlsm" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadCompanies(file).catch((e: unknown) => setError(e instanceof Error ? e.message : "Không thể tải file Excel.")); event.target.value = ""; }} />
            <button
              onClick={() => { setEditingId(null); setForm(emptyForm); setError(""); setCreateOpen(true); }}
              className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <Plus size={16} />Thêm công ty
            </button>
          </div>
        }
      />

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>}
      {message && <div className="bg-emerald-50 text-emerald-700 rounded-lg px-4 py-3 text-sm">{message}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Tổng công ty" value={rows.length} icon={<Building2 size={20} />} color="bg-sky-50 text-sky-600" />
        <StatCard label="Đang hoạt động" value={activeCount} icon={<CheckCircle2 size={20} />} color="bg-emerald-50 text-emerald-600" />
        <StatCard label="Công ty dùng chung MST" value={sharedCount} icon={<ShieldAlert size={20} />} color="bg-amber-50 text-amber-600" />
        <StatCard label="Mã KH đang quản lý" value={managedCodes} icon={<Users size={20} />} color="bg-purple-50 text-purple-600" />
      </div>

      <DataTable
        data={rows}
        columns={columns}
        searchKeys={["code", "name", "tax_code", "phone", "address"]}
        searchPlaceholder="Tìm mã, tên công ty, MST..."
        onRowClick={(row) => setSelected(row)}
        emptyMessage="Chưa có công ty quản lý nào"
        toolbar={
          <button
            onClick={() => { setEditingId(null); setForm(emptyForm); setError(""); setCreateOpen(true); }}
            className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus size={16} />Thêm công ty
          </button>
        }
      />
<Drawer open={createOpen} onClose={() => setCreateOpen(false)} title={editingId ? "Sửa công ty" : "Thêm công ty"} subtitle="Công ty quản lý / xuất hóa đơn">
        <div className="p-5 space-y-4">
          {error && <div className="bg-red-50 text-red-700 rounded-lg px-3 py-2 text-sm">{error}</div>}
          <input disabled={Boolean(editingId)} placeholder="Mã công ty" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="w-full px-3 py-2 text-sm border rounded-lg disabled:bg-gray-100" />
          <input placeholder="Tên công ty" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 text-sm border rounded-lg" />
          <input placeholder="Mã số thuế (có thể trùng với công ty khác)" value={form.tax_code} onChange={(e) => setForm({ ...form, tax_code: e.target.value })} className="w-full px-3 py-2 text-sm border rounded-lg" />
          <input placeholder="Điện thoại" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full px-3 py-2 text-sm border rounded-lg" />
          <input placeholder="Địa chỉ" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="w-full px-3 py-2 text-sm border rounded-lg" />
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full px-3 py-2 text-sm border rounded-lg">
            <option value="active">Hoạt động</option>
            <option value="inactive">Ngưng giao</option>
          </select>
          <button onClick={saveCompany} className="w-full bg-sky-500 text-white rounded-lg py-2.5 text-sm font-medium">{editingId ? "Cập nhật công ty" : "Lưu công ty"}</button>
        </div>
      </Drawer>
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
              <InfoRow icon={<Hash size={14} />} label="Mã số thuế" value={selected.tax_code || "—"} extra={selected.shared ? <Badge variant="warning">Dùng chung</Badge> : undefined} />
              <InfoRow icon={<Phone size={14} />} label="Điện thoại" value={selected.phone || "—"} />
              <InfoRow icon={<MapPin size={14} />} label="Địa chỉ" value={selected.address || "—"} />
              <InfoRow icon={<CreditCard size={14} />} label="Mã KH quản lý" value={String(selected.customer_count)} />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => openEdit(selected)} className="rounded-lg border border-sky-200 py-2 text-sm font-medium text-sky-600 hover:bg-sky-50">Sửa công ty</button>
              <button onClick={() => deleteCompany(selected).catch((e: unknown) => setError(e instanceof Error ? e.message : "Không thể xóa công ty."))} className="rounded-lg border border-red-200 py-2 text-sm font-medium text-red-600 hover:bg-red-50">Xóa công ty</button>
            </div>
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
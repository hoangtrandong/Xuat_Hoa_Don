"use client";
// src/app/customers/stores/page.tsx
import { useEffect, useRef, useState } from "react";
import {
  Store as StoreIcon, CheckCircle2, Building2, Plus, Download, Upload,
  Phone, MapPin, User,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import AuthenticatedDownloadLink from "@/components/ui/AuthenticatedDownloadLink";
import StatCard from "@/components/ui/StatCard";
import DataTable, { Column } from "@/components/ui/DataTable";
import Badge from "@/components/ui/Badge";
import Drawer from "@/components/ui/Drawer";
import { API_URL, apiFetch } from "@/lib/api";
import { getInitials } from "@/lib/format";

interface StoreRow {
  id: string;
  code: string;
  name: string;
  phone: string;
  owner_name: string;
  address: string;
  district: string;
  city: string;
  status: "active" | "inactive";
  created_at: string;
}

const emptyForm = {
  code: "", name: "", phone: "", owner_name: "", address: "",
  district: "", city: "", status: "active",
};

export default function StoresPage() {
  const [rows, setRows] = useState<StoreRow[]>([]);
  const [detail, setDetail] = useState<StoreRow | null>(null);
  const [companyCount, setCompanyCount] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    apiFetch(`${API_URL}/stores/?limit=5000`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Array<Record<string, unknown>>) => setRows(list.map((row) => ({
        id: String(row.id), code: String(row.code ?? ""), name: String(row.name ?? ""),
        phone: String(row.phone ?? ""), owner_name: String(row.owner_name ?? ""),
        address: String(row.address ?? ""),
        district: String(row.district ?? ""), city: String(row.city ?? ""),
        status: row.status === "inactive" ? "inactive" : "active",
        created_at: String(row.created_at ?? ""),
      }))))
      .catch(() => setError("Không thể tải danh sách cửa hàng."));
    apiFetch(`${API_URL}/companies/?limit=5000`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Array<Record<string, unknown>>) => setCompanyCount(list.length));
  }, []);

  async function openDetail(store: StoreRow) {
    try {
      const response = await apiFetch(`${API_URL}/stores/${store.id}`);
      if (!response.ok) throw new Error("Không thể tải chi tiết cửa hàng.");
      setDetail(await response.json() as StoreRow);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể tải chi tiết cửa hàng.");
    }
  }

  async function uploadStores(file: File) {
    const body = new FormData();
    body.append("file", file);
    const response = await apiFetch(`${API_URL}/stores/upload`, { method: "POST", body });
    const result = await response.json() as { imported?: number; detail?: string };
    if (!response.ok) throw new Error(result.detail ?? "Không thể nhập file cửa hàng.");
    setMessage(`Đã nhập ${result.imported ?? 0} cửa hàng.`);
    window.location.reload();
  }

  async function saveStore() {
    setError(""); setMessage("");
    try {
      const response = await apiFetch(`${API_URL}/stores/${editingId ? editingId : ""}`, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, status: form.status || "active" }),
      });
      const result = await response.json() as { detail?: string; id?: number; code?: string };
      if (!response.ok) throw new Error(result.detail ?? "Không thể lưu cửa hàng.");
      setMessage(editingId ? "Đã cập nhật cửa hàng." : `Đã tạo cửa hàng ${result.code}.`);
      setCreateOpen(false); setEditingId(null); setDetail(null);
      const updated = await apiFetch(`${API_URL}/stores/?limit=5000`);
      if (updated.ok) {
        setRows((await updated.json() as Array<Record<string, unknown>>).map((row) => ({
          id: String(row.id), code: String(row.code ?? ""), name: String(row.name ?? ""),
          phone: String(row.phone ?? ""), owner_name: String(row.owner_name ?? ""),
          tax_code: String(row.tax_code ?? ""), address: String(row.address ?? ""),
          district: String(row.district ?? ""), city: String(row.city ?? ""),
          status: row.status === "inactive" ? "inactive" : "active",
          created_at: String(row.created_at ?? ""),
        })));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể lưu cửa hàng.");
    }
  }

  async function deleteStore(store: StoreRow) {
    if (!window.confirm(`Xóa cửa hàng ${store.name}?`)) return;
    const response = await apiFetch(`${API_URL}/stores/${store.id}`, { method: "DELETE" });
    const result = await response.json().catch(() => ({})) as { detail?: string };
    if (!response.ok) throw new Error(result.detail ?? "Không thể xóa cửa hàng.");
    setRows((current) => current.filter((item) => item.id !== store.id));
    setDetail(null);
    setMessage("Đã xóa cửa hàng.");
  }

  function openEdit(store: StoreRow) {
    setEditingId(store.id);
    setForm({
      code: store.code, name: store.name, phone: store.phone, owner_name: store.owner_name,
      address: store.address, district: store.district,
      city: store.city, status: store.status,
    });
    setCreateOpen(true);
  }

  const activeCount = rows.filter((s) => s.status === "active").length;

  const columns: Column<StoreRow>[] = [
    { key: "code", title: "Mã cửa hàng", sortable: true },
    {
      key: "name",
      title: "Tên cửa hàng",
      sortable: true,
      render: (_, row) => (
        <div>
          <p className="font-medium text-gray-900">{row.name}</p>
          <p className="text-xs text-gray-400">{row.address || row.district || row.city || ""}</p>
        </div>
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
  ];
return (
    <div className="space-y-6">
      <PageHeader
        title="Cửa hàng & điểm bán"
        subtitle="Thông tin điểm bán / cửa hàng"
        actions={
          <div className="flex gap-2">
            <AuthenticatedDownloadLink href={`${API_URL}/stores/template`} className="flex items-center gap-2 border border-gray-200 bg-white text-gray-700 px-3 py-2 rounded-lg text-sm font-medium"><Download size={16} />Tải mẫu Excel</AuthenticatedDownloadLink>
            <button onClick={() => fileInput.current?.click()} className="flex items-center gap-2 border border-gray-200 bg-white text-gray-700 px-3 py-2 rounded-lg text-sm font-medium"><Upload size={16} />Upload Excel</button>
            <input ref={fileInput} type="file" accept=".xlsx,.xlsm" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadStores(file).catch((e: unknown) => setError(e instanceof Error ? e.message : "Không thể tải file Excel.")); event.target.value = ""; }} />
            <button
              onClick={() => { setEditingId(null); setForm(emptyForm); setError(""); setCreateOpen(true); }}
              className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <Plus size={16} />Thêm cửa hàng
            </button>
          </div>
        }
      />

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>}
      {message && <div className="bg-emerald-50 text-emerald-700 rounded-lg px-4 py-3 text-sm">{message}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label="Tổng cửa hàng" value={rows.length} icon={<StoreIcon size={20} />} color="bg-sky-50 text-sky-600" />
        <StatCard label="Đang hoạt động" value={activeCount} icon={<CheckCircle2 size={20} />} color="bg-emerald-50 text-emerald-600" />
        <StatCard label="Công ty quản lý" value={companyCount} icon={<Building2 size={20} />} color="bg-amber-50 text-amber-600" />
      </div>

      <DataTable
        data={rows}
        columns={columns}
        searchKeys={["code", "name", "phone", "address", "district"]}
        searchPlaceholder="Tìm mã, tên cửa hàng, địa chỉ..."
        onRowClick={(row) => openDetail(row)}
        emptyMessage="Chưa có cửa hàng nào"
      />

      <Drawer open={createOpen} onClose={() => setCreateOpen(false)} title={editingId ? "Sửa cửa hàng" : "Thêm cửa hàng"} subtitle="Thông tin điểm bán / cửa hàng">
        <div className="p-5 space-y-4">
          {error && <div className="bg-red-50 text-red-700 rounded-lg px-3 py-2 text-sm">{error}</div>}
          <input disabled={Boolean(editingId)} placeholder="Mã cửa hàng" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="w-full px-3 py-2 text-sm border rounded-lg disabled:bg-gray-100" />
          <input placeholder="Tên cửa hàng" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 text-sm border rounded-lg" />
          <input placeholder="Điện thoại" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full px-3 py-2 text-sm border rounded-lg" />
          <input placeholder="Chủ hộ / người kinh doanh" value={form.owner_name} onChange={(e) => setForm({ ...form, owner_name: e.target.value })} className="w-full px-3 py-2 text-sm border rounded-lg" />
          <input placeholder="Địa chỉ" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="w-full px-3 py-2 text-sm border rounded-lg" />
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="Huyện" value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} className="w-full px-3 py-2 text-sm border rounded-lg" />
            <input placeholder="Tỉnh/TP" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="w-full px-3 py-2 text-sm border rounded-lg" />
          </div>
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full px-3 py-2 text-sm border rounded-lg">
            <option value="active">Hoạt động</option>
            <option value="inactive">Ngưng giao</option>
          </select>
          <button onClick={saveStore} className="w-full bg-sky-500 text-white rounded-lg py-2.5 text-sm font-medium">{editingId ? "Cập nhật cửa hàng" : "Lưu cửa hàng"}</button>
        </div>
      </Drawer>
<Drawer open={detail !== null} onClose={() => setDetail(null)} title="Chi tiết cửa hàng" subtitle={detail?.name}>
        {detail && (
          <div className="p-5 space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-sky-500 flex items-center justify-center flex-shrink-0">
                <span className="text-white font-bold text-sm">{getInitials(detail.name)}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-gray-900 text-sm truncate">{detail.name}</p>
                <p className="text-xs text-gray-400">{detail.code} · {detail.district || detail.city || "—"}</p>
              </div>
              <Badge variant={detail.status === "active" ? "success" : "danger"}>
                {detail.status === "active" ? "Hoạt động" : "Ngưng giao"}
              </Badge>
            </div>

            <div className="rounded-xl border border-gray-100 divide-y divide-gray-50">
              <InfoRow icon={<Phone size={14} />} label="Điện thoại" value={detail.phone || "—"} />
              <InfoRow icon={<User size={14} />} label="Chủ hộ" value={detail.owner_name || "—"} />
              <InfoRow icon={<MapPin size={14} />} label="Địa chỉ" value={[detail.address, detail.district, detail.city].filter(Boolean).join(", ") || "—"} />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => openEdit(detail)} className="rounded-lg border border-sky-200 py-2 text-sm font-medium text-sky-600 hover:bg-sky-50">Sửa cửa hàng</button>
              <button onClick={() => deleteStore(detail).catch((e: unknown) => setError(e instanceof Error ? e.message : "Không thể xóa cửa hàng."))} className="rounded-lg border border-red-200 py-2 text-sm font-medium text-red-600 hover:bg-red-50">Xóa cửa hàng</button>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <span className="text-gray-400 flex-shrink-0 mt-0.5">{icon}</span>
      <span className="text-xs text-gray-400 w-28 flex-shrink-0 leading-5">{label}</span>
      <span className="text-xs text-gray-800 font-medium leading-5 break-words">{value}</span>
    </div>
  );
}
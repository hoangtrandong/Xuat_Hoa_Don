"use client";
// src/app/customers/page.tsx
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Users, CheckCircle2, Wallet, AlertTriangle, Plus, Download, Upload } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import DataTable, { Column } from "@/components/ui/DataTable";
import Badge from "@/components/ui/Badge";
import Drawer from "@/components/ui/Drawer";
import CustomerDetail from "@/components/customers/CustomerDetail";
import type { Customer } from "@/lib/mock-customers";
import { formatVND, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { API_URL } from "@/lib/api";
const customerTypes = ["Đại lý", "Cửa hàng", "Nhà phân phối", "HORECA"];

function typeVariant(type: string) {
  if (type === "Nhà phân phối") return "purple";
  if (type === "Đại lý") return "info";
  if (type === "HORECA") return "warning";
  return "default";
}

export default function CustomersPage() {
  const router = useRouter();
  const [typeFilter, setTypeFilter] = useState("Tất cả");
  const [statusFilter, setStatusFilter] = useState("Tất cả");
  const [routeFilter, setRouteFilter] = useState("Tất cả");
  const [selected, setSelected] = useState<Customer | null>(null);
  const [customerRows, setCustomerRows] = useState<Customer[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", type: "RETAIL", tier: "B", phone: "", email: "", citizen_id: "", tax_code: "", status: "active" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [createError, setCreateError] = useState("");
  const [createMessage, setCreateMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    fetch(`${API_URL}/customers/?limit=5000`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Không thể tải danh sách khách hàng.");
        return response.json() as Promise<Array<Record<string, unknown>>>;
      })
      .then((rows) => setCustomerRows(rows.map((row) => ({
        id: String(row.id), code: String(row.code ?? ""), name: String(row.name ?? ""),
        type: row.type === "DISTRIBUTOR" ? "Nhà phân phối" : row.type === "WHOLESALE" ? "Đại lý" : row.type === "HORECA" ? "HORECA" : "Cửa hàng",
        tier: (String(row.tier ?? "B") as Customer["tier"]), phone: String(row.phone ?? ""),
        contactName: "", email: String(row.email ?? ""), address: "", district: "",
        routeCode: "", routeName: "", salesRep: "", status: row.status === "inactive" ? "inactive" : "active",
        debitBalance: Number(row.current_debt ?? 0), totalSpend: 0, lastVisit: "", visitCount: 0,
        createdAt: String(row.created_at ?? ""),
      }))))
      .catch((error: unknown) => setCreateError(error instanceof Error ? error.message : "Không thể tải khách hàng."));
  }, []);
  async function uploadCustomers(file: File) {
    const body = new FormData();
    body.append("file", file);
    const response = await fetch(`${API_URL}/customers/upload`, { method: "POST", body });
    const result = await response.json() as { imported?: number; detail?: string };
    if (!response.ok) throw new Error(result.detail ?? "Không thể tải danh sách khách hàng.");
    setCreateMessage(`Đã nhập ${result.imported ?? 0} khách hàng vào PostgreSQL.`);
    window.location.reload();
  }
  async function createCustomer() {
    setCreateError(""); setCreateMessage("");
    try {
      const response = await fetch(`${API_URL}/customers/${editingId ? editingId : ""}`, { method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const result = await response.json() as {
        detail?: string;
        id: number;
        code: string;
        name: string;
        type: string;
        tier: "A" | "B" | "C";
        phone: string;
        email: string | null;
        citizen_id: string | null;
        tax_code: string | null;
        status: "active" | "inactive";
        current_debt: number;
        created_at: string;
      };
      if (!response.ok) throw new Error(result.detail ?? "Không thể tạo khách hàng.");
      const typeLabel: Customer["type"] = result.type === "DISTRIBUTOR"
        ? "Nhà phân phối"
        : result.type === "WHOLESALE"
          ? "Đại lý"
          : result.type === "HORECA"
            ? "HORECA"
            : "Cửa hàng";
      const mapped: Customer = {
        id: String(result.id),
        code: result.code,
        name: result.name,
        type: typeLabel,
        tier: result.tier,
        phone: result.phone,
        contactName: "",
        email: result.email ?? "",
        citizenId: result.citizen_id ?? "",
        taxCode: result.tax_code ?? "",
        address: "",
        district: "",
        routeCode: "",
        routeName: "",
        salesRep: "",
        status: result.status,
        debitBalance: result.current_debt,
        totalSpend: 0,
        lastVisit: "",
        visitCount: 0,
        createdAt: result.created_at,
      };
      setCustomerRows((current) => editingId ? current.map((item) => item.id === editingId ? { ...item, ...mapped } : item) : [mapped, ...current]);
      setCreateMessage(editingId ? "Đã cập nhật khách hàng." : "Đã tạo khách hàng thành công trong PostgreSQL."); setCreateOpen(false); setEditingId(null);
    } catch (e) { setCreateError(e instanceof Error ? e.message : "Không thể tạo khách hàng."); }
  }
  function openEdit(customer: Customer) {
    setEditingId(customer.id);
    setForm({ code: customer.code, name: customer.name, type: customer.type === "Cửa hàng" ? "RETAIL" : customer.type === "Đại lý" ? "WHOLESALE" : customer.type === "Nhà phân phối" ? "DISTRIBUTOR" : "HORECA", tier: customer.tier, phone: customer.phone, email: customer.email, citizen_id: customer.citizenId ?? "", tax_code: customer.taxCode ?? "", status: customer.status });
    setSelected(null); setCreateError(""); setCreateOpen(true);
  }
  async function deleteCustomer(customer: Customer) {
    if (!window.confirm(`Xóa khách hàng ${customer.name}?`)) return;
    const response = await fetch(`${API_URL}/customers/${customer.id}`, { method: "DELETE" });
    const result = await response.json().catch(() => ({})) as { detail?: string };
    if (!response.ok) throw new Error(result.detail ?? "Không thể xóa khách hàng.");
    setCustomerRows((current) => current.filter((item) => item.id !== customer.id));
    setSelected(null); setCreateMessage("Đã xóa khách hàng.");
  }

  const activeCount = customerRows.filter((c) => c.status === "active").length;
  const debtCount = customerRows.filter((c) => c.debitBalance > 0).length;
  const totalDebt = customerRows.reduce((s, c) => s + c.debitBalance, 0);

  const filtered = customerRows.filter((c) => {
    if (typeFilter !== "Tất cả" && c.type !== typeFilter) return false;
    if (statusFilter !== "Tất cả" && c.status !== statusFilter) return false;
    if (routeFilter !== "Tất cả" && c.routeCode !== routeFilter) return false;
    return true;
  });

  const columns: Column<Customer>[] = [
    { key: "code", title: "Mã KH", sortable: true },
    {
      key: "name",
      title: "Tên khách hàng",
      sortable: true,
      render: (_, row) => (
        <div>
          <p className="font-medium text-gray-900">{row.name}</p>
          <p className="text-xs text-gray-400">{row.district}</p>
        </div>
      ),
    },
    {
      key: "type",
      title: "Loại",
      sortable: true,
      render: (val) => <Badge variant={typeVariant(String(val))}>{String(val)}</Badge>,
    },
    {
      key: "tier",
      title: "Hạng",
      render: (val) => <span className="font-semibold text-gray-500">Tier {String(val)}</span>,
    },
    { key: "phone", title: "Số điện thoại" },
    { key: "citizenId", title: "CCCD" },
    { key: "taxCode", title: "Mã số thuế" },
    {
      key: "routeCode",
      title: "Tuyến",
      sortable: true,
      render: (val) => <Badge variant="default">{String(val)}</Badge>,
    },
    { key: "salesRep", title: "NVKD", sortable: true },
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
      key: "lastVisit",
      title: "Ghé thăm gần nhất",
      sortable: true,
      render: (val) => (
        <span className="text-gray-600">{val ? formatDate(String(val)) : "Chưa ghé"}</span>
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
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Khách hàng & Đại lý"
        subtitle="Quản lý khách hàng, cửa hàng, đại lý trên toàn hệ thống"
        actions={
          <div className="flex gap-2">
          <a href={`${API_URL}/customers/template`} className="flex items-center gap-2 border border-gray-200 bg-white text-gray-700 px-3 py-2 rounded-lg text-sm font-medium"><Download size={16} />Tải mẫu Excel</a>
          <button onClick={() => fileInput.current?.click()} className="flex items-center gap-2 border border-gray-200 bg-white text-gray-700 px-3 py-2 rounded-lg text-sm font-medium"><Upload size={16} />Upload Excel</button>
          <input ref={fileInput} type="file" accept=".xlsx,.xlsm" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadCustomers(file).catch((error: unknown) => setCreateError(error instanceof Error ? error.message : "Không thể tải file Excel.")); event.target.value = ""; }} />
          <button onClick={() => { setEditingId(null); setForm({ code: "", name: "", type: "RETAIL", tier: "B", phone: "", email: "", citizen_id: "", tax_code: "", status: "active" }); setCreateError(""); setCreateOpen(true); }}  className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            <Plus size={16} />
            Thêm khách hàng
          </button>
          </div>
        }
      />

      {createError && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{createError}</div>}
      {createMessage && <div className="bg-emerald-50 text-emerald-700 rounded-lg px-4 py-3 text-sm">{createMessage}</div>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Tổng khách hàng" value={customerRows.length} icon={<Users size={20} />} color="bg-sky-50 text-sky-600" />
        <StatCard label="Đang hoạt động" value={activeCount} icon={<CheckCircle2 size={20} />} color="bg-emerald-50 text-emerald-600" />
        <StatCard label="Khách đang nợ" value={debtCount} icon={<AlertTriangle size={20} />} color="bg-amber-50 text-amber-600" />
        <StatCard label="Tổng công nợ" value={formatVND(totalDebt)} icon={<Wallet size={20} />} color="bg-rose-50 text-rose-600" />
      </div>

      <DataTable
        data={filtered}
        columns={columns}
        searchKeys={["code", "name", "phone", "district", "salesRep"]}
        searchPlaceholder="Tìm mã, tên, điện thoại..."
        onRowClick={(row) => setSelected(row)}
        emptyMessage="Không có khách hàng phù hợp"
        toolbar={
          <>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="Tất cả">Tất cả loại</option>
              {customerTypes.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <select
              value={routeFilter}
              onChange={(e) => setRouteFilter(e.target.value)}
              className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="Tất cả">Tất cả tuyến</option>
              {["TX.01", "TX.02", "TX.03", "TX.04", "TX.05"].map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="Tất cả">Tất cả trạng thái</option>
              <option value="active">Hoạt động</option>
              <option value="inactive">Ngưng giao</option>
            </select>
          </>
        }
      />
      {createMessage && <div className="bg-emerald-50 text-emerald-700 rounded-lg px-4 py-3 text-sm">{createMessage}</div>}
      <Drawer open={createOpen} onClose={() => setCreateOpen(false)} title={editingId ? "Sửa khách hàng" : "Thêm khách hàng"} subtitle="Lưu thông tin khách hàng trong PostgreSQL">
        <div className="p-5 space-y-4">
          {createError && <div className="bg-red-50 text-red-700 rounded-lg px-3 py-2 text-sm">{createError}</div>}
          <input disabled={Boolean(editingId)} placeholder="Mã khách hàng" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="w-full px-3 py-2 text-sm border rounded-lg disabled:bg-gray-100" />
          <input placeholder="Tên khách hàng" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 text-sm border rounded-lg" />
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full px-3 py-2 text-sm border rounded-lg"><option value="RETAIL">Cửa hàng</option><option value="DISTRIBUTOR">Nhà phân phối</option><option value="WHOLESALE">Đại lý</option><option value="HORECA">HORECA</option></select>
          <select value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })} className="w-full px-3 py-2 text-sm border rounded-lg"><option>A</option><option>B</option><option>C</option></select>
          <input placeholder="Số điện thoại" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full px-3 py-2 text-sm border rounded-lg" />
          <input placeholder="CCCD (tùy chọn)" value={form.citizen_id} onChange={(e) => setForm({ ...form, citizen_id: e.target.value })} className="w-full px-3 py-2 text-sm border rounded-lg" />
          <input placeholder="Mã số thuế (tùy chọn)" value={form.tax_code} onChange={(e) => setForm({ ...form, tax_code: e.target.value })} className="w-full px-3 py-2 text-sm border rounded-lg" />
          <input placeholder="Email (tùy chọn)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-3 py-2 text-sm border rounded-lg" />
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full px-3 py-2 text-sm border rounded-lg"><option value="active">Hoạt động</option><option value="inactive">Ngưng giao</option></select>
          <button onClick={createCustomer} className="w-full bg-sky-500 text-white rounded-lg py-2.5 text-sm font-medium">{editingId ? "Cập nhật khách hàng" : "Lưu khách hàng"}</button>
        </div>
      </Drawer>

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
            onDelete={() => deleteCustomer(selected).catch((error: unknown) => setCreateError(error instanceof Error ? error.message : "Không thể xóa khách hàng."))}
          />
        )}
      </Drawer>
    </div>
  );
}
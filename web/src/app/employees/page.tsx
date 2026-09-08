"use client";
// src/app/employees/page.tsx
import { useState } from "react";
import { UsersRound, Users, Target, Phone as PhoneIcon, MapPin, CalendarDays, Route as RouteIcon, TrendingUp, Mail } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import DataTable, { Column } from "@/components/ui/DataTable";
import Badge from "@/components/ui/Badge";
import Drawer from "@/components/ui/Drawer";
import ProgressBar from "@/components/ui/ProgressBar";
import { employees as defaultEmployees, type Employee } from "@/lib/mock-employees";
import { formatVND, formatDate, getInitials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { API_URL } from "@/lib/api";

const avatarColors = ["bg-sky-500", "bg-purple-500", "bg-amber-500", "bg-emerald-500", "bg-rose-500", "bg-indigo-500"];

const POSITION_OPTIONS = [
  { value: "Nhân viên kinh doanh", label: "Nhân viên kinh doanh" },
  { value: "Giám sát", label: "Giám sát" },
  { value: "Giám đốc vùng", label: "Giám đốc vùng" },
];

function positionVariant(position: string) {
  if (position === "Giám đốc vùng") return "purple";
  if (position === "Giám sát") return "info";
  return "default";
}

export default function EmployeesPage() {
  const [positionFilter, setPositionFilter] = useState("Tất cả");
  const [selected, setSelected] = useState<Employee | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [employeesList, setEmployeesList] = useState<Employee[]>(defaultEmployees);
  const [form, setForm] = useState({ code: "", name: "", position: "Nhân viên kinh doanh", phone: "", email: "" });
  const [createError, setCreateError] = useState("");
  const [createMessage, setCreateMessage] = useState("");
  async function createEmployee() {
    setCreateError(""); setCreateMessage("");
    try {
      const response = await fetch(`${API_URL}/employees/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const result = await response.json() as { detail?: string; id?: number; code?: string; name?: string; position?: string; phone?: string; email?: string };
      if (!response.ok) throw new Error(result.detail ?? "Không thể tạo nhân viên.");
      // Thêm nhân viên mới vào state local để hiển thị ngay lập tức
      const newEmployee: Employee = {
        id: result.code || form.code,
        code: form.code,
        name: form.name,
        position: form.position as Employee["position"],
        territory: "",
        routes: [],
        phone: form.phone,
        email: form.email,
        status: "active",
        joinDate: new Date().toISOString().split("T")[0],
        target: 0,
        achieved: 0,
        orders: 0,
        customersServed: 0,
        newCustomersTarget: 0,
        newCustomers: 0,
        visitTarget: 0,
        visits: 0,
        avatar: form.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase(),
      };
      setEmployeesList((prev) => [...prev, newEmployee]);
      setCreateMessage("Đã tạo nhân viên thành công trong PostgreSQL."); setCreateOpen(false);
      // Reset form
      setForm({ code: "", name: "", position: "Nhân viên kinh doanh", phone: "", email: "" });
    } catch (e) { setCreateError(e instanceof Error ? e.message : "Không thể tạo nhân viên."); }
  }

    const nvkd = employeesList.filter((e) => e.position === "Nhân viên kinh doanh").length;
  const totalAchieved = employeesList.reduce((s, e) => s + e.achieved, 0);
  const reached = employeesList.filter((e) => e.achieved >= e.target * 0.9).length;

  const filtered = employeesList.filter(
    (e) => positionFilter === "Tất cả" || e.position === positionFilter
  );

  const columns: Column<Employee>[] = [
    {
      key: "code",
      title: "Mã NV",
      sortable: true,
      render: (val) => <span className="font-semibold text-gray-500">{String(val)}</span>,
    },
    {
      key: "name",
      title: "Nhân viên",
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
      key: "position",
      title: "Vị trí",
      sortable: true,
      render: (val) => <Badge variant={positionVariant(String(val))}>{String(val)}</Badge>,
    },
    { key: "territory", title: "Khu vực", sortable: true },
    {
      key: "routes",
      title: "Tuyến phụ trách",
      render: (val) => (
        <div className="flex gap-1">
          {(val as string[]).map((r) => (
            <Badge key={r} variant="default">{r}</Badge>
          ))}
        </div>
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
        const pct = (row.achieved / row.target) * 100;
        const over = pct >= 100;
        const near = pct >= 90;
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
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nhân viên & Vị trí"
        subtitle="Đội ngũ bán hàng, khu vực phụ trách và KPI tháng 09/2026"
        actions={
          <button onClick={() => { setCreateError(""); setCreateOpen(true); }} className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            <UsersRound size={16} />
            Thêm nhân viên
          </button>
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
        searchKeys={["code", "name", "phone", "territory", "email"]}
        searchPlaceholder="Tìm mã, tên, khu vực..."
        onRowClick={(row) => setSelected(row)}
        toolbar={
          <select
            value={positionFilter}
            onChange={(e) => setPositionFilter(e.target.value)}
            className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="Tất cả">Tất cả vị trí</option>
            <option value="Nhân viên kinh doanh">Nhân viên kinh doanh</option>
            <option value="Giám sát">Giám sát</option>
            <option value="Giám đốc vùng">Giám đốc vùng</option>
          </select>
        }
      />
      {createMessage && <div className="bg-emerald-50 text-emerald-700 rounded-lg px-4 py-3 text-sm">{createMessage}</div>}
      <Drawer open={createOpen} onClose={() => setCreateOpen(false)} title="Thêm nhân viên" subtitle="Tạo nhân viên trong PostgreSQL">
        <div className="p-5 space-y-4">
          {createError && <div className="bg-red-50 text-red-700 rounded-lg px-3 py-2 text-sm">{createError}</div>}
          <input placeholder="Mã nhân viên" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="w-full px-3 py-2 text-sm border rounded-lg" />
          <input placeholder="Họ và tên" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 text-sm border rounded-lg" />
          <select value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} className="w-full px-3 py-2 text-sm border rounded-lg">
            {POSITION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <input placeholder="Số điện thoại" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full px-3 py-2 text-sm border rounded-lg" />
          <input placeholder="Email (tùy chọn)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-3 py-2 text-sm border rounded-lg" />
          <button onClick={createEmployee} className="w-full bg-sky-500 text-white rounded-lg py-2.5 text-sm font-medium">Lưu nhân viên</button>
        </div>
      </Drawer>

      <Drawer
        open={selected !== null}
        onClose={() => setSelected(null)}
        title="Hồ sơ nhân viên"
        subtitle={selected?.position}
      >
        {selected && <EmployeeProfile employee={selected} />}
      </Drawer>
    </div>
  );
}

function EmployeeProfile({ employee }: { employee: Employee }) {

  return (
    <div className="p-5 space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-sky-500 flex items-center justify-center flex-shrink-0">
          <span className="text-white font-bold text-sm">{getInitials(employee.name)}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-gray-900 text-sm">{employee.name}</p>
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
        <InfoRow icon={<RouteIcon size={14} />} text={employee.routes.join(", ")} />
        <InfoRow icon={<CalendarDays size={14} />} text={formatDate(employee.joinDate)} />
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="rounded-xl bg-sky-50 p-3">
          <p className="text-lg font-bold text-sky-600">{employee.orders}</p>
          <p className="text-xs text-gray-400 mt-0.5">Đơn hàng</p>
        </div>
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
  const pct = (value / max) * 100;
  const over = pct >= 100;
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
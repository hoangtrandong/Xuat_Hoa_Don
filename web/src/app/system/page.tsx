"use client";

import { useEffect, useState } from "react";
import { UserPlus, Users, ShieldCheck, RefreshCw } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import Badge from "@/components/ui/Badge";
import Drawer from "@/components/ui/Drawer";
import { formatDateTime } from "@/lib/format";
import { API_URL, apiFetch } from "@/lib/api";

interface RoleOption { id: number; name: string; description: string | null }
interface AppUser {
  id: number; username: string; email: string; full_name: string; is_active: boolean;
  employee_id: number | null; created_at: string; roles: RoleOption[];
}

const ROLE_LABELS: Record<string, string> = { admin: "Quản trị viên", staff: "Nhân viên" };

function roleLabel(role: RoleOption) {
  return ROLE_LABELS[role.name] ?? role.name;
}

export default function SystemUsersPage() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ username: "", email: "", full_name: "", password: "", role_ids: [] as number[] });

  async function load() {
    setError("");
    try {
      const [usersResponse, rolesResponse] = await Promise.all([
        apiFetch(`${API_URL}/users/`),
        apiFetch(`${API_URL}/users/roles/`),
      ]);
      if (!usersResponse.ok || !rolesResponse.ok) {
        const failed = !usersResponse.ok ? usersResponse : rolesResponse;
        const body = await failed.json().catch(() => ({})) as { detail?: string };
        throw new Error(body.detail ?? "Không thể tải danh sách người dùng. Cần quyền quản trị viên.");
      }
      setUsers(await usersResponse.json() as AppUser[]);
      setRoles(await rolesResponse.json() as RoleOption[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Không thể tải danh sách người dùng.");
    }
  }

  useEffect(() => { void load(); }, []);

  function toggleRole(roleId: number) {
    setForm((current) => ({
      ...current,
      role_ids: current.role_ids.includes(roleId)
        ? current.role_ids.filter((id) => id !== roleId)
        : [...current.role_ids, roleId],
    }));
  }

  async function createUser() {
    setError(""); setSuccess("");
    if (!form.username || !form.email || !form.full_name || !form.password) {
      setError("Vui lòng nhập đầy đủ tên đăng nhập, email, họ tên và mật khẩu."); return;
    }
    if (form.password.length < 12) {
      setError("Mật khẩu phải có ít nhất 12 ký tự."); return;
    }
    setCreating(true);
    try {
      const response = await apiFetch(`${API_URL}/users/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "Không thể tạo tài khoản.");
      setSuccess(`Đã tạo tài khoản "${form.username}". Hãy gửi tên đăng nhập và mật khẩu này cho nhân viên qua kênh an toàn.`);
      setCreateOpen(false);
      setForm({ username: "", email: "", full_name: "", password: "", role_ids: [] });
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Không thể tạo tài khoản.");
    } finally { setCreating(false); }
  }

  async function toggleActive(user: AppUser) {
    setError(""); setSuccess("");
    try {
      const response = await apiFetch(`${API_URL}/users/${user.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !user.is_active }),
      });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "Không thể cập nhật trạng thái.");
      await load();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Không thể cập nhật trạng thái.");
    }
  }

  const activeCount = users.filter((user) => user.is_active).length;
  const adminCount = users.filter((user) => user.roles.some((role) => role.name === "admin")).length;

  return <div className="space-y-6">
    <PageHeader
      title="Hệ thống"
      subtitle="Quản lý tài khoản đăng nhập và phân quyền nhân viên"
      actions={<div className="flex gap-2">
        <button onClick={() => void load()} className="p-2 rounded-lg border border-gray-200"><RefreshCw size={17} /></button>
        <button onClick={() => setCreateOpen(true)} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-sky-500 text-white text-sm"><UserPlus size={16} /> Tạo tài khoản</button>
      </div>}
    />
    {error && <div className="bg-red-50 text-red-700 rounded-xl px-4 py-3 text-sm">{error}</div>}
    {success && <div className="bg-emerald-50 text-emerald-700 rounded-xl px-4 py-3 text-sm">{success}</div>}
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
      <StatCard label="Tổng tài khoản" value={users.length} icon={<Users size={20} />} color="bg-sky-50 text-sky-600" />
      <StatCard label="Đang hoạt động" value={activeCount} icon={<ShieldCheck size={20} />} color="bg-emerald-50 text-emerald-600" />
      <StatCard label="Quản trị viên" value={adminCount} icon={<ShieldCheck size={20} />} color="bg-purple-50 text-purple-600" />
    </div>
    <div className="overflow-x-auto rounded-xl border bg-white">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-500">
          <tr>
            <th className="px-4 py-3 text-left">Tên đăng nhập</th>
            <th className="px-4 py-3 text-left">Họ tên</th>
            <th className="px-4 py-3 text-left">Email</th>
            <th className="px-4 py-3 text-left">Vai trò</th>
            <th className="px-4 py-3 text-left">Ngày tạo</th>
            <th className="px-4 py-3 text-left">Trạng thái</th>
            <th className="px-4 py-3 text-right">Thao tác</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => <tr key={user.id} className="border-t">
            <td className="px-4 py-3 font-medium">{user.username}</td>
            <td className="px-4 py-3">{user.full_name}</td>
            <td className="px-4 py-3 text-gray-500">{user.email}</td>
            <td className="px-4 py-3">
              <div className="flex flex-wrap gap-1">
                {user.roles.length === 0
                  ? <span className="text-xs text-gray-400">Chưa gán vai trò</span>
                  : user.roles.map((role) => <Badge key={role.id} variant={role.name === "admin" ? "purple" : "default"}>{roleLabel(role)}</Badge>)}
              </div>
            </td>
            <td className="px-4 py-3 text-gray-500">{formatDateTime(user.created_at)}</td>
            <td className="px-4 py-3"><Badge variant={user.is_active ? "success" : "danger"}>{user.is_active ? "Hoạt động" : "Đã khóa"}</Badge></td>
            <td className="px-4 py-3 text-right">
              <button onClick={() => void toggleActive(user)} className="text-sky-600 hover:underline text-xs">
                {user.is_active ? "Khóa tài khoản" : "Mở khóa"}
              </button>
            </td>
          </tr>)}
        </tbody>
      </table>
      {users.length === 0 && <p className="p-8 text-center text-gray-500">Chưa có tài khoản nào ngoài quản trị viên khởi tạo.</p>}
    </div>
    <Drawer open={createOpen} onClose={() => setCreateOpen(false)} title="Tạo tài khoản nhân viên" subtitle="Chỉ quản trị viên mới có thể tạo tài khoản đăng nhập mới">
      <div className="p-5 space-y-4">
        <label className="block"><span className="text-xs text-gray-500">Tên đăng nhập</span><input value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} placeholder="vd: nvkd01" className="mt-1 w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg" /></label>
        <label className="block"><span className="text-xs text-gray-500">Email</span><input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} placeholder="vd: nvkd01@congty.vn" className="mt-1 w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg" /></label>
        <label className="block"><span className="text-xs text-gray-500">Họ tên</span><input value={form.full_name} onChange={(event) => setForm((current) => ({ ...current, full_name: event.target.value }))} className="mt-1 w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg" /></label>
        <label className="block"><span className="text-xs text-gray-500">Mật khẩu tạm (tối thiểu 12 ký tự)</span><input type="text" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} placeholder="Yêu cầu nhân viên đổi mật khẩu sau lần đăng nhập đầu" className="mt-1 w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg" /></label>
        <div>
          <span className="text-xs text-gray-500">Vai trò</span>
          <div className="mt-1 space-y-2">
            {roles.map((role) => <label key={role.id} className="flex items-center gap-2 text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <input type="checkbox" checked={form.role_ids.includes(role.id)} onChange={() => toggleRole(role.id)} />
              <span className="font-medium">{roleLabel(role)}</span>
              {role.description && <span className="text-xs text-gray-400">— {role.description}</span>}
            </label>)}
            {roles.length === 0 && <p className="text-xs text-gray-400 mt-1">Chưa có vai trò nào. Vai trò mặc định sẽ được tạo khi hệ thống khởi động.</p>}
          </div>
        </div>
        <button disabled={creating} onClick={() => void createUser()} className="w-full bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium rounded-lg py-2.5 disabled:opacity-50">{creating ? "Đang tạo…" : "Tạo tài khoản"}</button>
      </div>
    </Drawer>
  </div>;
}
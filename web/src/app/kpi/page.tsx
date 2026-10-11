"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, CalendarCheck2, Target, TrendingUp, UserRoundCheck, UsersRound } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import Badge from "@/components/ui/Badge";
import { formatVND } from "@/lib/format";
import { API_URL, apiFetch } from "@/lib/api";

interface BackendEmployee {
  id: number;
  code: string;
  name: string;
  position: string;
  target: number;
  status: string;
}

export default function KpiPage() {
  const [employees, setEmployees] = useState<BackendEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadEmployees() {
      try {
        const response = await apiFetch(`${API_URL}/employees/?limit=1000`);
        if (!response.ok) throw new Error("Không thể tải danh sách nhân viên.");
        const data = await response.json() as BackendEmployee[];
        if (active) setEmployees(data);
      } catch (error) {
        if (active) setLoadError(error instanceof Error ? error.message : "Không thể tải dữ liệu KPI.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadEmployees();
    return () => { active = false; };
  }, []);

  const activeCount = employees.filter((employee) => employee.status === "active").length;
  const totalTarget = employees.reduce((total, employee) => total + (Number(employee.target) || 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="KPI Đội ngũ bán hàng"
        subtitle="Danh sách và mục tiêu được đồng bộ từ hồ sơ nhân viên"
      />

      {loadError && (
        <div role="alert" className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle size={16} />
          {loadError}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Tổng nhân viên" value={loading ? "—" : employees.length} icon={<UsersRound size={20} />} color="bg-sky-50 text-sky-600" />
        <StatCard label="Đang hoạt động" value={loading ? "—" : activeCount} icon={<UserRoundCheck size={20} />} color="bg-emerald-50 text-emerald-600" />
        <StatCard label="Tổng mục tiêu" value={loading ? "—" : formatVND(totalTarget)} icon={<Target size={20} />} color="bg-purple-50 text-purple-600" />
        <StatCard label="Doanh số thực hiện" value="Chưa có dữ liệu" icon={<TrendingUp size={20} />} color="bg-amber-50 text-amber-600" />
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <CalendarCheck2 size={18} className="mt-0.5 shrink-0" />
        <p>
          Danh sách nhân viên và mục tiêu bên dưới lấy từ dữ liệu hiện tại. Doanh số thực hiện, đơn hàng,
          khách hàng mới và lượt viếng thăm chưa có nguồn dữ liệu KPI thực tế trên hệ thống nên không hiển thị số liệu mẫu.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
        <div className="px-5 pb-4 pt-5">
          <h3 className="text-sm font-semibold text-gray-700">Danh sách nhân viên và mục tiêu</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-gray-100 bg-gray-50">
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Nhân viên</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Vị trí</th>
                <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-500">Trạng thái</th>
                <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Mục tiêu</th>
                <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">Kết quả KPI</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading && (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-500">Đang tải danh sách nhân viên...</td></tr>
              )}
              {!loading && !loadError && employees.length === 0 && (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-gray-500">Chưa có nhân viên trong danh sách.</td></tr>
              )}
              {!loading && employees.map((employee) => (
                <tr key={employee.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3">
                    <p className="font-medium text-gray-900">{employee.name}</p>
                    <p className="text-xs text-gray-400">{employee.code}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{employee.position}</td>
                  <td className="px-4 py-3 text-center">
                    <Badge variant={employee.status === "active" ? "success" : "default"}>
                      {employee.status === "active" ? "Đang hoạt động" : "Ngừng hoạt động"}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-gray-700">{formatVND(Number(employee.target) || 0)}</td>
                  <td className="px-5 py-3 text-right text-gray-400">Chưa có dữ liệu</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

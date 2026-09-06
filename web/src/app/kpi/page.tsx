"use client";
// src/app/kpi/page.tsx
import { Target, TrendingUp, UserPlus, CalendarCheck2, Trophy } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import Badge from "@/components/ui/Badge";
import ProgressBar from "@/components/ui/ProgressBar";
import { employees, teamKpi } from "@/lib/mock-employees";
import { formatVND, formatPercent, getInitials } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function KpiPage() {
  const teamPct = (teamKpi.totalAchieved / teamKpi.totalTarget) * 100;
  const custPct = (teamKpi.totalNewCustomers / teamKpi.totalNewCustomersTarget) * 100;
  const visitPct = (teamKpi.totalVisits / teamKpi.totalVisitTarget) * 100;

  return (
    <div className="space-y-6">
      <PageHeader
        title="KPI Đội ngũ bán hàng"
        subtitle={`Bảng điểm KPI tháng ${teamKpi.month} - toàn vùng HCM`}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Doanh số đạt"
          value={formatVND(teamKpi.totalAchieved)}
          sub={`${formatPercent(teamPct - 100)} vs mục tiêu ${formatVND(teamKpi.totalTarget)}`}
          icon={<TrendingUp size={20} />}
          color="bg-sky-50 text-sky-600"
        />
        <StatCard label="Đơn hàng tháng" value={teamKpi.totalOrders} icon={<Target size={20} />} color="bg-purple-50 text-purple-600" />
        <StatCard
          label="Khách hàng mới"
          value={`${teamKpi.totalNewCustomers} / ${teamKpi.totalNewCustomersTarget}`}
          sub={`${formatPercent(custPct - 100)} so mục tiêu`}
          icon={<UserPlus size={20} />}
          color="bg-emerald-50 text-emerald-600"
        />
        <StatCard
          label="Lượt viếng thăm"
          value={`${teamKpi.totalVisits} / ${teamKpi.totalVisitTarget}`}
          sub={`${formatPercent(visitPct - 100)} so mục tiêu`}
          icon={<CalendarCheck2 size={20} />}
          color="bg-amber-50 text-amber-600"
        />
      </div>

      {/* Tổng quan tiến độ KPI */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <Trophy size={16} className="text-amber-500" />
          <h3 className="text-sm font-semibold text-gray-700">Tiến độ KPI toàn vùng</h3>
          <Badge variant={teamPct >= 100 ? "success" : teamPct >= 90 ? "info" : "warning"}>
            {teamPct.toFixed(1)}%
          </Badge>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <Metric title="Doanh số" value={teamKpi.totalAchieved} max={teamKpi.totalTarget} format={formatVND} />
          <Metric title="Khách hàng mới" value={teamKpi.totalNewCustomers} max={teamKpi.totalNewCustomersTarget} format={(n) => String(Math.round(n))} />
          <Metric title="Lượt viếng thăm" value={teamKpi.totalVisits} max={teamKpi.totalVisitTarget} format={(n) => String(Math.round(n))} />
        </div>
      </div>

      {/* Bảng KPI từng nhân viên */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 pt-5 pb-4">
          <h3 className="text-sm font-semibold text-gray-700">Chi tiết từng nhân viên</h3>
          <p className="text-xs text-gray-400 mt-0.5">Nhấn vào hàng để xem hồ sơ cá nhân (tại trang Nhân viên)</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-gray-100 bg-gray-50">
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Nhân viên</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Vị trí</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Doanh số</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Khách mới</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Viếng thăm</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Tổng KPI</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {employees.map((e) => {
                const pct = (e.achieved / e.target) * 100;
                const score = Math.round((pct * 0.5) + ((e.newCustomers / e.newCustomersTarget) * 0.25) + ((e.visits / e.visitTarget) * 0.25));
                const scoreColor = score >= 100 ? "text-emerald-600" : score >= 90 ? "text-sky-600" : score >= 75 ? "text-amber-600" : "text-red-500";
                return (
                  <tr key={e.code} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-sky-500 flex items-center justify-center flex-shrink-0">
                          <span className="text-white text-xs font-bold">{getInitials(e.name)}</span>
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{e.name}</p>
                          <p className="text-xs text-gray-400">{e.code} · {e.territory}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={e.position === "Giám đốc vùng" ? "purple" : e.position === "Giám sát" ? "info" : "default"}>
                        {e.position}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="w-32">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-semibold text-gray-800">{pct.toFixed(0)}%</span>
                          <span className="text-gray-400">{formatVND(e.achieved)}</span>
                        </div>
                        <ProgressBar
                          value={e.achieved}
                          max={e.target}
                          color={pct >= 100 ? "bg-emerald-500" : pct >= 90 ? "bg-sky-500" : "bg-amber-500"}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {e.newCustomers}/{e.newCustomersTarget}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {e.visits}/{e.visitTarget}
                    </td>
                    <td className={cn("px-4 py-3 text-right font-bold", scoreColor)}>{score}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Metric({ title, value, max, format }: { title: string; value: number; max: number; format: (n: number) => string }) {
  const pct = (value / max) * 100;
  const over = pct >= 100;
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1.5">
        <span className="text-gray-500 font-medium">{title}</span>
        <span className="text-gray-800 font-semibold">
          {format(value)} / {format(max)}
        </span>
      </div>
      <ProgressBar value={value} max={max} color={over ? "bg-emerald-500" : "bg-sky-500"} className="h-2" />
    </div>
  );
}
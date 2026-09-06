"use client";
// src/app/customers/routes/page.tsx
import { MapPin, Users, CalendarCheck2, ClipboardCheck } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import ProgressBar from "@/components/ui/ProgressBar";
import Badge from "@/components/ui/Badge";
import { customers, salesRoutes } from "@/lib/mock-customers";
import { salesOrders } from "@/lib/mock-orders";
import { formatVND } from "@/lib/format";

function routeStats(routeCode: string) {
  const list = customers.filter((c) => c.routeCode === routeCode);
  const visits = list.reduce((s, c) => s + c.visitCount, 0);
  const customerCodes = new Set(list.map((c) => c.code));
  const orderValue = salesOrders
    .filter((o) => customerCodes.has(o.customerCode))
    .reduce((s, o) => s + o.total, 0);
  return { count: list.length, visits, orderValue };
}

export default function RoutesPage() {
  const totalCustomers = customers.length;
  const totalVisits = customers.reduce((s, c) => s + c.visitCount, 0);
  const totalTarget = salesRoutes.reduce((s, r) => s + r.visitTarget, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tuyến bán hàng"
        subtitle="Phân bổ khách hàng theo tuyến, nhân viên kinh doanh và lượt viếng thăm"
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Tuyến đang triển khai" value={salesRoutes.length} icon={<MapPin size={20} />} color="bg-sky-50 text-sky-600" />
        <StatCard label="Khách hàng trong tuyến" value={totalCustomers} icon={<Users size={20} />} color="bg-emerald-50 text-emerald-600" />
        <StatCard label="Lượt ghé tháng này" value={totalVisits} icon={<CalendarCheck2 size={20} />} color="bg-purple-50 text-purple-600" />
        <StatCard label="Mục tiêu lượt ghé" value={totalTarget} icon={<ClipboardCheck size={20} />} color="bg-amber-50 text-amber-600" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {salesRoutes.map((route) => {
          const stats = routeStats(route.code);
          const pct = Math.round((stats.visits / route.visitTarget) * 100);
          const over = pct >= 100;
          return (
            <div key={route.code} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${route.color}1a`, color: route.color }}
                  >
                    <MapPin size={18} />
                  </div>
                  <div>
                    <p className="font-bold text-gray-900">
                      {route.code} <span className="text-gray-400 font-medium">· {route.name}</span>
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">{route.territory}</p>
                  </div>
                </div>
                <Badge variant={over ? "success" : pct >= 80 ? "info" : "warning"}>
                  {over ? "Vượt mục tiêu" : `${pct}%`}
                </Badge>
              </div>

              <div className="grid grid-cols-3 gap-2 mb-4 text-center">
                <div className="rounded-lg bg-gray-50 py-2">
                  <p className="text-sm font-bold text-gray-900">{stats.count}</p>
                  <p className="text-[11px] text-gray-400">Khách hàng</p>
                </div>
                <div className="rounded-lg bg-gray-50 py-2">
                  <p className="text-sm font-bold text-gray-900">{stats.visits}</p>
                  <p className="text-[11px] text-gray-400">Lượt ghé</p>
                </div>
                <div className="rounded-lg bg-gray-50 py-2">
                  <p className="text-sm font-bold text-gray-900">{route.visitTarget}</p>
                  <p className="text-[11px] text-gray-400">Mục tiêu</p>
                </div>
              </div>

              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="text-gray-400">Tiến độ viếng thăm</span>
                <span className="font-semibold text-gray-700">{stats.visits}/{route.visitTarget} lượt</span>
              </div>
              <ProgressBar value={stats.visits} max={route.visitTarget} color={over ? "bg-emerald-500" : "bg-sky-500"} />

              <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
                <span className="text-xs text-gray-500">Doanh số tuyến</span>
                <span className="text-sm font-bold text-sky-600">{formatVND(stats.orderValue)}</span>
              </div>
              <p className="text-xs text-gray-400 mt-2">NVKD: <span className="font-medium text-gray-600">{route.salesRep}</span></p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
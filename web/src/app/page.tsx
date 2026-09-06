"use client";

import { useState } from "react";
import {
  DollarSign, ShoppingCart, Users, Package, RefreshCw, ChevronDown,
} from "lucide-react";
import KpiCard from "@/components/dashboard/KpiCard";
import RevenueChart from "@/components/dashboard/RevenueChart";
import SupplierChart from "@/components/dashboard/SupplierChart";
import CustomerCoverage from "@/components/dashboard/CustomerCoverage";
import TopSales from "@/components/dashboard/TopSales";
import {
  kpiData,
  revenueByDay,
  revenueByMonth,
  revenueBySupplier,
  topSales,
  customerCoverage,
} from "@/lib/mock-data";

const periods = ["Hôm nay", "Tuần này", "Tháng này", "Quý này"];

export default function DashboardPage() {
  const [period, setPeriod] = useState("Hôm nay");
  const [showPeriodMenu, setShowPeriodMenu] = useState(false);

  const chartData = period === "Hôm nay" || period === "Tuần này" ? revenueByDay : revenueByMonth;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Tổng quan</h1>
          <p className="text-sm text-gray-500 mt-0.5">Tổng quan hoạt động kinh doanh hôm nay</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Period selector */}
          <div className="relative">
            <button
              onClick={() => setShowPeriodMenu(!showPeriodMenu)}
              className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 hover:border-sky-400 transition-colors shadow-sm"
            >
              {period}
              <ChevronDown size={14} className="text-gray-400" />
            </button>
            {showPeriodMenu && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-10 min-w-[130px]">
                {periods.map((p) => (
                  <button
                    key={p}
                    onClick={() => { setPeriod(p); setShowPeriodMenu(false); }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${period === p ? "text-sky-600 font-medium" : "text-gray-700"}`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors shadow-sm">
            <RefreshCw size={14} />
            Làm mới
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label={kpiData.revenue.label}
          value={kpiData.revenue.value}
          change={kpiData.revenue.change}
          unit="VND"
          color="bg-sky-50 text-sky-500"
          icon={<DollarSign size={22} />}
        />
        <KpiCard
          label={kpiData.orders.label}
          value={kpiData.orders.value}
          change={kpiData.orders.change}
          unit=""
          color="bg-purple-50 text-purple-500"
          icon={<ShoppingCart size={22} />}
        />
        <KpiCard
          label={kpiData.customers.label}
          value={kpiData.customers.value}
          total={kpiData.customers.total}
          unit=""
          color="bg-amber-50 text-amber-500"
          icon={<Users size={22} />}
        />
        <KpiCard
          label={kpiData.inventory.label}
          value={kpiData.inventory.value}
          change={kpiData.inventory.change}
          unit="VND"
          color="bg-emerald-50 text-emerald-500"
          icon={<Package size={22} />}
        />
      </div>

      {/* Revenue Chart (full width) */}
      <RevenueChart
        data={chartData}
        title={`Doanh thu - ${period}`}
      />

      {/* Row: Supplier chart + Customer coverage */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SupplierChart data={revenueBySupplier} />
        <CustomerCoverage
          visited={customerCoverage.visited}
          total={customerCoverage.total}
          bought={customerCoverage.bought}
          notBought={customerCoverage.notBought}
        />
      </div>

      {/* Top Sales */}
      <TopSales data={topSales} />
    </div>
  );
}
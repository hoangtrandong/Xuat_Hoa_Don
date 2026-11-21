"use client";

import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatVND, formatPercent } from "@/lib/format";

interface KpiCardProps {
  label: string;
  value: number;
  change?: number;
  total?: number;
  unit?: string;
  icon: React.ReactNode;
  color: string;
}

export default function KpiCard({
  label,
  value,
  change,
  total,
  unit,
  icon,
  color,
}: KpiCardProps) {
  const isPositive = (change ?? 0) >= 0;

  const displayValue =
    unit === "VND" ? formatVND(value) : value.toLocaleString("vi-VN");

  return (
    <div className="bg-white dark:bg-[#151d2b] rounded-xl p-5 border border-gray-100 dark:border-[#2a3547] shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500 mb-1">{label}</p>
          <p className="text-2xl font-bold text-gray-900">{displayValue}</p>
          {total !== undefined && (
            <p className="text-xs text-gray-400 mt-0.5">
              / {total.toLocaleString("vi-VN")} ({((value / total) * 100).toFixed(1)}%)
            </p>
          )}
        </div>
        <div
          className={cn(
            "w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0",
            color
          )}
        >
          {icon}
        </div>
      </div>

      {change !== undefined && (
        <div className="mt-3 flex items-center gap-1">
          {isPositive ? (
            <TrendingUp size={14} className="text-emerald-500" />
          ) : (
            <TrendingDown size={14} className="text-red-500" />
          )}
          <span
            className={cn(
              "text-xs font-medium",
              isPositive ? "text-emerald-600" : "text-red-600"
            )}
          >
            {formatPercent(change)}
          </span>
          <span className="text-xs text-gray-400">so với hôm qua</span>
        </div>
      )}
    </div>
  );
}

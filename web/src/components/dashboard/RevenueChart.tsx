"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { formatVND } from "@/lib/format";
import { useTheme } from "@/lib/theme";

interface RevenuePoint {
  label: string;
  value: number;
}

interface RevenueChartProps {
  data: RevenuePoint[];
  title: string;
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}) {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3">
        <p className="text-sm font-medium text-gray-700">{label}</p>
        <p className="text-sm text-sky-600 font-bold">{formatVND(payload[0].value)}</p>
      </div>
    );
  }
  return null;
}

export default function RevenueChart({ data, title }: RevenueChartProps) {
  const { resolvedTheme } = useTheme();
  const chartText = resolvedTheme === "dark" ? "#94a3b8" : "#9ca3af";
  const gridColor = resolvedTheme === "dark" ? "#334155" : "#f3f4f6";

  return (
    <div className="bg-white dark:bg-[#151d2b] rounded-xl border border-gray-100 dark:border-[#2a3547] shadow-sm p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">{title}</h3>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 12, fill: chartText }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v) => formatVND(v)}
            tick={{ fontSize: 11, fill: chartText }}
            axisLine={false}
            tickLine={false}
            width={70}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="value"
            stroke="#0ea5e9"
            strokeWidth={2}
            fill="url(#revenueGrad)"
            dot={{ r: 4, fill: "#0ea5e9", strokeWidth: 2, stroke: "var(--dms-surface, #ffffff)" }}
            activeDot={{ r: 6 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
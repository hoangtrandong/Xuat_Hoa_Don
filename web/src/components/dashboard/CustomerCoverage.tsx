"use client";

import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { useTheme } from "@/lib/theme";

interface CustomerCoverageProps {
  visited: number;
  total: number;
  bought: number;
  notBought: number;
}

export default function CustomerCoverage({ visited, total, bought, notBought }: CustomerCoverageProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const coveragePercent = ((visited / total) * 100).toFixed(1);
  const boughtPercent = ((bought / visited) * 100).toFixed(1);

  const pieData = [
    { name: "Đã mua", value: bought, color: "#0ea5e9" },
    { name: "Chưa mua", value: notBought, color: isDark ? "#164e63" : "#e0f2fe" },
    { name: "Chưa ghé", value: total - visited, color: isDark ? "#334155" : "#f3f4f6" },
  ];

  return (
    <div className="bg-white dark:bg-[#151d2b] rounded-xl border border-gray-100 dark:border-[#2a3547] shadow-sm p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Độ phủ khách hàng</h3>

      <div className="flex items-center gap-4">
        <div className="flex-shrink-0 relative" style={{ width: 120, height: 120 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={38} outerRadius={55} dataKey="value" startAngle={90} endAngle={-270}>
                {pieData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} strokeWidth={0} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-bold text-gray-900">{coveragePercent}%</span>
            <span className="text-[10px] text-gray-400">Độ phủ</span>
          </div>
        </div>

        <div className="flex-1 space-y-3">
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-500">Đã ghé thăm</span>
              <span className="font-medium text-gray-800">{visited.toLocaleString()} / {total.toLocaleString()}</span>
            </div>
            <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-sky-400 rounded-full" style={{ width: `${coveragePercent}%` }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-500">Đã mua hàng</span>
              <span className="font-medium text-gray-800">{bought.toLocaleString()} ({boughtPercent}%)</span>
            </div>
            <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${boughtPercent}%` }} />
            </div>
          </div>
          <div className="flex gap-3 pt-1">
            {pieData.slice(0, 2).map((item) => (
              <div key={item.name} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: item.color }} />
                <span className="text-xs text-gray-500">{item.name}: <strong className="text-gray-700">{item.value}</strong></span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

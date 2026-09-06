"use client";

import { formatVND } from "@/lib/format";

interface SalesRep {
  name: string;
  avatar: string;
  value: number;
  orders: number;
  customers: number;
}

interface TopSalesProps {
  data: SalesRep[];
}

const avatarColors = ["bg-sky-500", "bg-purple-500", "bg-amber-500", "bg-emerald-500", "bg-rose-500"];

export default function TopSales({ data }: TopSalesProps) {
  const maxValue = Math.max(...data.map((d) => d.value));

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-700">Top Sales</h3>
        <span className="text-xs text-gray-400">Hôm nay</span>
      </div>

      <div className="space-y-3">
        {data.map((rep, i) => (
          <div key={i} className="flex items-center gap-3 group cursor-pointer">
            <span className="text-xs font-bold text-gray-300 w-4">{i + 1}</span>
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${avatarColors[i % avatarColors.length]}`}
            >
              <span className="text-white text-xs font-bold">{rep.avatar}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-gray-800 truncate">{rep.name}</span>
                <span className="text-sm font-semibold text-gray-900 ml-2 flex-shrink-0">
                  {formatVND(rep.value)}
                </span>
              </div>
              <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${avatarColors[i % avatarColors.length]}`}
                  style={{ width: `${(rep.value / maxValue) * 100}%` }}
                />
              </div>
              <div className="flex gap-3 mt-1">
                <span className="text-xs text-gray-400">{rep.orders} đơn</span>
                <span className="text-xs text-gray-400">{rep.customers} KH</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

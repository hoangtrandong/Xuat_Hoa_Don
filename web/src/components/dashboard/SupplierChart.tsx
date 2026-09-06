"use client";

import { useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Sector } from "recharts";
import { formatVND } from "@/lib/format";
import { drilldownData, type DrilldownItem } from "@/lib/mock-data";
import { ChevronRight, ArrowLeft } from "lucide-react";

interface SupplierItem {
  name: string;
  value: number;
  color: string;
}

interface SupplierChartProps {
  data: SupplierItem[];
}

function CustomTooltip({ active, payload }: {
  active?: boolean;
  payload?: Array<{ payload: SupplierItem; value: number }>;
}) {
  if (active && payload && payload.length) {
    const item = payload[0].payload;
    return (
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2">
        <p className="text-xs font-medium text-gray-700">{item.name}</p>
        <p className="text-sm font-bold" style={{ color: item.color }}>{formatVND(payload[0].value)}</p>
      </div>
    );
  }
  return null;
}

// Recharts 3: dùng shape với isActive thay cho activeShape/activeIndex đã bị loại bỏ
function RenderShape(props: {
  cx?: number;
  cy?: number;
  innerRadius?: number;
  outerRadius?: number;
  startAngle?: number;
  endAngle?: number;
  fill?: string;
  isActive?: boolean;
}) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, isActive } = props;
  return (
    <Sector
      cx={cx}
      cy={cy}
      innerRadius={innerRadius}
      outerRadius={(outerRadius ?? 0) + (isActive ? 6 : 0)}
      startAngle={startAngle}
      endAngle={endAngle}
      fill={fill}
      stroke="#fff"
      strokeWidth={isActive ? 2 : 1}
    />
  );
}

export default function SupplierChart({ data }: SupplierChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number>(-1);
  const [drilldownSupplier, setDrilldownSupplier] = useState<string | null>(null);

  const total = data.reduce((s, d) => s + d.value, 0);
  const active = hoverIndex >= 0 ? data[hoverIndex] : null;
  const centerName = active ? active.name : "Tổng cộng";
  const centerValue = active ? active.value : total;
  const centerPercent = active ? (active.value / total) * 100 : 100;

  const drillData = drilldownSupplier ? drilldownData[drilldownSupplier] : null;

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {drilldownSupplier && (
            <button
              onClick={() => setDrilldownSupplier(null)}
              className="p-1 rounded hover:bg-gray-100"
              aria-label="Quay lại"
            >
              <ArrowLeft size={16} className="text-gray-500" />
            </button>
          )}
          <h3 className="text-sm font-semibold text-gray-700">
            {drilldownSupplier
              ? `NCC: ${drilldownSupplier} → Nhân viên`
              : "Doanh thu theo Nhà cung cấp"}
          </h3>
        </div>
        {drilldownSupplier && (
          <span className="text-xs text-sky-500 bg-sky-50 px-2 py-0.5 rounded-full">Drill-down</span>
        )}
      </div>

      {!drilldownSupplier ? (
        <div className="flex items-center gap-4">
          <div className="relative flex-shrink-0" style={{ width: 170, height: 170 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip content={<CustomTooltip />} />
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={72}
                  dataKey="value"
                  shape={RenderShape as never}
                  onMouseEnter={(_, index) => setHoverIndex(index)}
                  onMouseLeave={() => setHoverIndex(-1)}
                >
                  {data.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-3">
              <span className="text-[11px] text-gray-400 truncate max-w-full">{centerName}</span>
              <span className="text-sm font-bold text-gray-900">{formatVND(centerValue)}</span>
              <span className="text-[10px] text-gray-400">{centerPercent.toFixed(0)}%</span>
            </div>
          </div>
          <div className="flex-1 space-y-1.5">
            {data.map((item, i) => (
              <button
                key={i}
                onClick={() => {
                  if (drilldownData[item.name]) setDrilldownSupplier(item.name);
                }}
                onMouseEnter={() => setHoverIndex(i)}
                onMouseLeave={() => setHoverIndex(-1)}
                className={`flex items-center gap-2 w-full text-left group hover:bg-gray-50 rounded-lg px-2 py-1.5 transition-colors ${
                  hoverIndex === i ? "bg-gray-50" : ""
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: item.color }} />
                <span className="text-xs text-gray-700 flex-1">{item.name}</span>
                <span className="text-xs font-medium text-gray-600">{formatVND(item.value)}</span>
                {drilldownData[item.name] && (
                  <ChevronRight size={12} className="text-gray-300 group-hover:text-sky-500 transition-colors" />
                )}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {drillData?.employees.map((emp: DrilldownItem, i) => (
            <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg bg-gray-50">
              <div className="w-8 h-8 rounded-full bg-sky-500 flex items-center justify-center flex-shrink-0">
                <span className="text-white text-xs font-bold">
                  {emp.name.split(" ").map((w) => w[0]).slice(-2).join("")}
                </span>
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-800">{emp.name}</p>
                <p className="text-xs text-gray-400">{emp.orders} đơn · {emp.customers} khách hàng</p>
              </div>
              <span className="text-sm font-semibold text-sky-600">{formatVND(emp.value)}</span>
            </div>
          ))}
          <p className="text-xs text-gray-400 text-center pt-1">Click nhân viên để xem chi tiết (trang Nhân viên)</p>
        </div>
      )}
    </div>
  );
}
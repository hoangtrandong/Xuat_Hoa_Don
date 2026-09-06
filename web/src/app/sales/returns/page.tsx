"use client";
// src/app/sales/returns/page.tsx
import { RotateCcw, ShieldCheck, ScrollText, Scale } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import DataTable, { Column } from "@/components/ui/DataTable";
import Badge from "@/components/ui/Badge";
import { returnOrders, type ReturnOrder } from "@/lib/mock-orders";
import { formatVNDFull, formatDateTime } from "@/lib/format";

export default function SalesReturnsPage() {
  const approved = returnOrders.filter((r) => r.status === "Đã duyệt").length;
  const totalAmount = returnOrders.reduce((s, r) => s + r.amount, 0);

  const columns: Column<ReturnOrder>[] = [
    {
      key: "code",
      title: "Mã trả hàng",
      sortable: true,
      render: (val, row) => (
        <div>
          <p className="font-semibold text-gray-900">{String(val)}</p>
          <p className="text-xs text-gray-400">{row.orderCode}</p>
        </div>
      ),
    },
    { key: "customerName", title: "Khách hàng", sortable: true },
    {
      key: "productName",
      title: "Sản phẩm",
      render: (val) => <p className="font-medium text-gray-800">{String(val)}</p>,
    },
    {
      key: "quantity",
      title: "SL",
      align: "right",
      render: (val, row) => <span className="text-gray-700">{String(val)} {row.unit}</span>,
    },
    {
      key: "reason",
      title: "Lý do",
      render: (val) => <span className="text-gray-500 text-xs">{String(val)}</span>,
    },
    {
      key: "amount",
      title: "Giá trị",
      sortable: true,
      align: "right",
      render: (val) => <span className="font-semibold text-red-500">{formatVNDFull(val as number)}</span>,
    },
    {
      key: "status",
      title: "Trạng thái",
      sortable: true,
      render: (val) =>
        val === "Đã duyệt" ? <Badge variant="success">Đã duyệt</Badge> : <Badge variant="warning">Chờ duyệt</Badge>,
    },
    {
      key: "createdAt",
      title: "Thời điểm",
      sortable: true,
      render: (val) => <span className="text-gray-500 text-xs">{formatDateTime(String(val))}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trả hàng"
        subtitle="Phiếu trả hàng, đổi trả từ khách hàng và cửa hàng"
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Phiếu trả hàng" value={returnOrders.length} icon={<RotateCcw size={20} />} color="bg-sky-50 text-sky-600" />
        <StatCard label="Đã duyệt" value={approved} icon={<ShieldCheck size={20} />} color="bg-emerald-50 text-emerald-600" />
        <StatCard label="Chờ duyệt" value={returnOrders.length - approved} icon={<ScrollText size={20} />} color="bg-amber-50 text-amber-600" />
        <StatCard label="Giá trị trả hàng" value={formatVNDFull(totalAmount)} icon={<Scale size={20} />} color="bg-rose-50 text-rose-600" />
      </div>

      <DataTable
        data={returnOrders}
        columns={columns}
        searchKeys={["code", "orderCode", "customerName", "productName"]}
        searchPlaceholder="Tìm phiếu trả, đơn gốc, sản phẩm..."
      />
    </div>
  );
}
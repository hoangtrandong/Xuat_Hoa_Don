"use client";
/* eslint-disable react-hooks/set-state-in-effect */
// src/app/sales/invoices/page.tsx
import { useEffect, useState } from "react";
import { Receipt, Wallet, CircleDollarSign, FileCheck2 } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import DataTable, { Column } from "@/components/ui/DataTable";
import Badge from "@/components/ui/Badge";
import Drawer from "@/components/ui/Drawer";
import OrderDetail from "@/components/orders/OrderDetail";
import { type SalesOrder } from "@/lib/mock-orders";
import { getAllOrders } from "@/lib/order-store";
import { formatVND, formatVNDFull, formatDate } from "@/lib/format";

function paymentVariant(status: string) {
  if (status === "Đã thanh toán") return "success";
  return "warning";
}

export default function SalesInvoicesPage() {
  const [selected, setSelected] = useState<SalesOrder | null>(null);
  const [invoices, setInvoices] = useState<SalesOrder[]>([]);

  useEffect(() => {
    setInvoices(getAllOrders().filter((o) => o.invoiceCode !== ""));
  }, []);

  const totalValue = invoices.reduce((s, o) => s + o.total, 0);
  const collected = invoices.reduce((s, o) => s + o.amountPaid, 0);
  const outstanding = totalValue - collected;
  const count = invoices.length;

  const columns: Column<SalesOrder>[] = [
    {
      key: "invoiceCode",
      title: "Mã phiếu bán",
      sortable: true,
      render: (val, row) => (
        <div>
          <p className="font-semibold text-gray-900">{String(val)}</p>
          <p className="text-xs text-gray-400">{row.code} · {formatDate(row.createdAt)}</p>
        </div>
      ),
    },
    {
      key: "customerName",
      title: "Khách hàng",
      sortable: true,
      render: (val) => <p className="font-medium text-gray-900">{String(val)}</p>,
    },
    { key: "salesRep", title: "NVKD", sortable: true },
    {
      key: "paymentMethod",
      title: "Phương thức",
      render: (val) => <Badge variant="default">{String(val)}</Badge>,
    },
    {
      key: "total",
      title: "Tổng tiền",
      sortable: true,
      align: "right",
      render: (val) => <span className="font-semibold text-gray-900">{formatVNDFull(val as number)}</span>,
    },
    {
      key: "amountPaid",
      title: "Đã thu",
      sortable: true,
      align: "right",
      render: (val, row) => (
        <span className={row.amountPaid >= row.total ? "text-emerald-600 font-semibold" : "text-amber-600 font-semibold"}>
          {formatVNDFull(val as number)}
        </span>
      ),
    },
    {
      key: "paymentStatus",
      title: "Tình trạng thu",
      sortable: true,
      render: (val) => <Badge variant={paymentVariant(String(val))}>{String(val)}</Badge>,
    },
  ];

  const selectedOrder = selected ? invoices.find((o) => o.code === selected.code) ?? null : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Phiếu bán / Hóa đơn"
        subtitle="Hóa đơn bán hàng đã xuất và tình trạng thu tiền"
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Phiếu bán trong kỳ" value={count} icon={<Receipt size={20} />} color="bg-sky-50 text-sky-600" />
        <StatCard label="Tổng giá trị" value={formatVND(totalValue)} icon={<CircleDollarSign size={20} />} color="bg-purple-50 text-purple-600" />
        <StatCard label="Đã thu tiền" value={formatVND(collected)} icon={<Wallet size={20} />} color="bg-emerald-50 text-emerald-600" />
        <StatCard label="Còn phải thu" value={formatVND(outstanding)} icon={<FileCheck2 size={20} />} color="bg-amber-50 text-amber-600" />
      </div>

      <DataTable
        data={invoices}
        columns={columns}
        searchKeys={["invoiceCode", "code", "customerName", "salesRep"]}
        searchPlaceholder="Tìm số phiếu, khách hàng..."
        onRowClick={(row) => setSelected(row)}
      />

      <Drawer
        open={selectedOrder !== null}
        onClose={() => setSelected(null)}
        title="Chi tiết phiếu bán"
        subtitle={selectedOrder?.customerName}
      >
        {selectedOrder && <OrderDetail order={selectedOrder} />}
      </Drawer>
    </div>
  );
}
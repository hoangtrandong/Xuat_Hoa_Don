"use client";
/* eslint-disable react-hooks/set-state-in-effect */
// src/app/sales/orders/page.tsx
import { useEffect, useState } from "react";
import { ShoppingCart, CircleCheck, Clock3, Ban, Plus, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import DataTable, { Column } from "@/components/ui/DataTable";
import Badge from "@/components/ui/Badge";
import Drawer from "@/components/ui/Drawer";
import OrderDetail from "@/components/orders/OrderDetail";
import { type SalesOrder } from "@/lib/mock-orders";
import { getAllOrders } from "@/lib/order-store";
import { formatVND, formatDateTime } from "@/lib/format";

const orderStatuses = ["Hoàn thành", "Đang giao", "Chờ duyệt", "Đã hủy"];
const paymentStatuses = ["Đã thanh toán", "Thanh toán một phần", "Chưa thanh toán"];

function statusVariant(status: string) {
  if (status === "Hoàn thành") return "success";
  if (status === "Đang giao") return "info";
  if (status === "Chờ duyệt") return "warning";
  return "danger";
}

function paymentVariant(status: string) {
  if (status === "Đã thanh toán") return "success";
  if (status === "Thanh toán một phần") return "warning";
  return "default";
}

export default function SalesOrdersPage() {
  const [statusFilter, setStatusFilter] = useState("Tất cả");
  const [paymentFilter, setPaymentFilter] = useState("Tất cả");
  const [selected, setSelected] = useState<SalesOrder | null>(null);
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [toast, setToast] = useState("");

  useEffect(() => {
    setOrders(getAllOrders());
    const created = window.sessionStorage.getItem("dms-order-created");
    if (created) {
      setToast(created);
      window.sessionStorage.removeItem("dms-order-created");
    }
  }, []);

  const today = "2026-09-06";
  const todayOrders = orders.filter((o) => o.createdAt.startsWith(today));
  const todayValue = todayOrders.reduce((s, o) => s + o.total, 0);
  const pending = orders.filter((o) => o.status === "Chờ duyệt").length;
  const cancelled = orders.filter((o) => o.status === "Đã hủy").length;

  const filtered = orders.filter((o) => {
    if (statusFilter !== "Tất cả" && o.status !== statusFilter) return false;
    if (paymentFilter !== "Tất cả" && o.paymentStatus !== paymentFilter) return false;
    return true;
  });

  const columns: Column<SalesOrder>[] = [
    {
      key: "code",
      title: "Mã đơn",
      sortable: true,
      render: (val, row) => (
        <div>
          <p className="font-semibold text-gray-900">{String(val)}</p>
          <p className="text-xs text-gray-400">{formatDateTime(row.createdAt)}</p>
        </div>
      ),
    },
    {
      key: "customerName",
      title: "Khách hàng",
      sortable: true,
      render: (val, row) => (
        <div>
          <p className="font-medium text-gray-900">{String(val)}</p>
          <p className="text-xs text-gray-400">{row.customerType} · {row.district}</p>
        </div>
      ),
    },
    { key: "salesRep", title: "NVKD", sortable: true },
    {
      key: "items",
      title: "SL (mặt hàng)",
      align: "right",
      render: (val) => <span className="text-gray-600">{(val as unknown[]).length}</span>,
    },
    {
      key: "total",
      title: "Tổng tiền",
      sortable: true,
      align: "right",
      render: (val) => <span className="font-semibold text-gray-900">{formatVND(val as number)}</span>,
    },
    {
      key: "paymentStatus",
      title: "Thanh toán",
      sortable: true,
      render: (val) => <Badge variant={paymentVariant(String(val))}>{String(val)}</Badge>,
    },
    {
      key: "status",
      title: "Trạng thái",
      sortable: true,
      render: (val) => <Badge variant={statusVariant(String(val))}>{String(val)}</Badge>,
    },
  ];

  return (
    <div className="space-y-6">
      {toast && (
        <div className="flex items-center justify-between gap-3 bg-emerald-50 text-emerald-700 rounded-xl px-4 py-3 text-sm">
          <span className="flex items-center gap-2"><CheckCircle2 size={16} /> Đã tạo đơn hàng <strong>{toast}</strong> thành công.</span>
          <button onClick={() => setToast("")} className="text-emerald-500 hover:text-emerald-700"><Ban size={14} /></button>
        </div>
      )}
      <PageHeader
        title="Đơn hàng bán"
        subtitle="Quản lý đơn đặt hàng, phiếu bán và trạng thái xử lý"
        actions={
          <Link href="/sales/create" className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            <Plus size={16} />
            Tạo đơn hàng
          </Link>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Đơn hôm nay" value={todayOrders.length} icon={<ShoppingCart size={20} />} color="bg-sky-50 text-sky-600" sub={`${formatVND(todayValue)}`} />
        <StatCard label="Đơn hoàn thành" value={orders.filter((o) => o.status === "Hoàn thành").length} icon={<CircleCheck size={20} />} color="bg-emerald-50 text-emerald-600" />
        <StatCard label="Chờ duyệt" value={pending} icon={<Clock3 size={20} />} color="bg-amber-50 text-amber-600" />
        <StatCard label="Đã hủy" value={cancelled} icon={<Ban size={20} />} color="bg-rose-50 text-rose-600" />
      </div>

      <DataTable
        data={filtered}
        columns={columns}
        searchKeys={["code", "customerName", "customerType", "salesRep"]}
        searchPlaceholder="Tìm mã đơn, khách hàng, NVKD..."
        onRowClick={(row) => setSelected(row)}
        emptyMessage="Không có đơn hàng phù hợp"
        toolbar={
          <>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="Tất cả">Tất cả trạng thái</option>
              {orderStatuses.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select
              value={paymentFilter}
              onChange={(e) => setPaymentFilter(e.target.value)}
              className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="Tất cả">Tất cả thanh toán</option>
              {paymentStatuses.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </>
        }
      />

      <Drawer
        open={selected !== null}
        onClose={() => setSelected(null)}
        title="Chi tiết đơn hàng"
        subtitle={selected?.customerName}
      >
        {selected && <OrderDetail order={selected} />}
      </Drawer>
    </div>
  );
}
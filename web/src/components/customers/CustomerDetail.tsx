"use client";
// src/components/customers/CustomerDetail.tsx
import Link from "next/link";
import {
  Phone, Mail, MapPin, User, Route as RouteIcon, CreditCard, ShoppingBag,
  CalendarDays, Truck,
} from "lucide-react";
import type { Customer } from "@/lib/mock-customers";
import { getOrdersByCustomer } from "@/lib/mock-orders";
import Badge from "@/components/ui/Badge";
import { formatVND, formatDate, getInitials } from "@/lib/format";

interface CustomerDetailProps {
  customer: Customer;
  onCreateOrder: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export default function CustomerDetail({ customer, onCreateOrder, onEdit, onDelete }: CustomerDetailProps) {
  const orders = getOrdersByCustomer(customer.code).slice(0, 4);
  const typeVariant =
    customer.type === "Nhà phân phối" ? "purple" :
    customer.type === "Đại lý" ? "info" :
    customer.type === "HORECA" ? "warning" : "default";

  return (
    <div className="p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-sky-500 flex items-center justify-center flex-shrink-0">
          <span className="text-white font-bold text-sm">{getInitials(customer.name)}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-gray-900 text-sm truncate">{customer.name}</p>
          <p className="text-xs text-gray-400">{customer.code} · {customer.district}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant={customer.status === "active" ? "success" : "danger"}>
            {customer.status === "active" ? "Hoạt động" : "Ngưng giao"}
          </Badge>
          <Badge variant={typeVariant}>{customer.type}</Badge>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded">Tier {customer.tier}</span>
        <span className="text-xs font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded">{customer.routeCode}</span>
      </div>

      {/* Thông tin liên hệ */}
      <div className="rounded-xl border border-gray-100 divide-y divide-gray-50">
        <InfoRow icon={<User size={14} />} label="Người liên hệ" value={customer.contactName} />
        <InfoRow icon={<Phone size={14} />} label="Điện thoại" value={customer.phone} />
        <InfoRow icon={<Mail size={14} />} label="Email" value={customer.email} />
        <InfoRow icon={<MapPin size={14} />} label="Địa chỉ" value={`${customer.address}, ${customer.district}`} />
        <InfoRow icon={<RouteIcon size={14} />} label="Tuyến bán" value={`${customer.routeName} (${customer.routeCode}) - ${customer.salesRep}`} />
        <InfoRow icon={<Truck size={14} />} label="Ngày tạo" value={formatDate(customer.createdAt)} />
      </div>

      {/* Thống kê */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-sky-50 p-3 text-center">
          <p className="text-lg font-bold text-sky-600">{formatVND(customer.totalSpend)}</p>
          <p className="text-xs text-gray-400 mt-0.5">Tổng chi tiêu / 12 tháng</p>
        </div>
        <div className="rounded-xl bg-amber-50 p-3 text-center">
          <p className="text-lg font-bold text-amber-600">
            {customer.debitBalance > 0 ? formatVND(customer.debitBalance) : "0"}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">Công nợ hiện tại</p>
        </div>
        <div className="rounded-xl bg-emerald-50 p-3 text-center">
          <p className="text-lg font-bold text-emerald-600">{customer.visitCount}</p>
          <p className="text-xs text-gray-400 mt-0.5">Lượt ghé tháng này</p>
        </div>
      </div>

      {/* Đơn gần đây */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
            <ShoppingBag size={14} className="text-gray-400" />
            Đơn hàng gần đây
          </h4>
          <Link href="/sales/orders" className="text-xs text-sky-600 hover:text-sky-700 font-medium">
            Xem tất cả
          </Link>
        </div>
        {orders.length === 0 ? (
          <p className="text-xs text-gray-400 py-4 text-center bg-gray-50 rounded-xl">Chưa có đơn hàng nào.</p>
        ) : (
          <div className="space-y-2">
            {orders.map((o) => (
              <div key={o.code} className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2.5">
                <div>
                  <p className="text-xs font-semibold text-gray-800">{o.code}</p>
                  <p className="text-[11px] text-gray-400 flex items-center gap-1 mt-0.5">
                    <CalendarDays size={11} /> {formatDate(o.createdAt)} · {o.status}
                  </p>
                </div>
                <span className="text-xs font-bold text-gray-900">{formatVND(o.total)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={onCreateOrder}
        className="w-full flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium rounded-lg py-2.5 transition-colors"
      >
        <CreditCard size={15} />
        Tạo đơn cho khách hàng này
      </button>
      <div className="grid grid-cols-2 gap-2">
        <button onClick={onEdit} className="rounded-lg border border-sky-200 py-2 text-sm font-medium text-sky-600 hover:bg-sky-50">
          Sửa khách hàng
        </button>
        <button onClick={onDelete} className="rounded-lg border border-red-200 py-2 text-sm font-medium text-red-600 hover:bg-red-50">
          Xóa khách hàng
        </button>
      </div>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <span className="text-gray-400 flex-shrink-0 mt-0.5">{icon}</span>
      <span className="text-xs text-gray-400 w-28 flex-shrink-0 leading-5">{label}</span>
      <span className="text-xs text-gray-800 font-medium leading-5">{value}</span>
    </div>
  );
}
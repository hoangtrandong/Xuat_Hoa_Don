"use client";
// src/components/orders/OrderDetail.tsx
import {
  MapPin, Truck, Globe, PackageCheck, Percent, CreditCard,
} from "lucide-react";
import type { SalesOrder } from "@/lib/mock-orders";
import Badge from "@/components/ui/Badge";
import { formatVNDFull, formatDateTime, getInitials } from "@/lib/format";

interface OrderDetailProps {
  order: SalesOrder;
}

export default function OrderDetail({ order }: OrderDetailProps) {
  const statusVariant =
    order.status === "Hoàn thành" ? "success" :
    order.status === "Đang giao" ? "info" :
    order.status === "Chờ duyệt" ? "warning" : "danger";
  const paymentVariant =
    order.paymentStatus === "Đã thanh toán" ? "success" :
    order.paymentStatus === "Thanh toán một phần" ? "warning" : "default";

  return (
    <div className="p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-gray-900">{order.code}</p>
          <p className="text-xs text-gray-400 mt-0.5">Tạo lúc {formatDateTime(order.createdAt)}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant={statusVariant}>{order.status}</Badge>
          <Badge variant={paymentVariant}>{order.paymentStatus}</Badge>
        </div>
      </div>

      {/* Khách hàng */}
      <div className="rounded-xl border border-gray-100 p-3.5 space-y-2">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-sky-500 flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-bold">{getInitials(order.customerName)}</span>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-800">{order.customerName}</p>
            <p className="text-xs text-gray-400">{order.customerType} · {order.customerCode}</p>
          </div>
        </div>
        <InfoRow icon={<MapPin size={13} />} value={`${order.address}, ${order.district}`} />
      </div>

      {/* Nguồn & kho */}
      <div className="grid grid-cols-2 gap-2.5 text-xs">
        <div className="rounded-xl bg-gray-50 p-3 flex items-center gap-2">
          {order.source === "Web" ? <Globe size={14} className="text-gray-400" /> : <PackageCheck size={14} className="text-gray-400" />}
          <div>
            <p className="text-gray-400">Nguồn đơn</p>
            <p className="text-gray-800 font-medium">{order.source}</p>
          </div>
        </div>
        <div className="rounded-xl bg-gray-50 p-3 flex items-center gap-2">
          <Truck size={14} className="text-gray-400" />
          <div>
            <p className="text-gray-400">Kho xuất</p>
            <p className="text-gray-800 font-medium">{order.warehouse}</p>
          </div>
        </div>
      </div>

      {/* Chi tiết hàng hóa */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-2">Chi tiết đơn hàng</h4>
        <div className="rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-3 py-2 text-gray-400 font-medium">Sản phẩm</th>
                <th className="text-right px-3 py-2 text-gray-400 font-medium">SL</th>
                <th className="text-right px-3 py-2 text-gray-400 font-medium">Đơn giá</th>
                <th className="text-right px-3 py-2 text-gray-400 font-medium">CK</th>
                <th className="text-right px-3 py-2 text-gray-400 font-medium">Thành tiền</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {order.items.map((item, i) => (
                <tr key={i}>
                  <td className="px-3 py-2">
                    <p className="text-gray-800 font-medium">{item.productName}</p>
                    <p className="text-gray-400">{item.productCode}</p>
                  </td>
                  <td className="px-3 py-2 text-right text-gray-700">{item.quantity} {item.unit}</td>
                  <td className="px-3 py-2 text-right text-gray-700">{formatVNDFull(item.price)}</td>
                  <td className="px-3 py-2 text-right text-gray-500">{item.discount > 0 ? `${item.discount}%` : "—"}</td>
                  <td className="px-3 py-2 text-right font-semibold text-gray-900">{formatVNDFull(item.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-gray-100 px-4 py-3 space-y-1.5 bg-gray-50/50">
            <SummaryRow label="Tạm tính" value={order.subtotal} />
            <SummaryRow
              label={<>Chiết khấu <Percent size={11} className="inline" /></>}
              value={-order.discount}
              negative
            />
            <div className="flex items-center justify-between pt-1.5 border-t border-gray-200 mt-1.5">
              <span className="text-sm font-bold text-gray-900">Tổng cộng</span>
              <span className="text-sm font-bold text-sky-600">{formatVNDFull(order.total)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Thanh toán */}
      <div className="rounded-xl border border-gray-100 p-3.5">
        <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
          <CreditCard size={14} className="text-gray-400" />
          Thanh toán
        </h4>
        {order.paymentStatus === "Chưa thanh toán" ? (
          <p className="text-xs text-gray-500 bg-amber-50 text-amber-700 rounded-lg px-3 py-2">
            Đơn chưa thanh toán - khách sẽ trả nợ theo kỳ hạn công nợ.
          </p>
        ) : (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500">{order.paymentMethod}</p>
              {order.invoiceCode && (
                <p className="text-xs text-gray-400 mt-0.5">Phiếu bán: {order.invoiceCode}</p>
              )}
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-emerald-600">Đã thu: {formatVNDFull(order.amountPaid)}</p>
              {order.amountPaid < order.total && (
                <p className="text-xs text-gray-400">Còn lại: {formatVNDFull(order.total - order.amountPaid)}</p>
              )}
            </div>
          </div>
        )}
      </div>

      {order.note && (
        <div className="rounded-xl bg-sky-50 text-sky-700 text-xs px-3.5 py-2.5">
          <span className="font-semibold">Ghi chú: </span>
          {order.note}
        </div>
      )}
    </div>
  );
}

function InfoRow({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-gray-400">{icon}</span>
      <span className="text-gray-600">{value}</span>
    </div>
  );
}

function SummaryRow({ label, value, negative }: { label: React.ReactNode; value: number; negative?: boolean }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-gray-500">{label}</span>
      <span className={negative ? "text-red-500 font-medium" : "text-gray-700 font-medium"}>
        {formatVNDFull(value)}
      </span>
    </div>
  );
}
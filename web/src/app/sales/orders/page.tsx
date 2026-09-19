"use client";
/* eslint-disable react-hooks/set-state-in-effect */
// src/app/sales/orders/page.tsx
import { useEffect, useState } from "react";
import { ShoppingCart, CircleCheck, Clock3, Ban, Plus, CheckCircle2, RefreshCw, AlertTriangle } from "lucide-react";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import DataTable, { Column } from "@/components/ui/DataTable";
import { formatVND } from "@/lib/format";
import { API_URL } from "@/lib/api";
import * as XLSX from "xlsx";

function toInputDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toVinamilkDate(inputDate: string) {
  const [year, month, day] = inputDate.split("-");
  return `${day}/${month}/${year}`;
}

function getDefaultDateRange() {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  return {
    from: toInputDate(yesterday),
    to: toInputDate(today),
  };
}

type RemoteOrder = Record<string, unknown>;

const remoteColumnDefinitions = [
  { title: "Số đơn hàng gốc", keys: ["fromSaleOrderNumber", "originalOrderNumber", "fromSaleOrderCode", "originalOrderId"] },
  { title: "Số đơn hàng", keys: ["orderNumber", "saleOrderNumber", "saleOrderCode", "orderCode"] },
  { title: "Mã CTKM", keys: ["promotionCode", "campaignCode", "ctkmCode", "promotionId"] },
  { title: "Tên CTKM", keys: ["promotionName", "campaignName"] },
  { title: "Ngày tạo", keys: ["createdAt", "createDate", "createdDate", "orderCreatedAt", "orderDate", "Ngày tạo"] },
  { title: "Ngày giao", keys: ["deliveryDate", "deliveryAt", "deliveryConfirmedAt", "deliveryConfirmTime", "b2bDeliveryDate", "Ngày giao"] },
  { title: "Mã NVBH", keys: ["staffCode", "salesStaffCode"] },
  { title: "Tên NVBH", keys: ["staffName", "salesStaffName"] },
  { title: "Mã KH", keys: ["customerCode", "shopCode"] },
  { title: "Tên KH", keys: ["customerName", "shopName"] },
  { title: "Địa chỉ", keys: ["address", "customerAddress", "shipTo"] },
  { title: "Mã sản phẩm", keys: ["productCode", "itemCode", "sku"] },
  { title: "Sản phẩm", keys: ["productName", "itemName", "product"] },
  { title: "ĐVT", keys: ["unit", "unitName"] },
  { title: "Số lượng", keys: ["quantity", "qty"] },
  { title: "Số lượng KM", keys: ["promotionQuantity", "freeQuantity", "giftQuantity"] },
  { title: "Giá trị", keys: ["totalValue", "total", "amount"] },
  { title: "Tỉ lệ CK", keys: ["discountRate", "saleOrderDiscount", "discountPercent"] },
  { title: "Số tiền CK", keys: ["totalDiscount", "discountAmount"] },
  { title: "Đơn giá", keys: ["unitPrice", "price"] },
  { title: "Giảm giá voucher", keys: ["voucherAmount", "voucherDiscount"] },
  { title: "Thời gian xác nhận giao hàng", keys: ["deliveryConfirmedAt", "deliveryConfirmTime", "b2bDeliveryDate"] },
  { title: "Ngày đơn hàng gốc", keys: ["initialOrderDate", "originalOrderDate"] },
] as const;

function extractRemoteRows(payload: unknown): RemoteOrder[] {
  if (Array.isArray(payload)) return payload.filter((row): row is RemoteOrder => typeof row === "object" && row !== null);
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  for (const key of ["rows", "list", "items", "content", "data"]) {
    const value = record[key];
    if (Array.isArray(value)) return value.filter((row): row is RemoteOrder => typeof row === "object" && row !== null);
    if (value && typeof value === "object") {
      const nested = extractRemoteRows(value);
      if (nested.length > 0) return nested;
    }
  }
  return [record];
}

function normalizeRemoteOrder(order: RemoteOrder): RemoteOrder {
  const normalized = Object.fromEntries(
    remoteColumnDefinitions.map(({ title, keys }) => {
      const sourceKey = keys.find((key) => hasRemoteValue(order[key]));
      return [title, sourceKey ? order[sourceKey] : null];
    })
  );
  normalized["Trạng thái"] = order.orderStatus ?? order.status ?? null;
  return normalized;
}

function hasRemoteValue(value: unknown) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function displayRemoteValue(value: unknown) {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function formatVinamilkDate(value: unknown, withTime: boolean) {
  if (value === null || value === undefined || value === "") return value;
  const raw = String(value).trim();
  const date = new Date(raw.includes("/") && !raw.includes("T") ? raw.split(" ")[0].split("/").reverse().join("-") + (raw.includes(" ") ? `T${raw.split(" ")[1]}` : "") : raw);
  if (Number.isNaN(date.getTime())) return value;

  const datePart = date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
  if (!withTime) return datePart;
  const timePart = date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  return `${datePart} ${timePart}`;
}

function formatRemoteColumnValue(title: string, value: unknown) {
  if (title === "Ngày tạo") return formatVinamilkDate(value, true);
  if (title === "Ngày giao") return formatVinamilkDate(value, false);
  return displayRemoteValue(value);
}

function numericValue(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value.replaceAll(",", "")) || 0;
  return 0;
}

export default function SalesOrdersPage() {
  const [toast, setToast] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);
  const defaultDateRange = getDefaultDateRange();
  const [fromDate, setFromDate] = useState(defaultDateRange.from);
  const [toDate, setToDate] = useState(defaultDateRange.to);
  const [remoteOrders, setRemoteOrders] = useState<RemoteOrder[]>([]);
  const [remoteError, setRemoteError] = useState("");
  const [pageSize, setPageSize] = useState(20);
  const [orderFilter, setOrderFilter] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [staffFilter, setStaffFilter] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("Tất cả");

  useEffect(() => {
    const created = window.sessionStorage.getItem("dms-order-created");
    if (created) window.sessionStorage.removeItem("dms-order-created");
  }, []);

  const handleSyncVinamilk = async () => {
    setIsSyncing(true);
    setRemoteError("");
    setToast("Đang lấy dữ liệu từ Vinamilk DMS...");
    try {
      const res = await fetch(`${API_URL}/sync/vinamilk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromDate: toVinamilkDate(fromDate), toDate: toVinamilkDate(toDate), orderSource: "0", priorityCode: "-1", orderType: "IN", saleOrderType: "-1", page: 1, rows: 500 }),
      });
      const payload: unknown = await res.json();
      if (!res.ok) {
        const message = payload && typeof payload === "object" && "detail" in payload ? String(payload.detail) : "Không lấy được dữ liệu.";
        throw new Error(message);
      }
      const rows = extractRemoteRows(payload).map(normalizeRemoteOrder);
      setRemoteOrders(rows);
      setToast(`Đã lấy ${rows.length} bản ghi từ Vinamilk DMS.`);
    } catch (error) {
      setRemoteOrders([]);
      setRemoteError(error instanceof Error ? error.message : "Lỗi kết nối tới Server.");
      setToast("");
    } finally {
      setIsSyncing(false);
    }
  };

  const remoteColumns = remoteColumnDefinitions
    .filter(({ title }) => remoteOrders.some((order) => hasRemoteValue(order[title])))
    .map(({ title }): Column<RemoteOrder> => ({
      key: title,
      title,
      sortable: true,
      render: (value) => formatRemoteColumnValue(title, value),
    }));

  const remoteStatuses = Array.from(
    new Set(
      remoteOrders
        .map((order) => displayRemoteValue(order["Trạng thái"]))
        .filter((status) => status.length > 0)
    )
  );
  const filteredRemoteOrders = remoteOrders.filter((order) => {
    const matches = (key: string, query: string) =>
      !query || displayRemoteValue(order[key]).toLocaleLowerCase("vi").includes(query.trim().toLocaleLowerCase("vi"));
    if (!matches("Số đơn hàng", orderFilter)) return false;
    if (!matches("Mã KH", customerFilter) && !matches("Tên KH", customerFilter)) return false;
    if (!matches("Mã NVBH", staffFilter) && !matches("Tên NVBH", staffFilter)) return false;
    if (!matches("Mã sản phẩm", productFilter) && !matches("Sản phẩm", productFilter)) return false;
    if (statusFilter !== "Tất cả" && displayRemoteValue(order["Trạng thái"]) !== statusFilter) return false;
    return true;
  });

  function clearFilters() {
    setOrderFilter("");
    setCustomerFilter("");
    setStaffFilter("");
    setProductFilter("");
    setStatusFilter("Tất cả");
  }

  function downloadExcel() {
    if (remoteOrders.length === 0) return;
    const exportRows = remoteOrders.map((order) =>
      Object.fromEntries(Object.entries(order).map(([key, value]) => [key, formatRemoteColumnValue(key, value)]))
    );
    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Don hang");
    XLSX.writeFile(workbook, `don-hang-vinamilk-${fromDate}-den-${toDate}.xlsx`);
  }

  const totalValue = filteredRemoteOrders.reduce((sum, order) => sum + numericValue(order["Giá trị"]), 0);
  const totalDiscount = filteredRemoteOrders.reduce((sum, order) => sum + numericValue(order["Số tiền CK"]), 0);
  const confirmedDeliveries = filteredRemoteOrders.filter((order) => hasRemoteValue(order["Thời gian xác nhận giao hàng"])).length;

  return (
    <div className="space-y-6">
      {toast && (
        <div className="flex items-center justify-between gap-3 bg-sky-50 text-sky-700 rounded-xl px-4 py-3 text-sm">
          <span className="flex items-center gap-2"><CheckCircle2 size={16} /> <strong>{toast}</strong></span>
          <button onClick={() => setToast("")} className="text-sky-500 hover:text-sky-700"><Ban size={14} /></button>
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
        <StatCard label="Tổng bản ghi" value={remoteOrders.length} icon={<ShoppingCart size={20} />} color="bg-sky-50 text-sky-600" />
        <StatCard label="Tổng giá trị" value={formatVND(totalValue)} icon={<CircleCheck size={20} />} color="bg-emerald-50 text-emerald-600" />
        <StatCard label="Đã xác nhận giao" value={confirmedDeliveries} icon={<Clock3 size={20} />} color="bg-amber-50 text-amber-600" />
        <StatCard label="Tổng chiết khấu" value={formatVND(totalDiscount)} icon={<Ban size={20} />} color="bg-rose-50 text-rose-600" />
      </div>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <label className="text-sm text-gray-600">Từ ngày<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="mt-1 block rounded-lg border border-gray-200 px-3 py-2 text-sm" aria-label="Từ ngày" /></label>
          <label className="text-sm text-gray-600">Đến ngày<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="mt-1 block rounded-lg border border-gray-200 px-3 py-2 text-sm" aria-label="Đến ngày" /></label>
          <button onClick={handleSyncVinamilk} disabled={isSyncing} className="flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50">
            <RefreshCw size={16} className={isSyncing ? "animate-spin" : ""} />{isSyncing ? "Đang đồng bộ..." : "Đồng bộ Vinamilk DMS"}
          </button>
          <label className="text-sm text-gray-600">Số dòng
            <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="mt-1 block rounded-lg border border-gray-200 px-3 py-2 text-sm">
              {[20, 50, 100, 500].map((size) => <option key={size} value={size}>{size} dòng/trang</option>)}
            </select>
          </label>
          <button onClick={downloadExcel} disabled={remoteOrders.length === 0} className="flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-50">
            Tải Excel toàn bộ
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm md:grid-cols-2 xl:grid-cols-5">
          <input value={orderFilter} onChange={(event) => setOrderFilter(event.target.value)} placeholder="Lọc số đơn hàng" className="rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          <input value={customerFilter} onChange={(event) => setCustomerFilter(event.target.value)} placeholder="Lọc mã/tên khách hàng" className="rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          <input value={staffFilter} onChange={(event) => setStaffFilter(event.target.value)} placeholder="Lọc mã/tên NVBH" className="rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          <input value={productFilter} onChange={(event) => setProductFilter(event.target.value)} placeholder="Lọc mã/tên sản phẩm" className="rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          <div className="flex gap-2">
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm">
              <option value="Tất cả">Tất cả trạng thái</option>
              {remoteStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
            <button onClick={clearFilters} className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">Xóa lọc</button>
          </div>
        </div>
        {remoteOrders.length > 0 && <p className="text-sm text-gray-500">Đang hiển thị {filteredRemoteOrders.length}/{remoteOrders.length} bản ghi sau lọc.</p>}
        {remoteError && <div className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"><AlertTriangle size={16} />{remoteError}</div>}
      </section>

      {remoteColumns.length > 0 ? (
        <DataTable
          data={filteredRemoteOrders}
          columns={remoteColumns}
          searchKeys={remoteColumns.map((column) => column.key)}
          searchPlaceholder="Tìm đơn hàng, khách hàng, sản phẩm..."
          pageSize={pageSize}
          emptyMessage="Không có đơn hàng trong khoảng ngày đã chọn"
        />
      ) : (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-12 text-center text-sm text-gray-400">
          Chưa có dữ liệu. Chọn khoảng ngày rồi bấm “Đồng bộ Vinamilk DMS”.
        </div>
      )}
    </div>
  );
}
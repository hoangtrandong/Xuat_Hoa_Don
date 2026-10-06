"use client";
/* eslint-disable react-hooks/set-state-in-effect */
// src/app/sales/orders/page.tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { ShoppingCart, CircleCheck, Clock3, Ban, Plus, CheckCircle2, RefreshCw, AlertTriangle, Download, Upload, Trash2, PencilLine, Save } from "lucide-react";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import AuthenticatedDownloadLink from "@/components/ui/AuthenticatedDownloadLink";
import StatCard from "@/components/ui/StatCard";
import DataTable, { Column } from "@/components/ui/DataTable";
import Drawer from "@/components/ui/Drawer";
import { formatVND } from "@/lib/format";
import { API_URL, apiFetch } from "@/lib/api";
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

const LONG_SYNC_DAYS = 31;
const LOCAL_PAGE_SIZE = 2000;

function eachInclusiveInputDate(from: string, to: string) {
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
  const [toYear, toMonth, toDay] = to.split("-").map(Number);
  const cursor = new Date(fromYear, fromMonth - 1, fromDay);
  const end = new Date(toYear, toMonth - 1, toDay);
  const days: string[] = [];
  while (cursor <= end) {
    days.push(toInputDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

type RemoteOrder = Record<string, unknown>;

type CompanyOption = { code: string; name: string };

type AllocationEditForm = {
  allocationId: number;
  orderNumber: string;
  productCode: string;
  productName: string;
  allocatedQuantity: number;
  companyCode: string;
  companyName: string;
  distributorSku: string;
  note: string;
};

type ReplacementEditForm = {
  newOrderNumber: string;
  replacedOrderNumber: string;
  search: string;
};

/** Khóa dòng ổn định cho bảng: dòng có cân đối dùng id allocation, dòng chưa cân đối dùng id snapshot. */
function allocationRowKey(order: RemoteOrder, index: number): string {
  const allocationId = order["_allocation_id"];
  if (typeof allocationId === "number") return `alloc-${allocationId}`;
  const localId = order["_local_id"];
  return `snap-${String(localId ?? index)}-${index}`;
}

/** Trích id allocation từ khóa dòng (trả về null với dòng chưa có cân đối). */
function allocationIdFromKey(key: string): number | null {
  if (!key.startsWith("alloc-")) return null;
  const value = Number(key.slice("alloc-".length));
  return Number.isFinite(value) ? value : null;
}

type RemoteColumnAlign = "left" | "center" | "right";

const remoteColumnDefinitions: {
  title: string;
  keys: string[];
  width: string;
  align?: RemoteColumnAlign;
  truncate?: boolean;
}[] = [
  { title: "Số đơn hàng gốc", keys: ["fromSaleOrderNumber", "originalOrderNumber", "fromSaleOrderCode", "originalOrderId", "Số đơn hàng gốc"], width: "18rem" },
  { title: "Số đơn hàng", keys: ["orderNumber", "saleOrderNumber", "saleOrderCode", "orderCode", "Số đơn hàng"], width: "7.5rem" },
  { title: "Mã CTKM", keys: ["promotionCode", "campaignCode", "ctkmCode", "promotionId", "Mã CTKM"], width: "11rem", truncate: true },
  { title: "Tên CTKM", keys: ["promotionName", "campaignName", "Tên CTKM"], width: "16rem", truncate: true },
  { title: "Ngày tạo", keys: ["createdAt", "createDate", "createdDate", "orderCreatedAt", "orderDate", "Ngày tạo", "Ngày"], width: "10.5rem" },
  { title: "Ngày giao", keys: ["deliveryDate", "deliveryAt", "deliveryConfirmedAt", "deliveryConfirmTime", "b2bDeliveryDate", "Ngày giao"], width: "7.5rem" },
  { title: "Mã NVBH", keys: ["staffCode", "salesStaffCode", "Mã NVBH"], width: "7.5rem" },
  { title: "Tên NVBH", keys: ["staffName", "salesStaffName", "Tên NVBH"], width: "10rem", truncate: true },
  { title: "Mã KH", keys: ["customerCode", "shopCode", "Mã KH"], width: "8rem" },
  { title: "Tên KH", keys: ["customerName", "shopName", "Tên KH"], width: "12rem", truncate: true },
  { title: "Địa chỉ", keys: ["address", "customerAddress", "shipTo", "Địa chỉ"], width: "14rem", truncate: true },
  { title: "Mã sản phẩm", keys: ["productCode", "itemCode", "sku", "Mã sản phẩm"], width: "7.5rem" },
  { title: "Sản phẩm", keys: ["productName", "itemName", "product", "Sản phẩm"], width: "16rem", truncate: true },
  { title: "ĐVT", keys: ["unit", "unitName", "ĐVT"], width: "4.5rem" },
  { title: "Số lượng", keys: ["quantity", "qty", "Số lượng"], width: "6.5rem", align: "right" },
  { title: "Số lượng KM", keys: ["promotionQuantity", "freeQuantity", "giftQuantity", "Số lượng KM"], width: "7.5rem", align: "right" },
  { title: "Giá trị", keys: ["totalValue", "total", "amount", "Giá trị"], width: "8rem", align: "right" },
  { title: "Tỉ lệ CK", keys: ["discountRate", "saleOrderDiscount", "discountPercent", "Tỉ lệ CK"], width: "6.5rem", align: "right" },
  { title: "Số tiền CK", keys: ["totalDiscount", "discountAmount", "Số tiền CK"], width: "8rem", align: "right" },
  { title: "Đơn giá", keys: ["unitPrice", "price", "Đơn giá"], width: "7.5rem", align: "right" },
  { title: "Giảm giá voucher", keys: ["voucherAmount", "voucherDiscount", "Giảm giá voucher"], width: "9rem", align: "right" },
  { title: "Thời gian xác nhận giao hàng", keys: ["deliveryConfirmedAt", "deliveryConfirmTime", "b2bDeliveryDate"], width: "14rem" },
  { title: "Ngày đơn hàng gốc", keys: ["initialOrderDate", "originalOrderDate", "Ngày đơn hàng gốc"], width: "10.5rem" },
  { title: "Công ty quản lý", keys: ["_company_name"], width: "12rem", truncate: true },
  { title: "Mã công ty", keys: ["_company_code"], width: "7.5rem" },
  { title: "Mã NPP nội bộ", keys: ["_distributor_sku"], width: "9rem" },
  { title: "Trạng thái cân đối", keys: ["_allocation_status"], width: "9.5rem" },
  { title: "Số lượng phân bổ", keys: ["_allocated_quantity"], width: "8.5rem", align: "right" },
  { title: "Trạng thái xử lý", keys: [], width: "14rem" },
  { title: "Thay thế cho đơn", keys: ["_replaced_order_number"], width: "12rem" },
];

type SyncDayPayload = {
  row_count?: number;
  days_failed?: string[];
  status?: string;
  detail?: string;
};

function normalizeRemoteOrder(order: RemoteOrder): RemoteOrder {
  const normalized = Object.fromEntries(
    remoteColumnDefinitions.map(({ title, keys }) => {
      const sourceKey = keys.find((key) => hasRemoteValue(order[key]));
      return [title, sourceKey ? order[sourceKey] : null];
    })
  );
  normalized["Trạng thái"] = order.orderStatus ?? order.status ?? null;
  normalized["Thay thế cho đơn"] = order["_replaced_order_number"] ?? null;
  // Giữ lại metadata kỹ thuật để phục vụ chỉnh sửa / xóa dòng cân đối.
  normalized["_allocation_id"] = typeof order["_allocation_id"] === "number" ? order["_allocation_id"] : null;
  normalized["_local_id"] = order["_local_id"] ?? null;
  normalized["_note"] = order["_note"] ?? null;
  normalized["_replaced_by_order_numbers"] = order["_replaced_by_order_numbers"] ?? null;
  normalized["_uploaded_by"] = order["_uploaded_by"] ?? null;
  normalized["_uploaded_at"] = order["_uploaded_at"] ?? null;
  normalized["_warehouse_updated"] = order["_warehouse_updated"] ?? null;
  normalized["_returned"] = order["_returned"] ?? null;
  return normalized;
}

/** Mỗi trạng thái được theo dõi là một dòng độc lập; chỉ tách ở chế độ dữ liệu đồng bộ. */
function expandProcessingStates(order: RemoteOrder): RemoteOrder[] {
  const states: string[] = [];
  if (order["_warehouse_updated"] === true) states.push("Đã cập nhật kho");
  if (order["_returned"] === true) states.push("Đã trả");
  if (states.length === 0) {
    const unknown = order["_warehouse_updated"] == null && order["_returned"] == null;
    states.push(unknown ? "Chưa xác định" : "Chưa cập nhật kho / chưa trả");
  }
  return states.map((state, index) => ({ ...order, "Trạng thái xử lý": state, _state_copy: index > 0 }));
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

function formatVinamilkDate(value: unknown, withTime: boolean): string {
  if (value === null || value === undefined || value === "") return "";
  const raw = String(value).trim();
  const date = new Date(raw.includes("/") && !raw.includes("T") ? raw.split(" ")[0].split("/").reverse().join("-") + (raw.includes(" ") ? `T${raw.split(" ")[1]}` : "") : raw);
  if (Number.isNaN(date.getTime())) return displayRemoteValue(value);

  const datePart = date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
  if (!withTime) return datePart;
  const timePart = date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  return `${datePart} ${timePart}`;
}

function formatRemoteColumnValue(title: string, value: unknown): string {
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
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState(20);
  const [orderFilter, setOrderFilter] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [staffFilter, setStaffFilter] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("Tất cả");
  const [source, setSource] = useState<"manual" | "sync">("manual");
  const [isUploading, setIsUploading] = useState(false);
  const allocationFileInput = useRef<HTMLInputElement>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(new Set());
  const [selectAllRange, setSelectAllRange] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editingAllocation, setEditingAllocation] = useState<AllocationEditForm | null>(null);
  const [isSavingAllocation, setIsSavingAllocation] = useState(false);
  const [editingReplacement, setEditingReplacement] = useState<ReplacementEditForm | null>(null);
  const [replacementOptions, setReplacementOptions] = useState<string[]>([]);
  const [isSavingReplacement, setIsSavingReplacement] = useState(false);
  const replacementSearchVersion = useRef(0);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);

  useEffect(() => {
    const created = window.sessionStorage.getItem("dms-order-created");
    if (created) window.sessionStorage.removeItem("dms-order-created");
  }, []);

  useEffect(() => {
    apiFetch(`${API_URL}/companies/`)
      .then((response) => (response.ok ? response.json() : []))
      .then((payload) => {
        if (!Array.isArray(payload)) return;
        setCompanies(payload
          .map((item: Record<string, unknown>) => ({ code: String(item.code ?? "").trim(), name: String(item.name ?? "").trim() }))
          .filter((item: CompanyOption) => item.code.length > 0));
      })
      .catch(() => setCompanies([]));
  }, []);

  useEffect(() => {
    setSelectedRowKeys(new Set());
    setSelectAllRange(false);
  }, [source, fromDate, toDate, orderFilter, customerFilter, staffFilter, productFilter, statusFilter]);

  const loadLocalOrders = useCallback(async () => {
    const allRows: RemoteOrder[] = [];
    let skip = 0;
    let lastSynced: string | null = null;
    while (true) {
      const response = await apiFetch(
        `${API_URL}/sync/vinamilk-orders?from_date=${encodeURIComponent(fromDate)}&to_date=${encodeURIComponent(toDate)}&source=${source}&skip=${skip}&limit=${LOCAL_PAGE_SIZE}`
      );
      const payload = await response.json() as {
        rows?: unknown;
        snapshot_total?: number;
        snapshot_count?: number;
        last_synced_at?: string | null;
        detail?: string;
      };
      if (!response.ok) throw new Error(payload.detail ?? "Không thể tải dữ liệu đơn hàng đã đồng bộ.");
      const rows = Array.isArray(payload.rows) ? payload.rows : [];
      allRows.push(...rows.filter((row): row is RemoteOrder => typeof row === "object" && row !== null));
      lastSynced = payload.last_synced_at ?? lastSynced;
      const snapshotCount = payload.snapshot_count ?? rows.length;
      const snapshotTotal = payload.snapshot_total;
      skip += snapshotCount;
      if (snapshotCount === 0) break;
      if (snapshotTotal != null && skip >= snapshotTotal) break;
      if (snapshotCount < LOCAL_PAGE_SIZE) break;
    }
    const normalizedRows = allRows.map(normalizeRemoteOrder);
    setRemoteOrders(source === "sync" ? normalizedRows.flatMap(expandProcessingStates) : normalizedRows);
    setLastSyncedAt(lastSynced);
  }, [fromDate, source, toDate]);

  useEffect(() => {
    loadLocalOrders().catch((error) => setRemoteError(error instanceof Error ? error.message : "Không thể tải dữ liệu."));
  }, [loadLocalOrders]);

  const handleSyncVinamilk = async () => {
    const days = eachInclusiveInputDate(fromDate, toDate);
    if (days.length === 0) {
      setRemoteError("Khoảng ngày không hợp lệ. Ngày kết thúc phải lớn hơn hoặc bằng ngày bắt đầu.");
      return;
    }
    if (days.length > LONG_SYNC_DAYS && !window.confirm(`Khoảng ${days.length} ngày sẽ được đồng bộ lần lượt từng ngày để tránh quá tải Vinamilk. Tiếp tục?`)) {
      return;
    }
    setIsSyncing(true);
    setRemoteError("");
    setToast(`Đang đồng bộ ngày 1/${days.length} (${toVinamilkDate(days[0])})...`);
    let savedTotal = 0;
    const failedDays: string[] = [];
    try {
      for (let index = 0; index < days.length; index += 1) {
        const day = days[index];
        setToast(`Đang đồng bộ ngày ${index + 1}/${days.length} (${toVinamilkDate(day)})...`);
        try {
          const res = await apiFetch(`${API_URL}/sync/vinamilk`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fromDate: toVinamilkDate(day),
              toDate: toVinamilkDate(day),
              orderSource: "0",
              priorityCode: "-1",
              orderType: "IN",
              saleOrderType: "-1",
              page: 1,
              rows: 500,
            }),
          });
          const payload = await res.json() as SyncDayPayload;
          if (!res.ok) throw new Error(payload.detail ?? "Không lấy được dữ liệu.");
          savedTotal += payload.row_count ?? 0;
          if (payload.days_failed?.length) failedDays.push(...payload.days_failed);
        } catch (error) {
          failedDays.push(day);
          console.error(error);
        }
      }
      await loadLocalOrders();
      if (failedDays.length === days.length) {
        throw new Error("Không đồng bộ được ngày nào trong khoảng đã chọn.");
      }
      setToast(failedDays.length > 0
        ? `Đã lưu ${savedTotal} bản ghi. Lỗi ${failedDays.length}/${days.length} ngày: ${failedDays.map(toVinamilkDate).join(", ")}.`
        : `Đã đồng bộ ${savedTotal} bản ghi (${days.length} ngày) vào database.`);
    } catch (error) {
      setRemoteError(error instanceof Error ? error.message : "Lỗi kết nối tới Server.");
      setToast("");
    } finally {
      setIsSyncing(false);
    }
  };

  async function uploadAllocations(file: File) {
    setIsUploading(true);
    setRemoteError("");
    setToast("Đang kiểm tra và lưu dữ liệu cân đối...");
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await apiFetch(`${API_URL}/sync/vinamilk-orders/allocations/upload`, { method: "POST", body });
      const result = await response.json() as { uploaded?: number; orders?: number; detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "Không thể upload dữ liệu cân đối.");
      setSource("manual");
      clearSelection();
      await loadLocalOrders();
      setToast(`Đã lưu ${result.uploaded ?? 0} dòng cân đối cho ${result.orders ?? 0} dòng đơn.`);
    } catch (error) {
      setRemoteError(error instanceof Error ? error.message : "Không thể upload dữ liệu cân đối.");
      setToast("");
    } finally {
      setIsUploading(false);
    }
  }

  const remoteColumns = remoteColumnDefinitions
    .filter(({ title }) => (
      source === "sync" && ["Trạng thái xử lý", "Thay thế cho đơn"].includes(title)
    ) || remoteOrders.some((order) => hasRemoteValue(order[title])))
    .map(({ title, width, align }): Column<RemoteOrder> => ({
      key: title,
      title,
      sortable: true,
      width,
      align,
      render: (value, order) => {
        const text = formatRemoteColumnValue(title, value);
        if (title === "Thay thế cho đơn" && source === "sync") {
          return (
            <button
              type="button"
              onClick={() => openReplacementEditor(order)}
              className="text-left font-medium text-sky-700 hover:text-sky-900 hover:underline"
            >
              {text || "Gán đơn thay thế"}
            </button>
          );
        }
        if (title === "Trạng thái xử lý") {
          const tone = text.startsWith("Đã") ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600";
          return <span className={`rounded-full px-2 py-1 text-xs font-medium ${tone}`}>{text}</span>;
        }
        return <span className="block truncate" title={text || undefined}>{text}</span>;
      },
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
    // Tìm đơn cũ thì vẫn thấy đơn thay thế nó (và ngược lại).
    const orderQuery = orderFilter.trim().toLocaleLowerCase("vi");
    const relatedOrders = [
      order["Thay thế cho đơn"],
      ...(Array.isArray(order["_replaced_by_order_numbers"]) ? order["_replaced_by_order_numbers"] : []),
    ].map((value) => displayRemoteValue(value).toLocaleLowerCase("vi"));
    if (!matches("Số đơn hàng", orderFilter) && !(orderQuery && relatedOrders.some((value) => value.includes(orderQuery)))) return false;
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

  const isAllocationRow = (order: RemoteOrder) => typeof order["_allocation_id"] === "number";
  const selectableAllocationKeys = filteredRemoteOrders.filter(isAllocationRow).map((order) => allocationRowKey(order, 0));
  const selectedAllocationIds = Array.from(selectedRowKeys)
    .map((key) => allocationIdFromKey(key))
    .filter((id): id is number => id !== null);
  const selectedCount = selectAllRange ? selectableAllocationKeys.length : selectedAllocationIds.length;

  function handleSelectionChange(keys: Set<string>) {
    setSelectedRowKeys(keys);
    setSelectAllRange(false);
  }

  function selectAllAllocations() {
    setSelectedRowKeys(new Set(selectableAllocationKeys));
    setSelectAllRange(true);
  }

  function clearSelection() {
    setSelectedRowKeys(new Set());
    setSelectAllRange(false);
  }

  async function loadReplacementOptions(search: string) {
    const requestVersion = ++replacementSearchVersion.current;
    try {
      const response = await apiFetch(
        `${API_URL}/sync/vinamilk-orders/order-options?search=${encodeURIComponent(search)}&limit=50`
      );
      const payload = await response.json() as { order_numbers?: unknown; detail?: string };
      if (!response.ok) throw new Error(payload.detail ?? "Không thể tải danh sách đơn hàng.");
      if (requestVersion !== replacementSearchVersion.current) return;
      setReplacementOptions(
        Array.isArray(payload.order_numbers)
          ? payload.order_numbers.filter((number): number is string => typeof number === "string")
          : []
      );
    } catch (error) {
      if (requestVersion === replacementSearchVersion.current) {
        setRemoteError(error instanceof Error ? error.message : "Không thể tải danh sách đơn hàng.");
      }
    }
  }

  function openReplacementEditor(order: RemoteOrder) {
    const newOrderNumber = displayRemoteValue(order["Số đơn hàng"]);
    setRemoteError("");
    setEditingReplacement({
      newOrderNumber,
      replacedOrderNumber: displayRemoteValue(order["Thay thế cho đơn"]),
      search: "",
    });
    void loadReplacementOptions("");
  }

  async function saveOrderReplacement() {
    if (!editingReplacement) return;
    setIsSavingReplacement(true);
    setRemoteError("");
    try {
      const response = await apiFetch(
        `${API_URL}/sync/vinamilk-orders/${encodeURIComponent(editingReplacement.newOrderNumber)}/replacement`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ replaced_order_number: editingReplacement.replacedOrderNumber || null }),
        }
      );
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "Không thể lưu liên kết đơn thay thế.");
      setEditingReplacement(null);
      setToast(editingReplacement.replacedOrderNumber
        ? `Đã lưu ${editingReplacement.newOrderNumber} thay thế cho ${editingReplacement.replacedOrderNumber}.`
        : `Đã xóa liên kết thay thế của đơn ${editingReplacement.newOrderNumber}.`);
      try {
        await loadLocalOrders();
      } catch (error) {
        setRemoteError(`Đã lưu liên kết nhưng không thể tải lại dữ liệu: ${error instanceof Error ? error.message : "Lỗi không xác định."}`);
      }
    } catch (error) {
      setRemoteError(error instanceof Error ? error.message : "Không thể lưu liên kết đơn thay thế.");
    } finally {
      setIsSavingReplacement(false);
    }
  }

  async function deleteSelectedAllocations() {
    if (selectedAllocationIds.length === 0 && !selectAllRange) return;
    const scopeLabel = selectAllRange
      ? `toàn bộ ${selectableAllocationKeys.length} dòng cân đối trong khoảng ${fromDate} → ${toDate}`
      : `${selectedAllocationIds.length} dòng cân đối đã chọn`;
    if (!window.confirm(`Bạn có chắc muốn xóa ${scopeLabel}? Thao tác này không thể hoàn tác.`)) return;
    setIsDeleting(true);
    setRemoteError("");
    setToast("Đang xóa dữ liệu cân đối...");
    try {
      const response = await apiFetch(`${API_URL}/sync/vinamilk-orders/allocations/bulk-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selectAllRange
          ? { delete_all: true, from_date: fromDate, to_date: toDate }
          : { allocation_ids: selectedAllocationIds }),
      });
      const result = await response.json() as { deleted?: number; detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "Không thể xóa dữ liệu cân đối.");
      clearSelection();
      await loadLocalOrders();
      setToast(`Đã xóa ${result.deleted ?? 0} dòng cân đối.`);
    } catch (error) {
      setRemoteError(error instanceof Error ? error.message : "Không thể xóa dữ liệu cân đối.");
      setToast("");
    } finally {
      setIsDeleting(false);
    }
  }

  function openEditAllocation() {
    const target = filteredRemoteOrders.find((order) => isAllocationRow(order) && selectedRowKeys.has(allocationRowKey(order, 0)));
    if (!target) {
      setRemoteError("Vui lòng chọn đúng một dòng cân đối để chỉnh sửa.");
      return;
    }
    setRemoteError("");
    setEditingAllocation({
      allocationId: Number(target["_allocation_id"]),
      orderNumber: displayRemoteValue(target["Số đơn hàng"]),
      productCode: displayRemoteValue(target["Mã sản phẩm"]),
      productName: displayRemoteValue(target["Sản phẩm"]),
      allocatedQuantity: numericValue(target["Số lượng phân bổ"]),
      companyCode: displayRemoteValue(target["Mã công ty"]) || displayRemoteValue(target["_company_code"]),
      companyName: displayRemoteValue(target["Công ty quản lý"]),
      distributorSku: displayRemoteValue(target["Mã NPP nội bộ"]) || displayRemoteValue(target["_distributor_sku"]),
      note: displayRemoteValue(target["_note"]),
    });
  }

  async function saveAllocationEdit() {
    if (!editingAllocation) return;
    setIsSavingAllocation(true);
    setRemoteError("");
    try {
      const response = await apiFetch(`${API_URL}/sync/vinamilk-orders/allocations/${editingAllocation.allocationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allocated_quantity: editingAllocation.allocatedQuantity,
          company_code: editingAllocation.companyCode,
          distributor_sku: editingAllocation.distributorSku,
          note: editingAllocation.note,
        }),
      });
      const result = await response.json() as { expected_quantity?: number | null; allocated_total?: number; detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "Không thể lưu thay đổi.");
      setEditingAllocation(null);
      clearSelection();
      await loadLocalOrders();
      const balanced = result.expected_quantity != null && result.expected_quantity === result.allocated_total;
      setToast(balanced
        ? "Đã lưu thay đổi và số lượng cân đối khớp với đơn hàng."
        : `Đã lưu thay đổi. Lưu ý: tổng phân bổ ${result.allocated_total ?? 0} chưa khớp số lượng gốc ${result.expected_quantity ?? "-"}.`);
    } catch (error) {
      setRemoteError(error instanceof Error ? error.message : "Không thể lưu thay đổi.");
    } finally {
      setIsSavingAllocation(false);
    }
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

  const primaryOrders = filteredRemoteOrders.filter((order) => order["_state_copy"] !== true);
  const totalValue = primaryOrders.reduce((sum, order) => sum + numericValue(order["Giá trị"]), 0);
  const totalDiscount = primaryOrders.reduce((sum, order) => sum + numericValue(order["Số tiền CK"]), 0);
  const confirmedDeliveries = primaryOrders.filter((order) => hasRemoteValue(order["Thời gian xác nhận giao hàng"])).length;

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
        <StatCard label="Tổng bản ghi" value={remoteOrders.filter((order) => order["_state_copy"] !== true).length} icon={<ShoppingCart size={20} />} color="bg-sky-50 text-sky-600" />
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
          <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-1">
            <button onClick={() => setSource("manual")} className={`rounded-md px-3 py-2 text-sm font-medium ${source === "manual" ? "bg-white text-sky-700 shadow-sm" : "text-gray-500"}`}>Cân đối thủ công</button>
            <button onClick={() => setSource("sync")} className={`rounded-md px-3 py-2 text-sm font-medium ${source === "sync" ? "bg-white text-sky-700 shadow-sm" : "text-gray-500"}`}>Dữ liệu đồng bộ</button>
          </div>
          <AuthenticatedDownloadLink href={`${API_URL}/sync/vinamilk-orders/allocations/template`} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600"><Download size={16} />Tải mẫu cân đối</AuthenticatedDownloadLink>
          <button onClick={() => allocationFileInput.current?.click()} disabled={isUploading} className="flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-700 disabled:opacity-50"><Upload size={16} />{isUploading ? "Đang upload..." : "Upload cân đối"}</button>
          <input ref={allocationFileInput} type="file" accept=".xlsx,.xlsm" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadAllocations(file); event.target.value = ""; }} />
          {source === "manual" && (
            <>
              <button onClick={selectAllAllocations} disabled={selectableAllocationKeys.length === 0} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50">
                Chọn tất cả ({selectableAllocationKeys.length})
              </button>
              <button onClick={clearSelection} disabled={selectedRowKeys.size === 0} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50">
                Bỏ chọn
              </button>
              <button onClick={openEditAllocation} disabled={selectedAllocationIds.length !== 1 || selectAllRange} className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50">
                <PencilLine size={16} />Sửa dòng
              </button>
              <button onClick={deleteSelectedAllocations} disabled={isDeleting || selectedCount === 0} className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50">
                <Trash2 size={16} />{isDeleting ? "Đang xóa..." : `Xóa đã chọn (${selectedCount})`}
              </button>
            </>
          )}
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
          <input value={orderFilter} onChange={(event) => setOrderFilter(event.target.value)} placeholder="Lọc số đơn hàng" className="min-w-0 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          <input value={customerFilter} onChange={(event) => setCustomerFilter(event.target.value)} placeholder="Lọc mã/tên khách hàng" className="min-w-0 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          <input value={staffFilter} onChange={(event) => setStaffFilter(event.target.value)} placeholder="Lọc mã/tên NVBH" className="min-w-0 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          <input value={productFilter} onChange={(event) => setProductFilter(event.target.value)} placeholder="Lọc mã/tên sản phẩm" className="min-w-0 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          <div className="flex gap-2">
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm">
              <option value="Tất cả">Tất cả trạng thái</option>
              {remoteStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
            <button onClick={clearFilters} className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">Xóa lọc</button>
          </div>
        </div>
        {remoteOrders.length > 0 && <p className="text-sm text-gray-500">Đang hiển thị {filteredRemoteOrders.length}/{remoteOrders.length} bản ghi sau lọc. Chế độ: {source === "manual" ? "Cân đối thủ công" : "Dữ liệu đồng bộ"}.{lastSyncedAt && ` Cập nhật gần nhất: ${formatVinamilkDate(lastSyncedAt, true)}`}</p>}
        {source === "manual" && remoteOrders.length > 0 && selectableAllocationKeys.length === 0 && (
          <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
            <AlertTriangle size={16} />
            <span>Chưa có dòng cân đối nào để chọn. Hãy bấm “Upload cân đối” để tải file Excel phân bổ lên trước, sau đó bạn có thể chọn nhiều dòng hoặc tất cả để chỉnh sửa / xóa.</span>
          </div>
        )}

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
          selectable={source === "manual"}
          selectedKeys={selectedRowKeys}
          onSelectedKeysChange={handleSelectionChange}
          getRowKey={(order, index) => allocationRowKey(order, index)}
          isRowSelectable={isAllocationRow}
          fitColumns
        />
      ) : (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-12 text-center text-sm text-gray-400">
          Chưa có dữ liệu trong database. Chọn khoảng ngày rồi bấm “Đồng bộ Vinamilk DMS” để cập nhật.
        </div>
      )}

      <Drawer
        open={editingAllocation !== null}
        onClose={() => setEditingAllocation(null)}
        title="Chỉnh sửa dòng cân đối"
        subtitle={editingAllocation ? `Đơn ${editingAllocation.orderNumber} · SKU ${editingAllocation.productCode}` : undefined}
      >
        {editingAllocation && (
          <div className="space-y-4 p-5">
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-600">
              <p><span className="font-medium text-gray-700">Sản phẩm:</span> {editingAllocation.productName || "-"}</p>
              <p><span className="font-medium text-gray-700">Mã sản phẩm:</span> {editingAllocation.productCode || "-"}</p>
              <p><span className="font-medium text-gray-700">Số đơn hàng:</span> {editingAllocation.orderNumber || "-"}</p>
              <p className="text-xs text-gray-400">Mã dòng cân đối #{editingAllocation.allocationId}</p>
            </div>

            <label className="block text-sm text-gray-600">
              Số lượng phân bổ
              <input
                type="number"
                min={0}
                value={editingAllocation.allocatedQuantity}
                onChange={(event) => setEditingAllocation({ ...editingAllocation, allocatedQuantity: Math.max(0, Number(event.target.value) || 0) })}
                className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </label>

            <label className="block text-sm text-gray-600">
              Công ty quản lý
              <select
                value={editingAllocation.companyCode}
                onChange={(event) => {
                  const option = companies.find((item) => item.code === event.target.value);
                  setEditingAllocation({ ...editingAllocation, companyCode: event.target.value, companyName: option?.name ?? "" });
                }}
                className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              >
                <option value="">-- Chọn công ty --</option>
                {editingAllocation.companyCode && !companies.some((item) => item.code === editingAllocation.companyCode) && (
                  <option value={editingAllocation.companyCode}>{editingAllocation.companyCode} · {editingAllocation.companyName || "không rõ tên"}</option>
                )}
                {companies.map((company) => (
                  <option key={company.code} value={company.code}>{company.code} · {company.name}</option>
                ))}
              </select>
            </label>

            <label className="block text-sm text-gray-600">
              Mã NPP nội bộ
              <input
                value={editingAllocation.distributorSku}
                onChange={(event) => setEditingAllocation({ ...editingAllocation, distributorSku: event.target.value })}
                placeholder="Mã SKU phân phối nội bộ"
                className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </label>

            <label className="block text-sm text-gray-600">
              Ghi chú
              <textarea
                value={editingAllocation.note}
                onChange={(event) => setEditingAllocation({ ...editingAllocation, note: event.target.value })}
                rows={3}
                placeholder="Ghi chú cho dòng cân đối"
                className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </label>

            <div className="flex items-center justify-end gap-2 border-t border-gray-100 pt-4">
              <button onClick={() => setEditingAllocation(null)} disabled={isSavingAllocation} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                Hủy
              </button>
              <button onClick={saveAllocationEdit} disabled={isSavingAllocation} className="flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-50">
                <Save size={16} />{isSavingAllocation ? "Đang lưu..." : "Lưu thay đổi"}
              </button>
            </div>
          </div>
        )}
      </Drawer>

      <Drawer
        open={editingReplacement !== null}
        onClose={() => setEditingReplacement(null)}
        title="Liên kết đơn hàng thay thế"
        subtitle={editingReplacement ? `Đơn mới: ${editingReplacement.newOrderNumber}` : undefined}
      >
        {editingReplacement && (
          <div className="space-y-4 p-5">
            <p className="text-sm text-gray-600">
              Chọn đơn cũ mà đơn mới này thay thế. Liên kết chỉ phục vụ truy vết, không tự cập nhật tồn kho, thanh toán hoặc trạng thái đơn.
            </p>
            <label className="block text-sm text-gray-600">
              Tìm mã đơn cũ
              <input
                value={editingReplacement.search}
                onChange={(event) => {
                  const search = event.target.value;
                  setEditingReplacement({ ...editingReplacement, search });
                  void loadReplacementOptions(search);
                }}
                placeholder="Nhập một phần mã đơn hàng"
                className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm text-gray-600">
              Thay thế cho đơn
              <select
                value={editingReplacement.replacedOrderNumber}
                onChange={(event) => setEditingReplacement({ ...editingReplacement, replacedOrderNumber: event.target.value })}
                className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              >
                <option value="">-- Không liên kết --</option>
                {editingReplacement.replacedOrderNumber && !replacementOptions.includes(editingReplacement.replacedOrderNumber) && (
                  <option value={editingReplacement.replacedOrderNumber}>{editingReplacement.replacedOrderNumber}</option>
                )}
                {replacementOptions.map((orderNumber) => (
                  <option key={orderNumber} value={orderNumber}>{orderNumber}</option>
                ))}
              </select>
            </label>
            <div className="flex items-center justify-end gap-2 border-t border-gray-100 pt-4">
              <button
                onClick={() => setEditingReplacement(null)}
                disabled={isSavingReplacement}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                Hủy
              </button>
              <button
                onClick={saveOrderReplacement}
                disabled={isSavingReplacement}
                className="flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Save size={16} />{isSavingReplacement ? "Đang lưu..." : "Lưu liên kết"}
              </button>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
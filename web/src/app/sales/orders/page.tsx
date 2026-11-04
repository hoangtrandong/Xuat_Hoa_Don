"use client";
/* eslint-disable react-hooks/set-state-in-effect */
// src/app/sales/orders/page.tsx
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ShoppingCart,
  CircleCheck,
  Clock3,
  Ban,
  Plus,
  CheckCircle2,
  RefreshCw,
  AlertTriangle,
  Save,
  Split,
  Merge,
  RotateCcw,
  ClipboardCheck,
  XCircle,
  Download,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import DataTable, { Column } from "@/components/ui/DataTable";
import Drawer from "@/components/ui/Drawer";
import { formatVND } from "@/lib/format";
import { API_URL, apiFetch } from "@/lib/api";
import { useAuthSession } from "@/lib/auth-session";
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
  const todayStr = toInputDate(today);
  return {
    from: todayStr,
    to: todayStr,
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

type ReplacementEditForm = {
  newOrderNumber: string;
  replacedOrderNumber: string;
  search: string;
};

type SplitAllocCell = {
  quantity: number;
  promoQuantity: number;
  customValue?: number | null;
  customDiscount?: number | null;
};

type SplitAllocMap = Record<number, SplitAllocCell[]>;

type CustomerOption = {
  customer_code: string;
  customer_name: string;
  customer_address: string;
  store_code?: string;
  store_name?: string;
  company_code?: string;
  company_name?: string;
};

type StaffOption = {
  staff_code: string;
  staff_name: string;
  employee_code?: string;
};

type DeliveryEmployeeOption = {
  code: string;
  name: string;
  status: string;
};

type DeliveryWarehouseOption = {
  id: number;
  name: string;
};

type DeliveryRequestOrderOption = {
  order_number: string;
  order_date: string;
  customer_code: string;
  customer_name: string;
  original_status: string;
};

type DeliveryRequestPreviewItem = {
  product_id: number;
  sku: string;
  product_name: string;
  quantity: number;
  boxes_per_carton: number;
  available_quantity: number;
  shortage_quantity: number;
  employee_allocations?: Record<string, { quantity?: number }> | null;
  borrowed_employee_offsets?: {
    external_employee_code: string;
    external_employee_name?: string | null;
    employee_id?: number | null;
    quantity: number;
    amount: number;
  }[];
};

type DeliveryRequestPreview = {
  items: DeliveryRequestPreviewItem[];
  employee_summaries: {
    employee_id: number | null;
    employee_code: string;
    employee_name?: string | null;
    weight_ton: number;
    order_count: number;
    amount: number;
    is_over_limit?: boolean;
    projected_debt?: number;
    debt_limit?: number;
  }[];
  orders: {
    order_date?: string | null;
    order_number: string;
    employee_id?: number | null;
    employee_code: string;
    employee_name?: string | null;
    customer_code?: string | null;
    customer_name?: string | null;
    amount: number;
    payment_status: string;
    payment_method?: string | null;
  }[];
  issues: string[];
  warnings: string[];
  import_hash: string;
  filename: string;
  can_create: boolean;
};

type DeliveryPlanItem = {
  product_id: number;
  sku: string;
  quantity: number;
  planned_quantity: number;
  shortage_quantity: number;
  picks: {
    lot_id: number | null;
    location_code: string | null;
    location_id: number | null;
    lot_number: string | null;
    expiry_date: string | null;
    quantity: number;
    allocation_strategy: string;
  }[];
};

type SplitCustomerSelection = {
  customer_code: string;
  customer_name: string;
  customer_address: string;
  is_staff_debt?: boolean;
};

type GroupedOrderSummary = {
  orderNumber: string;
  customerCode: string;
  customerName: string;
  customerAddress: string;
  staffCode: string;
  staffName: string;
  createdAt: string;
  deliveryDate: string;
  totalValue: number;
  totalDiscount: number;
  totalQty: number;
  totalPromoQty: number;
  lines: RemoteOrder[];
};

type SplitRequestPreviewItem = {
  snapshot_id: number;
  product_code: string;
  product_name: string;
  promo_code?: string;
  unit?: string;
  quantity: number;
  promo_quantity: number;
  value_amount: number;
  discount_amount: number;
};

type SplitRequestPreviewSplit = {
  new_order_number: string;
  customer_code: string;
  customer_name: string;
  customer_address?: string;
  is_staff_debt?: boolean;
  status_label: string;
  total_qty: number;
  total_promo_qty: number;
  total_value: number;
  total_discount: number;
  items: SplitRequestPreviewItem[];
};

type SplitOrderApprovalRequest = {
  id: number;
  source_order_number: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  requested_by: string;
  requested_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  result_order_numbers: string[];
  preview: {
    source_order_number?: string;
    customer_code?: string;
    customer_name?: string;
    staff_code?: string;
    staff_name?: string;
    order_created_date?: string | null;
    total_qty?: number;
    total_promo_qty?: number;
    total_value?: number;
    total_discount?: number;
    splits?: SplitRequestPreviewSplit[];
  };
};

function orderRowKey(order: RemoteOrder, index: number): string {
  return `${String(order["_local_id"] ?? "row")}-${index}`;
}

type RemoteColumnAlign = "left" | "center" | "right";

const remoteColumnDefinitions: {
  title: string;
  keys: string[];
  width: string;
  align?: RemoteColumnAlign;
  truncate?: boolean;
}[] = [
  { title: "Số đơn hàng", keys: ["orderNumber", "saleOrderNumber", "saleOrderCode", "orderCode", "Số đơn hàng"], width: "9rem" },
  { title: "Trạng thái tạo đơn", keys: ["Trạng thái tạo đơn", "orderType", "_order_type"], width: "10.5rem" },
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
  { title: "Nhà cung cấp", keys: ["Nhà cung cấp", "supplier", "_supplier"], width: "9.5rem", truncate: true },
  { title: "ĐVT", keys: ["unit", "unitName", "ĐVT"], width: "4.5rem" },
  { title: "Số lượng", keys: ["quantity", "qty", "Số lượng"], width: "6.5rem", align: "right" },
  { title: "Số lượng KM", keys: ["promotionQuantity", "freeQuantity", "giftQuantity", "Số lượng KM"], width: "7.5rem", align: "right" },
  { title: "Giá trị", keys: ["totalValue", "total", "amount", "Giá trị"], width: "8rem", align: "right" },
  { title: "Tỉ lệ CK", keys: ["discountRate", "saleOrderDiscount", "discountPercent", "Tỉ lệ CK"], width: "6.5rem", align: "right" },
  { title: "Số tiền CK", keys: ["totalDiscount", "discountAmount", "Số tiền CK"], width: "8rem", align: "right" },
  { title: "Đơn giá", keys: ["unitPrice", "price", "Đơn giá"], width: "7.5rem", align: "right" },
  { title: "Thời gian xác nhận giao hàng", keys: ["deliveryConfirmedAt", "deliveryConfirmTime", "b2bDeliveryDate"], width: "14rem" },
  { title: "Ngày đơn hàng gốc", keys: ["initialOrderDate", "originalOrderDate", "Ngày đơn hàng gốc"], width: "10.5rem" },
  { title: "Tình trạng xử lý đơn hàng", keys: ["Tình trạng xử lý đơn hàng", "Trạng thái xử lý", "_delivery_status", "_processing_status"], width: "14rem" },
  { title: "Thay thế cho đơn", keys: ["_replacement_display", "_replaced_order_number"], width: "16rem" },
  { title: "Người thực hiện", keys: ["_performed_by", "performedBy", "Người thực hiện"], width: "9.5rem" },
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
  const replacementDisplay = hasRemoteValue(order["_replacement_display"])
    ? order["_replacement_display"]
    : hasRemoteValue(order["_replaced_order_number"])
      ? `TT: ${String(order["_replaced_order_number"])}`
      : Array.isArray(order["_replaced_by_order_numbers"]) && order["_replaced_by_order_numbers"].length > 0
        ? `BTT: ${(order["_replaced_by_order_numbers"] as string[]).join(", ")}`
        : null;
  const performedBy = hasRemoteValue(order["_performed_by"])
    ? String(order["_performed_by"]).trim()
    : hasRemoteValue(order["performedBy"])
      ? String(order["performedBy"]).trim()
      : hasRemoteValue(order["Người thực hiện"])
        ? String(order["Người thực hiện"]).trim()
        : "Hệ thống";
  const supplier = hasRemoteValue(order["Nhà cung cấp"])
    ? String(order["Nhà cung cấp"]).trim()
    : hasRemoteValue(order["supplier"])
      ? String(order["supplier"]).trim()
      : hasRemoteValue(order["_supplier"])
        ? String(order["_supplier"]).trim()
        : null;
  const deliveryStatus = hasRemoteValue(order["_delivery_status"])
    ? String(order["_delivery_status"]).trim()
    : hasRemoteValue(order["delivery_status"])
      ? String(order["delivery_status"]).trim()
      : null;
  normalized["Nhà cung cấp"] = supplier;
  normalized["_supplier"] = supplier;
  normalized["_delivery_status"] = deliveryStatus;
  normalized["Thay thế cho đơn"] = replacementDisplay;
  normalized["Người thực hiện"] = performedBy;
  normalized["_performed_by"] = performedBy;
  normalized["_local_id"] = order["_local_id"] ?? null;
  normalized["_order_created_date"] = order["_order_created_date"] ?? null;
  normalized["_replaced_order_number"] = order["_replaced_order_number"] ?? null;
  normalized["_replaced_by_order_numbers"] = order["_replaced_by_order_numbers"] ?? null;
  normalized["_replacement_type"] = order["_replacement_type"] ?? null;
  normalized["_replacement_display"] = replacementDisplay;
  normalized["_processing_status"] = order["_processing_status"] ?? null;
  normalized["_is_synthetic"] = order["_is_synthetic"] ?? false;
  normalized["_warehouse_updated"] = order["_warehouse_updated"] ?? null;
  return normalized;
}

function addProcessingStatus(order: RemoteOrder): RemoteOrder {
  const deliveryStatus = displayRemoteValue(order["_delivery_status"]).trim();
  const procStatus = displayRemoteValue(order["_processing_status"]).trim();
  const whStatus = order["_warehouse_updated"] === true ? "Đã cập nhật kho" : "";
  const finalStatus = deliveryStatus || procStatus || whStatus;
  return {
    ...order,
    "Tình trạng xử lý đơn hàng": finalStatus,
    "Trạng thái xử lý": finalStatus,
  };
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
  if (title === "Mã KH") {
    const code = displayRemoteValue(value).trim();
    return code.toUpperCase().startsWith("NVBH") ? code : code.slice(-3);
  }
  return displayRemoteValue(value);
}

function numericValue(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value.replaceAll(",", "")) || 0;
  return 0;
}

export default function SalesOrdersPage() {
  const router = useRouter();
  const { username: sessionUsername } = useAuthSession();
  const [isAdminUser, setIsAdminUser] = useState(false);
  const effectiveIsAdmin = isAdminUser || sessionUsername.trim().toLowerCase() === "admin";
  const todayInputStr = toInputDate(new Date());

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
  const [editingReplacement, setEditingReplacement] = useState<ReplacementEditForm | null>(null);
  const [replacementOptions, setReplacementOptions] = useState<string[]>([]);
  const [isSavingReplacement, setIsSavingReplacement] = useState(false);
  const replacementSearchVersion = useRef(0);

  // State cho Tách đơn (Split Order)
  const [isSplitDrawerOpen, setIsSplitDrawerOpen] = useState(false);
  const [splitOrderSearch, setSplitOrderSearch] = useState("");
  const [selectedSplitOrderNumber, setSelectedSplitOrderNumber] = useState("");
  const [splitCount, setSplitCount] = useState(2);
  const [splitAllocs, setSplitAllocs] = useState<SplitAllocMap>({});
  const [splitCustomers, setSplitCustomers] = useState<SplitCustomerSelection[]>([]);
  const [splitCustomerSearches, setSplitCustomerSearches] = useState<string[]>([]);
  const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>([]);
  const [isSubmittingSplit, setIsSubmittingSplit] = useState(false);
  const [splitError, setSplitError] = useState("");

  // State cho Gộp đơn (Merge Orders)
  const [isMergeDrawerOpen, setIsMergeDrawerOpen] = useState(false);
  const [mergeOrderSearch, setMergeOrderSearch] = useState("");
  const [selectedMergeOrderNumbers, setSelectedMergeOrderNumbers] = useState<string[]>([]);
  const [representativeOrderNumber, setRepresentativeOrderNumber] = useState("");
  const [mergeOverrideCustomer, setMergeOverrideCustomer] = useState(false);
  const [mergeCustomerSearch, setMergeCustomerSearch] = useState("");
  const [mergeCustomCustomer, setMergeCustomCustomer] = useState<{
    customer_code: string;
    customer_name: string;
    customer_address: string;
  }>({ customer_code: "", customer_name: "", customer_address: "" });
  const [mergeOverrideStaff, setMergeOverrideStaff] = useState(false);
  const [mergeStaffSearch, setMergeStaffSearch] = useState("");
  const [mergeCustomStaff, setMergeCustomStaff] = useState<{
    staff_code: string;
    staff_name: string;
  }>({ staff_code: "", staff_name: "" });
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [isSubmittingMerge, setIsSubmittingMerge] = useState(false);
  const [mergeError, setMergeError] = useState("");

  // State cho Hoàn tác tách/gộp & Duyệt tách đơn (Kế toán)
  const [revertingOrderNumber, setRevertingOrderNumber] = useState<string | null>(null);
  const [isSplitApprovalDrawerOpen, setIsSplitApprovalDrawerOpen] = useState(false);
  const [splitApprovalRequests, setSplitApprovalRequests] = useState<SplitOrderApprovalRequest[]>([]);
  const [pendingSplitRequestCount, setPendingSplitRequestCount] = useState(0);
  const [splitApprovalFilter, setSplitApprovalFilter] = useState<"PENDING" | "ALL">("PENDING");
  const [processingSplitRequestId, setProcessingSplitRequestId] = useState<number | null>(null);
  const [splitApprovalError, setSplitApprovalError] = useState("");

  const [isDeliveryRequestDrawerOpen, setIsDeliveryRequestDrawerOpen] = useState(false);
  const [deliveryEmployees, setDeliveryEmployees] = useState<DeliveryEmployeeOption[]>([]);
  const [deliveryWarehouses, setDeliveryWarehouses] = useState<DeliveryWarehouseOption[]>([]);
  const [deliveryWarehouseId, setDeliveryWarehouseId] = useState("");
  const [isLoadingDeliveryEmployees, setIsLoadingDeliveryEmployees] = useState(false);
  const [deliveryEmployeeError, setDeliveryEmployeeError] = useState("");
  const [selectedDeliveryOrderNumbers, setSelectedDeliveryOrderNumbers] = useState<Set<string>>(new Set());
  const [deliveryEmployeeAssignments, setDeliveryEmployeeAssignments] = useState<Record<string, string>>({});
  const [deliveryOrderStatuses, setDeliveryOrderStatuses] = useState<Record<string, string>>({});
  const [deliveryRequestSearch, setDeliveryRequestSearch] = useState("");
  const [deliveryRequestError, setDeliveryRequestError] = useState("");
  const [isDownloadingDeliveryRequest, setIsDownloadingDeliveryRequest] = useState(false);
  const [isAnalyzingDeliveryRequest, setIsAnalyzingDeliveryRequest] = useState(false);
  const [isCreatingDeliveryRequest, setIsCreatingDeliveryRequest] = useState(false);
  const [deliveryRequestPreview, setDeliveryRequestPreview] = useState<DeliveryRequestPreview | null>(null);
  const [deliveryRequestPlan, setDeliveryRequestPlan] = useState<DeliveryPlanItem[] | null>(null);
  const [acknowledgeDeliveryWarnings, setAcknowledgeDeliveryWarnings] = useState(false);

  useEffect(() => {
    const created = window.sessionStorage.getItem("dms-order-created");
    if (created) window.sessionStorage.removeItem("dms-order-created");
  }, []);

  useEffect(() => {
    apiFetch(`${API_URL}/auth/me`)
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { is_admin?: boolean };
        if (typeof data.is_admin === "boolean") {
          setIsAdminUser(data.is_admin);
        }
      })
      .catch(() => {
        // Fallback sử dụng sessionUsername === 'admin'
      });
  }, []);

  const loadSplitApprovalRequests = useCallback(async (filterStatus: "PENDING" | "ALL" = splitApprovalFilter) => {
    try {
      const response = await apiFetch(
        `${API_URL}/sync/vinamilk-orders/split-requests?status=${encodeURIComponent(filterStatus)}&limit=100`
      );
      if (!response.ok) return;
      const payload = (await response.json()) as {
        requests?: SplitOrderApprovalRequest[];
        pending_count?: number;
      };
      if (Array.isArray(payload.requests)) {
        setSplitApprovalRequests(payload.requests);
      }
      if (typeof payload.pending_count === "number") {
        setPendingSplitRequestCount(payload.pending_count);
      }
    } catch {
      // Bỏ qua lỗi mạng tạm thời
    }
  }, [splitApprovalFilter]);

  const loadLocalOrders = useCallback(async () => {
    const allRows: RemoteOrder[] = [];
    let skip = 0;
    let lastSynced: string | null = null;
    while (true) {
      const response = await apiFetch(
        `${API_URL}/sync/vinamilk-orders?from_date=${encodeURIComponent(fromDate)}&to_date=${encodeURIComponent(toDate)}&source=sync&skip=${skip}&limit=${LOCAL_PAGE_SIZE}`
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
    setRemoteOrders(normalizedRows.map(addProcessingStatus));
    setLastSyncedAt(lastSynced);
    void loadSplitApprovalRequests();
  }, [fromDate, toDate, loadSplitApprovalRequests]);

  useEffect(() => {
    loadLocalOrders().catch((error) => setRemoteError(error instanceof Error ? error.message : "Không thể tải dữ liệu."));
  }, [loadLocalOrders]);

  const loadCustomerOptions = useCallback(async () => {
    try {
      const response = await apiFetch(
        `${API_URL}/sync/vinamilk-orders/customer-options?limit=1000`
      );
      if (!response.ok) return;
      const payload = (await response.json()) as { customers?: CustomerOption[] };
      if (Array.isArray(payload.customers)) {
        setCustomerOptions(payload.customers);
      }
    } catch {
      // Bỏ qua lỗi mạng, vẫn dùng danh sách khách hàng gom từ remoteOrders
    }
  }, []);

  const loadStaffOptions = useCallback(async () => {
    try {
      const response = await apiFetch(
        `${API_URL}/sync/vinamilk-orders/staff-options?limit=500`
      );
      if (!response.ok) return;
      const payload = (await response.json()) as { staffs?: StaffOption[] };
      if (Array.isArray(payload.staffs)) {
        setStaffOptions(payload.staffs);
      }
    } catch {
      // Bỏ qua lỗi mạng, vẫn dùng danh sách NVBH gom từ remoteOrders
    }
  }, []);

  useEffect(() => {
    if (isSplitDrawerOpen || isMergeDrawerOpen) {
      void loadCustomerOptions();
    }
    if (isMergeDrawerOpen) {
      void loadStaffOptions();
    }
  }, [isSplitDrawerOpen, isMergeDrawerOpen, loadCustomerOptions, loadStaffOptions]);

  // Danh sách khách hàng tổng hợp (từ API customer-options + từ các đơn hàng trên màn hình)
  const allCustomerOptions = useMemo<CustomerOption[]>(() => {
    const map = new Map<string, CustomerOption>();
    for (const item of customerOptions) {
      const code = (item.customer_code || "").trim();
      if (!code) continue;
      map.set(code, item);
    }
    for (const row of remoteOrders) {
      const code = displayRemoteValue(row["Mã KH"]).trim();
      if (!code || map.has(code)) continue;
      map.set(code, {
        customer_code: code,
        customer_name: displayRemoteValue(row["Tên KH"]).trim(),
        customer_address: displayRemoteValue(row["Địa chỉ"]).trim(),
      });
    }
    return Array.from(map.values());
  }, [customerOptions, remoteOrders]);

  // Danh sách NVBH tổng hợp (từ API staff-options + từ các đơn hàng trên màn hình)
  const allStaffOptions = useMemo<StaffOption[]>(() => {
    const map = new Map<string, StaffOption>();
    for (const item of staffOptions) {
      const code = (item.staff_code || "").trim();
      if (!code) continue;
      map.set(code.toUpperCase(), item);
    }
    for (const row of remoteOrders) {
      const code = displayRemoteValue(row["Mã NVBH"]).trim();
      const name = displayRemoteValue(row["Tên NVBH"]).trim();
      const key = (code || name).toUpperCase();
      if (!key || map.has(key)) continue;
      map.set(key, {
        staff_code: code || name,
        staff_name: name || code,
      });
    }
    return Array.from(map.values());
  }, [staffOptions, remoteOrders]);

  function isOrderToday(row: RemoteOrder): boolean {
    const iso = displayRemoteValue(row["_order_created_date"]).trim();
    if (iso) {
      return iso === todayInputStr;
    }
    const createdStr = formatVinamilkDate(row["Ngày tạo"], false);
    return createdStr === toVinamilkDate(todayInputStr);
  }

  // Gom nhóm các đơn đủ điều kiện để Tách hoặc Gộp (chưa là đơn tách/gộp, chưa bị thay thế, chưa đang chờ KT duyệt tách; tài khoản không phải Admin chỉ được tách/gộp đơn ngày hôm nay)
  const eligibleOrderGroups = useMemo<GroupedOrderSummary[]>(() => {
    const map = new Map<string, GroupedOrderSummary>();
    for (const row of remoteOrders) {
      const orderNum = displayRemoteValue(row["Số đơn hàng"]).trim();
      if (!orderNum) continue;
      if (row["_is_synthetic"] === true) continue;
      if (hasRemoteValue(row["_replaced_order_number"])) continue;
      if (Array.isArray(row["_replaced_by_order_numbers"]) && row["_replaced_by_order_numbers"].length > 0) continue;
      if (hasRemoteValue(row["_pending_split_request_id"])) continue;
      if (!effectiveIsAdmin && !isOrderToday(row)) continue;

      let group = map.get(orderNum);
      if (!group) {
        group = {
          orderNumber: orderNum,
          customerCode: displayRemoteValue(row["Mã KH"]).trim(),
          customerName: displayRemoteValue(row["Tên KH"]).trim(),
          customerAddress: displayRemoteValue(row["Địa chỉ"]).trim(),
          staffCode: displayRemoteValue(row["Mã NVBH"]).trim(),
          staffName: displayRemoteValue(row["Tên NVBH"]).trim(),
          createdAt: displayRemoteValue(row["Ngày tạo"]).trim(),
          deliveryDate: displayRemoteValue(row["Ngày giao"]).trim(),
          totalValue: 0,
          totalDiscount: 0,
          totalQty: 0,
          totalPromoQty: 0,
      lines: [],
    };
    map.set(orderNum, group);
  }
  group.lines.push(row);
  group.totalValue += numericValue(row["Giá trị"]);
  group.totalDiscount += numericValue(row["Số tiền CK"]);
  group.totalQty += numericValue(row["Số lượng"]);
  group.totalPromoQty += numericValue(row["Số lượng KM"]);
}
return Array.from(map.values());
  }, [remoteOrders, effectiveIsAdmin, todayInputStr]);

  const selectedSplitOrderGroup = useMemo(
    () => eligibleOrderGroups.find((g) => g.orderNumber === selectedSplitOrderNumber) ?? null,
    [eligibleOrderGroups, selectedSplitOrderNumber]
  );

  // Khởi tạo bảng phân bổ số lượng và khách hàng khi chọn đơn cần tách
  function initializeSplitAllocations(group: GroupedOrderSummary | null, count: number) {
    if (!group) {
      setSplitAllocs({});
      setSplitCustomers([]);
      setSplitCustomerSearches([]);
      return;
    }
    const next: SplitAllocMap = {};
    for (const line of group.lines) {
      const localId = Number(line["_local_id"]);
      const origQty = numericValue(line["Số lượng"]);
      const origPromo = numericValue(line["Số lượng KM"]);
      const arr = Array.from({ length: count }, (_, idx) => ({
        quantity: idx === 0 ? origQty : 0,
        promoQuantity: idx === 0 ? origPromo : 0,
      }));
      next[localId] = arr;
    }
    setSplitAllocs(next);
    setSplitCustomers(
      Array.from({ length: count }, () => ({
        customer_code: group.customerCode,
        customer_name: group.customerName,
        customer_address: group.customerAddress,
      }))
    );
    setSplitCustomerSearches(Array.from({ length: count }, () => ""));
  }

  function handleSelectSplitOrder(orderNumber: string) {
    setSelectedSplitOrderNumber(orderNumber);
    setSplitError("");
    const group = eligibleOrderGroups.find((g) => g.orderNumber === orderNumber) ?? null;
    initializeSplitAllocations(group, splitCount);
  }

  function handleChangeSplitCount(newCount: number) {
    const clamped = Math.max(1, Math.min(10, newCount));
    setSplitCount(clamped);
    setSplitError("");
    if (!selectedSplitOrderGroup) return;
    setSplitAllocs((prev) => {
      const next: SplitAllocMap = {};
      for (const line of selectedSplitOrderGroup.lines) {
        const localId = Number(line["_local_id"]);
        const origQty = numericValue(line["Số lượng"]);
        const origPromo = numericValue(line["Số lượng KM"]);
        const currentArr = prev[localId] ?? [];
        if (clamped === 1) {
          next[localId] = [
            {
              quantity: origQty,
              promoQuantity: origPromo,
              customValue: currentArr[0]?.customValue ?? null,
              customDiscount: currentArr[0]?.customDiscount ?? null,
            },
          ];
        } else {
          next[localId] = Array.from({ length: clamped }, (_, idx) => ({
            quantity: currentArr[idx]?.quantity ?? 0,
            promoQuantity: currentArr[idx]?.promoQuantity ?? 0,
            customValue: currentArr[idx]?.customValue ?? null,
            customDiscount: currentArr[idx]?.customDiscount ?? null,
          }));
        }
      }
      return next;
    });
    setSplitCustomers((prev) =>
      Array.from({ length: clamped }, (_, idx) =>
        prev[idx] ?? {
          customer_code: selectedSplitOrderGroup.customerCode,
          customer_name: selectedSplitOrderGroup.customerName,
          customer_address: selectedSplitOrderGroup.customerAddress,
        }
      )
    );
    setSplitCustomerSearches((prev) =>
      Array.from({ length: clamped }, (_, idx) => prev[idx] ?? "")
    );
  }

  function handleSelectSplitCustomer(splitIdx: number, customerCode: string) {
    const found = allCustomerOptions.find((c) => c.customer_code === customerCode);
    setSplitCustomers((prev) => {
      const next = [...prev];
      if (found) {
        next[splitIdx] = {
          customer_code: found.customer_code,
          customer_name: found.customer_name,
          customer_address: found.customer_address,
          is_staff_debt: false,
        };
      } else if (selectedSplitOrderGroup && customerCode === selectedSplitOrderGroup.customerCode) {
        next[splitIdx] = {
          customer_code: selectedSplitOrderGroup.customerCode,
          customer_name: selectedSplitOrderGroup.customerName,
          customer_address: selectedSplitOrderGroup.customerAddress,
          is_staff_debt: false,
        };
      } else {
        next[splitIdx] = {
          ...(next[splitIdx] ?? { customer_code: "", customer_name: "", customer_address: "" }),
          customer_code: customerCode,
          is_staff_debt: false,
        };
      }
      return next;
    });
  }

  function handleSetSplitToStaffDebt(splitIdx: number) {
    if (!selectedSplitOrderGroup) return;
    const staffCode = selectedSplitOrderGroup.staffCode || "";
    const staffName = selectedSplitOrderGroup.staffName || "";
    const staffLabel = staffName && staffCode ? `${staffName} (${staffCode})` : staffName || staffCode || "Nhân viên";
    setSplitCustomers((prev) => {
      const next = [...prev];
      next[splitIdx] = {
        customer_code: staffCode ? `NVBH-${staffCode}` : "NVBH",
        customer_name: `NVBH: ${staffLabel} — Công nợ tách thiếu`,
        customer_address: "Đơn tách phần thiếu gắn công nợ NVBH",
        is_staff_debt: true,
      };
      return next;
    });
  }

  function assignRemainderToStaffSplit() {
    if (!selectedSplitOrderGroup) return;
    setSplitError("");
    const staffCode = selectedSplitOrderGroup.staffCode || "";
    const staffName = selectedSplitOrderGroup.staffName || "";
    const staffLabel = staffName && staffCode ? `${staffName} (${staffCode})` : staffName || staffCode || "Nhân viên";
    const staffCust: SplitCustomerSelection = {
      customer_code: staffCode ? `NVBH-${staffCode}` : "NVBH",
      customer_name: `NVBH: ${staffLabel} — Công nợ tách thiếu`,
      customer_address: "Đơn tách phần thiếu gắn công nợ NVBH",
      is_staff_debt: true,
    };

    // Tìm xem có đơn tách nào đã đánh dấu Nợ NVBH hoặc đang trống hoàn toàn không
    const existingStaffIdx = splitCustomers.findIndex((c) => c?.is_staff_debt === true);
    let targetIdx = existingStaffIdx;
    if (targetIdx === -1) {
      // Kiểm tra đơn tách cuối cùng có đang trống (SL = 0, KM = 0 trên mọi dòng) không
      const lastIdx = splitCount - 1;
      const isLastEmpty = selectedSplitOrderGroup.lines.every((line) => {
        const localId = Number(line["_local_id"]);
        const cell = splitAllocs[localId]?.[lastIdx];
        return !cell || (cell.quantity === 0 && cell.promoQuantity === 0);
      });
      if (isLastEmpty) {
        targetIdx = lastIdx;
      }
    }

    if (targetIdx !== -1) {
      // Gán phần còn lại vào đơn tách targetIdx và chuyển sang Nợ NVBH
      setSplitCustomers((prev) => {
        const next = [...prev];
        next[targetIdx] = staffCust;
        return next;
      });
      setSplitAllocs((prev) => {
        const next: SplitAllocMap = {};
        for (const line of selectedSplitOrderGroup.lines) {
          const localId = Number(line["_local_id"]);
          const origQty = numericValue(line["Số lượng"]);
          const origPromo = numericValue(line["Số lượng KM"]);
          const origVal = Math.round(numericValue(line["Giá trị"]));
          const origDisc = Math.round(numericValue(line["Số tiền CK"]));
          const currentArr = prev[localId]
            ? prev[localId].map((item) => ({ ...item }))
            : Array.from({ length: splitCount }, () => ({
                quantity: 0,
                promoQuantity: 0,
                customValue: null,
                customDiscount: null,
              }));
          const sumOtherQty = currentArr.reduce((s, a, idx) => (idx === targetIdx ? s : s + a.quantity), 0);
          const sumOtherPromo = currentArr.reduce((s, a, idx) => (idx === targetIdx ? s : s + a.promoQuantity), 0);
          const hasAnyCustomVal = currentArr.some(
            (item) => item.customValue !== null && item.customValue !== undefined
          );
          let targetCustomVal: number | null = null;
          if (hasAnyCustomVal) {
            const sumOtherVal = currentArr.reduce(
              (s, a, idx) => (idx === targetIdx ? s : s + Math.round(a.customValue ?? 0)),
              0
            );
            targetCustomVal = Math.max(0, origVal - sumOtherVal);
          }
          const hasAnyCustomDisc = currentArr.some(
            (item) => item.customDiscount !== null && item.customDiscount !== undefined
          );
          let targetCustomDisc: number | null = null;
          if (hasAnyCustomDisc) {
            const sumOtherDisc = currentArr.reduce(
              (s, a, idx) => (idx === targetIdx ? s : s + Math.round(a.customDiscount ?? 0)),
              0
            );
            targetCustomDisc = Math.max(0, origDisc - sumOtherDisc);
          }
          currentArr[targetIdx] = {
            quantity: Math.max(0, Number((origQty - sumOtherQty).toFixed(4))),
            promoQuantity: Math.max(0, Number((origPromo - sumOtherPromo).toFixed(4))),
            customValue: targetCustomVal,
            customDiscount: targetCustomDisc,
          };
          next[localId] = currentArr;
        }
        return next;
      });
    } else if (splitCount < 10) {
      // Thêm 1 đơn tách mới ở cuối dành riêng cho Nợ NVBH và điền toàn bộ phần thiếu vào đó
      const newCount = splitCount + 1;
      const newIdx = newCount - 1;
      setSplitCount(newCount);
      setSplitCustomers((prev) => [...prev.slice(0, splitCount), staffCust]);
      setSplitCustomerSearches((prev) => [...prev.slice(0, splitCount), ""]);
      setSplitAllocs((prev) => {
        const next: SplitAllocMap = {};
        for (const line of selectedSplitOrderGroup.lines) {
          const localId = Number(line["_local_id"]);
          const origQty = numericValue(line["Số lượng"]);
          const origPromo = numericValue(line["Số lượng KM"]);
          const origVal = Math.round(numericValue(line["Giá trị"]));
          const origDisc = Math.round(numericValue(line["Số tiền CK"]));
          const currentArr = prev[localId]
            ? prev[localId].slice(0, splitCount).map((item) => ({ ...item }))
            : Array.from({ length: splitCount }, () => ({
                quantity: 0,
                promoQuantity: 0,
                customValue: null,
                customDiscount: null,
              }));
          const sumOtherQty = currentArr.reduce((s, a) => s + a.quantity, 0);
          const sumOtherPromo = currentArr.reduce((s, a) => s + a.promoQuantity, 0);
          const hasAnyCustomVal = currentArr.some(
            (item) => item.customValue !== null && item.customValue !== undefined
          );
          let targetCustomVal: number | null = null;
          if (hasAnyCustomVal) {
            const sumOtherVal = currentArr.reduce((s, a) => s + Math.round(a.customValue ?? 0), 0);
            targetCustomVal = Math.max(0, origVal - sumOtherVal);
          }
          const hasAnyCustomDisc = currentArr.some(
            (item) => item.customDiscount !== null && item.customDiscount !== undefined
          );
          let targetCustomDisc: number | null = null;
          if (hasAnyCustomDisc) {
            const sumOtherDisc = currentArr.reduce((s, a) => s + Math.round(a.customDiscount ?? 0), 0);
            targetCustomDisc = Math.max(0, origDisc - sumOtherDisc);
          }
          currentArr[newIdx] = {
            quantity: Math.max(0, Number((origQty - sumOtherQty).toFixed(4))),
            promoQuantity: Math.max(0, Number((origPromo - sumOtherPromo).toFixed(4))),
            customValue: targetCustomVal,
            customDiscount: targetCustomDisc,
          };
          next[localId] = currentArr;
        }
        return next;
      });
    }
  }

  function updateSplitCell(localId: number, splitIndex: number, field: "quantity" | "promoQuantity", value: number) {
    const cleanValue = Math.max(0, Number.isFinite(value) ? value : 0);
    setSplitAllocs((prev) => {
      const currentArr = prev[localId]
        ? prev[localId].map((c) => ({ ...c, customValue: null, customDiscount: null }))
        : [];
      if (!currentArr[splitIndex]) return prev;
      currentArr[splitIndex] = {
        ...currentArr[splitIndex],
        [field]: cleanValue,
        customValue: null,
        customDiscount: null,
      };
      return {
        ...prev,
        [localId]: currentArr,
      };
    });
  }

  function fillRemainderToLastSplit() {
    if (!selectedSplitOrderGroup || splitCount < 2) return;
    setSplitAllocs((prev) => {
      const next: SplitAllocMap = {};
      for (const line of selectedSplitOrderGroup.lines) {
        const localId = Number(line["_local_id"]);
        const origQty = numericValue(line["Số lượng"]);
        const origPromo = numericValue(line["Số lượng KM"]);
        const origVal = Math.round(numericValue(line["Giá trị"]));
        const origDisc = Math.round(numericValue(line["Số tiền CK"]));
        const currentArr = prev[localId]
          ? prev[localId].map((item) => ({ ...item }))
          : Array.from({ length: splitCount }, () => ({
              quantity: 0,
              promoQuantity: 0,
              customValue: null,
              customDiscount: null,
            }));
        const sumOtherQty = currentArr.slice(0, splitCount - 1).reduce((s, a) => s + a.quantity, 0);
        const sumOtherPromo = currentArr.slice(0, splitCount - 1).reduce((s, a) => s + a.promoQuantity, 0);
        const hasAnyCustomVal = currentArr.some(
          (item) => item.customValue !== null && item.customValue !== undefined
        );
        let lastCustomVal: number | null = null;
        if (hasAnyCustomVal) {
          const sumOtherVal = currentArr
            .slice(0, splitCount - 1)
            .reduce((s, a) => s + Math.round(a.customValue ?? 0), 0);
          lastCustomVal = Math.max(0, origVal - sumOtherVal);
        }
        const hasAnyCustomDisc = currentArr.some(
          (item) => item.customDiscount !== null && item.customDiscount !== undefined
        );
        let lastCustomDisc: number | null = null;
        if (hasAnyCustomDisc) {
          const sumOtherDisc = currentArr
            .slice(0, splitCount - 1)
            .reduce((s, a) => s + Math.round(a.customDiscount ?? 0), 0);
          lastCustomDisc = Math.max(0, origDisc - sumOtherDisc);
        }
        currentArr[splitCount - 1] = {
          quantity: Math.max(0, Number((origQty - sumOtherQty).toFixed(4))),
          promoQuantity: Math.max(0, Number((origPromo - sumOtherPromo).toFixed(4))),
          customValue: lastCustomVal,
          customDiscount: lastCustomDisc,
        };
        next[localId] = currentArr;
      }
      return next;
    });
  }

  function distributeEvenlyAcrossSplits() {
    if (!selectedSplitOrderGroup || splitCount < 1) return;
    const next: SplitAllocMap = {};
    for (const line of selectedSplitOrderGroup.lines) {
      const localId = Number(line["_local_id"]);
      const origQty = numericValue(line["Số lượng"]);
      const origPromo = numericValue(line["Số lượng KM"]);
      const baseQty = Math.floor(origQty / splitCount);
      const basePromo = Math.floor(origPromo / splitCount);
      next[localId] = Array.from({ length: splitCount }, (_, idx) => ({
        quantity: idx === splitCount - 1 ? Number((origQty - baseQty * (splitCount - 1)).toFixed(4)) : baseQty,
        promoQuantity: idx === splitCount - 1 ? Number((origPromo - basePromo * (splitCount - 1)).toFixed(4)) : basePromo,
        customValue: null,
        customDiscount: null,
      }));
    }
    setSplitAllocs(next);
  }

  function resetSplitDiscountsToAuto() {
    setSplitAllocs((prev) => {
      const next: SplitAllocMap = {};
      for (const [k, arr] of Object.entries(prev)) {
        next[Number(k)] = arr.map((c) => ({ ...c, customValue: null, customDiscount: null }));
      }
      return next;
    });
  }

  // Tính toán Giá trị và Số tiền CK theo từng dòng & tổng hợp theo từng đơn tách (khớp 100% công thức backend)
  const splitFinancials = useMemo(() => {
    const lineBreakdown: Record<
      number,
      { value: number; autoValue: number; discount: number; autoDiscount: number }[]
    > = {};
    const splitTotals = Array.from({ length: splitCount }, () => ({
      lineCount: 0,
      totalQty: 0,
      totalPromoQty: 0,
      totalValue: 0,
      totalDiscount: 0,
    }));

    if (!selectedSplitOrderGroup) {
      return { lineBreakdown, splitTotals };
    }

    for (const line of selectedSplitOrderGroup.lines) {
      const localId = Number(line["_local_id"]);
      const origQty = numericValue(line["Số lượng"]);
      const origPromo = numericValue(line["Số lượng KM"]);
      const origVal = numericValue(line["Giá trị"]);
      const origDisc = numericValue(line["Số tiền CK"]);
      const allocs = splitAllocs[localId] ?? [];

      const sumQty = allocs.reduce((s, a) => s + a.quantity, 0);
      const sumPromo = allocs.reduce((s, a) => s + a.promoQuantity, 0);
      const isLineMatched =
        Math.abs(sumQty - origQty) <= 1e-4 && Math.abs(sumPromo - origPromo) <= 1e-4;

      const activeIndices: number[] = [];
      for (let idx = 0; idx < splitCount; idx += 1) {
        const cell = allocs[idx];
        if (cell && (cell.quantity > 0 || cell.promoQuantity > 0)) {
          activeIndices.push(idx);
        }
      }

      const rowResult = Array.from({ length: splitCount }, () => ({
        value: 0,
        autoValue: 0,
        discount: 0,
        autoDiscount: 0,
      }));
      let usedVal = 0;
      let usedDisc = 0;

      for (const idx of activeIndices) {
        const cell = allocs[idx] ?? { quantity: 0, promoQuantity: 0 };
        let autoVal = 0;
        let autoDisc = 0;

        if (isLineMatched && idx === activeIndices[activeIndices.length - 1]) {
          autoVal = Math.round(origVal - usedVal);
          autoDisc = Math.round(origDisc - usedDisc);
        } else {
          const ratio =
            origQty > 0
              ? cell.quantity / origQty
              : origPromo > 0
                ? cell.promoQuantity / origPromo
                : 0;
          autoVal = Math.round(origVal * ratio);
          autoDisc = Math.round(origDisc * ratio);
          usedVal += autoVal;
          usedDisc += autoDisc;
        }

        const finalVal =
          cell.customValue !== null && cell.customValue !== undefined
            ? Math.round(cell.customValue)
            : autoVal;
        const finalDisc =
          cell.customDiscount !== null && cell.customDiscount !== undefined
            ? Math.round(cell.customDiscount)
            : autoDisc;

        rowResult[idx] = {
          value: finalVal,
          autoValue: autoVal,
          discount: finalDisc,
          autoDiscount: autoDisc,
        };
        splitTotals[idx].lineCount += 1;
        splitTotals[idx].totalQty = Number((splitTotals[idx].totalQty + cell.quantity).toFixed(4));
        splitTotals[idx].totalPromoQty = Number(
          (splitTotals[idx].totalPromoQty + cell.promoQuantity).toFixed(4)
        );
        splitTotals[idx].totalValue += finalVal;
        splitTotals[idx].totalDiscount += finalDisc;
      }

      lineBreakdown[localId] = rowResult;
    }

    return { lineBreakdown, splitTotals };
  }, [selectedSplitOrderGroup, splitAllocs, splitCount]);

  // Chỉnh sửa Giá trị trực tiếp trên 1 dòng sản phẩm của 1 đơn tách
  function updateSplitCellValue(localId: number, splitIndex: number, value: number) {
    if (!selectedSplitOrderGroup) return;
    const line = selectedSplitOrderGroup.lines.find((l) => Number(l["_local_id"]) === localId);
    const origVal = line ? Math.round(numericValue(line["Giá trị"])) : 0;
    const cleanVal = Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
    const currentFin = splitFinancials.lineBreakdown[localId] ?? [];

    setSplitAllocs((prev) => {
      const currentArr = (prev[localId] ?? []).map((cell, idx) => ({
        ...cell,
        customValue:
          cell.customValue !== null && cell.customValue !== undefined
            ? Math.round(cell.customValue)
            : (currentFin[idx]?.value ?? 0),
      }));
      if (!currentArr[splitIndex]) return prev;
      currentArr[splitIndex].customValue = cleanVal;

      const activeIndices = currentArr
        .map((c, idx) => (c.quantity > 0 || c.promoQuantity > 0 ? idx : -1))
        .filter((idx) => idx !== -1);

      const origQty = line ? numericValue(line["Số lượng"]) : 0;
      const origPromo = line ? numericValue(line["Số lượng KM"]) : 0;
      const sumQty = currentArr.reduce((s, a) => s + a.quantity, 0);
      const sumPromo = currentArr.reduce((s, a) => s + a.promoQuantity, 0);
      const isLineMatched =
        Math.abs(sumQty - origQty) <= 1e-4 && Math.abs(sumPromo - origPromo) <= 1e-4;

      if (isLineMatched && activeIndices.length >= 2 && origVal > 0) {
        const balanceTargetIdx =
          splitIndex !== activeIndices[activeIndices.length - 1]
            ? activeIndices[activeIndices.length - 1]
            : activeIndices.length === 2
              ? activeIndices[0]
              : -1;
        if (balanceTargetIdx !== -1 && balanceTargetIdx !== splitIndex) {
          const sumOther = activeIndices
            .filter((idx) => idx !== balanceTargetIdx)
            .reduce((s, idx) => s + (currentArr[idx]?.customValue ?? 0), 0);
          currentArr[balanceTargetIdx].customValue = Math.max(0, origVal - sumOther);
        }
      }

      return {
        ...prev,
        [localId]: currentArr,
      };
    });
  }

  // Chỉnh sửa Tổng giá trị của cả 1 đơn tách (tự động phân bổ xuống các dòng sản phẩm của đơn tách đó)
  function updateSplitOrderTotalValue(splitIndex: number, targetTotalVal: number) {
    if (!selectedSplitOrderGroup) return;
    const cleanTotalVal = Math.max(0, Math.round(Number.isFinite(targetTotalVal) ? targetTotalVal : 0));

    setSplitAllocs((prev) => {
      const next: SplitAllocMap = {};
      for (const line of selectedSplitOrderGroup.lines) {
        const localId = Number(line["_local_id"]);
        const finRow = splitFinancials.lineBreakdown[localId] ?? [];
        const arr = (prev[localId] ?? []).map((cell, idx) => ({
          ...cell,
          customValue:
            cell.customValue !== null && cell.customValue !== undefined
              ? Math.round(cell.customValue)
              : (finRow[idx]?.value ?? 0),
        }));
        next[localId] = arr;
      }

      const activeLines = selectedSplitOrderGroup.lines.filter((line) => {
        const localId = Number(line["_local_id"]);
        const cell = next[localId]?.[splitIndex];
        return cell && (cell.quantity > 0 || cell.promoQuantity > 0);
      });

      if (activeLines.length === 0) return prev;

      const weights = activeLines.map((line) => {
        const localId = Number(line["_local_id"]);
        const autoVal = splitFinancials.lineBreakdown[localId]?.[splitIndex]?.autoValue ?? 0;
        const origVal = numericValue(line["Giá trị"]);
        return autoVal > 0 ? autoVal : origVal > 0 ? origVal : 1;
      });
      const totalWeight = weights.reduce((s, w) => s + w, 0) || 1;

      let allocated = 0;
      activeLines.forEach((line, idx) => {
        const localId = Number(line["_local_id"]);
        const origVal = Math.round(numericValue(line["Giá trị"]));
        const origQty = numericValue(line["Số lượng"]);
        const origPromo = numericValue(line["Số lượng KM"]);
        const lineVal =
          idx === activeLines.length - 1
            ? Math.max(0, cleanTotalVal - allocated)
            : Math.round((cleanTotalVal * weights[idx]) / totalWeight);
        allocated += lineVal;
        if (next[localId]?.[splitIndex]) {
          next[localId][splitIndex].customValue = lineVal;
        }

        const rowArr = next[localId] ?? [];
        const sumQty = rowArr.reduce((s, a) => s + a.quantity, 0);
        const sumPromo = rowArr.reduce((s, a) => s + a.promoQuantity, 0);
        const isLineMatched =
          Math.abs(sumQty - origQty) <= 1e-4 && Math.abs(sumPromo - origPromo) <= 1e-4;
        const rowActiveIndices = rowArr
          .map((c, i) => (c.quantity > 0 || c.promoQuantity > 0 ? i : -1))
          .filter((i) => i !== -1);
        if (isLineMatched && rowActiveIndices.length >= 2 && origVal > 0) {
          const balanceIdx =
            splitIndex !== rowActiveIndices[rowActiveIndices.length - 1]
              ? rowActiveIndices[rowActiveIndices.length - 1]
              : rowActiveIndices.length === 2
                ? rowActiveIndices[0]
                : -1;
          if (balanceIdx !== -1 && balanceIdx !== splitIndex) {
            const sumOther = rowActiveIndices
              .filter((i) => i !== balanceIdx)
              .reduce((s, i) => s + (rowArr[i]?.customValue ?? 0), 0);
            rowArr[balanceIdx].customValue = Math.max(0, origVal - sumOther);
          }
        }
      });

      return next;
    });
  }

  // Chỉnh sửa Số tiền CK trực tiếp trên 1 dòng sản phẩm của 1 đơn tách
  function updateSplitCellDiscount(localId: number, splitIndex: number, value: number) {
    if (!selectedSplitOrderGroup) return;
    const line = selectedSplitOrderGroup.lines.find((l) => Number(l["_local_id"]) === localId);
    const origDisc = line ? Math.round(numericValue(line["Số tiền CK"])) : 0;
    const cleanDisc = Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
    const currentFin = splitFinancials.lineBreakdown[localId] ?? [];

    setSplitAllocs((prev) => {
      const currentArr = (prev[localId] ?? []).map((cell, idx) => ({
        ...cell,
        customDiscount:
          cell.customDiscount !== null && cell.customDiscount !== undefined
            ? Math.round(cell.customDiscount)
            : (currentFin[idx]?.discount ?? 0),
      }));
      if (!currentArr[splitIndex]) return prev;
      currentArr[splitIndex].customDiscount = cleanDisc;

      // Tự động cân bằng phần CK còn lại trên dòng này vào đơn tách đang hoạt động cuối cùng (hoặc đơn còn lại nếu có 2 đơn)
      const activeIndices = currentArr
        .map((c, idx) => (c.quantity > 0 || c.promoQuantity > 0 ? idx : -1))
        .filter((idx) => idx !== -1);

      if (activeIndices.length >= 2 && origDisc > 0) {
        const balanceTargetIdx =
          splitIndex !== activeIndices[activeIndices.length - 1]
            ? activeIndices[activeIndices.length - 1]
            : activeIndices.length === 2
              ? activeIndices[0]
              : -1;
        if (balanceTargetIdx !== -1 && balanceTargetIdx !== splitIndex) {
          const sumOther = activeIndices
            .filter((idx) => idx !== balanceTargetIdx)
            .reduce((s, idx) => s + (currentArr[idx]?.customDiscount ?? 0), 0);
          currentArr[balanceTargetIdx].customDiscount = Math.max(0, origDisc - sumOther);
        }
      }

      return {
        ...prev,
        [localId]: currentArr,
      };
    });
  }

  // Chỉnh sửa Tổng Số tiền CK của cả 1 đơn tách (tự động phân bổ xuống các dòng sản phẩm của đơn tách đó)
  function updateSplitOrderTotalDiscount(splitIndex: number, targetTotalDisc: number) {
    if (!selectedSplitOrderGroup) return;
    const cleanTotalDisc = Math.max(0, Math.round(Number.isFinite(targetTotalDisc) ? targetTotalDisc : 0));

    setSplitAllocs((prev) => {
      const next: SplitAllocMap = {};
      // Khởi tạo bản sao có customDiscount hiện hành cho tất cả các dòng
      for (const line of selectedSplitOrderGroup.lines) {
        const localId = Number(line["_local_id"]);
        const finRow = splitFinancials.lineBreakdown[localId] ?? [];
        const arr = (prev[localId] ?? []).map((cell, idx) => ({
          ...cell,
          customDiscount:
            cell.customDiscount !== null && cell.customDiscount !== undefined
              ? Math.round(cell.customDiscount)
              : (finRow[idx]?.discount ?? 0),
        }));
        next[localId] = arr;
      }

      // Tìm các dòng đang có số lượng > 0 trong đơn tách splitIndex
      const activeLines = selectedSplitOrderGroup.lines.filter((line) => {
        const localId = Number(line["_local_id"]);
        const cell = next[localId]?.[splitIndex];
        return cell && (cell.quantity > 0 || cell.promoQuantity > 0);
      });

      if (activeLines.length === 0) return prev;

      // Trọng số phân bổ theo Giá trị của dòng trong đơn tách (hoặc CK gốc của dòng)
      const weights = activeLines.map((line) => {
        const localId = Number(line["_local_id"]);
        const val = splitFinancials.lineBreakdown[localId]?.[splitIndex]?.value ?? 0;
        const origDisc = numericValue(line["Số tiền CK"]);
        return val > 0 ? val : origDisc > 0 ? origDisc : 1;
      });
      const totalWeight = weights.reduce((s, w) => s + w, 0) || 1;

      let allocated = 0;
      activeLines.forEach((line, idx) => {
        const localId = Number(line["_local_id"]);
        const origDisc = Math.round(numericValue(line["Số tiền CK"]));
        const lineDisc =
          idx === activeLines.length - 1
            ? Math.max(0, cleanTotalDisc - allocated)
            : Math.round((cleanTotalDisc * weights[idx]) / totalWeight);
        allocated += lineDisc;
        if (next[localId]?.[splitIndex]) {
          next[localId][splitIndex].customDiscount = lineDisc;
        }

        // Nếu dòng này có nhiều đơn tách hoạt động, tự động cân bằng phần CK còn lại của dòng sang đơn hoạt động cuối
        const rowArr = next[localId] ?? [];
        const rowActiveIndices = rowArr
          .map((c, i) => (c.quantity > 0 || c.promoQuantity > 0 ? i : -1))
          .filter((i) => i !== -1);
        if (rowActiveIndices.length >= 2 && origDisc > 0) {
          const balanceIdx =
            splitIndex !== rowActiveIndices[rowActiveIndices.length - 1]
              ? rowActiveIndices[rowActiveIndices.length - 1]
              : rowActiveIndices.length === 2
                ? rowActiveIndices[0]
                : -1;
          if (balanceIdx !== -1 && balanceIdx !== splitIndex) {
            const sumOther = rowActiveIndices
              .filter((i) => i !== balanceIdx)
              .reduce((s, i) => s + (rowArr[i]?.customDiscount ?? 0), 0);
            rowArr[balanceIdx].customDiscount = Math.max(0, origDisc - sumOther);
          }
        }
      });

      return next;
    });
  }

  async function submitSplitOrder() {
    if (!selectedSplitOrderGroup) {
      setSplitError("Vui lòng chọn đơn hàng cần tách.");
      return;
    }
    setSplitError("");
    let hasShortage = false;
    let totalShortageQty = 0;
    let totalShortagePromo = 0;

    // Kiểm tra tổng số lượng từng dòng (không được vượt quá đơn gốc; nếu thiếu sẽ tách phần thiếu cho NVBH)
    for (const line of selectedSplitOrderGroup.lines) {
      const localId = Number(line["_local_id"]);
      const prodCode = displayRemoteValue(line["Mã sản phẩm"]);
      const origQty = numericValue(line["Số lượng"]);
      const origPromo = numericValue(line["Số lượng KM"]);
      const allocs = splitAllocs[localId] ?? [];
      const sumQty = allocs.reduce((s, a) => s + a.quantity, 0);
      const sumPromo = allocs.reduce((s, a) => s + a.promoQuantity, 0);
      if (sumQty - origQty > 1e-4) {
        setSplitError(`Sản phẩm ${prodCode}: Tổng SL tách (${sumQty}) vượt quá SL gốc (${origQty}).`);
        return;
      }
      if (sumPromo - origPromo > 1e-4) {
        setSplitError(`Sản phẩm ${prodCode}: Tổng SL KM tách (${sumPromo}) vượt quá SL KM gốc (${origPromo}).`);
        return;
      }
      const remQty = Number((origQty - sumQty).toFixed(4));
      const remPromo = Number((origPromo - sumPromo).toFixed(4));
      if (remQty > 1e-4 || remPromo > 1e-4) {
        hasShortage = true;
        totalShortageQty = Number((totalShortageQty + remQty).toFixed(4));
        totalShortagePromo = Number((totalShortagePromo + remPromo).toFixed(4));
      }
    }

    const totalSplitDisc = splitFinancials.splitTotals.reduce((s, t) => s + t.totalDiscount, 0);
    const totalOrigDisc = Math.round(selectedSplitOrderGroup.totalDiscount);
    if (!hasShortage && Math.abs(totalSplitDisc - totalOrigDisc) > Math.max(1, selectedSplitOrderGroup.lines.length)) {
      setSplitError(
        `Tổng Số tiền CK của các đơn tách (${formatVND(totalSplitDisc)}) phải khớp với Tổng Số tiền CK đơn gốc (${formatVND(totalOrigDisc)}).`
      );
      return;
    }
    if (hasShortage && totalSplitDisc - totalOrigDisc > Math.max(1, selectedSplitOrderGroup.lines.length)) {
      setSplitError(
        `Tổng Số tiền CK của các đơn tách (${formatVND(totalSplitDisc)}) vượt quá Tổng Số tiền CK đơn gốc (${formatVND(totalOrigDisc)}).`
      );
      return;
    }

    const rawSplitsPayload = Array.from({ length: splitCount }, (_, splitIdx) => {
      const items = selectedSplitOrderGroup.lines
        .map((line) => {
          const localId = Number(line["_local_id"]);
          const cell = splitAllocs[localId]?.[splitIdx];
          const cellVal = splitFinancials.lineBreakdown[localId]?.[splitIdx]?.value ?? 0;
          const cellDisc = splitFinancials.lineBreakdown[localId]?.[splitIdx]?.discount ?? 0;
          return {
            snapshot_id: localId,
            quantity: cell?.quantity ?? 0,
            promo_quantity: cell?.promoQuantity ?? 0,
            value_amount: cellVal,
            discount_amount: cellDisc,
          };
        })
        .filter((item) => item.quantity > 0 || item.promo_quantity > 0);
      const chosenCust = splitCustomers[splitIdx] ?? {
        customer_code: selectedSplitOrderGroup.customerCode,
        customer_name: selectedSplitOrderGroup.customerName,
        customer_address: selectedSplitOrderGroup.customerAddress,
        is_staff_debt: false,
      };
      return {
        customer_code: chosenCust.customer_code,
        customer_name: chosenCust.customer_name,
        customer_address: chosenCust.customer_address,
        is_staff_debt: Boolean(chosenCust.is_staff_debt),
        staff_code: selectedSplitOrderGroup.staffCode || undefined,
        staff_name: selectedSplitOrderGroup.staffName || undefined,
        items,
      };
    });

    const splitsPayload = hasShortage
      ? rawSplitsPayload.filter((s) => s.items.length > 0)
      : rawSplitsPayload;

    if (splitsPayload.length === 0) {
      setSplitError("Vui lòng nhập số lượng phân bổ lớn hơn 0 cho ít nhất 1 đơn tách.");
      return;
    }

    if (!hasShortage) {
      const emptySplitIndex = rawSplitsPayload.findIndex((s) => s.items.length === 0);
      if (emptySplitIndex !== -1) {
        setSplitError(`Đơn tách thứ ${emptySplitIndex + 1} chưa có sản phẩm nào có số lượng > 0.`);
        return;
      }
      if (splitsPayload.length === 1) {
        const onlySplit = splitsPayload[0];
        const targetCode = (onlySplit.customer_code ?? "").trim();
        const origCode = (selectedSplitOrderGroup.customerCode ?? "").trim();
        if (!onlySplit.is_staff_debt && (!targetCode || targetCode.toUpperCase() === origCode.toUpperCase())) {
          setSplitError(
            "Khi tách thành 1 đơn (đổi khách hàng), vui lòng chọn Mã khách hàng mới khác với khách hàng của đơn gốc (hoặc gắn Công nợ NVBH)."
          );
          return;
        }
      }
    } else {
      const staffLabel =
        selectedSplitOrderGroup.staffName || selectedSplitOrderGroup.staffCode || "NVBH của đơn";
      const confirmStaffRemainder = window.confirm(
        `Tổng số lượng phân bổ cho khách đang còn thiếu (SL thiếu: ${totalShortageQty}${
          totalShortagePromo > 0 ? `, SL KM thiếu: ${totalShortagePromo}` : ""
        }).\n\nHệ thống sẽ tự động tách phần thiếu này thành 1 đơn riêng gắn Công nợ cho NVBH (${staffLabel}). Bạn có đồng ý tiếp tục?`
      );
      if (!confirmStaffRemainder) {
        return;
      }
    }

    setIsSubmittingSplit(true);
    try {
      const response = await apiFetch(`${API_URL}/sync/vinamilk-orders/split-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_number: selectedSplitOrderGroup.orderNumber,
          splits: splitsPayload,
          auto_assign_remainder_to_staff: hasShortage,
        }),
      });
      const result = (await response.json()) as {
        id?: number;
        source_order_number?: string;
        detail?: string;
      };
      if (!response.ok) throw new Error(result.detail ?? "Không thể gửi yêu cầu tách đơn hàng.");
      setIsSplitDrawerOpen(false);
      setSelectedSplitOrderNumber("");
      setToast(
        `Đã gửi yêu cầu tách đơn ${result.source_order_number ?? selectedSplitOrderGroup.orderNumber} (Mã YC #${result.id}) chờ Kế toán xác nhận.`
      );
      await loadLocalOrders();
    } catch (error) {
      setSplitError(error instanceof Error ? error.message : "Không thể gửi yêu cầu tách đơn hàng.");
    } finally {
      setIsSubmittingSplit(false);
    }
  }

  async function handleApproveSplitRequest(reqItem: SplitOrderApprovalRequest) {
    if (
      !window.confirm(
        `Xác nhận DUYỆT tách đơn ${reqItem.source_order_number} (Yêu cầu #${reqItem.id} do ${reqItem.requested_by} tạo)?\nHệ thống sẽ chính thức tạo các đơn tách trên DMS nội bộ.`
      )
    ) {
      return;
    }
    setProcessingSplitRequestId(reqItem.id);
    setSplitApprovalError("");
    try {
      const response = await apiFetch(
        `${API_URL}/sync/vinamilk-orders/split-requests/${reqItem.id}/approve`,
        { method: "POST" }
      );
      const result = (await response.json()) as {
        new_order_numbers?: string[];
        replaced_order_number?: string;
        detail?: string;
      };
      if (!response.ok) throw new Error(result.detail ?? "Không thể duyệt yêu cầu tách đơn.");
      setToast(
        `Kế toán đã duyệt tách đơn ${result.replaced_order_number ?? reqItem.source_order_number} thành ${(result.new_order_numbers ?? []).join(", ")}.`
      );
      await loadSplitApprovalRequests(splitApprovalFilter);
      await loadLocalOrders();
    } catch (error) {
      setSplitApprovalError(
        error instanceof Error ? error.message : "Không thể duyệt yêu cầu tách đơn."
      );
    } finally {
      setProcessingSplitRequestId(null);
    }
  }

  async function handleRejectSplitRequest(reqItem: SplitOrderApprovalRequest) {
    const reason = window.prompt(
      `Nhập lý do từ chối / hủy yêu cầu tách đơn ${reqItem.source_order_number} (#${reqItem.id}):`,
      ""
    );
    if (reason === null) return;
    setProcessingSplitRequestId(reqItem.id);
    setSplitApprovalError("");
    try {
      const response = await apiFetch(
        `${API_URL}/sync/vinamilk-orders/split-requests/${reqItem.id}/reject`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: reason.trim() || null }),
        }
      );
      const result = (await response.json()) as { detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "Không thể từ chối yêu cầu tách đơn.");
      setToast(`Đã từ chối yêu cầu tách đơn ${reqItem.source_order_number} (#${reqItem.id}).`);
      await loadSplitApprovalRequests(splitApprovalFilter);
      await loadLocalOrders();
    } catch (error) {
      setSplitApprovalError(
        error instanceof Error ? error.message : "Không thể từ chối yêu cầu tách đơn."
      );
    } finally {
      setProcessingSplitRequestId(null);
    }
  }

  // Tính toán danh sách đơn đã chọn để Gộp và bảng tổng hợp sản phẩm preview
  const selectedMergeGroups = useMemo(
    () =>
      selectedMergeOrderNumbers
        .map((num) => eligibleOrderGroups.find((g) => g.orderNumber === num))
        .filter((g): g is GroupedOrderSummary => g !== undefined),
    [eligibleOrderGroups, selectedMergeOrderNumbers]
  );

  const selectedRepresentativeMergeGroup = useMemo(
    () =>
      selectedMergeGroups.find((g) => g.orderNumber === representativeOrderNumber) ??
      selectedMergeGroups[0] ??
      null,
    [selectedMergeGroups, representativeOrderNumber]
  );

  function handleSelectMergeCustomer(customerCode: string) {
    const found = allCustomerOptions.find((c) => c.customer_code === customerCode);
    if (found) {
      setMergeCustomCustomer({
        customer_code: found.customer_code,
        customer_name: found.customer_name,
        customer_address: found.customer_address,
      });
    } else {
      setMergeCustomCustomer((prev) => ({
        ...prev,
        customer_code: customerCode,
      }));
    }
  }

  function handleSelectMergeStaff(staffCode: string) {
    const found = allStaffOptions.find((s) => s.staff_code === staffCode);
    if (found) {
      setMergeCustomStaff({
        staff_code: found.staff_code,
        staff_name: found.staff_name,
      });
    } else {
      setMergeCustomStaff((prev) => ({
        ...prev,
        staff_code: staffCode,
      }));
    }
  }

  const mergedProductPreview = useMemo(() => {
    const map = new Map<
      string,
      {
        productCode: string;
        productName: string;
        promoCode: string;
        unit: string;
        quantity: number;
        promoQuantity: number;
        totalValue: number;
        totalDiscount: number;
      }
    >();
    for (const group of selectedMergeGroups) {
      for (const line of group.lines) {
        const productCode = displayRemoteValue(line["Mã sản phẩm"]).trim();
        const promoCode = displayRemoteValue(line["Mã CTKM"]).trim();
        const key = `${productCode}||${promoCode}`;
        const existing = map.get(key);
        if (!existing) {
          map.set(key, {
            productCode,
            productName: displayRemoteValue(line["Sản phẩm"]).trim(),
            promoCode,
            unit: displayRemoteValue(line["ĐVT"]).trim(),
            quantity: numericValue(line["Số lượng"]),
            promoQuantity: numericValue(line["Số lượng KM"]),
            totalValue: numericValue(line["Giá trị"]),
            totalDiscount: numericValue(line["Số tiền CK"]),
          });
        } else {
          existing.quantity += numericValue(line["Số lượng"]);
          existing.promoQuantity += numericValue(line["Số lượng KM"]);
          existing.totalValue += numericValue(line["Giá trị"]);
          existing.totalDiscount += numericValue(line["Số tiền CK"]);
        }
      }
    }
    return Array.from(map.values());
  }, [selectedMergeGroups]);

  function toggleMergeOrderNumber(orderNumber: string) {
    setMergeError("");
    setSelectedMergeOrderNumbers((prev) => {
      const exists = prev.includes(orderNumber);
      const next = exists ? prev.filter((item) => item !== orderNumber) : [...prev, orderNumber];
      if (!next.includes(representativeOrderNumber)) {
        setRepresentativeOrderNumber(next[0] ?? "");
      }
      return next;
    });
  }

  async function submitMergeOrders() {
    if (selectedMergeOrderNumbers.length < 2) {
      setMergeError("Vui lòng chọn ít nhất 2 đơn hàng để gộp.");
      return;
    }
    if (mergeOverrideCustomer && !mergeCustomCustomer.customer_code.trim()) {
      setMergeError("Vui lòng chọn hoặc nhập Mã khách hàng đại diện cho đơn gộp.");
      return;
    }
    if (mergeOverrideStaff && !mergeCustomStaff.staff_code.trim() && !mergeCustomStaff.staff_name.trim()) {
      setMergeError("Vui lòng chọn hoặc nhập NVBH đại diện cho đơn gộp.");
      return;
    }
    setMergeError("");
    setIsSubmittingMerge(true);
    try {
      const response = await apiFetch(`${API_URL}/sync/vinamilk-orders/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_numbers: selectedMergeOrderNumbers,
          representative_order_number: representativeOrderNumber || selectedMergeOrderNumbers[0],
          customer_code: mergeOverrideCustomer ? mergeCustomCustomer.customer_code.trim() || undefined : undefined,
          customer_name: mergeOverrideCustomer ? mergeCustomCustomer.customer_name.trim() || undefined : undefined,
          customer_address: mergeOverrideCustomer ? mergeCustomCustomer.customer_address.trim() || undefined : undefined,
          staff_code: mergeOverrideStaff ? mergeCustomStaff.staff_code.trim() || undefined : undefined,
          staff_name: mergeOverrideStaff ? mergeCustomStaff.staff_name.trim() || undefined : undefined,
        }),
      });
      const result = await response.json() as {
        new_order_number?: string;
        merged_order_numbers?: string[];
        detail?: string;
      };
      if (!response.ok) throw new Error(result.detail ?? "Không thể gộp các đơn hàng.");
      setIsMergeDrawerOpen(false);
      setSelectedMergeOrderNumbers([]);
      setRepresentativeOrderNumber("");
      setMergeOverrideCustomer(false);
      setMergeOverrideStaff(false);
      setToast(
        `Đã gộp ${(result.merged_order_numbers ?? []).join(", ")} thành đơn mới ${result.new_order_number}.`
      );
      await loadLocalOrders();
    } catch (error) {
      setMergeError(error instanceof Error ? error.message : "Không thể gộp các đơn hàng.");
    } finally {
      setIsSubmittingMerge(false);
    }
  }

  async function handleRevertSplitMerge(orderNumber: string) {
    if (
      !window.confirm(
        `Bạn có chắc muốn hoàn tác tách/gộp cho đơn ${orderNumber}? Các đơn tách/gộp liên quan sẽ bị xóa và đơn gốc sẽ trở lại trạng thái ban đầu.`
      )
    ) {
      return;
    }
    setRevertingOrderNumber(orderNumber);
    setRemoteError("");
    try {
      const response = await apiFetch(
        `${API_URL}/sync/vinamilk-orders/split-merge/${encodeURIComponent(orderNumber)}`,
        { method: "DELETE" }
      );
      const result = await response.json() as {
        deleted_synthetic_orders?: string[];
        detail?: string;
      };
      if (!response.ok) throw new Error(result.detail ?? "Không thể hoàn tác đơn tách/gộp.");
      setToast(
        `Đã hoàn tác thành công (xóa đơn: ${(result.deleted_synthetic_orders ?? []).join(", ")}).`
      );
      await loadLocalOrders();
    } catch (error) {
      setRemoteError(error instanceof Error ? error.message : "Không thể hoàn tác đơn tách/gộp.");
    } finally {
      setRevertingOrderNumber(null);
    }
  }

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

  const remoteColumns = remoteColumnDefinitions
    .filter(({ title }) => (
      ["Tình trạng xử lý đơn hàng", "Trạng thái xử lý", "Nhà cung cấp", "Thay thế cho đơn", "Người thực hiện"].includes(title)
    ) || remoteOrders.some((order) => hasRemoteValue(order[title])))
    .map(({ title, width, align }): Column<RemoteOrder> => ({
      key: title,
      title,
      sortable: true,
      width,
      align,
      render: (value, order) => {
        const text = formatRemoteColumnValue(title, value);
        if (title === "Nhà cung cấp") {
          return text ? (
            <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 border border-amber-200">
              {text}
            </span>
          ) : (
            <span className="text-gray-400">—</span>
          );
        }
        if (title === "Người thực hiện") {
          const actor = text || "Hệ thống";
          const isSystem = actor === "Hệ thống";
          return (
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                isSystem
                  ? "bg-gray-100 text-gray-600"
                  : "bg-sky-50 text-sky-700 border border-sky-200"
              }`}
              title={actor}
            >
              {actor}
            </span>
          );
        }
        if (title === "Thay thế cho đơn") {
          const replacementType = displayRemoteValue(order["_replacement_type"]).trim();
          const orderNum = displayRemoteValue(order["Số đơn hàng"]).trim();
          if (replacementType === "PENDING_SPLIT") {
            return (
              <button
                type="button"
                onClick={() => {
                  setSplitApprovalError("");
                  setIsSplitApprovalDrawerOpen(true);
                  void loadSplitApprovalRequests(splitApprovalFilter);
                }}
                className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
                title="Bấm để mở danh sách Kế toán xác nhận tách đơn"
              >
                <Clock3 size={12} />
                {text || "Chờ KT duyệt tách"}
              </button>
            );
          }
          if (replacementType === "SPLIT" || replacementType === "MERGE") {
            const isBtt = text.startsWith("BTT:");
            const canRevert = effectiveIsAdmin || isOrderToday(order);
            return (
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`truncate text-xs font-medium ${
                    isBtt ? "text-amber-700" : "text-sky-700"
                  }`}
                  title={text}
                >
                  {text}
                </span>
                {canRevert ? (
                  <button
                    type="button"
                    onClick={() => void handleRevertSplitMerge(orderNum)}
                    disabled={revertingOrderNumber === orderNum}
                    title="Hoàn tác tách/gộp đơn này"
                    className="inline-flex shrink-0 items-center gap-1 rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[11px] font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                  >
                    <RotateCcw size={11} />
                    Hoàn tác
                  </button>
                ) : (
                  <span
                    className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500"
                    title="Chỉ Admin mới được phép hoàn tác tách/gộp đơn của ngày cũ"
                  >
                    Đã khóa
                  </span>
                )}
              </div>
            );
          }
          return (
            <button
              type="button"
              onClick={() => openReplacementEditor(order)}
              className="text-left font-medium text-sky-700 hover:text-sky-900 hover:underline"
              title={text || undefined}
            >
              {text || "Gán đơn thay thế"}
            </button>
          );
        }
        if (title === "Trạng thái tạo đơn") {
          if (!text) return <span className="text-gray-400">—</span>;
          const isXuatHang = text.includes("001") || text.includes("Xuất hàng");
          const isDuongSo = text.includes("002") || text.includes("Dương Số");
          return (
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${
                isXuatHang
                  ? "bg-blue-50 text-blue-700 border-blue-200"
                  : isDuongSo
                  ? "bg-amber-50 text-amber-800 border-amber-300"
                  : "bg-gray-100 text-gray-700 border-gray-200"
              }`}
            >
              {text}
            </span>
          );
        }
        if (title === "Tình trạng xử lý đơn hàng" || title === "Trạng thái xử lý") {
          const deliveryStatus = displayRemoteValue(order["_delivery_status"]).trim();
          const procStatus = displayRemoteValue(order["_processing_status"]).trim();

          if (deliveryStatus === "Đã Xuất") {
            return (
              <div className="flex flex-wrap items-center gap-1">
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                  <CheckCircle2 size={12} className="text-emerald-600" />
                  Đã Xuất
                </span>
                {procStatus && procStatus !== "Đã Xuất" && (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                    {procStatus}
                  </span>
                )}
              </div>
            );
          }
          if (deliveryStatus === "Đã Duyệt") {
            return (
              <div className="flex flex-wrap items-center gap-1">
                <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700 ring-1 ring-sky-200">
                  <CircleCheck size={12} className="text-sky-600" />
                  Đã Duyệt
                </span>
                {procStatus && procStatus !== "Đã Duyệt" && (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                    {procStatus}
                  </span>
                )}
              </div>
            );
          }
          if (text === "Chờ KT duyệt tách") {
            return (
              <button
                type="button"
                onClick={() => {
                  setSplitApprovalError("");
                  setIsSplitApprovalDrawerOpen(true);
                  void loadSplitApprovalRequests(splitApprovalFilter);
                }}
                className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100"
              >
                <Clock3 size={12} />
                Chờ KT duyệt tách
              </button>
            );
          }
          if (text === "Đơn Tách" || text === "Đơn Tách (Nợ NVBH)") {
            const isStaffDebt = text === "Đơn Tách (Nợ NVBH)";
            return (
              <div className="flex flex-wrap items-center gap-1">
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium border ${
                    isStaffDebt
                      ? "bg-amber-50 text-amber-800 border-amber-300"
                      : "bg-purple-50 text-purple-700 border-purple-200"
                  }`}
                >
                  {text}
                </span>
                {order["_warehouse_updated"] === true && (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                    Đã cập nhật kho
                  </span>
                )}
              </div>
            );
          }
          if (text === "Đơn Gộp") {
            return (
              <div className="flex flex-wrap items-center gap-1">
                <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 border border-indigo-200">
                  Đơn Gộp
                </span>
                {order["_warehouse_updated"] === true && (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                    Đã cập nhật kho
                  </span>
                )}
              </div>
            );
          }
          if (text === "Đơn Tự Tạo") {
            return (
              <span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700 border border-teal-200">
                Đơn Tự Tạo
              </span>
            );
          }
          if (text === "Đã cập nhật kho" || text === "Đã trả") {
            const tone = "bg-emerald-50 text-emerald-700";
            return <span className={`rounded-full px-2 py-1 text-xs font-medium ${tone}`}>{text}</span>;
          }
          if (!text) return <span className="text-gray-400">—</span>;
          return <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">{text}</span>;
        }
        return <span className="block truncate" title={text || undefined}>{text}</span>;
      },
    }));

  const remoteStatuses = Array.from(
    new Set([
      "Đã Duyệt",
      "Đã Xuất",
      ...remoteOrders
        .map((order) => displayRemoteValue(order["Tình trạng xử lý đơn hàng"] || order["Trạng thái xử lý"]))
        .filter((status) => status.length > 0 && status !== "Đã Duyệt" && status !== "Đã Xuất"),
    ])
  );
  const filteredRemoteOrders = remoteOrders.filter((order) => {
    const matches = (key: string, query: string) =>
      !query || displayRemoteValue(order[key]).toLocaleLowerCase("vi").includes(query.trim().toLocaleLowerCase("vi"));
    // Tìm đơn cũ thì vẫn thấy đơn thay thế nó (và ngược lại).
    const orderQuery = orderFilter.trim().toLocaleLowerCase("vi");
    const relatedOrders = [
      order["Thay thế cho đơn"],
      order["_replaced_order_number"],
      ...(Array.isArray(order["_replaced_by_order_numbers"]) ? order["_replaced_by_order_numbers"] : []),
    ].map((value) => displayRemoteValue(value).toLocaleLowerCase("vi"));
    if (!matches("Số đơn hàng", orderFilter) && !(orderQuery && relatedOrders.some((value) => value.includes(orderQuery)))) return false;
    if (!matches("Mã KH", customerFilter) && !matches("Tên KH", customerFilter)) return false;
    if (!matches("Mã NVBH", staffFilter) && !matches("Tên NVBH", staffFilter)) return false;
    if (!matches("Mã sản phẩm", productFilter) && !matches("Sản phẩm", productFilter) && !matches("Nhà cung cấp", productFilter)) return false;
    if (statusFilter !== "Tất cả" && displayRemoteValue(order["Tình trạng xử lý đơn hàng"] || order["Trạng thái xử lý"]) !== statusFilter) return false;
    return true;
  });

  const deliveryRequestOrderOptions = Array.from(
    filteredRemoteOrders.reduce((orders, row) => {
      const orderNumber = displayRemoteValue(row["Số đơn hàng"]).trim();
      if (!orderNumber || orders.has(orderNumber)) return orders;
      orders.set(orderNumber, {
        order_number: orderNumber,
        order_date: displayRemoteValue(row["_order_created_date"]).trim()
          || displayRemoteValue(row["Ngày tạo"]).trim(),
        customer_code: displayRemoteValue(row["Mã KH"]).trim(),
        customer_name: displayRemoteValue(row["Tên KH"]).trim(),
        original_status: displayRemoteValue(row["Trạng thái"]).trim(),
      });
      return orders;
    }, new Map<string, DeliveryRequestOrderOption>())
      .values()
  );
  const filteredDeliveryRequestOrders = deliveryRequestOrderOptions.filter((order) => {
    const search = deliveryRequestSearch.trim().toLocaleLowerCase("vi");
    if (!search) return true;
    return [
      order.order_number,
      order.customer_code,
      order.customer_name,
      order.original_status,
    ].some((value) => value.toLocaleLowerCase("vi").includes(search));
  });
  const selectedDeliveryOrders = deliveryRequestOrderOptions.filter((order) =>
    selectedDeliveryOrderNumbers.has(order.order_number)
  );

  async function openDeliveryRequestDrawer() {
    setDeliveryRequestError("");
    setDeliveryEmployeeError("");
    setDeliveryRequestSearch("");
    setSelectedDeliveryOrderNumbers(new Set());
    setDeliveryEmployeeAssignments({});
    setDeliveryOrderStatuses({});
    setDeliveryRequestPreview(null);
    setDeliveryRequestPlan(null);
    setAcknowledgeDeliveryWarnings(false);
    setIsDeliveryRequestDrawerOpen(true);
    setIsLoadingDeliveryEmployees(true);
    try {
      const [employeeResponse, warehouseResponse] = await Promise.all([
        apiFetch(`${API_URL}/employees/?status=active&limit=1000`),
        apiFetch(`${API_URL}/inventory/warehouses/`),
      ]);
      const employeePayload = await employeeResponse.json() as DeliveryEmployeeOption[] | { detail?: string };
      if (!employeeResponse.ok) {
        throw new Error(!Array.isArray(employeePayload) ? employeePayload.detail ?? "Không tải được danh sách nhân viên." : "Không tải được danh sách nhân viên.");
      }
      const warehouses = await warehouseResponse.json() as DeliveryWarehouseOption[] | { detail?: string };
      if (!warehouseResponse.ok || !Array.isArray(warehouses)) {
        throw new Error(!Array.isArray(warehouses) ? warehouses.detail ?? "Không tải được danh sách kho." : "Không tải được danh sách kho.");
      }
      const employees = Array.isArray(employeePayload)
        ? employeePayload.filter((employee) =>
            employee.status?.toLowerCase() === "active" && employee.code?.trim().toUpperCase().startsWith("NV")
          )
        : [];
      setDeliveryEmployees(employees);
      setDeliveryWarehouses(warehouses);
      setDeliveryWarehouseId((current) => current && warehouses.some((warehouse) => String(warehouse.id) === current)
        ? current
        : warehouses[0] ? String(warehouses[0].id) : "");
      if (employees.length === 0) {
        setDeliveryEmployeeError("Không tìm thấy nhân viên đang hoạt động có mã bắt đầu bằng NV.");
      }
    } catch (error) {
      setDeliveryEmployeeError(error instanceof Error ? error.message : "Không tải được danh sách NVGH.");
    } finally {
      setIsLoadingDeliveryEmployees(false);
    }
  }

  function toggleDeliveryRequestOrder(orderNumber: string, checked: boolean) {
    setDeliveryRequestPreview(null);
    setDeliveryRequestPlan(null);
    setAcknowledgeDeliveryWarnings(false);
    setSelectedDeliveryOrderNumbers((current) => {
      const next = new Set(current);
      if (checked) next.add(orderNumber);
      else next.delete(orderNumber);
      return next;
    });
    if (checked) {
      setDeliveryOrderStatuses((current) => ({
        ...current,
        [orderNumber]: current[orderNumber] ?? "001-Xuất hàng",
      }));
    } else {
      setDeliveryEmployeeAssignments((current) => {
        const next = { ...current };
        delete next[orderNumber];
        return next;
      });
      setDeliveryOrderStatuses((current) => {
        const next = { ...current };
        delete next[orderNumber];
        return next;
      });
    }
  }

  function buildDeliveryRequestWorkbook(orders: DeliveryRequestOrderOption[]) {
    const rows = [
      ["Ngày đơn hàng", "Số đơn hàng", "Mã NVGH", "Tên NVGH", "Mã Khách hàng", "Tên Khách hàng", "Trạng Thái"],
      ...orders.map((order) => {
        const employeeCode = deliveryEmployeeAssignments[order.order_number] ?? "";
        const employee = deliveryEmployees.find((item) => item.code.toUpperCase() === employeeCode.toUpperCase());
        return [
          order.order_date,
          order.order_number,
          employeeCode,
          employee?.name ?? "",
          order.customer_code,
          order.customer_name,
          deliveryOrderStatuses[order.order_number] ?? "001-Xuất hàng",
        ];
      }),
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "DSDonHang");
    const contents = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    return new File(
      [contents],
      `Form_Yeu_Cau_Xuat_Kho_${fromDate}.xlsx`,
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    );
  }

  async function analyzeDeliveryRequest() {
    if (!deliveryWarehouseId) {
      setDeliveryRequestError("Vui lòng chọn kho xuất hàng.");
      return;
    }
    if (selectedDeliveryOrders.length === 0) {
      setDeliveryRequestError("Vui lòng chọn ít nhất một đơn hàng.");
      return;
    }
    if (selectedDeliveryOrders.some((order) => (
      !deliveryEmployeeAssignments[order.order_number] ||
      !(deliveryOrderStatuses[order.order_number] ?? "001-Xuất hàng")
    ))) {
      setDeliveryRequestError("Vui lòng chọn NVGH và trạng thái cho tất cả đơn đã chọn.");
      return;
    }
    setDeliveryRequestError("");
    setDeliveryRequestPreview(null);
    setDeliveryRequestPlan(null);
    setAcknowledgeDeliveryWarnings(false);
    setIsAnalyzingDeliveryRequest(true);
    try {
      const body = new FormData();
      body.append("file", buildDeliveryRequestWorkbook(selectedDeliveryOrders));
      const response = await apiFetch(
        `${API_URL}/delivery-requests/upload?warehouse_id=${encodeURIComponent(deliveryWarehouseId)}`,
        { method: "POST", body },
      );
      const result = await response.json() as DeliveryRequestPreview | { detail?: string };
      if (!response.ok) {
        throw new Error(!("items" in result) ? result.detail ?? "Không thể phân tích yêu cầu xuất hàng." : "Không thể phân tích yêu cầu xuất hàng.");
      }
      const preview = result as DeliveryRequestPreview;
      setDeliveryRequestPreview(preview);
      if (preview.items.length === 0 || !preview.can_create || preview.issues.length > 0) return;

      const [planResponse, stockResponse] = await Promise.all([
        apiFetch(`${API_URL}/delivery-requests/plan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            warehouse_id: Number(deliveryWarehouseId),
            items: preview.items.map((item) => ({ product_id: item.product_id, quantity: item.quantity })),
          }),
        }),
        apiFetch(`${API_URL}/inventory/stock-levels/?warehouse_id=${encodeURIComponent(deliveryWarehouseId)}`),
      ]);
      const [planResult, stockResult] = await Promise.all([
        planResponse.json() as Promise<DeliveryPlanItem[] | { detail?: string }>,
        stockResponse.json() as Promise<{ product_id: number; available: number }[] | { detail?: string }>,
      ]);
      if (!planResponse.ok || !Array.isArray(planResult)) {
        throw new Error(!Array.isArray(planResult) ? planResult.detail ?? "Không thể lập kế hoạch FEFO." : "Không thể lập kế hoạch FEFO.");
      }
      if (!stockResponse.ok || !Array.isArray(stockResult)) {
        throw new Error(!Array.isArray(stockResult) ? stockResult.detail ?? "Không thể kiểm tra tồn kho." : "Không thể kiểm tra tồn kho.");
      }
      const availableByProduct = new Map(stockResult.map((item) => [item.product_id, item.available]));
      const stockedPreview = {
        ...preview,
        items: preview.items.map((item) => {
          const available = availableByProduct.get(item.product_id) ?? 0;
          return {
            ...item,
            available_quantity: available,
            shortage_quantity: Math.max(0, item.quantity - available),
          };
        }),
      };
      setDeliveryRequestPreview(stockedPreview);
      setDeliveryRequestPlan(planResult);
    } catch (error) {
      setDeliveryRequestError(error instanceof Error ? error.message : "Không thể phân tích yêu cầu xuất hàng.");
    } finally {
      setIsAnalyzingDeliveryRequest(false);
    }
  }

  async function submitDeliveryRequest() {
    if (!deliveryRequestPreview || !deliveryRequestPlan) return;
    if (!deliveryRequestPreview.can_create || deliveryRequestPreview.issues.length > 0) {
      setDeliveryRequestError("Hãy xử lý các lỗi đối chiếu trước khi gửi yêu cầu.");
      return;
    }
    if (deliveryRequestPreview.warnings.length > 0 && !acknowledgeDeliveryWarnings) {
      setDeliveryRequestError("Vui lòng xác nhận đã xem các cảnh báo trước khi gửi.");
      return;
    }
    if (deliveryRequestPreview.items.some((item) => item.shortage_quantity > 0) ||
      deliveryRequestPlan.some((item) => item.shortage_quantity > 0 || item.planned_quantity !== item.quantity)) {
      setDeliveryRequestError("Không thể gửi yêu cầu khi còn thiếu tồn kho hoặc FEFO chưa phân bổ đủ.");
      return;
    }
    setDeliveryRequestError("");
    setIsCreatingDeliveryRequest(true);
    try {
      const items = deliveryRequestPreview.items.map((item) => {
        const planItem = deliveryRequestPlan.find((planned) => planned.product_id === item.product_id);
        if (!planItem) throw new Error(`Thiếu kế hoạch FEFO cho mã ${item.sku}.`);
        return {
          product_id: item.product_id,
          quantity: item.quantity,
          employee_allocations: item.employee_allocations,
          borrowed_employee_offsets: item.borrowed_employee_offsets,
          planned_allocations: planItem.picks.map((pick) => ({
            lot_id: pick.lot_id,
            location_code: pick.location_code,
            location_id: pick.location_id,
            lot_number: pick.lot_number,
            expiry_date: pick.expiry_date,
            quantity: pick.quantity,
            allocation_strategy: pick.allocation_strategy,
          })),
        };
      });
      const response = await apiFetch(`${API_URL}/delivery-requests/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          warehouse_id: Number(deliveryWarehouseId),
          items,
          employee_summaries: deliveryRequestPreview.employee_summaries,
          orders: deliveryRequestPreview.orders,
          note: "Tạo trực tiếp từ màn hình Đơn hàng Vinamilk.",
        }),
      });
      const created = await response.json() as { id?: number; code?: string; detail?: string };
      if (!response.ok) throw new Error(created.detail ?? "Không thể tạo yêu cầu xuất hàng.");
      let submitWarning = "";
      if (created.id) {
        try {
          const submitResponse = await apiFetch(`${API_URL}/delivery-requests/${created.id}/submit`, { method: "POST" });
          if (!submitResponse.ok) {
            const submitResult = await submitResponse.json() as { detail?: string };
            submitWarning = `Tạo được yêu cầu ${created.code ?? ""} nhưng chưa gửi thủ kho: ${submitResult.detail ?? "lỗi không xác định"}.`;
          }
        } catch (error) {
          submitWarning = `Tạo được yêu cầu ${created.code ?? ""} nhưng chưa xác nhận gửi thủ kho: ${error instanceof Error ? error.message : "lỗi kết nối"}.`;
        }
      }
      setToast(submitWarning
        ? submitWarning
        : `Đã tạo và gửi yêu cầu ${created.code ?? ""} đến thủ kho.`);
      setIsDeliveryRequestDrawerOpen(false);
      setDeliveryRequestPreview(null);
      setDeliveryRequestPlan(null);
      router.push(created.id
        ? `/admin/delivery-requests?request_id=${created.id}`
        : "/admin/delivery-requests");
    } catch (error) {
      setDeliveryRequestError(error instanceof Error ? error.message : "Không thể gửi yêu cầu xuất hàng.");
    } finally {
      setIsCreatingDeliveryRequest(false);
    }
  }

  async function downloadDeliveryRequestForm() {
    const orders = selectedDeliveryOrders.map((order) => ({
      order_number: order.order_number,
      delivery_employee_code: deliveryEmployeeAssignments[order.order_number] ?? "",
      status: deliveryOrderStatuses[order.order_number] ?? "001-Xuất hàng",
    }));
    if (orders.length === 0) {
      setDeliveryRequestError("Vui lòng chọn ít nhất một đơn hàng.");
      return;
    }
    if (orders.some((order) => !order.delivery_employee_code)) {
      setDeliveryRequestError("Vui lòng chọn nhân viên giao hàng cho tất cả đơn đã chọn.");
      return;
    }

    setDeliveryRequestError("");
    setIsDownloadingDeliveryRequest(true);
    try {
      const response = await apiFetch(`${API_URL}/sync/vinamilk-orders/delivery-request-form`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orders }),
      });
      if (!response.ok) {
        const result = await response.json() as { detail?: string };
        throw new Error(result.detail ?? "Không thể tạo phiếu yêu cầu xuất hàng.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Form_Yeu_Cau_Xuat_Kho_${fromDate}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setToast(`Đã tạo phiếu yêu cầu xuất hàng gồm ${orders.length} đơn.`);
      setIsDeliveryRequestDrawerOpen(false);
    } catch (error) {
      setDeliveryRequestError(error instanceof Error ? error.message : "Không thể tạo phiếu yêu cầu xuất hàng.");
    } finally {
      setIsDownloadingDeliveryRequest(false);
    }
  }

  function clearFilters() {
    setOrderFilter("");
    setCustomerFilter("");
    setStaffFilter("");
    setProductFilter("");
    setStatusFilter("Tất cả");
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
      replacedOrderNumber: displayRemoteValue(order["_replaced_order_number"]),
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

  function downloadExcel() {
    if (filteredRemoteOrders.length === 0) return;
    // Xuất đúng các cột đang hiển thị và các dòng sau lọc; mã khách hàng giữ nguyên đầy đủ.
    const exportRows = filteredRemoteOrders.map((order) =>
      Object.fromEntries(remoteColumns.map(({ key }) => [
        key,
        key === "Mã KH" ? displayRemoteValue(order[key]) : formatRemoteColumnValue(key, order[key]),
      ]))
    );
    const worksheet = XLSX.utils.json_to_sheet(exportRows, { header: remoteColumns.map(({ key }) => key) });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Don hang");
    XLSX.writeFile(workbook, `don-hang-vinamilk-${fromDate}-den-${toDate}.xlsx`);
  }

  // Loại trừ các đơn gốc đã bị tách/gộp (BTT) khi cộng tổng thẻ thống kê để không bị tính trùng
  const primaryOrders = filteredRemoteOrders.filter((order) => {
    const repType = displayRemoteValue(order["_replacement_type"]).trim();
    const isReplacedOriginal =
      (repType === "SPLIT" || repType === "MERGE") &&
      Array.isArray(order["_replaced_by_order_numbers"]) &&
      order["_replaced_by_order_numbers"].length > 0;
    return !isReplacedOriginal;
  });
  const totalValue = primaryOrders.reduce((sum, order) => sum + numericValue(order["Giá trị"]), 0);
  const totalDiscount = primaryOrders.reduce((sum, order) => sum + numericValue(order["Số tiền CK"]), 0);
  const confirmedDeliveries = primaryOrders.filter((order) => hasRemoteValue(order["Thời gian xác nhận giao hàng"])).length;

  const filteredSplitOrderOptions = eligibleOrderGroups.filter((group) => {
    if (!splitOrderSearch.trim()) return true;
    const q = splitOrderSearch.trim().toLocaleLowerCase("vi");
    return (
      group.orderNumber.toLocaleLowerCase("vi").includes(q) ||
      group.customerName.toLocaleLowerCase("vi").includes(q) ||
      group.customerCode.toLocaleLowerCase("vi").includes(q) ||
      group.staffName.toLocaleLowerCase("vi").includes(q)
    );
  });

  const filteredMergeOrderOptions = eligibleOrderGroups.filter((group) => {
    if (!mergeOrderSearch.trim()) return true;
    const q = mergeOrderSearch.trim().toLocaleLowerCase("vi");
    return (
      group.orderNumber.toLocaleLowerCase("vi").includes(q) ||
      group.customerName.toLocaleLowerCase("vi").includes(q) ||
      group.customerCode.toLocaleLowerCase("vi").includes(q) ||
      group.staffName.toLocaleLowerCase("vi").includes(q)
    );
  });

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
          <div className="flex flex-wrap items-center gap-2">
            {effectiveIsAdmin && (
              <button
                type="button"
                onClick={() => void openDeliveryRequestDrawer()}
                disabled={deliveryRequestOrderOptions.length === 0}
                className="flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3.5 py-2 text-sm font-medium text-sky-700 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download size={16} />
                Tạo phiếu yêu cầu xuất hàng
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setSplitApprovalError("");
                setIsSplitApprovalDrawerOpen(true);
                void loadSplitApprovalRequests(splitApprovalFilter);
              }}
              className={`flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors ${
                pendingSplitRequestCount > 0
                  ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
                  : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              <ClipboardCheck size={16} />
              Kế toán duyệt tách đơn
              {pendingSplitRequestCount > 0 && (
                <span className="inline-flex items-center justify-center rounded-full bg-amber-600 px-2 py-0.5 text-xs font-bold text-white">
                  {pendingSplitRequestCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setSplitError("");
                setIsSplitDrawerOpen(true);
              }}
              className="flex items-center gap-2 rounded-lg border border-purple-200 bg-purple-50 px-3.5 py-2 text-sm font-medium text-purple-700 hover:bg-purple-100 transition-colors"
            >
              <Split size={16} />
              Tách đơn
            </button>
            <button
              type="button"
              onClick={() => {
                setMergeError("");
                setIsMergeDrawerOpen(true);
              }}
              className="flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3.5 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 transition-colors"
            >
              <Merge size={16} />
              Gộp đơn
            </button>
            <Link href="/sales/create" className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
              <Plus size={16} />
              Tạo đơn hàng
            </Link>
          </div>
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
          <button onClick={downloadExcel} disabled={filteredRemoteOrders.length === 0} className="flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-50">
            Tải Excel toàn bộ
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm md:grid-cols-2 xl:grid-cols-5">
          <input value={orderFilter} onChange={(event) => setOrderFilter(event.target.value)} placeholder="Lọc số đơn hàng" className="min-w-0 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          <input value={customerFilter} onChange={(event) => setCustomerFilter(event.target.value)} placeholder="Lọc mã/tên khách hàng" className="min-w-0 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          <input value={staffFilter} onChange={(event) => setStaffFilter(event.target.value)} placeholder="Lọc mã/tên NVBH" className="min-w-0 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          <input value={productFilter} onChange={(event) => setProductFilter(event.target.value)} placeholder="Lọc mã/tên SP, Nhà cung cấp" className="min-w-0 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          <div className="flex gap-2">
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm">
              <option value="Tất cả">Tất cả trạng thái</option>
              {remoteStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
            <button onClick={clearFilters} className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">Xóa lọc</button>
          </div>
        </div>
        {remoteOrders.length > 0 && <p className="text-sm text-gray-500">Đang hiển thị {filteredRemoteOrders.length}/{remoteOrders.length} bản ghi sau lọc. {lastSyncedAt && ` Cập nhật gần nhất: ${formatVinamilkDate(lastSyncedAt, true)}`}</p>}
        {remoteError && <div className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"><AlertTriangle size={16} />{remoteError}</div>}
      </section>

      {remoteColumns.length > 0 ? (
        <DataTable
          data={filteredRemoteOrders}
          columns={remoteColumns}
          searchable={false}
          pageSize={pageSize}
          emptyMessage="Không có đơn hàng trong khoảng ngày đã chọn"
          getRowKey={orderRowKey}
          fitColumns
        />
      ) : (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-12 text-center text-sm text-gray-400">
          Chưa có dữ liệu trong database. Chọn khoảng ngày rồi bấm “Đồng bộ Vinamilk DMS” để cập nhật.
        </div>
      )}

      <Drawer
        open={isDeliveryRequestDrawerOpen}
        onClose={() => {
          if (!isDownloadingDeliveryRequest && !isAnalyzingDeliveryRequest && !isCreatingDeliveryRequest) {
            setIsDeliveryRequestDrawerOpen(false);
          }
        }}
        title="Tạo phiếu yêu cầu xuất hàng"
        subtitle="Chọn đơn hàng, kiểm tra tồn kho và FEFO, rồi xác nhận gửi yêu cầu đến thủ kho."
        size="4xl"
      >
        <div className="space-y-4 p-5">
          <label className="block text-sm text-gray-600">
            Kho xuất hàng
            <select
              value={deliveryWarehouseId}
              onChange={(event) => {
                setDeliveryWarehouseId(event.target.value);
                setDeliveryRequestPreview(null);
                setDeliveryRequestPlan(null);
              }}
              disabled={deliveryWarehouses.length === 0 || isCreatingDeliveryRequest}
              className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm disabled:bg-gray-100"
            >
              <option value="">Chọn kho xuất hàng</option>
              {deliveryWarehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="min-w-[220px] flex-1 text-sm text-gray-600">
              Tìm đơn trong danh sách hiện tại
              <input
                value={deliveryRequestSearch}
                onChange={(event) => setDeliveryRequestSearch(event.target.value)}
                placeholder="Mã đơn, mã/tên khách hàng, trạng thái"
                className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                const next = new Set(selectedDeliveryOrderNumbers);
                const allVisibleSelected = filteredDeliveryRequestOrders.every((order) => next.has(order.order_number));
                filteredDeliveryRequestOrders.forEach((order) => {
                  if (allVisibleSelected) {
                    next.delete(order.order_number);
                  } else {
                    next.add(order.order_number);
                  }
                });
                setSelectedDeliveryOrderNumbers(next);
                setDeliveryRequestPreview(null);
                setDeliveryRequestPlan(null);
                setAcknowledgeDeliveryWarnings(false);
              }}
              disabled={filteredDeliveryRequestOrders.length === 0}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {filteredDeliveryRequestOrders.length > 0
                && filteredDeliveryRequestOrders.every((order) => selectedDeliveryOrderNumbers.has(order.order_number))
                ? "Bỏ chọn danh sách lọc"
                : "Chọn danh sách lọc"}
            </button>
          </div>

          <div className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">
            Danh sách lấy theo bộ lọc bảng đơn hàng. Đã chọn {selectedDeliveryOrders.length} đơn.
            Danh sách NVGH chỉ gồm nhân viên đang hoạt động có mã bắt đầu bằng NV. 002-Dương Số ghi nhận hàng vay theo NVBH; 003-Âm Số bù trừ hàng đã vay.
          </div>
          {deliveryEmployeeError && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{deliveryEmployeeError}</div>
          )}
          {deliveryRequestError && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{deliveryRequestError}</div>
          )}
          {isLoadingDeliveryEmployees && (
            <p className="text-sm text-gray-500">Đang tải danh sách nhân viên giao hàng...</p>
          )}

          <div className="max-h-[55vh] overflow-auto rounded-xl border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="sticky top-0 bg-gray-50">
                <tr>
                  <th className="w-10 px-3 py-2 text-center">
                    <span className="sr-only">Chọn đơn</span>
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">Ngày đơn hàng</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">Số đơn hàng</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">Khách hàng</th>
                  <th className="min-w-40 px-3 py-2 text-left font-semibold text-gray-600">Loại yêu cầu</th>
                  <th className="min-w-64 px-3 py-2 text-left font-semibold text-gray-600">Nhân viên giao hàng</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {filteredDeliveryRequestOrders.map((order) => {
                  const checked = selectedDeliveryOrderNumbers.has(order.order_number);
                  return (
                    <tr key={order.order_number} className={checked ? "bg-sky-50/60" : ""}>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => toggleDeliveryRequestOrder(order.order_number, event.target.checked)}
                          aria-label={`Chọn đơn ${order.order_number}`}
                          className="h-4 w-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500"
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {formatRemoteColumnValue("Ngày tạo", order.order_date) || "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono font-medium">{order.order_number}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-800">{order.customer_name || "—"}</div>
                        <div className="text-xs text-gray-500">{order.customer_code}</div>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={deliveryOrderStatuses[order.order_number] ?? "001-Xuất hàng"}
                          onChange={(event) => {
                            setDeliveryOrderStatuses((current) => ({
                              ...current,
                              [order.order_number]: event.target.value,
                            }));
                            setDeliveryRequestPreview(null);
                            setDeliveryRequestPlan(null);
                            setAcknowledgeDeliveryWarnings(false);
                          }}
                          disabled={!checked || isCreatingDeliveryRequest}
                          className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-400"
                          aria-label={`Loại yêu cầu đơn ${order.order_number}`}
                        >
                          <option value="001-Xuất hàng">001-Xuất hàng</option>
                          <option value="002-Dương Số">002-Dương Số</option>
                          <option value="003-Âm Số">003-Âm Số</option>
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={deliveryEmployeeAssignments[order.order_number] ?? ""}
                          onChange={(event) => {
                            setDeliveryEmployeeAssignments((current) => ({
                              ...current,
                              [order.order_number]: event.target.value,
                            }));
                            setDeliveryRequestPreview(null);
                            setDeliveryRequestPlan(null);
                            setAcknowledgeDeliveryWarnings(false);
                          }}
                          disabled={!checked || isLoadingDeliveryEmployees || deliveryEmployees.length === 0 || isCreatingDeliveryRequest}
                          className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-400"
                          aria-label={`Nhân viên giao hàng đơn ${order.order_number}`}
                        >
                          <option value="">Chọn NVGH</option>
                          {deliveryEmployees.map((employee) => (
                            <option key={employee.code} value={employee.code}>
                              {employee.code} · {employee.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
                {filteredDeliveryRequestOrders.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-gray-500">
                      Không có đơn hàng phù hợp với bộ lọc hiện tại.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {deliveryRequestPreview && (
            <section className="space-y-3 rounded-xl border border-gray-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold text-gray-900">Kết quả phân tích yêu cầu</h3>
                <span className="text-sm text-gray-500">{deliveryRequestPreview.items.length} mã hàng · {deliveryRequestPreview.orders.length} đơn</span>
              </div>
              {deliveryRequestPreview.issues.length > 0 && (
                <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                  <p className="mb-1 font-semibold">Cần xử lý trước khi tạo yêu cầu</p>
                  <ul className="list-disc space-y-1 pl-5">
                    {deliveryRequestPreview.issues.map((issue, index) => <li key={`${index}-${issue}`}>{issue}</li>)}
                  </ul>
                </div>
              )}
              {deliveryRequestPreview.warnings.length > 0 && (
                <div className="space-y-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                  <p className="font-semibold">Cảnh báo cần kiểm tra</p>
                  <ul className="list-disc space-y-1 pl-5">
                    {deliveryRequestPreview.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}
                  </ul>
                  <label className="flex items-start gap-2 pt-1">
                    <input
                      type="checkbox"
                      checked={acknowledgeDeliveryWarnings}
                      onChange={(event) => setAcknowledgeDeliveryWarnings(event.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                    />
                    <span>Tôi đã kiểm tra và xác nhận các cảnh báo trên.</span>
                  </label>
                </div>
              )}
              <div className="max-h-72 overflow-auto rounded-lg border border-gray-200">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50 text-xs uppercase text-gray-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Mã hàng</th>
                      <th className="px-3 py-2 text-right">Cần xuất</th>
                      <th className="px-3 py-2 text-right">Tồn khả dụng</th>
                      <th className="px-3 py-2 text-right">Thiếu</th>
                      <th className="px-3 py-2 text-left">FEFO: vị trí / HSD / SL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {deliveryRequestPreview.items.map((item) => {
                      const plan = deliveryRequestPlan?.find((row) => row.product_id === item.product_id);
                      return (
                        <tr key={item.product_id}>
                          <td className="px-3 py-2">
                            <span className="font-mono font-medium">{item.sku}</span>
                            <span className="ml-2 text-gray-500">{item.product_name}</span>
                          </td>
                          <td className="px-3 py-2 text-right">{item.quantity.toLocaleString("vi-VN")}</td>
                          <td className="px-3 py-2 text-right">{item.available_quantity.toLocaleString("vi-VN")}</td>
                          <td className={`px-3 py-2 text-right font-medium ${item.shortage_quantity > 0 ? "text-red-600" : "text-emerald-700"}`}>
                            {item.shortage_quantity.toLocaleString("vi-VN")}
                          </td>
                          <td className="whitespace-pre-line px-3 py-2 text-xs text-gray-600">
                            {plan?.picks.map((pick) => (
                              `${pick.location_code || "—"} / ${pick.expiry_date ? formatVinamilkDate(pick.expiry_date, false) : "—"} / ${pick.quantity}`
                            )).join("\n") || "Chưa lập kế hoạch"}
                          </td>
                        </tr>
                      );
                    })}
                    {deliveryRequestPreview.items.length === 0 && (
                      <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-500">Không có sản phẩm để xuất.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {deliveryRequestPreview.employee_summaries.some((summary) => summary.is_over_limit) && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Cảnh báo: có NVGH vượt hạn mức công nợ dự kiến; công nợ chỉ được ghi nhận theo quy trình khi thủ kho xác nhận xuất.
                </p>
              )}
            </section>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 pt-4">
            <button
              type="button"
              onClick={() => setIsDeliveryRequestDrawerOpen(false)}
              disabled={isDownloadingDeliveryRequest || isAnalyzingDeliveryRequest || isCreatingDeliveryRequest}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={() => void downloadDeliveryRequestForm()}
              disabled={
                isDownloadingDeliveryRequest ||
                isLoadingDeliveryEmployees ||
                deliveryEmployees.length === 0 ||
                selectedDeliveryOrders.length === 0 ||
                selectedDeliveryOrders.some((order) => (
                  !deliveryEmployeeAssignments[order.order_number] ||
                  !(deliveryOrderStatuses[order.order_number] ?? "001-Xuất hàng")
                ))
              }
              className="flex items-center gap-2 rounded-lg border border-sky-200 bg-white px-4 py-2 text-sm font-medium text-sky-700 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download size={16} />
              {isDownloadingDeliveryRequest ? "Đang tạo file..." : "Tải file Excel"}
            </button>
            <button
              type="button"
              onClick={() => void analyzeDeliveryRequest()}
              disabled={
                isAnalyzingDeliveryRequest ||
                isCreatingDeliveryRequest ||
                isLoadingDeliveryEmployees ||
                selectedDeliveryOrders.length === 0 ||
                !deliveryWarehouseId ||
                selectedDeliveryOrders.some((order) => !deliveryEmployeeAssignments[order.order_number])
              }
              className="flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw size={16} className={isAnalyzingDeliveryRequest ? "animate-spin" : ""} />
              {isAnalyzingDeliveryRequest ? "Đang phân tích..." : "Phân tích tồn kho / FEFO"}
            </button>
            {deliveryRequestPreview && (
              <button
                type="button"
                onClick={() => void submitDeliveryRequest()}
                disabled={
                  isCreatingDeliveryRequest ||
                  isAnalyzingDeliveryRequest ||
                  !deliveryRequestPlan ||
                  !deliveryRequestPreview.can_create ||
                  deliveryRequestPreview.issues.length > 0 ||
                  (deliveryRequestPreview.warnings.length > 0 && !acknowledgeDeliveryWarnings) ||
                  deliveryRequestPreview.items.some((item) => item.shortage_quantity > 0) ||
                  deliveryRequestPlan.some((item) => item.shortage_quantity > 0 || item.planned_quantity !== item.quantity)
                }
                className="flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ClipboardCheck size={16} />
                {isCreatingDeliveryRequest ? "Đang gửi..." : "Xác nhận gửi thủ kho"}
              </button>
            )}
          </div>
        </div>
      </Drawer>

      {/* Drawer Liên kết đơn thay thế thủ công */}
      <Drawer
        open={editingReplacement !== null}
        onClose={() => setEditingReplacement(null)}
        title="Liên kết đơn hàng thay thế"
        subtitle={editingReplacement ? `Đơn mới: ${editingReplacement.newOrderNumber}` : undefined}
      >
        {editingReplacement && (
          <div className="space-y-4 p-5">
            <p className="text-sm text-gray-600">
              Chọn đơn cũ mà đơn mới này thay thế. Cột Thay thế cho đơn sẽ tự động hiển thị TT: (trên đơn mới) và BTT: (trên đơn cũ).
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

      {/* Drawer Tách đơn hàng (Split Order) */}
      <Drawer
        open={isSplitDrawerOpen}
        onClose={() => setIsSplitDrawerOpen(false)}
        title="Tách đơn hàng (Đơn Tách)"
        subtitle="Tách 1 đơn hàng gốc thành nhiều đơn hàng mới với tổng số lượng khớp 100% đơn gốc"
        size="4xl"
      >
        <div className="space-y-5 p-5">
          {splitError && (
            <div className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertTriangle size={16} />
              <span>{splitError}</span>
            </div>
          )}

          {!effectiveIsAdmin && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-2.5 text-xs text-amber-800">
              <Clock3 size={15} className="shrink-0" />
              <span>
                Tài khoản hiện tại chỉ được phép <strong>Tách đơn</strong> đối với các đơn hàng trong ngày hôm nay (
                <strong>{toVinamilkDate(todayInputStr)}</strong>) để tránh tác động vào dữ liệu các ngày cũ. Chỉ tài khoản{" "}
                <strong>Admin</strong> mới có thể tách đơn ngày cũ.
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className="block text-sm text-gray-700">
              1. Tìm đơn hàng cần tách
              <input
                value={splitOrderSearch}
                onChange={(e) => setSplitOrderSearch(e.target.value)}
                placeholder="Tìm mã đơn, tên KH, NVBH..."
                className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm text-gray-700">
              2. Chọn đơn hàng gốc ({filteredSplitOrderOptions.length} đơn khả dụng)
              <select
                value={selectedSplitOrderNumber}
                onChange={(e) => handleSelectSplitOrder(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              >
                <option value="">-- Chọn số đơn hàng --</option>
                {filteredSplitOrderOptions.map((group) => (
                  <option key={group.orderNumber} value={group.orderNumber}>
                    {group.orderNumber} — {group.customerName || group.customerCode} ({group.lines.length} SP, {formatVND(group.totalValue)})
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-gray-700">
              3. Số lượng đơn muốn tách ra (chọn 1 nếu chỉ đổi Mã KH)
              <input
                type="number"
                min={1}
                max={10}
                value={splitCount}
                onChange={(e) => handleChangeSplitCount(Number(e.target.value))}
                className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </label>
          </div>

          {selectedSplitOrderGroup ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-purple-100 bg-purple-50/50 p-3.5 text-xs text-gray-700">
                <div className="space-y-1">
                  <div>
                    <strong>Đơn gốc:</strong> <span className="font-mono text-purple-700">{selectedSplitOrderGroup.orderNumber}</span>
                    {" | "}
                    <strong>Khách hàng gốc:</strong> {selectedSplitOrderGroup.customerName} ({selectedSplitOrderGroup.customerCode})
                    {" | "}
                    <strong>NVBH:</strong> {selectedSplitOrderGroup.staffName}
                  </div>
                  <div>
                    <strong>Tổng đơn gốc:</strong>{" "}
                    Số lượng: <strong>{selectedSplitOrderGroup.totalQty}</strong>
                    {" | "}
                    Số lượng KM: <strong className="text-amber-700">{selectedSplitOrderGroup.totalPromoQty}</strong>
                    {" | "}
                    Giá trị: <strong className="text-emerald-700">{formatVND(selectedSplitOrderGroup.totalValue)}</strong>
                    {" | "}
                    Số tiền CK: <strong className="text-rose-700">{formatVND(selectedSplitOrderGroup.totalDiscount)}</strong>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handleChangeSplitCount(1)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      splitCount === 1
                        ? "border-sky-600 bg-sky-600 text-white"
                        : "border-sky-200 bg-white text-sky-700 hover:bg-sky-50"
                    }`}
                    title="Chuyển toàn bộ đơn hàng sang 1 khách hàng khác (chỉ tạo 1 đơn tách)"
                  >
                    Đổi KH (1 đơn)
                  </button>
                  <button
                    type="button"
                    onClick={resetSplitDiscountsToAuto}
                    className="rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                    title="Tính lại Giá trị & Số tiền CK tự động theo tỷ lệ Số lượng"
                  >
                    Tính lại GT & CK theo SL
                  </button>
                  {splitCount >= 2 && (
                    <>
                      <button
                        type="button"
                        onClick={distributeEvenlyAcrossSplits}
                        className="rounded-lg border border-purple-200 bg-white px-3 py-1.5 text-xs font-medium text-purple-700 hover:bg-purple-50"
                      >
                        Chia đều tự động
                      </button>
                      <button
                        type="button"
                        onClick={fillRemainderToLastSplit}
                        className="rounded-lg border border-purple-300 bg-purple-50 px-3 py-1.5 text-xs font-medium text-purple-800 hover:bg-purple-100"
                      >
                        Điền phần còn lại vào Đơn tách {splitCount}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={assignRemainderToStaffSplit}
                    className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
                    title="Tự động gom phần SL & SL KM còn thiếu vào đơn tách gắn công nợ cho NVBH của đơn"
                  >
                    Tách phần thiếu cho NVBH ({selectedSplitOrderGroup.staffName || selectedSplitOrderGroup.staffCode || "NVBH"})
                  </button>
                </div>
              </div>

              {/* Chọn Mã KH và xem Tổng hợp Giá trị / Số tiền CK cho từng đơn tách */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                  4. Chọn Khách hàng (hoặc gắn Công nợ NVBH) & Tổng hợp theo từng đơn tách
                </h3>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {Array.from({ length: splitCount }, (_, splitIdx) => {
                    const splitOrderCode = `TD-${selectedSplitOrderGroup.orderNumber}-${String(splitIdx + 1).padStart(2, "0")}`;
                    const selectedCust = splitCustomers[splitIdx] ?? {
                      customer_code: selectedSplitOrderGroup.customerCode,
                      customer_name: selectedSplitOrderGroup.customerName,
                      customer_address: selectedSplitOrderGroup.customerAddress,
                      is_staff_debt: false,
                    };
                    const isStaffDebt = Boolean(selectedCust.is_staff_debt);
                    const custSearch = (splitCustomerSearches[splitIdx] ?? "").trim().toLocaleLowerCase("vi");
                    const filteredCustomers = allCustomerOptions
                      .filter((c) => {
                        if (!custSearch) return true;
                        return (
                          c.customer_code.toLocaleLowerCase("vi").includes(custSearch) ||
                          c.customer_name.toLocaleLowerCase("vi").includes(custSearch) ||
                          (c.store_name ?? "").toLocaleLowerCase("vi").includes(custSearch) ||
                          (c.company_name ?? "").toLocaleLowerCase("vi").includes(custSearch)
                        );
                      })
                      .slice(0, 100);
                    const hasSelectedInFiltered = filteredCustomers.some(
                      (c) => c.customer_code === selectedCust.customer_code
                    );
                    const totals = splitFinancials.splitTotals[splitIdx] ?? {
                      lineCount: 0,
                      totalQty: 0,
                      totalPromoQty: 0,
                      totalValue: 0,
                      totalDiscount: 0,
                    };

                    return (
                      <div
                        key={splitIdx}
                        className={`rounded-xl border p-3 shadow-sm space-y-2.5 text-xs ${
                          isStaffDebt
                            ? "border-amber-300 bg-amber-50/30"
                            : "border-purple-200 bg-white"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 border-b border-gray-100 pb-2">
                          <div className="flex items-center gap-1.5">
                            <span className={`font-semibold ${isStaffDebt ? "text-amber-800" : "text-purple-700"}`}>
                              Đơn tách {splitIdx + 1}
                            </span>
                            <span className="font-mono text-[11px] text-gray-500">{splitOrderCode}</span>
                            {isStaffDebt && (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 border border-amber-300">
                                Nợ NVBH
                              </span>
                            )}
                          </div>
                          <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[11px] font-medium text-purple-700">
                            {totals.lineCount} dòng SP
                          </span>
                        </div>

                        <div className="space-y-1.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-medium text-gray-700">
                              Đối tượng nhận đơn tách {splitIdx + 1}:
                            </span>
                            <div className="flex items-center gap-2">
                              {!isStaffDebt ? (
                                <button
                                  type="button"
                                  onClick={() => handleSetSplitToStaffDebt(splitIdx)}
                                  className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 hover:bg-amber-100"
                                >
                                  Gắn Công nợ NVBH
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleSelectSplitCustomer(splitIdx, selectedSplitOrderGroup.customerCode)
                                  }
                                  className="rounded border border-purple-200 bg-white px-2 py-0.5 text-[11px] font-medium text-purple-700 hover:bg-purple-50"
                                >
                                  Chuyển về Khách hàng
                                </button>
                              )}
                              {!isStaffDebt && selectedCust.customer_code !== selectedSplitOrderGroup.customerCode && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleSelectSplitCustomer(splitIdx, selectedSplitOrderGroup.customerCode)
                                  }
                                  className="text-[11px] text-purple-600 hover:underline"
                                >
                                  Đặt lại KH gốc
                                </button>
                              )}
                            </div>
                          </div>

                          {isStaffDebt ? (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900 space-y-1">
                              <div className="font-semibold">
                                Gắn trách nhiệm / Công nợ NVBH:{" "}
                                {selectedSplitOrderGroup.staffName || "Nhân viên"} (
                                {selectedSplitOrderGroup.staffCode || "NVBH"})
                              </div>
                              <div className="text-[11px] text-amber-700">
                                Phần hàng thiếu chưa giao/tách cho khách sẽ được tạo thành đơn riêng gắn cho NVBH này.
                              </div>
                            </div>
                          ) : (
                            <>
                              <input
                                type="text"
                                value={splitCustomerSearches[splitIdx] ?? ""}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setSplitCustomerSearches((prev) => {
                                    const next = [...prev];
                                    next[splitIdx] = val;
                                    return next;
                                  });
                                }}
                                placeholder="Tìm Mã KH, Tên KH, Cửa hàng..."
                                className="block w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs focus:border-purple-500 focus:outline-none"
                              />
                              <select
                                value={selectedCust.customer_code}
                                onChange={(e) => handleSelectSplitCustomer(splitIdx, e.target.value)}
                                className="block w-full rounded-lg border border-gray-200 bg-gray-50/70 px-2.5 py-1.5 text-xs font-medium text-gray-800 focus:border-purple-500 focus:outline-none"
                              >
                                {!hasSelectedInFiltered && selectedCust.customer_code && (
                                  <option value={selectedCust.customer_code}>
                                    {selectedCust.customer_code} ({selectedCust.customer_code.slice(-3)}) — {selectedCust.customer_name || "Khách hàng hiện tại"}
                                  </option>
                                )}
                                {filteredCustomers.map((c) => (
                                  <option key={c.customer_code} value={c.customer_code}>
                                    {c.customer_code} ({c.customer_code.slice(-3)}) — {c.customer_name}
                                    {c.company_name ? ` [${c.company_name}]` : ""}
                                  </option>
                                ))}
                              </select>
                              <div className="text-[11px] text-gray-500 truncate">
                                Đang chọn: <strong className="text-gray-800">{selectedCust.customer_code}</strong> —{" "}
                                <span className="text-gray-700">{selectedCust.customer_name}</span>
                              </div>
                            </>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-2 text-[11px]">
                          <div className="flex items-center justify-between pr-2 border-r border-gray-200/70">
                            <span className="text-gray-500">Số lượng:</span>
                            <strong className="text-gray-900">{totals.totalQty}</strong>
                          </div>
                          <div className="flex items-center justify-between pl-1">
                            <span className="text-amber-700 font-medium">Số lượng KM:</span>
                            <strong className="text-amber-700">{totals.totalPromoQty}</strong>
                          </div>
                          <div className="flex items-center justify-between gap-1.5 pr-2 border-t border-r border-gray-200/70 pt-1">
                            <span className="font-medium text-gray-600">Tổng giá trị:</span>
                            <input
                              type="number"
                              min={0}
                              step={1}
                              value={totals.totalValue}
                              onChange={(e) =>
                                updateSplitOrderTotalValue(splitIdx, Number(e.target.value))
                              }
                              title="Có thể chỉnh sửa Tổng giá trị của đơn tách này"
                              className="w-28 rounded border border-emerald-200 bg-white px-2 py-0.5 text-right text-xs font-semibold text-emerald-700 focus:border-emerald-500 focus:outline-none"
                            />
                          </div>
                          <div className="flex items-center justify-between gap-1.5 border-t border-gray-200/70 pt-1 pl-1">
                            <span className="text-gray-500">Số tiền CK:</span>
                            {selectedSplitOrderGroup.totalDiscount > 0 ? (
                              <input
                                type="number"
                                min={0}
                                step={1}
                                value={totals.totalDiscount}
                                onChange={(e) =>
                                  updateSplitOrderTotalDiscount(splitIdx, Number(e.target.value))
                                }
                                title="Có thể chỉnh sửa tổng Số tiền CK của đơn tách này"
                                className="w-24 rounded border border-rose-200 bg-white px-2 py-0.5 text-right text-xs font-semibold text-rose-700 focus:border-rose-500 focus:outline-none"
                              />
                            ) : (
                              <strong className="text-rose-700">{formatVND(totals.totalDiscount)}</strong>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="min-w-full divide-y divide-gray-200 text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th rowSpan={2} className="px-3 py-2.5 text-left font-semibold text-gray-700 border-r border-gray-200">
                        Sản phẩm
                      </th>
                      <th rowSpan={2} className="px-2 py-2.5 text-center font-semibold text-gray-700 border-r border-gray-200">
                        ĐVT
                      </th>
                      <th colSpan={2} className="px-2.5 py-1.5 text-center font-semibold text-gray-700 border-b border-r border-gray-200 bg-gray-100/70">
                        Đơn gốc
                      </th>
                      {Array.from({ length: splitCount }, (_, idx) => {
                        const cust = splitCustomers[idx];
                        const isStaffDebt = Boolean(cust?.is_staff_debt);
                        return (
                          <th
                            key={idx}
                            colSpan={2}
                            className={`px-2.5 py-1.5 text-center font-semibold border-b border-r border-gray-200 ${
                              isStaffDebt
                                ? "text-amber-800 bg-amber-50/70"
                                : "text-purple-700 bg-purple-50/40"
                            }`}
                          >
                            <div>
                              Đơn tách {idx + 1} {isStaffDebt ? "(Nợ NVBH)" : ""}
                            </div>
                            <div className="text-[10px] font-normal text-gray-500">
                              TD-{selectedSplitOrderGroup.orderNumber}-{String(idx + 1).padStart(2, "0")}
                            </div>
                            {cust?.customer_code && (
                              <div
                                className={`text-[10px] font-medium truncate max-w-[180px] mx-auto ${
                                  isStaffDebt ? "text-amber-700" : "text-purple-600"
                                }`}
                                title={`${cust.customer_code} - ${cust.customer_name}`}
                              >
                                {isStaffDebt
                                  ? `NVBH: ${selectedSplitOrderGroup.staffName || selectedSplitOrderGroup.staffCode}`
                                  : `KH: ${cust.customer_code.slice(-3)} — ${cust.customer_name}`}
                              </div>
                            )}
                          </th>
                        );
                      })}
                      <th colSpan={2} className="px-2.5 py-1.5 text-center font-semibold text-gray-700 border-b border-gray-200 bg-gray-100/70">
                        Còn lại (Chưa tách)
                      </th>
                    </tr>
                    <tr className="bg-gray-50/90 text-[11px]">
                      <th className="px-2 py-1.5 text-right font-semibold text-gray-700 border-r border-gray-200">
                        Số lượng
                      </th>
                      <th className="px-2 py-1.5 text-right font-semibold text-amber-700 border-r border-gray-200 bg-amber-50/30">
                        Số lượng KM
                      </th>
                      {Array.from({ length: splitCount }, (_, idx) => (
                        <Fragment key={`sub-${idx}`}>
                          <th className="px-2 py-1.5 text-right font-semibold text-gray-700 border-r border-gray-100">
                            Số lượng
                          </th>
                          <th className="px-2 py-1.5 text-right font-semibold text-amber-700 border-r border-gray-200 bg-amber-50/20">
                            Số lượng KM
                          </th>
                        </Fragment>
                      ))}
                      <th className="px-2 py-1.5 text-right font-semibold text-gray-700 border-r border-gray-100">
                        Số lượng
                      </th>
                      <th className="px-2 py-1.5 text-right font-semibold text-amber-700 bg-amber-50/30">
                        Số lượng KM
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {selectedSplitOrderGroup.lines.map((line) => {
                      const localId = Number(line["_local_id"]);
                      const prodCode = displayRemoteValue(line["Mã sản phẩm"]);
                      const prodName = displayRemoteValue(line["Sản phẩm"]);
                      const promoCode = displayRemoteValue(line["Mã CTKM"]);
                      const unit = displayRemoteValue(line["ĐVT"]);
                      const origQty = numericValue(line["Số lượng"]);
                      const origPromo = numericValue(line["Số lượng KM"]);
                      const origVal = numericValue(line["Giá trị"]);
                      const origDisc = numericValue(line["Số tiền CK"]);
                      const allocs = splitAllocs[localId] ?? [];
                      const finRow = splitFinancials.lineBreakdown[localId] ?? [];
                      const sumQty = allocs.reduce((s, a) => s + a.quantity, 0);
                      const sumPromo = allocs.reduce((s, a) => s + a.promoQuantity, 0);
                      const sumVal = finRow.reduce((s, f) => s + f.value, 0);
                      const sumDisc = finRow.reduce((s, f) => s + f.discount, 0);
                      const remQty = Number((origQty - sumQty).toFixed(4));
                      const remPromo = Number((origPromo - sumPromo).toFixed(4));
                      const remVal = Math.round(origVal - sumVal);
                      const remDisc = Math.round(origDisc - sumDisc);

                      return (
                        <tr key={localId} className="hover:bg-gray-50/60">
                          <td className="px-3 py-2 align-top border-r border-gray-100">
                            <div className="font-medium text-gray-900">{prodCode} — {prodName}</div>
                            {promoCode && <div className="text-[11px] text-gray-500">CTKM: {promoCode}</div>}
                            <div className="text-[11px] text-emerald-700">
                              Giá trị gốc: {formatVND(origVal)}
                              {origDisc > 0 ? ` | CK gốc: ${formatVND(origDisc)}` : ""}
                            </div>
                          </td>
                          <td className="px-2 py-2 text-center align-middle text-gray-600 border-r border-gray-100">
                            {unit}
                          </td>
                          <td className="px-2.5 py-2 text-right align-middle font-semibold text-gray-900 border-r border-gray-100">
                            {origQty}
                          </td>
                          <td className="px-2.5 py-2 text-right align-middle font-semibold text-amber-700 border-r border-gray-200 bg-amber-50/20">
                            {origPromo}
                          </td>
                          {Array.from({ length: splitCount }, (_, splitIdx) => {
                            const cell = allocs[splitIdx] ?? { quantity: 0, promoQuantity: 0 };
                            const cellFin = finRow[splitIdx] ?? { value: 0, discount: 0, autoDiscount: 0 };
                            const isStaffDebt = Boolean(splitCustomers[splitIdx]?.is_staff_debt);
                            return (
                              <Fragment key={splitIdx}>
                                <td
                                  className={`px-2 py-2 align-top border-r border-gray-100 ${
                                    isStaffDebt ? "bg-amber-50/20" : "bg-purple-50/10"
                                  }`}
                                >
                                  <div className="flex flex-col items-end gap-1">
                                    <input
                                      type="number"
                                      min={0}
                                      step="any"
                                      value={cell.quantity}
                                      onChange={(e) =>
                                        updateSplitCell(localId, splitIdx, "quantity", Number(e.target.value))
                                      }
                                      className="w-20 rounded border border-gray-200 bg-white px-2 py-1 text-right text-xs font-medium text-gray-900 focus:border-purple-500 focus:outline-none"
                                    />
                                    {(cell.quantity > 0 || cell.promoQuantity > 0) && (
                                      <div className="w-full rounded bg-white/90 px-1.5 py-1 text-[10px] leading-tight border border-purple-100 space-y-1">
                                        <label className="flex items-center justify-between gap-1 text-emerald-700 font-medium">
                                          <span>GT:</span>
                                          <input
                                            type="number"
                                            min={0}
                                            step={1}
                                            value={cellFin.value}
                                            onChange={(e) =>
                                              updateSplitCellValue(
                                                localId,
                                                splitIdx,
                                                Number(e.target.value)
                                              )
                                            }
                                            title="Chỉnh sửa Giá trị của dòng sản phẩm này"
                                            className="w-20 rounded border border-emerald-200 bg-emerald-50/20 px-1 py-0.5 text-right text-[10px] font-semibold text-emerald-800 focus:border-emerald-500 focus:outline-none"
                                          />
                                        </label>
                                        {selectedSplitOrderGroup.totalDiscount > 0 && (
                                          <label className="flex items-center justify-between gap-1 text-rose-700">
                                            <span>CK:</span>
                                            <input
                                              type="number"
                                              min={0}
                                              step={1}
                                              value={cellFin.discount}
                                              onChange={(e) =>
                                                updateSplitCellDiscount(
                                                  localId,
                                                  splitIdx,
                                                  Number(e.target.value)
                                                )
                                              }
                                              className="w-20 rounded border border-rose-200 bg-rose-50/20 px-1 py-0.5 text-right text-[10px] font-medium text-rose-800 focus:border-rose-500 focus:outline-none"
                                            />
                                          </label>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </td>
                                <td
                                  className={`px-2 py-2 align-top border-r border-gray-200 ${
                                    isStaffDebt ? "bg-amber-50/30" : "bg-amber-50/15"
                                  }`}
                                >
                                  <div className="flex flex-col items-end">
                                    <input
                                      type="number"
                                      min={0}
                                      step="any"
                                      value={cell.promoQuantity}
                                      onChange={(e) =>
                                        updateSplitCell(localId, splitIdx, "promoQuantity", Number(e.target.value))
                                      }
                                      className="w-20 rounded border border-amber-200 bg-white px-2 py-1 text-right text-xs font-medium text-amber-900 focus:border-amber-500 focus:outline-none"
                                    />
                                  </div>
                                </td>
                              </Fragment>
                            );
                          })}
                          <td className="px-2 py-2 text-right align-middle border-r border-gray-100">
                            <span
                              className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${
                                Math.abs(remQty) <= 1e-4
                                  ? "bg-emerald-50 text-emerald-700"
                                  : remQty > 0
                                    ? "bg-amber-50 text-amber-800"
                                    : "bg-rose-50 text-rose-700"
                              }`}
                            >
                              {remQty}
                            </span>
                            {Math.abs(remVal) > 1 && (
                              <div className="mt-1 text-[10px] font-medium text-emerald-700">
                                GT: {formatVND(remVal)}
                              </div>
                            )}
                            {Math.abs(remDisc) > 1 && (
                              <div className="mt-0.5 text-[10px] font-medium text-rose-700">
                                CK: {formatVND(remDisc)}
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-2 text-right align-middle bg-amber-50/20">
                            <span
                              className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${
                                Math.abs(remPromo) <= 1e-4
                                  ? "bg-emerald-50 text-emerald-700"
                                  : remPromo > 0
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-rose-50 text-rose-700"
                              }`}
                            >
                              {remPromo}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-gray-50 font-semibold text-gray-900 border-t border-gray-200">
                    <tr>
                      <td colSpan={2} className="px-3 py-2.5 text-right align-top border-r border-gray-200">
                        <div>Tổng cộng:</div>
                        <div className="text-[11px] font-normal text-emerald-700">
                          GT gốc: {formatVND(selectedSplitOrderGroup.totalValue)}
                        </div>
                        <div className="text-[11px] font-normal text-rose-700">
                          CK gốc: {formatVND(selectedSplitOrderGroup.totalDiscount)}
                        </div>
                      </td>
                      <td className="px-2.5 py-2.5 text-right align-top border-r border-gray-200">
                        {selectedSplitOrderGroup.totalQty}
                      </td>
                      <td className="px-2.5 py-2.5 text-right align-top text-amber-700 border-r border-gray-200 bg-amber-50/30">
                        {selectedSplitOrderGroup.totalPromoQty}
                      </td>
                      {Array.from({ length: splitCount }, (_, splitIdx) => {
                        const totals = splitFinancials.splitTotals[splitIdx] ?? {
                          totalQty: 0,
                          totalPromoQty: 0,
                          totalValue: 0,
                          totalDiscount: 0,
                        };
                        return (
                          <Fragment key={`foot-${splitIdx}`}>
                            <td className="px-2 py-2.5 text-right align-top bg-purple-50/30 border-r border-gray-100">
                              <div className="text-gray-900">{totals.totalQty}</div>
                              <div className="text-[11px] text-emerald-700">
                                GT: {formatVND(totals.totalValue)}
                              </div>
                              <div className="text-[11px] text-rose-700">
                                CK: {formatVND(totals.totalDiscount)}
                              </div>
                            </td>
                            <td className="px-2 py-2.5 text-right align-top text-amber-700 bg-amber-50/25 border-r border-gray-200">
                              {totals.totalPromoQty}
                            </td>
                          </Fragment>
                        );
                      })}
                      <td className="px-2 py-2.5 text-right align-top border-r border-gray-100">
                        <div>
                          {Number(
                            (
                              selectedSplitOrderGroup.totalQty -
                              splitFinancials.splitTotals.reduce((s, t) => s + t.totalQty, 0)
                            ).toFixed(4)
                          )}
                        </div>
                        <div className="text-[11px] text-emerald-700">
                          ∑GT: {formatVND(splitFinancials.splitTotals.reduce((s, t) => s + t.totalValue, 0))}
                        </div>
                        <div className="text-[11px] text-rose-700">
                          ∑CK: {formatVND(splitFinancials.splitTotals.reduce((s, t) => s + t.totalDiscount, 0))}
                        </div>
                      </td>
                      <td className="px-2 py-2.5 text-right align-top text-amber-700 bg-amber-50/30">
                        {Number(
                          (
                            selectedSplitOrderGroup.totalPromoQty -
                            splitFinancials.splitTotals.reduce((s, t) => s + t.totalPromoQty, 0)
                          ).toFixed(4)
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-gray-100 pt-4">
                <div className="text-xs text-amber-800">
                  * Khi gửi yêu cầu, đơn tách sẽ chuyển sang trạng thái <strong>Chờ Kế toán xác nhận</strong> trước khi chính thức tách trên hệ thống DMS nội bộ.
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsSplitDrawerOpen(false)}
                    disabled={isSubmittingSplit}
                    className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
                  >
                    Hủy
                  </button>
                  <button
                    type="button"
                    onClick={() => void submitSplitOrder()}
                    disabled={isSubmittingSplit}
                    className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
                  >
                    <Split size={16} />
                    {isSubmittingSplit ? "Đang gửi yêu cầu..." : "Gửi Kế toán duyệt tách đơn"}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-500">
              Chọn một đơn hàng ở trên để bắt đầu phân bổ số lượng tách đơn.
            </div>
          )}
        </div>
      </Drawer>

      {/* Drawer Kế toán xác nhận duyệt Tách đơn */}
      <Drawer
        open={isSplitApprovalDrawerOpen}
        onClose={() => setIsSplitApprovalDrawerOpen(false)}
        title="Kế toán xác nhận Tách đơn hàng"
        subtitle="Kiểm tra chi tiết số lượng, số lượng KM, giá trị, chiết khấu và công nợ NVBH trước khi duyệt tách đơn trên hệ thống DMS nội bộ"
        size="4xl"
      >
        <div className="space-y-4 p-5">
          {splitApprovalError && (
            <div className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertTriangle size={16} />
              <span>{splitApprovalError}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setSplitApprovalFilter("PENDING");
                  void loadSplitApprovalRequests("PENDING");
                }}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  splitApprovalFilter === "PENDING"
                    ? "bg-amber-600 text-white"
                    : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                Chờ Kế toán duyệt ({pendingSplitRequestCount})
              </button>
              <button
                type="button"
                onClick={() => {
                  setSplitApprovalFilter("ALL");
                  void loadSplitApprovalRequests("ALL");
                }}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  splitApprovalFilter === "ALL"
                    ? "bg-purple-600 text-white"
                    : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                Tất cả lịch sử yêu cầu
              </button>
            </div>
            <button
              type="button"
              onClick={() => void loadSplitApprovalRequests(splitApprovalFilter)}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <RefreshCw size={13} />
              Làm mới
            </button>
          </div>

          {splitApprovalRequests.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-10 text-center text-sm text-gray-500">
              {splitApprovalFilter === "PENDING"
                ? "Hiện không có yêu cầu tách đơn nào đang chờ Kế toán xác nhận."
                : "Chưa có yêu cầu tách đơn nào."}
            </div>
          ) : (
            <div className="space-y-4">
              {splitApprovalRequests.map((reqItem) => {
                const p = reqItem.preview ?? {};
                const splits = Array.isArray(p.splits) ? p.splits : [];
                const isPending = reqItem.status === "PENDING";
                const isApproved = reqItem.status === "APPROVED";
                const isProcessing = processingSplitRequestId === reqItem.id;
                return (
                  <div
                    key={reqItem.id}
                    className={`rounded-xl border p-4 shadow-sm space-y-3 text-xs ${
                      isPending
                        ? "border-amber-300 bg-amber-50/20"
                        : isApproved
                          ? "border-emerald-200 bg-white"
                          : "border-rose-200 bg-rose-50/10"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 pb-2.5">
                      <div className="space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-bold text-gray-900">
                            YC #{reqItem.id} — Đơn gốc: {reqItem.source_order_number}
                          </span>
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                              isPending
                                ? "bg-amber-100 text-amber-800 border border-amber-300"
                                : isApproved
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-rose-100 text-rose-800"
                            }`}
                          >
                            {isPending
                              ? "Chờ Kế toán xác nhận"
                              : isApproved
                                ? "Đã duyệt & Tách đơn"
                                : "Đã từ chối"}
                          </span>
                        </div>
                        <div className="text-gray-600">
                          <strong>Khách hàng gốc:</strong> {p.customer_name || "—"} ({p.customer_code || "—"})
                          {" | "}
                          <strong>NVBH:</strong> {p.staff_name || p.staff_code || "—"}
                          {" | "}
                          <strong>Người yêu cầu:</strong>{" "}
                          <span className="font-semibold text-sky-700">{reqItem.requested_by}</span>
                          {reqItem.requested_at && ` (${formatVinamilkDate(reqItem.requested_at, true)})`}
                        </div>
                        {reqItem.reviewed_by && (
                          <div className="text-gray-600">
                            <strong>Kế toán xử lý:</strong>{" "}
                            <span className="font-semibold text-emerald-700">{reqItem.reviewed_by}</span>
                            {reqItem.reviewed_at && ` (${formatVinamilkDate(reqItem.reviewed_at, true)})`}
                            {reqItem.rejection_reason && (
                              <span className="ml-2 text-rose-700">
                                — Lý do: <strong>{reqItem.rejection_reason}</strong>
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {isPending && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={isProcessing}
                            onClick={() => void handleRejectSplitRequest(reqItem)}
                            className="flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                          >
                            <XCircle size={14} />
                            Từ chối
                          </button>
                          <button
                            type="button"
                            disabled={isProcessing}
                            onClick={() => void handleApproveSplitRequest(reqItem)}
                            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            <CheckCircle2 size={14} />
                            {isProcessing ? "Đang xử lý..." : "Kế toán Xác nhận & Tách đơn"}
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-4 rounded-lg bg-gray-100/80 px-3 py-1.5 text-[11px] text-gray-700">
                      <span>
                        <strong>Tổng đơn gốc:</strong> SL: <strong>{p.total_qty ?? 0}</strong>
                      </span>
                      <span>
                        SL KM: <strong className="text-amber-700">{p.total_promo_qty ?? 0}</strong>
                      </span>
                      <span>
                        Giá trị: <strong className="text-emerald-700">{formatVND(Number(p.total_value ?? 0))}</strong>
                      </span>
                      <span>
                        Số tiền CK: <strong className="text-rose-700">{formatVND(Number(p.total_discount ?? 0))}</strong>
                      </span>
                      <span>
                        Số đơn tách ra: <strong className="text-purple-700">{splits.length} đơn</strong>
                      </span>
                    </div>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {splits.map((sp, sIdx) => {
                        const isStaffDebt = Boolean(sp.is_staff_debt);
                        return (
                          <div
                            key={sIdx}
                            className={`rounded-lg border p-2.5 space-y-2 ${
                              isStaffDebt
                                ? "border-amber-300 bg-amber-50/40"
                                : "border-gray-200 bg-white"
                            }`}
                          >
                            <div className="flex items-center justify-between border-b border-gray-100 pb-1.5">
                              <div>
                                <span className="font-mono font-bold text-purple-700">
                                  {sp.new_order_number}
                                </span>
                                <span
                                  className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                    isStaffDebt
                                      ? "bg-amber-100 text-amber-800 border border-amber-300"
                                      : "bg-purple-50 text-purple-700"
                                  }`}
                                >
                                  {sp.status_label}
                                </span>
                              </div>
                              <div className="text-[11px] text-gray-600">
                                SL: <strong>{sp.total_qty}</strong> | KM:{" "}
                                <strong className="text-amber-700">{sp.total_promo_qty}</strong>
                              </div>
                            </div>
                            <div className="text-[11px] text-gray-700">
                              <strong>Đối tượng nhận:</strong> {sp.customer_code} — {sp.customer_name}
                            </div>
                            <div className="flex items-center justify-between rounded bg-gray-50 px-2 py-1 text-[11px]">
                              <span>
                                Giá trị:{" "}
                                <strong className="text-emerald-700">
                                  {formatVND(Number(sp.total_value ?? 0))}
                                </strong>
                              </span>
                              <span>
                                Chiết khấu:{" "}
                                <strong className="text-rose-700">
                                  {formatVND(Number(sp.total_discount ?? 0))}
                                </strong>
                              </span>
                            </div>
                            <div className="overflow-x-auto">
                              <table className="min-w-full divide-y divide-gray-100 text-[11px]">
                                <thead className="bg-gray-50 text-gray-600">
                                  <tr>
                                    <th className="px-2 py-1 text-left">Sản phẩm</th>
                                    <th className="px-1.5 py-1 text-right">SL</th>
                                    <th className="px-1.5 py-1 text-right text-amber-700">SL KM</th>
                                    <th className="px-1.5 py-1 text-right text-emerald-700">Giá trị</th>
                                    <th className="px-1.5 py-1 text-right text-rose-700">CK</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                  {(sp.items ?? []).map((item, iIdx) => (
                                    <tr key={iIdx}>
                                      <td className="px-2 py-1 text-gray-800">
                                        <span className="font-mono font-medium">{item.product_code}</span> —{" "}
                                        {item.product_name}
                                      </td>
                                      <td className="px-1.5 py-1 text-right font-semibold">{item.quantity}</td>
                                      <td className="px-1.5 py-1 text-right font-semibold text-amber-700">
                                        {item.promo_quantity}
                                      </td>
                                      <td className="px-1.5 py-1 text-right text-emerald-700">
                                        {formatVND(Number(item.value_amount ?? 0))}
                                      </td>
                                      <td className="px-1.5 py-1 text-right text-rose-700">
                                        {formatVND(Number(item.discount_amount ?? 0))}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Drawer>

      {/* Drawer Gộp đơn hàng (Merge Orders) */}
      <Drawer
        open={isMergeDrawerOpen}
        onClose={() => setIsMergeDrawerOpen(false)}
        title="Gộp đơn hàng (Đơn Gộp)"
        subtitle="Chọn từ 2 đơn hàng trở lên để tự động tổng hợp sản phẩm, số lượng, số lượng KM và giá trị thành 1 đơn mới"
        size="4xl"
      >
        <div className="space-y-5 p-5">
          {mergeError && (
            <div className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertTriangle size={16} />
              <span>{mergeError}</span>
            </div>
          )}

          {!effectiveIsAdmin && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-2.5 text-xs text-amber-800">
              <Clock3 size={15} className="shrink-0" />
              <span>
                Tài khoản hiện tại chỉ được phép <strong>Gộp đơn</strong> đối với các đơn hàng trong ngày hôm nay (
                <strong>{toVinamilkDate(todayInputStr)}</strong>) để tránh tác động vào dữ liệu các ngày cũ. Chỉ tài khoản{" "}
                <strong>Admin</strong> mới có thể gộp đơn ngày cũ.
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="block text-sm text-gray-700">
              Tìm kiếm đơn hàng để gộp
              <input
                value={mergeOrderSearch}
                onChange={(e) => setMergeOrderSearch(e.target.value)}
                placeholder="Nhập số đơn hàng, tên KH, NVBH..."
                className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </label>
            {selectedMergeOrderNumbers.length >= 2 && (
              <label className="block text-sm text-gray-700">
                Đơn đại diện lấy thông tin chung (Ngày đơn, mặc định KH & NVBH)
                <select
                  value={representativeOrderNumber || selectedMergeOrderNumbers[0]}
                  onChange={(e) => setRepresentativeOrderNumber(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                >
                  {selectedMergeGroups.map((g) => (
                    <option key={g.orderNumber} value={g.orderNumber}>
                      {g.orderNumber} — KH: {g.customerName || g.customerCode} — NVBH: {g.staffName}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {selectedMergeOrderNumbers.length >= 2 && selectedRepresentativeMergeGroup && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/30 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-semibold text-indigo-950">
                    Tùy chọn thay đổi thông tin đại diện cho Đơn Gộp (Khách hàng & NVBH khác với các đơn gộp)
                  </h4>
                  <p className="text-[11px] text-gray-600">
                    Mặc định lấy theo đơn đại diện{" "}
                    <strong className="font-mono">{selectedRepresentativeMergeGroup.orderNumber}</strong>:{" "}
                    KH <strong>{selectedRepresentativeMergeGroup.customerCode}</strong> (
                    {selectedRepresentativeMergeGroup.customerName || "—"}) | NVBH:{" "}
                    <strong>
                      {selectedRepresentativeMergeGroup.staffName ||
                        selectedRepresentativeMergeGroup.staffCode ||
                        "—"}
                    </strong>
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {/* Cột 1: Tùy chọn đổi Khách hàng đại diện */}
                <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-2.5 text-xs">
                  <label className="flex cursor-pointer items-center justify-between gap-2 font-semibold text-gray-800">
                    <span>Thay đổi Mã / Tên Khách hàng khác</span>
                    <input
                      type="checkbox"
                      checked={mergeOverrideCustomer}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setMergeOverrideCustomer(checked);
                        if (checked && !mergeCustomCustomer.customer_code) {
                          setMergeCustomCustomer({
                            customer_code: selectedRepresentativeMergeGroup.customerCode,
                            customer_name: selectedRepresentativeMergeGroup.customerName,
                            customer_address: selectedRepresentativeMergeGroup.customerAddress,
                          });
                        }
                      }}
                      className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  </label>

                  {!mergeOverrideCustomer ? (
                    <div className="rounded bg-gray-50 px-2.5 py-2 text-[11px] text-gray-600">
                      Giữ theo đơn đại diện:{" "}
                      <strong className="text-gray-900">
                        {selectedRepresentativeMergeGroup.customerCode} —{" "}
                        {selectedRepresentativeMergeGroup.customerName}
                      </strong>
                      {selectedRepresentativeMergeGroup.customerAddress && (
                        <div className="mt-0.5 text-gray-500">
                          Đ/c: {selectedRepresentativeMergeGroup.customerAddress}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2 pt-1">
                      <input
                        value={mergeCustomerSearch}
                        onChange={(e) => setMergeCustomerSearch(e.target.value)}
                        placeholder="Tìm nhanh theo Mã KH, Tên KH, Cửa hàng..."
                        className="block w-full rounded border border-gray-200 px-2.5 py-1.5 text-xs focus:border-indigo-500 focus:outline-none"
                      />
                      <select
                        value={mergeCustomCustomer.customer_code}
                        onChange={(e) => handleSelectMergeCustomer(e.target.value)}
                        className="block w-full rounded border border-indigo-200 bg-indigo-50/20 px-2.5 py-1.5 text-xs font-medium text-gray-900 focus:border-indigo-500 focus:outline-none"
                      >
                        <option value="">-- Chọn khách hàng từ danh mục --</option>
                        {allCustomerOptions
                          .filter((opt) => {
                            const q = mergeCustomerSearch.trim().toLocaleLowerCase("vi");
                            if (!q) return true;
                            return (
                              opt.customer_code.toLocaleLowerCase("vi").includes(q) ||
                              opt.customer_name.toLocaleLowerCase("vi").includes(q) ||
                              (opt.store_name ?? "").toLocaleLowerCase("vi").includes(q)
                            );
                          })
                          .slice(0, 150)
                          .map((opt) => (
                            <option key={opt.customer_code} value={opt.customer_code}>
                              {opt.customer_code} — {opt.customer_name}
                              {opt.store_name ? ` (${opt.store_name})` : ""}
                            </option>
                          ))}
                      </select>
                      <div className="grid grid-cols-3 gap-2">
                        <label className="col-span-1 block text-[11px] text-gray-600">
                          Mã KH mới
                          <input
                            value={mergeCustomCustomer.customer_code}
                            onChange={(e) =>
                              setMergeCustomCustomer((prev) => ({
                                ...prev,
                                customer_code: e.target.value,
                              }))
                            }
                            placeholder="Mã KH..."
                            className="mt-0.5 block w-full rounded border border-gray-200 px-2 py-1 text-xs font-mono text-gray-900"
                          />
                        </label>
                        <label className="col-span-2 block text-[11px] text-gray-600">
                          Tên KH mới
                          <input
                            value={mergeCustomCustomer.customer_name}
                            onChange={(e) =>
                              setMergeCustomCustomer((prev) => ({
                                ...prev,
                                customer_name: e.target.value,
                              }))
                            }
                            placeholder="Tên khách hàng..."
                            className="mt-0.5 block w-full rounded border border-gray-200 px-2 py-1 text-xs text-gray-900"
                          />
                        </label>
                      </div>
                      <label className="block text-[11px] text-gray-600">
                        Địa chỉ giao hàng
                        <input
                          value={mergeCustomCustomer.customer_address}
                          onChange={(e) =>
                            setMergeCustomCustomer((prev) => ({
                              ...prev,
                              customer_address: e.target.value,
                            }))
                          }
                          placeholder="Địa chỉ khách hàng..."
                          className="mt-0.5 block w-full rounded border border-gray-200 px-2 py-1 text-xs text-gray-900"
                        />
                      </label>
                    </div>
                  )}
                </div>

                {/* Cột 2: Tùy chọn đổi NVBH đại diện */}
                <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-2.5 text-xs">
                  <label className="flex cursor-pointer items-center justify-between gap-2 font-semibold text-gray-800">
                    <span>Thay đổi NVBH đại diện khác</span>
                    <input
                      type="checkbox"
                      checked={mergeOverrideStaff}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setMergeOverrideStaff(checked);
                        if (checked && !mergeCustomStaff.staff_code && !mergeCustomStaff.staff_name) {
                          setMergeCustomStaff({
                            staff_code: selectedRepresentativeMergeGroup.staffCode,
                            staff_name: selectedRepresentativeMergeGroup.staffName,
                          });
                        }
                      }}
                      className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  </label>

                  {!mergeOverrideStaff ? (
                    <div className="rounded bg-gray-50 px-2.5 py-2 text-[11px] text-gray-600">
                      Giữ theo đơn đại diện:{" "}
                      <strong className="text-gray-900">
                        {selectedRepresentativeMergeGroup.staffCode
                          ? `${selectedRepresentativeMergeGroup.staffCode} — `
                          : ""}
                        {selectedRepresentativeMergeGroup.staffName || "—"}
                      </strong>
                    </div>
                  ) : (
                    <div className="space-y-2 pt-1">
                      <input
                        value={mergeStaffSearch}
                        onChange={(e) => setMergeStaffSearch(e.target.value)}
                        placeholder="Tìm nhanh theo Mã NVBH hoặc Tên NVBH..."
                        className="block w-full rounded border border-gray-200 px-2.5 py-1.5 text-xs focus:border-indigo-500 focus:outline-none"
                      />
                      <select
                        value={mergeCustomStaff.staff_code}
                        onChange={(e) => handleSelectMergeStaff(e.target.value)}
                        className="block w-full rounded border border-indigo-200 bg-indigo-50/20 px-2.5 py-1.5 text-xs font-medium text-gray-900 focus:border-indigo-500 focus:outline-none"
                      >
                        <option value="">-- Chọn NVBH từ danh sách --</option>
                        {allStaffOptions
                          .filter((opt) => {
                            const q = mergeStaffSearch.trim().toLocaleLowerCase("vi");
                            if (!q) return true;
                            return (
                              opt.staff_code.toLocaleLowerCase("vi").includes(q) ||
                              opt.staff_name.toLocaleLowerCase("vi").includes(q)
                            );
                          })
                          .slice(0, 150)
                          .map((opt) => (
                            <option key={opt.staff_code} value={opt.staff_code}>
                              {opt.staff_code} — {opt.staff_name}
                            </option>
                          ))}
                      </select>
                      <div className="grid grid-cols-3 gap-2">
                        <label className="col-span-1 block text-[11px] text-gray-600">
                          Mã NVBH mới
                          <input
                            value={mergeCustomStaff.staff_code}
                            onChange={(e) =>
                              setMergeCustomStaff((prev) => ({
                                ...prev,
                                staff_code: e.target.value,
                              }))
                            }
                            placeholder="Mã NVBH..."
                            className="mt-0.5 block w-full rounded border border-gray-200 px-2 py-1 text-xs font-mono text-gray-900"
                          />
                        </label>
                        <label className="col-span-2 block text-[11px] text-gray-600">
                          Tên NVBH mới
                          <input
                            value={mergeCustomStaff.staff_name}
                            onChange={(e) =>
                              setMergeCustomStaff((prev) => ({
                                ...prev,
                                staff_name: e.target.value,
                              }))
                            }
                            placeholder="Tên NVBH..."
                            className="mt-0.5 block w-full rounded border border-gray-200 px-2 py-1 text-xs text-gray-900"
                          />
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="max-h-60 overflow-y-auto rounded-xl border border-gray-200 divide-y divide-gray-100">
            {filteredMergeOrderOptions.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-400">
                Không có đơn hàng khả dụng phù hợp với bộ lọc.
              </div>
            ) : (
              filteredMergeOrderOptions.map((group) => {
                const checked = selectedMergeOrderNumbers.includes(group.orderNumber);
                return (
                  <label
                    key={group.orderNumber}
                    className={`flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-xs transition-colors ${
                      checked ? "bg-indigo-50/70" : "hover:bg-gray-50"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleMergeOrderNumber(group.orderNumber)}
                        className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <div>
                        <span className="font-mono font-semibold text-gray-900">{group.orderNumber}</span>
                        <span className="mx-2 text-gray-300">|</span>
                        <span className="font-medium text-gray-800">{group.customerName || group.customerCode}</span>
                        <span className="ml-2 text-gray-500">({group.staffName})</span>
                      </div>
                    </div>
                    <div className="text-right text-gray-600">
                      <span className="mr-3">{group.lines.length} dòng SP (SL: {group.totalQty})</span>
                      <span className="font-semibold text-emerald-700">{formatVND(group.totalValue)}</span>
                    </div>
                  </label>
                );
              })
            )}
          </div>

          {selectedMergeOrderNumbers.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-100 bg-indigo-50/50 px-4 py-2.5 text-xs text-indigo-900">
                <div>
                  Đã chọn <strong>{selectedMergeOrderNumbers.length}</strong> đơn:{" "}
                  <span className="font-mono">{selectedMergeOrderNumbers.join(", ")}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedMergeOrderNumbers([]);
                    setRepresentativeOrderNumber("");
                  }}
                  className="text-indigo-700 hover:underline"
                >
                  Bỏ chọn tất cả
                </button>
              </div>

              <h3 className="text-sm font-semibold text-gray-800">
                Xem trước danh mục sản phẩm sau khi gộp ({mergedProductPreview.length} dòng sản phẩm)
              </h3>
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="min-w-full divide-y divide-gray-200 text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-gray-700">Mã SP</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-700">Tên sản phẩm</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-700">Mã CTKM</th>
                      <th className="px-2 py-2 text-center font-semibold text-gray-700">ĐVT</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-700">Tổng SL</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-700">Tổng SL KM</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-700">Tổng CK</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-700">Tổng Giá trị</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {mergedProductPreview.map((item, idx) => (
                      <tr key={`${item.productCode}-${item.promoCode}-${idx}`}>
                        <td className="px-3 py-2 font-mono font-medium text-gray-900">{item.productCode}</td>
                        <td className="px-3 py-2 text-gray-800">{item.productName}</td>
                        <td className="px-3 py-2 text-gray-500">{item.promoCode || "—"}</td>
                        <td className="px-2 py-2 text-center text-gray-600">{item.unit}</td>
                        <td className="px-3 py-2 text-right font-semibold text-gray-900">{item.quantity}</td>
                        <td className="px-3 py-2 text-right font-semibold text-amber-700">{item.promoQuantity}</td>
                        <td className="px-3 py-2 text-right text-rose-700">{formatVND(item.totalDiscount)}</td>
                        <td className="px-3 py-2 text-right font-semibold text-emerald-700">{formatVND(item.totalValue)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 font-semibold text-gray-900">
                    <tr>
                      <td colSpan={4} className="px-3 py-2 text-right">Tổng cộng đơn gộp:</td>
                      <td className="px-3 py-2 text-right">
                        {mergedProductPreview.reduce((s, i) => s + i.quantity, 0)}
                      </td>
                      <td className="px-3 py-2 text-right text-amber-700">
                        {mergedProductPreview.reduce((s, i) => s + i.promoQuantity, 0)}
                      </td>
                      <td className="px-3 py-2 text-right text-rose-700">
                        {formatVND(mergedProductPreview.reduce((s, i) => s + i.totalDiscount, 0))}
                      </td>
                      <td className="px-3 py-2 text-right text-emerald-700">
                        {formatVND(mergedProductPreview.reduce((s, i) => s + i.totalValue, 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-gray-100 pt-4">
            <button
              type="button"
              onClick={() => setIsMergeDrawerOpen(false)}
              disabled={isSubmittingMerge}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={() => void submitMergeOrders()}
              disabled={isSubmittingMerge || selectedMergeOrderNumbers.length < 2}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              <Merge size={16} />
              {isSubmittingMerge ? "Đang gộp đơn..." : `Xác nhận gộp (${selectedMergeOrderNumbers.length} đơn)`}
            </button>
          </div>
        </div>
      </Drawer>
    </div>
  );
}

"use client";
/* eslint-disable react-hooks/set-state-in-effect */
// src/app/sales/orders/page.tsx
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
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
  Loader2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import DataTable, { Column } from "@/components/ui/DataTable";
import Drawer from "@/components/ui/Drawer";
import OrderActionModal from "@/components/ui/OrderActionModal";
import CreateOrderForm from "@/components/sales/CreateOrderForm";
import OrderDetailReplacementPanel from "@/components/sales/OrderDetailReplacementPanel";
import OrderSyncProgressPanel, {
  type SyncProgressLogEntry,
  type SyncProgressState,
  type SyncSourceProgressItem,
} from "@/components/sales/OrderSyncProgressPanel";
import { formatCustomerCode, formatNumber, formatVND, formatVNDFull } from "@/lib/format";
import { API_URL, apiFetch } from "@/lib/api";
import { useAuthSession } from "@/lib/auth-session";
import { useDistributorContext } from "@/lib/distributor-context";
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
const compactInputCls = "w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-100";

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
  delivery_employee_code: string;
  manager_code: string;
  is_split_or_merge: boolean;
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
  delivery_employee_code?: string;
  delivery_employee_name?: string;
  is_staff_debt?: boolean;
  delivery_recipient?: boolean;
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
  { title: "Mã CTKM", keys: ["promotionCode", "campaignCode", "ctkmCode", "promotionId", "Mã CTKM"], width: "11rem", truncate: true },
  { title: "Tên CTKM", keys: ["promotionName", "campaignName", "Tên CTKM"], width: "16rem", truncate: true },
  { title: "Ngày tạo", keys: ["createdAt", "createDate", "createdDate", "orderCreatedAt", "orderDate", "Ngày tạo", "Ngày", "Ngày đơn hàng", "_order_created_date"], width: "10.5rem" },
  { title: "Ngày giao", keys: ["deliveryDate", "deliveryAt", "deliveryConfirmedAt", "deliveryConfirmTime", "b2bDeliveryDate", "Ngày giao", "Ngày giao hàng"], width: "7.5rem" },
  { title: "Nhà phân phối", keys: ["NPP", "_distributor_name", "distributor_name", "Mã NPP", "_distributor_code"], width: "15rem", truncate: true },
  { title: "NVGH", keys: ["NVGH"], width: "12rem", truncate: true },
  { title: "Mã NVGH", keys: ["Mã NVGH"], width: "7.5rem" },
  { title: "Tên NVGH", keys: ["Tên NVGH"], width: "10rem", truncate: true },
  { title: "Mã KH", keys: ["customerCode", "shopCode", "Mã KH"], width: "8rem" },
  { title: "Tên KH", keys: ["customerName", "shopName", "Tên KH"], width: "12rem", truncate: true },
  { title: "Cửa Hàng", keys: ["Cửa Hàng", "store_name", "storeName"], width: "12rem", truncate: true },
  { title: "Mã NVQL", keys: ["Mã NVQL", "_manager_code"], width: "7.5rem" },
  { title: "Tên NVQL", keys: ["Tên NVQL", "_manager_name"], width: "10rem", truncate: true },
  { title: "Mã NVBH", keys: ["Mã NVBH", "_staff_code", "staffCode", "salesStaffCode", "salemanCode", "salesmanCode"], width: "8rem" },
  { title: "Tên NVBH", keys: ["Tên NVBH", "_staff_name", "staffName", "salesStaffName", "salemanName", "salesmanName"], width: "11rem", truncate: true },
  { title: "Địa chỉ", keys: ["address", "customerAddress", "shipTo", "Địa chỉ"], width: "14rem", truncate: true },
  { title: "Mã sản phẩm", keys: ["productCode", "itemCode", "sku", "Mã sản phẩm"], width: "7.5rem" },
  { title: "Sản phẩm", keys: ["productName", "product_name", "itemName", "product", "Sản phẩm", "Tên sản phẩm"], width: "16rem", truncate: true },
  { title: "Nhà cung cấp", keys: ["Nhà cung cấp", "supplier", "_supplier"], width: "9.5rem", truncate: true },
  { title: "Nguồn đồng bộ", keys: ["Nguồn đồng bộ", "_sync_source"], width: "10rem", truncate: true },
  { title: "ĐVT", keys: ["unit", "unitName", "ĐVT"], width: "4.5rem" },
  { title: "Số lượng", keys: ["quantity", "qty", "Số lượng"], width: "6.5rem", align: "right" },
  { title: "Số lượng KM", keys: ["promotionQuantity", "freeQuantity", "giftQuantity", "Số lượng KM"], width: "7.5rem", align: "right" },
  { title: "Giá trị", keys: ["totalValue", "total", "amount", "Giá trị"], width: "8rem", align: "right" },
  { title: "Số tiền CK", keys: ["totalDiscount", "discountAmount", "Số tiền CK"], width: "8rem", align: "right" },
  { title: "Thành tiền", keys: [], width: "9rem", align: "right" },
  { title: "Đơn giá", keys: ["unitPrice", "price", "Đơn giá"], width: "7.5rem", align: "right" },
  { title: "Thời gian xác nhận giao hàng", keys: ["deliveryConfirmedAt", "deliveryConfirmTime", "b2bDeliveryDate"], width: "14rem" },
  { title: "Ngày đơn hàng gốc", keys: ["initialOrderDate", "originalOrderDate", "Ngày đơn hàng gốc"], width: "10.5rem" },
  { title: "Tình trạng xử lý đơn hàng", keys: ["Tình trạng xử lý đơn hàng", "Trạng thái xử lý", "_processing_status"], width: "14rem" },
  { title: "Tình trạng xuất kho", keys: ["Tình trạng xuất kho", "_delivery_status"], width: "14rem" },
  { title: "Thay thế cho đơn", keys: ["_replacement_display", "_replaced_order_number"], width: "16rem" },
  { title: "Ghi chú", keys: ["Ghi chú", "_order_note"], width: "16rem" },
  { title: "Người thực hiện", keys: ["_performed_by", "performedBy", "Người thực hiện"], width: "9.5rem" },
];

function normalizeRemoteOrder(order: RemoteOrder): RemoteOrder {
  const normalized = Object.fromEntries(
    remoteColumnDefinitions.map(({ title, keys }) => {
      const sourceKey = keys.find((key) => hasRemoteValue(order[key]));
      return [title, sourceKey ? order[sourceKey] : null];
    })
  );
  normalized["_order_type"] = order["_order_type"] ?? order["Trạng thái tạo đơn"] ?? order.orderType ?? null;
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
  normalized["Nhà cung cấp"] = supplier;
  normalized["_supplier"] = supplier;
  const deliveryStatus = hasRemoteValue(order["Tình trạng xuất kho"])
    ? String(order["Tình trạng xuất kho"]).trim()
    : hasRemoteValue(order["_delivery_status"])
      ? String(order["_delivery_status"]).trim()
      : "Chưa yêu cầu";
  normalized["Tình trạng xuất kho"] = deliveryStatus;
  normalized["_delivery_status"] = deliveryStatus;
  const replacementType = displayRemoteValue(order["_replacement_type"]).trim();
  const replacedOrderNum = displayRemoteValue(order["_replaced_order_number"]).trim();
  const replacedByList = Array.isArray(order["_replaced_by_order_numbers"])
    ? (order["_replaced_by_order_numbers"] as string[]).filter(Boolean)
    : [];
  const orderNote = hasRemoteValue(order["_order_note"])
    ? displayRemoteValue(order["_order_note"]).trim()
    : hasRemoteValue(order["Ghi chú"])
      ? displayRemoteValue(order["Ghi chú"]).trim()
      : replacedOrderNum
        ? replacementType === "SPLIT"
          ? `Tách từ đơn: ${replacedOrderNum}`
          : replacementType === "MERGE"
            ? `Gộp từ đơn: ${replacedOrderNum}`
            : `Thay thế đơn: ${replacedOrderNum}`
        : replacedByList.length > 0
          ? replacementType === "SPLIT"
            ? `Đã tách thành: ${replacedByList.join(", ")}`
            : replacementType === "MERGE"
              ? `Đã gộp vào đơn: ${replacedByList.join(", ")}`
              : `Bị thay thế bởi: ${replacedByList.join(", ")}`
          : replacementType === "PENDING_SPLIT"
            ? displayRemoteValue(replacementDisplay).trim() || "Chờ KT duyệt tách"
            : null;
  normalized["Thay thế cho đơn"] = replacementDisplay;
  normalized["Ghi chú"] = orderNote;
  normalized["_order_note"] = orderNote;
  normalized["Người thực hiện"] = performedBy;
  normalized["_performed_by"] = performedBy;
  normalized["_local_id"] = order["_local_id"] ?? null;
  normalized["_distributor_code"] = order["_distributor_code"] ?? order["Mã NPP"] ?? null;
  normalized["_distributor_name"] = order["_distributor_name"] ?? null;
  normalized["_boxes_per_carton"] = order["_boxes_per_carton"] ?? null;
  normalized["Thành tiền"] = numericValue(normalized["Giá trị"]) - numericValue(normalized["Số tiền CK"]);
  normalized["_order_created_date"] = order["_order_created_date"] ?? null;
  normalized["_replaced_order_number"] = order["_replaced_order_number"] ?? null;
  normalized["_replaced_by_order_numbers"] = order["_replaced_by_order_numbers"] ?? null;
  normalized["_replacement_type"] = order["_replacement_type"] ?? null;
  normalized["_replacement_display"] = replacementDisplay;
  normalized["_processing_status"] = order["_processing_status"] ?? null;
  normalized["_pending_split_request_id"] = order["_pending_split_request_id"] ?? null;
  normalized["_is_synthetic"] = order["_is_synthetic"] ?? false;
  normalized["_warehouse_updated"] = order["_warehouse_updated"] ?? null;
  return normalized;
}

function addProcessingStatus(order: RemoteOrder): RemoteOrder {
  const rawProcStatus = displayRemoteValue(order["_processing_status"]).trim();
  const procStatus =
    rawProcStatus.toUpperCase().startsWith("NCC:") || rawProcStatus === "Đã cập nhật kho"
      ? ""
      : rawProcStatus;
  const orderType = displayRemoteValue(order["_order_type"]).trim();
  const processingStatus = procStatus || "Đã duyệt đơn";
  const standaloneStatuses = new Set([
    "Đã duyệt đơn",
    "Đơn Tách",
    "Đơn Tách (Nợ NVBH)",
    "Đơn Tách (Nợ NVGH)",
    "Đơn Gộp",
    "Đã Hủy",
    "Chờ KT duyệt tách",
  ]);
  const visibleProcessingStatus = processingStatus === "Đơn Tự Tạo" ? "" : processingStatus;
  const finalStatus = standaloneStatuses.has(processingStatus)
    ? processingStatus
    : orderType
      ? [orderType, visibleProcessingStatus].filter(Boolean).join(" · ")
      : processingStatus;
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
  if (title === "Thành tiền" && typeof value === "number") return formatNumber(value);
  if (title === "Nguồn đồng bộ") {
    const source = displayRemoteValue(value).trim();
    const normalized = source.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (normalized === "VINAMILK") return "Vinamilk";
    if (normalized === "NAZZY") return "Nazzy";
    if (normalized === "FRIESLANDCAMPINA" || normalized === "FC") return "FrieslandCampina";
    return source.replaceAll("_", " ");
  }
  if (title === "Mã KH") {
    const code = displayRemoteValue(value).trim();
    return /^(NVBH|NVGH)-/i.test(code) || code.toUpperCase() === "NVBH" ? code : formatCustomerCode(code);
  }
  return displayRemoteValue(value);
}

function numericValue(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value.replaceAll(",", "")) || 0;
  return 0;
}

function splitQuantityUnits(quantity: number, boxesPerCarton: number) {
  return {
    cartons: boxesPerCarton > 1 ? Math.floor(quantity / boxesPerCarton) : 0,
    boxes: boxesPerCarton > 1 ? Number((quantity % boxesPerCarton).toFixed(4)) : quantity,
  };
}

function SplitOriginalQuantity({ quantity, boxesPerCarton }: {
  quantity: number;
  boxesPerCarton: number | null;
}) {
  if (!boxesPerCarton) return <span title="Chưa có quy cách; số lượng theo ĐVT gốc">{quantity}</span>;
  const { cartons, boxes } = splitQuantityUnits(quantity, boxesPerCarton);
  return (
    <span className="whitespace-nowrap" title={`1 thùng = ${boxesPerCarton} hộp`}>
      {cartons}/{boxes}
    </span>
  );
}

function SplitQuantityInput({ quantity, boxesPerCarton, label, onChange }: {
  quantity: number;
  boxesPerCarton: number | null;
  label: string;
  onChange: (quantity: number) => void;
}) {
  if (!boxesPerCarton) {
    return <input type="number" min={0} step="any" inputMode="decimal" aria-label={label}
      value={quantity} onChange={(event) => onChange(Number(event.target.value))}
      className="min-h-10 w-20 rounded border border-gray-200 bg-white px-2 py-1 text-right text-xs" />;
  }
  const { cartons, boxes } = splitQuantityUnits(quantity, boxesPerCarton);
  return (
    <div className="flex items-center gap-1">
      <input type="number" min={0} step={1} inputMode="numeric" aria-label={`Thùng ${label}`}
        disabled={boxesPerCarton === 1} value={cartons}
        onChange={(event) => onChange(Math.max(0, Math.floor(Number(event.target.value) || 0)) * boxesPerCarton + boxes)}
        className="block min-h-10 w-16 rounded border border-gray-200 bg-white px-2 py-1 text-right text-xs disabled:bg-gray-100" />
      <input type="number" min={0} step="any" inputMode="decimal" aria-label={`Hộp ${label}`}
        value={boxes}
        onChange={(event) => onChange(Number((cartons * boxesPerCarton + Math.max(0, Number(event.target.value) || 0)).toFixed(4)))}
        className="block min-h-10 w-16 rounded border border-gray-200 bg-white px-2 py-1 text-right text-xs" />
    </div>
  );
}

export default function SalesOrdersPage() {
  const router = useRouter();
  const authSession = useAuthSession();
  const { distributors, effectiveDistributorId, effectiveDistributor } = useDistributorContext();
  const activeDistributorCode = effectiveDistributor?.code || authSession.distributorCode || "";
  const { username: sessionUsername } = authSession;
  const [isAdminUser, setIsAdminUser] = useState(false);
  const effectiveIsAdmin = isAdminUser || sessionUsername.trim().toLowerCase() === "admin";
  const todayInputStr = toInputDate(new Date());

  const [toast, setToast] = useState("");
  const [isCreateOrderOpen, setIsCreateOrderOpen] = useState(false);
  const [editingManualOrderNumber, setEditingManualOrderNumber] = useState<string | null>(null);
  const [deletingManualOrder, setDeletingManualOrder] = useState(false);
  const [selectedSummaryKeys, setSelectedSummaryKeys] = useState<Set<string>>(new Set());
  const [isBulkDeletingOrders, setIsBulkDeletingOrders] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgressState | null>(null);
  const defaultDateRange = getDefaultDateRange();
  const [fromDate, setFromDate] = useState(defaultDateRange.from);
  const [toDate, setToDate] = useState(defaultDateRange.to);
  const [remoteOrders, setRemoteOrders] = useState<RemoteOrder[]>([]);
  const [workflowOrders, setWorkflowOrders] = useState<RemoteOrder[]>([]);
  const [detailOrderNumber, setDetailOrderNumber] = useState<string | null>(null);
  const [detailOrderLines, setDetailOrderLines] = useState<RemoteOrder[]>([]);
  const [detailError, setDetailError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [listPage, setListPage] = useState(1);
  const [listTotal, setListTotal] = useState(0);
  const [allOrderCount, setAllOrderCount] = useState(0);
  const [listTotals, setListTotals] = useState({ value: 0, discount: 0, confirmed: 0 });
  const [serverStatuses, setServerStatuses] = useState<string[]>([]);
  const [serverDeliveryStatuses, setServerDeliveryStatuses] = useState<string[]>([]);
  const [serverSuppliers, setServerSuppliers] = useState<string[]>([]);
  const listRequestVersion = useRef(0);
  const listAbortRef = useRef<AbortController | null>(null);
  const detailRequestVersion = useRef(0);
  const [remoteError, setRemoteError] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState(20);
  const [orderFilter, setOrderFilter] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [staffFilter, setStaffFilter] = useState("");
  const [productFilter, setProductFilter] = useState("");
  // Debounced text filters để gõ phím mượt (không gọi API & không re-fetch liên tục khi đang gõ)
  const [debouncedOrderFilter, setDebouncedOrderFilter] = useState("");
  const [debouncedCustomerFilter, setDebouncedCustomerFilter] = useState("");
  const [debouncedStaffFilter, setDebouncedStaffFilter] = useState("");
  const [debouncedProductFilter, setDebouncedProductFilter] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("Tất cả");
  const [statusFilter, setStatusFilter] = useState("Tất cả");
  const [deliveryStatusFilter, setDeliveryStatusFilter] = useState("Tất cả");
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
  const [splitDeliveryEmployees, setSplitDeliveryEmployees] = useState<string[]>([]);
  const [remainderDeliveryEmployee, setRemainderDeliveryEmployee] = useState("");
  const [splitCustomerSearches, setSplitCustomerSearches] = useState<string[]>([]);
  const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>([]);
  const [isSubmittingSplit, setIsSubmittingSplit] = useState(false);
  const [splitError, setSplitError] = useState("");

  // State cho Gộp đơn (Merge Orders)
  const [isMergeDrawerOpen, setIsMergeDrawerOpen] = useState(false);
  const [mergeOrderSearch, setMergeOrderSearch] = useState("");
  const [selectedMergeOrderNumbers, setSelectedMergeOrderNumbers] = useState<string[]>([]);
  const [representativeOrderNumber, setRepresentativeOrderNumber] = useState("");
  const [mergeDeliveryEmployee, setMergeDeliveryEmployee] = useState("");
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

  // State cho Đổi mã khách hàng đặt đơn hàng
  const [changeCustomerOrder, setChangeCustomerOrder] = useState<{
    orderNumber: string;
    currentCode: string;
    currentName: string;
  } | null>(null);
  const [changeCustomerSearch, setChangeCustomerSearch] = useState("");
  const [newCustomerCode, setNewCustomerCode] = useState("");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerAddress, setNewCustomerAddress] = useState("");
  const [savingChangeCustomer, setSavingChangeCustomer] = useState(false);
  const [changeCustomerError, setChangeCustomerError] = useState("");
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
    setSelectedSummaryKeys(new Set());
  }, [remoteOrders]);

  useEffect(() => {
    if (!isCreateOrderOpen && editingManualOrderNumber === null) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsCreateOrderOpen(false);
        setEditingManualOrderNumber(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isCreateOrderOpen, editingManualOrderNumber]);

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

  const loadOrderLines = useCallback(async (orderNumber?: string, distributorCode?: string) => {
    const allRows: RemoteOrder[] = [];
    let skip = 0;
    while (true) {
      const params = new URLSearchParams({
        from_date: fromDate,
        to_date: toDate,
        source: "sync",
        skip: String(skip),
        limit: String(LOCAL_PAGE_SIZE),
      });
      if (orderNumber) params.set("order_number", orderNumber);
      if (distributorCode) params.set("distributor_code", distributorCode);
      const response = await apiFetch(
        `${API_URL}/sync/vinamilk-orders?${params}`
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
      const snapshotCount = payload.snapshot_count ?? rows.length;
      const snapshotTotal = payload.snapshot_total;
      skip += snapshotCount;
      if (snapshotCount === 0) break;
      if (snapshotTotal != null && skip >= snapshotTotal) break;
      if (snapshotCount < LOCAL_PAGE_SIZE) break;
    }
    return allRows.map(normalizeRemoteOrder).map(addProcessingStatus);
  }, [fromDate, toDate]);

  // Debounce 280ms riêng cho 4 ô nhập text; các bộ lọc dropdown/ngày/phân trang phản hồi ngay 0ms
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedOrderFilter(orderFilter);
      setDebouncedCustomerFilter(customerFilter);
      setDebouncedStaffFilter(staffFilter);
      setDebouncedProductFilter(productFilter);
    }, 280);
    return () => window.clearTimeout(timer);
  }, [orderFilter, customerFilter, staffFilter, productFilter]);

  const loadLocalOrders = useCallback(async () => {
    const version = ++listRequestVersion.current;
    listAbortRef.current?.abort();
    const controller = new AbortController();
    listAbortRef.current = controller;
    setListLoading(true);
    const params = new URLSearchParams({
      from_date: fromDate, to_date: toDate, skip: String((listPage - 1) * pageSize), limit: String(pageSize),
      order_search: debouncedOrderFilter, customer: debouncedCustomerFilter, staff: debouncedStaffFilter, product: debouncedProductFilter,
      supplier: supplierFilter === "Tất cả" ? "" : supplierFilter,
      processing_status: statusFilter === "Tất cả" ? "" : statusFilter,
      delivery_status: deliveryStatusFilter === "Tất cả" ? "" : deliveryStatusFilter,
    });
    if (activeDistributorCode) {
      params.set("distributor_code", activeDistributorCode);
    }
    try {
      const response = await apiFetch(`${API_URL}/sync/vinamilk-orders/grouped?${params}`, {
        signal: controller.signal,
      });
      const payload = await response.json() as {
        rows?: RemoteOrder[]; total?: number; all_total?: number; total_value?: number;
        total_discount?: number; confirmed?: number; statuses?: string[]; delivery_statuses?: string[];
        suppliers?: string[];
        last_synced_at?: string | null; detail?: string;
      };
      if (!response.ok || !Array.isArray(payload.rows)) throw new Error(payload.detail ?? "Không thể tải danh sách đơn hàng.");
      if (version !== listRequestVersion.current) return;
      setRemoteOrders(payload.rows.map((row) => ({ ...addProcessingStatus(normalizeRemoteOrder(row)), _summary_key: row._summary_key, "Số sản phẩm": row._product_count })));
      setListTotal(payload.total ?? 0);
      if (listPage > Math.max(1, Math.ceil((payload.total ?? 0) / pageSize))) {
        setListPage(Math.max(1, Math.ceil((payload.total ?? 0) / pageSize)));
      }
      setAllOrderCount(payload.all_total ?? 0);
      setListTotals({ value: payload.total_value ?? 0, discount: payload.total_discount ?? 0, confirmed: payload.confirmed ?? 0 });
      setServerStatuses(payload.statuses ?? []);
      setServerDeliveryStatuses(payload.delivery_statuses ?? []);
      setServerSuppliers(payload.suppliers ?? []);
      setLastSyncedAt(payload.last_synced_at ?? null);
      setRemoteError("");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      throw error;
    } finally {
      if (version === listRequestVersion.current) setListLoading(false);
    }
  }, [fromDate, toDate, listPage, pageSize, debouncedOrderFilter, debouncedCustomerFilter, debouncedStaffFilter, debouncedProductFilter, supplierFilter, statusFilter, deliveryStatusFilter, activeDistributorCode]);

  useEffect(() => {
    void loadSplitApprovalRequests();
  }, [loadSplitApprovalRequests]);

  useEffect(() => {
    const requestVersion = listRequestVersion;
    loadLocalOrders().catch((error) => setRemoteError(error instanceof Error ? error.message : "Không thể tải dữ liệu."));
    return () => {
      requestVersion.current++;
      listAbortRef.current?.abort();
    };
  }, [loadLocalOrders]);

  async function openOrderDetail(order: RemoteOrder) {
    const number = displayRemoteValue(order["Số đơn hàng"]).trim();
    if (!number) {
      setRemoteError("Đơn hàng không có số đơn, không thể tải chi tiết.");
      return;
    }
    const version = ++detailRequestVersion.current;
    setDetailOrderNumber(number);
    setDetailOrderLines([]);
    setDetailError("");
    setDetailLoading(true);
    try {
      const distributorCode = displayRemoteValue(order["_distributor_code"]).trim();
      const lines = await loadOrderLines(number, distributorCode || undefined);
      if (version === detailRequestVersion.current) setDetailOrderLines(lines);
    } catch (error) {
      if (version === detailRequestVersion.current) setDetailError(error instanceof Error ? error.message : "Không thể tải chi tiết đơn hàng.");
    } finally {
      if (version === detailRequestVersion.current) setDetailLoading(false);
    }
  }

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
    for (const row of workflowOrders) {
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
  }, [workflowOrders, effectiveIsAdmin, todayInputStr]);

  const selectedSplitOrderGroup = useMemo(
    () => eligibleOrderGroups.find((g) => g.orderNumber === selectedSplitOrderNumber) ?? null,
    [eligibleOrderGroups, selectedSplitOrderNumber]
  );

  // Khởi tạo bảng phân bổ số lượng và khách hàng khi chọn đơn cần tách
  function initializeSplitAllocations(group: GroupedOrderSummary | null, count: number) {
    setRemainderDeliveryEmployee("");
    if (!group) {
      setSplitAllocs({});
      setSplitCustomers([]);
      setSplitDeliveryEmployees([]);
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
    setSplitDeliveryEmployees(Array.from({ length: count }, () => ""));
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
    setSplitDeliveryEmployees((prev) => Array.from({ length: clamped }, (_, idx) => prev[idx] ?? ""));
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
    setSplitCustomers((prev) => {
      const next = [...prev];
      next[splitIdx] = {
        customer_code: "",
        customer_name: "",
        customer_address: "",
        is_staff_debt: true,
      };
      return next;
    });
  }

  function assignRemainderToStaffSplit() {
    if (!selectedSplitOrderGroup) return;
    setSplitError("");
    if (!remainderDeliveryEmployee) {
      setSplitError("Vui lòng chọn NVGH nhận phần thiếu.");
      return;
    }
    const hasRemainder = selectedSplitOrderGroup.lines.some((line) => {
      const allocs = splitAllocs[Number(line["_local_id"])] ?? [];
      return numericValue(line["Số lượng"]) - allocs.reduce((sum, item) => sum + item.quantity, 0) > 1e-4
        || numericValue(line["Số lượng KM"]) - allocs.reduce((sum, item) => sum + item.promoQuantity, 0) > 1e-4;
    });
    if (!hasRemainder) {
      setSplitError("Không còn phần thiếu. Hãy giảm số lượng đã phân bổ trước.");
      return;
    }
    const staffCust: SplitCustomerSelection = {
      customer_code: "",
      customer_name: "",
      customer_address: "",
      is_staff_debt: true,
    };

    const existingStaffIdx = splitCustomers.findIndex(
      (c, idx) => c?.is_staff_debt === true && splitDeliveryEmployees[idx] === remainderDeliveryEmployee
    );
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
      setSplitDeliveryEmployees((prev) => {
        const next = [...prev];
        next[targetIdx] = remainderDeliveryEmployee;
        return next;
      });
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
      const newCount = splitCount + 1;
      const newIdx = newCount - 1;
      setSplitCount(newCount);
      setSplitDeliveryEmployees((prev) => [...prev.slice(0, splitCount), remainderDeliveryEmployee]);
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
    } else {
      setSplitError("Đã đủ 10 đơn tách. Hãy dùng một đơn trống để gán cho NVGH.");
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

    // Kiểm tra tổng số lượng từng dòng trước khi phân bổ phần thiếu.
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
        delivery_recipient: Boolean(chosenCust.is_staff_debt),
        staff_code: selectedSplitOrderGroup.staffCode || undefined,
        staff_name: selectedSplitOrderGroup.staffName || undefined,
        delivery_employee_code: splitDeliveryEmployees[splitIdx] || null,
        items,
      };
    });

    const hasDeliveryRecipient = rawSplitsPayload.some((split) => split.delivery_recipient && split.items.length > 0);
    const splitsPayload = hasShortage || hasDeliveryRecipient
      ? rawSplitsPayload.filter((s) => s.items.length > 0)
      : rawSplitsPayload;

    if (splitsPayload.length === 0 && !hasShortage) {
      setSplitError("Vui lòng nhập số lượng phân bổ lớn hơn 0 cho ít nhất 1 đơn tách.");
      return;
    }
    if (splitsPayload.some((split) => split.delivery_recipient && !split.delivery_employee_code)) {
      setSplitError("Vui lòng chọn NVGH cho từng đơn tách gắn phần thiếu.");
      return;
    }

    if (!hasShortage) {
      const emptySplitIndex = rawSplitsPayload.findIndex((s) => s.items.length === 0);
      if (emptySplitIndex !== -1 && !hasDeliveryRecipient) {
        setSplitError(`Đơn tách thứ ${emptySplitIndex + 1} chưa có sản phẩm nào có số lượng > 0.`);
        return;
      }
      if (splitsPayload.length === 1) {
        const onlySplit = splitsPayload[0];
        const targetCode = (onlySplit.customer_code ?? "").trim();
        const origCode = (selectedSplitOrderGroup.customerCode ?? "").trim();
        if (!onlySplit.delivery_recipient && (!targetCode || targetCode.toUpperCase() === origCode.toUpperCase())) {
          setSplitError(
            "Khi tách thành 1 đơn (đổi khách hàng), vui lòng chọn khách hàng khác hoặc gắn phần thiếu cho NVGH."
          );
          return;
        }
      }
    } else {
      const employee = deliveryEmployees.find((item) => item.code === remainderDeliveryEmployee);
      if (!employee) {
        setSplitError("Vui lòng chọn NVGH nhận phần thiếu.");
        return;
      }
      const confirmStaffRemainder = window.confirm(
        `Tổng số lượng phân bổ cho khách đang còn thiếu (SL thiếu: ${totalShortageQty}${
          totalShortagePromo > 0 ? `, SL KM thiếu: ${totalShortagePromo}` : ""
        }).\n\nHệ thống sẽ tự động tách phần thiếu này thành 1 đơn riêng gắn cho NVGH ${employee.code} - ${employee.name}. Bạn có đồng ý tiếp tục?`
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
          auto_assign_remainder_to_delivery_customer: hasShortage,
          remainder_delivery_employee_code: hasShortage ? remainderDeliveryEmployee : null,
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
      void loadSplitApprovalRequests();
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
          delivery_employee_code: mergeDeliveryEmployee || null,
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
      setMergeDeliveryEmployee("");
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

  const handleSyncConfiguredSources = async () => {
    const days = eachInclusiveInputDate(fromDate, toDate);
    if (days.length === 0) {
      setRemoteError("Khoảng ngày không hợp lệ. Ngày kết thúc phải lớn hơn hoặc bằng ngày bắt đầu.");
      return;
    }
    if (days.length > LONG_SYNC_DAYS && !window.confirm(`Khoảng ${days.length} ngày sẽ được đồng bộ cho từng nguồn đang cấu hình. Tiếp tục?`)) {
      return;
    }

    const startedAt = Date.now();
    const pushLocalLog = (
      prev: SyncProgressState | null,
      message: string,
      level: SyncProgressLogEntry["level"] = "info",
    ): SyncProgressLogEntry[] => {
      const existing = prev?.logs ?? [];
      if (existing.length > 0 && existing[existing.length - 1]?.message === message) {
        return existing;
      }
      return [...existing, { time: new Date().toISOString(), level, message }];
    };

    setIsSyncing(true);
    setRemoteError("");
    setToast("");
    setSyncProgress({
      visible: true,
      phase: "preparing",
      title: `Đồng bộ đơn hàng NCC (${fromDate} → ${toDate})`,
      progress: 5,
      message: "Bước 1/3: Đang xác định Nhà phân phối và tải danh sách nguồn dữ liệu đã cấu hình...",
      startedAt,
      finishedAt: null,
      items: [],
      logs: [
        {
          time: new Date().toISOString(),
          level: "info",
          message: `Khởi tạo đồng bộ khoảng ngày ${fromDate} → ${toDate} (${days.length} ngày).`,
        },
      ],
    });

    const fetchWithTimeout = async (
      url: string,
      init: RequestInit | undefined,
      timeoutMs: number,
      stepLabel: string,
    ): Promise<Response> => {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await apiFetch(url, { ...init, signal: controller.signal });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          throw new Error(
            `Quá thời gian chờ (${Math.round(timeoutMs / 1000)}s) khi ${stepLabel}. Vui lòng kiểm tra trạng thái Backend hoặc mạng rồi thử lại.`,
          );
        }
        throw err;
      } finally {
        window.clearTimeout(timer);
      }
    };

    try {
      let distributorId: number | undefined =
        effectiveDistributorId ?? authSession.distributorId ?? distributors[0]?.id;
      let activeDistName =
        effectiveDistributor?.name ||
        authSession.distributorName ||
        distributors.find((d) => d.id === distributorId)?.name ||
        "";

      if (!distributorId) {
        const distributorsResponse = await fetchWithTimeout(
          `${API_URL}/einvoice/distributors`,
          undefined,
          20000,
          "tải danh sách Nhà phân phối",
        );
        const distributorList = (await distributorsResponse.json()) as Array<{
          id: number;
          code?: string;
          name?: string;
        }>;
        if (!distributorsResponse.ok) {
          throw new Error("Không thể tải danh sách Nhà phân phối để xác định nguồn dữ liệu.");
        }
        distributorId = distributorList[0]?.id;
        activeDistName = distributorList[0]?.name || "";
      }

      if (!distributorId) {
        throw new Error("Không tìm thấy Nhà phân phối để tải cấu hình nguồn dữ liệu.");
      }

      setSyncProgress((prev) =>
        prev
          ? {
              ...prev,
              progress: 10,
              message: `Đang tải danh sách nguồn Nhà cung cấp của ${activeDistName || `NPP #${distributorId}`}...`,
              logs: pushLocalLog(
                prev,
                `Đã xác định Nhà phân phối: ${activeDistName || `#${distributorId}`}. Đang tải cấu hình nguồn NCC...`,
              ),
            }
          : prev,
      );

      const configsResponse = await fetchWithTimeout(
        `${API_URL}/einvoice/supplier-configs?distributor_id=${distributorId}`,
        undefined,
        20000,
        "tải cấu hình nguồn dữ liệu Nhà cung cấp",
      );
      const configuredSources = (await configsResponse.json()) as Array<{
        id: number;
        supplier_code: string;
        supplier_name: string;
        status: string;
      }>;
      if (!configsResponse.ok) {
        throw new Error("Không thể tải cấu hình nguồn dữ liệu Nhà cung cấp.");
      }
      const activeSources = configuredSources.filter(
        (source) => (source.status || "").toLowerCase() === "active"
      );
      if (activeSources.length === 0) {
        throw new Error("Nhà phân phối chưa có nguồn dữ liệu Nhà cung cấp nào đang hoạt động.");
      }

      const initialItems: SyncSourceProgressItem[] = activeSources.map((src) => ({
        id: src.id,
        code: src.supplier_code,
        name: src.supplier_name || src.supplier_code,
        status: "PENDING",
        stage: "Chờ gửi vào hàng đợi đồng bộ...",
        raw_rows: 0,
        new_orders: 0,
        updated_orders: 0,
      }));

      setSyncProgress((prev) =>
        prev
          ? {
              ...prev,
              progress: 15,
              message: `Tìm thấy ${activeSources.length} nguồn đang hoạt động. Đang gửi tác vụ vào hàng đợi máy chủ...`,
              items: initialItems,
              logs: pushLocalLog(
                prev,
                `Tìm thấy ${activeSources.length} nguồn hoạt động: ${activeSources.map((s) => s.supplier_name || s.supplier_code).join(", ")}.`,
              ),
            }
          : prev,
      );

      // Gửi yêu cầu vào Hàng Đợi Ngầm (Queue Engine)
      const asyncRes = await fetchWithTimeout(
        `${API_URL}/einvoice/supplier-configs/sync-all-async`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            distributor_id: distributorId,
            from_date: fromDate,
            to_date: toDate,
          }),
        },
        20000,
        "kích hoạt hàng đợi đồng bộ ngầm",
      );
      const asyncData = (await asyncRes.json()) as {
        message?: string;
        job_id?: string;
        title?: string;
        detail?: string;
      };
      if (!asyncRes.ok) {
        throw new Error(asyncData.detail || "Không thể kích hoạt hàng đợi đồng bộ ngầm.");
      }

      setSyncProgress((prev) =>
        prev
          ? {
              ...prev,
              phase: "running",
              title: asyncData.title || prev.title,
              progress: 18,
              message: "Bước 2/3: Máy chủ đã tiếp nhận — đang kết nối và tải đơn hàng từ các nguồn NCC...",
              logs: pushLocalLog(
                prev,
                `Đã khởi tạo tiến trình đồng bộ trên máy chủ (Mã tác vụ: ${asyncData.job_id || "async"}).`,
              ),
            }
          : prev,
      );

      // Theo dõi tiến trình đồng bộ theo thời gian thực mỗi 1.5 giây (tối đa 12 phút)
      if (asyncData.job_id) {
        const jobId = asyncData.job_id;
        let finished = false;
        let consecutiveErrors = 0;
        for (let attempt = 0; attempt < 480; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          let jobRes: Response;
          try {
            jobRes = await fetchWithTimeout(
              `${API_URL}/sync/jobs/${jobId}`,
              undefined,
              15000,
              "kiểm tra tiến trình đồng bộ",
            );
          } catch {
            consecutiveErrors += 1;
            if (consecutiveErrors >= 10) break;
            continue;
          }
          if (!jobRes.ok) {
            consecutiveErrors += 1;
            if (consecutiveErrors >= 8) break;
            continue;
          }
          consecutiveErrors = 0;
          const jobInfo = (await jobRes.json()) as {
            status?: string;
            progress?: number;
            message?: string;
            error_detail?: string;
            items?: SyncSourceProgressItem[];
            logs?: SyncProgressLogEntry[];
            result_summary?: {
              new_orders?: number;
              updated_orders?: number;
              new_lines?: number;
              updated_lines?: number;
              unchanged_lines?: number;
              failed_sources?: number;
              total_sources?: number;
              synced_at?: string;
            };
          };

          const serverProgress = Number(jobInfo.progress ?? 0);
          setSyncProgress((prev) =>
            prev
              ? {
                  ...prev,
                  phase:
                    jobInfo.status === "SUCCESS"
                      ? "success"
                      : jobInfo.status === "FAILED"
                        ? "failed"
                        : "running",
                  progress:
                    jobInfo.status === "SUCCESS"
                      ? 100
                      : Math.max(prev.progress, serverProgress),
                  message: jobInfo.message || prev.message,
                  items:
                    Array.isArray(jobInfo.items) && jobInfo.items.length > 0
                      ? jobInfo.items
                      : prev.items,
                  logs:
                    Array.isArray(jobInfo.logs) && jobInfo.logs.length > 0
                      ? jobInfo.logs
                      : prev.logs,
                  summary: jobInfo.result_summary || prev.summary,
                  finishedAt:
                    jobInfo.status === "SUCCESS" || jobInfo.status === "FAILED"
                      ? Date.now()
                      : null,
                }
              : prev,
          );

          if (jobInfo.status === "SUCCESS") {
            finished = true;
            setLastSyncedAt(jobInfo.result_summary?.synced_at || new Date().toISOString());
            const failedItems = Array.isArray(jobInfo.items)
              ? jobInfo.items.filter((item) => item.status === "FAILED")
              : [];
            if (failedItems.length > 0) {
              const errDetails = failedItems
                .map((item) => `${item.name || item.code}: ${item.message || item.stage || "Lỗi đồng bộ"}`)
                .join(" | ");
              setRemoteError(`Một số nguồn NCC đồng bộ thất bại: ${errDetails}`);
            }
            void loadLocalOrders();
            break;
          }
          if (jobInfo.status === "FAILED") {
            finished = true;
            throw new Error(jobInfo.error_detail || jobInfo.message || "Đồng bộ dữ liệu thất bại.");
          }
        }
        if (!finished) {
          setSyncProgress((prev) =>
            prev
              ? {
                  ...prev,
                  phase: "failed",
                  finishedAt: Date.now(),
                  message:
                    "Mất kết nối theo dõi tiến trình đồng bộ (tác vụ trên máy chủ có thể đã hoàn tất). Bấm Tải lại trang để kiểm tra dữ liệu mới nhất.",
                  logs: pushLocalLog(
                    prev,
                    "Dừng theo dõi tiến trình tự động — vui lòng tải lại danh sách đơn hàng.",
                    "warning",
                  ),
                }
              : prev,
          );
          void loadLocalOrders();
        }
      } else {
        setTimeout(() => {
          void loadLocalOrders();
        }, 4000);
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Lỗi kết nối tới Server.";
      setRemoteError(errMsg);
      setToast("");
      setSyncProgress((prev) =>
        prev
          ? {
              ...prev,
              phase: "failed",
              message: errMsg,
              finishedAt: Date.now(),
              logs: pushLocalLog(prev, `Lỗi: ${errMsg}`, "error"),
            }
          : prev,
      );
    } finally {
      setIsSyncing(false);
    }
  };

  const remoteColumns = remoteColumnDefinitions
    .filter(({ title }) => (
      ["NVGH", "Thành tiền", "Tình trạng xử lý đơn hàng", "Tình trạng xuất kho", "Trạng thái xử lý", "Nhà cung cấp", "Nguồn đồng bộ", "Thay thế cho đơn", "Người thực hiện"].includes(title)
    ) || remoteOrders.some((order) => hasRemoteValue(order[title])) || detailOrderLines.some((order) => hasRemoteValue(order[title])))
    .filter(({ title }) => title !== "Mã NVGH" && title !== "Tên NVGH")
    .map(({ title, width, align }): Column<RemoteOrder> => ({
      key: title,
      title,
      sortable: true,
      width,
      align,
      render: (value, order) => {
        const text = formatRemoteColumnValue(title, value);
        if (title === "Nguồn đồng bộ") {
          return text ? (
            <span className="inline-flex max-w-full items-center rounded border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-800" title={text}>
              <span className="truncate">{text}</span>
            </span>
          ) : (
            <span className="text-slate-400">—</span>
          );
        }
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
        if (title === "Tình trạng xuất kho") {
          const deliveryStatus = displayRemoteValue(value).trim() || "Chưa yêu cầu";
          const tone = deliveryStatus === "Đã xuất kho"
            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
            : deliveryStatus === "Đã xuất một phần"
              ? "bg-amber-50 text-amber-800 border-amber-200"
              : deliveryStatus === "Đã nhận - đang xuất kho"
                ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                : deliveryStatus.startsWith("Đã duyệt")
                  ? "bg-sky-50 text-sky-700 border-sky-200"
                  : deliveryStatus === "Chờ Admin duyệt"
                    ? "bg-amber-50 text-amber-800 border-amber-200"
                    : deliveryStatus === "Đã hủy yêu cầu"
                      ? "bg-rose-50 text-rose-700 border-rose-200"
                      : "bg-gray-100 text-gray-600 border-gray-200";
          return (
            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${tone}`}>
              {deliveryStatus}
            </span>
          );
        }
        if (title === "Tình trạng xử lý đơn hàng" || title === "Trạng thái xử lý") {
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
          if (text === "Đơn Tách" || text === "Đơn Tách (Nợ NVBH)" || text === "Đơn Tách (Nợ NVGH)") {
            const isStaffDebt = text !== "Đơn Tách";
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
                    Đã duyệt đơn
                  </span>
                )}
              </div>
            );
          }
          if (text === "Đơn Gộp") {
            return (
              <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 border border-indigo-200">
                Đơn Gộp
              </span>
            );
          }
          if (text === "Đơn Tự Tạo") {
            return (
              <span className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700 border border-teal-200">
                Đơn Tự Tạo
              </span>
            );
          }
          if (text === "Đã Hủy") {
            return (
              <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-700">
                Đã hủy
              </span>
            );
          }
          if (text === "Đã duyệt đơn" || text === "Đã cập nhật kho" || text === "Đã trả") {
            const label = text === "Đã cập nhật kho" ? "Đã duyệt đơn" : text;
            const tone = "border border-emerald-200 bg-emerald-50 text-emerald-700";
            return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>{label}</span>;
          }
          if (!text) return <span className="text-gray-400">—</span>;
          return <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">{text}</span>;
        }
        return <span className="block truncate" title={text || undefined}>{text}</span>;
      },
    }));
  const orderDetailColumns = remoteColumns.filter((column) => ![
    "Tình trạng xử lý đơn hàng",
    "Tình trạng xuất kho",
    "Thay thế cho đơn",
    "Tên NVBH",
    "NVGH",
  ].includes(column.title));

  const remoteStatuses = serverStatuses;
  const deliveryStatuses = Array.from(new Set([
    "Chưa yêu cầu",
    "Chờ Admin duyệt",
    "Đã duyệt - chờ kho nhận",
    "Đã nhận - đang xuất kho",
    "Đã xuất một phần",
    "Đã xuất kho",
    "Đã hủy yêu cầu",
    ...serverDeliveryStatuses,
  ]));
  const matchesFilters = (order: RemoteOrder) => {
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
    if (supplierFilter !== "Tất cả") {
      const target = supplierFilter.toLowerCase();
      const rowSup = displayRemoteValue(order["Nhà cung cấp"]).toLowerCase();
      const rowSrc = displayRemoteValue(order["Nguồn đồng bộ"]).toLowerCase();
      const tokens = [...rowSup.split("/"), ...rowSrc.split("/")].map((s) => s.trim()).filter(Boolean);
      if (!tokens.includes(target)) return false;
    }
    if (statusFilter !== "Tất cả" && displayRemoteValue(order["Tình trạng xử lý đơn hàng"] || order["Trạng thái xử lý"]) !== statusFilter) return false;
    if (deliveryStatusFilter !== "Tất cả" && displayRemoteValue(order["Tình trạng xuất kho"]) !== deliveryStatusFilter) return false;
    return true;
  };
  const orderSummaries = remoteOrders;
  const summaryColumns: Column<RemoteOrder>[] = [
    {
      key: "Số đơn hàng",
      title: "Số đơn hàng",
      sortable: true,
      width: "11rem",
      render: (value, order) => (
        <button type="button" className="font-semibold text-sky-700 hover:underline"
          onClick={() => void openOrderDetail(order)}>
          {displayRemoteValue(value) || "Xem chi tiết"}
        </button>
      ),
    },
    ...remoteColumns.filter((column) => [
      "Ngày tạo", "Nhà phân phối", "Nguồn đồng bộ", "Nhà cung cấp", "Mã KH", "Tên KH",
    ].includes(column.title)),
    {
      key: "Mã NVBH",
      title: "Mã NVBH",
      sortable: true,
      width: "8rem",
      render: (_value, order) => {
        const staffCode = displayRemoteValue(
          order["Mã NVBH"] || order["_staff_code"] || order["staffCode"] || order["salesStaffCode"]
        ).trim();
        if (!staffCode) {
          return <span className="text-slate-400">—</span>;
        }
        return (
          <span className="font-mono text-xs font-semibold text-indigo-800" title={staffCode}>
            {staffCode}
          </span>
        );
      },
    },
    {
      key: "Tên NVBH",
      title: "Tên NVBH",
      sortable: true,
      width: "12rem",
      render: (_value, order) => {
        const staffName = displayRemoteValue(
          order["Tên NVBH"] || order["_staff_name"] || order["staffName"] || order["salesStaffName"]
        ).trim();
        if (!staffName) {
          return <span className="text-slate-400">—</span>;
        }
        return (
          <span className="block truncate font-medium text-slate-800" title={staffName}>
            {staffName}
          </span>
        );
      },
    },
    {
      key: "NVGH",
      title: "Nhân viên giao hàng",
      sortable: true,
      width: "12rem",
      render: (_value, order) => {
        const nvghFull = displayRemoteValue(order["NVGH"]).trim();
        const nvghCode = displayRemoteValue(order["Mã NVGH"]).trim();
        const nvghName = displayRemoteValue(order["Tên NVGH"]).trim();
        if (!nvghFull && !nvghCode && !nvghName) {
          return <span className="text-slate-400">—</span>;
        }
        if (nvghCode && nvghName) {
          return (
            <div className="flex flex-col leading-tight">
              <span className="truncate font-medium text-emerald-800" title={`${nvghCode} - ${nvghName}`}>
                {nvghName}
              </span>
              <span className="font-mono text-[10px] text-slate-500">{nvghCode}</span>
            </div>
          );
        }
        return (
          <span className="block truncate font-medium text-emerald-800" title={nvghFull || nvghName || nvghCode}>
            {nvghFull || nvghName || nvghCode}
          </span>
        );
      },
    },
    { key: "Số sản phẩm", title: "Số sản phẩm", sortable: true, align: "right", width: "8rem" },
    ...remoteColumns.filter((column) => ["Giá trị", "Số tiền CK", "Thành tiền"].includes(column.title)),
    {
      key: "Tình trạng xử lý đơn hàng",
      title: "Trạng thái",
      sortable: true,
      width: "11rem",
      render: (value, order) => {
        const rawText = displayRemoteValue(value || order["Trạng thái xử lý"] || order["_processing_status"]).trim();
        const text = !rawText || rawText === "Đã cập nhật kho" ? "Đã duyệt đơn" : rawText;
        if (text === "Chờ KT duyệt tách") {
          return (
            <button
              type="button"
              onClick={() => {
                setSplitApprovalError("");
                setIsSplitApprovalDrawerOpen(true);
                void loadSplitApprovalRequests(splitApprovalFilter);
              }}
              className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-100"
            >
              <Clock3 size={11} />
              Chờ KT duyệt tách
            </button>
          );
        }
        if (text === "Đơn Tách" || text === "Đơn Tách (Nợ NVBH)" || text === "Đơn Tách (Nợ NVGH)") {
          const isStaffDebt = text !== "Đơn Tách";
          return (
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                isStaffDebt
                  ? "border-amber-300 bg-amber-50 text-amber-800"
                  : "border-purple-200 bg-purple-50 text-purple-700"
              }`}
            >
              {text}
            </span>
          );
        }
        if (text === "Đơn Gộp") {
          return (
            <span className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
              Đơn Gộp
            </span>
          );
        }
        if (text === "Đã Hủy" || text === "Đã hủy") {
          return (
            <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
              Đã hủy
            </span>
          );
        }
        if (text === "Đơn Tự Tạo") {
          return (
            <span className="inline-flex items-center rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-700">
              Đơn Tự Tạo
            </span>
          );
        }
        if (text === "Đã duyệt đơn" || text === "Đã cập nhật kho" || text === "Đã trả") {
          const label = text === "Đã cập nhật kho" ? "Đã duyệt đơn" : text;
          return (
            <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
              {label}
            </span>
          );
        }
        return (
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
            {text}
          </span>
        );
      },
    },
    {
      key: "Ghi chú",
      title: "Ghi chú",
      sortable: false,
      width: "18rem",
      render: (value, order) => {
        const noteText = displayRemoteValue(value || order["_order_note"]).trim();
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
              className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 hover:bg-amber-100"
              title="Bấm để mở danh sách Kế toán xác nhận tách đơn"
            >
              <Clock3 size={11} />
              {noteText || "Chờ KT duyệt tách"}
            </button>
          );
        }
        if ((replacementType === "SPLIT" || replacementType === "MERGE") && noteText) {
          const isCancelledSource =
            displayRemoteValue(order["Tình trạng xử lý đơn hàng"] || order["_processing_status"]).trim() === "Đã Hủy";
          const canRevert = effectiveIsAdmin || isOrderToday(order);
          return (
            <div className="flex items-center justify-between gap-2">
              <span
                className={`truncate text-[11px] font-medium ${
                  isCancelledSource ? "text-rose-700" : "text-sky-700"
                }`}
                title={noteText}
              >
                {noteText}
              </span>
              {canRevert && (
                <button
                  type="button"
                  onClick={() => void handleRevertSplitMerge(orderNum)}
                  disabled={revertingOrderNumber === orderNum}
                  title="Hoàn tác tách/gộp đơn này"
                  className="inline-flex shrink-0 items-center gap-1 rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                >
                  <RotateCcw size={10} />
                  Hoàn tác
                </button>
              )}
            </div>
          );
        }
        if (!noteText) return <span className="text-slate-400">—</span>;
        return (
          <span className="block truncate text-[11px] text-slate-700" title={noteText}>
            {noteText}
          </span>
        );
      },
    },
  ];
  const deliveryRequestOrderOptions = useMemo(() => {
    if (!isDeliveryRequestDrawerOpen) return [] as DeliveryRequestOrderOption[];
    return Array.from(
      workflowOrders.filter(matchesFilters).reduce((orders, row) => {
        const orderNumber = displayRemoteValue(row["Số đơn hàng"]).trim();
        if (
          !orderNumber ||
          orders.has(orderNumber) ||
          displayRemoteValue(row["Tình trạng xử lý đơn hàng"]).trim() === "Đã Hủy"
        ) return orders;
        orders.set(orderNumber, {
          order_number: orderNumber,
          order_date: displayRemoteValue(row["_order_created_date"]).trim()
            || displayRemoteValue(row["Ngày tạo"]).trim(),
          customer_code: displayRemoteValue(row["Mã KH"]).trim(),
          customer_name: displayRemoteValue(row["Tên KH"]).trim(),
          original_status: displayRemoteValue(row["Trạng thái"]).trim(),
          delivery_employee_code: displayRemoteValue(row["Mã NVGH"]).trim(),
          manager_code: displayRemoteValue(row["Mã NVQL"]).trim(),
          is_split_or_merge: row["_replacement_type"] === "SPLIT" || row["_replacement_type"] === "MERGE",
        });
        return orders;
      }, new Map<string, DeliveryRequestOrderOption>())
        .values()
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDeliveryRequestDrawerOpen, workflowOrders, orderFilter, customerFilter, staffFilter, productFilter, supplierFilter, statusFilter, deliveryStatusFilter]);
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

  function defaultDeliveryEmployee(order: DeliveryRequestOrderOption): DeliveryEmployeeOption | undefined {
    const managerCode = order.manager_code.trim().toUpperCase();
    const existingDeliveryCode = order.delivery_employee_code.trim().toUpperCase();
    if (order.is_split_or_merge && existingDeliveryCode) {
      return deliveryEmployees.find((employee) => employee.code.toUpperCase() === existingDeliveryCode);
    }
    return deliveryEmployees.find((employee) => employee.code.toUpperCase() === managerCode)
      ?? deliveryEmployees.find((employee) => employee.code.toUpperCase() === existingDeliveryCode);
  }

  async function loadDeliveryEmployees() {
    const response = await apiFetch(`${API_URL}/employees/?status=active&limit=1000`);
    const payload = await response.json() as DeliveryEmployeeOption[] | { detail?: string };
    if (!response.ok || !Array.isArray(payload)) {
      throw new Error(!Array.isArray(payload) ? payload.detail ?? "Không tải được danh sách nhân viên." : "Không tải được danh sách nhân viên.");
    }
    return payload.filter((employee) =>
      employee.status?.toLowerCase() === "active" && employee.code?.trim().toUpperCase().startsWith("NV")
    );
  }

  async function openSplitDrawer() {
    setSplitError("");
    setIsSplitDrawerOpen(true);
    setWorkflowOrders([]);
    setIsLoadingDeliveryEmployees(true);
    setDeliveryEmployeeError("");
    try {
      const [employees, orders] = await Promise.all([loadDeliveryEmployees(), loadOrderLines()]);
      setWorkflowOrders(orders);
      setDeliveryEmployees(employees);
      if (!employees.length) setDeliveryEmployeeError("Không tìm thấy nhân viên đang hoạt động có mã bắt đầu bằng NV.");
    } catch (error) {
      setDeliveryEmployeeError(error instanceof Error ? error.message : "Không tải được danh sách NVGH.");
    } finally {
      setIsLoadingDeliveryEmployees(false);
    }
  }

  async function openMergeDrawer() {
    setMergeError("");
    setIsMergeDrawerOpen(true);
    setWorkflowOrders([]);
    setIsLoadingDeliveryEmployees(true);
    setDeliveryEmployeeError("");
    try {
      const [employees, orders] = await Promise.all([loadDeliveryEmployees(), loadOrderLines()]);
      setWorkflowOrders(orders);
      setDeliveryEmployees(employees);
      if (!employees.length) setDeliveryEmployeeError("Không tìm thấy nhân viên đang hoạt động có mã bắt đầu bằng NV.");
    } catch (error) {
      setDeliveryEmployeeError(error instanceof Error ? error.message : "Không tải được danh sách NVGH.");
    } finally {
      setIsLoadingDeliveryEmployees(false);
    }
  }

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
    setWorkflowOrders([]);
    setIsLoadingDeliveryEmployees(true);
    try {
      const [employees, warehouseResponse, orders] = await Promise.all([
        loadDeliveryEmployees(),
        apiFetch(`${API_URL}/inventory/warehouses/`),
        loadOrderLines(),
      ]);
      setWorkflowOrders(orders);
      const warehouses = await warehouseResponse.json() as DeliveryWarehouseOption[] | { detail?: string };
      if (!warehouseResponse.ok || !Array.isArray(warehouses)) {
        throw new Error(!Array.isArray(warehouses) ? warehouses.detail ?? "Không tải được danh sách kho." : "Không tải được danh sách kho.");
      }
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
      const selectedOrder = deliveryRequestOrderOptions.find((order) => order.order_number === orderNumber);
      const defaultEmployee = selectedOrder ? defaultDeliveryEmployee(selectedOrder) : undefined;
      if (defaultEmployee) {
        setDeliveryEmployeeAssignments((current) => ({
          ...current,
          [orderNumber]: current[orderNumber] || defaultEmployee.code,
        }));
      }
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
      setToast(`Đã tạo yêu cầu ${created.code ?? ""}; đang chờ Admin duyệt trước khi chuyển cho thủ kho.`);
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
    setListPage(1);
    setOrderFilter("");
    setCustomerFilter("");
    setStaffFilter("");
    setProductFilter("");
    setDebouncedOrderFilter("");
    setDebouncedCustomerFilter("");
    setDebouncedStaffFilter("");
    setDebouncedProductFilter("");
    setSupplierFilter("Tất cả");
    setStatusFilter("Tất cả");
    setDeliveryStatusFilter("Tất cả");
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

  async function downloadExcel() {
    try {
    const lines = (await loadOrderLines(undefined, activeDistributorCode || undefined)).filter(matchesFilters);
    if (lines.length === 0) {
      setRemoteError("Không có dòng sản phẩm phù hợp để xuất Excel.");
      return;
    }
    const exportColumns = remoteColumnDefinitions.filter(({ title }) =>
      ["NVGH", "Thành tiền", "Tình trạng xử lý đơn hàng", "Tình trạng xuất kho", "Nhà cung cấp", "Thay thế cho đơn", "Ghi chú", "Người thực hiện"].includes(title)
      || lines.some((line) => hasRemoteValue(line[title]))
    ).filter(({ title }) => title !== "Mã NVGH" && title !== "Tên NVGH");
    const exportRows = lines.map((order) =>
      Object.fromEntries(exportColumns.map(({ title: key }) => [
        key,
        key === "Thành tiền" ? order[key] : key === "Mã KH" ? displayRemoteValue(order[key]) : formatRemoteColumnValue(key, order[key]),
      ]))
    );
    const worksheet = XLSX.utils.json_to_sheet(exportRows, { header: exportColumns.map(({ title }) => title) });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Don hang");
    XLSX.writeFile(workbook, `don-hang-vinamilk-${fromDate}-den-${toDate}.xlsx`);
    } catch (error) {
      setRemoteError(error instanceof Error ? error.message : "Không thể xuất Excel.");
    }
  }

  const { value: totalValue, discount: totalDiscount, confirmed: confirmedDeliveries } = listTotals;
  const totalAmount = totalValue - totalDiscount;
  const totalListPages = Math.max(1, Math.ceil(listTotal / pageSize));
  const paginationPages = totalListPages <= 5
    ? Array.from({ length: totalListPages }, (_, index) => index + 1)
    : listPage <= 3
      ? [1, 2, 3, 4, totalListPages]
      : listPage >= totalListPages - 2
        ? [1, totalListPages - 3, totalListPages - 2, totalListPages - 1, totalListPages]
        : [1, listPage - 1, listPage, listPage + 1, totalListPages];
  const firstVisibleOrder = listTotal === 0 ? 0 : (listPage - 1) * pageSize + 1;
  const lastVisibleOrder = Math.min(listPage * pageSize, listTotal);

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
      {(isCreateOrderOpen || editingManualOrderNumber !== null) && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-2 sm:p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setIsCreateOrderOpen(false);
              setEditingManualOrderNumber(null);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={editingManualOrderNumber ? `Chỉnh sửa đơn hàng ${editingManualOrderNumber}` : "Tạo đơn hàng"}
            className="max-h-[96vh] w-full max-w-[1500px] overflow-y-auto"
          >
            <CreateOrderForm
              key={editingManualOrderNumber ?? "create"}
              editOrderNumber={editingManualOrderNumber}
              onClose={() => {
                setIsCreateOrderOpen(false);
                setEditingManualOrderNumber(null);
              }}
              onSaved={(orderNumber) => {
                const wasEdit = editingManualOrderNumber !== null;
                setIsCreateOrderOpen(false);
                setEditingManualOrderNumber(null);
                setToast(wasEdit ? `Đơn hàng ${orderNumber} đã được cập nhật.` : `Đơn hàng ${orderNumber} đã được tạo.`);
                void loadLocalOrders().catch((error) => {
                  setRemoteError(error instanceof Error ? error.message : "Không thể tải lại danh sách đơn hàng.");
                });
              }}
            />
          </div>
        </div>
      )}
      {toast && (
        <div className="flex items-center justify-between gap-3 bg-sky-50 text-sky-700 rounded-xl px-4 py-3 text-sm">
          <span className="flex items-center gap-2"><CheckCircle2 size={16} /> <strong>{toast}</strong></span>
          <button onClick={() => setToast("")} className="text-sky-500 hover:text-sky-700"><Ban size={14} /></button>
        </div>
      )}
      <OrderSyncProgressPanel
        state={syncProgress}
        onClose={() => setSyncProgress((prev) => (prev ? { ...prev, visible: false } : null))}
      />
      <PageHeader
        title="Đơn hàng bán"
        subtitle="Quản lý đơn đặt hàng, phiếu bán và trạng thái xử lý"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {effectiveIsAdmin && (
              <button
                type="button"
                onClick={() => void openDeliveryRequestDrawer()}
                disabled={listTotal === 0}
                className="inline-flex items-center gap-1.5 rounded border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-xs font-semibold text-sky-700 transition-colors hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download size={14} />
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
              className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                pendingSplitRequestCount > 0
                  ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
                  : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              <ClipboardCheck size={14} />
              Kế toán duyệt tách đơn
              {pendingSplitRequestCount > 0 && (
                <span className="inline-flex items-center justify-center rounded-full bg-amber-600 px-2 py-0.5 text-xs font-bold text-white">
                  {pendingSplitRequestCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => void openSplitDrawer()}
              className="inline-flex items-center gap-1.5 rounded border border-purple-200 bg-purple-50 px-2.5 py-1.5 text-xs font-semibold text-purple-700 transition-colors hover:bg-purple-100"
            >
              <Split size={14} />
              Tách đơn
            </button>
            <button
              type="button"
              onClick={() => void openMergeDrawer()}
              className="inline-flex items-center gap-1.5 rounded border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100"
            >
              <Merge size={14} />
              Gộp đơn
            </button>
            <button type="button" onClick={() => setIsCreateOrderOpen(true)} className="inline-flex items-center gap-1.5 rounded bg-sky-600 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-700">
              <Plus size={14} />
              Tạo đơn hàng
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-2 overflow-hidden border border-slate-300 bg-white shadow-sm sm:grid-cols-3 xl:grid-cols-5">
        {[
          { label: "Tổng đơn hàng", value: formatNumber(allOrderCount), tone: "text-slate-800" },
          { label: "Tổng giá trị", value: formatVND(totalValue), tone: "text-slate-800" },
          { label: "Tổng chiết khấu", value: formatVND(totalDiscount), tone: "text-rose-700" },
          { label: "Tổng thành tiền", value: formatVND(totalAmount), tone: "text-sky-800" },
          { label: "Đã xác nhận giao", value: formatNumber(confirmedDeliveries), tone: "text-emerald-700" },
        ].map((stat) => (
          <div key={stat.label} className="border-b border-r border-slate-200 px-3 py-2.5 last:border-r-0">
            <p className="text-[10px] font-semibold text-slate-500">{stat.label}</p>
            <p className={`mt-0.5 truncate text-sm font-bold tabular-nums ${stat.tone}`} title={stat.value}>{stat.value}</p>
          </div>
        ))}
      </div>

      <section className="space-y-4">
        <div className="overflow-hidden border border-slate-400 bg-white shadow-lg">
          <div className="border-b border-sky-100 bg-sky-50/60 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase text-sky-800">
              Khoảng ngày và thao tác
            </span>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-600">
              <Clock3 size={13} className="text-sky-600" />
              Đồng bộ lần cuối:{" "}
              <strong className="font-mono text-slate-800">
                {lastSyncedAt
                  ? new Date(lastSyncedAt).toLocaleString("vi-VN", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })
                  : "Chưa đồng bộ"}
              </strong>
            </span>
          </div>
          <div className="border-b border-slate-200 px-3 py-2.5">
            <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2 xl:grid-cols-4">
              <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                Từ ngày
                <input type="date" value={fromDate} onChange={(event) => { setListPage(1); setFromDate(event.target.value); }} className={`${compactInputCls} mt-0.5`} aria-label="Từ ngày" />
              </label>
              <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                Đến ngày
                <input type="date" value={toDate} onChange={(event) => { setListPage(1); setToDate(event.target.value); }} className={`${compactInputCls} mt-0.5`} aria-label="Đến ngày" />
              </label>
              <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                Số đơn mỗi trang
                <select value={pageSize} onChange={(event) => { setListPage(1); setPageSize(Number(event.target.value)); }} className={`${compactInputCls} mt-0.5`}>
                  {[20, 50, 100, 500].map((size) => <option key={size} value={size}>{size} đơn/trang</option>)}
                </select>
              </label>
              <div className="flex flex-wrap items-end gap-2">
                <button type="button" onClick={handleSyncConfiguredSources} disabled={isSyncing} className="inline-flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300">
                  {isSyncing ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                  {isSyncing ? "Đang đồng bộ..." : "Đồng bộ"}
                </button>
                <button type="button" onClick={() => void downloadExcel()} disabled={listTotal === 0} className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
                  <Download size={13} /> Tải Excel toàn bộ
                </button>
              </div>
            </div>
          </div>
          <div className="border-b border-sky-100 bg-sky-50/60 px-3 py-2 text-[11px] font-bold uppercase text-sky-800">
            Lọc đơn hàng
          </div>
          <div className="border-b border-slate-200 px-3 py-2.5">
            <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-8">
              <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                Số đơn hàng
                <input value={orderFilter} onChange={(event) => { setListPage(1); setOrderFilter(event.target.value); }} placeholder="Lọc số đơn hàng" className={`${compactInputCls} mt-0.5`} />
              </label>
              <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                Khách hàng
                <input value={customerFilter} onChange={(event) => { setListPage(1); setCustomerFilter(event.target.value); }} placeholder="Lọc mã/tên khách hàng" className={`${compactInputCls} mt-0.5`} />
              </label>
              <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                Nhân viên bán hàng
                <input value={staffFilter} onChange={(event) => { setListPage(1); setStaffFilter(event.target.value); }} placeholder="Lọc mã/tên NVBH" className={`${compactInputCls} mt-0.5`} />
              </label>
              <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                Sản phẩm
                <input value={productFilter} onChange={(event) => { setListPage(1); setProductFilter(event.target.value); }} placeholder="Lọc mã/tên sản phẩm" className={`${compactInputCls} mt-0.5`} />
              </label>
              <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                Nhà cung cấp
                <select value={supplierFilter} onChange={(event) => { setListPage(1); setSupplierFilter(event.target.value); }} className={`${compactInputCls} mt-0.5`}>
                  <option value="Tất cả">Tất cả</option>
                  {serverSuppliers.map((sup) => <option key={sup} value={sup}>{sup}</option>)}
                </select>
              </label>
              <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                Tình trạng xử lý
                <select value={statusFilter} onChange={(event) => { setListPage(1); setStatusFilter(event.target.value); }} className={`${compactInputCls} mt-0.5`}>
                  <option value="Tất cả">Tất cả</option>
                  {remoteStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
              </label>
              <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                Tình trạng xuất kho
                <select value={deliveryStatusFilter} onChange={(event) => { setListPage(1); setDeliveryStatusFilter(event.target.value); }} className={`${compactInputCls} mt-0.5`}>
                  <option value="Tất cả">Tất cả</option>
                  {deliveryStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
              </label>
              <div className="flex items-end">
                <button type="button" onClick={clearFilters} className="rounded bg-red-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-800">
                  Xóa lọc
                </button>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-3 py-2">
            <p className="text-[10px] text-slate-500">
              {listLoading ? "Đang tải đơn hàng..." : `Có ${listTotal}/${allOrderCount} đơn hàng sau lọc.`}
            </p>
            {lastSyncedAt && <p className="text-[10px] text-slate-500">Cập nhật gần nhất: {formatVinamilkDate(lastSyncedAt, true)}</p>}
          </div>
        </div>
        {remoteError && <div className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"><AlertTriangle size={16} />{remoteError}</div>}
      </section>

      {remoteColumns.length > 0 ? (
        <DataTable
          data={orderSummaries}
          columns={summaryColumns.map((column) => ({ ...column, sortable: false }))}
          searchable={false}
          pageSize={500}
          hidePagination
          selectable
          selectedKeys={selectedSummaryKeys}
          onSelectedKeysChange={setSelectedSummaryKeys}
          toolbar={
            selectedSummaryKeys.size > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-700">
                  Đã chọn <span className="text-sky-700">{selectedSummaryKeys.size}</span> đơn hàng
                </span>
                <button
                  type="button"
                  disabled={isBulkDeletingOrders}
                  onClick={async () => {
                    const selectedRows = orderSummaries.filter((order) =>
                      selectedSummaryKeys.has(displayRemoteValue(order["_summary_key"]))
                    );
                    const targets = selectedRows
                      .map((order) => ({
                        order_number: displayRemoteValue(order["Số đơn hàng"]).trim(),
                        distributor_code: displayRemoteValue(order["_distributor_code"]).trim() || null,
                      }))
                      .filter((item) => item.order_number);
                    if (targets.length === 0) return;
                    const previewList = targets.slice(0, 5).map((t) => t.order_number).join(", ");
                    const moreText = targets.length > 5 ? ` và ${targets.length - 5} đơn khác` : "";
                    if (!window.confirm(`Xác nhận xóa ${targets.length} đơn hàng đã chọn (${previewList}${moreText})?`)) {
                      return;
                    }
                    setIsBulkDeletingOrders(true);
                    setRemoteError("");
                    try {
                      const res = await apiFetch(`${API_URL}/sync/vinamilk-orders/bulk-delete`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ orders: targets }),
                      });
                      const data = (await res.json().catch(() => ({}))) as {
                        deleted_count?: number;
                        detail?: string;
                      };
                      if (!res.ok) {
                        throw new Error(data.detail || "Không thể xóa các đơn hàng đã chọn.");
                      }
                      setSelectedSummaryKeys(new Set());
                      setToast(`Đã xóa ${data.deleted_count ?? targets.length} đơn hàng.`);
                      await loadLocalOrders();
                    } catch (error) {
                      setRemoteError(error instanceof Error ? error.message : "Không thể xóa các đơn hàng đã chọn.");
                    } finally {
                      setIsBulkDeletingOrders(false);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {isBulkDeletingOrders ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  Xóa đơn đã chọn ({selectedSummaryKeys.size})
                </button>
                <button
                  type="button"
                  disabled={isBulkDeletingOrders}
                  onClick={() => setSelectedSummaryKeys(new Set())}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
                >
                  Bỏ chọn
                </button>
              </div>
            ) : undefined
          }
          emptyMessage="Không có đơn hàng trong khoảng ngày đã chọn"
          getRowKey={(order) => displayRemoteValue(order["_summary_key"])}
          fitColumns
          compact
        />
      ) : (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-12 text-center text-sm text-gray-400">
          Chưa có dữ liệu trong database. Chọn khoảng ngày rồi bấm “Đồng bộ dữ liệu” để cập nhật từ các nguồn đã cấu hình.
        </div>
      )}
      <nav
        aria-label="Phân trang danh sách đơn hàng"
        className="flex flex-col gap-2 border-t border-slate-200 bg-white px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
      >
        <p className="text-center text-[11px] text-slate-600 sm:text-left">
          Hiển thị{" "}
          <span className="font-semibold tabular-nums text-slate-800">
            {firstVisibleOrder.toLocaleString("vi-VN")}–{lastVisibleOrder.toLocaleString("vi-VN")}
          </span>
          {" "}trong{" "}
          <span className="font-semibold tabular-nums text-slate-800">{listTotal.toLocaleString("vi-VN")}</span>
          {" "}đơn hàng
        </p>
        <div className="flex items-center justify-center gap-1">
          {[
            { label: "Về trang đầu", icon: <ChevronsLeft size={15} />, target: 1, disabled: listPage <= 1 },
            { label: "Trang trước", icon: <ChevronLeft size={15} />, target: listPage - 1, disabled: listPage <= 1 },
          ].map(({ label, icon, target, disabled }) => (
            <button
              key={label}
              type="button"
              aria-label={label}
              title={label}
              disabled={listLoading || disabled}
              onClick={() => setListPage(target)}
              className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-300 bg-white text-slate-600 transition-colors hover:border-sky-400 hover:bg-sky-50 hover:text-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-300"
            >
              {icon}
            </button>
          ))}
          {paginationPages.map((page, index) => (
            <Fragment key={page}>
              {index > 0 && page - paginationPages[index - 1] > 1 && (
                <span aria-hidden="true" className="px-1 text-xs text-slate-400">…</span>
              )}
              <button
                type="button"
                aria-label={`Trang ${page}`}
                aria-current={page === listPage ? "page" : undefined}
                disabled={listLoading}
                onClick={() => setListPage(page)}
                className={`inline-flex h-8 min-w-8 items-center justify-center rounded px-2 text-xs font-semibold tabular-nums transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-1 disabled:cursor-wait ${
                  page === listPage
                    ? "bg-sky-700 text-white shadow-sm"
                    : "border border-slate-300 bg-white text-slate-700 hover:border-sky-400 hover:bg-sky-50 hover:text-sky-700"
                }`}
              >
                {page}
              </button>
            </Fragment>
          ))}
          {[
            { label: "Trang sau", icon: <ChevronRight size={15} />, target: listPage + 1, disabled: listPage >= totalListPages },
            { label: "Về trang cuối", icon: <ChevronsRight size={15} />, target: totalListPages, disabled: listPage >= totalListPages },
          ].map(({ label, icon, target, disabled }) => (
            <button
              key={label}
              type="button"
              aria-label={label}
              title={label}
              disabled={listLoading || disabled}
              onClick={() => setListPage(target)}
              className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-300 bg-white text-slate-600 transition-colors hover:border-sky-400 hover:bg-sky-50 hover:text-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-300"
            >
              {icon}
            </button>
          ))}
        </div>
      </nav>

      <OrderActionModal
        open={detailOrderNumber !== null}
        onClose={() => { detailRequestVersion.current++; setDetailOrderNumber(null); }}
        title={`Chi tiết đơn hàng ${detailOrderNumber ?? ""}`}
        subtitle={detailLoading ? "Đang tải chi tiết..." : `${detailOrderLines.length} dòng sản phẩm`}
        footer={
          <div className="flex items-center justify-between gap-3">
            <p className="hidden text-[10px] text-slate-500 sm:block">
              Kiểm tra thông tin đơn hàng trước khi thực hiện tác vụ.
            </p>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              {detailOrderNumber && !detailLoading && detailOrderLines.length > 0 && (
                <button
                  type="button"
                  disabled={deletingManualOrder}
                  onClick={() => {
                    const firstLine = detailOrderLines[0] || {};
                    const currCode = String(
                      firstLine.customerCode ?? firstLine.shopCode ?? firstLine["Mã KH"] ?? ""
                    );
                    const currName = String(
                      firstLine.customerName ?? firstLine.shopName ?? firstLine["Tên KH"] ?? ""
                    );
                    setChangeCustomerOrder({
                      orderNumber: detailOrderNumber,
                      currentCode: currCode,
                      currentName: currName,
                    });
                    setChangeCustomerSearch("");
                    setNewCustomerCode(currCode);
                    setNewCustomerName(currName);
                    setNewCustomerAddress(
                      String(firstLine.customerAddress ?? firstLine.address ?? firstLine["Địa chỉ"] ?? "")
                    );
                    setChangeCustomerError("");
                  }}
                  className="inline-flex items-center gap-1.5 rounded bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <Pencil size={13} />
                  Đổi mã KH
                </button>
              )}
              {detailOrderNumber?.toUpperCase().startsWith("TC-") && !detailLoading && detailOrderLines.length > 0 && (
                <>
                  <button
                    type="button"
                    disabled={deletingManualOrder}
                    onClick={async () => {
                      if (!detailOrderNumber) return;
                      if (!window.confirm(`Xác nhận xóa đơn hàng tự tạo ${detailOrderNumber}?`)) return;
                      setDeletingManualOrder(true);
                      setDetailError("");
                      try {
                        const res = await apiFetch(
                          `${API_URL}/sync/vinamilk-orders/manual/${encodeURIComponent(detailOrderNumber)}`,
                          { method: "DELETE" }
                        );
                        const data = (await res.json().catch(() => ({}))) as { detail?: string };
                        if (!res.ok) throw new Error(data.detail || "Không thể xóa đơn hàng.");
                        const deletedNumber = detailOrderNumber;
                        detailRequestVersion.current++;
                        setDetailOrderNumber(null);
                        setToast(`Đã xóa đơn hàng tự tạo ${deletedNumber}.`);
                        void loadLocalOrders().catch((error) => {
                          setRemoteError(error instanceof Error ? error.message : "Không thể tải lại danh sách đơn hàng.");
                        });
                      } catch (error) {
                        setDetailError(error instanceof Error ? error.message : "Không thể xóa đơn hàng.");
                      } finally {
                        setDeletingManualOrder(false);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {deletingManualOrder ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    Xóa đơn
                  </button>
                  <button
                    type="button"
                    disabled={deletingManualOrder}
                    onClick={() => {
                      const targetOrder = detailOrderNumber;
                      detailRequestVersion.current++;
                      setDetailOrderNumber(null);
                      setIsCreateOrderOpen(false);
                      setEditingManualOrderNumber(targetOrder);
                    }}
                    className="inline-flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    <Pencil size={13} />
                    Sửa đơn
                  </button>
                </>
              )}
              <button type="button" onClick={() => { detailRequestVersion.current++; setDetailOrderNumber(null); }} className="rounded bg-red-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-800">Đóng</button>
            </div>
          </div>
        }
      >
        <div className="space-y-2.5 bg-slate-50/60 p-3">
          {detailError && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700">{detailError}</p>}
          {detailLoading && (
            <div className="flex items-center gap-2 py-6 text-xs text-slate-500">
              <Loader2 size={14} className="animate-spin text-sky-600" /> Đang tải chi tiết đơn hàng...
            </div>
          )}
          {!detailLoading && !detailError && detailOrderLines.length > 0 && (() => {
            const first = detailOrderLines[0];
            const customerCode = displayRemoteValue(first["Mã KH"]).trim();
            const customerName = displayRemoteValue(first["Tên KH"]).trim();
            const customerAddress = displayRemoteValue(first["Địa chỉ"]).trim();
            const createdDate = displayRemoteValue(first["Ngày tạo"]).trim();
            const deliveryDate = displayRemoteValue(first["Ngày giao"]).trim();
            const distributorName = displayRemoteValue(first["NPP"] || first["Nhà phân phối"]).trim();
            const staffName = displayRemoteValue(first["Tên NVBH"] || first["staffName"]).trim();
            const staffCode = displayRemoteValue(first["Mã NVBH"] || first["staffCode"]).trim();
            const orderStatus = displayRemoteValue(first["Tình trạng xử lý đơn hàng"] || first["Trạng thái"]).trim();

            const isPromoOrDiscountOnly = (line: RemoteOrder) => {
              const qty = numericValue(line["Số lượng"]);
              const promoQty = numericValue(line["Số lượng KM"]);
              const ck = numericValue(line["Số tiền CK"]);
              const code = displayRemoteValue(line["Mã sản phẩm"]).trim().toUpperCase();
              const name = displayRemoteValue(line["Sản phẩm"] || line["Tên sản phẩm"]).trim().toLowerCase();
              return (
                qty <= 0 &&
                (promoQty > 0 || ck > 0 || code === "CHIETKHAU" || name === "chiết khấu" || name === "chiet khau")
              );
            };

            const saleLines = detailOrderLines.filter((line) => !isPromoOrDiscountOnly(line));
            const promoLines = detailOrderLines.filter((line) => isPromoOrDiscountOnly(line));
            const inlinePromoLines = saleLines.filter(
              (line) =>
                numericValue(line["Số lượng KM"]) > 0 ||
                numericValue(line["Số tiền CK"]) > 0 ||
                displayRemoteValue(line["Tên CTKM"]).trim() !== ""
            );
            const allPromoLines = [...promoLines, ...inlinePromoLines];

            const totalGoodsValue = saleLines.reduce((sum, line) => sum + numericValue(line["Giá trị"]), 0);
            const totalDiscountVal = detailOrderLines.reduce((sum, line) => sum + numericValue(line["Số tiền CK"]), 0);
            const netPayable = Math.max(0, totalGoodsValue - totalDiscountVal);

            return (
              <>
                {/* Khối 1: Thông tin chung đơn hàng */}
                <div className="overflow-hidden border border-slate-300 bg-white">
                  <div className="flex items-center justify-between border-b border-sky-100 bg-sky-50/60 px-3 py-1.5">
                    <span className="text-[11px] font-bold uppercase text-sky-800">Thông tin chung đơn hàng</span>
                    {orderStatus && (
                      <span className="rounded bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-800">
                        {orderStatus}
                      </span>
                    )}
                  </div>
                  <div className="grid gap-x-4 gap-y-1.5 border-b border-slate-200 px-3 py-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <span className="block text-[10px] font-semibold text-slate-500">Khách hàng</span>
                      <span className="font-semibold text-slate-800">
                        {customerCode ? `${formatCustomerCode(customerCode)} · ` : ""}
                        {customerName || "—"}
                      </span>
                    </div>
                    <div>
                      <span className="block text-[10px] font-semibold text-slate-500">Nhà phân phối</span>
                      <span className="font-medium text-slate-800">{distributorName || "—"}</span>
                    </div>
                    <div>
                      <span className="block text-[10px] font-semibold text-slate-500">Ngày tạo / Ngày giao</span>
                      <span className="font-medium tabular-nums text-slate-800">
                        {createdDate || "—"}
                        {deliveryDate && deliveryDate !== createdDate ? ` · Giao: ${deliveryDate}` : ""}
                      </span>
                    </div>
                    <div>
                      <span className="block text-[10px] font-semibold text-slate-500">Nhân viên bán hàng</span>
                      <span className="font-medium text-slate-800">
                        {staffName || staffCode ? `${staffName || staffCode}${staffName && staffCode ? ` (${staffCode})` : ""}` : "—"}
                      </span>
                    </div>
                    {customerAddress && (
                      <div className="sm:col-span-2 lg:col-span-4">
                        <span className="text-[10px] font-semibold text-slate-500">Địa chỉ: </span>
                        <span className="text-xs text-slate-700">{customerAddress}</span>
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-3 divide-x divide-slate-200 bg-slate-50/70 px-3 py-2 text-xs">
                    <div className="pr-3">
                      <span className="block text-[10px] font-semibold text-slate-500">Tổng tiền hàng</span>
                      <span className="text-sm font-bold tabular-nums text-slate-800">{formatVNDFull(totalGoodsValue)}</span>
                    </div>
                    <div className="px-3">
                      <span className="block text-[10px] font-semibold text-slate-500">Chiết khấu</span>
                      <span className="text-sm font-bold tabular-nums text-red-600">
                        {totalDiscountVal > 0 ? `-${formatVNDFull(totalDiscountVal)}` : "0 đ"}
                      </span>
                    </div>
                    <div className="pl-3">
                      <span className="block text-[10px] font-semibold text-slate-500">Phải thanh toán</span>
                      <span className="text-sm font-bold tabular-nums text-sky-700">{formatVNDFull(netPayable)}</span>
                    </div>
                  </div>
                </div>

                {/* Khối 2: Danh sách sản phẩm đặt hàng */}
                <div className="overflow-hidden border border-slate-300 bg-white">
                  <div className="flex items-center justify-between border-b border-sky-100 bg-sky-50/60 px-3 py-1.5">
                    <span className="text-[11px] font-bold uppercase text-sky-800">
                      Danh sách sản phẩm đặt hàng ({saleLines.length})
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left">
                      <thead className="bg-slate-100 text-[10px] font-semibold uppercase text-slate-600">
                        <tr>
                          <th className="w-9 px-2 py-1.5 text-center">TT</th>
                          <th className="px-2 py-1.5">Mã SP</th>
                          <th className="px-2 py-1.5">Tên sản phẩm</th>
                          <th className="px-2 py-1.5">Nhà cung cấp</th>
                          <th className="px-2 py-1.5 text-center">ĐVT</th>
                          <th className="px-2 py-1.5 text-center">SL</th>
                          <th className="px-2 py-1.5 text-right">Đơn giá</th>
                          <th className="px-2 py-1.5 text-right">Thành tiền</th>
                        </tr>
                      </thead>
                      <tbody className="text-[11px]">
                        {saleLines.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="px-3 py-5 text-center text-xs text-slate-400">
                              Không có dòng sản phẩm bán.
                            </td>
                          </tr>
                        ) : (
                          saleLines.map((line, idx) => {
                            const code = displayRemoteValue(line["Mã sản phẩm"]).trim();
                            const name = displayRemoteValue(line["Sản phẩm"] || line["Tên sản phẩm"]).trim();
                            const supplier = displayRemoteValue(line["Nhà cung cấp"]).trim();
                            const unit = displayRemoteValue(line["ĐVT"]).trim();
                            const qty = numericValue(line["Số lượng"]);
                            const price = numericValue(line["Đơn giá"] || line["Giá bán"]);
                            const value = numericValue(line["Giá trị"]);
                            return (
                              <tr key={orderRowKey(line, idx)} className="border-b border-slate-100 even:bg-amber-50/40 hover:bg-sky-50/50">
                                <td className="px-2 py-1.5 text-center text-slate-500">{idx + 1}</td>
                                <td className="whitespace-nowrap px-2 py-1.5 font-mono font-semibold text-sky-800">{code || "—"}</td>
                                <td className="px-2 py-1.5 font-medium text-slate-800">{name || "—"}</td>
                                <td className="whitespace-nowrap px-2 py-1.5">
                                  {supplier ? (
                                    <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                                      {supplier}
                                    </span>
                                  ) : (
                                    <span className="text-slate-400">—</span>
                                  )}
                                </td>
                                <td className="whitespace-nowrap px-2 py-1.5 text-center text-slate-700">{unit || "—"}</td>
                                <td className="whitespace-nowrap px-2 py-1.5 text-center font-semibold tabular-nums text-slate-800">{formatNumber(qty)}</td>
                                <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-slate-700">{formatNumber(price)}</td>
                                <td className="whitespace-nowrap px-2 py-1.5 text-right font-semibold tabular-nums text-slate-800">{formatNumber(value)}</td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                      {saleLines.length > 0 && (
                        <tfoot className="border-t border-slate-200 bg-slate-50 text-[10px] font-semibold text-slate-600">
                          <tr>
                            <td colSpan={7} className="px-2 py-1.5 text-right">Tổng tiền hàng</td>
                            <td className="whitespace-nowrap px-2 py-1.5 text-right font-bold tabular-nums text-slate-900">
                              {formatVNDFull(totalGoodsValue)}
                            </td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </div>

                {/* Khối 3: Khuyến mại & Chiết khấu nhận được */}
                {allPromoLines.length > 0 && (
                  <div className="overflow-hidden border border-slate-300 bg-white">
                    <div className="border-b border-emerald-100 bg-emerald-50/70 px-3 py-1.5 text-[11px] font-bold uppercase text-emerald-800">
                      Khuyến mại &amp; Chiết khấu nhận được ({allPromoLines.length})
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-left">
                        <thead className="bg-slate-100 text-[10px] font-semibold uppercase text-slate-600">
                          <tr>
                            <th className="w-9 px-2 py-1.5 text-center">TT</th>
                            <th className="px-2 py-1.5">Tên chương trình KM</th>
                            <th className="px-2 py-1.5">Mã SP</th>
                            <th className="px-2 py-1.5">Sản phẩm KM / Loại</th>
                            <th className="px-2 py-1.5 text-right">SL KM / Tiền CK</th>
                          </tr>
                        </thead>
                        <tbody className="text-[11px]">
                          {allPromoLines.map((line, idx) => {
                            const programName = displayRemoteValue(line["Tên CTKM"] || line["Mã CTKM"]).trim();
                            const code = displayRemoteValue(line["Mã sản phẩm"]).trim();
                            const name = displayRemoteValue(line["Sản phẩm"] || line["Tên sản phẩm"]).trim();
                            const unit = displayRemoteValue(line["ĐVT"]).trim();
                            const promoQty = numericValue(line["Số lượng KM"]);
                            const ck = numericValue(line["Số tiền CK"]);
                            const isCashDiscount =
                              ck > 0 && promoQty <= 0 &&
                              (code.toUpperCase() === "CHIETKHAU" || name.toLowerCase().includes("chiết khấu") || numericValue(line["Số lượng"]) <= 0);
                            return (
                              <tr key={`promo-${orderRowKey(line, idx)}`} className="border-b border-slate-100 even:bg-amber-50/40 hover:bg-sky-50/50">
                                <td className="px-2 py-1.5 text-center text-slate-500">{idx + 1}</td>
                                <td className="px-2 py-1.5 font-medium text-slate-800">{programName || "—"}</td>
                                <td className="whitespace-nowrap px-2 py-1.5 font-mono text-slate-600">
                                  {isCashDiscount ? "CHIETKHAU" : (code || "—")}
                                </td>
                                <td className="px-2 py-1.5 text-slate-700">{name || "—"}</td>
                                <td className="whitespace-nowrap px-2 py-1.5 text-right">
                                  <div className="inline-flex items-center justify-end gap-1.5">
                                    {promoQty > 0 && (
                                      <span className="rounded bg-emerald-100 px-2 py-0.5 font-semibold tabular-nums text-emerald-800">
                                        {formatNumber(promoQty)} {unit || "Hộp"}
                                      </span>
                                    )}
                                    {ck > 0 && (
                                      <span className="rounded bg-red-100 px-2 py-0.5 font-semibold tabular-nums text-red-700">
                                        -{formatVNDFull(ck)}
                                      </span>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Khối 4: Gán đơn hàng thay thế (Giao 1 phần) & Tạo lệnh trả hàng về kho */}
                {detailOrderNumber && (
                  <OrderDetailReplacementPanel
                    orderNumber={detailOrderNumber}
                    customerCode={customerCode}
                    onConfirmed={({ returnCode, oldOrderNumber, newOrderNumber }) => {
                      setToast(
                        `Đã chuyển đơn ${oldOrderNumber} sang Giao 1 phần, đơn ${newOrderNumber} sang Đã giao và tạo lệnh trả kho ${returnCode}.`
                      );
                      void loadLocalOrders().catch(() => {});
                    }}
                  />
                )}
              </>
            );
          })()}
          {!detailLoading && !detailError && detailOrderLines.length === 0 && (
            <p className="py-6 text-center text-xs text-slate-400">Không tìm thấy chi tiết đơn hàng.</p>
          )}
        </div>
      </OrderActionModal>

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
                if (!allVisibleSelected) {
                  // Đơn tách ưu tiên NVGH đã chọn; các đơn khác ưu tiên NVQL.
                  setDeliveryEmployeeAssignments((current) => {
                    const updated = { ...current };
                    filteredDeliveryRequestOrders.forEach((order) => {
                      if (updated[order.order_number]) return;
                      const employee = defaultDeliveryEmployee(order);
                      if (employee) updated[order.order_number] = employee.code;
                    });
                    return updated;
                  });
                }
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

      <OrderActionModal
        open={isSplitDrawerOpen}
        onClose={() => { if (!isSubmittingSplit) setIsSplitDrawerOpen(false); }}
        title="Tách đơn"
        subtitle="Phân bổ sản phẩm từ đơn gốc"
        footer={
          <div className="space-y-2">
            {splitError && <div role="alert" className="max-h-20 overflow-y-auto text-[10px] text-red-700">{splitError}</div>}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[10px] text-amber-800">Đơn tách chờ Kế toán duyệt.</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setIsSplitDrawerOpen(false)} disabled={isSubmittingSplit} className="rounded bg-red-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50">Hủy</button>
                <button type="button" onClick={() => void submitSplitOrder()} disabled={isSubmittingSplit || !selectedSplitOrderGroup} className="inline-flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300">
                  {isSubmittingSplit ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                  {isSubmittingSplit ? "Đang gửi..." : "Gửi Kế toán duyệt"}
                </button>
              </div>
            </div>
          </div>
        }
      >
        <div className="min-w-0 space-y-5 p-3 sm:p-5">

          {!effectiveIsAdmin && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-2.5 text-xs text-amber-800">
              <Clock3 size={15} className="shrink-0" />
              <span>
                Chỉ được tách đơn ngày <strong>{toVinamilkDate(todayInputStr)}</strong>. Đơn ngày cũ cần Admin xử lý.
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className="block text-sm text-gray-700">
              1. Tìm đơn
              <input
                value={splitOrderSearch}
                onChange={(e) => setSplitOrderSearch(e.target.value)}
                placeholder="Tìm mã đơn, tên KH, NVBH..."
                className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm text-gray-700">
              2. Đơn gốc ({filteredSplitOrderOptions.length})
              <select
                value={selectedSplitOrderNumber}
                onChange={(e) => handleSelectSplitOrder(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              >
                <option value="">-- Chọn đơn --</option>
                {filteredSplitOrderOptions.map((group) => (
                  <option key={group.orderNumber} value={group.orderNumber}>
                    {group.orderNumber} — {group.customerName || group.customerCode} ({group.lines.length} SP, {formatVND(group.totalValue)})
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-gray-700">
              3. Số đơn tách (chọn 1 để đổi KH)
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
                    <strong>KH:</strong> {selectedSplitOrderGroup.customerName} ({selectedSplitOrderGroup.customerCode})
                    {" | "}
                    <strong>NVBH:</strong> {selectedSplitOrderGroup.staffName}
                  </div>
                  <div>
                    <strong>Tổng:</strong>{" "}
                    SL: <strong>{selectedSplitOrderGroup.totalQty}</strong>
                    {" | "}
                    SL KM: <strong className="text-amber-700">{selectedSplitOrderGroup.totalPromoQty}</strong>
                    {" | "}
                    Giá trị: <strong className="text-emerald-700">{formatVND(selectedSplitOrderGroup.totalValue)}</strong>
                    {" | "}
                    CK: <strong className="text-rose-700">{formatVND(selectedSplitOrderGroup.totalDiscount)}</strong>
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
                    Tính lại giá trị & CK
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
                        Điền phần còn lại vào đơn {splitCount}
                      </button>
                    </>
                  )}
                  <label className="flex flex-wrap items-center gap-2 text-xs font-medium text-gray-700">
                    NVGH nhận phần thiếu
                    <select aria-label="NVGH nhận phần thiếu" value={remainderDeliveryEmployee} onChange={(event) => setRemainderDeliveryEmployee(event.target.value)} disabled={isLoadingDeliveryEmployees || !!deliveryEmployeeError} className="min-h-10 max-w-full rounded border border-gray-300 bg-white px-2 py-1">
                      <option value="">Chọn NVGH</option>
                      {deliveryEmployees.map((employee) => <option key={employee.code} value={employee.code}>{employee.code} - {employee.name}</option>)}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={assignRemainderToStaffSplit}
                    className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
                    title="Tự động gom phần thiếu vào đơn tách gắn cho NVGH đã chọn"
                  >
                    Tách phần thiếu cho NVGH
                  </button>
                </div>
              </div>

              {/* Chọn Mã KH và xem Tổng hợp Giá trị / Số tiền CK cho từng đơn tách */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                  4. Người nhận & tổng đơn tách
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
                                Nhận NVGH
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
                              Người nhận:
                            </span>
                            <div className="flex items-center gap-2">
                              {!isStaffDebt ? (
                                <button
                                  type="button"
                                  onClick={() => handleSetSplitToStaffDebt(splitIdx)}
                                  className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 hover:bg-amber-100"
                                >
                                  Gắn cho NVGH
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleSelectSplitCustomer(splitIdx, selectedSplitOrderGroup.customerCode)
                                  }
                                  className="rounded border border-purple-200 bg-white px-2 py-0.5 text-[11px] font-medium text-purple-700 hover:bg-purple-50"
                                >
                                  Chọn khách hàng
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
                                NVGH nhận phần thiếu:{" "}
                                {deliveryEmployees.find((employee) => employee.code === splitDeliveryEmployees[splitIdx])?.name || "Chưa chọn NVGH"}
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
                                  <option value={selectedCust.customer_code} title={selectedCust.customer_code}>
                                    {formatCustomerCode(selectedCust.customer_code)} — {selectedCust.customer_name || "Khách hàng hiện tại"}
                                  </option>
                                )}
                                {filteredCustomers.map((c) => (
                                  <option key={c.customer_code} value={c.customer_code} title={c.customer_code}>
                                    {formatCustomerCode(c.customer_code)} — {c.customer_name}
                                    {c.company_name ? ` [${c.company_name}]` : ""}
                                  </option>
                                ))}
                              </select>
                            </>
                          )}
                        </div>

                        <label className="block font-medium text-gray-700">
                          NVGH đơn tách {splitIdx + 1}
                          <select
                            aria-label={`NVGH đơn tách ${splitIdx + 1}`}
                            value={splitDeliveryEmployees[splitIdx] ?? ""}
                            onChange={(event) => setSplitDeliveryEmployees((current) => {
                              const next = [...current];
                              next[splitIdx] = event.target.value;
                              return next;
                            })}
                            disabled={isLoadingDeliveryEmployees || !!deliveryEmployeeError}
                            className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs"
                          >
                            <option value="">Chưa chọn NVGH</option>
                            {deliveryEmployees.map((employee) => <option key={employee.code} value={employee.code}>{employee.code} - {employee.name}</option>)}
                          </select>
                          {deliveryEmployeeError && <span className="mt-1 block text-red-600">{deliveryEmployeeError}</span>}
                        </label>

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
                              inputMode="decimal"
                              aria-label={`Tổng giá trị đơn tách ${splitIdx + 1}`}
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

              <p className="text-xs text-gray-500">Vuốt ngang để xem các đơn tách.</p>
              <div role="region" aria-label="Bảng phân bổ đơn tách, cuộn ngang để xem thêm" tabIndex={0} className="max-w-full overflow-x-auto rounded-xl border border-gray-200">
                <table className="min-w-max w-full divide-y divide-gray-200 text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th rowSpan={2} className="sticky left-0 z-10 w-28 min-w-28 max-w-28 border-r border-gray-200 bg-gray-50 px-3 py-2.5 text-left font-semibold text-gray-700 sm:w-48 sm:min-w-48 sm:max-w-48">
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
                              Đơn tách {idx + 1} {isStaffDebt ? "(NVGH nhận)" : ""}
                            </div>
                            <div className="text-[10px] font-normal text-gray-500">
                              TD-{selectedSplitOrderGroup.orderNumber}-{String(idx + 1).padStart(2, "0")}
                            </div>
                            {(cust?.customer_code || isStaffDebt) && (
                              <div
                                className={`text-[10px] font-medium truncate max-w-[180px] mx-auto ${
                                  isStaffDebt ? "text-amber-700" : "text-purple-600"
                                }`}
                                title={`${cust.customer_code} - ${cust.customer_name}`}
                              >
                                {isStaffDebt
                                  ? `NVGH: ${splitDeliveryEmployees[idx] || "Chưa chọn"}`
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
                        SL (Thùng / Hộp)
                      </th>
                      <th className="px-2 py-1.5 text-right font-semibold text-amber-700 border-r border-gray-200 bg-amber-50/30">
                        KM (Thùng / Hộp)
                      </th>
                      {Array.from({ length: splitCount }, (_, idx) => (
                        <Fragment key={`sub-${idx}`}>
                          <th className="px-2 py-1.5 text-right font-semibold text-gray-700 border-r border-gray-100">
                            SL (Thùng / Hộp)
                          </th>
                          <th className="px-2 py-1.5 text-right font-semibold text-amber-700 border-r border-gray-200 bg-amber-50/20">
                            KM (Thùng / Hộp)
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
                      const rawBoxesPerCarton = line["_boxes_per_carton"];
                      const boxesPerCarton = typeof rawBoxesPerCarton === "number" && Number.isInteger(rawBoxesPerCarton) && rawBoxesPerCarton > 0
                        ? rawBoxesPerCarton : null;
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
                          <td className="sticky left-0 z-10 w-28 min-w-28 max-w-28 border-r border-gray-200 bg-white px-3 py-2 align-top sm:w-48 sm:min-w-48 sm:max-w-48">
                            <div className="break-words font-medium text-gray-900">{prodCode} — {prodName}</div>
                            {promoCode && <div className="text-[11px] text-gray-500">CTKM: {promoCode}</div>}
                            {!boxesPerCarton && (
                              <div className="text-[11px] text-gray-500">Chưa có quy cách; nhập theo ĐVT gốc</div>
                            )}
                            <div className="text-[11px] text-emerald-700">
                              Giá trị gốc: {formatVND(origVal)}
                              {origDisc > 0 ? ` | CK gốc: ${formatVND(origDisc)}` : ""}
                            </div>
                          </td>
                          <td className="px-2 py-2 text-center align-middle text-gray-600 border-r border-gray-100">
                            {unit}
                          </td>
                          <td className="px-2.5 py-2 text-right align-middle font-semibold text-gray-900 border-r border-gray-100">
                            <SplitOriginalQuantity quantity={origQty} boxesPerCarton={boxesPerCarton} />
                          </td>
                          <td className="px-2.5 py-2 text-right align-middle font-semibold text-amber-700 border-r border-gray-200 bg-amber-50/20">
                            <SplitOriginalQuantity quantity={origPromo} boxesPerCarton={boxesPerCarton} />
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
                                    <SplitQuantityInput quantity={cell.quantity} boxesPerCarton={boxesPerCarton}
                                      label={`số lượng ${prodCode}, đơn tách ${splitIdx + 1}`}
                                      onChange={(value) => updateSplitCell(localId, splitIdx, "quantity", value)} />
                                    {(cell.quantity > 0 || cell.promoQuantity > 0) && (
                                      <div className="w-full rounded bg-white/90 px-1.5 py-1 text-[10px] leading-tight border border-purple-100 space-y-1">
                                        <label className="flex items-center justify-between gap-1 text-emerald-700 font-medium">
                                          <span>GT:</span>
                                          <input
                                            type="number"
                                            inputMode="decimal"
                                            aria-label={`Giá trị ${prodCode}, đơn tách ${splitIdx + 1}`}
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
                                            className="min-h-10 w-20 rounded border border-emerald-200 bg-emerald-50/20 px-1 py-0.5 text-right text-xs font-semibold text-emerald-800 focus:border-emerald-500 focus:outline-none"
                                          />
                                        </label>
                                        {selectedSplitOrderGroup.totalDiscount > 0 && (
                                          <label className="flex items-center justify-between gap-1 text-rose-700">
                                            <span>CK:</span>
                                            <input
                                              type="number"
                                              inputMode="decimal"
                                              aria-label={`Chiết khấu ${prodCode}, đơn tách ${splitIdx + 1}`}
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
                                              className="min-h-10 w-20 rounded border border-rose-200 bg-rose-50/20 px-1 py-0.5 text-right text-xs font-medium text-rose-800 focus:border-rose-500 focus:outline-none"
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
                                    <SplitQuantityInput quantity={cell.promoQuantity} boxesPerCarton={boxesPerCarton}
                                      label={`số lượng khuyến mại ${prodCode}, đơn tách ${splitIdx + 1}`}
                                      onChange={(value) => updateSplitCell(localId, splitIdx, "promoQuantity", value)} />
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
                      <td className="sticky left-0 z-10 w-28 min-w-28 max-w-28 border-r border-gray-200 bg-gray-50 px-3 py-2.5 text-right align-top sm:w-48 sm:min-w-48 sm:max-w-48">
                        <div>Tổng cộng:</div>
                        <div className="text-[11px] font-normal text-emerald-700">
                          GT gốc: {formatVND(selectedSplitOrderGroup.totalValue)}
                        </div>
                        <div className="text-[11px] font-normal text-rose-700">
                          CK gốc: {formatVND(selectedSplitOrderGroup.totalDiscount)}
                        </div>
                        <div className="mt-1 text-[11px] text-indigo-800">
                          Tổng thành tiền: {formatVNDFull(selectedSplitOrderGroup.totalValue - selectedSplitOrderGroup.totalDiscount)}
                        </div>
                      </td>
                      <td className="border-r border-gray-200 bg-gray-50" />
                      <td className="px-2.5 py-2.5 text-right align-top border-r border-gray-200">
                        <span title="Tổng theo ĐVT gốc">{selectedSplitOrderGroup.totalQty} <span className="text-[10px] font-normal text-gray-500">ĐVT gốc</span></span>
                      </td>
                      <td className="px-2.5 py-2.5 text-right align-top text-amber-700 border-r border-gray-200 bg-amber-50/30">
                        <span title="Tổng theo ĐVT gốc">{selectedSplitOrderGroup.totalPromoQty} <span className="text-[10px] font-normal text-gray-500">ĐVT gốc</span></span>
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
                              <div className="text-gray-900">{totals.totalQty} <span className="text-[10px] font-normal text-gray-500">ĐVT gốc</span></div>
                              <div className="text-[11px] text-emerald-700">
                                GT: {formatVND(totals.totalValue)}
                              </div>
                              <div className="text-[11px] text-rose-700">
                                CK: {formatVND(totals.totalDiscount)}
                              </div>
                              <div className="mt-1 text-[11px] text-indigo-800">
                                Thành tiền: {formatVNDFull(totals.totalValue - totals.totalDiscount)}
                              </div>
                            </td>
                            <td className="px-2 py-2.5 text-right align-top text-amber-700 bg-amber-50/25 border-r border-gray-200">
                              {totals.totalPromoQty} <span className="text-[10px] font-normal text-gray-500">ĐVT gốc</span>
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
                        <div className="mt-1 text-[11px] text-indigo-800">
                          Còn: {formatVNDFull(
                            selectedSplitOrderGroup.totalValue - selectedSplitOrderGroup.totalDiscount
                            - splitFinancials.splitTotals.reduce((sum, totals) => sum + totals.totalValue - totals.totalDiscount, 0)
                          )}
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

            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-500">
              Chọn đơn gốc để bắt đầu.
            </div>
          )}
        </div>
      </OrderActionModal>

      {/* Drawer Kế toán xác nhận duyệt Tách đơn */}
      <Drawer
        open={isSplitApprovalDrawerOpen}
        onClose={() => setIsSplitApprovalDrawerOpen(false)}
        title="Kế toán xác nhận Tách đơn hàng"
        subtitle="Kiểm tra chi tiết số lượng, số lượng KM, giá trị, chiết khấu và đối tượng nhận trước khi duyệt tách đơn trên hệ thống DMS nội bộ"
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
                        const isStaffDebt = Boolean(sp.is_staff_debt || sp.delivery_recipient);
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
                            <div className="text-gray-600">
                              <strong>NVGH:</strong> {sp.delivery_employee_code ? `${sp.delivery_employee_code} - ${sp.delivery_employee_name || ""}` : "Chưa chọn"}
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

      <OrderActionModal
        open={isMergeDrawerOpen}
        onClose={() => { if (!isSubmittingMerge) setIsMergeDrawerOpen(false); }}
        title="Gộp đơn"
        subtitle="Chọn ít nhất 2 đơn"
        footer={
          <div className="space-y-2">
            {mergeError && <div role="alert" className="max-h-20 overflow-y-auto text-[10px] text-red-700">{mergeError}</div>}
            <div className="flex gap-2 sm:justify-end">
              <button type="button" onClick={() => setIsMergeDrawerOpen(false)} disabled={isSubmittingMerge} className="rounded bg-red-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50">Hủy</button>
              <button type="button" onClick={() => void submitMergeOrders()} disabled={isSubmittingMerge || selectedMergeOrderNumbers.length < 2} className="inline-flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300">
                {isSubmittingMerge ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                {isSubmittingMerge ? "Đang gộp đơn..." : `Xác nhận gộp (${selectedMergeOrderNumbers.length} đơn)`}
              </button>
            </div>
          </div>
        }
      >
        <div className="min-w-0 space-y-5 p-3 sm:p-5">

          {!effectiveIsAdmin && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-2.5 text-xs text-amber-800">
              <Clock3 size={15} className="shrink-0" />
              <span>
                Chỉ được gộp đơn ngày <strong>{toVinamilkDate(todayInputStr)}</strong>. Đơn ngày cũ cần Admin xử lý.
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="block text-sm text-gray-700">
              Tìm đơn
              <input
                value={mergeOrderSearch}
                onChange={(e) => setMergeOrderSearch(e.target.value)}
                placeholder="Nhập số đơn hàng, tên KH, NVBH..."
                className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </label>
            {selectedMergeOrderNumbers.length >= 2 && (
              <label className="block text-sm text-gray-700">
                Đơn đại diện (ngày, KH và NVBH mặc định)
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

          <label className="block text-sm text-gray-700">
            NVGH (không bắt buộc)
            <select
              value={mergeDeliveryEmployee}
              onChange={(event) => setMergeDeliveryEmployee(event.target.value)}
              disabled={isLoadingDeliveryEmployees || !!deliveryEmployeeError}
              className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
            >
              <option value="">Chưa chọn NVGH</option>
              {deliveryEmployees.map((employee) => (
                <option key={employee.code} value={employee.code}>{employee.code} - {employee.name}</option>
              ))}
            </select>
            {deliveryEmployeeError && <span className="mt-1 block text-xs text-red-600">{deliveryEmployeeError}</span>}
          </label>

          {selectedMergeOrderNumbers.length >= 2 && selectedRepresentativeMergeGroup && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/30 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-semibold text-indigo-950">
                    Thông tin đại diện
                  </h4>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {/* Cột 1: Tùy chọn đổi Khách hàng đại diện */}
                <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-2.5 text-xs">
                  <label className="flex cursor-pointer items-center justify-between gap-2 font-semibold text-gray-800">
                    <span>Đổi khách hàng</span>
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
                    <span>Đổi NVBH</span>
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
                Không tìm thấy đơn phù hợp.
              </div>
            ) : (
              filteredMergeOrderOptions.map((group) => {
                const checked = selectedMergeOrderNumbers.includes(group.orderNumber);
                return (
                  <label
                    key={group.orderNumber}
                    className={`flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs transition-colors ${
                      checked ? "bg-indigo-50/70" : "hover:bg-gray-50"
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleMergeOrderNumber(group.orderNumber)}
                        className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <div className="min-w-0 break-words">
                        <span className="font-mono font-semibold text-gray-900">{group.orderNumber}</span>
                        <span className="mx-2 text-gray-300">|</span>
                        <span className="font-medium text-gray-800">{group.customerName || group.customerCode}</span>
                        <span className="ml-2 text-gray-500">({group.staffName})</span>
                      </div>
                    </div>
                    <div className="pl-7 text-left text-gray-600 sm:pl-0 sm:text-right">
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
                Sản phẩm sau khi gộp ({mergedProductPreview.length} dòng)
              </h3>
              <p className="text-xs text-gray-500">Vuốt ngang để xem thêm.</p>
              <div role="region" aria-label="Bảng sản phẩm đơn gộp, cuộn ngang để xem thêm" tabIndex={0} className="max-w-full overflow-x-auto rounded-xl border border-gray-200">
                <table className="min-w-max w-full divide-y divide-gray-200 text-xs">
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
                      <th className="px-3 py-2 text-right font-semibold text-gray-700">Thành tiền</th>
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
                        <td className="px-3 py-2 text-right font-semibold text-indigo-700">{formatNumber(item.totalValue - item.totalDiscount)}</td>
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
                      <td className="px-3 py-2 text-right text-indigo-700">
                        {formatNumber(mergedProductPreview.reduce((s, i) => s + i.totalValue - i.totalDiscount, 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

        </div>
      </OrderActionModal>

      {/* Modal Đổi mã khách hàng đặt đơn (chuẩn CreateOrderForm) */}
      {changeCustomerOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3">
          <div className="w-full max-w-lg overflow-hidden border border-slate-400 bg-white shadow-2xl">
            <header className="flex items-center justify-between bg-[#14263d] px-3 py-2 text-white">
              <div className="flex items-center gap-2">
                <Pencil size={17} className="text-red-500" />
                <h2 className="text-xs font-bold uppercase tracking-wide text-white">
                  Đổi Mã Khách Hàng Đặt Đơn · {changeCustomerOrder.orderNumber}
                </h2>
              </div>
              <button
                type="button"
                disabled={savingChangeCustomer}
                onClick={() => setChangeCustomerOrder(null)}
                className="rounded p-1 text-white hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </header>

            <div className="space-y-2.5 border-b border-slate-200 px-3 py-3 text-xs">
              <div className="rounded border border-amber-200 bg-amber-50/70 px-2.5 py-1.5 text-[11px] text-amber-900">
                Khách hàng hiện tại:{" "}
                <strong className="font-mono">{changeCustomerOrder.currentCode || "—"}</strong>{" "}
                {changeCustomerOrder.currentName ? `— ${changeCustomerOrder.currentName}` : ""}
              </div>

              {changeCustomerError && (
                <div className="rounded border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
                  {changeCustomerError}
                </div>
              )}

              <div>
                <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                  Tìm nhanh khách hàng trong danh mục
                </label>
                <input
                  type="text"
                  value={changeCustomerSearch}
                  onChange={(e) => setChangeCustomerSearch(e.target.value)}
                  placeholder="Gõ mã KH, tên KH hoặc địa chỉ để chọn nhanh..."
                  className="w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
                {changeCustomerSearch.trim() && (
                  <div className="mt-1 max-h-40 overflow-y-auto rounded border border-slate-200 bg-white shadow-sm">
                    {customerOptions
                      .filter((c) => {
                        const q = changeCustomerSearch.trim().toLowerCase();
                        return [c.customer_code, c.customer_name, c.customer_address]
                          .join(" ")
                          .toLowerCase()
                          .includes(q);
                      })
                      .slice(0, 20)
                      .map((c) => (
                        <button
                          key={c.customer_code}
                          type="button"
                          onClick={() => {
                            setNewCustomerCode(c.customer_code);
                            setNewCustomerName(c.customer_name);
                            setNewCustomerAddress(c.customer_address || "");
                            setChangeCustomerSearch("");
                          }}
                          className="flex w-full items-start justify-between gap-2 border-b border-slate-100 px-2.5 py-1.5 text-left text-[11px] hover:bg-sky-50"
                        >
                          <div className="min-w-0">
                            <span className="font-mono font-bold text-[#14263d]">{c.customer_code}</span>{" "}
                            <span className="font-medium text-slate-800">{c.customer_name}</span>
                            {c.customer_address && (
                              <div className="truncate text-[10px] text-slate-500">{c.customer_address}</div>
                            )}
                          </div>
                        </button>
                      ))}
                  </div>
                )}
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                    Mã khách hàng mới <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={newCustomerCode}
                    onChange={(e) => setNewCustomerCode(e.target.value)}
                    placeholder="VD: 00123456"
                    className="w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 font-mono text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                    Tên khách hàng mới
                  </label>
                  <input
                    type="text"
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    placeholder="Tự điền nếu có trong danh mục"
                    className="w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>
              </div>

              <div>
                <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                  Địa chỉ khách hàng (tùy chọn)
                </label>
                <input
                  type="text"
                  value={newCustomerAddress}
                  onChange={(e) => setNewCustomerAddress(e.target.value)}
                  placeholder="Địa chỉ giao hàng..."
                  className="w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>
            </div>

            <footer className="flex items-center justify-between gap-3 border-t border-slate-300 bg-slate-100 px-3 py-2">
              <span className="text-[10px] text-slate-500">
                Hệ thống lưu vết mã KH gốc và tự động đồng bộ sang chuyến giao chưa chốt.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={savingChangeCustomer}
                  onClick={() => setChangeCustomerOrder(null)}
                  className="rounded bg-red-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-800"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  disabled={savingChangeCustomer || !newCustomerCode.trim()}
                  onClick={async () => {
                    if (!changeCustomerOrder || !newCustomerCode.trim()) return;
                    setSavingChangeCustomer(true);
                    setChangeCustomerError("");
                    try {
                      const res = await apiFetch(
                        `${API_URL}/sync/vinamilk-orders/${encodeURIComponent(changeCustomerOrder.orderNumber)}/customer`,
                        {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            customer_code: newCustomerCode.trim(),
                            customer_name: newCustomerName.trim() || null,
                            customer_address: newCustomerAddress.trim() || null,
                          }),
                        }
                      );
                      const data = (await res.json().catch(() => ({}))) as {
                        detail?: string;
                        customer_code?: string;
                        customer_name?: string;
                      };
                      if (!res.ok) throw new Error(data.detail || "Không thể đổi mã khách hàng.");
                      const targetOrd = changeCustomerOrder.orderNumber;
                      setChangeCustomerOrder(null);
                      setDetailOrderNumber(null);
                      setToast(
                        `Đã đổi mã KH đơn ${targetOrd} sang ${data.customer_code || newCustomerCode.trim()} (${data.customer_name || newCustomerName.trim()}).`
                      );
                      void loadLocalOrders().catch(() => {});
                    } catch (err) {
                      setChangeCustomerError(err instanceof Error ? err.message : "Lỗi khi đổi mã khách hàng.");
                    } finally {
                      setSavingChangeCustomer(false);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {savingChangeCustomer ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                  Lưu mã KH mới
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}

    </div>
  );
}

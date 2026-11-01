"use client";
/* eslint-disable react-hooks/set-state-in-effect */
// src/app/sales/orders/page.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
} from "lucide-react";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
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

type ReplacementEditForm = {
  newOrderNumber: string;
  replacedOrderNumber: string;
  search: string;
};

type SplitAllocCell = {
  quantity: number;
  promoQuantity: number;
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

type SplitCustomerSelection = {
  customer_code: string;
  customer_name: string;
  customer_address: string;
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
  { title: "Trạng thái xử lý", keys: [], width: "14rem" },
  { title: "Thay thế cho đơn", keys: ["_replacement_display", "_replaced_order_number"], width: "16rem" },
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
  normalized["Thay thế cho đơn"] = replacementDisplay;
  normalized["_local_id"] = order["_local_id"] ?? null;
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
  const procStatus = displayRemoteValue(order["_processing_status"]).trim();
  const whStatus = order["_warehouse_updated"] === true ? "Đã cập nhật kho" : "";
  return {
    ...order,
    "Trạng thái xử lý": procStatus || whStatus,
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
  if (title === "Mã KH") return displayRemoteValue(value).trim().slice(-3);
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
  const [isSubmittingMerge, setIsSubmittingMerge] = useState(false);
  const [mergeError, setMergeError] = useState("");

  // State cho Hoàn tác tách/gộp
  const [revertingOrderNumber, setRevertingOrderNumber] = useState<string | null>(null);

  useEffect(() => {
    const created = window.sessionStorage.getItem("dms-order-created");
    if (created) window.sessionStorage.removeItem("dms-order-created");
  }, []);

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
  }, [fromDate, toDate]);

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

  useEffect(() => {
    if (isSplitDrawerOpen) {
      void loadCustomerOptions();
    }
  }, [isSplitDrawerOpen, loadCustomerOptions]);

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

  // Gom nhóm các đơn đủ điều kiện để Tách hoặc Gộp (chưa là đơn tách/gộp, chưa bị thay thế)
  const eligibleOrderGroups = useMemo<GroupedOrderSummary[]>(() => {
    const map = new Map<string, GroupedOrderSummary>();
    for (const row of remoteOrders) {
      const orderNum = displayRemoteValue(row["Số đơn hàng"]).trim();
      if (!orderNum) continue;
      if (row["_is_synthetic"] === true) continue;
      if (hasRemoteValue(row["_replaced_order_number"])) continue;
      if (Array.isArray(row["_replaced_by_order_numbers"]) && row["_replaced_by_order_numbers"].length > 0) continue;

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
  }, [remoteOrders]);

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
    const clamped = Math.max(2, Math.min(10, newCount));
    setSplitCount(clamped);
    setSplitError("");
    if (!selectedSplitOrderGroup) return;
    setSplitAllocs((prev) => {
      const next: SplitAllocMap = {};
      for (const line of selectedSplitOrderGroup.lines) {
        const localId = Number(line["_local_id"]);
        const currentArr = prev[localId] ?? [];
        next[localId] = Array.from({ length: clamped }, (_, idx) => ({
          quantity: currentArr[idx]?.quantity ?? 0,
          promoQuantity: currentArr[idx]?.promoQuantity ?? 0,
        }));
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
        };
      } else if (selectedSplitOrderGroup && customerCode === selectedSplitOrderGroup.customerCode) {
        next[splitIdx] = {
          customer_code: selectedSplitOrderGroup.customerCode,
          customer_name: selectedSplitOrderGroup.customerName,
          customer_address: selectedSplitOrderGroup.customerAddress,
        };
      } else {
        next[splitIdx] = {
          ...(next[splitIdx] ?? { customer_code: "", customer_name: "", customer_address: "" }),
          customer_code: customerCode,
        };
      }
      return next;
    });
  }

  function updateSplitCell(localId: number, splitIndex: number, field: "quantity" | "promoQuantity", value: number) {
    const cleanValue = Math.max(0, Number.isFinite(value) ? value : 0);
    setSplitAllocs((prev) => {
      const currentArr = prev[localId] ? prev[localId].map((c) => ({ ...c, customDiscount: null })) : [];
      if (!currentArr[splitIndex]) return prev;
      currentArr[splitIndex] = {
        ...currentArr[splitIndex],
        [field]: cleanValue,
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
        const origDisc = Math.round(numericValue(line["Số tiền CK"]));
        const currentArr = prev[localId]
          ? prev[localId].map((item) => ({ ...item }))
          : Array.from({ length: splitCount }, () => ({ quantity: 0, promoQuantity: 0, customDiscount: null }));
        const sumOtherQty = currentArr.slice(0, splitCount - 1).reduce((s, a) => s + a.quantity, 0);
        const sumOtherPromo = currentArr.slice(0, splitCount - 1).reduce((s, a) => s + a.promoQuantity, 0);
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
          customDiscount: lastCustomDisc,
        };
        next[localId] = currentArr;
      }
      return next;
    });
  }

  function distributeEvenlyAcrossSplits() {
    if (!selectedSplitOrderGroup || splitCount < 2) return;
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
        customDiscount: null,
      }));
    }
    setSplitAllocs(next);
  }

  function resetSplitDiscountsToAuto() {
    setSplitAllocs((prev) => {
      const next: SplitAllocMap = {};
      for (const [k, arr] of Object.entries(prev)) {
        next[Number(k)] = arr.map((c) => ({ ...c, customDiscount: null }));
      }
      return next;
    });
  }

  // Tính toán Giá trị và Số tiền CK theo từng dòng & tổng hợp theo từng đơn tách (khớp 100% công thức backend)
  const splitFinancials = useMemo(() => {
    const lineBreakdown: Record<number, { value: number; discount: number; autoDiscount: number }[]> = {};
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
        discount: 0,
        autoDiscount: 0,
      }));
      let usedVal = 0;
      let usedDisc = 0;

      for (const idx of activeIndices) {
        const cell = allocs[idx] ?? { quantity: 0, promoQuantity: 0 };
        let val = 0;
        let autoDisc = 0;

        if (isLineMatched && idx === activeIndices[activeIndices.length - 1]) {
          val = Math.round(origVal - usedVal);
          autoDisc = Math.round(origDisc - usedDisc);
        } else {
          const ratio =
            origQty > 0
              ? cell.quantity / origQty
              : origPromo > 0
                ? cell.promoQuantity / origPromo
                : 0;
          val = Math.round(origVal * ratio);
          autoDisc = Math.round(origDisc * ratio);
          usedVal += val;
          usedDisc += autoDisc;
        }

        const finalDisc =
          cell.customDiscount !== null && cell.customDiscount !== undefined
            ? Math.round(cell.customDiscount)
            : autoDisc;

        rowResult[idx] = { value: val, discount: finalDisc, autoDiscount: autoDisc };
        splitTotals[idx].lineCount += 1;
        splitTotals[idx].totalQty = Number((splitTotals[idx].totalQty + cell.quantity).toFixed(4));
        splitTotals[idx].totalPromoQty = Number(
          (splitTotals[idx].totalPromoQty + cell.promoQuantity).toFixed(4)
        );
        splitTotals[idx].totalValue += val;
        splitTotals[idx].totalDiscount += finalDisc;
      }

      lineBreakdown[localId] = rowResult;
    }

    return { lineBreakdown, splitTotals };
  }, [selectedSplitOrderGroup, splitAllocs, splitCount]);

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
    // Kiểm tra tổng số lượng từng dòng và từng đơn tách
    for (const line of selectedSplitOrderGroup.lines) {
      const localId = Number(line["_local_id"]);
      const prodCode = displayRemoteValue(line["Mã sản phẩm"]);
      const origQty = numericValue(line["Số lượng"]);
      const origPromo = numericValue(line["Số lượng KM"]);
      const allocs = splitAllocs[localId] ?? [];
      const sumQty = allocs.reduce((s, a) => s + a.quantity, 0);
      const sumPromo = allocs.reduce((s, a) => s + a.promoQuantity, 0);
      if (Math.abs(sumQty - origQty) > 1e-4) {
        setSplitError(`Sản phẩm ${prodCode}: Tổng SL tách (${sumQty}) chưa khớp SL gốc (${origQty}).`);
        return;
      }
      if (Math.abs(sumPromo - origPromo) > 1e-4) {
        setSplitError(`Sản phẩm ${prodCode}: Tổng SL KM tách (${sumPromo}) chưa khớp SL KM gốc (${origPromo}).`);
        return;
      }
    }

    const totalSplitDisc = splitFinancials.splitTotals.reduce((s, t) => s + t.totalDiscount, 0);
    const totalOrigDisc = Math.round(selectedSplitOrderGroup.totalDiscount);
    if (Math.abs(totalSplitDisc - totalOrigDisc) > Math.max(1, selectedSplitOrderGroup.lines.length)) {
      setSplitError(
        `Tổng Số tiền CK của các đơn tách (${formatVND(totalSplitDisc)}) phải khớp với Tổng Số tiền CK đơn gốc (${formatVND(totalOrigDisc)}).`
      );
      return;
    }

    const splitsPayload = Array.from({ length: splitCount }, (_, splitIdx) => {
      const items = selectedSplitOrderGroup.lines
        .map((line) => {
          const localId = Number(line["_local_id"]);
          const cell = splitAllocs[localId]?.[splitIdx];
          const cellDisc = splitFinancials.lineBreakdown[localId]?.[splitIdx]?.discount ?? 0;
          return {
            snapshot_id: localId,
            quantity: cell?.quantity ?? 0,
            promo_quantity: cell?.promoQuantity ?? 0,
            discount_amount: cellDisc,
          };
        })
        .filter((item) => item.quantity > 0 || item.promo_quantity > 0);
      const chosenCust = splitCustomers[splitIdx] ?? {
        customer_code: selectedSplitOrderGroup.customerCode,
        customer_name: selectedSplitOrderGroup.customerName,
        customer_address: selectedSplitOrderGroup.customerAddress,
      };
      return {
        customer_code: chosenCust.customer_code,
        customer_name: chosenCust.customer_name,
        customer_address: chosenCust.customer_address,
        items,
      };
    });

    const emptySplitIndex = splitsPayload.findIndex((s) => s.items.length === 0);
    if (emptySplitIndex !== -1) {
      setSplitError(`Đơn tách thứ ${emptySplitIndex + 1} chưa có sản phẩm nào có số lượng > 0.`);
      return;
    }

    setIsSubmittingSplit(true);
    try {
      const response = await apiFetch(`${API_URL}/sync/vinamilk-orders/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_number: selectedSplitOrderGroup.orderNumber,
          splits: splitsPayload,
        }),
      });
      const result = await response.json() as {
        new_order_numbers?: string[];
        replaced_order_number?: string;
        detail?: string;
      };
      if (!response.ok) throw new Error(result.detail ?? "Không thể tách đơn hàng.");
      setIsSplitDrawerOpen(false);
      setSelectedSplitOrderNumber("");
      setToast(
        `Đã tách đơn ${result.replaced_order_number} thành ${(result.new_order_numbers ?? []).join(", ")}.`
      );
      await loadLocalOrders();
    } catch (error) {
      setSplitError(error instanceof Error ? error.message : "Không thể tách đơn hàng.");
    } finally {
      setIsSubmittingSplit(false);
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
    setMergeError("");
    setIsSubmittingMerge(true);
    try {
      const response = await apiFetch(`${API_URL}/sync/vinamilk-orders/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_numbers: selectedMergeOrderNumbers,
          representative_order_number: representativeOrderNumber || selectedMergeOrderNumbers[0],
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
      ["Trạng thái xử lý", "Thay thế cho đơn"].includes(title)
    ) || remoteOrders.some((order) => hasRemoteValue(order[title])))
    .map(({ title, width, align }): Column<RemoteOrder> => ({
      key: title,
      title,
      sortable: true,
      width,
      align,
      render: (value, order) => {
        const text = formatRemoteColumnValue(title, value);
        if (title === "Thay thế cho đơn") {
          const replacementType = displayRemoteValue(order["_replacement_type"]).trim();
          const orderNum = displayRemoteValue(order["Số đơn hàng"]).trim();
          if (replacementType === "SPLIT" || replacementType === "MERGE") {
            const isBtt = text.startsWith("BTT:");
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
        if (title === "Trạng thái xử lý") {
          if (!text) return null;
          if (text === "Đơn Tách") {
            return (
              <div className="flex flex-wrap items-center gap-1">
                <span className="rounded-full bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700 border border-purple-200">
                  Đơn Tách
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
          if (text !== "Đã cập nhật kho" && text !== "Đã trả") return null;
          const tone = "bg-emerald-50 text-emerald-700";
          return <span className={`rounded-full px-2 py-1 text-xs font-medium ${tone}`}>{text}</span>;
        }
        return <span className="block truncate" title={text || undefined}>{text}</span>;
      },
    }));

  const remoteStatuses = Array.from(
    new Set(
      remoteOrders
        .map((order) => displayRemoteValue(order["Trạng thái xử lý"]))
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
      order["_replaced_order_number"],
      ...(Array.isArray(order["_replaced_by_order_numbers"]) ? order["_replaced_by_order_numbers"] : []),
    ].map((value) => displayRemoteValue(value).toLocaleLowerCase("vi"));
    if (!matches("Số đơn hàng", orderFilter) && !(orderQuery && relatedOrders.some((value) => value.includes(orderQuery)))) return false;
    if (!matches("Mã KH", customerFilter) && !matches("Tên KH", customerFilter)) return false;
    if (!matches("Mã NVBH", staffFilter) && !matches("Tên NVBH", staffFilter)) return false;
    if (!matches("Mã sản phẩm", productFilter) && !matches("Sản phẩm", productFilter)) return false;
    if (statusFilter !== "Tất cả" && displayRemoteValue(order["Trạng thái xử lý"]) !== statusFilter) return false;
    return true;
  });

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
          <input value={productFilter} onChange={(event) => setProductFilter(event.target.value)} placeholder="Lọc mã/tên sản phẩm" className="min-w-0 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
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
              3. Số lượng đơn muốn tách ra
              <input
                type="number"
                min={2}
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
                    SL: <strong>{selectedSplitOrderGroup.totalQty}</strong>
                    {" | "}
                    KM: <strong>{selectedSplitOrderGroup.totalPromoQty}</strong>
                    {" | "}
                    Giá trị: <strong className="text-emerald-700">{formatVND(selectedSplitOrderGroup.totalValue)}</strong>
                    {" | "}
                    Số tiền CK: <strong className="text-rose-700">{formatVND(selectedSplitOrderGroup.totalDiscount)}</strong>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedSplitOrderGroup.totalDiscount > 0 && (
                    <button
                      type="button"
                      onClick={resetSplitDiscountsToAuto}
                      className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50"
                      title="Tính lại Số tiền CK tự động theo tỷ lệ Số lượng"
                    >
                      Chia lại CK theo SL
                    </button>
                  )}
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
                    className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700"
                  >
                    Điền phần còn lại vào Đơn tách {splitCount}
                  </button>
                </div>
              </div>

              {/* Chọn Mã KH và xem Tổng hợp Giá trị / Số tiền CK cho từng đơn tách */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                  4. Chọn Khách hàng & Tổng hợp theo từng đơn tách
                </h3>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {Array.from({ length: splitCount }, (_, splitIdx) => {
                    const splitOrderCode = `TD-${selectedSplitOrderGroup.orderNumber}-${String(splitIdx + 1).padStart(2, "0")}`;
                    const selectedCust = splitCustomers[splitIdx] ?? {
                      customer_code: selectedSplitOrderGroup.customerCode,
                      customer_name: selectedSplitOrderGroup.customerName,
                      customer_address: selectedSplitOrderGroup.customerAddress,
                    };
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
                        className="rounded-xl border border-purple-200 bg-white p-3 shadow-sm space-y-2.5 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2 border-b border-gray-100 pb-2">
                          <div>
                            <span className="font-semibold text-purple-700">Đơn tách {splitIdx + 1}</span>
                            <span className="ml-2 font-mono text-[11px] text-gray-500">{splitOrderCode}</span>
                          </div>
                          <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[11px] font-medium text-purple-700">
                            {totals.lineCount} dòng SP
                          </span>
                        </div>

                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-gray-700">Khách hàng đơn tách {splitIdx + 1}:</span>
                            {selectedCust.customer_code !== selectedSplitOrderGroup.customerCode && (
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
                        </div>

                        <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-2 text-[11px]">
                          <div className="flex items-center">
                            <span className="text-gray-500">Tổng SL / KM:</span>{" "}
                            <strong className="ml-1 text-gray-900">{totals.totalQty}</strong>
                            {totals.totalPromoQty > 0 && (
                              <span className="ml-1 text-amber-700 font-semibold">(+{totals.totalPromoQty} KM)</span>
                            )}
                          </div>
                          <div className="flex items-center justify-end gap-1.5">
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
                                className="w-28 rounded border border-rose-200 bg-white px-2 py-0.5 text-right text-xs font-semibold text-rose-700 focus:border-rose-500 focus:outline-none"
                              />
                            ) : (
                              <strong className="text-rose-700">{formatVND(totals.totalDiscount)}</strong>
                            )}
                          </div>
                          <div className="col-span-2 flex items-center justify-between border-t border-gray-200/70 pt-1">
                            <span className="font-medium text-gray-600">Tổng giá trị đơn tách {splitIdx + 1}:</span>
                            <strong className="text-xs text-emerald-700">{formatVND(totals.totalValue)}</strong>
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
                      <th className="px-3 py-2.5 text-left font-semibold text-gray-700">Sản phẩm</th>
                      <th className="px-2 py-2.5 text-center font-semibold text-gray-700">ĐVT</th>
                      <th className="px-2.5 py-2.5 text-right font-semibold text-gray-700">SL gốc</th>
                      <th className="px-2.5 py-2.5 text-right font-semibold text-gray-700">SL KM gốc</th>
                      {Array.from({ length: splitCount }, (_, idx) => {
                        const cust = splitCustomers[idx];
                        return (
                          <th key={idx} className="px-2.5 py-2.5 text-center font-semibold text-purple-700 bg-purple-50/40">
                            Đơn tách {idx + 1}
                            <div className="text-[10px] font-normal text-gray-500">
                              TD-{selectedSplitOrderGroup.orderNumber}-{String(idx + 1).padStart(2, "0")}
                            </div>
                            {cust?.customer_code && (
                              <div className="text-[10px] font-medium text-purple-600 truncate max-w-[150px] mx-auto" title={`${cust.customer_code} - ${cust.customer_name}`}>
                                KH: {cust.customer_code.slice(-3)} — {cust.customer_name}
                              </div>
                            )}
                          </th>
                        );
                      })}
                      <th className="px-2.5 py-2.5 text-right font-semibold text-gray-700">Còn lại</th>
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
                      const sumDisc = finRow.reduce((s, f) => s + f.discount, 0);
                      const remQty = Number((origQty - sumQty).toFixed(4));
                      const remPromo = Number((origPromo - sumPromo).toFixed(4));
                      const remDisc = Math.round(origDisc - sumDisc);
                      const isMatched =
                        Math.abs(remQty) <= 1e-4 &&
                        Math.abs(remPromo) <= 1e-4 &&
                        Math.abs(remDisc) <= 1;

                      return (
                        <tr key={localId} className="hover:bg-gray-50/60">
                          <td className="px-3 py-2 align-top">
                            <div className="font-medium text-gray-900">{prodCode} — {prodName}</div>
                            {promoCode && <div className="text-[11px] text-gray-500">CTKM: {promoCode}</div>}
                            <div className="text-[11px] text-emerald-700">
                              Giá trị gốc: {formatVND(origVal)}
                              {origDisc > 0 ? ` | CK gốc: ${formatVND(origDisc)}` : ""}
                            </div>
                          </td>
                          <td className="px-2 py-2 text-center align-middle text-gray-600">{unit}</td>
                          <td className="px-2.5 py-2 text-right align-middle font-semibold text-gray-900">{origQty}</td>
                          <td className="px-2.5 py-2 text-right align-middle font-semibold text-amber-700">{origPromo}</td>
                          {Array.from({ length: splitCount }, (_, splitIdx) => {
                            const cell = allocs[splitIdx] ?? { quantity: 0, promoQuantity: 0 };
                            const cellFin = finRow[splitIdx] ?? { value: 0, discount: 0, autoDiscount: 0 };
                            return (
                              <td key={splitIdx} className="px-2 py-2 align-middle bg-purple-50/15">
                                <div className="flex flex-col gap-1">
                                  <label className="flex items-center justify-between gap-1 text-[11px] text-gray-600">
                                    <span>SL:</span>
                                    <input
                                      type="number"
                                      min={0}
                                      step="any"
                                      value={cell.quantity}
                                      onChange={(e) =>
                                        updateSplitCell(localId, splitIdx, "quantity", Number(e.target.value))
                                      }
                                      className="w-20 rounded border border-gray-200 px-2 py-1 text-right text-xs font-medium text-gray-900 focus:border-purple-500 focus:outline-none"
                                    />
                                  </label>
                                  {origPromo > 0 && (
                                    <label className="flex items-center justify-between gap-1 text-[11px] text-amber-700">
                                      <span>KM:</span>
                                      <input
                                        type="number"
                                        min={0}
                                        step="any"
                                        value={cell.promoQuantity}
                                        onChange={(e) =>
                                          updateSplitCell(localId, splitIdx, "promoQuantity", Number(e.target.value))
                                        }
                                        className="w-20 rounded border border-amber-200 bg-amber-50/30 px-2 py-1 text-right text-xs font-medium text-amber-900 focus:border-amber-500 focus:outline-none"
                                      />
                                    </label>
                                  )}
                                  {(cell.quantity > 0 || cell.promoQuantity > 0) && (
                                    <div className="mt-0.5 rounded bg-white/80 px-1.5 py-1 text-[10px] leading-tight border border-purple-100 space-y-1">
                                      <div className="flex justify-between text-emerald-700 font-medium">
                                        <span>GT:</span>
                                        <span>{formatVND(cellFin.value)}</span>
                                      </div>
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
                                            className="w-20 rounded border border-rose-200 bg-rose-50/20 px-1.5 py-0.5 text-right text-[11px] font-medium text-rose-800 focus:border-rose-500 focus:outline-none"
                                          />
                                        </label>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </td>
                            );
                          })}
                          <td className="px-2.5 py-2 text-right align-middle">
                            <span
                              className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${
                                isMatched ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                              }`}
                            >
                              SL: {remQty}
                              {origPromo > 0 ? ` | KM: ${remPromo}` : ""}
                              {Math.abs(remDisc) > 1 ? ` | CK: ${formatVND(remDisc)}` : ""}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-gray-50 font-semibold text-gray-900 border-t border-gray-200">
                    <tr>
                      <td colSpan={2} className="px-3 py-2.5 text-right align-top">
                        <div>Tổng cộng:</div>
                        <div className="text-[11px] font-normal text-emerald-700">
                          GT gốc: {formatVND(selectedSplitOrderGroup.totalValue)}
                        </div>
                        <div className="text-[11px] font-normal text-rose-700">
                          CK gốc: {formatVND(selectedSplitOrderGroup.totalDiscount)}
                        </div>
                      </td>
                      <td className="px-2.5 py-2.5 text-right align-top">{selectedSplitOrderGroup.totalQty}</td>
                      <td className="px-2.5 py-2.5 text-right align-top text-amber-700">
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
                          <td key={splitIdx} className="px-2.5 py-2.5 text-right align-top bg-purple-50/30">
                            <div className="text-gray-900">
                              SL: {totals.totalQty}
                              {totals.totalPromoQty > 0 ? ` | KM: ${totals.totalPromoQty}` : ""}
                            </div>
                            <div className="text-[11px] text-emerald-700">
                              GT: {formatVND(totals.totalValue)}
                            </div>
                            <div className="text-[11px] text-rose-700">
                              CK: {formatVND(totals.totalDiscount)}
                            </div>
                          </td>
                        );
                      })}
                      <td className="px-2.5 py-2.5 text-right align-top text-[11px]">
                        <div className="text-emerald-700">
                          ∑GT: {formatVND(splitFinancials.splitTotals.reduce((s, t) => s + t.totalValue, 0))}
                        </div>
                        <div className="text-rose-700">
                          ∑CK: {formatVND(splitFinancials.splitTotals.reduce((s, t) => s + t.totalDiscount, 0))}
                        </div>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-gray-100 pt-4">
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
                  {isSubmittingSplit ? "Đang tách đơn..." : "Xác nhận tách đơn"}
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-500">
              Chọn một đơn hàng ở trên để bắt đầu phân bổ số lượng tách đơn.
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
                Đơn đại diện lấy thông tin chung (Khách hàng, NVBH, Ngày đơn)
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

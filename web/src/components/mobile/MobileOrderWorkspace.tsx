"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Gift,
  Loader2,
  MapPin,
  Minus,
  Package,
  Plus,
  RefreshCw,
  Search,
  ShoppingBag,
  ShoppingCart,
  SlidersHorizontal,
  Trash2,
  UserCheck,
  X,
} from "lucide-react";
import { API_URL, apiFetch } from "@/lib/api";
import { useAuthSession } from "@/lib/auth-session";
import { formatCustomerCode, formatNumber, formatVNDFull } from "@/lib/format";
import {
  CUSTOMER_TYPE_LABELS,
  MOBILE_ORDER_TYPES,
  type MobileCartLine,
  type MobileCurrentUser,
  type MobileCustomer,
  type MobileEmployeeOption,
  type MobileProduct,
  type MobilePromotionOption,
  type MobileWarehouseOption,
  clearMobileOrderDraft,
  getMobilePromotionReward,
  getMobileQualifyingPromotions,
  lineGrossAmount,
  lineNetAmount,
  loadMobileOrderDraft,
  normalizeSearchText,
  saveMobileOrderDraft,
  todayInputDate,
} from "@/lib/mobile-sales";
import { cn } from "@/lib/utils";

interface ManualOrderDetailResponse {
  order_number: string;
  customer_code: string;
  order_type: string;
  order_date: string;
  entry_date: string;
  delivery_date: string;
  sales_route: string;
  staff_code: string;
  staff_name: string;
  delivery_employee_code: string;
  delivery_employee_name: string;
  note: string;
  can_edit: boolean;
  edit_blocked_reason: string | null;
  lines: Array<{
    product_code: string;
    quantity: number;
    cartons: number | null;
    boxes: number | null;
    promo_quantity: number;
    unit_price: number;
    discount_amount: number;
    promotion_id: number | null;
  }>;
}

const PAGE_STEP = 40;

export default function MobileOrderWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const session = useAuthSession();

  const editOrderNumber = searchParams.get("edit")?.trim() || null;
  const preselectedCustomerCode = searchParams.get("customer")?.trim() || null;
  const isEditMode = Boolean(editOrderNumber);

  // Master data
  const [customers, setCustomers] = useState<MobileCustomer[]>([]);
  const [products, setProducts] = useState<MobileProduct[]>([]);
  const [warehouses, setWarehouses] = useState<MobileWarehouseOption[]>([]);
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [stockMap, setStockMap] = useState<Map<string, number>>(new Map());
  const [stockLoading, setStockLoading] = useState(false);
  const [deliveryEmployees, setDeliveryEmployees] = useState<MobileEmployeeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [editBlockedReason, setEditBlockedReason] = useState("");

  // Order metadata
  const [selectedCustomer, setSelectedCustomer] = useState<MobileCustomer | null>(null);
  const [orderType, setOrderType] = useState<string>("001-Xuất hàng");
  const [staffCode, setStaffCode] = useState("");
  const [staffName, setStaffName] = useState("");
  const hasOwnStaffRef = useRef(false);
  const [deliveryEmployeeCode, setDeliveryEmployeeCode] = useState("");
  const [orderDate, setOrderDate] = useState(todayInputDate());
  const [entryDate, setEntryDate] = useState(todayInputDate());
  const [deliveryDate, setDeliveryDate] = useState(todayInputDate());
  const [salesRoute, setSalesRoute] = useState("");
  const [orderNumber, setOrderNumber] = useState(editOrderNumber ?? "");
  const [note, setNote] = useState("");

  // Cart & Promotions
  const [lines, setLines] = useState<MobileCartLine[]>([]);
  const [promotions, setPromotions] = useState<MobilePromotionOption[]>([]);
  const [loadingPromotions, setLoadingPromotions] = useState(false);
  const [promotionError, setPromotionError] = useState("");
  const [draftRestored, setDraftRestored] = useState(false);

  // UI state
  const [customerSheetOpen, setCustomerSheetOpen] = useState(false);
  const [customerQuery, setCustomerQuery] = useState("");
  const [selectedRouteFilter, setSelectedRouteFilter] = useState("ALL");

  const [productQuery, setProductQuery] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("ALL");
  const [onlySelectedFilter, setOnlySelectedFilter] = useState(false);
  const [visibleProductCount, setVisibleProductCount] = useState(PAGE_STEP);

  const [cartSheetOpen, setCartSheetOpen] = useState(false);
  const [showExtraInfo, setShowExtraInfo] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [savedSuccess, setSavedSuccess] = useState<{
    orderNumber: string;
    customerName: string;
    total: number;
    itemCount: number;
  } | null>(null);

  const draftReadyRef = useRef(false);

  // Load master data (customers, products, units, warehouses, me, employees, optional edit detail)
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError("");
      try {
        const requests: Array<Promise<Response>> = [
          apiFetch(`${API_URL}/customers/?limit=5000`),
          apiFetch(`${API_URL}/products/?limit=10000`),
          apiFetch(`${API_URL}/products/units/`),
          apiFetch(`${API_URL}/inventory/warehouses/`),
          apiFetch(`${API_URL}/auth/me`),
          apiFetch(`${API_URL}/employees/?status=active&limit=1000`),
        ];
        if (editOrderNumber) {
          requests.push(
            apiFetch(
              `${API_URL}/sync/vinamilk-orders/manual/${encodeURIComponent(editOrderNumber)}`,
            ),
          );
        }

        const [custRes, prodRes, unitRes, whRes, meRes, empRes, editRes] =
          await Promise.all(requests);

        if (!custRes.ok) throw new Error("Không thể tải danh sách khách hàng.");
        if (!prodRes.ok) throw new Error("Không thể tải danh sách sản phẩm.");
        if (!whRes.ok) throw new Error("Không thể tải danh sách kho.");
        if (editOrderNumber && editRes && !editRes.ok) {
          const errPayload = (await editRes.json().catch(() => ({}))) as {
            detail?: string;
          };
          throw new Error(
            errPayload.detail || `Không thể tải đơn ${editOrderNumber}.`,
          );
        }

        const custRows = (await custRes.json()) as Array<Record<string, unknown>>;
        const prodRows = (await prodRes.json()) as Array<Record<string, unknown>>;
        const unitRows = unitRes.ok
          ? ((await unitRes.json()) as Array<{ id: number; name: string }>)
          : [];
        const whRows = (await whRes.json()) as Array<{ id: number; name: string }>;
        const me = meRes.ok ? ((await meRes.json()) as MobileCurrentUser) : null;
        const empRows = empRes.ok
          ? ((await empRes.json()) as MobileEmployeeOption[])
          : [];
        const editDetail =
          editOrderNumber && editRes
            ? ((await editRes.json()) as ManualOrderDetailResponse)
            : null;

        if (cancelled) return;

        if (me?.employee_code) {
          hasOwnStaffRef.current = true;
          if (!editDetail) {
            setStaffCode(me.employee_code);
            setStaffName(me.employee_name ?? "");
          }
        }

        setDeliveryEmployees(
          (Array.isArray(empRows) ? empRows : []).filter(
            (e) =>
              e.status?.toLowerCase() === "active" &&
              e.code?.trim().toUpperCase().startsWith("NV"),
          ),
        );

        const unitName = new Map(unitRows.map((u) => [u.id, u.name]));
        const loadedCustomers: MobileCustomer[] = custRows
          .filter((row) => row.status !== "inactive")
          .map((row) => ({
            id: Number(row.id),
            code: String(row.code ?? ""),
            name: String(row.name ?? ""),
            type:
              CUSTOMER_TYPE_LABELS[String(row.type ?? "")] ??
              String(row.type ?? ""),
            tier: String(row.tier ?? ""),
            status: String(row.status ?? "active"),
            staffCode: String(row.staff_code ?? ""),
            staffName: String(row.staff_name ?? ""),
            storeName: String(row.store_name ?? ""),
            salesRoute: String(row.store_route ?? ""),
            phone: String(row.phone ?? ""),
            address: String(row.address ?? ""),
          }));

        const loadedProducts: MobileProduct[] = prodRows
          .filter((row) => row.status !== "inactive")
          .map((row) => ({
            id: Number(row.id),
            sku: String(row.sku ?? ""),
            nppCode: String(row.npp_code ?? row.sku ?? ""),
            name: String(row.name ?? ""),
            unit: unitName.get(Number(row.unit_id)) ?? "",
            supplier: String(row.supplier ?? ""),
            basePrice: Number(row.base_price ?? 0),
            boxesPerCarton: Math.max(1, Number(row.boxes_per_carton ?? 1)),
          }));

        setCustomers(loadedCustomers);
        setProducts(loadedProducts);
        setWarehouses(whRows.map((w) => ({ id: w.id, name: w.name })));
        if (whRows.length > 0) setWarehouseId(whRows[0].id);

        if (editDetail) {
          setOrderNumber(editDetail.order_number);
          setOrderType(editDetail.order_type || "001-Xuất hàng");
          setOrderDate(editDetail.order_date || todayInputDate());
          setEntryDate(editDetail.entry_date || todayInputDate());
          setDeliveryDate(editDetail.delivery_date || todayInputDate());
          setSalesRoute(editDetail.sales_route || "");
          setStaffCode(editDetail.staff_code || "");
          setStaffName(editDetail.staff_name || "");
          setDeliveryEmployeeCode(editDetail.delivery_employee_code || "");
          setNote(editDetail.note || "");
          setEditBlockedReason(
            editDetail.can_edit
              ? ""
              : editDetail.edit_blocked_reason ||
                  "Đơn hàng này hiện không thể chỉnh sửa.",
          );

          const matchedCustomer = loadedCustomers.find(
            (c) =>
              c.code.trim().toUpperCase() ===
              editDetail.customer_code.trim().toUpperCase(),
          );
          if (matchedCustomer) setSelectedCustomer(matchedCustomer);

          const productBySku = new Map(
            loadedProducts.map((p) => [p.sku.trim().toUpperCase(), p]),
          );
          const restoredLines: MobileCartLine[] = [];
          for (const rawLine of editDetail.lines) {
            const matchedProduct = productBySku.get(
              rawLine.product_code.trim().toUpperCase(),
            );
            if (!matchedProduct) continue;
            const qty = Math.max(0, Number(rawLine.quantity ?? 0));
            const bpc = matchedProduct.boxesPerCarton;
            const cartons =
              rawLine.cartons != null
                ? Math.max(0, Number(rawLine.cartons))
                : bpc > 1
                  ? Math.floor(qty / bpc)
                  : 0;
            const boxes =
              rawLine.boxes != null
                ? Math.max(0, Number(rawLine.boxes))
                : bpc > 1
                  ? qty % bpc
                  : qty;
            restoredLines.push({
              productId: matchedProduct.id,
              productCode: matchedProduct.sku,
              nppCode: matchedProduct.nppCode,
              productName: matchedProduct.name,
              unit: matchedProduct.unit,
              supplier: matchedProduct.supplier,
              boxesPerCarton: bpc,
              cartons,
              boxes,
              quantity: qty,
              promoQuantity: Number(rawLine.promo_quantity ?? 0),
              price: Number(rawLine.unit_price ?? matchedProduct.basePrice),
              discountAmount: Number(rawLine.discount_amount ?? 0),
              promotionId: rawLine.promotion_id ?? null,
            });
          }
          setLines(restoredLines);
          setCartSheetOpen(true);
        } else {
          // Restore draft if available (unless preselected customer overrides)
          const draft = loadMobileOrderDraft(
            session.username,
            session.distributorCode,
          );
          if (preselectedCustomerCode) {
            const found = loadedCustomers.find(
              (c) =>
                c.code.trim().toUpperCase() ===
                preselectedCustomerCode.toUpperCase(),
            );
            if (found) {
              setSelectedCustomer(found);
              setSalesRoute(found.salesRoute);
              if (!hasOwnStaffRef.current) {
                setStaffCode(found.staffCode);
                setStaffName(found.staffName);
              }
            }
          } else if (draft && (draft.customerCode || draft.lines.length > 0)) {
            if (draft.customerCode) {
              const found = loadedCustomers.find(
                (c) =>
                  c.code.trim().toUpperCase() ===
                  draft.customerCode!.trim().toUpperCase(),
              );
              if (found) {
                setSelectedCustomer(found);
                setSalesRoute(found.salesRoute);
                if (!hasOwnStaffRef.current) {
                  setStaffCode(found.staffCode);
                  setStaffName(found.staffName);
                }
              }
            }
            if (draft.orderType) setOrderType(draft.orderType);
            if (draft.orderDate) setOrderDate(draft.orderDate);
            if (draft.deliveryDate) setDeliveryDate(draft.deliveryDate);
            if (draft.deliveryEmployeeCode)
              setDeliveryEmployeeCode(draft.deliveryEmployeeCode);
            if (draft.note) setNote(draft.note);
            if (draft.lines.length > 0) setLines(draft.lines);
            setDraftRestored(true);
          }
        }
        draftReadyRef.current = true;
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error.message : "Không thể tải dữ liệu.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [editOrderNumber, preselectedCustomerCode, session.username, session.distributorCode]);

  // Auto-save draft on changes (non-edit mode)
  useEffect(() => {
    if (isEditMode || !draftReadyRef.current || loading) return;
    if (!selectedCustomer && lines.length === 0 && !note.trim()) {
      clearMobileOrderDraft(session.username, session.distributorCode);
      return;
    }
    saveMobileOrderDraft(session.username, session.distributorCode, {
      customerCode: selectedCustomer?.code ?? null,
      orderType,
      orderDate,
      deliveryDate,
      deliveryEmployeeCode,
      note,
      lines,
      updatedAt: new Date().toISOString(),
    });
  }, [
    isEditMode,
    loading,
    selectedCustomer,
    orderType,
    orderDate,
    deliveryDate,
    deliveryEmployeeCode,
    note,
    lines,
    session.username,
    session.distributorCode,
  ]);

  // Stock levels by warehouse
  useEffect(() => {
    if (warehouseId == null) return;
    let cancelled = false;
    async function loadStock() {
      await Promise.resolve();
      if (cancelled) return;
      setStockLoading(true);
      try {
        const res = await apiFetch(
          `${API_URL}/inventory/stock-levels/?warehouse_id=${warehouseId}`,
        );
        const rows = res.ok
          ? ((await res.json()) as Array<{
              product_code: string;
              available: number;
            }>)
          : [];
        if (!cancelled) {
          setStockMap(
            new Map(
              rows.map((r) => [
                r.product_code.toUpperCase(),
                Number(r.available ?? 0),
              ]),
            ),
          );
        }
      } catch {
        // ignore stock fetch error
      } finally {
        if (!cancelled) setStockLoading(false);
      }
    }
    void loadStock();
    return () => {
      cancelled = true;
    };
  }, [warehouseId]);

  // Preview next order number
  useEffect(() => {
    if (isEditMode) return;
    let cancelled = false;
    apiFetch(
      `${API_URL}/sync/vinamilk-orders/manual/next-number?order_date=${orderDate}`,
    )
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as { order_number: string };
      })
      .then((result) => {
        if (!cancelled && result?.order_number) {
          setOrderNumber(result.order_number);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [orderDate, isEditMode]);

  // Auto-load available promotions when customer & orderDate are selected
  useEffect(() => {
    let cancelled = false;
    async function loadPromos() {
      await Promise.resolve();
      if (cancelled) return;
      if (!selectedCustomer || orderType !== "001-Xuất hàng") {
        setPromotions([]);
        setPromotionError("");
        setLoadingPromotions(false);
        return;
      }
      setLoadingPromotions(true);
      setPromotionError("");
      try {
        const params = new URLSearchParams({
          on_date: orderDate,
          customer_code: selectedCustomer.code,
        });
        if (staffCode.trim()) params.set("employee_code", staffCode.trim());
        const res = await apiFetch(
          `${API_URL}/promotions/available?${params.toString()}`,
        );
        if (!res.ok) throw new Error("Không tải được CTKM khả dụng.");
        const result = (await res.json()) as MobilePromotionOption[];
        if (!cancelled) setPromotions(Array.isArray(result) ? result : []);
      } catch (err) {
        if (!cancelled) {
          setPromotionError(
            err instanceof Error ? err.message : "Không tải được CTKM.",
          );
        }
      } finally {
        if (!cancelled) setLoadingPromotions(false);
      }
    }
    void loadPromos();
    return () => {
      cancelled = true;
    };
  }, [selectedCustomer, orderDate, staffCode, orderType]);

  // Derived data
  const lineBySku = useMemo(
    () => new Map(lines.map((l) => [l.productCode, l])),
    [lines],
  );

  const routes = useMemo(() => {
    const set = new Set<string>();
    for (const c of customers) {
      if (c.salesRoute.trim()) set.add(c.salesRoute.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "vi"));
  }, [customers]);

  const suppliers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of products) {
      const s = p.supplier.trim();
      if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([name]) => name);
  }, [products]);

  const filteredCustomers = useMemo(() => {
    const q = normalizeSearchText(customerQuery.trim());
    let list = customers;
    if (selectedRouteFilter !== "ALL") {
      list = list.filter((c) => c.salesRoute.trim() === selectedRouteFilter);
    }
    if (q) {
      list = list.filter((c) =>
        [c.code, c.name, c.storeName, c.salesRoute, c.staffName, c.phone].some(
          (v) => normalizeSearchText(v).includes(q),
        ),
      );
    }
    // Prioritize customers assigned to logged-in staff
    const ownCode = staffCode.trim().toUpperCase();
    if (ownCode) {
      list = [...list].sort((a, b) => {
        const aOwn = a.staffCode.trim().toUpperCase() === ownCode ? 0 : 1;
        const bOwn = b.staffCode.trim().toUpperCase() === ownCode ? 0 : 1;
        return aOwn - bOwn;
      });
    }
    return list.slice(0, 60);
  }, [customers, customerQuery, selectedRouteFilter, staffCode]);

  const filteredProducts = useMemo(() => {
    const q = normalizeSearchText(productQuery.trim());
    let list = products;
    if (onlySelectedFilter) {
      list = list.filter((p) => lineBySku.has(p.sku));
    }
    if (supplierFilter !== "ALL") {
      list = list.filter((p) => p.supplier.trim() === supplierFilter);
    }
    if (q) {
      list = list.filter((p) =>
        [p.sku, p.nppCode, p.name, p.supplier].some((v) =>
          normalizeSearchText(v).includes(q),
        ),
      );
    }
    return list;
  }, [products, productQuery, supplierFilter, onlySelectedFilter, lineBySku]);

  const visibleProducts = useMemo(
    () => filteredProducts.slice(0, visibleProductCount),
    [filteredProducts, visibleProductCount],
  );

  const subtotal = useMemo(
    () => lines.reduce((sum, l) => sum + lineGrossAmount(l), 0),
    [lines],
  );
  const totalDiscount = useMemo(
    () =>
      lines.reduce(
        (sum, l) => sum + Math.min(l.discountAmount, lineGrossAmount(l)),
        0,
      ),
    [lines],
  );
  const totalAmount = subtotal - totalDiscount;
  const totalCartons = useMemo(
    () => lines.reduce((sum, l) => sum + l.cartons, 0),
    [lines],
  );
  const totalBoxes = useMemo(
    () => lines.reduce((sum, l) => sum + l.boxes, 0),
    [lines],
  );
  const totalPromoQty = useMemo(
    () => lines.reduce((sum, l) => sum + l.promoQuantity, 0),
    [lines],
  );

  const shortageLines = useMemo(
    () =>
      lines.filter((l) => {
        const avail = stockMap.get(l.productCode.toUpperCase());
        return avail != null && l.quantity + l.promoQuantity > avail;
      }),
    [lines, stockMap],
  );

  // Handlers
  function handleSelectCustomer(c: MobileCustomer) {
    setSelectedCustomer(c);
    setSalesRoute(c.salesRoute);
    if (!hasOwnStaffRef.current) {
      setStaffCode(c.staffCode);
      setStaffName(c.staffName);
    }
    setLines((prev) =>
      prev.map((l) => ({
        ...l,
        promotionId: null,
        promoQuantity: 0,
        discountAmount: 0,
      })),
    );
    setCustomerSheetOpen(false);
    setCustomerQuery("");
  }

  function setProductQty(
    product: MobileProduct,
    nextCartons: number,
    nextBoxes: number,
  ) {
    const bpc = product.boxesPerCarton;
    let safeCartons = Math.max(0, Math.floor(nextCartons));
    let safeBoxes = Math.max(0, Math.floor(nextBoxes));
    if (bpc > 1 && safeBoxes >= bpc) {
      safeCartons += Math.floor(safeBoxes / bpc);
      safeBoxes = safeBoxes % bpc;
    }
    const totalQty = bpc > 1 ? safeCartons * bpc + safeBoxes : safeBoxes;

    setLines((prev) => {
      const idx = prev.findIndex((l) => l.productCode === product.sku);
      if (totalQty <= 0) {
        if (idx === -1) return prev;
        return prev.filter((_, i) => i !== idx);
      }

      const existing = idx >= 0 ? prev[idx] : null;
      const updated: MobileCartLine = existing
        ? {
            ...existing,
            cartons: safeCartons,
            boxes: safeBoxes,
            quantity: totalQty,
          }
        : {
            productId: product.id,
            productCode: product.sku,
            nppCode: product.nppCode,
            productName: product.name,
            unit: product.unit,
            supplier: product.supplier,
            boxesPerCarton: bpc,
            cartons: safeCartons,
            boxes: safeBoxes,
            quantity: totalQty,
            promoQuantity: 0,
            price: product.basePrice,
            discountAmount: 0,
            promotionId: null,
          };

      if (orderType === "001-Xuất hàng" && updated.promotionId != null) {
        const promo = promotions.find((p) => p.id === updated.promotionId);
        const reward = promo
          ? getMobilePromotionReward(promo, updated, products)
          : null;
        if (reward) {
          updated.promoQuantity = reward.promoQuantity;
          updated.discountAmount = reward.discountAmount;
        } else {
          updated.promotionId = null;
          updated.promoQuantity = 0;
          updated.discountAmount = 0;
        }
      }

      if (idx === -1) return [...prev, updated];
      return prev.map((l, i) => (i === idx ? updated : l));
    });
  }

  function applyLinePromotion(sku: string, promotionId: number | null) {
    setLines((prev) =>
      prev.map((line) => {
        if (line.productCode !== sku) return line;
        const promo = promotions.find((p) => p.id === promotionId);
        const reward =
          promotionId == null || !promo
            ? null
            : getMobilePromotionReward(promo, line, products);
        return {
          ...line,
          promotionId: reward ? promotionId : null,
          promoQuantity: reward?.promoQuantity ?? 0,
          discountAmount: reward?.discountAmount ?? 0,
        };
      }),
    );
  }

  function removeLine(sku: string) {
    setLines((prev) => prev.filter((l) => l.productCode !== sku));
  }

  function clearDraftAndReset() {
    clearMobileOrderDraft(session.username, session.distributorCode);
    setSelectedCustomer(null);
    setLines([]);
    setNote("");
    setDraftRestored(false);
    setSubmitError("");
    setCartSheetOpen(false);
  }

  async function handleSubmitOrder() {
    setSubmitError("");
    if (editBlockedReason) {
      setSubmitError(editBlockedReason);
      return;
    }
    if (!selectedCustomer) {
      setSubmitError("Vui lòng chọn khách hàng trước khi gửi đơn.");
      setCartSheetOpen(false);
      setCustomerSheetOpen(true);
      return;
    }
    if (lines.length === 0) {
      setSubmitError("Vui lòng chọn ít nhất 1 sản phẩm.");
      return;
    }
    if (lines.some((l) => l.quantity <= 0)) {
      setSubmitError("Số lượng sản phẩm phải lớn hơn 0.");
      return;
    }

    setSubmitting(true);
    try {
      const endpoint =
        isEditMode && editOrderNumber
          ? `${API_URL}/sync/vinamilk-orders/manual/${encodeURIComponent(editOrderNumber)}`
          : `${API_URL}/sync/vinamilk-orders/manual`;

      const response = await apiFetch(endpoint, {
        method: isEditMode ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_code: selectedCustomer.code,
          order_type: orderType,
          order_date: orderDate || null,
          entry_date: entryDate || null,
          delivery_date: deliveryDate || null,
          sales_route: salesRoute.trim() || null,
          staff_code: staffCode.trim() || null,
          staff_name: staffName.trim() || null,
          delivery_employee_code: deliveryEmployeeCode || null,
          delivery_employee_name:
            deliveryEmployees.find((e) => e.code === deliveryEmployeeCode)
              ?.name ?? null,
          customer_address: null,
          note: note.trim() || null,
          lines: lines.map((l) => ({
            product_code: l.productCode,
            quantity: l.quantity,
            cartons: l.cartons,
            boxes: l.boxes,
            promo_quantity: l.promoQuantity,
            unit_price: l.price,
            discount_amount: l.discountAmount,
            promotion_id: orderType === "001-Xuất hàng" ? l.promotionId : null,
          })),
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        order_number?: string;
        detail?: unknown;
      };
      if (!response.ok) {
        throw new Error(
          typeof payload.detail === "string"
            ? payload.detail
            : "Không thể lưu đơn hàng. Vui lòng thử lại.",
        );
      }

      const savedNo = payload.order_number ?? editOrderNumber ?? orderNumber;
      clearMobileOrderDraft(session.username, session.distributorCode);
      setCartSheetOpen(false);
      setSavedSuccess({
        orderNumber: savedNo,
        customerName: selectedCustomer.name,
        total: totalAmount,
        itemCount: lines.length,
      });
      setLines([]);
      setNote("");
      setDraftRestored(false);
      if (isEditMode) {
        router.replace("/m");
      }
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Không thể gửi đơn hàng.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  // Loading & Error States
  if (loading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-slate-500">
        <Loader2 size={28} className="animate-spin text-sky-600" />
        <p className="text-sm font-medium">Đang tải danh mục khách hàng & sản phẩm...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-4">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-center">
          <AlertTriangle size={28} className="mx-auto mb-2 text-red-500" />
          <p className="text-sm font-semibold text-red-800">{loadError}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2 text-xs font-semibold text-white"
          >
            <RefreshCw size={14} /> Thử tải lại
          </button>
        </div>
      </div>
    );
  }

  // Success confirmation screen
  if (savedSuccess) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-5 py-10 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <CheckCircle2 size={36} />
        </div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">
          {isEditMode ? "Cập nhật đơn thành công!" : "Bấm đơn thành công!"}
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Đơn hàng đã được đồng bộ thẳng lên hệ thống DMS.
        </p>

        <div className="mt-5 w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm dark:border-[#2a3547] dark:bg-[#151d2b]">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <span className="text-xs text-slate-500">Số đơn hàng</span>
            <span className="rounded bg-sky-50 px-2 py-0.5 font-mono text-sm font-bold text-sky-700">
              {savedSuccess.orderNumber}
            </span>
          </div>
          <div className="mt-2.5 space-y-1.5 text-xs">
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">Khách hàng</span>
              <span className="text-right font-semibold text-slate-800">
                {savedSuccess.customerName}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">Số mặt hàng</span>
              <span className="font-semibold">{savedSuccess.itemCount} SKU</span>
            </div>
            <div className="flex justify-between gap-2 border-t border-slate-100 pt-2">
              <span className="font-semibold text-slate-700">Tổng thanh toán</span>
              <span className="text-base font-bold text-sky-700">
                {formatVNDFull(savedSuccess.total)}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-6 grid w-full grid-cols-2 gap-3">
          <Link
            href="/m/orders"
            className="flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 active:scale-[0.98]"
          >
            Xem đơn của tôi
          </Link>
          <button
            type="button"
            onClick={() => {
              setSavedSuccess(null);
              setSelectedCustomer(null);
            }}
            className="flex items-center justify-center rounded-xl bg-sky-600 px-4 py-3 text-sm font-bold text-white shadow-sm active:scale-[0.98]"
          >
            Bấm đơn mới
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* Edit Mode Banner */}
      {isEditMode && (
        <div className="flex items-center justify-between gap-2 bg-amber-500 px-3 py-2 text-xs font-semibold text-white">
          <span className="truncate">Đang sửa đơn: {editOrderNumber}</span>
          <button
            type="button"
            onClick={() => router.replace("/m")}
            className="shrink-0 rounded-lg bg-white/20 px-2.5 py-1 text-[11px] font-bold"
          >
            Hủy sửa
          </button>
        </div>
      )}

      {/* Draft Restored Notice */}
      {draftRestored && !isEditMode && (
        <div className="flex items-center justify-between gap-2 border-b border-sky-200 bg-sky-50 px-3 py-1.5 text-[11px] text-sky-800">
          <span>Đã khôi phục đơn nháp chưa gửi.</span>
          <button
            type="button"
            onClick={clearDraftAndReset}
            className="font-bold text-red-600 underline"
          >
            Xóa nháp
          </button>
        </div>
      )}

      {/* Step 1: Customer Selector Card */}
      <section className="px-3 pt-3">
        {selectedCustomer ? (
          <div className="rounded-2xl border border-sky-200 bg-white p-3 shadow-sm dark:border-[#2a3547] dark:bg-[#151d2b]">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="rounded bg-[#14263d] px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
                    {formatCustomerCode(selectedCustomer.code) || selectedCustomer.code}
                  </span>
                  <span className="truncate text-sm font-bold text-slate-900 dark:text-white">
                    {selectedCustomer.name}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                  {selectedCustomer.salesRoute && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin size={11} className="text-sky-600" />
                      {selectedCustomer.salesRoute}
                    </span>
                  )}
                  {selectedCustomer.type && (
                    <span className="inline-flex items-center gap-1">
                      <Building2 size={11} />
                      {selectedCustomer.type}
                    </span>
                  )}
                  {promotions.length > 0 && (
                    <span className="inline-flex items-center gap-1 font-semibold text-emerald-600">
                      <Gift size={11} /> {promotions.length} CTKM
                    </span>
                  )}
                </div>
              </div>
              {!isEditMode && (
                <button
                  type="button"
                  onClick={() => setCustomerSheetOpen(true)}
                  className="shrink-0 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-sky-700 active:scale-95"
                >
                  Đổi KH
                </button>
              )}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCustomerSheetOpen(true)}
            className="flex w-full items-center justify-between gap-3 rounded-2xl border-2 border-dashed border-sky-400 bg-sky-50/70 px-4 py-3.5 text-left transition active:scale-[0.99]"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-600 text-white shadow-sm">
                <UserCheck size={20} />
              </div>
              <div>
                <div className="text-sm font-bold text-sky-900">
                  1. Chọn khách hàng
                </div>
                <div className="text-xs text-sky-700">
                  Chạm để chọn khách hàng theo tuyến hoặc tìm nhanh
                </div>
              </div>
            </div>
            <ChevronRight size={20} className="shrink-0 text-sky-600" />
          </button>
        )}
      </section>

      {/* Step 2: Sticky Product Search + Supplier Chips */}
      <section className="sticky top-[calc(3.25rem+env(safe-area-inset-top))] z-20 mt-2.5 border-y border-slate-200 bg-slate-100/95 px-3 py-2 backdrop-blur-sm dark:border-[#2a3547] dark:bg-[#0b1020]/95">
        <div className="relative">
          <Search
            size={17}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="search"
            value={productQuery}
            onChange={(e) => {
              setProductQuery(e.target.value);
              setVisibleProductCount(PAGE_STEP);
            }}
            placeholder="Tìm SKU, tên sản phẩm, nhà cung cấp..."
            className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-9 pr-9 text-base text-slate-900 shadow-xs focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/25"
          />
          {productQuery && (
            <button
              type="button"
              onClick={() => setProductQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:bg-slate-100"
              aria-label="Xóa từ khóa"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Horizontal Filter Chips */}
        <div className="no-scrollbar mt-2 flex items-center gap-1.5 overflow-x-auto pb-0.5">
          <button
            type="button"
            onClick={() => {
              setOnlySelectedFilter(false);
              setSupplierFilter("ALL");
              setVisibleProductCount(PAGE_STEP);
            }}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition",
              !onlySelectedFilter && supplierFilter === "ALL"
                ? "bg-[#14263d] text-white"
                : "border border-slate-300 bg-white text-slate-700",
            )}
          >
            Tất cả ({products.length})
          </button>

          <button
            type="button"
            onClick={() => {
              setOnlySelectedFilter((prev) => !prev);
              setVisibleProductCount(PAGE_STEP);
            }}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition",
              onlySelectedFilter
                ? "bg-sky-600 text-white"
                : "border border-sky-200 bg-sky-50 text-sky-700",
            )}
          >
            Đang chọn ({lines.length})
          </button>

          {suppliers.map((sup) => (
            <button
              key={sup}
              type="button"
              onClick={() => {
                setOnlySelectedFilter(false);
                setSupplierFilter((prev) => (prev === sup ? "ALL" : sup));
                setVisibleProductCount(PAGE_STEP);
              }}
              className={cn(
                "shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition",
                !onlySelectedFilter && supplierFilter === sup
                  ? "bg-sky-600 text-white"
                  : "border border-slate-300 bg-white text-slate-700",
              )}
            >
              {sup}
            </button>
          ))}
        </div>
      </section>

      {/* Product Cards List */}
      <section
        className={cn(
          "flex-1 space-y-2.5 px-3 pt-2.5",
          lines.length > 0 ? "pb-24" : "pb-4",
        )}
      >
        {visibleProducts.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">
            <Package size={32} className="mx-auto mb-2 text-slate-300" />
            <p className="text-sm font-medium">Không tìm thấy sản phẩm phù hợp</p>
            {(productQuery || supplierFilter !== "ALL" || onlySelectedFilter) && (
              <button
                type="button"
                onClick={() => {
                  setProductQuery("");
                  setSupplierFilter("ALL");
                  setOnlySelectedFilter(false);
                }}
                className="mt-2 text-xs font-semibold text-sky-600 underline"
              >
                Xóa bộ lọc
              </button>
            )}
          </div>
        ) : (
          <>
            {visibleProducts.map((product) => {
              const cartLine = lineBySku.get(product.sku);
              const inCart = Boolean(cartLine);
              const cartons = cartLine?.cartons ?? 0;
              const boxes = cartLine?.boxes ?? 0;
              const totalQty = cartLine?.quantity ?? 0;
              const stock = stockMap.get(product.sku.toUpperCase());
              const isOverStock =
                stock != null && totalQty + (cartLine?.promoQuantity ?? 0) > stock;
              const hasCarton = product.boxesPerCarton > 1;

              return (
                <article
                  key={product.id}
                  className={cn(
                    "rounded-2xl border bg-white p-3 shadow-xs transition-colors dark:bg-[#151d2b]",
                    inCart
                      ? "border-sky-500 ring-1 ring-sky-500/25"
                      : "border-slate-200 dark:border-[#2a3547]",
                  )}
                >
                  {/* Top row: Name & Unit price */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-[13px] font-bold leading-snug text-slate-900 dark:text-white">
                        {product.name}
                      </h3>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono font-semibold text-slate-600">
                          {product.sku}
                        </span>
                        {hasCarton && (
                          <span className="text-slate-500">
                            {product.boxesPerCarton} {product.unit || "hộp"}/thùng
                          </span>
                        )}
                        {stock != null ? (
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                              isOverStock || stock <= 0
                                ? "bg-red-100 text-red-700"
                                : stock <= 10
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-emerald-50 text-emerald-700",
                            )}
                          >
                            Tồn: {formatNumber(stock)}
                          </span>
                        ) : stockLoading ? (
                          <span className="text-[10px] text-slate-400">...</span>
                        ) : null}
                      </div>
                    </div>

                    <div className="shrink-0 text-right">
                      <div className="text-xs font-bold text-sky-700">
                        {formatVNDFull(product.basePrice)}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        /{product.unit || "đv"}
                      </div>
                    </div>
                  </div>

                  {/* Stepper Controls: Thumb-friendly Thùng & Lẻ */}
                  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
                    <div className="flex flex-1 items-center gap-2">
                      {hasCarton && (
                        <div className="flex flex-1 items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-1">
                          <button
                            type="button"
                            onClick={() =>
                              setProductQty(product, Math.max(0, cartons - 1), boxes)
                            }
                            disabled={cartons <= 0}
                            className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-slate-700 shadow-xs active:scale-95 disabled:opacity-35"
                            aria-label="Giảm thùng"
                          >
                            <Minus size={16} />
                          </button>
                          <div className="min-w-[48px] text-center">
                            <input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              value={cartons === 0 ? "" : cartons}
                              placeholder="0"
                              onChange={(e) =>
                                setProductQty(
                                  product,
                                  Math.max(0, parseInt(e.target.value || "0", 10) || 0),
                                  boxes,
                                )
                              }
                              className="w-11 bg-transparent text-center text-sm font-bold text-slate-900 focus:outline-none"
                            />
                            <div className="text-[9px] font-semibold uppercase text-slate-400">
                              Thùng
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setProductQty(product, cartons + 1, boxes)}
                            className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-600 text-white shadow-xs active:scale-95"
                            aria-label="Tăng thùng"
                          >
                            <Plus size={16} />
                          </button>
                        </div>
                      )}

                      <div className="flex flex-1 items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-1">
                        <button
                          type="button"
                          onClick={() =>
                            setProductQty(product, cartons, Math.max(0, boxes - 1))
                          }
                          disabled={boxes <= 0}
                          className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-slate-700 shadow-xs active:scale-95 disabled:opacity-35"
                          aria-label="Giảm lẻ"
                        >
                          <Minus size={16} />
                        </button>
                        <div className="min-w-[48px] text-center">
                          <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            value={boxes === 0 ? "" : boxes}
                            placeholder="0"
                            onChange={(e) =>
                              setProductQty(
                                product,
                                cartons,
                                Math.max(0, parseInt(e.target.value || "0", 10) || 0),
                              )
                            }
                            className="w-11 bg-transparent text-center text-sm font-bold text-slate-900 focus:outline-none"
                          />
                          <div className="text-[9px] font-semibold uppercase text-slate-400">
                            {hasCarton ? "Lẻ" : product.unit || "SL"}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setProductQty(product, cartons, boxes + 1)}
                          className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-600 text-white shadow-xs active:scale-95"
                          aria-label="Tăng lẻ"
                        >
                          <Plus size={16} />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Line summary when selected */}
                  {inCart && cartLine && (
                    <div className="mt-2 flex items-center justify-between rounded-xl bg-sky-50/80 px-2.5 py-1.5 text-xs">
                      <span className="font-medium text-sky-900">
                        SL: <strong>{formatNumber(cartLine.quantity)}</strong>{" "}
                        {product.unit || "đv"}
                        {isOverStock && (
                          <span className="ml-1.5 font-bold text-red-600">
                            (Vượt tồn!)
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sky-800">
                          {formatVNDFull(lineNetAmount(cartLine))}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeLine(product.sku)}
                          className="rounded p-1 text-red-500 hover:bg-red-50"
                          aria-label="Xóa sản phẩm"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}

            {filteredProducts.length > visibleProductCount && (
              <button
                type="button"
                onClick={() => setVisibleProductCount((c) => c + PAGE_STEP)}
                className="w-full rounded-xl border border-slate-300 bg-white py-3 text-xs font-bold text-sky-700 active:scale-[0.99]"
              >
                Xem thêm ({filteredProducts.length - visibleProductCount} sản phẩm nữa)
              </button>
            )}
          </>
        )}
      </section>

      {/* Floating Sticky Cart Summary Bar */}
      {lines.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-20 px-3">
          <div className="mx-auto max-w-2xl">
            <button
              type="button"
              onClick={() => setCartSheetOpen(true)}
              className="flex w-full items-center justify-between gap-3 rounded-2xl bg-[#14263d] px-4 py-3 text-white shadow-xl ring-1 ring-white/10 transition active:scale-[0.99]"
            >
              <div className="flex items-center gap-2.5 text-left">
                <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500">
                  <ShoppingBag size={19} className="text-white" />
                  <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                    {lines.length}
                  </span>
                </div>
                <div>
                  <div className="text-[11px] text-slate-300">
                    {lines.length} SP · {totalCartons}T {totalBoxes}L
                    {shortageLines.length > 0 && (
                      <span className="ml-1.5 font-bold text-amber-300">
                        · {shortageLines.length} vượt tồn
                      </span>
                    )}
                  </div>
                  <div className="text-base font-extrabold tracking-tight text-white">
                    {formatVNDFull(totalAmount)}
                  </div>
                </div>
              </div>
              <span className="shrink-0 rounded-xl bg-sky-500 px-3.5 py-2 text-xs font-bold text-white">
                Xem & Gửi →
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Bottom Sheet: Chọn Khách Hàng */}
      {customerSheetOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/50">
          <div
            className="flex-1"
            onClick={() => setCustomerSheetOpen(false)}
          />
          <div className="mobile-sheet-enter mx-auto flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-[#151d2b]">
            <div className="flex items-center justify-between bg-[#14263d] px-4 py-3 text-white">
              <div className="flex items-center gap-2">
                <UserCheck size={17} className="text-red-400" />
                <span className="text-xs font-bold uppercase tracking-wide">
                  Chọn Khách Hàng ({filteredCustomers.length})
                </span>
              </div>
              <button
                type="button"
                onClick={() => setCustomerSheetOpen(false)}
                className="rounded-lg p-1.5 text-white hover:bg-white/10"
              >
                <X size={18} />
              </button>
            </div>

            <div className="border-b border-slate-200 p-3 space-y-2">
              <div className="relative">
                <Search
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  autoFocus
                  type="search"
                  value={customerQuery}
                  onChange={(e) => setCustomerQuery(e.target.value)}
                  placeholder="Tìm mã KH, tên cửa hàng, SĐT, tuyến..."
                  className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-base text-slate-900 focus:border-sky-500 focus:outline-none"
                />
              </div>

              {routes.length > 0 && (
                <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto">
                  <button
                    type="button"
                    onClick={() => setSelectedRouteFilter("ALL")}
                    className={cn(
                      "shrink-0 rounded-full px-3 py-1 text-xs font-semibold",
                      selectedRouteFilter === "ALL"
                        ? "bg-[#14263d] text-white"
                        : "bg-slate-100 text-slate-600",
                    )}
                  >
                    Tất cả tuyến
                  </button>
                  {routes.map((route) => (
                    <button
                      key={route}
                      type="button"
                      onClick={() => setSelectedRouteFilter(route)}
                      className={cn(
                        "shrink-0 rounded-full px-3 py-1 text-xs font-semibold",
                        selectedRouteFilter === route
                          ? "bg-sky-600 text-white"
                          : "bg-slate-100 text-slate-600",
                      )}
                    >
                      {route}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex-1 divide-y divide-slate-100 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
              {filteredCustomers.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  Không tìm thấy khách hàng nào.
                </div>
              ) : (
                filteredCustomers.map((c) => {
                  const isCurrent = selectedCustomer?.id === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleSelectCustomer(c)}
                      className={cn(
                        "flex w-full items-start justify-between gap-2 px-4 py-3 text-left transition active:bg-sky-50",
                        isCurrent ? "bg-sky-50/80" : "hover:bg-slate-50",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-700">
                            {formatCustomerCode(c.code) || c.code}
                          </span>
                          <span className="truncate text-sm font-bold text-slate-900">
                            {c.name}
                          </span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 text-[11px] text-slate-500">
                          {c.salesRoute && (
                            <span className="inline-flex items-center gap-0.5 text-sky-700 font-medium">
                              <MapPin size={10} /> {c.salesRoute}
                            </span>
                          )}
                          {c.storeName && <span>{c.storeName}</span>}
                          {c.staffName && <span>NV: {c.staffName}</span>}
                        </div>
                      </div>
                      {isCurrent && (
                        <CheckCircle2 size={18} className="shrink-0 text-sky-600" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bottom Sheet: Xác nhận Giỏ hàng & Gửi đơn */}
      {cartSheetOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/55">
          <div className="flex-1" onClick={() => setCartSheetOpen(false)} />
          <div className="mobile-sheet-enter mx-auto flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-[#151d2b]">
            {/* Header chuẩn GEMINI.md (#14263d + icon đỏ) */}
            <div className="flex items-center justify-between bg-[#14263d] px-4 py-3 text-white">
              <div className="flex items-center gap-2">
                <ShoppingCart size={17} className="text-red-500" />
                <div>
                  <div className="text-xs font-bold uppercase tracking-wide">
                    {isEditMode ? `Cập nhật đơn ${editOrderNumber}` : "Xác nhận & Gửi đơn"}
                  </div>
                  {orderNumber && (
                    <div className="font-mono text-[10px] text-sky-300">
                      Mã đơn: {orderNumber}
                    </div>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCartSheetOpen(false)}
                className="rounded-lg p-1.5 text-white hover:bg-white/10"
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 space-y-3 overflow-y-auto p-3.5">
              {/* Customer summary */}
              {selectedCustomer ? (
                <div className="flex items-center justify-between rounded-xl border border-sky-200 bg-sky-50/70 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-bold text-sky-950">
                      {selectedCustomer.name}
                    </div>
                    <div className="text-[11px] text-sky-700">
                      Mã: {selectedCustomer.code}
                      {salesRoute ? ` · Tuyến: ${salesRoute}` : ""}
                    </div>
                  </div>
                  {!isEditMode && (
                    <button
                      type="button"
                      onClick={() => {
                        setCartSheetOpen(false);
                        setCustomerSheetOpen(true);
                      }}
                      className="shrink-0 text-xs font-bold text-sky-700 underline"
                    >
                      Đổi
                    </button>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setCartSheetOpen(false);
                    setCustomerSheetOpen(true);
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs font-bold text-amber-800"
                >
                  <AlertTriangle size={15} /> Chưa chọn khách hàng — Chạm để chọn
                </button>
              )}

              {editBlockedReason && (
                <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                  {editBlockedReason}
                </div>
              )}

              {shortageLines.length > 0 && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600" />
                  <span>
                    Có <strong>{shortageLines.length}</strong> sản phẩm vượt tồn kho khả dụng (vẫn có thể gửi đơn nếu NPP cho phép).
                  </span>
                </div>
              )}

              {/* Line items */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase text-slate-600">
                    Danh sách hàng ({lines.length} SKU)
                  </span>
                  {loadingPromotions && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-sky-600">
                      <Loader2 size={12} className="animate-spin" /> Đang kiểm tra CTKM...
                    </span>
                  )}
                </div>

                {lines.map((line) => {
                  const product = products.find((p) => p.sku === line.productCode);
                  const qualifying =
                    orderType === "001-Xuất hàng"
                      ? getMobileQualifyingPromotions(line, lines, promotions, products)
                      : [];
                  const stock = stockMap.get(line.productCode.toUpperCase());
                  const over =
                    stock != null && line.quantity + line.promoQuantity > stock;

                  return (
                    <div
                      key={line.productCode}
                      className="rounded-xl border border-slate-200 bg-slate-50/70 p-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold text-slate-900">
                            {line.productName}
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-500">
                            {line.productCode} · {formatVNDFull(line.price)}/{line.unit || "đv"}
                            {over && (
                              <span className="ml-1.5 font-bold text-red-600">
                                (Tồn: {formatNumber(stock ?? 0)})
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeLine(line.productCode)}
                          className="rounded-lg p-1.5 text-red-500 hover:bg-red-50"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>

                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="text-xs font-semibold text-slate-700">
                          {line.boxesPerCarton > 1
                            ? `${line.cartons}T ${line.boxes}L (${formatNumber(line.quantity)} ${line.unit || "đv"})`
                            : `${formatNumber(line.quantity)} ${line.unit || "đv"}`}
                          {line.promoQuantity > 0 && (
                            <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                              +{formatNumber(line.promoQuantity)} KM
                            </span>
                          )}
                        </div>
                        <div className="text-right">
                          {line.discountAmount > 0 && (
                            <div className="text-[10px] text-emerald-600">
                              CK: -{formatVNDFull(line.discountAmount)}
                            </div>
                          )}
                          <div className="text-xs font-bold text-sky-800">
                            {formatVNDFull(lineNetAmount(line))}
                          </div>
                        </div>
                      </div>

                      {/* Quick stepper inside cart */}
                      {product && (
                        <div className="mt-2 flex items-center gap-2">
                          {line.boxesPerCarton > 1 && (
                            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-1.5 py-0.5 text-xs">
                              <span className="text-[10px] text-slate-400">T:</span>
                              <button
                                type="button"
                                onClick={() =>
                                  setProductQty(product, Math.max(0, line.cartons - 1), line.boxes)
                                }
                                className="flex h-6 w-6 items-center justify-center rounded bg-slate-100"
                              >
                                <Minus size={12} />
                              </button>
                              <span className="min-w-[20px] text-center font-bold">
                                {line.cartons}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setProductQty(product, line.cartons + 1, line.boxes)
                                }
                                className="flex h-6 w-6 items-center justify-center rounded bg-sky-600 text-white"
                              >
                                <Plus size={12} />
                              </button>
                            </div>
                          )}
                          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-1.5 py-0.5 text-xs">
                            <span className="text-[10px] text-slate-400">
                              {line.boxesPerCarton > 1 ? "L:" : "SL:"}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setProductQty(product, line.cartons, Math.max(0, line.boxes - 1))
                              }
                              className="flex h-6 w-6 items-center justify-center rounded bg-slate-100"
                            >
                              <Minus size={12} />
                            </button>
                            <span className="min-w-[20px] text-center font-bold">
                              {line.boxes}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setProductQty(product, line.cartons, line.boxes + 1)
                              }
                              className="flex h-6 w-6 items-center justify-center rounded bg-sky-600 text-white"
                            >
                              <Plus size={12} />
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Qualifying Promotions selector */}
                      {qualifying.length > 0 && (
                        <div className="mt-2 border-t border-slate-200/70 pt-2">
                          <label className="mb-1 flex items-center gap-1 text-[10px] font-bold text-emerald-700">
                            <Gift size={11} /> Áp dụng Khuyến mãi ({qualifying.length})
                          </label>
                          <select
                            value={line.promotionId ?? ""}
                            onChange={(e) =>
                              applyLinePromotion(
                                line.productCode,
                                e.target.value ? Number(e.target.value) : null,
                              )
                            }
                            className="w-full rounded-lg border border-emerald-300 bg-white px-2 py-1.5 text-xs text-slate-800"
                          >
                            <option value="">-- Không áp dụng CTKM --</option>
                            {qualifying.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.code} - {p.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {promotionError && (
                <div className="text-[11px] text-amber-700">{promotionError}</div>
              )}

              {/* Note */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">
                  Ghi chú đơn hàng
                </label>
                <textarea
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="VD: Giao buổi sáng, gọi trước khi giao..."
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-sky-500 focus:outline-none"
                />
              </div>

              {/* Collapsible Order Metadata */}
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowExtraInfo((v) => !v)}
                  className="flex w-full items-center justify-between bg-slate-50 px-3 py-2.5 text-xs font-semibold text-slate-700"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <SlidersHorizontal size={13} className="text-sky-600" />
                    Thông tin bổ sung (Loại đơn, Ngày giao, NVGH, Kho)
                  </span>
                  {showExtraInfo ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                </button>

                {showExtraInfo && (
                  <div className="grid grid-cols-2 gap-2.5 border-t border-slate-200 bg-white p-3">
                    <div>
                      <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                        Loại đơn
                      </label>
                      <select
                        value={orderType}
                        onChange={(e) => {
                          setOrderType(e.target.value);
                          setLines((prev) =>
                            prev.map((l) => ({
                              ...l,
                              promotionId: null,
                              promoQuantity: 0,
                              discountAmount: 0,
                            })),
                          );
                        }}
                        className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs"
                      >
                        {MOBILE_ORDER_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                        Kho kiểm tồn
                      </label>
                      <select
                        value={warehouseId ?? ""}
                        onChange={(e) =>
                          setWarehouseId(e.target.value ? Number(e.target.value) : null)
                        }
                        className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs"
                      >
                        {warehouses.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                        Ngày đơn hàng
                      </label>
                      <input
                        type="date"
                        value={orderDate}
                        onChange={(e) => setOrderDate(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs"
                      />
                    </div>

                    <div>
                      <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                        Ngày giao hàng
                      </label>
                      <input
                        type="date"
                        value={deliveryDate}
                        onChange={(e) => setDeliveryDate(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs"
                      />
                    </div>

                    <div className="col-span-2">
                      <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                        Nhân viên giao hàng (NVGH)
                      </label>
                      <select
                        value={deliveryEmployeeCode}
                        onChange={(e) => setDeliveryEmployeeCode(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs"
                      >
                        <option value="">-- Chưa chỉ định --</option>
                        {deliveryEmployees.map((emp) => (
                          <option key={emp.code} value={emp.code}>
                            {emp.code} - {emp.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {submitError && (
                <div
                  role="alert"
                  className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700"
                >
                  {submitError}
                </div>
              )}
            </div>

            {/* Footer Totals & Submit */}
            <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <div className="mb-2.5 space-y-1 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Tiền hàng ({lines.length} SP)</span>
                  <span className="font-semibold">{formatVNDFull(subtotal)}</span>
                </div>
                {totalDiscount > 0 && (
                  <div className="flex justify-between text-emerald-700">
                    <span>Chiết khấu KM</span>
                    <span className="font-semibold">-{formatVNDFull(totalDiscount)}</span>
                  </div>
                )}
                {totalPromoQty > 0 && (
                  <div className="flex justify-between text-emerald-700">
                    <span>Hàng tặng KM</span>
                    <span className="font-semibold">+{formatNumber(totalPromoQty)} đv</span>
                  </div>
                )}
                <div className="flex items-baseline justify-between border-t border-slate-200 pt-1.5">
                  <span className="text-sm font-bold text-slate-800">Tổng thanh toán</span>
                  <span className="text-lg font-extrabold text-sky-700">
                    {formatVNDFull(totalAmount)}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setCartSheetOpen(false)}
                  className="rounded-xl bg-red-700 px-3 py-3 text-xs font-bold text-white active:scale-[0.98]"
                >
                  Đóng
                </button>
                <button
                  type="button"
                  disabled={
                    submitting ||
                    !selectedCustomer ||
                    lines.length === 0 ||
                    Boolean(editBlockedReason)
                  }
                  onClick={() => void handleSubmitOrder()}
                  className="col-span-2 flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-bold text-white shadow-sm active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {submitting ? (
                    <Loader2 size={17} className="animate-spin" />
                  ) : (
                    <CheckCircle2 size={17} />
                  )}
                  {submitting
                    ? "Đang gửi đơn..."
                    : isEditMode
                      ? "Lưu cập nhật đơn"
                      : "Gửi đơn hàng"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

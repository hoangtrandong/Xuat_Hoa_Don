"use client";
/* eslint-disable react-hooks/set-state-in-effect */
// src/app/sales/create/page.tsx - Tao don hang tu tao (ma don bat dau bang TC-), hien thi chung voi don dong bo tu DMS
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, AlertTriangle, Loader2, RefreshCw, Search, ShoppingCart, Trash2, X } from "lucide-react";
import Badge from "@/components/ui/Badge";
import { API_URL, apiFetch } from "@/lib/api";
import { formatCustomerCode, formatVNDFull, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

interface SystemCustomer {
  id: number;
  code: string;
  name: string;
  type: string;
  tier: string;
  status: string;
  staffCode: string;
  staffName: string;
  storeName: string;
  salesRoute: string;
}

interface SystemProduct {
  id: number;
  sku: string;
  nppCode: string;
  name: string;
  unit: string;
  supplier: string;
  basePrice: number;
  boxesPerCarton: number;
}

interface PromotionRule {
  id: number;
  trigger_type: "QUANTITY" | "AMOUNT" | "CARTON";
  min_quantity: number | null;
  max_quantity: number | null;
  quantity_unit: "CARTON" | "BOX";
  min_amount: number | null;
  max_amount: number | null;
  reward_type: "FREE_QUANTITY" | "DISCOUNT_AMOUNT" | "DISCOUNT_PERCENT";
  reward_value: number;
  reward_unit: "CARTON" | "BOX";
  reward_product_operator?: "AND" | "OR";
  reward_product_ids?: number[];
  reward_product_groups?: number[][];
  reward_product_details?: PromotionRewardProduct[][];
}

interface PromotionRewardProduct {
  product_id: number;
  quantity: number;
  unit: "CARTON" | "BOX";
}

interface PromotionRewardLine {
  productId: number;
  productName: string;
  sku: string;
  quantity: number;
  unit: "CARTON" | "BOX";
  groupIndex: number;
  optionIndex: number;
}

interface PromotionOption {
  id: number;
  code: string;
  name: string;
  product_scope: "SELECTED" | "SUPPLIER";
  supplier: string | null;
  promotion_type: "ORDER" | "AFTER_SALES";
  applied_quantity_unit: "STANDARD" | "SECONDARY";
  minimum_product_quantity: number;
  product_ids: number[];
  product_min_quantities: Record<number, number>;
  rules: PromotionRule[];
}

interface WarehouseOption {
  id: number;
  name: string;
}

interface EmployeeOption {
  code: string;
  name: string;
  status: string;
}

interface CurrentUser {
  username: string;
  full_name: string;
  employee_code: string | null;
  employee_name: string | null;
}

interface Line {
  productId: number;
  productCode: string;
  nppCode: string;
  productName: string;
  unit: string;
  supplier: string;
  boxesPerCarton: number;
  cartons: number;
  boxes: number;
  quantity: number;
  promoQuantity: number;
  price: number;
  discountAmount: number;
  promotionId: number | null;
}

interface PromotionRewardCalculation {
  promoQuantity: number;
  discountAmount: number;
  benefit: number;
  products: PromotionRewardLine[];
}

const customerTypeLabel: Record<string, string> = {
  DISTRIBUTOR: "Nhà phân phối",
  WHOLESALE: "Đại lý",
  HORECA: "HORECA",
  RETAIL: "Cửa hàng",
};

const ORDER_TYPES = ["001-Xuất hàng", "002-Dương Số"] as const;

function todayStr() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function normalizeText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
}

export default function CreateOrderForm({
  onClose,
  onSaved,
}: {
  onClose?: () => void;
  onSaved?: (orderNumber: string) => void;
}) {
  const router = useRouter();
  const [customers, setCustomers] = useState<SystemCustomer[]>([]);
  const [products, setProducts] = useState<SystemProduct[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [stockMap, setStockMap] = useState<Map<string, number>>(new Map());
  const [stockError, setStockError] = useState("");
  const [stockLoading, setStockLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [customerQuery, setCustomerQuery] = useState("");
  const [customerOpen, setCustomerOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<SystemCustomer | null>(null);
  const [orderType, setOrderType] = useState<string>("001-Xuất hàng");
  const [createdBy, setCreatedBy] = useState("");
  const [staffCode, setStaffCode] = useState("");
  const [staffName, setStaffName] = useState("");
  const hasOwnStaffRef = useRef(false);
  const [deliveryEmployees, setDeliveryEmployees] = useState<EmployeeOption[]>([]);
  const [deliveryEmployeeCode, setDeliveryEmployeeCode] = useState("");
  const [orderDate, setOrderDate] = useState(todayStr());
  const [entryDate, setEntryDate] = useState(todayStr());
  const [deliveryDate, setDeliveryDate] = useState(todayStr());
  const [salesRoute, setSalesRoute] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [orderNumberError, setOrderNumberError] = useState("");
  const [promotions, setPromotions] = useState<PromotionOption[]>([]);
  const [promotionError, setPromotionError] = useState("");
  const [loadingPromotions, setLoadingPromotions] = useState(false);
  const [promotionsLoaded, setPromotionsLoaded] = useState(false);

  const [productQuery, setProductQuery] = useState("");
  const [productOpen, setProductOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [pickError, setPickError] = useState("");
  const [note, setNote] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Tai du lieu that tu he thong: khach hang, Danh sach SKU, kho
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [custRes, prodRes, unitRes, whRes, meRes, empRes] = await Promise.all([
          apiFetch(`${API_URL}/customers/?limit=5000`),
          apiFetch(`${API_URL}/products/?limit=10000`),
          apiFetch(`${API_URL}/products/units/`),
          apiFetch(`${API_URL}/inventory/warehouses/`),
          apiFetch(`${API_URL}/auth/me`),
          apiFetch(`${API_URL}/employees/?status=active&limit=1000`),
        ]);
        if (!custRes.ok) throw new Error("Không thể tải danh sách khách hàng.");
        if (!prodRes.ok) throw new Error("Không thể tải Danh sách SKU.");
        if (!whRes.ok) throw new Error("Không thể tải danh sách kho.");
        const custRows = (await custRes.json()) as Array<Record<string, unknown>>;
        const prodRows = (await prodRes.json()) as Array<Record<string, unknown>>;
        const unitRows = unitRes.ok ? ((await unitRes.json()) as Array<{ id: number; name: string }>) : [];
        const whRows = (await whRes.json()) as Array<{ id: number; name: string }>;
        const me = meRes.ok ? ((await meRes.json()) as CurrentUser) : null;
        const empRows = empRes.ok ? ((await empRes.json()) as EmployeeOption[]) : [];
        if (cancelled) return;
        // NVBH mac dinh = nhan vien gan voi tai khoan dang dang nhap.
        // Tai khoan quan tri (vd: admin) khong gan nhan vien -> NVBH lay theo khach hang khi chon KH.
        if (me?.employee_code) {
          hasOwnStaffRef.current = true;
          setStaffCode(me.employee_code);
          setStaffName(me.employee_name ?? "");
        }
        setCreatedBy(me?.full_name || me?.username || "");
        // NVGH: nhan vien dang hoat dong co ma bat dau bang NV (giong man hinh Yeu cau xuat hang)
        setDeliveryEmployees(
          (Array.isArray(empRows) ? empRows : []).filter(
            (e) => e.status?.toLowerCase() === "active" && e.code?.trim().toUpperCase().startsWith("NV")
          )
        );
        const unitName = new Map(unitRows.map((u) => [u.id, u.name]));
        const loadedCustomers = custRows
          .filter((row) => row.status !== "inactive")
          .map((row) => ({
            id: Number(row.id),
            code: String(row.code ?? ""),
            name: String(row.name ?? ""),
            type: customerTypeLabel[String(row.type ?? "")] ?? String(row.type ?? ""),
            tier: String(row.tier ?? ""),
            status: String(row.status ?? "active"),
            staffCode: String(row.staff_code ?? ""),
            staffName: String(row.staff_name ?? ""),
            storeName: String(row.store_name ?? ""),
            salesRoute: String(row.store_route ?? ""),
          }));
        setCustomers(loadedCustomers);
        setProducts(
          prodRows
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
            }))
        );
        setWarehouses(whRows.map((w) => ({ id: w.id, name: w.name })));
        if (whRows.length > 0) setWarehouseId(whRows[0].id);
        const key = new URLSearchParams(window.location.search).get("customer");
        if (key) {
          const c = loadedCustomers.find((x) => x.code === key);
          if (c) selectCustomer(c);
        }
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Không thể tải dữ liệu.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Ton kha dung theo kho (chi de canh bao)
  useEffect(() => {
    if (warehouseId == null) return;
    let cancelled = false;
    setStockLoading(true);
    setStockError("");
    setStockMap(new Map());
    apiFetch(`${API_URL}/inventory/stock-levels/?warehouse_id=${warehouseId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Không thể tải tồn kho của kho đã chọn.");
        return (await res.json()) as Array<{ product_code: string; available: number }>;
      })
      .then((rows) => {
        if (!cancelled) setStockMap(new Map(rows.map((r) => [r.product_code.toUpperCase(), Number(r.available ?? 0)])));
      })
      .catch((error: unknown) => {
        if (!cancelled) setStockError(error instanceof Error ? error.message : "Không thể tải tồn kho.");
      })
      .finally(() => {
        if (!cancelled) setStockLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [warehouseId]);

  useEffect(() => {
    let cancelled = false;
    setOrderNumberError("");
    apiFetch(`${API_URL}/sync/vinamilk-orders/manual/next-number?order_date=${orderDate}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Không thể lấy mã đơn dự kiến.");
        return (await res.json()) as { order_number: string };
      })
      .then((result) => {
        if (!cancelled) setOrderNumber(result.order_number);
      })
      .catch(() => {
        if (!cancelled) {
          setOrderNumber("");
          setOrderNumberError("Không thể tải mã dự kiến; mã sẽ được cấp khi lưu.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [orderDate]);

  function selectCustomer(c: SystemCustomer) {
    setSelectedCustomer(c);
    setPromotions([]);
    setPromotionsLoaded(false);
    setPromotionError("");
    setLines((previous) => previous.map((line) => ({
      ...line,
      promotionId: null,
      promoQuantity: 0,
      discountAmount: 0,
    })));
    // Tai khoan gan nhan vien: giu NVBH la nguoi dang nhap. Tai khoan quan tri: dung NVBH cua khach hang.
    if (!hasOwnStaffRef.current) {
      setStaffCode(c.staffCode);
      setStaffName(c.staffName);
    }
    setSalesRoute(c.salesRoute);
    setCustomerOpen(false);
    setCustomerQuery("");
  }

  function clearCustomer() {
    setSelectedCustomer(null);
    setPromotions([]);
    setPromotionsLoaded(false);
    setPromotionError("");
    setLines((previous) => previous.map((line) => ({
      ...line,
      promotionId: null,
      promoQuantity: 0,
      discountAmount: 0,
    })));
  }

  function changeStaffCode(nextCode: string) {
    setStaffCode(nextCode);
    setPromotions([]);
    setPromotionsLoaded(false);
    setPromotionError("");
    setLines((previous) => previous.map((line) => ({
      ...line,
      promotionId: null,
      promoQuantity: 0,
      discountAmount: 0,
    })));
  }

  const filteredCustomers = useMemo(() => {
    const q = normalizeText(customerQuery.trim());
    const list = q
      ? customers.filter((c) =>
          [c.code, c.name, c.staffCode, c.staffName, c.storeName].some((v) => normalizeText(v).includes(q))
        )
      : customers;
    return list.slice(0, 20);
  }, [customerQuery, customers]);

  const filteredProducts = useMemo(() => {
    const q = normalizeText(productQuery.trim());
    const list = q
      ? products.filter((p) => [p.sku, p.name, p.supplier].some((v) => normalizeText(v).includes(q)))
      : products;
    return list.slice(0, 20);
  }, [productQuery, products]);

  const lineValue = (l: Line) => Math.round(l.price * l.quantity);
  const subtotal = lines.reduce((s, l) => s + lineValue(l), 0);
  const totalDiscount = lines.reduce((s, l) => s + Math.min(l.discountAmount, lineValue(l)), 0);
  const total = subtotal - totalDiscount;
  const stockOf = (code: string) => stockMap.get(code.toUpperCase());

  function promotionMatchesProduct(promotion: PromotionOption, line: Line) {
    return promotion.product_scope === "SUPPLIER"
      ? (promotion.supplier ?? "").trim().toLocaleLowerCase() === line.supplier.trim().toLocaleLowerCase()
      : promotion.product_ids.includes(line.productId);
  }

  function getPromotionReward(promotion: PromotionOption, line: Line) {
    if (!promotionMatchesProduct(promotion, line)) return null;
    const minimumQuantity = promotion.product_scope === "SELECTED"
      ? Math.max(1, Number(promotion.product_min_quantities[line.productId] ?? 1))
      : 1;
    if (line.quantity < minimumQuantity) return null;
    const value = line.quantity * line.price;
    const cartons = Math.floor(line.quantity / Math.max(1, line.boxesPerCarton));
    let best: PromotionRewardCalculation | null = null;
    for (const rule of promotion.rules) {
      const quantityRule = rule.trigger_type === "QUANTITY" || rule.trigger_type === "CARTON";
      const threshold = quantityRule ? (rule.min_quantity ?? 1) : (rule.min_amount ?? 0);
      const basis = quantityRule
        ? (rule.quantity_unit === "CARTON" ? cartons : line.quantity)
        : value;
      const maximum = quantityRule ? rule.max_quantity : rule.max_amount;
      if (maximum != null && basis > maximum) continue;
      const repeats = threshold > 0 ? Math.floor(basis / threshold) : 0;
      if (repeats < 1) continue;
      let candidate: { promoQuantity: number; discountAmount: number };
      let rewardProducts: PromotionRewardLine[] = [];
      if (rule.reward_type === "FREE_QUANTITY") {
        const configuredGroups = rule.reward_product_details?.length
          ? rule.reward_product_details
          : rule.reward_product_groups?.length
            ? rule.reward_product_groups.map((group) => group.map((product_id) => ({
                product_id,
                quantity: rule.reward_value,
                unit: rule.reward_unit,
              })))
            : rule.reward_product_ids?.length
              ? [rule.reward_product_ids.map((product_id) => ({
                  product_id,
                  quantity: rule.reward_value,
                  unit: rule.reward_unit,
                }))]
              : [];
        rewardProducts = configuredGroups.flatMap((group, groupIndex) => group.flatMap((configured, optionIndex) => {
          const product = products.find((item) => item.id === configured.product_id);
          if (!product) return [];
          return [{
            productId: product.id,
            productName: product.name,
            sku: product.sku,
            quantity: configured.quantity * repeats,
            unit: configured.unit,
            groupIndex,
            optionIndex,
          }];
        }));
        const selectedRewardProducts = rewardProducts.filter((item) => item.optionIndex === 0);
        const rewardedUnits = selectedRewardProducts.length
          ? selectedRewardProducts.reduce((sum, item) => {
              const product = products.find((entry) => entry.id === item.productId);
              return sum + item.quantity * (item.unit === "CARTON" ? product?.boxesPerCarton ?? 1 : 1);
            }, 0)
          : rule.reward_value * repeats;
        candidate = { promoQuantity: rewardedUnits, discountAmount: 0 };
      } else if (rule.reward_type === "DISCOUNT_PERCENT") {
        candidate = { promoQuantity: 0, discountAmount: Math.min(value, value * rule.reward_value / 100 * repeats) };
      } else {
        candidate = { promoQuantity: 0, discountAmount: Math.min(value, rule.reward_value * repeats) };
      }
      const selectedGiftValue = rewardProducts
        .filter((item) => item.optionIndex === 0)
        .reduce((sum, item) => {
          const product = products.find((entry) => entry.id === item.productId);
          const quantity = item.quantity * (item.unit === "CARTON" ? product?.boxesPerCarton ?? 1 : 1);
          return sum + quantity * (product?.basePrice ?? 0);
        }, 0);
      const benefit = (rewardProducts.length ? selectedGiftValue : candidate.promoQuantity * line.price)
        + candidate.discountAmount;
      if (!best || benefit > best.benefit) {
        best = { ...candidate, benefit, products: rewardProducts };
      }
    }
    return best;
  }

  function getQualifyingPromotions(line: Line, currentLines: Line[], candidates: PromotionOption[] = promotions) {
    return candidates.filter((promotion) => {
      if (promotion.promotion_type !== "ORDER" || !promotionMatchesProduct(promotion, line)) return false;
      const minimumProductQuantity = Math.max(1, Number(promotion.minimum_product_quantity ?? 1));
      const matchingProductCount = currentLines.filter((candidate) => {
        if (!promotionMatchesProduct(promotion, candidate)) return false;
        const minimumQuantity = promotion.product_scope === "SELECTED"
          ? Math.max(1, Number(promotion.product_min_quantities[candidate.productId] ?? 1))
          : 1;
        return candidate.quantity >= minimumQuantity;
      }).length;
      return matchingProductCount >= minimumProductQuantity && getPromotionReward(promotion, line) != null;
    });
  }

  function addProduct(product: SystemProduct) {
    setPickError("");
    if (lines.some((l) => l.productCode === product.sku)) {
      setPickError("Sản phẩm đã có trong đơn hàng.");
      return;
    }
    setLines((prev) => [
      ...prev,
      {
        productId: product.id,
        productCode: product.sku,
        nppCode: product.nppCode,
        productName: product.name,
        unit: product.unit,
        supplier: product.supplier,
        boxesPerCarton: product.boxesPerCarton,
        cartons: 0,
        boxes: product.boxesPerCarton > 1 ? 0 : 1,
        quantity: product.boxesPerCarton > 1 ? 0 : 1,
        promoQuantity: 0,
        price: product.basePrice,
        discountAmount: 0,
        promotionId: null,
      },
    ]);
    setProductQuery("");
    setProductOpen(false);
  }

  function updateLine(idx: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((line, i) => {
      if (i !== idx) return line;
      const next = { ...line, ...patch };
      if ("cartons" in patch || "boxes" in patch) {
        next.cartons = Math.max(0, next.cartons);
        next.boxes = next.boxesPerCarton > 1
          ? Math.min(next.boxesPerCarton - 1, Math.max(0, next.boxes))
          : Math.max(0, next.boxes);
        next.quantity = next.boxesPerCarton > 1
          ? next.cartons * next.boxesPerCarton + next.boxes
          : next.boxes;
      }
      if (orderType === "001-Xuất hàng" && next.promotionId != null) {
        const promotion = promotions.find((item) => item.id === next.promotionId);
        const reward = promotion ? getPromotionReward(promotion, next) : null;
        if (reward) {
          next.promoQuantity = reward.promoQuantity;
          next.discountAmount = reward.discountAmount;
        } else {
          next.promotionId = null;
          next.promoQuantity = 0;
          next.discountAmount = 0;
        }
      }
      return next;
    }));
  }

  function updateLineQuantity(idx: number, quantity: number) {
    const line = lines[idx];
    if (!line) return;
    const safeQuantity = Math.max(0, Math.floor(quantity));
    const cartons = line.boxesPerCarton > 1 ? Math.floor(safeQuantity / line.boxesPerCarton) : 0;
    const boxes = line.boxesPerCarton > 1 ? safeQuantity % line.boxesPerCarton : safeQuantity;
    updateLine(idx, { cartons, boxes });
  }

  function applyPromotion(idx: number, promotionId: number | null) {
    setLines((prev) => prev.map((line, i) => {
      if (i !== idx) return line;
      const promotion = promotions.find((item) => item.id === promotionId);
      const reward = promotionId == null || !promotion
        ? null
        : getPromotionReward(promotion, line);
      return {
        ...line,
        promotionId: reward ? promotionId : null,
        promoQuantity: reward?.promoQuantity ?? 0,
        discountAmount: reward?.discountAmount ?? 0,
      };
    }));
  }

  function changeOrderType(nextType: string) {
    setOrderType(nextType);
    setLines((previous) => previous.map((line) => ({
      ...line,
      promotionId: null,
      promoQuantity: 0,
      discountAmount: 0,
    })));
  }

  function changeOrderDate(nextDate: string) {
    setOrderDate(nextDate);
    setPromotions([]);
    setPromotionsLoaded(false);
    setPromotionError("");
    setLines((previous) => previous.map((line) => line.promotionId == null
      ? line
      : { ...line, promotionId: null, promoQuantity: 0, discountAmount: 0 }));
  }

  async function loadPromotions() {
    if (!selectedCustomer) {
      setPromotionError("Vui lòng chọn khách hàng trước khi tải chương trình khuyến mãi.");
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
      const response = await apiFetch(`${API_URL}/promotions/available?${params.toString()}`);
      if (!response.ok) throw new Error("Không thể tải chương trình khuyến mãi khả dụng.");
      const result = (await response.json()) as PromotionOption[];
      setPromotions(result);
      setPromotionsLoaded(true);
    } catch (error) {
      setPromotionError(error instanceof Error ? error.message : "Không thể tải chương trình khuyến mãi.");
    } finally {
      setLoadingPromotions(false);
    }
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit() {
    setSubmitError("");
    if (!selectedCustomer) {
      setSubmitError("Vui lòng chọn khách hàng.");
      return;
    }
    if (lines.length === 0) {
      setSubmitError("Vui lòng thêm ít nhất 1 sản phẩm vào đơn.");
      return;
    }
    if (lines.some((l) => l.quantity <= 0)) {
      setSubmitError("Số lượng sản phẩm phải lớn hơn 0.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await apiFetch(`${API_URL}/sync/vinamilk-orders/manual`, {
        method: "POST",
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
          delivery_employee_name: deliveryEmployees.find((e) => e.code === deliveryEmployeeCode)?.name ?? null,
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
      const payload = (await response.json().catch(() => ({}))) as { order_number?: string; detail?: unknown };
      if (!response.ok) {
        throw new Error(typeof payload.detail === "string" ? payload.detail : "Không thể lưu đơn hàng.");
      }
      const createdOrderNumber = payload.order_number ?? "";
      window.sessionStorage.setItem("dms-order-created", createdOrderNumber);
      if (onSaved) onSaved(createdOrderNumber);
      else router.push("/sales/orders");
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Không thể lưu đơn hàng.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls =
    "w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-100";

  return (
    <div className="overflow-hidden border border-slate-400 bg-white shadow-lg">
      <header className="flex items-center justify-between bg-[#14263d] px-3 py-2 text-white">
        <div className="flex items-center gap-2">
          <ShoppingCart size={17} className="text-red-500" />
          <h1 className="text-xs font-bold uppercase">Thêm mới đơn đặt hàng</h1>
        </div>
        <button type="button" onClick={() => onClose ? onClose() : router.push("/sales/orders")} className="rounded p-1 text-white hover:bg-white/10" aria-label="Đóng tạo đơn hàng">
          <X size={16} />
        </button>
      </header>

      <div className="max-h-[calc(100vh-12rem)] overflow-y-auto">
        {(submitError || loadError) && (
          <div role="alert" className="mx-3 mt-2 flex items-center gap-2 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertTriangle size={14} /> {submitError || loadError}
          </div>
        )}

        <section className="border-b border-slate-200 px-3 py-2.5">
          <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2 xl:grid-cols-4">
            <label className="min-w-0 text-[10px] font-semibold text-slate-600">Số phiếu
              <input readOnly value={orderNumber || "Mã sẽ được cấp khi lưu"} className={cn(inputCls, "mt-0.5 bg-slate-50")} />
              {orderNumberError && <span className="mt-0.5 block text-[9px] font-normal text-amber-700">{orderNumberError}</span>}
            </label>
            <label className="text-[10px] font-semibold text-slate-600">Ngày đơn
              <input type="date" value={orderDate} onChange={(e) => changeOrderDate(e.target.value)} className={cn(inputCls, "mt-0.5")} />
            </label>
            <label className="text-[10px] font-semibold text-slate-600">Ngày nhập
              <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} className={cn(inputCls, "mt-0.5")} />
            </label>
            <label className="text-[10px] font-semibold text-slate-600">Ngày giao
              <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} className={cn(inputCls, "mt-0.5")} />
            </label>

            <div className="relative min-w-0 text-[10px] font-semibold text-slate-600 sm:col-span-2">
              Khách hàng
              {selectedCustomer ? (
                <div className="mt-0.5 flex min-h-7 items-center gap-2 rounded border border-slate-300 bg-white px-2 text-xs">
                  <span className="shrink-0 font-semibold" title={selectedCustomer.code}>
                    {formatCustomerCode(selectedCustomer.code)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-slate-700">{selectedCustomer.name}</span>
                  <button
                    type="button"
                    onClick={() => { clearCustomer(); setCustomerOpen(true); }}
                    className="shrink-0 text-slate-400 hover:text-red-600"
                    aria-label="Đổi khách hàng"
                    title="Đổi khách hàng"
                  >
                    <X size={13} />
                  </button>
                </div>
              ) : (
                <div className="relative mt-0.5">
                  <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={customerQuery}
                    onChange={(e) => { setCustomerQuery(e.target.value); setCustomerOpen(true); }}
                    onFocus={() => setCustomerOpen(true)}
                    placeholder={loading ? "Đang tải khách hàng..." : "Nhập mã hoặc tên khách hàng"}
                    className={cn(inputCls, "pl-7")}
                  />
                </div>
              )}
              {customerOpen && !loading && !selectedCustomer && (
                <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto border border-slate-200 bg-white shadow-xl">
                  {filteredCustomers.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">Không tìm thấy khách hàng.</p>}
                  {filteredCustomers.map((customer) => (
                    <button
                      key={customer.id}
                      type="button"
                      onClick={() => selectCustomer(customer)}
                      className="flex w-full items-center justify-between gap-2 border-b border-slate-100 px-2.5 py-2 text-left hover:bg-sky-50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium text-slate-800" title={customer.code}>
                          {formatCustomerCode(customer.code)} · {customer.name}
                        </span>
                        <span className="block truncate text-[10px] text-slate-500">{customer.type}{customer.staffName ? ` · NVBH: ${customer.staffName}` : ""}</span>
                      </span>
                      {customer.tier && <Badge variant="default">Tier {customer.tier}</Badge>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <label className="text-[10px] font-semibold text-slate-600">Loại đơn
              <select value={orderType} onChange={(e) => changeOrderType(e.target.value)} className={cn(inputCls, "mt-0.5")}>
                {ORDER_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </label>
            <label className="text-[10px] font-semibold text-slate-600">Tuyến
              <input value={salesRoute} onChange={(e) => setSalesRoute(e.target.value)} className={cn(inputCls, "mt-0.5")} placeholder="Tuyến bán hàng" />
            </label>

            <label className="text-[10px] font-semibold text-slate-600">Mã NV đặt đơn
              <input value={staffCode} onChange={(e) => changeStaffCode(e.target.value)} className={cn(inputCls, "mt-0.5")} />
            </label>
            <label className="text-[10px] font-semibold text-slate-600">Tên NV đặt đơn
              <input value={staffName} onChange={(e) => setStaffName(e.target.value)} className={cn(inputCls, "mt-0.5")} />
            </label>
            <label className="text-[10px] font-semibold text-slate-600">Kho mặc định
              <select value={warehouseId ?? ""} onChange={(e) => setWarehouseId(Number(e.target.value))} className={cn(inputCls, "mt-0.5")}>
                {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
              </select>
            </label>
            <label className="text-[10px] font-semibold text-slate-600">Người giao
              <select value={deliveryEmployeeCode} onChange={(e) => setDeliveryEmployeeCode(e.target.value)} className={cn(inputCls, "mt-0.5")}>
                <option value="">Chọn nhân viên</option>
                {deliveryEmployees.map((employee) => <option key={employee.code} value={employee.code}>{employee.code} - {employee.name}</option>)}
              </select>
            </label>

            <label className="text-[10px] font-semibold text-slate-600">Diễn giải
              <input value={note} onChange={(e) => setNote(e.target.value)} className={cn(inputCls, "mt-0.5")} />
            </label>
            <label className="text-[10px] font-semibold text-slate-600">Người lập
              <input readOnly value={createdBy} className={cn(inputCls, "mt-0.5 bg-slate-50")} />
            </label>
          </div>
        </section>

        <div className="grid min-w-0 grid-cols-1 xl:grid-cols-[minmax(0,2.1fr)_minmax(330px,1fr)]">
          <section className="min-w-0 border-b border-slate-200 xl:border-b-0 xl:border-r">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-100 bg-sky-50/60 px-3 py-2">
              <h2 className="text-[11px] font-bold text-sky-800">DANH SÁCH SẢN PHẨM ĐẶT HÀNG</h2>
              <span className="text-[10px] text-slate-500">Kho: {warehouses.find((warehouse) => warehouse.id === warehouseId)?.name ?? "—"}</span>
            </div>
            {stockError && <p className="px-3 pt-2 text-[10px] text-red-600">{stockError}</p>}
            {stockLoading && <p className="px-3 pt-2 text-[10px] text-slate-500">Đang tải tồn kho...</p>}
            <div className="relative border-b border-slate-100 px-3 py-2">
              <Search size={13} className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={productQuery}
                onChange={(e) => { setProductQuery(e.target.value); setProductOpen(true); }}
                onFocus={() => setProductOpen(true)}
                onBlur={() => setTimeout(() => setProductOpen(false), 150)}
                placeholder={loading ? "Đang tải sản phẩm..." : `Tìm mã SKU hoặc tên trong ${formatNumber(products.length)} sản phẩm`}
                className="w-full rounded border border-slate-300 py-1.5 pl-7 pr-2 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
              {productOpen && !loading && (
                <div className="absolute left-3 right-3 top-full z-30 max-h-64 overflow-y-auto border border-slate-200 bg-white shadow-xl">
                  {pickError && <p className="px-3 py-2 text-xs text-red-600">{pickError}</p>}
                  {filteredProducts.length === 0 && <p className="px-3 py-3 text-xs text-slate-400">Không tìm thấy sản phẩm.</p>}
                  {filteredProducts.map((product) => {
                    const stock = stockOf(product.nppCode);
                    return (
                      <button
                        key={product.id}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => addProduct(product)}
                        className="flex w-full items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-left hover:bg-sky-50"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-semibold text-slate-800">{product.sku} · {product.name}</span>
                          <span className="block truncate text-[10px] text-slate-500">{product.unit || "—"} · {product.supplier || "Không rõ hãng"}</span>
                          <span className="block truncate text-[10px] text-slate-500">
                            Mã NPP: {product.nppCode} · Quy cách: {formatNumber(product.boxesPerCarton)} đơn vị/thùng · Tồn khả dụng: {stockLoading ? "đang tải" : stockError ? "lỗi tải" : stock == null ? "—" : `${formatNumber(stock)} ${product.unit || "đơn vị"}`}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs font-medium text-slate-700">{formatVNDFull(product.basePrice)}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[766px] border-collapse text-left">
                <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600">
                  <tr>
                    <th className="w-8 px-2 py-2 text-center">TT</th>
                    <th className="min-w-[180px] px-2 py-2">Tên SP</th>
                    <th className="w-[168px] px-2 py-2 text-center" title="Nhập số thùng và số lượng lẻ theo đơn vị sản phẩm">SL (Thùng / ĐVT)</th>
                    <th className="w-[92px] px-2 py-2 text-right">Đơn giá</th>
                    <th className="w-[100px] px-2 py-2 text-right">Thành tiền</th>
                    <th className="w-[88px] px-2 py-2 text-right">Chiết khấu</th>
                    <th className="w-[66px] px-2 py-2 text-center">%</th>
                    <th className="w-[76px] px-2 py-2 text-center">Tồn</th>
                    <th className="w-8 px-1 py-2" />
                  </tr>
                </thead>
                <tbody className="text-[11px]">
                  {lines.length === 0 ? (
                    <tr><td colSpan={9} className="px-3 py-7 text-center text-xs text-slate-400">Chưa có sản phẩm. Tìm SKU ở phía trên để thêm vào đơn.</td></tr>
                  ) : lines.map((line, index) => {
                    const stock = stockOf(line.nppCode);
                    const over = stock != null && line.quantity + line.promoQuantity > stock;
                    const percentage = lineValue(line) > 0 ? Math.min(100, line.discountAmount / lineValue(line) * 100) : 0;
                    return (
                      <tr key={line.productCode} className="border-b border-slate-100 even:bg-amber-50/40 hover:bg-sky-50/50">
                        <td className="px-2 py-1.5 text-center text-slate-500">{index + 1}</td>
                        <td className="px-2 py-1.5">
                          <p className="truncate font-medium text-slate-800" title={line.productName}>{line.productName}</p>
                          <p className="truncate text-[10px] text-slate-500">{line.productCode}</p>
                        </td>
                        <td className="px-2 py-1.5">
                          {line.boxesPerCarton > 1 ? (
                            <div className="grid grid-cols-2 gap-1" title={`${line.boxesPerCarton} ${line.unit || "đơn vị"}/thùng`}>
                              <label className="flex min-w-0 items-center gap-1 text-[9px] text-slate-500">
                                Thùng
                                <input
                                  aria-label={`Số thùng ${line.productCode}`}
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={line.cartons}
                                  onChange={(event) => updateLine(index, { cartons: Math.max(0, Number(event.target.value) || 0) })}
                                  className={cn("w-full min-w-0 rounded border px-1 py-1 text-center text-[11px] focus:outline-none focus:ring-1 focus:ring-sky-500", over ? "border-red-300 bg-red-50 text-red-700" : "border-slate-300 bg-white")}
                                />
                              </label>
                              <label className="flex min-w-0 items-center gap-1 text-[9px] text-slate-500">
                                <span className="shrink-0">{line.unit || "Hộp"}</span>
                                <input
                                  aria-label={`Số lượng lẻ ${line.productCode}`}
                                  type="number"
                                  min={0}
                                  max={line.boxesPerCarton - 1}
                                  step={1}
                                  value={line.boxes}
                                  onChange={(event) => updateLine(index, { boxes: Math.max(0, Number(event.target.value) || 0) })}
                                  className={cn("w-full min-w-0 rounded border px-1 py-1 text-center text-[11px] focus:outline-none focus:ring-1 focus:ring-sky-500", over ? "border-red-300 bg-red-50 text-red-700" : "border-slate-300 bg-white")}
                                />
                              </label>
                            </div>
                          ) : (
                            <input
                              aria-label={`Số lượng ${line.productCode}`}
                              type="number"
                              min={0}
                              step={1}
                              value={line.quantity}
                              onChange={(event) => updateLineQuantity(index, Number(event.target.value) || 0)}
                              className={cn("w-full rounded border px-1.5 py-1 text-center text-[11px] focus:outline-none focus:ring-1 focus:ring-sky-500", over ? "border-red-300 bg-red-50 text-red-700" : "border-slate-300 bg-white")}
                            />
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            aria-label={`Đơn giá ${line.productCode}`}
                            type="number"
                            min={0}
                            step={1}
                            value={line.price}
                            onChange={(event) => updateLine(index, { price: Math.max(0, Number(event.target.value) || 0) })}
                            className="w-full rounded border border-slate-300 px-1.5 py-1 text-right text-[11px] focus:border-sky-500 focus:outline-none"
                          />
                        </td>
                        <td className="px-2 py-1.5 text-right font-medium text-slate-700">{formatVNDFull(lineValue(line))}</td>
                        <td className="px-2 py-1.5">
                          <input
                            aria-label={`Chiết khấu ${line.productCode}`}
                            type="number"
                            min={0}
                            step={100}
                            value={line.discountAmount}
                            readOnly={orderType === "001-Xuất hàng" && line.promotionId != null}
                            onChange={(event) => updateLine(index, { discountAmount: Math.max(0, Number(event.target.value) || 0) })}
                            className="w-full rounded border border-slate-300 px-1.5 py-1 text-right text-[11px] focus:border-sky-500 focus:outline-none read-only:bg-slate-100"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            aria-label={`Phần trăm chiết khấu ${line.productCode}`}
                            type="number"
                            min={0}
                            max={100}
                            step={0.1}
                            value={Number(percentage.toFixed(1))}
                            readOnly={orderType === "001-Xuất hàng" && line.promotionId != null}
                            onChange={(event) => updateLine(index, { discountAmount: Math.max(0, lineValue(line) * Math.min(100, Number(event.target.value) || 0) / 100) })}
                            className="w-full rounded border border-slate-300 px-1 py-1 text-center text-[11px] focus:border-sky-500 focus:outline-none read-only:bg-slate-100"
                          />
                        </td>
                        <td className={cn("px-2 py-1.5 text-center font-medium", over ? "text-red-600" : "text-emerald-700")}>{stock == null ? "—" : formatNumber(stock)}</td>
                        <td className="px-1 py-1.5">
                          <button type="button" onClick={() => removeLine(index)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={`Xóa ${line.productName}`}>
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {lines.length > 0 && (
                  <tfoot className="border-t border-slate-200 bg-slate-50 text-[10px] font-semibold text-slate-600">
                    <tr>
                      <td colSpan={4} className="px-2 py-2 text-right">Tổng tiền ({lines.length} dòng)</td>
                      <td className="px-2 py-2 text-right">{formatVNDFull(subtotal)}</td>
                      <td className="px-2 py-2 text-right text-red-600">-{formatVNDFull(totalDiscount)}</td>
                      <td colSpan={3} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>

          <section className="flex min-w-0 flex-col">
            <div className="flex items-center justify-between gap-2 border-b border-sky-100 bg-sky-50/60 px-3 py-2">
              <h2 className="text-[11px] font-bold text-sky-800">DANH SÁCH KHUYẾN MẠI</h2>
              <button
                type="button"
                onClick={loadPromotions}
                disabled={loadingPromotions || orderType !== "001-Xuất hàng"}
                className="inline-flex items-center gap-1 text-[10px] font-medium text-sky-700 hover:text-sky-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loadingPromotions ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {promotionsLoaded ? "Tải lại" : "Tải khuyến mại"}
              </button>
            </div>
            {promotionError && <p role="alert" className="border-b border-red-100 bg-red-50 px-2 py-1.5 text-[10px] text-red-700">{promotionError}</p>}
            {!selectedCustomer && <p className="px-2 py-2 text-[10px] text-slate-400">Chọn khách hàng để tải khuyến mại.</p>}
            {selectedCustomer && !promotionsLoaded && !promotionError && <p className="px-2 py-2 text-[10px] text-slate-400">Nhấn “Tải khuyến mại” để xem chương trình áp dụng.</p>}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[340px] border-collapse text-left">
                <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600">
                  <tr>
                    <th className="min-w-[132px] px-2 py-2">Tên chương trình</th>
                    <th className="min-w-[100px] px-2 py-2">Sản phẩm</th>
                    <th className="w-12 px-2 py-2 text-center">SL KM</th>
                    <th className="w-[72px] px-2 py-2 text-right">Tiền CK</th>
                  </tr>
                </thead>
                <tbody className="text-[10px]">
                  {lines.length === 0 ? (
                    <tr><td colSpan={4} className="px-2 py-6 text-center text-slate-400">Khuyến mại sẽ hiển thị theo sản phẩm trong đơn.</td></tr>
                  ) : lines.map((line, index) => {
                    const eligiblePromotions = getQualifyingPromotions(line, lines);
                    const selectedPromotion = promotions.find((promotion) => promotion.id === line.promotionId);
                    const reward = selectedPromotion ? getPromotionReward(selectedPromotion, line) : null;
                    const rewardGroups = reward?.products.reduce<PromotionRewardLine[][]>((groups, product) => {
                      (groups[product.groupIndex] ??= []).push(product);
                      return groups;
                    }, []) ?? [];
                    return (
                      <tr key={line.productCode} className="border-b border-slate-100">
                        <td className="px-2 py-1.5">
                          <select
                            aria-label={`Chương trình khuyến mại ${line.productCode}`}
                            value={line.promotionId ?? ""}
                            onChange={(event) => applyPromotion(index, event.target.value ? Number(event.target.value) : null)}
                            disabled={orderType !== "001-Xuất hàng" || !promotionsLoaded}
                            className="w-full min-w-0 rounded border border-slate-300 bg-white px-1 py-1 text-[10px] disabled:bg-slate-100"
                          >
                            <option value="">{promotionsLoaded ? "Không áp dụng" : "Chưa tải CTKM"}</option>
                            {eligiblePromotions.map((promotion) => <option key={promotion.id} value={promotion.id}>{promotion.code} - {promotion.name}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          {line.promotionId == null ? (
                            <span className="text-slate-400">Chưa áp dụng</span>
                          ) : rewardGroups.length > 0 ? (
                            <div className="space-y-1">
                              {rewardGroups.map((group, groupIndex) => (
                                <p key={groupIndex} className="text-[9px] text-slate-700">
                                  {groupIndex > 0 && <span className="font-bold text-slate-400">VÀ </span>}
                                  {group.map((product, optionIndex) => (
                                    <span key={product.productId}>
                                      {optionIndex > 0 && <span className="font-bold text-red-600"> HOẶC </span>}
                                      <span title={`${product.sku} · ${product.productName}`}>
                                        {product.sku} · {product.productName} ({formatNumber(product.quantity)} {product.unit === "CARTON" ? "thùng" : "hộp"})
                                      </span>
                                    </span>
                                  ))}
                                </p>
                              ))}
                            </div>
                          ) : (
                            <span className="text-slate-400">
                              {selectedPromotion?.rules.some((rule) => rule.reward_type === "FREE_QUANTITY")
                                ? "Chưa đăng ký sản phẩm quà tặng"
                                : "Ưu đãi theo sản phẩm áp dụng"}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          <span
                            aria-label={`Số lượng khuyến mại ${line.productCode}`}
                            className={cn("block text-center", line.promotionId == null && "text-slate-400")}
                            title={line.promotionId == null ? "Chọn chương trình khuyến mại để áp dụng chính sách" : "Số lượng theo chính sách chương trình"}
                          >
                            {formatNumber(line.promoQuantity)}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-right text-slate-600">{formatVNDFull(line.discountAmount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="border-t border-slate-200 bg-slate-50 text-[10px]">
                  <tr>
                    <td colSpan={2} className="px-2 py-2 font-semibold text-slate-600">Tổng tiền (chưa trừ thuế)</td>
                    <td colSpan={2} className="px-2 py-2 text-right font-bold text-slate-800">{formatVNDFull(total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="mt-auto flex items-center justify-between border-t border-slate-200 px-3 py-2 text-[10px]">
              <span className="text-slate-500">Phải thanh toán = Tổng tiền - Chiết khấu</span>
              <span className="font-bold text-sky-800">{formatVNDFull(total)}</span>
            </div>
          </section>
        </div>
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-slate-300 bg-slate-100 px-3 py-2">
        <p className="hidden text-[10px] text-slate-500 sm:block">Tồn và số lượng quy đổi theo đơn vị cơ sở. Mã đơn: TC-YYMMDD-###.</p>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => onClose ? onClose() : router.push("/sales/orders")} className="rounded bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800">
            Đóng
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!selectedCustomer || lines.length === 0 || submitting}
            className="inline-flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {submitting ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
            Lưu đơn (F9)
          </button>
        </div>
      </footer>
    </div>
  );
}

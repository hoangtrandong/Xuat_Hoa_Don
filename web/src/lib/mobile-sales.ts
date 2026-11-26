// src/lib/mobile-sales.ts
// Shared types, promotion calculation, and offline draft persistence for DMS Mobile Sales App (/m)

export interface MobileCustomer {
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
  phone: string;
  address: string;
}

export interface MobileProduct {
  id: number;
  sku: string;
  nppCode: string;
  name: string;
  unit: string;
  supplier: string;
  basePrice: number;
  boxesPerCarton: number;
}

export interface MobilePromotionRewardProduct {
  product_id: number;
  quantity: number;
  unit: "CARTON" | "BOX";
}

export interface MobilePromotionRule {
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
  reward_product_details?: MobilePromotionRewardProduct[][];
}

export interface MobilePromotionOption {
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
  rules: MobilePromotionRule[];
}

export interface MobilePromotionRewardLine {
  productId: number;
  productName: string;
  sku: string;
  quantity: number;
  unit: "CARTON" | "BOX";
  groupIndex: number;
  optionIndex: number;
}

export interface MobilePromotionRewardCalculation {
  promoQuantity: number;
  discountAmount: number;
  benefit: number;
  products: MobilePromotionRewardLine[];
}

export interface MobileCartLine {
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

export interface MobileWarehouseOption {
  id: number;
  name: string;
}

export interface MobileEmployeeOption {
  code: string;
  name: string;
  status: string;
}

export interface MobileCurrentUser {
  username: string;
  full_name: string;
  employee_code: string | null;
  employee_name: string | null;
  distributor_code?: string | null;
  distributor_name?: string | null;
}

export interface MobileOrderDraft {
  customerCode: string | null;
  orderType: string;
  orderDate: string;
  deliveryDate: string;
  deliveryEmployeeCode: string;
  note: string;
  lines: MobileCartLine[];
  updatedAt: string;
}

export const MOBILE_ORDER_TYPES = ["001-Xuất hàng", "002-Dương Số"] as const;

export const CUSTOMER_TYPE_LABELS: Record<string, string> = {
  DISTRIBUTOR: "Nhà phân phối",
  WHOLESALE: "Đại lý",
  HORECA: "HORECA",
  RETAIL: "Cửa hàng",
};

export function todayInputDate(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

export function lineGrossAmount(line: MobileCartLine): number {
  return Math.round(line.price * line.quantity);
}

export function lineNetAmount(line: MobileCartLine): number {
  const gross = lineGrossAmount(line);
  return gross - Math.min(line.discountAmount, gross);
}

export function promotionMatchesProduct(
  promotion: MobilePromotionOption,
  line: MobileCartLine,
): boolean {
  return promotion.product_scope === "SUPPLIER"
    ? (promotion.supplier ?? "").trim().toLocaleLowerCase() ===
        line.supplier.trim().toLocaleLowerCase()
    : promotion.product_ids.includes(line.productId);
}

export function getMobilePromotionReward(
  promotion: MobilePromotionOption,
  line: MobileCartLine,
  products: MobileProduct[],
): MobilePromotionRewardCalculation | null {
  if (!promotionMatchesProduct(promotion, line)) return null;
  const minimumQuantity =
    promotion.product_scope === "SELECTED"
      ? Math.max(1, Number(promotion.product_min_quantities[line.productId] ?? 1))
      : 1;
  if (line.quantity < minimumQuantity) return null;

  const value = line.quantity * line.price;
  const cartons = Math.floor(line.quantity / Math.max(1, line.boxesPerCarton));
  let best: MobilePromotionRewardCalculation | null = null;

  for (const rule of promotion.rules) {
    const quantityRule =
      rule.trigger_type === "QUANTITY" || rule.trigger_type === "CARTON";
    const threshold = quantityRule
      ? (rule.min_quantity ?? 1)
      : (rule.min_amount ?? 0);
    const basis = quantityRule
      ? rule.quantity_unit === "CARTON"
        ? cartons
        : line.quantity
      : value;
    const maximum = quantityRule ? rule.max_quantity : rule.max_amount;
    if (maximum != null && basis > maximum) continue;
    const repeats = threshold > 0 ? Math.floor(basis / threshold) : 0;
    if (repeats < 1) continue;

    let candidate: { promoQuantity: number; discountAmount: number };
    let rewardProducts: MobilePromotionRewardLine[] = [];

    if (rule.reward_type === "FREE_QUANTITY") {
      const configuredGroups = rule.reward_product_details?.length
        ? rule.reward_product_details
        : rule.reward_product_groups?.length
          ? rule.reward_product_groups.map((group) =>
              group.map((product_id) => ({
                product_id,
                quantity: rule.reward_value,
                unit: rule.reward_unit,
              })),
            )
          : rule.reward_product_ids?.length
            ? [
                rule.reward_product_ids.map((product_id) => ({
                  product_id,
                  quantity: rule.reward_value,
                  unit: rule.reward_unit,
                })),
              ]
            : [];

      rewardProducts = configuredGroups.flatMap((group, groupIndex) =>
        group.flatMap((configured, optionIndex) => {
          const product = products.find(
            (item) => item.id === configured.product_id,
          );
          if (!product) return [];
          return [
            {
              productId: product.id,
              productName: product.name,
              sku: product.sku,
              quantity: configured.quantity * repeats,
              unit: configured.unit,
              groupIndex,
              optionIndex,
            },
          ];
        }),
      );

      const selectedRewardProducts = rewardProducts.filter(
        (item) => item.optionIndex === 0,
      );
      const rewardedUnits = selectedRewardProducts.length
        ? selectedRewardProducts.reduce((sum, item) => {
            const product = products.find((entry) => entry.id === item.productId);
            return (
              sum +
              item.quantity *
                (item.unit === "CARTON" ? product?.boxesPerCarton ?? 1 : 1)
            );
          }, 0)
        : rule.reward_value * repeats;
      candidate = { promoQuantity: rewardedUnits, discountAmount: 0 };
    } else if (rule.reward_type === "DISCOUNT_PERCENT") {
      candidate = {
        promoQuantity: 0,
        discountAmount: Math.min(
          value,
          ((value * rule.reward_value) / 100) * repeats,
        ),
      };
    } else {
      candidate = {
        promoQuantity: 0,
        discountAmount: Math.min(value, rule.reward_value * repeats),
      };
    }

    const selectedGiftValue = rewardProducts
      .filter((item) => item.optionIndex === 0)
      .reduce((sum, item) => {
        const product = products.find((entry) => entry.id === item.productId);
        const qty =
          item.quantity *
          (item.unit === "CARTON" ? product?.boxesPerCarton ?? 1 : 1);
        return sum + qty * (product?.basePrice ?? 0);
      }, 0);

    const benefit =
      (rewardProducts.length
        ? selectedGiftValue
        : candidate.promoQuantity * line.price) + candidate.discountAmount;

    if (!best || benefit > best.benefit) {
      best = { ...candidate, benefit, products: rewardProducts };
    }
  }

  return best;
}

export function getMobileQualifyingPromotions(
  line: MobileCartLine,
  currentLines: MobileCartLine[],
  promotions: MobilePromotionOption[],
  products: MobileProduct[],
): MobilePromotionOption[] {
  return promotions.filter((promotion) => {
    if (
      promotion.promotion_type !== "ORDER" ||
      !promotionMatchesProduct(promotion, line)
    ) {
      return false;
    }
    const minimumProductQuantity = Math.max(
      1,
      Number(promotion.minimum_product_quantity ?? 1),
    );
    const matchingProductCount = currentLines.filter((candidate) => {
      if (!promotionMatchesProduct(promotion, candidate)) return false;
      const minimumQuantity =
        promotion.product_scope === "SELECTED"
          ? Math.max(
              1,
              Number(promotion.product_min_quantities[candidate.productId] ?? 1),
            )
          : 1;
      return candidate.quantity >= minimumQuantity;
    }).length;
    return (
      matchingProductCount >= minimumProductQuantity &&
      getMobilePromotionReward(promotion, line, products) != null
    );
  });
}

// --- Draft persistence (localStorage) ---

function getDraftKey(username: string, distributorCode: string): string {
  const safeUser = (username || "guest").trim().toLowerCase();
  const safeDist = (distributorCode || "default").trim().toLowerCase();
  return `dms-mobile-order-draft:${safeDist}:${safeUser}`;
}

export function loadMobileOrderDraft(
  username: string,
  distributorCode: string,
): MobileOrderDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(
      getDraftKey(username, distributorCode),
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MobileOrderDraft;
    if (!parsed || !Array.isArray(parsed.lines)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveMobileOrderDraft(
  username: string,
  distributorCode: string,
  draft: MobileOrderDraft,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      getDraftKey(username, distributorCode),
      JSON.stringify(draft),
    );
  } catch {
    // Ignore quota errors
  }
}

export function clearMobileOrderDraft(
  username: string,
  distributorCode: string,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(getDraftKey(username, distributorCode));
  } catch {
    // Ignore
  }
}

// --- Resilient Fetch with Retry + In-Memory Master Data Cache ---

export async function fetchWithRetry(
  fetcher: () => Promise<Response>,
  retries = 2,
  delayMs = 700,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetcher();
      if (
        (res.status === 502 || res.status === 503 || res.status === 504) &&
        attempt < retries
      ) {
        await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
        continue;
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Không thể kết nối máy chủ.");
}

interface MasterDataCache {
  key: string;
  loadedAt: number;
  customers: MobileCustomer[];
  products: MobileProduct[];
  warehouses: MobileWarehouseOption[];
  deliveryEmployees: MobileEmployeeOption[];
  me: MobileCurrentUser | null;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let masterCache: MasterDataCache | null = null;

export function getCachedMasterData(
  cacheKey: string,
): MasterDataCache | null {
  if (!masterCache) return null;
  if (masterCache.key !== cacheKey) return null;
  if (Date.now() - masterCache.loadedAt > CACHE_TTL_MS) return null;
  return masterCache;
}

export function setCachedMasterData(data: Omit<MasterDataCache, "loadedAt">): void {
  masterCache = { ...data, loadedAt: Date.now() };
}

export function clearCachedMasterData(): void {
  masterCache = null;
}

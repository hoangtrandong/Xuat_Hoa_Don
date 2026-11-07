"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Copy, Eye, Lock, LockOpen, Loader2, Pencil, Plus, Search, Save, ShoppingCart, Trash2, X } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { API_URL, apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ProductOption {
  id: number;
  sku: string;
  name: string;
  supplier: string;
  status: string;
  unit: string;
  boxesPerCarton: number;
  basePrice: number;
}

interface EmployeeOption {
  code: string;
  name: string;
  status: string;
}

interface RewardProductEntry {
  product_id: number | null;
  quantity: number;
  unit: "CARTON" | "BOX";
}

interface PromotionRule {
  id?: number;
  trigger_type: "QUANTITY" | "AMOUNT";
  min_quantity: number | null;
  max_quantity: number | null;
  quantity_unit: "CARTON" | "BOX";
  min_amount: number | null;
  max_amount: number | null;
  reward_type: "FREE_QUANTITY" | "DISCOUNT_AMOUNT" | "DISCOUNT_PERCENT";
  reward_value: number;
  reward_unit: "CARTON" | "BOX";
  reward_product_entries: RewardProductEntry[][];
  reward_product_operator?: "AND" | "OR";
  reward_product_id?: number | null;
  reward_product_ids?: number[];
  reward_product_groups?: number[][];
  reward_product_details?: { product_id: number; quantity: number; unit: "CARTON" | "BOX" }[][];
}

interface Promotion {
  id: number;
  code: string;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string;
  is_active: boolean;
  is_locked: boolean;
  promotion_type: "ORDER" | "AFTER_SALES";
  promotion_kind: "GENERAL" | "INVOICE_AMOUNT" | "PRODUCT_AMOUNT";
  target_scope: "ALL" | "CUSTOMER_TYPE";
  customer_type: string | null;
  employee_code: string | null;
  vat_rate: number;
  product_scope: "SELECTED" | "SUPPLIER";
  supplier: string | null;
  applied_quantity_unit: "STANDARD" | "SECONDARY";
  minimum_product_quantity: number;
  product_ids: number[];
  product_min_quantities: Record<number, number>;
  rules: PromotionRule[];
}

type PromotionForm = Omit<Promotion, "id" | "code" | "is_locked">;
type DialogMode = "create" | "edit" | "view" | null;

const emptyRule = (): PromotionRule => ({
  trigger_type: "QUANTITY",
  min_quantity: 1,
  max_quantity: null,
  quantity_unit: "CARTON",
  min_amount: null,
  max_amount: null,
  reward_type: "FREE_QUANTITY",
  reward_value: 1,
  reward_unit: "BOX",
  reward_product_entries: [[{ product_id: null, quantity: 1, unit: "BOX" }]],
});

const customerTypeLabels: Record<string, string> = {
  DISTRIBUTOR: "Nhà phân phối",
  WHOLESALE: "Đại lý",
  HORECA: "HORECA",
  RETAIL: "Cửa hàng",
};

function todayDate() {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function newForm(): PromotionForm {
  const today = todayDate();
  return {
    name: "",
    description: "",
    start_date: `${today}T00:00:00`,
    end_date: `${today}T23:59:59`,
    is_active: true,
    promotion_type: "ORDER",
    promotion_kind: "GENERAL",
    target_scope: "ALL",
    customer_type: null,
    employee_code: null,
    vat_rate: 0,
    product_scope: "SELECTED",
    supplier: null,
    applied_quantity_unit: "STANDARD",
    minimum_product_quantity: 1,
    product_ids: [],
    product_min_quantities: {},
    rules: [emptyRule()],
  };
}

function dateValue(value: string) {
  return value.slice(0, 10);
}

function promotionStatus(promotion: Promotion) {
  if (promotion.is_locked) return "Đã khóa";
  if (promotion.promotion_kind !== "GENERAL" || promotion.applied_quantity_unit !== "STANDARD") return "Chưa hỗ trợ";
  if (!promotion.is_active) return "Ngừng áp dụng";
  const today = todayDate();
  if (dateValue(promotion.start_date) > today) return "Chưa đến hạn";
  if (dateValue(promotion.end_date) < today) return "Hết hạn";
  return "Đang áp dụng";
}

function ruleDescription(rule: PromotionRule) {
  const trigger = rule.trigger_type === "QUANTITY"
    ? `Mua ${rule.min_quantity ?? 1}${rule.max_quantity ? `–${rule.max_quantity}` : "+"} ${rule.quantity_unit === "CARTON" ? "thùng" : "hộp"}`
    : `Giá trị SP ${Number(rule.min_amount ?? 0).toLocaleString("vi-VN")}${rule.max_amount ? `–${Number(rule.max_amount).toLocaleString("vi-VN")}` : "+"}đ`;
  const reward = rule.reward_type === "FREE_QUANTITY"
    ? `tặng ${rule.reward_value} ${rule.reward_unit === "CARTON" ? "thùng" : "hộp"}`
    : rule.reward_type === "DISCOUNT_PERCENT"
      ? `chiết khấu ${rule.reward_value}%`
      : `chiết khấu ${Number(rule.reward_value).toLocaleString("vi-VN")}đ`;
  return `${trigger} - ${reward}`;
}

async function responseError(response: Response, fallback: string) {
  const result = await response.json().catch(() => ({})) as { detail?: unknown };
  return typeof result.detail === "string" ? result.detail : fallback;
}

export default function PromotionsPage() {
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingPromotionId, setLoadingPromotionId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [dialog, setDialog] = useState<DialogMode>(null);
  const [selected, setSelected] = useState<Promotion | null>(null);
  const [form, setForm] = useState<PromotionForm>(newForm);
  const [productSearch, setProductSearch] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [productPickerTarget, setProductPickerTarget] = useState<
    { type: "eligible" | "supplier" } |
    { type: "reward"; ruleIndex: number; groupIndex: number; productIndex: number } |
    null
  >(null);

  const filteredProducts = useMemo(() => {
    const query = productSearch.trim().toLocaleLowerCase();
    return products
      .filter((product) => product.status.toLowerCase() !== "inactive")
      .filter((product) => !supplierFilter || product.supplier === supplierFilter)
      .filter((product) => !query || [product.sku, product.name, product.supplier].some((value) => value.toLocaleLowerCase().includes(query)));
  }, [productSearch, products, supplierFilter]);

  const visibleProducts = useMemo(() => filteredProducts.slice(0, 100), [filteredProducts]);

  const suppliers = useMemo(
    () => [...new Set(products.map((product) => product.supplier.trim()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, "vi")),
    [products],
  );

  const selectedProducts = useMemo(
    () => form.product_ids.map((id) => products.find((product) => product.id === id) ?? {
      id,
      sku: `ID ${id}`,
      name: "Sản phẩm không còn trong danh mục",
      supplier: "",
      status: "inactive",
      unit: "",
      boxesPerCarton: 1,
      basePrice: 0,
    }),
    [form.product_ids, products],
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [promotionResponse, productResponse, unitResponse, userResponse, employeeResponse] = await Promise.all([
        apiFetch(`${API_URL}/promotions`),
        apiFetch(`${API_URL}/products/?limit=10000`),
        apiFetch(`${API_URL}/products/units/`),
        apiFetch(`${API_URL}/auth/me`),
        apiFetch(`${API_URL}/employees/?status=active&limit=1000`),
      ]);
      if (!promotionResponse.ok) throw new Error(await responseError(promotionResponse, "Không thể tải chương trình khuyến mãi."));
      if (!productResponse.ok) throw new Error(await responseError(productResponse, "Không thể tải danh sách sản phẩm."));
      const promotionRows = await promotionResponse.json() as Promotion[];
      const productRows = await productResponse.json() as Array<Record<string, unknown>>;
      const unitRows = unitResponse.ok ? await unitResponse.json() as Array<{ id: number; name: string }> : [];
      const unitNames = new Map(unitRows.map((unit) => [unit.id, unit.name]));
      const user = userResponse.ok ? await userResponse.json() as { is_admin?: boolean } : null;
      setPromotions(promotionRows);
      setIsAdmin(user?.is_admin === true);
      setProducts(productRows.map((row) => ({
        id: Number(row.id),
        sku: String(row.sku ?? ""),
        name: String(row.name ?? ""),
        supplier: String(row.supplier ?? ""),
        status: String(row.status ?? "active"),
        unit: unitNames.get(Number(row.unit_id)) ?? "—",
        boxesPerCarton: Math.max(1, Number(row.boxes_per_carton ?? 1)),
        basePrice: Number(row.base_price ?? 0),
      })));
      const employeeRows = employeeResponse.ok ? await employeeResponse.json() as EmployeeOption[] : [];
      setEmployees(employeeRows.filter((employee) => employee.status?.toLowerCase() === "active"));
    } catch (loadFailure) {
      setError(loadFailure instanceof Error ? loadFailure.message : "Không thể tải dữ liệu.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  function openCreate() {
    setError("");
    setSelected(null);
    setForm(newForm());
    setProductSearch("");
    setSupplierFilter("");
    setProductPickerTarget(null);
    setDialog("create");
  }

  function openExisting(mode: Exclude<DialogMode, "create" | null>, promotion: Promotion) {
    setError("");
    setSelected(promotion);
    setForm({
      name: promotion.name,
      description: promotion.description ?? "",
      start_date: promotion.start_date,
      end_date: promotion.end_date,
      is_active: promotion.is_active,
      promotion_type: promotion.promotion_type ?? "ORDER",
      promotion_kind: promotion.promotion_kind ?? "GENERAL",
      target_scope: promotion.target_scope ?? "ALL",
      customer_type: promotion.customer_type,
      employee_code: promotion.employee_code,
      vat_rate: promotion.vat_rate ?? 0,
      product_scope: promotion.product_scope ?? "SELECTED",
      supplier: promotion.supplier,
      applied_quantity_unit: promotion.applied_quantity_unit ?? "STANDARD",
      minimum_product_quantity: promotion.minimum_product_quantity ?? 1,
      product_ids: [...promotion.product_ids],
      product_min_quantities: promotion.product_min_quantities ?? {},
      rules: promotion.rules.map((rule) => ({
        trigger_type: rule.trigger_type,
        min_quantity: rule.min_quantity,
        max_quantity: rule.max_quantity ?? null,
        quantity_unit: rule.quantity_unit,
        min_amount: rule.min_amount,
        max_amount: rule.max_amount ?? null,
        reward_type: rule.reward_type,
        reward_value: rule.reward_value,
        reward_unit: rule.reward_unit,
        reward_product_entries: rule.reward_product_details?.length
          ? rule.reward_product_details.map((group) => group.map((item) => ({
            product_id: item.product_id,
            quantity: item.quantity,
            unit: item.unit,
          })))
          : (() => {
            const ids = rule.reward_product_ids?.length
              ? [...rule.reward_product_ids]
              : rule.reward_product_id != null ? [rule.reward_product_id] : [];
            const makeEntry = (product_id: number | null): RewardProductEntry => ({
              product_id,
              quantity: Math.max(1, Number(rule.reward_value) || 1),
              unit: rule.reward_unit ?? "BOX",
            });
            if (ids.length === 0) return [[makeEntry(null)]];
            return rule.reward_product_operator === "OR"
              ? [ids.map((id) => makeEntry(id))]
              : ids.map((id) => [makeEntry(id)]);
          })(),
      })),
    });
    setProductSearch("");
    setSupplierFilter(promotion.supplier ?? "");
    setProductPickerTarget(null);
    setDialog(mode);
  }

  function openProductPicker(
    target:
      | { type: "eligible" | "supplier" }
      | { type: "reward"; ruleIndex: number; groupIndex: number; productIndex: number },
  ) {
    setProductSearch("");
    setSupplierFilter(form.supplier ?? "");
    setProductPickerTarget(target);
  }

  function toggleProductSelection(productId: number) {
    if (productPickerTarget?.type === "reward") {
      const rule = form.rules[productPickerTarget.ruleIndex];
      if (!rule) return;
      const groups = rule.reward_product_entries.map((group) => [...group]);
      groups[productPickerTarget.groupIndex][productPickerTarget.productIndex] = {
        ...groups[productPickerTarget.groupIndex][productPickerTarget.productIndex],
        product_id: productId,
      };
      updateRule(productPickerTarget.ruleIndex, { reward_product_entries: groups });
      setProductPickerTarget(null);
      return;
    }
    setForm((current) => ({
      ...current,
      product_scope: "SELECTED",
      product_ids: current.product_ids.includes(productId)
        ? current.product_ids.filter((id) => id !== productId)
        : [...current.product_ids, productId],
      product_min_quantities: {
        ...current.product_min_quantities,
        [productId]: current.product_min_quantities[productId] ?? 1,
      },
    }));
  }

  function addFilteredProducts() {
    const filteredIds = filteredProducts.map((product) => product.id);
    if (productPickerTarget?.type === "reward") {
      return;
    }
    if (productPickerTarget?.type === "supplier" && !supplierFilter) return;
    setForm((current) => ({
      ...current,
      product_scope: "SELECTED",
      supplier: productPickerTarget?.type === "supplier" ? supplierFilter : current.supplier,
      product_ids: [...new Set([...current.product_ids, ...filteredIds])],
      product_min_quantities: Object.fromEntries([
        ...Object.entries(current.product_min_quantities).filter(([id]) => !filteredIds.includes(Number(id))),
        ...filteredIds.map((id) => [id, current.product_min_quantities[id] ?? 1]),
      ]),
    }));
  }

  async function openEdit(promotion: Promotion) {
    setError("");
    setLoadingPromotionId(promotion.id);
    try {
      const response = await apiFetch(`${API_URL}/promotions/${promotion.id}`);
      if (!response.ok) {
        throw new Error(await responseError(response, "Không thể tải nội dung chương trình để chỉnh sửa."));
      }
      const details = await response.json() as Promotion;
      if (!Array.isArray(details.rules)) {
        throw new Error("Dữ liệu điều kiện khuyến mãi không hợp lệ, vui lòng tải lại trang.");
      }
      openExisting("edit", details);
    } catch (editFailure) {
      setError(editFailure instanceof Error ? editFailure.message : "Không thể tải chương trình để chỉnh sửa.");
    } finally {
      setLoadingPromotionId(null);
    }
  }

  async function savePromotion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.product_scope === "SELECTED" && form.product_ids.length === 0) {
      setError("Vui lòng chọn ít nhất một sản phẩm áp dụng.");
      return;
    }
    if (form.product_scope === "SUPPLIER" && !form.supplier) {
      setError("Vui lòng chọn nhà cung cấp áp dụng.");
      return;
    }
    if (form.promotion_kind !== "GENERAL") {
      setError("Kiểu tổng hóa đơn/tổng nhóm sản phẩm chưa được hỗ trợ; vui lòng chọn tính theo từng sản phẩm.");
      return;
    }
    if (form.applied_quantity_unit !== "STANDARD") {
      setError("Đơn vị tính phụ chưa được hỗ trợ; vui lòng chọn đơn vị chuẩn.");
      return;
    }
    const incompleteReward = form.rules.some((rule) => {
      if (rule.reward_type !== "FREE_QUANTITY") return false;
      const selectedGroups = rule.reward_product_entries.map((group) => group.filter((item) => item.product_id !== null));
      const hasAnySelection = selectedGroups.some((group) => group.length > 0);
      return hasAnySelection && selectedGroups.some((group, index) => group.length !== rule.reward_product_entries[index]?.length);
    });
    if (incompleteReward) {
      setError("Vui lòng chọn sản phẩm cho tất cả ô quà tặng, hoặc xóa ô chưa dùng.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const body = {
        ...form,
        start_date: `${dateValue(form.start_date)}T00:00:00`,
        end_date: `${dateValue(form.end_date)}T23:59:59`,
        description: form.description || null,
        supplier: form.supplier || null,
        product_ids: form.product_scope === "SELECTED" ? form.product_ids : [],
        product_min_quantities: Object.fromEntries(
          (form.product_scope === "SELECTED" ? form.product_ids : [])
            .map((productId) => [productId, Math.max(1, Number(form.product_min_quantities[productId] ?? 1))]),
        ),
        rules: form.rules.map((rule) => ({
          ...rule,
          min_quantity: rule.trigger_type === "QUANTITY" ? Number(rule.min_quantity ?? 1) : null,
          quantity_unit: rule.quantity_unit,
          min_amount: rule.trigger_type === "AMOUNT" ? Number(rule.min_amount ?? 0) : null,
          reward_value: Number(rule.reward_value),
          reward_unit: rule.reward_unit,
          reward_product_details: rule.reward_type === "FREE_QUANTITY"
            ? rule.reward_product_entries
              .map((group) => group.filter((item): item is RewardProductEntry & { product_id: number } => item.product_id !== null))
              .filter((group) => group.length > 0)
            : [],
          reward_product_groups: [],
          reward_product_ids: [],
          reward_product_id: null,
        })),
      };
      const response = await apiFetch(
        dialog === "create" ? `${API_URL}/promotions` : `${API_URL}/promotions/${selected?.id}`,
        {
          method: dialog === "create" ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) throw new Error(await responseError(response, "Không thể lưu chương trình."));
      setDialog(null);
      await loadData();
    } catch (saveFailure) {
      setError(saveFailure instanceof Error ? saveFailure.message : "Không thể lưu chương trình.");
    } finally {
      setSaving(false);
    }
  }

  async function runAction(promotion: Promotion, action: "lock" | "clone" | "delete") {
    if (action === "delete" && !window.confirm(`Xóa chương trình "${promotion.name}"?`)) return;
    setError("");
    try {
      const response = action === "delete"
        ? await apiFetch(`${API_URL}/promotions/${promotion.id}`, { method: "DELETE" })
        : await apiFetch(
          `${API_URL}/promotions/${promotion.id}/${action === "clone" ? "clone" : `lock?locked=${!promotion.is_locked}`}`,
          { method: action === "clone" ? "POST" : "PATCH" },
        );
      if (!response.ok) throw new Error(await responseError(response, "Không thể thực hiện thao tác."));
      await loadData();
    } catch (actionFailure) {
      setError(actionFailure instanceof Error ? actionFailure.message : "Không thể thực hiện thao tác.");
    }
  }

  function updateRule(index: number, patch: Partial<PromotionRule>) {
    setForm((current) => ({
      ...current,
      rules: current.rules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule),
    }));
  }

  function addRewardGroup(ruleIndex: number) {
    const groups = form.rules[ruleIndex]?.reward_product_entries ?? [];
    updateRule(ruleIndex, { reward_product_entries: [...groups, [{ product_id: null, quantity: 1, unit: "BOX" }]] });
  }

  function addRewardAlternative(ruleIndex: number) {
    const groups = (form.rules[ruleIndex]?.reward_product_entries ?? []).map((group) => [...group]);
    if (groups.length === 0) groups.push([{ product_id: null, quantity: 1, unit: "BOX" }]);
    else groups[groups.length - 1].push({ product_id: null, quantity: 1, unit: "BOX" });
    updateRule(ruleIndex, { reward_product_entries: groups });
  }

  function removeRewardProduct(ruleIndex: number, groupIndex: number, productIndex: number) {
    const groups = (form.rules[ruleIndex]?.reward_product_entries ?? []).map((group) => [...group]);
    groups[groupIndex]?.splice(productIndex, 1);
    updateRule(ruleIndex, {
      reward_product_entries: groups.filter((group) => group.length > 0),
    });
  }

  function removeLastRewardProduct(ruleIndex: number) {
    const groups = (form.rules[ruleIndex]?.reward_product_entries ?? []).map((group) => [...group]);
    const lastGroup = groups.at(-1);
    if (!lastGroup) return;
    lastGroup.pop();
    if (lastGroup.length === 0) groups.pop();
    updateRule(ruleIndex, { reward_product_entries: groups });
  }

  function removePromotionRule(ruleIndex: number) {
    setForm((current) => ({
      ...current,
      rules: current.rules.filter((_, index) => index !== ruleIndex),
    }));
  }

  function rewardProductLabel(productId: number) {
    const product = products.find((item) => item.id === productId);
    return product ? `${product.sku} - ${product.name}` : `ID ${productId}`;
  }

  const inputClass = "mt-1 w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:bg-gray-100";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Chương trình khuyến mãi"
        subtitle="Tạo, theo dõi thời gian áp dụng, khóa và sao chép chương trình khuyến mãi."
        actions={isAdmin ? (
          <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700">
            <Plus size={16} /> Tạo chương trình
          </button>
        ) : undefined}
      />
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white shadow-sm">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="bg-gray-50 text-xs font-semibold text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left">Mã / Tên chương trình</th>
              <th className="px-4 py-3 text-left">Đối tượng / Nhà cung cấp</th>
              <th className="px-4 py-3 text-left">Thời gian</th>
              <th className="px-4 py-3 text-left">Điều kiện / ưu đãi</th>
              <th className="px-4 py-3 text-center">Trạng thái</th>
              <th className="px-4 py-3 text-right">{isAdmin ? "Chức năng" : ""}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400"><Loader2 className="mr-2 inline animate-spin" size={16} />Đang tải...</td></tr>
            ) : promotions.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400">Chưa có chương trình khuyến mãi.</td></tr>
            ) : promotions.map((promotion) => (
              <tr key={promotion.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <p className="font-semibold text-gray-900">{promotion.name}</p>
                  <p className="text-xs text-gray-500">{promotion.code}</p>
                </td>
                <td className="px-4 py-3 text-xs text-gray-600">
                  <p>{promotion.target_scope === "ALL" ? "Tất cả khách hàng" : customerTypeLabels[promotion.customer_type ?? ""] ?? promotion.customer_type}</p>
                  <p className="text-gray-400">{promotion.product_scope === "SUPPLIER" ? promotion.supplier : `${promotion.product_ids.length} sản phẩm`}</p>
                </td>
                <td className="px-4 py-3 text-xs text-gray-600">
                  <span className="inline-flex items-center gap-1"><CalendarDays size={13} />{dateValue(promotion.start_date)} - {dateValue(promotion.end_date)}</span>
                </td>
                <td className="max-w-[360px] px-4 py-3 text-xs text-gray-600">
                  {promotion.rules.map((rule, index) => <p key={rule.id ?? index}>{ruleDescription(rule)}</p>)}
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-medium",
                    promotion.is_locked ? "bg-gray-100 text-gray-600" : promotionStatus(promotion) === "Chưa hỗ trợ" ? "bg-red-50 text-red-700" : promotion.is_active && promotionStatus(promotion) === "Đang áp dụng" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                  )}>{promotionStatus(promotion)}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <button title="Xem" onClick={() => openExisting("view", promotion)} className="rounded-md p-2 text-gray-500 hover:bg-gray-100"><Eye size={15} /></button>
                    {isAdmin && (
                      <>
                        <button
                          title="Sửa"
                          disabled={promotion.is_locked || loadingPromotionId !== null}
                          onClick={() => void openEdit(promotion)}
                          className="rounded-md p-2 text-sky-700 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {loadingPromotionId === promotion.id
                            ? <Loader2 size={15} className="animate-spin" />
                            : <Pencil size={15} />}
                        </button>
                        <button title={promotion.is_locked ? "Mở khóa" : "Khóa"} onClick={() => void runAction(promotion, "lock")} className="rounded-md p-2 text-amber-700 hover:bg-amber-50">{promotion.is_locked ? <LockOpen size={15} /> : <Lock size={15} />}</button>
                        <button title="Tạo chương trình tương tự" onClick={() => void runAction(promotion, "clone")} className="rounded-md p-2 text-indigo-700 hover:bg-indigo-50"><Copy size={15} /></button>
                        <button title="Xóa" onClick={() => void runAction(promotion, "delete")} className="rounded-md p-2 text-red-600 hover:bg-red-50"><Trash2 size={15} /></button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/45 p-2 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="promotion-dialog-title">
          <form onSubmit={savePromotion} className="flex max-h-[96vh] w-full max-w-7xl flex-col overflow-hidden border border-slate-500 bg-white shadow-2xl">
            <div className="flex shrink-0 items-center justify-between bg-[#14263d] px-4 py-2.5 text-white sm:px-5">
              <div className="flex min-w-0 items-center gap-2.5">
                <ShoppingCart size={19} className="shrink-0 text-red-500" />
                <div className="min-w-0">
                  <h2 id="promotion-dialog-title" className="truncate text-sm font-semibold uppercase tracking-wide">
                    {dialog === "create" ? "Thêm mới chương trình khuyến mại" : dialog === "edit" ? "Cập nhật chương trình khuyến mại" : "Chi tiết chương trình khuyến mại"}
                  </h2>
                  {selected && <p className="text-[11px] text-slate-300">{selected.code}</p>}
                </div>
              </div>
              <button type="button" onClick={() => setDialog(null)} className="rounded p-1 text-white/80 hover:bg-white/10 hover:text-white" aria-label="Đóng"><X size={17} /></button>
            </div>
            {error && <div role="alert" className="mx-4 mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 sm:mx-5">{error}</div>}
            <fieldset disabled={dialog === "view" || saving} className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-white">
              <section className="border-b border-slate-200 px-4 py-3 sm:px-5">
                <div className="grid gap-x-4 gap-y-3 md:grid-cols-[minmax(0,2fr)_minmax(220px,1fr)]">
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
                    <label className="col-span-2 text-[11px] font-semibold text-slate-600 sm:col-span-2">Chương trình KM
                      <input required maxLength={160} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={inputClass} />
                    </label>
                    <label className="text-[11px] font-semibold text-slate-600">Phạm vi sản phẩm
                      <select
                        value={form.product_scope}
                        onChange={(event) => setForm({
                          ...form,
                          product_scope: event.target.value as PromotionForm["product_scope"],
                          product_ids: event.target.value === "SUPPLIER" ? [] : form.product_ids,
                          product_min_quantities: event.target.value === "SUPPLIER" ? {} : form.product_min_quantities,
                        })}
                        className={inputClass}
                      >
                        <option value="SELECTED">Theo SKU được chọn</option>
                        <option value="SUPPLIER">Theo nhà cung cấp</option>
                      </select>
                    </label>
                    <label className="text-[11px] font-semibold text-slate-600">
                      {form.product_scope === "SUPPLIER" ? "Nhà cung cấp áp dụng" : "Lọc nhanh theo hãng"}
                      <select required={form.product_scope === "SUPPLIER"} value={form.supplier ?? ""} onChange={(event) => setForm({ ...form, supplier: event.target.value || null })} className={inputClass}>
                        <option value="">Tất cả nhà cung cấp</option>
                        {suppliers.map((supplier) => <option key={supplier} value={supplier}>{supplier}</option>)}
                      </select>
                    </label>
                    <label className="text-[11px] font-semibold text-slate-600">Loại hình KM
                      <select value={form.promotion_type} onChange={(event) => setForm({ ...form, promotion_type: event.target.value as PromotionForm["promotion_type"] })} className={inputClass}>
                        <option value="ORDER">Khuyến mại trong đơn</option>
                        <option value="AFTER_SALES">Khuyến mại trả sau</option>
                      </select>
                    </label>
                    <label className="text-[11px] font-semibold text-slate-600">Từ ngày
                      <input required type="date" value={dateValue(form.start_date)} onChange={(event) => setForm({ ...form, start_date: event.target.value })} className={inputClass} />
                    </label>
                    <label className="text-[11px] font-semibold text-slate-600">Đến ngày
                      <input required type="date" min={dateValue(form.start_date)} value={dateValue(form.end_date)} onChange={(event) => setForm({ ...form, end_date: event.target.value })} className={inputClass} />
                    </label>
                    <label className="text-[11px] font-semibold text-slate-600">Đối tượng KM
                      <select value={form.target_scope} onChange={(event) => setForm({ ...form, target_scope: event.target.value as PromotionForm["target_scope"], customer_type: event.target.value === "ALL" ? null : "RETAIL" })} className={inputClass}>
                        <option value="ALL">Tất cả khách hàng</option>
                        <option value="CUSTOMER_TYPE">Theo loại khách hàng</option>
                      </select>
                    </label>
                    {form.target_scope === "CUSTOMER_TYPE" && (
                      <label className="text-[11px] font-semibold text-slate-600">Loại KH
                        <select required value={form.customer_type ?? ""} onChange={(event) => setForm({ ...form, customer_type: event.target.value || null })} className={inputClass}>
                          <option value="">Chọn loại khách hàng</option><option value="DISTRIBUTOR">Nhà phân phối</option><option value="WHOLESALE">Đại lý</option><option value="HORECA">HORECA</option><option value="RETAIL">Cửa hàng</option>
                        </select>
                      </label>
                    )}
                    <label className="text-[11px] font-semibold text-slate-600">Nhân viên
                      <select value={form.employee_code ?? ""} onChange={(event) => setForm({ ...form, employee_code: event.target.value || null })} className={inputClass}>
                        <option value="">Tất cả nhân viên</option>
                        {employees.map((employee) => <option key={employee.code} value={employee.code}>{employee.code} - {employee.name}</option>)}
                      </select>
                    </label>
                    <label className="text-[11px] font-semibold text-slate-600">KM dạng
                      <select value={form.promotion_kind} onChange={(event) => setForm({ ...form, promotion_kind: event.target.value as PromotionForm["promotion_kind"] })} className={inputClass}>
                        <option value="GENERAL">Theo từng sản phẩm đủ điều kiện</option>
                        {form.promotion_kind === "INVOICE_AMOUNT" && <option value="INVOICE_AMOUNT" disabled>Tổng số tiền hóa đơn (chưa hỗ trợ)</option>}
                        {form.promotion_kind === "PRODUCT_AMOUNT" && <option value="PRODUCT_AMOUNT" disabled>Tổng giá trị nhóm sản phẩm (chưa hỗ trợ)</option>}
                      </select>
                    </label>
                    <label className="text-[11px] font-semibold text-slate-600">VAT (%)
                      <input type="number" min={0} max={100} step={0.1} value={form.vat_rate} onChange={(event) => setForm({ ...form, vat_rate: Number(event.target.value) })} className={inputClass} />
                    </label>
                    <label className="text-[11px] font-semibold text-slate-600">Trạng thái
                      <select value={String(form.is_active)} onChange={(event) => setForm({ ...form, is_active: event.target.value === "true" })} className={inputClass}>
                        <option value="true">Hoạt động</option><option value="false">Tạm ngừng</option>
                      </select>
                    </label>
                  </div>
                  <label className="text-[11px] font-semibold text-slate-600">Mô tả
                    <textarea maxLength={255} rows={3} value={form.description ?? ""} onChange={(event) => setForm({ ...form, description: event.target.value })} className={cn(inputClass, "min-h-20 resize-y")} />
                  </label>
                </div>
              </section>

              <section className="border-b border-slate-200">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-amber-200 bg-[#fff8e6] px-3 py-2">
                  <span className="text-[11px] font-bold text-slate-600">
                    {form.product_scope === "SUPPLIER" ? "ÁP DỤNG CHO TOÀN BỘ SKU CỦA NHÀ CUNG CẤP:" : "ÁP DỤNG CHO CÁC SKU:"}
                  </span>
                  {dialog !== "view" && form.product_scope === "SELECTED" && (
                    <>
                      <button type="button" onClick={() => openProductPicker({ type: "eligible" })} className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600 hover:underline">
                        <Plus size={13} /> Thêm sản phẩm
                      </button>
                      <button type="button" onClick={() => openProductPicker({ type: "supplier" })} className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600 hover:underline">
                        <Plus size={13} /> Thêm SP theo hãng
                      </button>
                    </>
                  )}
                  <div className="flex w-full flex-wrap items-center justify-between gap-2 text-[10px] text-slate-600 lg:ml-auto lg:w-auto">
                    <label className="flex items-center gap-1.5">Theo đơn vị tính:
                      <select value={form.applied_quantity_unit} onChange={(event) => setForm({ ...form, applied_quantity_unit: event.target.value as PromotionForm["applied_quantity_unit"] })} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs">
                        <option value="STANDARD">Chuẩn</option>
                        {form.applied_quantity_unit === "SECONDARY" && <option value="SECONDARY" disabled>Phụ (chưa hỗ trợ)</option>}
                      </select>
                    </label>
                    <label className="flex items-center gap-1.5">Số lượng SP tối thiểu:
                      <input type="number" min={1} step={1} value={form.minimum_product_quantity} onChange={(event) => setForm({ ...form, minimum_product_quantity: Math.max(1, Number(event.target.value)) })} className="w-14 rounded border border-slate-300 bg-white px-2 py-1 text-right text-xs" />
                    </label>
                  </div>
                </div>
                <p className="px-3 pb-2 text-[10px] text-slate-500">
                  Điều kiện số lượng và giá trị được tính riêng trên từng dòng sản phẩm đủ điều kiện; không cộng gộp tổng hóa đơn hoặc nhóm SKU.
                </p>
                <div className="flex min-h-14 min-w-0 flex-wrap items-center gap-2 px-3 py-2">
                  {form.product_scope === "SUPPLIER" ? (
                    <p className="text-xs text-slate-700">
                      {form.supplier ? `Toàn bộ sản phẩm thuộc ${form.supplier}` : "Chưa chọn nhà cung cấp áp dụng."}
                    </p>
                  ) : selectedProducts.length === 0 ? (
                    <p className="text-xs text-slate-400">Chưa chọn sản phẩm áp dụng.</p>
                  ) : selectedProducts.map((product) => (
                    <div key={product.id} title={`${product.name}${product.supplier ? ` · ${product.supplier}` : ""} · ${product.unit}, ${product.boxesPerCarton} hộp/thùng · ${product.basePrice.toLocaleString("vi-VN")} đ`} className="flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-slate-300 bg-slate-50 px-2 py-1">
                      <span className="min-w-0 max-w-[260px] truncate text-xs text-slate-700">{product.sku} · {product.name}</span>
                      <span aria-label={`Số lượng ${product.sku}`} className="shrink-0 rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600">SL</span>
                      {dialog !== "view" && <button type="button" onClick={() => toggleProductSelection(product.id)} className="text-sky-600 hover:text-red-600" aria-label={`Bỏ ${product.name}`}><X size={14} /></button>}
                    </div>
                  ))}
                </div>
              </section>

              <section className="border-b border-slate-200">
                <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-[#fff8e6] px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold text-slate-600">KHUYẾN MẠI:</span>
                    <span className="text-[10px] text-slate-500">{form.rules.length} mức điều kiện</span>
                  </div>
                  {dialog !== "view" && <button type="button" onClick={() => setForm({ ...form, rules: [...form.rules, emptyRule()] })} className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600 hover:underline"><Plus size={13} />Thêm mức khuyến mại</button>}
                </div>
                <div className="overflow-x-auto">
                  <div className="min-w-[1080px]">
                    <div className="grid grid-cols-[140px_176px_140px_minmax(360px,1fr)_120px_88px] gap-2 bg-slate-100 px-3 py-2 text-[10px] font-semibold text-slate-600">
                      <span>Điều kiện áp dụng</span><span>Khoảng điều kiện (từ – đến)</span><span>Loại ưu đãi</span><span>Sản phẩm khuyến mại · SL · Đơn vị</span><span>Giá trị ưu đãi</span><span className="text-center">Chức năng</span>
                    </div>
                    {form.rules.map((rule, index) => (
                      <div key={index} className="grid grid-cols-[140px_176px_140px_minmax(360px,1fr)_120px_88px] items-center gap-2 border-b border-slate-200 px-3 py-2">
                        <div>
                          <span className="mb-1 flex items-center justify-between text-[10px] font-semibold text-slate-400">
                            MỨC {index + 1}
                            {form.rules.length > 1 && dialog !== "view" && (
                              <button
                                type="button"
                                onClick={() => removePromotionRule(index)}
                                className="rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                                aria-label={`Xóa mức khuyến mại ${index + 1}`}
                                title={`Xóa mức khuyến mại ${index + 1}`}
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </span>
                          <select value={rule.trigger_type} onChange={(event) => updateRule(index, { trigger_type: event.target.value as PromotionRule["trigger_type"], min_quantity: event.target.value === "QUANTITY" ? 1 : null, max_quantity: null, min_amount: event.target.value === "AMOUNT" ? 1 : null, max_amount: null })} className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs">
                            <option value="QUANTITY">Theo số lượng</option>
                            <option value="AMOUNT">Theo giá trị từng sản phẩm</option>
                          </select>
                        </div>
                        {rule.trigger_type === "QUANTITY" ? (
                          <div className="grid grid-cols-[minmax(0,1fr)_76px] items-center gap-x-2 gap-y-1">
                            <label className="flex items-center gap-1 text-[10px] text-slate-500"><span className="w-6 shrink-0">Từ</span><input required aria-label={`Số lượng từ mức ${index + 1}`} type="number" min={1} step={1} value={rule.min_quantity ?? 1} onChange={(event) => updateRule(index, { min_quantity: Math.max(1, Number(event.target.value)) })} className="w-full min-w-0 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700" /></label>
                            <select aria-label={`Đơn vị số lượng mức ${index + 1}`} value={rule.quantity_unit} onChange={(event) => updateRule(index, { quantity_unit: event.target.value as PromotionRule["quantity_unit"] })} className="row-span-2 h-8 w-full rounded border border-slate-300 bg-white px-1 text-xs">
                              <option value="CARTON">Thùng</option><option value="BOX">Hộp</option>
                            </select>
                            <label className="flex items-center gap-1 text-[10px] text-slate-500"><span className="w-6 shrink-0">Đến</span><input aria-label={`Số lượng đến mức ${index + 1}`} type="number" min={rule.min_quantity ?? 1} step={1} placeholder="Không giới hạn" value={rule.max_quantity ?? ""} onChange={(event) => updateRule(index, { max_quantity: event.target.value ? Number(event.target.value) : null })} className="w-full min-w-0 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700" /></label>
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <label className="flex items-center gap-1 text-[10px] text-slate-500"><span className="w-6 shrink-0">Từ</span><input required aria-label={`Giá trị từ mức ${index + 1}`} type="number" min={0.01} step={1000} value={rule.min_amount ?? ""} onChange={(event) => updateRule(index, { min_amount: event.target.value ? Number(event.target.value) : null })} className="w-full min-w-0 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700" /><span>đ</span></label>
                            <label className="flex items-center gap-1 text-[10px] text-slate-500"><span className="w-6 shrink-0">Đến</span><input aria-label={`Giá trị đến mức ${index + 1}`} type="number" min={rule.min_amount ?? 0.01} step={1000} placeholder="Không giới hạn" value={rule.max_amount ?? ""} onChange={(event) => updateRule(index, { max_amount: event.target.value ? Number(event.target.value) : null })} className="w-full min-w-0 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700" /><span>đ</span></label>
                          </div>
                        )}
                        <select aria-label={`Loại ưu đãi mức ${index + 1}`} value={rule.reward_type} onChange={(event) => updateRule(index, { reward_type: event.target.value as PromotionRule["reward_type"] })} className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs">
                          <option value="FREE_QUANTITY">Tặng số lượng</option><option value="DISCOUNT_AMOUNT">Chiết khấu tiền</option><option value="DISCOUNT_PERCENT">Chiết khấu phần trăm</option>
                        </select>
                        {rule.reward_type === "FREE_QUANTITY" ? (
                          <div className="min-w-0 overflow-x-auto">
                            <div className="flex min-w-max items-stretch gap-1">
                            {rule.reward_product_entries.length === 0 ? (
                              <span className="self-center text-[10px] text-slate-400">Mặc định sản phẩm áp dụng</span>
                            ) : rule.reward_product_entries.map((group, groupIndex) => (
                              <div key={groupIndex} className="flex w-[360px] min-w-[360px] flex-none items-stretch gap-1">
                                {groupIndex > 0 && <span className="self-center px-1 text-[10px] font-bold text-slate-500">VÀ</span>}
                                <div className="flex min-w-0 flex-1 flex-col items-stretch">
                                  <div className="grid grid-cols-[minmax(0,1fr)_52px_76px] gap-1 pb-1 text-center text-[9px] font-medium text-slate-500">
                                    <span className="text-left">Sản phẩm</span><span>SL</span><span>Đơn vị</span>
                                  </div>
                                  {group.map((entry, productIndex) => (
                                    <div key={`${groupIndex}-${productIndex}`} className="min-w-0">
                                      {productIndex > 0 && <span className="block py-0.5 text-center text-[9px] font-bold text-red-600">HOẶC</span>}
                                      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_52px_76px] items-center gap-1">
                                      <div className="flex min-w-0 items-center rounded border border-slate-300 bg-white">
                                        <button
                                          type="button"
                                          onClick={() => openProductPicker({ type: "reward", ruleIndex: index, groupIndex, productIndex })}
                                          title={entry.product_id == null ? "Chọn sản phẩm khuyến mại" : rewardProductLabel(entry.product_id)}
                                          className="min-w-0 flex-1 px-2 py-1.5 text-left text-xs text-slate-700"
                                        >
                                          {entry.product_id == null ? (
                                            <span className="block truncate text-slate-400">Chọn sản phẩm...</span>
                                          ) : (
                                            <>
                                              <span className="flex min-w-0 items-center gap-1">
                                                <span className="shrink-0 font-medium">{products.find((product) => product.id === entry.product_id)?.sku ?? `ID ${entry.product_id}`}</span>
                                                <span className="truncate text-[10px] text-slate-500">{products.find((product) => product.id === entry.product_id)?.name ?? "Sản phẩm không còn trong danh mục"}</span>
                                              </span>
                                            </>
                                          )}
                                        </button>
                                        {dialog !== "view" && (
                                          <button type="button" onClick={() => removeRewardProduct(index, groupIndex, productIndex)} className="shrink-0 px-1 text-slate-400 hover:text-red-600" aria-label={entry.product_id == null ? "Xóa ô sản phẩm khuyến mại" : `Bỏ sản phẩm quà tặng ${rewardProductLabel(entry.product_id)}`}><X size={13} /></button>
                                        )}
                                      </div>
                                      <input
                                        aria-label={`Số lượng tặng sản phẩm ${entry.product_id == null ? productIndex + 1 : rewardProductLabel(entry.product_id)}`}
                                        type="number"
                                        min={1}
                                        step={1}
                                        value={entry.quantity}
                                        disabled={dialog === "view"}
                                        onChange={(event) => {
                                          const groups = rule.reward_product_entries.map((items) => items.map((item) => ({ ...item })));
                                          groups[groupIndex][productIndex].quantity = Math.max(1, Number(event.target.value) || 1);
                                          updateRule(index, { reward_product_entries: groups });
                                        }}
                                        className="w-full rounded border border-slate-300 px-1 py-1.5 text-center text-xs disabled:bg-gray-100"
                                      />
                                      <select
                                        aria-label={`Đơn vị tặng sản phẩm ${entry.product_id == null ? productIndex + 1 : rewardProductLabel(entry.product_id)}`}
                                        value={entry.unit}
                                        disabled={dialog === "view"}
                                        onChange={(event) => {
                                          const groups = rule.reward_product_entries.map((items) => items.map((item) => ({ ...item })));
                                          groups[groupIndex][productIndex].unit = event.target.value as RewardProductEntry["unit"];
                                          updateRule(index, { reward_product_entries: groups });
                                        }}
                                        className="w-full rounded border border-slate-300 bg-white px-1 py-1.5 text-xs disabled:bg-gray-100"
                                      >
                                        <option value="BOX">Hộp</option><option value="CARTON">Thùng</option>
                                      </select>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                            </div>
                          </div>
                        ) : <span className="text-xs text-slate-400">Không áp dụng</span>}
                        {rule.reward_type === "FREE_QUANTITY" ? (
                          <span className="text-center text-[10px] text-slate-400">—</span>
                        ) : (
                          <input aria-label={`Giá trị ưu đãi mức ${index + 1}`} type="number" min={0} max={rule.reward_type === "DISCOUNT_PERCENT" ? 100 : undefined} step={rule.reward_type === "DISCOUNT_PERCENT" ? 1 : 1000} value={rule.reward_value} onChange={(event) => updateRule(index, { reward_value: Number(event.target.value) })} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs" />
                        )}
                        <div className="flex flex-col items-stretch gap-1">
                          {dialog !== "view" && rule.reward_type === "FREE_QUANTITY" && (
                            <>
                              <button type="button" onClick={() => addRewardGroup(index)} className="rounded border border-sky-200 px-2 py-1 text-[10px] font-semibold text-sky-700 hover:bg-sky-50">Và</button>
                              <button type="button" onClick={() => addRewardAlternative(index)} className="rounded border border-amber-200 px-2 py-1 text-[10px] font-semibold text-amber-700 hover:bg-amber-50">Hoặc</button>
                              <button
                                type="button"
                                onClick={() => removeLastRewardProduct(index)}
                                disabled={rule.reward_product_entries.length === 0}
                                className="rounded border border-red-200 px-2 py-1 text-[10px] font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-30"
                                aria-label="Xóa sản phẩm khuyến mại cuối cùng"
                                title="Xóa lựa chọn quà tặng cuối cùng"
                              >
                                Xóa
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                    {form.rules.length === 0 && <p className="px-3 py-6 text-center text-xs text-slate-400">Chưa có mức khuyến mại.</p>}
                  </div>
                </div>
              </section>
            </fieldset>
            <div className="flex shrink-0 justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2.5 sm:px-5">
              <button type="button" onClick={() => setDialog(null)} className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800">{dialog === "view" ? "Đóng" : "Hủy"}</button>
              {dialog !== "view" && (
                <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60">
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} {dialog === "edit" ? "Cập nhật" : "Tạo chương trình"}
                </button>
              )}
            </div>
          </form>
          {productPickerTarget && dialog !== "view" && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="product-picker-title">
              <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
                <div className="flex items-start justify-between border-b border-gray-100 px-5 py-4">
                  <div>
                    <h2 id="product-picker-title" className="text-lg font-semibold text-gray-900">
                      {productPickerTarget.type === "reward" ? "Chọn sản phẩm khuyến mại" : productPickerTarget.type === "supplier" ? "Thêm sản phẩm theo hãng" : "Chọn sản phẩm áp dụng"}
                    </h2>
                    <p className="mt-1 text-xs text-gray-500">
                      {productPickerTarget.type === "reward"
                        ? "Chọn một SKU làm sản phẩm được tặng; nếu không chọn, mặc định tặng sản phẩm áp dụng."
                        : productPickerTarget.type === "supplier"
                          ? "Chọn nhà cung cấp để hiển thị toàn bộ sản phẩm của hãng, sau đó thêm nhanh các sản phẩm phù hợp."
                          : "Tìm theo mã/tên sản phẩm hoặc lọc theo nhà cung cấp. Có thể chọn từng SKU."}
                    </p>
                  </div>
                  <button type="button" onClick={() => setProductPickerTarget(null)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100" aria-label="Đóng danh sách sản phẩm">
                    <X size={18} />
                  </button>
                </div>
                <div className="grid gap-3 border-b border-gray-100 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_280px]">
                  <div className="relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      autoFocus
                      value={productSearch}
                      onChange={(event) => setProductSearch(event.target.value)}
                      placeholder="Tìm theo mã SKU, tên sản phẩm..."
                      className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>
                  <select
                    aria-label="Lọc sản phẩm theo nhà cung cấp"
                    value={supplierFilter}
                    onChange={(event) => setSupplierFilter(event.target.value)}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    <option value="">{productPickerTarget.type === "supplier" ? "Chọn nhà cung cấp" : `Tất cả nhà cung cấp (${suppliers.length})`}</option>
                    {suppliers.map((supplier) => <option key={supplier} value={supplier}>{supplier}</option>)}
                  </select>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-gray-50 px-5 py-3">
                  <p className="text-xs text-gray-600">
                    {filteredProducts.length.toLocaleString("vi-VN")} sản phẩm phù hợp
                    {filteredProducts.length > visibleProducts.length ? ` · đang hiển thị ${visibleProducts.length} sản phẩm đầu tiên` : ""}
                  </p>
                  {productPickerTarget.type !== "reward" && (
                    <button
                      type="button"
                      disabled={filteredProducts.length === 0 || (productPickerTarget.type === "supplier" && !supplierFilter)}
                      onClick={addFilteredProducts}
                      className="rounded-lg border border-sky-200 bg-white px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-50"
                    >
                      {productPickerTarget.type === "supplier" ? "Thêm sản phẩm của hãng" : "Chọn tất cả kết quả"} ({filteredProducts.length.toLocaleString("vi-VN")})
                    </button>
                  )}
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                  <table className="w-full min-w-[900px] text-left text-sm">
                    <thead className="sticky top-0 z-10 bg-white text-xs text-gray-500 shadow-sm">
                      <tr>
                        <th className="w-12 px-4 py-3">Chọn</th>
                        <th className="px-4 py-3">Mã SKU / Tên sản phẩm</th>
                        <th className="px-4 py-3">Quy cách</th>
                        <th className="px-4 py-3">Nhà cung cấp</th>
                        <th className="px-4 py-3 text-right">Giá bán</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {visibleProducts.length === 0 ? (
                        <tr><td colSpan={5} className="px-4 py-12 text-center text-sm text-gray-400">Không tìm thấy sản phẩm phù hợp.</td></tr>
                      ) : visibleProducts.map((product) => {
                        const checked = productPickerTarget.type === "reward"
                          ? form.rules[productPickerTarget.ruleIndex]?.reward_product_entries[productPickerTarget.groupIndex]?.[productPickerTarget.productIndex]?.product_id === product.id
                          : form.product_ids.includes(product.id);
                        return (
                          <tr key={product.id} className={cn("hover:bg-sky-50/60", checked && "bg-sky-50/40")}>
                            <td className="px-4 py-3">
                              <input
                                type={productPickerTarget.type === "reward" ? "radio" : "checkbox"}
                                name={productPickerTarget.type === "reward" ? `reward-product-${productPickerTarget.ruleIndex}-${productPickerTarget.groupIndex}-${productPickerTarget.productIndex}` : undefined}
                                checked={checked}
                                onChange={() => toggleProductSelection(product.id)}
                                aria-label={`Chọn ${product.sku} ${product.name}`}
                                className="h-4 w-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500"
                              />
                            </td>
                            <td className="px-4 py-3">
                              {productPickerTarget.type === "reward" ? (
                                <button
                                  type="button"
                                  onClick={() => toggleProductSelection(product.id)}
                                  aria-label={`Chọn ${product.sku} ${product.name}`}
                                  className="w-full rounded text-left focus:outline-none focus:ring-2 focus:ring-sky-500"
                                >
                                  <p className="font-medium text-gray-800">{product.sku}</p>
                                  <p className="text-xs text-gray-500">{product.name}</p>
                                </button>
                              ) : (
                                <>
                                  <p className="font-medium text-gray-800">{product.sku}</p>
                                  <p className="text-xs text-gray-500">{product.name}</p>
                                </>
                              )}
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-600">
                              {product.unit}<br />{product.boxesPerCarton} hộp/thùng
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-600">{product.supplier || "—"}</td>
                            <td className="px-4 py-3 text-right font-medium tabular-nums text-gray-800">
                              {product.basePrice.toLocaleString("vi-VN")} đ
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-5 py-4">
                  <p className="text-sm text-gray-600">
                    {productPickerTarget.type === "reward"
                      ? <>Chọn một sản phẩm cho ô quà tặng này</>
                      : <>Đã chọn <strong>{form.product_ids.length}</strong> sản phẩm</>}
                  </p>
                  <button type="button" onClick={() => setProductPickerTarget(null)} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700">
                    Xong
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, Copy, Eye, Lock, LockOpen, Loader2, Pencil, Plus, Search, Save, Trash2, X } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { API_URL, apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ProductOption {
  id: number;
  sku: string;
  name: string;
  supplier: string;
}

interface EmployeeOption {
  code: string;
  name: string;
  status: string;
}

interface PromotionRule {
  id?: number;
  trigger_type: "QUANTITY" | "AMOUNT";
  min_quantity: number | null;
  quantity_unit: "CARTON" | "BOX";
  min_amount: number | null;
  reward_type: "FREE_QUANTITY" | "DISCOUNT_AMOUNT" | "DISCOUNT_PERCENT";
  reward_value: number;
  reward_unit: "CARTON" | "BOX";
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
  promotion_type: "ORDER";
  target_scope: "ALL" | "CUSTOMER_TYPE";
  customer_type: string | null;
  employee_code: string | null;
  vat_rate: number;
  product_scope: "SELECTED" | "SUPPLIER";
  supplier: string | null;
  product_ids: number[];
  rules: PromotionRule[];
}

type PromotionForm = Omit<Promotion, "id" | "code" | "is_locked">;
type DialogMode = "create" | "edit" | "view" | null;

const emptyRule = (): PromotionRule => ({
  trigger_type: "QUANTITY",
  min_quantity: 1,
  quantity_unit: "CARTON",
  min_amount: null,
  reward_type: "FREE_QUANTITY",
  reward_value: 1,
  reward_unit: "BOX",
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
    target_scope: "ALL",
    customer_type: null,
    employee_code: null,
    vat_rate: 0,
    product_scope: "SELECTED",
    supplier: null,
    product_ids: [],
    rules: [emptyRule()],
  };
}

function dateValue(value: string) {
  return value.slice(0, 10);
}

function promotionStatus(promotion: Promotion) {
  if (promotion.is_locked) return "Đã khóa";
  if (!promotion.is_active) return "Ngừng áp dụng";
  const today = todayDate();
  if (dateValue(promotion.start_date) > today) return "Chưa đến hạn";
  if (dateValue(promotion.end_date) < today) return "Hết hạn";
  return "Đang áp dụng";
}

function ruleDescription(rule: PromotionRule) {
  const trigger = rule.trigger_type === "QUANTITY"
    ? `Mua từ ${rule.min_quantity ?? 1} ${rule.quantity_unit === "CARTON" ? "thùng" : "hộp"}`
    : `Đơn từ ${Number(rule.min_amount ?? 0).toLocaleString("vi-VN")}đ`;
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

  const filteredProducts = useMemo(() => {
    const query = productSearch.trim().toLocaleLowerCase();
    return products
      .filter((product) => !form.product_ids.includes(product.id))
      .filter((product) => !supplierFilter || product.supplier === supplierFilter)
      .filter((product) => !query || [product.sku, product.name, product.supplier].some((value) => value.toLocaleLowerCase().includes(query)))
      .slice(0, 100);
  }, [form.product_ids, productSearch, products, supplierFilter]);

  const suppliers = useMemo(
    () => [...new Set(products.map((product) => product.supplier.trim()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, "vi")),
    [products],
  );

  const selectedProducts = useMemo(
    () => form.product_ids.map((id) => products.find((product) => product.id === id)).filter((product): product is ProductOption => Boolean(product)),
    [form.product_ids, products],
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [promotionResponse, productResponse, userResponse, employeeResponse] = await Promise.all([
        apiFetch(`${API_URL}/promotions`),
        apiFetch(`${API_URL}/products/?limit=10000`),
        apiFetch(`${API_URL}/auth/me`),
        apiFetch(`${API_URL}/employees/?status=active&limit=1000`),
      ]);
      if (!promotionResponse.ok) throw new Error(await responseError(promotionResponse, "Không thể tải chương trình khuyến mãi."));
      if (!productResponse.ok) throw new Error(await responseError(productResponse, "Không thể tải danh sách sản phẩm."));
      const promotionRows = await promotionResponse.json() as Promotion[];
      const productRows = await productResponse.json() as Array<Record<string, unknown>>;
      const user = userResponse.ok ? await userResponse.json() as { is_admin?: boolean } : null;
      setPromotions(promotionRows);
      setIsAdmin(user?.is_admin === true);
      setProducts(productRows
        .filter((row) => row.status !== "inactive")
        .map((row) => ({
          id: Number(row.id),
          sku: String(row.sku ?? ""),
          name: String(row.name ?? ""),
          supplier: String(row.supplier ?? ""),
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
    setSelected(null);
    setForm(newForm());
    setProductSearch("");
    setSupplierFilter("");
    setDialog("create");
  }

  function openExisting(mode: Exclude<DialogMode, "create" | null>, promotion: Promotion) {
    setSelected(promotion);
    setForm({
      name: promotion.name,
      description: promotion.description ?? "",
      start_date: promotion.start_date,
      end_date: promotion.end_date,
      is_active: promotion.is_active,
      promotion_type: promotion.promotion_type ?? "ORDER",
      target_scope: promotion.target_scope ?? "ALL",
      customer_type: promotion.customer_type,
      employee_code: promotion.employee_code,
      vat_rate: promotion.vat_rate ?? 0,
      product_scope: promotion.product_scope ?? "SELECTED",
      supplier: promotion.supplier,
      product_ids: [...promotion.product_ids],
      rules: promotion.rules.map((rule) => ({
        trigger_type: rule.trigger_type,
        min_quantity: rule.min_quantity,
        quantity_unit: rule.quantity_unit,
        min_amount: rule.min_amount,
        reward_type: rule.reward_type,
        reward_value: rule.reward_value,
        reward_unit: rule.reward_unit,
      })),
    });
    setProductSearch("");
    setSupplierFilter(promotion.supplier ?? "");
    setDialog(mode);
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
    setSaving(true);
    setError("");
    try {
      const body = {
        ...form,
        start_date: `${dateValue(form.start_date)}T00:00:00`,
        end_date: `${dateValue(form.end_date)}T23:59:59`,
        description: form.description || null,
        supplier: form.supplier || null,
        rules: form.rules.map((rule) => ({
          ...rule,
          min_quantity: rule.trigger_type === "QUANTITY" ? Number(rule.min_quantity ?? 1) : null,
          quantity_unit: rule.quantity_unit,
          min_amount: rule.trigger_type === "AMOUNT" ? Number(rule.min_amount ?? 0) : null,
          reward_value: Number(rule.reward_value),
          reward_unit: rule.reward_unit,
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

  const inputClass = "mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:bg-gray-100";

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
                    promotion.is_locked ? "bg-gray-100 text-gray-600" : promotion.is_active && promotionStatus(promotion) === "Đang áp dụng" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-2 sm:p-4" role="dialog" aria-modal="true">
          <form onSubmit={savePromotion} className="flex max-h-[96vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex shrink-0 items-start justify-between border-b border-gray-100 px-5 py-4 sm:px-7">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  {dialog === "create" ? "Tạo chương trình khuyến mãi" : dialog === "edit" ? "Chỉnh sửa chương trình" : "Chi tiết chương trình"}
                </h2>
                {selected && <p className="text-xs text-gray-500">{selected.code}</p>}
              </div>
              <button type="button" onClick={() => setDialog(null)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100" aria-label="Đóng"><X size={18} /></button>
            </div>
            <fieldset disabled={dialog === "view" || saving} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-7">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-medium text-gray-600">Tên chương trình
                  <input required maxLength={160} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={inputClass} />
                </label>
                <label className="text-xs font-medium text-gray-600">Loại hình khuyến mãi
                  <select value={form.promotion_type} onChange={(event) => setForm({ ...form, promotion_type: event.target.value as "ORDER" })} className={inputClass}>
                    <option value="ORDER">Khuyến mãi trong đơn</option>
                  </select>
                </label>
                <label className="text-xs font-medium text-gray-600">Trạng thái
                  <select value={String(form.is_active)} onChange={(event) => setForm({ ...form, is_active: event.target.value === "true" })} className={inputClass}>
                    <option value="true">Đang bật</option><option value="false">Tạm ngừng</option>
                  </select>
                </label>
                <label className="text-xs font-medium text-gray-600">Ngày bắt đầu
                  <input required type="date" value={dateValue(form.start_date)} onChange={(event) => setForm({ ...form, start_date: event.target.value })} className={inputClass} />
                </label>
                <label className="text-xs font-medium text-gray-600">Ngày kết thúc
                  <input required type="date" min={dateValue(form.start_date)} value={dateValue(form.end_date)} onChange={(event) => setForm({ ...form, end_date: event.target.value })} className={inputClass} />
                </label>
                <label className="text-xs font-medium text-gray-600">Đối tượng khuyến mãi
                  <select value={form.target_scope} onChange={(event) => setForm({
                    ...form,
                    target_scope: event.target.value as PromotionForm["target_scope"],
                    customer_type: event.target.value === "ALL" ? null : "RETAIL",
                  })} className={inputClass}>
                    <option value="ALL">Tất cả khách hàng</option>
                    <option value="CUSTOMER_TYPE">Theo loại khách hàng</option>
                  </select>
                </label>
                {form.target_scope === "CUSTOMER_TYPE" ? (
                  <label className="text-xs font-medium text-gray-600">Loại khách hàng
                    <select required value={form.customer_type ?? ""} onChange={(event) => setForm({ ...form, customer_type: event.target.value || null })} className={inputClass}>
                      <option value="">Chọn loại khách hàng</option>
                      <option value="DISTRIBUTOR">Nhà phân phối</option>
                      <option value="WHOLESALE">Đại lý</option>
                      <option value="HORECA">HORECA</option>
                      <option value="RETAIL">Cửa hàng</option>
                    </select>
                  </label>
                ) : (
                  <label className="text-xs font-medium text-gray-600">Nhân viên áp dụng
                    <select value={form.employee_code ?? ""} onChange={(event) => setForm({ ...form, employee_code: event.target.value || null })} className={inputClass}>
                      <option value="">Tất cả nhân viên</option>
                      {employees.map((employee) => <option key={employee.code} value={employee.code}>{employee.code} - {employee.name}</option>)}
                    </select>
                  </label>
                )}
                {form.target_scope === "CUSTOMER_TYPE" && (
                  <label className="text-xs font-medium text-gray-600">Nhân viên áp dụng
                    <select value={form.employee_code ?? ""} onChange={(event) => setForm({ ...form, employee_code: event.target.value || null })} className={inputClass}>
                      <option value="">Tất cả nhân viên</option>
                      {employees.map((employee) => <option key={employee.code} value={employee.code}>{employee.code} - {employee.name}</option>)}
                    </select>
                  </label>
                )}
                <label className="text-xs font-medium text-gray-600">Thuế VAT (%)
                  <input type="number" min={0} max={100} step={0.1} value={form.vat_rate} onChange={(event) => setForm({ ...form, vat_rate: Number(event.target.value) })} className={inputClass} />
                  <span className="mt-1 block font-normal text-gray-400">Lưu cấu hình; chưa cộng vào tổng tiền đơn hàng.</span>
                </label>
                <label className="text-xs font-medium text-gray-600">Phạm vi sản phẩm
                  <select value={form.product_scope} onChange={(event) => setForm({
                    ...form,
                    product_scope: event.target.value as PromotionForm["product_scope"],
                    product_ids: [],
                    supplier: event.target.value === "SELECTED" ? null : form.supplier,
                  })} className={inputClass}>
                    <option value="SELECTED">Chọn sản phẩm cụ thể</option>
                    <option value="SUPPLIER">Tất cả sản phẩm của nhà cung cấp</option>
                  </select>
                </label>
                {form.product_scope === "SUPPLIER" && (
                  <label className="text-xs font-medium text-gray-600">Nhà cung cấp áp dụng
                    <select required value={form.supplier ?? ""} onChange={(event) => setForm({ ...form, supplier: event.target.value || null })} className={inputClass}>
                      <option value="">Chọn nhà cung cấp</option>
                      {suppliers.map((supplier) => <option key={supplier} value={supplier}>{supplier}</option>)}
                    </select>
                  </label>
                )}
                <label className="text-xs font-medium text-gray-600 sm:col-span-2">Mô tả
                  <input maxLength={255} value={form.description ?? ""} onChange={(event) => setForm({ ...form, description: event.target.value })} className={inputClass} />
                </label>
                <div className="sm:col-span-2">
                  {form.product_scope === "SUPPLIER" ? (
                    <div className="rounded-xl border border-sky-100 bg-sky-50 px-4 py-4 text-sm text-sky-800">
                      Áp dụng cho tất cả sản phẩm của nhà cung cấp <strong>{form.supplier || "đã chọn"}</strong>.
                    </div>
                  ) : (
                    <>
                  <label htmlFor="promotion-product-search" className="text-xs font-medium text-gray-600">Tìm và thêm sản phẩm áp dụng</label>
                  <div className="mt-1 grid gap-2 sm:grid-cols-[minmax(0,1.5fr)_minmax(220px,1fr)]">
                    <div className="relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      id="promotion-product-search"
                      value={productSearch}
                      onChange={(event) => setProductSearch(event.target.value)}
                      placeholder="Tìm theo mã SKU, tên sản phẩm hoặc nhà cung cấp..."
                      className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                    </div>
                    <select
                      aria-label="Lọc sản phẩm theo nhà cung cấp"
                      value={supplierFilter}
                      onChange={(event) => setSupplierFilter(event.target.value)}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                    >
                      <option value="">Tất cả nhà cung cấp ({suppliers.length})</option>
                      {suppliers.map((supplier) => (
                        <option key={supplier} value={supplier}>{supplier}</option>
                      ))}
                    </select>
                  </div>
                  <div className="mt-2 overflow-hidden rounded-xl border border-gray-200">
                    <div className="flex items-center justify-between bg-gray-50 px-3 py-2 text-xs text-gray-500">
                      <span>Kết quả tìm kiếm</span>
                      <span>{filteredProducts.length}{filteredProducts.length === 100 ? "+" : ""} sản phẩm</span>
                    </div>
                    <div className="max-h-64 divide-y divide-gray-100 overflow-y-auto">
                      {filteredProducts.length === 0 ? (
                        <p className="px-3 py-5 text-center text-xs text-gray-400">
                          {products.length === form.product_ids.length ? "Đã thêm tất cả sản phẩm." : "Không tìm thấy sản phẩm phù hợp."}
                        </p>
                      ) : filteredProducts.map((product) => (
                        <div key={product.id} className="flex items-center gap-3 px-3 py-2 hover:bg-sky-50/60">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-gray-800">{product.name}</p>
                            <p className="truncate text-xs text-gray-500">{product.sku}{product.supplier ? ` · NCC: ${product.supplier}` : ""}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setForm((current) => ({ ...current, product_ids: [...current.product_ids, product.id] }))}
                            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-sky-200 bg-white px-2.5 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-50"
                          >
                            <Plus size={13} /> Thêm
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <p className="text-xs font-semibold text-gray-700">Danh sách áp dụng ({selectedProducts.length})</p>
                    {selectedProducts.length > 0 && (
                      <button type="button" onClick={() => setForm((current) => ({ ...current, product_ids: [] }))} className="text-xs font-medium text-red-600 hover:underline">
                        Xóa tất cả
                      </button>
                    )}
                  </div>
                  {selectedProducts.length === 0 ? (
                    <p className="mt-2 rounded-lg border border-dashed border-gray-300 px-3 py-4 text-center text-xs text-gray-400">Chưa có sản phẩm. Tìm và bấm “Thêm” để chọn.</p>
                  ) : (
                    <div className="mt-2 max-h-52 divide-y divide-gray-100 overflow-y-auto rounded-xl border border-gray-200">
                      {selectedProducts.map((product) => (
                        <div key={product.id} className="flex items-center gap-3 px-3 py-2">
                          <Check size={14} className="shrink-0 text-emerald-600" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm text-gray-800">{product.name}</p>
                            <p className="text-xs text-gray-500">{product.sku}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setForm((current) => ({ ...current, product_ids: current.product_ids.filter((id) => id !== product.id) }))}
                            className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                            aria-label={`Bỏ ${product.name}`}
                          >
                            <X size={15} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                    </>
                  )}
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-800">Điều kiện và ưu đãi</h3>
                  <button type="button" onClick={() => setForm({ ...form, rules: [...form.rules, emptyRule()] })} className="inline-flex items-center gap-1 text-xs font-medium text-sky-700"><Plus size={14} />Thêm điều kiện</button>
                </div>
                {form.rules.map((rule, index) => (
                  <div key={index} className="grid items-end gap-2 rounded-xl border border-gray-100 bg-gray-50 p-3 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="text-xs text-gray-600">Loại điều kiện
                      <select value={rule.trigger_type} onChange={(event) => updateRule(index, {
                        trigger_type: event.target.value as PromotionRule["trigger_type"],
                        min_quantity: event.target.value === "QUANTITY" ? 1 : null,
                        min_amount: event.target.value === "AMOUNT" ? 0 : null,
                      })} className={inputClass}>
                        <option value="QUANTITY">Theo số lượng</option><option value="AMOUNT">Theo giá trị đơn</option>
                      </select>
                    </label>
                    {rule.trigger_type === "QUANTITY" ? (
                      <>
                        <label className="text-xs text-gray-600">Đơn vị tính
                          <select value={rule.quantity_unit} onChange={(event) => updateRule(index, { quantity_unit: event.target.value as PromotionRule["quantity_unit"] })} className={inputClass}>
                            <option value="CARTON">Thùng</option><option value="BOX">Hộp</option>
                          </select>
                        </label>
                        <label className="text-xs text-gray-600">Số lượng tối thiểu
                          <input type="number" min={1} step={1} value={rule.min_quantity ?? 1}
                            onChange={(event) => updateRule(index, { min_quantity: Number(event.target.value) })}
                            className={inputClass} />
                        </label>
                      </>
                    ) : (
                      <label className="text-xs text-gray-600 sm:col-span-1">Giá trị đơn tối thiểu (đ)
                        <input type="number" min={0.01} step={1000} value={rule.min_amount ?? 0}
                          onChange={(event) => updateRule(index, { min_amount: Number(event.target.value) })}
                          className={inputClass} />
                      </label>
                    )}
                    <label className="text-xs text-gray-600">Loại ưu đãi
                      <select value={rule.reward_type} onChange={(event) => updateRule(index, { reward_type: event.target.value as PromotionRule["reward_type"] })} className={inputClass}>
                        <option value="FREE_QUANTITY">Tặng số lượng</option><option value="DISCOUNT_AMOUNT">Chiết khấu tiền</option><option value="DISCOUNT_PERCENT">Chiết khấu phần trăm</option>
                      </select>
                    </label>
                    <label className="text-xs text-gray-600">{rule.reward_type === "FREE_QUANTITY" ? "Số lượng tặng" : rule.reward_type === "DISCOUNT_PERCENT" ? "Phần trăm CK" : "Số tiền CK"}
                      <input type="number" min={rule.reward_type === "FREE_QUANTITY" ? 1 : 0} max={rule.reward_type === "DISCOUNT_PERCENT" ? 100 : undefined}
                        step={rule.reward_type === "FREE_QUANTITY" || rule.reward_type === "DISCOUNT_PERCENT" ? 1 : 1000}
                        value={rule.reward_value} onChange={(event) => updateRule(index, { reward_value: Number(event.target.value) })} className={inputClass} />
                    </label>
                    {rule.reward_type === "FREE_QUANTITY" && (
                      <label className="text-xs text-gray-600">Đơn vị quà tặng
                        <select value={rule.reward_unit} onChange={(event) => updateRule(index, { reward_unit: event.target.value as PromotionRule["reward_unit"] })} className={inputClass}>
                          <option value="BOX">Hộp</option><option value="CARTON">Thùng</option>
                        </select>
                      </label>
                    )}
                    <button type="button" disabled={form.rules.length <= 1} onClick={() => setForm({ ...form, rules: form.rules.filter((_, ruleIndex) => ruleIndex !== index) })} className="mb-1 rounded-lg p-2 text-red-500 hover:bg-red-50 disabled:opacity-30" aria-label="Xóa điều kiện"><Trash2 size={16} /></button>
                  </div>
                ))}
              </div>
            </fieldset>
            <div className="flex shrink-0 justify-end gap-2 border-t border-gray-100 bg-white px-5 py-4 sm:px-7">
              <button type="button" onClick={() => setDialog(null)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">{dialog === "view" ? "Đóng" : "Hủy"}</button>
              {dialog !== "view" && (
                <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-60">
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Lưu chương trình
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

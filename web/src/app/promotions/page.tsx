"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useState } from "react";
import { CalendarDays, Copy, Eye, Lock, LockOpen, Loader2, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { API_URL, apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ProductOption {
  id: number;
  sku: string;
  name: string;
}

interface PromotionRule {
  id?: number;
  trigger_type: "CARTON" | "AMOUNT";
  min_cartons: number | null;
  min_amount: number | null;
  reward_type: "FREE_QUANTITY" | "DISCOUNT_AMOUNT" | "DISCOUNT_PERCENT";
  reward_value: number;
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
  product_ids: number[];
  rules: PromotionRule[];
}

type PromotionForm = Omit<Promotion, "id" | "code" | "is_locked">;
type DialogMode = "create" | "edit" | "view" | null;

const emptyRule = (): PromotionRule => ({
  trigger_type: "CARTON",
  min_cartons: 1,
  min_amount: null,
  reward_type: "FREE_QUANTITY",
  reward_value: 1,
});

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
  const trigger = rule.trigger_type === "CARTON"
    ? `Mua từ ${rule.min_cartons ?? 1} thùng`
    : `Đơn từ ${Number(rule.min_amount ?? 0).toLocaleString("vi-VN")}đ`;
  const reward = rule.reward_type === "FREE_QUANTITY"
    ? `tặng ${rule.reward_value} hộp`
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<DialogMode>(null);
  const [selected, setSelected] = useState<Promotion | null>(null);
  const [form, setForm] = useState<PromotionForm>(newForm);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [promotionResponse, productResponse] = await Promise.all([
        apiFetch(`${API_URL}/promotions`),
        apiFetch(`${API_URL}/products/?limit=10000`),
      ]);
      if (!promotionResponse.ok) throw new Error(await responseError(promotionResponse, "Không thể tải chương trình khuyến mãi."));
      if (!productResponse.ok) throw new Error(await responseError(productResponse, "Không thể tải danh sách sản phẩm."));
      const promotionRows = await promotionResponse.json() as Promotion[];
      const productRows = await productResponse.json() as Array<Record<string, unknown>>;
      setPromotions(promotionRows);
      setProducts(productRows
        .filter((row) => row.status !== "inactive")
        .map((row) => ({ id: Number(row.id), sku: String(row.sku ?? ""), name: String(row.name ?? "") })));
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
      product_ids: [...promotion.product_ids],
      rules: promotion.rules.map((rule) => ({
        trigger_type: rule.trigger_type,
        min_cartons: rule.min_cartons,
        min_amount: rule.min_amount,
        reward_type: rule.reward_type,
        reward_value: rule.reward_value,
      })),
    });
    setDialog(mode);
  }

  async function savePromotion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.product_ids.length === 0) {
      setError("Vui lòng chọn ít nhất một sản phẩm áp dụng.");
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
        rules: form.rules.map((rule) => ({
          ...rule,
          min_cartons: rule.trigger_type === "CARTON" ? Number(rule.min_cartons ?? 1) : null,
          min_amount: rule.trigger_type === "AMOUNT" ? Number(rule.min_amount ?? 0) : null,
          reward_value: Number(rule.reward_value),
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
        actions={
          <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700">
            <Plus size={16} /> Tạo chương trình
          </button>
        }
      />
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white shadow-sm">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-gray-50 text-xs font-semibold text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left">Mã / Tên chương trình</th>
              <th className="px-4 py-3 text-left">Thời gian</th>
              <th className="px-4 py-3 text-left">Điều kiện / ưu đãi</th>
              <th className="px-4 py-3 text-center">Trạng thái</th>
              <th className="px-4 py-3 text-right">Chức năng</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-gray-400"><Loader2 className="mr-2 inline animate-spin" size={16} />Đang tải...</td></tr>
            ) : promotions.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-gray-400">Chưa có chương trình khuyến mãi.</td></tr>
            ) : promotions.map((promotion) => (
              <tr key={promotion.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <p className="font-semibold text-gray-900">{promotion.name}</p>
                  <p className="text-xs text-gray-500">{promotion.code}</p>
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
                    <button title="Sửa" disabled={promotion.is_locked} onClick={() => openExisting("edit", promotion)} className="rounded-md p-2 text-sky-700 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-40"><Pencil size={15} /></button>
                    <button title={promotion.is_locked ? "Mở khóa" : "Khóa"} onClick={() => void runAction(promotion, "lock")} className="rounded-md p-2 text-amber-700 hover:bg-amber-50">{promotion.is_locked ? <LockOpen size={15} /> : <Lock size={15} />}</button>
                    <button title="Tạo chương trình tương tự" onClick={() => void runAction(promotion, "clone")} className="rounded-md p-2 text-indigo-700 hover:bg-indigo-50"><Copy size={15} /></button>
                    <button title="Xóa" onClick={() => void runAction(promotion, "delete")} className="rounded-md p-2 text-red-600 hover:bg-red-50"><Trash2 size={15} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <form onSubmit={savePromotion} className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {dialog === "create" ? "Tạo chương trình khuyến mãi" : dialog === "edit" ? "Chỉnh sửa chương trình" : "Chi tiết chương trình"}
                </h2>
                {selected && <p className="text-xs text-gray-500">{selected.code}</p>}
              </div>
              <button type="button" onClick={() => setDialog(null)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100" aria-label="Đóng"><X size={18} /></button>
            </div>
            <fieldset disabled={dialog === "view" || saving} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-medium text-gray-600">Tên chương trình
                  <input required maxLength={160} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={inputClass} />
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
                <label className="text-xs font-medium text-gray-600 sm:col-span-2">Mô tả
                  <input maxLength={255} value={form.description ?? ""} onChange={(event) => setForm({ ...form, description: event.target.value })} className={inputClass} />
                </label>
                <label className="text-xs font-medium text-gray-600 sm:col-span-2">Sản phẩm áp dụng
                  <select multiple value={form.product_ids.map(String)} onChange={(event) => setForm({
                    ...form,
                    product_ids: Array.from(event.target.selectedOptions, (option) => Number(option.value)),
                  })} className={`${inputClass} min-h-32`}>
                    {products.map((product) => <option key={product.id} value={product.id}>{product.sku} - {product.name}</option>)}
                  </select>
                  <span className="mt-1 block font-normal text-gray-400">Giữ Ctrl để chọn nhiều sản phẩm.</span>
                </label>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-800">Điều kiện và ưu đãi</h3>
                  <button type="button" onClick={() => setForm({ ...form, rules: [...form.rules, emptyRule()] })} className="inline-flex items-center gap-1 text-xs font-medium text-sky-700"><Plus size={14} />Thêm điều kiện</button>
                </div>
                {form.rules.map((rule, index) => (
                  <div key={index} className="grid items-end gap-2 rounded-xl border border-gray-100 bg-gray-50 p-3 sm:grid-cols-[1.2fr_1fr_1.2fr_1fr_auto]">
                    <label className="text-xs text-gray-600">Điều kiện
                      <select value={rule.trigger_type} onChange={(event) => updateRule(index, {
                        trigger_type: event.target.value as PromotionRule["trigger_type"],
                        min_cartons: event.target.value === "CARTON" ? 1 : null,
                        min_amount: event.target.value === "AMOUNT" ? 0 : null,
                      })} className={inputClass}>
                        <option value="CARTON">Theo số thùng</option><option value="AMOUNT">Theo giá trị đơn</option>
                      </select>
                    </label>
                    <label className="text-xs text-gray-600">{rule.trigger_type === "CARTON" ? "Số thùng tối thiểu" : "Số tiền tối thiểu"}
                      <input type="number" min={rule.trigger_type === "CARTON" ? 1 : 0.01} step={rule.trigger_type === "CARTON" ? 1 : 1000}
                        value={rule.trigger_type === "CARTON" ? (rule.min_cartons ?? 1) : (rule.min_amount ?? 0)}
                        onChange={(event) => updateRule(index, rule.trigger_type === "CARTON" ? { min_cartons: Number(event.target.value) } : { min_amount: Number(event.target.value) })}
                        className={inputClass} />
                    </label>
                    <label className="text-xs text-gray-600">Ưu đãi
                      <select value={rule.reward_type} onChange={(event) => updateRule(index, { reward_type: event.target.value as PromotionRule["reward_type"] })} className={inputClass}>
                        <option value="FREE_QUANTITY">Tặng hộp</option><option value="DISCOUNT_AMOUNT">Chiết khấu tiền</option><option value="DISCOUNT_PERCENT">Chiết khấu phần trăm</option>
                      </select>
                    </label>
                    <label className="text-xs text-gray-600">{rule.reward_type === "FREE_QUANTITY" ? "Số hộp tặng" : rule.reward_type === "DISCOUNT_PERCENT" ? "Phần trăm CK" : "Số tiền CK"}
                      <input type="number" min={rule.reward_type === "FREE_QUANTITY" ? 1 : 0} max={rule.reward_type === "DISCOUNT_PERCENT" ? 100 : undefined}
                        step={rule.reward_type === "FREE_QUANTITY" || rule.reward_type === "DISCOUNT_PERCENT" ? 1 : 1000}
                        value={rule.reward_value} onChange={(event) => updateRule(index, { reward_value: Number(event.target.value) })} className={inputClass} />
                    </label>
                    <button type="button" disabled={form.rules.length <= 1} onClick={() => setForm({ ...form, rules: form.rules.filter((_, ruleIndex) => ruleIndex !== index) })} className="mb-1 rounded-lg p-2 text-red-500 hover:bg-red-50 disabled:opacity-30" aria-label="Xóa điều kiện"><Trash2 size={16} /></button>
                  </div>
                ))}
              </div>
            </fieldset>
            <div className="mt-5 flex justify-end gap-2">
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

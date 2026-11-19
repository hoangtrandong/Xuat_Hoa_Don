"use client";

import { useEffect, useState, useMemo } from "react";
import {
  Boxes,
  Plus,
  Search,
  Pencil,
  Trash2,
  RefreshCw,
  CheckCircle2,
  X,
  AlertCircle,
  Tag,
  Hash,
  FileCheck2,
  Loader2,
} from "lucide-react";
import { API_URL, apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

const inputCls =
  "w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-100";

interface SupplierDictItem {
  id: number;
  standard_name: string;
  short_code: string | null;
  tax_codes: string[];
  keywords: string[];
  notes: string | null;
  is_active: boolean;
  sku_count: number;
  created_at: string;
  updated_at: string;
}

export default function SupplierDictionaryPage() {
  const [items, setItems] = useState<SupplierDictItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState("");
  const [toastMessage, setToastMessage] = useState("");

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<SupplierDictItem | null>(null);
  const [formStandardName, setFormStandardName] = useState("");
  const [formShortCode, setFormShortCode] = useState("");
  const [formTaxCodes, setFormTaxCodes] = useState<string[]>([]);
  const [formKeywords, setFormKeywords] = useState<string[]>([]);
  const [formNotes, setFormNotes] = useState("");
  const [formIsActive, setFormIsActive] = useState(true);

  // Tag inputs
  const [taxInput, setTaxInput] = useState("");
  const [kwInput, setKwInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);

  // Delete State
  const [deletingItem, setDeletingItem] = useState<SupplierDictItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`${API_URL}/supplier-dictionaries/`);
      if (!res.ok) throw new Error("Không thể tải danh sách từ điển nhà cung cấp.");
      const data = (await res.json()) as SupplierDictItem[];
      setItems(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  function showToast(msg: string) {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(""), 4000);
  }

  function openCreateModal() {
    setEditingItem(null);
    setFormStandardName("");
    setFormShortCode("");
    setFormTaxCodes([]);
    setFormKeywords([]);
    setFormNotes("");
    setFormIsActive(true);
    setTaxInput("");
    setKwInput("");
    setModalOpen(true);
  }

  function openEditModal(item: SupplierDictItem) {
    setEditingItem(item);
    setFormStandardName(item.standard_name);
    setFormShortCode(item.short_code || "");
    setFormTaxCodes([...item.tax_codes]);
    setFormKeywords([...item.keywords]);
    setFormNotes(item.notes || "");
    setFormIsActive(item.is_active);
    setTaxInput("");
    setKwInput("");
    setModalOpen(true);
  }

  function handleAddTaxCode() {
    const val = taxInput.trim();
    if (val && !formTaxCodes.includes(val)) {
      setFormTaxCodes([...formTaxCodes, val]);
      setTaxInput("");
    }
  }

  function handleRemoveTaxCode(code: string) {
    setFormTaxCodes(formTaxCodes.filter((c) => c !== code));
  }

  function handleAddKeyword() {
    const val = kwInput.trim().toUpperCase();
    if (val && !formKeywords.includes(val)) {
      setFormKeywords([...formKeywords, val]);
      setKwInput("");
    }
  }

  function handleRemoveKeyword(kw: string) {
    setFormKeywords(formKeywords.filter((k) => k !== kw));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!formStandardName.trim()) {
      setError("Tên nhà cung cấp chuẩn không được để trống.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const payload = {
        standard_name: formStandardName.trim(),
        short_code: formShortCode.trim() || null,
        tax_codes: formTaxCodes,
        keywords: formKeywords,
        notes: formNotes.trim() || null,
        is_active: formIsActive,
      };

      const url = editingItem
        ? `${API_URL}/supplier-dictionaries/${editingItem.id}`
        : `${API_URL}/supplier-dictionaries/`;
      const method = editingItem ? "PUT" : "POST";

      const res = await apiFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Không thể lưu thông tin từ điển.");

      setModalOpen(false);
      showToast(editingItem ? `Đã cập nhật hãng ${data.standard_name}` : `Đã thêm hãng ${data.standard_name}`);
      void loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi khi lưu.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deletingItem) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`${API_URL}/supplier-dictionaries/${deletingItem.id}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) throw new Error("Không thể xóa nhà cung cấp.");
      setDeletingItem(null);
      showToast(`Đã xóa hãng ${deletingItem.standard_name} khỏi từ điển.`);
      void loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi khi xóa.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleApplyToProducts() {
    if (!confirm("Hệ thống sẽ quét toàn bộ danh mục sản phẩm và chuẩn hóa lại tên nhà cung cấp theo các quy tắc từ điển hiện tại. Bạn có muốn tiếp tục?")) {
      return;
    }
    setApplying(true);
    try {
      const res = await apiFetch(`${API_URL}/supplier-dictionaries/apply-to-products`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Lỗi khi áp dụng từ điển.");
      showToast(`Đã chuẩn hóa thành công ${data.updated_count} sản phẩm theo từ điển!`);
      void loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi khi áp dụng từ điển.");
    } finally {
      setApplying(false);
    }
  }

  // Filter
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.standard_name.toLowerCase().includes(q) ||
        (item.short_code && item.short_code.toLowerCase().includes(q)) ||
        item.tax_codes.some((tc) => tc.toLowerCase().includes(q)) ||
        item.keywords.some((kw) => kw.toLowerCase().includes(q))
    );
  }, [items, searchQuery]);

  const totalSkus = useMemo(() => items.reduce((sum, it) => sum + (it.sku_count || 0), 0), [items]);

  return (
    <div className="space-y-4">
      {/* Header compact enterprise */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-3">
        <div>
          <h1 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <Boxes className="text-sky-600" size={18} />
            <span>Từ Điển Nhà Cung Cấp & Quy Tắc Nhận Diện Tự Động</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Định nghĩa tên hiển thị chuẩn, mã số thuế CQT và từ khóa nhận diện từ đơn hàng DMS / hóa đơn điện tử
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleApplyToProducts}
            disabled={applying}
            className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white hover:bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition-colors disabled:bg-slate-100"
            title="Quét và đồng bộ lại toàn bộ sản phẩm theo từ điển"
          >
            {applying ? <Loader2 size={13} className="animate-spin" /> : <FileCheck2 size={13} className="text-emerald-600" />}
            <span>Áp dụng cho SKU</span>
          </button>

          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-1.5 rounded bg-sky-600 hover:bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors"
          >
            <Plus size={13} />
            <span>Thêm hãng mới</span>
          </button>
        </div>
      </div>

      {/* Thông báo Toast & Error */}
      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <AlertCircle size={14} className="shrink-0" />
            <span>{error}</span>
          </div>
          <button type="button" onClick={() => setError("")} className="text-red-500 hover:text-red-700">
            <X size={13} />
          </button>
        </div>
      )}

      {toastMessage && (
        <div className="rounded border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800 flex items-center gap-1.5">
          <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Thanh thống kê & Tìm kiếm */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50 p-2 rounded border border-slate-200 text-xs">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-slate-700">
            Tổng cộng: <strong className="text-sky-700">{items.length}</strong> nhà cung cấp
          </span>
          <span className="text-slate-400">|</span>
          <span className="font-semibold text-slate-700">
            Đang liên kết: <strong className="text-emerald-700">{totalSkus}</strong> SKU
          </span>
        </div>

        <div className="relative w-full sm:w-72">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Tìm theo tên hãng, MST, từ khóa..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={cn(inputCls, "pl-8 text-xs")}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Bảng dữ liệu Compact Enterprise theo GEMINI.md */}
      <div className="border border-slate-300 rounded bg-white overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-slate-100 text-[10px] font-semibold text-slate-600 uppercase border-b border-slate-200">
                <th className="py-2 px-3 w-12 text-center">STT</th>
                <th className="py-2 px-3 w-48">Tên nhà cung cấp chuẩn</th>
                <th className="py-2 px-3 w-28 text-center">Mã viết tắt</th>
                <th className="py-2 px-3 w-28 text-center">Số SKU</th>
                <th className="py-2 px-3 w-48">Mã số thuế CQT nhận diện</th>
                <th className="py-2 px-3">Từ khóa nhận diện tự động (Keywords)</th>
                <th className="py-2 px-3 w-24 text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-[11px]">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    <Loader2 size={18} className="animate-spin mx-auto mb-1 text-sky-600" />
                    <span>Đang nạp từ điển nhà cung cấp...</span>
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    Không tìm thấy nhà cung cấp nào phù hợp.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item, index) => (
                  <tr
                    key={item.id}
                    className="border-b border-slate-100 even:bg-amber-50/40 hover:bg-sky-50/50 transition-colors"
                  >
                    <td className="py-2 px-3 text-center text-slate-500 font-mono">{index + 1}</td>
                    <td className="py-2 px-3">
                      <div className="font-bold text-slate-800 text-xs">{item.standard_name}</div>
                      {item.notes && <div className="text-[10px] text-slate-400 truncate max-w-xs">{item.notes}</div>}
                    </td>
                    <td className="py-2 px-3 text-center font-mono font-semibold text-slate-700">
                      {item.short_code ? (
                        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px]">{item.short_code}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 px-3 text-center font-bold text-sky-800 font-mono">
                      {item.sku_count > 0 ? (
                        <span className="rounded bg-sky-100 text-sky-800 px-2 py-0.5 text-[10px]">
                          {item.sku_count} SKU
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[10px]">0 SKU</span>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      {item.tax_codes && item.tax_codes.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {item.tax_codes.map((tc) => (
                            <span
                              key={tc}
                              className="inline-flex items-center gap-1 rounded bg-slate-100 border border-slate-200 px-1.5 py-0.5 font-mono text-[10px] text-slate-700"
                            >
                              <Hash size={10} className="text-slate-400" />
                              {tc}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-400 text-[10px] italic">Chưa gán MST</span>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      {item.keywords && item.keywords.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {item.keywords.map((kw) => (
                            <span
                              key={kw}
                              className="inline-flex items-center gap-1 rounded bg-sky-50 border border-sky-200 px-1.5 py-0.5 text-[10px] font-medium text-sky-800"
                            >
                              <Tag size={9} className="text-sky-500" />
                              {kw}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-400 text-[10px] italic">Chưa có từ khóa</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEditModal(item)}
                          className="rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-sky-700 transition-colors"
                          title="Chỉnh sửa từ điển"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingItem(item)}
                          className="rounded p-1 text-slate-500 hover:bg-red-50 hover:text-red-600 transition-colors"
                          title="Xóa nhà cung cấp"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL THÊM / SỬA CHUẨN GEMINI.MD */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-xl rounded-md border border-slate-400 bg-white shadow-2xl overflow-hidden">
            {/* Header Modal */}
            <div className="bg-[#14263d] px-3 py-2 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Boxes size={17} className="text-red-500" />
                <span className="text-xs font-bold uppercase tracking-wide">
                  {editingItem ? `Chỉnh sửa nhà cung cấp: ${editingItem.standard_name}` : "Thêm nhà cung cấp mới"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded p-1 text-white hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </div>

            {/* Form Body */}
            <form onSubmit={handleSave}>
              <div className="p-3 space-y-3">
                <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2">
                  <div>
                    <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                      Tên chuẩn hiển thị <span className="text-red-600">*</span>
                    </label>
                    <input
                      required
                      type="text"
                      placeholder="VD: Hà Lan, Nabati, Masan..."
                      value={formStandardName}
                      onChange={(e) => setFormStandardName(e.target.value)}
                      className={cn(inputCls, "font-semibold")}
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                      Mã viết tắt (Short code)
                    </label>
                    <input
                      type="text"
                      placeholder="VD: HL, NBT, MSN..."
                      value={formShortCode}
                      onChange={(e) => setFormShortCode(e.target.value.toUpperCase())}
                      className={cn(inputCls, "font-mono uppercase")}
                    />
                  </div>
                </div>

                {/* Nhập MST CQT nhận diện */}
                <div className="border border-slate-200 rounded p-2 bg-slate-50/50">
                  <label className="text-[10px] font-semibold text-slate-700 block mb-1">
                    Mã số thuế (MST) nhận diện từ Hóa đơn điện tử CQT
                  </label>
                  <div className="flex gap-1.5 mb-2">
                    <input
                      type="text"
                      placeholder="Gõ MST rồi ấn Thêm..."
                      value={taxInput}
                      onChange={(e) => setTaxInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddTaxCode();
                        }
                      }}
                      className={cn(inputCls, "flex-1 font-mono")}
                    />
                    <button
                      type="button"
                      onClick={handleAddTaxCode}
                      className="rounded bg-slate-200 hover:bg-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700"
                    >
                      Thêm MST
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1 min-h-6">
                    {formTaxCodes.length === 0 ? (
                      <span className="text-[10px] text-slate-400 italic">Chưa có MST nào</span>
                    ) : (
                      formTaxCodes.map((tc) => (
                        <span
                          key={tc}
                          className="inline-flex items-center gap-1 rounded bg-white border border-slate-300 px-2 py-0.5 text-[11px] font-mono text-slate-800"
                        >
                          <Hash size={10} className="text-slate-400" />
                          {tc}
                          <button
                            type="button"
                            onClick={() => handleRemoveTaxCode(tc)}
                            className="text-slate-400 hover:text-red-500"
                          >
                            <X size={11} />
                          </button>
                        </span>
                      ))
                    )}
                  </div>
                </div>

                {/* Nhập Từ khóa nhận diện */}
                <div className="border border-slate-200 rounded p-2 bg-slate-50/50">
                  <label className="text-[10px] font-semibold text-slate-700 block mb-1">
                    Từ khóa nhận diện tự động (DMS / Đơn hàng / Hóa đơn)
                  </label>
                  <div className="flex gap-1.5 mb-2">
                    <input
                      type="text"
                      placeholder="Gõ từ khóa (VD: FRIESLAND, DUTCH LADY, HÀ LAN) rồi ấn Thêm..."
                      value={kwInput}
                      onChange={(e) => setKwInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddKeyword();
                        }
                      }}
                      className={cn(inputCls, "flex-1 uppercase font-semibold text-sky-900")}
                    />
                    <button
                      type="button"
                      onClick={handleAddKeyword}
                      className="rounded bg-sky-100 hover:bg-sky-200 text-sky-800 px-2.5 py-1 text-xs font-semibold"
                    >
                      Thêm từ khóa
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1 min-h-6">
                    {formKeywords.length === 0 ? (
                      <span className="text-[10px] text-slate-400 italic">Chưa có từ khóa nào</span>
                    ) : (
                      formKeywords.map((kw) => (
                        <span
                          key={kw}
                          className="inline-flex items-center gap-1 rounded bg-sky-50 border border-sky-300 px-2 py-0.5 text-[11px] font-semibold text-sky-900"
                        >
                          <Tag size={10} className="text-sky-600" />
                          {kw}
                          <button
                            type="button"
                            onClick={() => handleRemoveKeyword(kw)}
                            className="text-slate-400 hover:text-red-500"
                          >
                            <X size={11} />
                          </button>
                        </span>
                      ))
                    )}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                    Ghi chú pháp nhân / thông tin hãng
                  </label>
                  <input
                    type="text"
                    placeholder="VD: Công ty TNHH FrieslandCampina Việt Nam"
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>

              {/* Footer Modal Action Bar theo GEMINI.md */}
              <div className="border-t border-slate-300 bg-slate-100 px-3 py-2 flex items-center justify-between gap-3">
                <span className="text-[10px] text-slate-500">
                  Hệ thống tự động tra cứu từ điển khi đồng bộ hóa đơn & đơn hàng
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="rounded bg-red-700 hover:bg-red-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 rounded bg-sky-600 hover:bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                    <span>{editingItem ? "Lưu cập nhật" : "Tạo hãng mới"}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CONFIRM DELETE MODAL */}
      {deletingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-md border border-slate-400 bg-white shadow-2xl overflow-hidden">
            <div className="bg-[#14263d] px-3 py-2 text-white flex items-center justify-between">
              <span className="text-xs font-bold uppercase">Xác nhận xóa nhà cung cấp</span>
              <button
                type="button"
                onClick={() => setDeletingItem(null)}
                className="rounded p-1 text-white hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-4 text-xs text-slate-700 space-y-2">
              <p>
                Bạn có chắc chắn muốn xóa hãng <strong>{deletingItem.standard_name}</strong> khỏi từ điển?
              </p>
              {deletingItem.sku_count > 0 && (
                <p className="text-amber-700 bg-amber-50 p-2 rounded border border-amber-200">
                  ⚠️ Lưu ý: Đang có <strong>{deletingItem.sku_count} SKU</strong> mang tên nhà cung cấp này.
                </p>
              )}
            </div>
            <div className="border-t border-slate-300 bg-slate-100 px-3 py-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeletingItem(null)}
                className="rounded bg-slate-200 hover:bg-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
              >
                Đóng
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleDelete}
                className="rounded bg-red-700 hover:bg-red-800 px-3 py-1.5 text-xs font-semibold text-white"
              >
                {deleting ? "Đang xóa..." : "Xác nhận xóa"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

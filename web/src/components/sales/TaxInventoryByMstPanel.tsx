"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Building2, CheckCircle2, Loader2, RefreshCw, Search, ShieldAlert } from "lucide-react";
import { API_URL, apiFetch } from "@/lib/api";
import { formatNumber, formatVND } from "@/lib/format";

interface TaxInventoryRow {
  tax_code: string;
  company_name: string;
  sku: string;
  product_name: string;
  unit_name: string;
  vat_rate: number | null;
  input_qty: number;
  input_amount: number;
  output_qty: number;
  output_amount: number;
  adjustment_qty: number;
  balance_qty: number;
  status: "NEGATIVE" | "LOW" | "OK";
  other_mst_stocks: Array<{ tax_code: string; company_name: string; balance_qty: number }>;
}

interface TaxInventoryResponse {
  summary: {
    total_records: number;
    negative_count: number;
    low_count: number;
    ok_count: number;
    mst_count: number;
  };
  available_msts: Array<{ tax_code: string; company_name: string }>;
  items: TaxInventoryRow[];
}

const inputCls =
  "w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500";

export default function TaxInventoryByMstPanel({ distributorId }: { distributorId: number | null }) {
  const [data, setData] = useState<TaxInventoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedMst, setSelectedMst] = useState("");
  const [search, setSearch] = useState("");
  const [onlyNegative, setOnlyNegative] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (distributorId !== null) params.set("distributor_id", String(distributorId));
      if (selectedMst) params.set("company_tax_code", selectedMst);
      if (search.trim()) params.set("search", search.trim());
      if (onlyNegative) params.set("only_negative", "true");
      const res = await apiFetch(`${API_URL}/einvoice/tax-inventory?${params.toString()}`);
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(err.detail || "Không thể tải sổ tồn kho thuế.");
      }
      const json = (await res.json()) as TaxInventoryResponse;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi tải dữ liệu tồn kho thuế.");
    } finally {
      setLoading(false);
    }
  }, [distributorId, selectedMst, search, onlyNegative]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = data?.summary;
  const rows = data?.items ?? [];

  return (
    <div className="border border-slate-400 bg-white shadow-sm">
      <div className="bg-[#14263d] px-3 py-2 text-white flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Building2 size={16} className="text-red-500" />
          <span className="text-xs font-bold uppercase tracking-wide">
            Sổ Nhập – Xuất – Tồn Thuế Theo Từng Mã Số Thuế (MST)
          </span>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded bg-sky-600 hover:bg-sky-700 px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-60"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Làm mới
        </button>
      </div>

      {/* Thống kê tổng quan */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 border-b border-slate-200 px-3 py-2.5 bg-slate-50/70">
        <div className="rounded border border-slate-200 bg-white px-3 py-2">
          <div className="text-[10px] font-semibold uppercase text-slate-500">Tổng dòng (MST × SKU)</div>
          <div className="text-base font-bold text-slate-800">{formatNumber(summary?.total_records ?? 0)}</div>
          <div className="text-[10px] text-slate-400">{summary?.mst_count ?? 0} pháp nhân / MST</div>
        </div>
        <div className="rounded border border-red-200 bg-red-50/60 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase text-red-700 flex items-center gap-1">
            <ShieldAlert size={12} /> Âm kho thuế (Cần xử lý)
          </div>
          <div className="text-base font-bold text-red-700">{formatNumber(summary?.negative_count ?? 0)}</div>
          <div className="text-[10px] text-red-600">Xuất vượt đầu vào CQT</div>
        </div>
        <div className="rounded border border-amber-200 bg-amber-50/60 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase text-amber-800 flex items-center gap-1">
            <AlertTriangle size={12} /> Tồn thấp (≤ 5)
          </div>
          <div className="text-base font-bold text-amber-800">{formatNumber(summary?.low_count ?? 0)}</div>
          <div className="text-[10px] text-amber-700">Cần theo dõi nhập đầu vào</div>
        </div>
        <div className="rounded border border-emerald-200 bg-emerald-50/60 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase text-emerald-700 flex items-center gap-1">
            <CheckCircle2 size={12} /> Tồn an toàn
          </div>
          <div className="text-base font-bold text-emerald-700">{formatNumber(summary?.ok_count ?? 0)}</div>
          <div className="text-[10px] text-emerald-600">Đủ đầu vào để xuất HĐĐT</div>
        </div>
      </div>

      {/* Bộ lọc */}
      <div className="border-b border-slate-200 px-3 py-2.5 grid gap-x-3 gap-y-2 sm:grid-cols-2 xl:grid-cols-4 items-end">
        <div>
          <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
            Tìm theo Mã SKU / Tên hàng / MST
          </label>
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nhập SKU, tên sản phẩm hoặc MST..."
              className={`${inputCls} pl-6`}
            />
          </div>
        </div>

        <div>
          <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
            Lọc theo Pháp nhân / MST
          </label>
          <select
            value={selectedMst}
            onChange={(e) => setSelectedMst(e.target.value)}
            className={inputCls}
          >
            <option value="">Tất cả MST ({data?.available_msts.length ?? 0})</option>
            {(data?.available_msts ?? []).map((m) => (
              <option key={m.tax_code} value={m.tax_code}>
                [{m.tax_code}] {m.company_name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 pb-1">
          <input
            id="only-neg-tax"
            type="checkbox"
            checked={onlyNegative}
            onChange={(e) => setOnlyNegative(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300 text-red-600 focus:ring-red-500"
          />
          <label htmlFor="only-neg-tax" className="text-xs font-semibold text-red-700 cursor-pointer">
            Chỉ hiển thị SKU đang âm kho thuế
          </label>
        </div>
      </div>

      {error && (
        <div className="mx-3 my-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Bảng dữ liệu */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600 uppercase">
            <tr className="border-b border-slate-200">
              <th className="px-2.5 py-2">MST / Công ty quản lý</th>
              <th className="px-2.5 py-2">Mã SKU (CQT)</th>
              <th className="px-2.5 py-2">Tên hàng hóa</th>
              <th className="px-2 py-2 text-center">ĐVT / VAT</th>
              <th className="px-2.5 py-2 text-right">Nhập CQT</th>
              <th className="px-2.5 py-2 text-right">Xuất HĐĐT</th>
              <th className="px-2.5 py-2 text-right">Tồn kho thuế</th>
              <th className="px-2.5 py-2">Trạng thái &amp; Gợi ý</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-xs text-slate-500">
                  <span className="inline-flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin text-sky-600" /> Đang tính tồn kho thuế theo từng MST...
                  </span>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-xs text-slate-500">
                  Chưa có dữ liệu Nhập – Xuất Thuế khớp với bộ lọc.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={`${r.tax_code}::${r.sku}`}
                  className="border-b border-slate-100 even:bg-amber-50/40 hover:bg-sky-50/50 text-[11px]"
                >
                  <td className="px-2.5 py-1.5 max-w-[200px]">
                    <div className="font-mono font-bold text-slate-800">{r.tax_code}</div>
                    <div className="truncate text-[10px] text-slate-500" title={r.company_name}>
                      {r.company_name}
                    </div>
                  </td>
                  <td className="px-2.5 py-1.5 font-mono font-bold text-sky-800 whitespace-nowrap">
                    {r.sku}
                  </td>
                  <td className="px-2.5 py-1.5 text-slate-800 font-medium max-w-[260px] truncate" title={r.product_name}>
                    {r.product_name}
                  </td>
                  <td className="px-2 py-1.5 text-center whitespace-nowrap">
                    <span className="font-semibold text-slate-700">{r.unit_name || "—"}</span>
                    {r.vat_rate !== null && (
                      <span className="ml-1 rounded bg-violet-50 border border-violet-200 px-1 text-[9px] font-bold text-violet-700">
                        {r.vat_rate < 0 ? "KCT" : `${r.vat_rate}%`}
                      </span>
                    )}
                  </td>
                  <td className="px-2.5 py-1.5 text-right">
                    <div className="font-semibold text-emerald-700">{formatNumber(r.input_qty)}</div>
                    <div className="text-[10px] text-slate-400">{formatVND(r.input_amount)}</div>
                  </td>
                  <td className="px-2.5 py-1.5 text-right">
                    <div className="font-semibold text-slate-700">{formatNumber(r.output_qty)}</div>
                    {r.adjustment_qty !== 0 && (
                      <div className="text-[10px] text-sky-600" title="Số lượng đã hoàn qua HĐ điều chỉnh trả hàng">
                        ĐC trả: {formatNumber(r.adjustment_qty)}
                      </div>
                    )}
                  </td>
                  <td className="px-2.5 py-1.5 text-right font-bold whitespace-nowrap">
                    <span
                      className={
                        r.status === "NEGATIVE"
                          ? "text-red-700"
                          : r.status === "LOW"
                          ? "text-amber-700"
                          : "text-emerald-700"
                      }
                    >
                      {formatNumber(r.balance_qty)}
                    </span>
                  </td>
                  <td className="px-2.5 py-1.5">
                    {r.status === "NEGATIVE" ? (
                      <div className="space-y-0.5">
                        <span className="inline-flex items-center gap-1 rounded bg-red-100 border border-red-300 px-1.5 py-0.5 text-[10px] font-bold text-red-800">
                          <ShieldAlert size={11} /> Âm kho thuế
                        </span>
                        {r.other_mst_stocks.length > 0 && (
                          <div className="text-[10px] text-sky-700">
                            MST khác còn tồn:{" "}
                            {r.other_mst_stocks
                              .slice(0, 2)
                              .map((x) => `${x.tax_code} (+${formatNumber(x.balance_qty)})`)
                              .join(", ")}
                          </div>
                        )}
                      </div>
                    ) : r.status === "LOW" ? (
                      <span className="inline-flex items-center gap-1 rounded bg-amber-100 border border-amber-300 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                        Sắp hết tồn
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded bg-emerald-100 border border-emerald-200 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                        Đủ đầu vào
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

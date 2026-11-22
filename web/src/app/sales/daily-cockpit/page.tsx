"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Database,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { API_URL, apiFetch } from "@/lib/api";
import { useDistributorContext } from "@/lib/distributor-context";

const inputCls =
  "w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-100";

interface TaxCredential {
  id: number;
  username: string | null;
  last_synced_at: string | null;
  has_token?: boolean;
}

interface ConsolidationSummary {
  total_groups: number;
  valid_groups: number;
  invalid_groups: number;
  total_orders: number;
  total_amount: number;
}

interface ReconciliationRow {
  id: number;
  seller_tax_code: string | null;
  invoice_series: string | null;
  invoice_number: string | null;
  tax_authority_code: string | null;
  status: string;
  provider: string;
  buyer_name: string;
  buyer_tax_code: string | null;
  total_payment: number;
  source_order_numbers: string[];
  issued_at: string | null;
  created_at: string | null;
}

interface ReconciliationReport {
  summary: {
    reconciled_count: number;
    cqt_only_count: number;
    pending_drafts_count: number;
    cancelled_or_replaced_count: number;
    reconciled_amount: number;
    cqt_only_amount: number;
    pending_drafts_amount: number;
  };
  reconciled: ReconciliationRow[];
  cqt_only: ReconciliationRow[];
  pending_drafts: ReconciliationRow[];
  cancelled_or_replaced: ReconciliationRow[];
}

interface MonthlySnapshotItem {
  id: number;
  tax_code: string;
  company_name: string;
  sku: string;
  product_name: string;
  unit_name: string;
  opening_qty: number;
  input_qty: number;
  output_qty: number;
  promo_in_qty: number;
  promo_out_qty: number;
  promo_balance_qty: number;
  avg_unit_cost: number;
  cogs_amount: number;
  closing_qty: number;
  closing_amount: number;
}

interface MonthlySnapshotResponse {
  year_month: string;
  computed_at: string | null;
  summary: {
    total_skus: number;
    negative_count: number;
    total_opening_amount: number;
    total_input_amount: number;
    total_output_amount: number;
    total_cogs_amount: number;
    total_closing_amount: number;
  };
  items: MonthlySnapshotItem[];
}

function fmtMoney(v: number | null | undefined): string {
  return Math.round(Number(v || 0)).toLocaleString("vi-VN");
}

function fmtQty(v: number | null | undefined): string {
  return Number(v || 0).toLocaleString("vi-VN", { maximumFractionDigits: 2 });
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthStartIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function DailyInvoicingCockpitPage() {
  const { effectiveDistributorId: selectedDistributorId } = useDistributorContext();

  const [fromDate, setFromDate] = useState<string>(monthStartIso);
  const [toDate, setToDate] = useState<string>(todayIso);
  const [yearMonth, setYearMonth] = useState<string>(currentYearMonth);

  const [credentials, setCredentials] = useState<TaxCredential[]>([]);
  const [selectedCredId, setSelectedCredId] = useState<string>("");

  const [consolidation, setConsolidation] = useState<ConsolidationSummary | null>(null);
  const [reconcile, setReconcile] = useState<ReconciliationReport | null>(null);
  const [reconcileTab, setReconcileTab] = useState<"pending" | "reconciled" | "cqt_only">("pending");
  const [snapshot, setSnapshot] = useState<MonthlySnapshotResponse | null>(null);

  const [loadingAll, setLoadingAll] = useState(false);
  const [syncingSold, setSyncingSold] = useState(false);
  const [rebuildingSnap, setRebuildingSnap] = useState(false);
  const [banner, setBanner] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const loadCockpitData = useCallback(async () => {
    setLoadingAll(true);
    setBanner(null);
    try {
      const distQuery = selectedDistributorId ? `&distributor_id=${selectedDistributorId}` : "";
      const [credRes, consRes, recRes, snapRes] = await Promise.all([
        apiFetch(`${API_URL}/einvoice/tax-credentials?${distQuery.replace(/^&/, "")}`),
        apiFetch(
          `${API_URL}/einvoice/dms-consolidation?from_date=${fromDate}&to_date=${toDate}${distQuery}`
        ),
        apiFetch(
          `${API_URL}/einvoice/gdt-sold-invoices/reconciliation-report?from_date=${fromDate}&to_date=${toDate}${distQuery}`
        ),
        apiFetch(
          `${API_URL}/einvoice/tax-inventory/monthly-snapshots?year_month=${yearMonth}${distQuery}`
        ),
      ]);

      if (credRes.ok) {
        const credJson = await credRes.json();
        const list: TaxCredential[] = Array.isArray(credJson)
          ? credJson
          : credJson.items || credJson.credentials || [];
        setCredentials(list);
        setSelectedCredId((prev) => prev || (list[0] ? String(list[0].id) : ""));
      }

      if (consRes.ok) {
        const consJson = await consRes.json();
        const s = consJson.summary || {};
        setConsolidation({
          total_groups: s.total_groups ?? (consJson.groups?.length || 0),
          valid_groups: s.valid_groups ?? 0,
          invalid_groups: s.invalid_groups ?? 0,
          total_orders: s.total_orders ?? 0,
          total_amount: s.total_payment ?? s.total_amount ?? 0,
        });
      }

      if (recRes.ok) {
        setReconcile(await recRes.json());
      }

      if (snapRes.ok) {
        setSnapshot(await snapRes.json());
      }
    } catch (err) {
      setBanner({
        type: "err",
        text: err instanceof Error ? err.message : "Không thể tải dữ liệu Trạm Xuất Hóa Đơn.",
      });
    } finally {
      setLoadingAll(false);
    }
  }, [selectedDistributorId, fromDate, toDate, yearMonth]);

  useEffect(() => {
    loadCockpitData();
  }, [loadCockpitData]);

  const handleSyncSoldInvoices = async () => {
    if (!selectedCredId) {
      setBanner({
        type: "err",
        text: "Vui lòng chọn Tài khoản Cổng CQT (MST) trước khi đồng bộ hóa đơn bán ra.",
      });
      return;
    }
    setSyncingSold(true);
    setBanner(null);
    try {
      const res = await apiFetch(`${API_URL}/einvoice/gdt-sold-invoices/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          distributor_id: selectedDistributorId || undefined,
          tax_credential_id: Number(selectedCredId),
          from_date: fromDate,
          to_date: toDate,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Đồng bộ hóa đơn bán ra CQT thất bại.");
      }
      setBanner({
        type: "ok",
        text: `Đã đồng bộ ${data.total_cqt_invoices} HĐ bán ra từ CQT: khớp ${data.matched_drafts} lô Excel/Nháp, tạo mới ${data.created_from_cqt} HĐ lập trực tiếp, còn ${data.pending_drafts_count} DRAFT chưa ký.`,
      });
      await loadCockpitData();
    } catch (err) {
      setBanner({
        type: "err",
        text: err instanceof Error ? err.message : "Lỗi đồng bộ HĐ bán ra CQT.",
      });
    } finally {
      setSyncingSold(false);
    }
  };

  const handleRebuildSnapshot = async () => {
    setRebuildingSnap(true);
    setBanner(null);
    try {
      const res = await apiFetch(`${API_URL}/einvoice/tax-inventory/monthly-snapshots/rebuild`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          distributor_id: selectedDistributorId || undefined,
          year_month: yearMonth,
          include_draft: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Không thể tính lại Snapshot Kho Thuế tháng.");
      }
      setBanner({
        type: "ok",
        text: `Đã tính & chốt Snapshot Kho Thuế tháng ${yearMonth} (${data.upserted_rows} dòng SKU theo chuẩn BQGQ tháng).`,
      });
      await loadCockpitData();
    } catch (err) {
      setBanner({
        type: "err",
        text: err instanceof Error ? err.message : "Lỗi tính Snapshot Kho Thuế tháng.",
      });
    } finally {
      setRebuildingSnap(false);
    }
  };

  const activeReconcileRows: ReconciliationRow[] =
    reconcileTab === "pending"
      ? reconcile?.pending_drafts || []
      : reconcileTab === "reconciled"
      ? reconcile?.reconciled || []
      : reconcile?.cqt_only || [];

  return (
    <div className="space-y-3 p-3">
      {/* Khung chính chuẩn Compact Enterprise (CreateOrderForm standard) */}
      <div className="border border-slate-400 bg-white shadow-lg">
        {/* 1. Header chuẩn #14263d */}
        <div className="flex items-center justify-between bg-[#14263d] px-3 py-2 text-white">
          <div className="flex items-center gap-2">
            <ClipboardCheck size={17} className="text-red-500" />
            <h1 className="text-xs font-bold uppercase tracking-wide text-white">
              TRẠM XUẤT HÓA ĐƠN & ĐỐI CHIẾU CQT HÀNG NGÀY (VÒNG KÍN THUẾ)
            </h1>
          </div>
          <button
            type="button"
            onClick={loadCockpitData}
            disabled={loadingAll}
            className="inline-flex items-center gap-1.5 rounded bg-sky-600 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-sky-700 disabled:bg-slate-400"
          >
            {loadingAll ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Làm mới dữ liệu
          </button>
        </div>

        {/* Bộ lọc kỳ làm việc */}
        <div className="border-b border-slate-200 px-3 py-2.5">
          <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                Từ ngày (Đơn DMS & Đối chiếu CQT)
              </label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                Đến ngày
              </label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                Tài khoản Cổng CQT (MST bán ra)
              </label>
              <select
                value={selectedCredId}
                onChange={(e) => setSelectedCredId(e.target.value)}
                className={inputCls}
              >
                <option value="">-- Chọn MST CQT --</option>
                {credentials.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    MST {c.username || `#${c.id}`}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                Tháng Snapshot Kho Thuế (TK 156/632)
              </label>
              <input
                type="month"
                value={yearMonth}
                onChange={(e) => setYearMonth(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          {banner && (
            <div
              className={`mt-2.5 flex items-center gap-2 rounded border px-2.5 py-1.5 text-xs ${
                banner.type === "ok"
                  ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                  : "border-red-300 bg-red-50 text-red-800"
              }`}
            >
              {banner.type === "ok" ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
              <span>{banner.text}</span>
            </div>
          )}
        </div>

        {/* 4 BƯỚC QUY TRÌNH HÀNG NGÀY */}
        <div className="border-b border-sky-100 bg-sky-50/60 px-3 py-2 text-[11px] font-bold uppercase text-sky-800">
          Quy trình 4 bước hàng ngày cho Kế toán Hóa đơn & Thuế
        </div>
        <div className="grid gap-3 border-b border-slate-200 px-3 py-2.5 sm:grid-cols-2 xl:grid-cols-4">
          {/* Bước 1 */}
          <div className="rounded border border-slate-200 bg-slate-50/60 p-2.5">
            <div className="text-[10px] font-bold uppercase text-sky-700">Bước 1 · Đồng bộ nguồn</div>
            <div className="mt-1 text-xs font-semibold text-slate-800">
              Cập nhật Đơn DMS & HĐ Mua vào CQT
            </div>
            <p className="mt-1 text-[11px] text-slate-600">
              Đảm bảo tồn kho đầu vào CQT và đơn bán ra mới nhất trước khi gom hóa đơn.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Link
                href="/sales/orders"
                className="inline-flex items-center gap-1 rounded bg-white border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
              >
                Đơn DMS <ArrowRight size={11} />
              </Link>
              <Link
                href="/sales/purchase-invoices"
                className="inline-flex items-center gap-1 rounded bg-white border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
              >
                HĐ Mua vào CQT <ArrowRight size={11} />
              </Link>
            </div>
          </div>

          {/* Bước 2 */}
          <div className="rounded border border-slate-200 bg-slate-50/60 p-2.5">
            <div className="text-[10px] font-bold uppercase text-sky-700">
              Bước 2 · Tiền kiểm & Xuất Excel Viettel
            </div>
            <div className="mt-1 text-xs font-semibold text-slate-800">
              {consolidation
                ? `${consolidation.valid_groups}/${consolidation.total_groups} nhóm HĐ hợp lệ`
                : "Đang tải tiền kiểm..."}
            </div>
            <p className="mt-1 text-[11px] text-slate-600">
              {consolidation && consolidation.invalid_groups > 0 ? (
                <span className="font-semibold text-amber-700">
                  Cảnh báo: {consolidation.invalid_groups} nhóm thiếu MST/SKU cần xử lý trước khi xuất.
                </span>
              ) : (
                "Gom theo Công ty bán & MST/CCCD, xuất file .xls chuẩn Viettel S-Invoice."
              )}
            </p>
            <div className="mt-2">
              <Link
                href="/sales/invoices"
                className="inline-flex items-center gap-1 rounded bg-sky-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-sky-700"
              >
                <FileSpreadsheet size={12} /> Mở Gom đơn & Xuất Excel
              </Link>
            </div>
          </div>

          {/* Bước 3 */}
          <div className="rounded border border-slate-200 bg-slate-50/60 p-2.5">
            <div className="text-[10px] font-bold uppercase text-sky-700">
              Bước 3 · Đồng bộ ngược HĐ Bán ra CQT
            </div>
            <div className="mt-1 text-xs font-semibold text-slate-800">
              Đối chiếu 3 chiều (Không cần mua API)
            </div>
            <p className="mt-1 text-[11px] text-slate-600">
              Tự khớp lô đã xuất Excel với HĐ đã ký số trên Viettel, cập nhật Số HĐ & Mã CQT thật.
            </p>
            <div className="mt-2">
              <button
                type="button"
                onClick={handleSyncSoldInvoices}
                disabled={syncingSold}
                className="inline-flex items-center gap-1.5 rounded bg-sky-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-sky-700 disabled:bg-slate-300"
              >
                {syncingSold ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <ShieldCheck size={12} />
                )}
                Đồng bộ HĐ bán ra CQT
              </button>
            </div>
          </div>

          {/* Bước 4 */}
          <div className="rounded border border-slate-200 bg-slate-50/60 p-2.5">
            <div className="text-[10px] font-bold uppercase text-sky-700">
              Bước 4 · Snapshot Kho Thuế Tháng
            </div>
            <div className="mt-1 text-xs font-semibold text-slate-800">
              BQGQ chuẩn theo tháng & tách Hàng KM
            </div>
            <p className="mt-1 text-[11px] text-slate-600">
              {snapshot?.computed_at
                ? `Đã chốt ${snapshot.summary.total_skus} SKU (tồn âm: ${snapshot.summary.negative_count}).`
                : `Chưa có snapshot cho tháng ${yearMonth}.`}
            </p>
            <div className="mt-2">
              <button
                type="button"
                onClick={handleRebuildSnapshot}
                disabled={rebuildingSnap}
                className="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:bg-slate-300"
              >
                {rebuildingSnap ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Database size={12} />
                )}
                Tính & Lưu Snapshot {yearMonth}
              </button>
            </div>
          </div>
        </div>

        {/* PHẦN BẢNG ĐỐI CHIẾU 3 CHIỀU CQT BÁN RA */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-100 bg-sky-50/60 px-3 py-2">
          <span className="text-[11px] font-bold uppercase text-sky-800">
            Kết quả Đối chiếu Hóa đơn Bán ra (Excel Draft ↔ Cổng CQT)
          </span>
          <div className="flex items-center gap-1.5 text-[11px]">
            <button
              type="button"
              onClick={() => setReconcileTab("pending")}
              className={`rounded px-2 py-0.5 font-semibold ${
                reconcileTab === "pending"
                  ? "bg-amber-600 text-white"
                  : "bg-white text-slate-700 border border-slate-300"
              }`}
            >
              DRAFT chưa ký CQT ({reconcile?.summary.pending_drafts_count ?? 0})
            </button>
            <button
              type="button"
              onClick={() => setReconcileTab("reconciled")}
              className={`rounded px-2 py-0.5 font-semibold ${
                reconcileTab === "reconciled"
                  ? "bg-emerald-600 text-white"
                  : "bg-white text-slate-700 border border-slate-300"
              }`}
            >
              Đã khớp CQT ({reconcile?.summary.reconciled_count ?? 0})
            </button>
            <button
              type="button"
              onClick={() => setReconcileTab("cqt_only")}
              className={`rounded px-2 py-0.5 font-semibold ${
                reconcileTab === "cqt_only"
                  ? "bg-sky-600 text-white"
                  : "bg-white text-slate-700 border border-slate-300"
              }`}
            >
              Lập trực tiếp trên Viettel/CQT ({reconcile?.summary.cqt_only_count ?? 0})
            </button>
          </div>
        </div>

        <div className="overflow-x-auto border-b border-slate-200">
          <table className="w-full border-collapse text-left">
            <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600">
              <tr>
                <th className="px-2.5 py-1.5">MST Bán</th>
                <th className="px-2.5 py-1.5">Ký hiệu / Số HĐ</th>
                <th className="px-2.5 py-1.5">Mã CQT</th>
                <th className="px-2.5 py-1.5">Khách hàng (MST Mua)</th>
                <th className="px-2.5 py-1.5">Đơn DMS nguồn</th>
                <th className="px-2.5 py-1.5 text-right">Tổng thanh toán</th>
                <th className="px-2.5 py-1.5 text-center">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {activeReconcileRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-4 text-center text-xs text-slate-500">
                    Không có bản ghi nào trong nhóm này cho kỳ {fromDate} → {toDate}.
                  </td>
                </tr>
              ) : (
                activeReconcileRows.slice(0, 30).map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-slate-100 text-[11px] even:bg-amber-50/40 hover:bg-sky-50/50"
                  >
                    <td className="px-2.5 py-1.5 font-mono text-slate-700">{r.seller_tax_code || "-"}</td>
                    <td className="px-2.5 py-1.5 font-semibold text-slate-800">
                      {r.invoice_number ? `${r.invoice_series || ""} · ${r.invoice_number}` : "(Chưa cấp số)"}
                    </td>
                    <td className="px-2.5 py-1.5 font-mono text-[10px] text-slate-600">
                      {r.tax_authority_code || "-"}
                    </td>
                    <td className="px-2.5 py-1.5">
                      <div className="font-medium text-slate-800">{r.buyer_name}</div>
                      {r.buyer_tax_code && (
                        <div className="text-[10px] text-slate-500">MST: {r.buyer_tax_code}</div>
                      )}
                    </td>
                    <td className="px-2.5 py-1.5 text-[10px] text-slate-600">
                      {r.source_order_numbers?.length ? r.source_order_numbers.join(", ") : "-"}
                    </td>
                    <td className="px-2.5 py-1.5 text-right font-medium text-slate-700">
                      {fmtMoney(r.total_payment)}
                    </td>
                    <td className="px-2.5 py-1.5 text-center">
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          r.status === "ISSUED"
                            ? "bg-emerald-100 text-emerald-700"
                            : r.status === "DRAFT"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* PHẦN SNAPSHOT KHO THUẾ THÁNG (TỐC ĐỘ TỨC THÌ + TÁCH HÀNG KM) */}
        <div className="flex items-center justify-between border-b border-sky-100 bg-sky-50/60 px-3 py-2">
          <span className="text-[11px] font-bold uppercase text-sky-800">
            Snapshot Kho Thuế Tháng {yearMonth} (TK 156 / Giá vốn BQGQ Tháng TK 632 & Hàng KM TChat=2)
          </span>
          <span className="text-[10px] text-slate-600">
            {snapshot?.computed_at ? `Cập nhật lúc: ${snapshot.computed_at.slice(0, 19).replace("T", " ")}` : "Chưa chốt"}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600">
              <tr>
                <th className="px-2.5 py-1.5">MST</th>
                <th className="px-2.5 py-1.5">Mã SKU</th>
                <th className="px-2.5 py-1.5">Tên sản phẩm</th>
                <th className="px-2.5 py-1.5 text-center">Tồn đầu</th>
                <th className="px-2.5 py-1.5 text-center">Nhập TM</th>
                <th className="px-2.5 py-1.5 text-center">Xuất TM</th>
                <th className="px-2.5 py-1.5 text-center">Tồn cuối TM</th>
                <th className="px-2.5 py-1.5 text-center">Hàng KM (N/X/T)</th>
                <th className="px-2.5 py-1.5 text-right">ĐG BQGQ</th>
                <th className="px-2.5 py-1.5 text-right">Giá vốn TK 632</th>
                <th className="px-2.5 py-1.5 text-right">Trị giá TK 156</th>
              </tr>
            </thead>
            <tbody>
              {!snapshot || snapshot.items.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-3 py-4 text-center text-xs text-slate-500">
                    Chưa có dữ liệu Snapshot cho tháng {yearMonth}. Bấm &ldquo;Tính &amp; Lưu Snapshot {yearMonth}&rdquo; ở Bước 4 để chốt nhanh.
                  </td>
                </tr>
              ) : (
                snapshot.items.slice(0, 50).map((it) => (
                  <tr
                    key={it.id}
                    className="border-b border-slate-100 text-[11px] even:bg-amber-50/40 hover:bg-sky-50/50"
                  >
                    <td className="px-2.5 py-1.5 font-mono text-slate-700">{it.tax_code}</td>
                    <td className="px-2.5 py-1.5 font-semibold text-slate-800">{it.sku}</td>
                    <td className="px-2.5 py-1.5 text-slate-700">{it.product_name}</td>
                    <td className="px-2.5 py-1.5 text-center font-semibold">{fmtQty(it.opening_qty)}</td>
                    <td className="px-2.5 py-1.5 text-center font-semibold text-emerald-700">
                      {fmtQty(it.input_qty)}
                    </td>
                    <td className="px-2.5 py-1.5 text-center font-semibold text-sky-700">
                      {fmtQty(it.output_qty)}
                    </td>
                    <td
                      className={`px-2.5 py-1.5 text-center font-semibold ${
                        it.closing_qty < 0 ? "text-red-700" : "text-slate-800"
                      }`}
                    >
                      {fmtQty(it.closing_qty)}
                    </td>
                    <td className="px-2.5 py-1.5 text-center text-[10px] text-purple-700">
                      {fmtQty(it.promo_in_qty)} / {fmtQty(it.promo_out_qty)} / {fmtQty(it.promo_balance_qty)}
                    </td>
                    <td className="px-2.5 py-1.5 text-right font-medium text-slate-700">
                      {fmtMoney(it.avg_unit_cost)}
                    </td>
                    <td className="px-2.5 py-1.5 text-right font-medium text-slate-700">
                      {fmtMoney(it.cogs_amount)}
                    </td>
                    <td className="px-2.5 py-1.5 text-right font-medium text-slate-700">
                      {fmtMoney(it.closing_amount)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {snapshot && snapshot.items.length > 0 && (
              <tfoot className="border-t border-slate-200 bg-slate-50 text-[10px] font-semibold text-slate-600">
                <tr>
                  <td colSpan={9} className="px-2.5 py-1.5 text-right">
                    Tổng cộng ({snapshot.summary.total_skus} SKU):
                  </td>
                  <td className="px-2.5 py-1.5 text-right text-slate-800">
                    {fmtMoney(snapshot.summary.total_cogs_amount)}
                  </td>
                  <td className="px-2.5 py-1.5 text-right text-slate-800">
                    {fmtMoney(snapshot.summary.total_closing_amount)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* Footer Action Bar chuẩn GEMINI.md */}
        <div className="flex items-center justify-between gap-3 border-t border-slate-300 bg-slate-100 px-3 py-2">
          <span className="text-[10px] text-slate-500">
            Chuẩn quyết toán NĐ 123/2020 &amp; TT 200/133 · Vòng kín CQT không tốn phí API · Hàng KM (TChat=2) tách riêng khỏi đơn giá BQGQ TK 156.
          </span>
          <div className="flex items-center gap-2">
            <Link
              href="/sales/invoices"
              className="inline-flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-700"
            >
              <CheckCircle2 size={13} /> Đi tới Xuất Hóa Đơn ĐT
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";
// src/app/sales/summary/page.tsx
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeftRight, Download, RotateCcw, TrendingUp, ShoppingCart } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import DataTable, { Column } from "@/components/ui/DataTable";
import { formatVND } from "@/lib/format";
import { API_URL, apiFetch } from "@/lib/api";
import * as XLSX from "xlsx";

type GroupBy = "product" | "customer" | "staff" | "day" | "promotion";
type Tab = GroupBy | "pairs" | "review";

type Totals = {
  sold_qty: number; sold_promo_qty: number; sold_value: number;
  deducted_qty: number; deducted_promo_qty: number; deducted_value: number;
  net_qty: number; net_promo_qty: number; net_value: number;
};
type Group = Totals & { key: string; code: string; name: string };
type Pair = {
  replaced_order_number: string; new_order_number: string; date: string | null;
  customer_code: string | null; customer_name: string | null;
  replaced_qty: number; replaced_value: number; new_qty: number | null; new_value: number | null;
  diff_qty: number | null; diff_value: number | null; replaced_returned: boolean; new_found: boolean;
};
type ReviewItem = {
  type: string; message: string; order_number: string; related_order_number: string;
  date: string | null; customer_code: string | null; customer_name: string | null; qty: number; value: number;
};
type Summary = {
  totals: Totals; groups: Group[]; pairs: Pair[]; review: ReviewItem[]; unknown_state_rows: number; detail?: string;
};

const GROUP_TABS: { key: GroupBy; label: string; codeTitle: string; nameTitle: string }[] = [
  { key: "product", label: "Theo sản phẩm", codeTitle: "Mã sản phẩm", nameTitle: "Sản phẩm" },
  { key: "customer", label: "Theo khách hàng", codeTitle: "Mã KH", nameTitle: "Tên KH" },
  { key: "staff", label: "Theo NVBH", codeTitle: "Mã NVBH", nameTitle: "Tên NVBH" },
  { key: "day", label: "Theo ngày", codeTitle: "Ngày", nameTitle: "" },
  { key: "promotion", label: "Theo chương trình khuyến mại", codeTitle: "Mã CTKM", nameTitle: "Tên CTKM" },
];

const REVIEW_LABELS: Record<string, string> = {
  replaced_not_returned: "Bị thay thế, chưa trả",
  replaced_order_missing: "Thiếu đơn cũ",
};

function toInputDate(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function formatDay(value: string | null) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

const formatQty = (value: number | null | undefined) =>
  value == null ? "" : value.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
const formatMoney = (value: number | null | undefined) => (value == null ? "" : formatVND(value));
const shortCustomer = (code: string | null | undefined) => (code ?? "").trim().slice(-3);

export default function SalesSummaryPage() {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const [fromDate, setFromDate] = useState(toInputDate(monthStart));
  const [toDate, setToDate] = useState(toInputDate(today));
  const [customer, setCustomer] = useState("");
  const [staff, setStaff] = useState("");
  const [product, setProduct] = useState("");
  const [tab, setTab] = useState<Tab>("product");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const groupBy: GroupBy = GROUP_TABS.some((item) => item.key === tab) ? (tab as GroupBy) : "product";

  const load = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ from_date: fromDate, to_date: toDate, group_by: groupBy });
      if (customer.trim()) params.set("customer", customer.trim());
      if (staff.trim()) params.set("staff", staff.trim());
      if (product.trim()) params.set("product", product.trim());
      const response = await apiFetch(`${API_URL}/sync/vinamilk-orders/summary?${params.toString()}`);
      const payload = await response.json() as Summary;
      if (!response.ok) throw new Error(typeof payload.detail === "string" ? payload.detail : "Không thể tải dữ liệu tổng hợp.");
      setSummary(payload);
    } catch (loadError) {
      setSummary(null);
      setError(loadError instanceof Error ? loadError.message : "Không thể tải dữ liệu tổng hợp.");
    } finally {
      setIsLoading(false);
    }
  }, [fromDate, toDate, groupBy, customer, staff, product]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 300);
    return () => window.clearTimeout(timer);
  }, [load]);

  const activeGroupTab = GROUP_TABS.find((item) => item.key === groupBy) ?? GROUP_TABS[0];
  const numberColumns: Column<Group>[] = [
    { key: "sold_qty", title: "SL bán", sortable: true, align: "right", render: (v) => formatQty(v as number) },
    { key: "deducted_qty", title: "SL trừ", sortable: true, align: "right", render: (v) => (
      <span className={(v as number) > 0 ? "text-rose-600" : ""}>{formatQty(v as number)}</span>
    ) },
    { key: "net_qty", title: "SL thực", sortable: true, align: "right", render: (v) => <strong>{formatQty(v as number)}</strong> },
    { key: "net_promo_qty", title: "SL KM thực", sortable: true, align: "right", render: (v) => formatQty(v as number) },
    { key: "sold_value", title: "Giá trị bán", sortable: true, align: "right", render: (v) => formatMoney(v as number) },
    { key: "deducted_value", title: "Giá trị trừ", sortable: true, align: "right", render: (v) => (
      <span className={(v as number) > 0 ? "text-rose-600" : ""}>{formatMoney(v as number)}</span>
    ) },
    { key: "net_value", title: "Giá trị thực", sortable: true, align: "right", render: (v) => <strong>{formatMoney(v as number)}</strong> },
  ];
  const groupColumns: Column<Group>[] = [
    {
      key: "code",
      title: activeGroupTab.codeTitle,
      sortable: true,
      render: (value) => (groupBy === "day" ? formatDay(String(value)) : groupBy === "customer" ? shortCustomer(String(value)) : String(value)),
    },
    ...(activeGroupTab.nameTitle ? [{ key: "name", title: activeGroupTab.nameTitle, sortable: true } as Column<Group>] : []),
    ...numberColumns,
  ];

  const pairColumns: Column<Pair>[] = [
    { key: "date", title: "Ngày đơn cũ", sortable: true, render: (v) => formatDay(v as string | null) },
    { key: "replaced_order_number", title: "Đơn cũ (bị thay thế)", sortable: true },
    { key: "new_order_number", title: "Đơn mới", sortable: true, render: (v, row) => (
      <span>{String(v)}{!row.new_found && <span className="ml-1 text-xs text-amber-600">(chưa có dữ liệu)</span>}</span>
    ) },
    { key: "customer_code", title: "Mã KH", render: (v) => shortCustomer(v as string | null) },
    { key: "customer_name", title: "Tên KH" },
    { key: "replaced_qty", title: "SL đơn cũ", align: "right", render: (v) => formatQty(v as number) },
    { key: "new_qty", title: "SL đơn mới", align: "right", render: (v) => formatQty(v as number | null) },
    { key: "diff_qty", title: "Chênh lệch SL", align: "right", render: (v) => formatQty(v as number | null) },
    { key: "replaced_value", title: "Giá trị đơn cũ", align: "right", render: (v) => formatMoney(v as number) },
    { key: "new_value", title: "Giá trị đơn mới", align: "right", render: (v) => formatMoney(v as number | null) },
    { key: "diff_value", title: "Chênh lệch giá trị", align: "right", render: (v) => formatMoney(v as number | null) },
    { key: "replaced_returned", title: "Đơn cũ đã trả", render: (v) => (v ? "Đã trả" : "Chưa trả") },
  ];

  const reviewColumns: Column<ReviewItem>[] = [
    { key: "type", title: "Loại", sortable: true, render: (v) => REVIEW_LABELS[String(v)] ?? String(v) },
    { key: "order_number", title: "Số đơn hàng", sortable: true },
    { key: "related_order_number", title: "Đơn liên quan" },
    { key: "date", title: "Ngày", sortable: true, render: (v) => formatDay(v as string | null) },
    { key: "customer_code", title: "Mã KH", render: (v) => shortCustomer(v as string | null) },
    { key: "customer_name", title: "Tên KH" },
    { key: "qty", title: "Số lượng", align: "right", render: (v) => formatQty(v as number) },
    { key: "value", title: "Giá trị", align: "right", render: (v) => formatMoney(v as number) },
    { key: "message", title: "Ghi chú" },
  ];

  function downloadExcel() {
    if (!summary) return;
    let rows: Record<string, unknown>[];
    if (tab === "pairs") {
      rows = summary.pairs.map((item) => Object.fromEntries(pairColumns.map((column) => [column.title, (item as Record<string, unknown>)[column.key]])));
    } else if (tab === "review") {
      rows = summary.review.map((item) => ({ ...item, type: REVIEW_LABELS[item.type] ?? item.type }));
    } else {
      rows = summary.groups.map((item) => Object.fromEntries([
        [activeGroupTab.codeTitle, item.code],
        ...(activeGroupTab.nameTitle ? [[activeGroupTab.nameTitle, item.name]] : []),
        ["SL bán", item.sold_qty], ["SL trừ", item.deducted_qty], ["SL thực", item.net_qty], ["SL KM thực", item.net_promo_qty],
        ["Giá trị bán", item.sold_value], ["Giá trị trừ", item.deducted_value], ["Giá trị thực", item.net_value],
      ]));
    }
    if (rows.length === 0) return;
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Tong hop");
    XLSX.writeFile(workbook, `tong-hop-don-hang-${tab}-${fromDate}-den-${toDate}.xlsx`);
  }

  const tabs: { key: Tab; label: string }[] = [
    ...GROUP_TABS.map(({ key, label }) => ({ key, label })),
    { key: "pairs", label: `Đối chiếu thay thế${summary ? ` (${summary.pairs.length})` : ""}` },
    { key: "review", label: `Cần kiểm tra${summary ? ` (${summary.review.length})` : ""}` },
  ];
  const totals = summary?.totals;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tổng hợp đơn hàng"
        subtitle="Doanh số thực = đã cập nhật kho − đơn đã trả. Khoản trừ tính vào ngày của đơn cũ."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Tổng bán ra" value={formatMoney(totals?.sold_value ?? 0)} sub={`${formatQty(totals?.sold_qty ?? 0)} sản phẩm`} icon={<ShoppingCart size={20} />} color="bg-sky-50 text-sky-600" />
        <StatCard label="Đã trừ (trả hàng)" value={formatMoney(totals?.deducted_value ?? 0)} sub={`${formatQty(totals?.deducted_qty ?? 0)} sản phẩm`} icon={<RotateCcw size={20} />} color="bg-rose-50 text-rose-600" />
        <StatCard label="Doanh số thực" value={formatMoney(totals?.net_value ?? 0)} sub={`${formatQty(totals?.net_qty ?? 0)} sản phẩm`} icon={<TrendingUp size={20} />} color="bg-emerald-50 text-emerald-600" />
        <StatCard label="Cặp thay thế" value={summary?.pairs.length ?? 0} icon={<ArrowLeftRight size={20} />} color="bg-violet-50 text-violet-600" />
        <StatCard label="Cần kiểm tra" value={summary?.review.length ?? 0} icon={<AlertTriangle size={20} />} color="bg-amber-50 text-amber-600" />
      </div>

      <section className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
        <label className="text-sm text-gray-600">Từ ngày<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="mt-1 block rounded-lg border border-gray-200 px-3 py-2 text-sm" /></label>
        <label className="text-sm text-gray-600">Đến ngày<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="mt-1 block rounded-lg border border-gray-200 px-3 py-2 text-sm" /></label>
        <input value={customer} onChange={(event) => setCustomer(event.target.value)} placeholder="Lọc mã/tên khách hàng" className="min-w-0 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
        <input value={staff} onChange={(event) => setStaff(event.target.value)} placeholder="Lọc mã/tên NVBH" className="min-w-0 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
        <input value={product} onChange={(event) => setProduct(event.target.value)} placeholder="Lọc mã/tên sản phẩm" className="min-w-0 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
        <button onClick={() => { setCustomer(""); setStaff(""); setProduct(""); }} className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">Xóa lọc</button>
        <button onClick={downloadExcel} disabled={!summary} className="ml-auto flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-50">
          <Download size={16} />Tải Excel
        </button>
      </section>

      {error && <div className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"><AlertTriangle size={16} />{error}</div>}
      {summary && summary.unknown_state_rows > 0 && (
        <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <AlertTriangle size={16} />
          {summary.unknown_state_rows} dòng chưa xác định trạng thái (dữ liệu cũ) nên chưa được tính. Hãy đồng bộ lại các ngày đó ở trang Đơn hàng.
        </div>
      )}

      <div className="flex flex-wrap gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1">
        {tabs.map((item) => (
          <button key={item.key} onClick={() => setTab(item.key)} className={`rounded-md px-3 py-2 text-sm font-medium ${tab === item.key ? "bg-white text-sky-700 shadow-sm" : "text-gray-500"}`}>
            {item.label}
          </button>
        ))}
      </div>

      {isLoading && !summary ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-12 text-center text-sm text-gray-400">Đang tải...</div>
      ) : tab === "pairs" ? (
        <DataTable data={summary?.pairs ?? []} columns={pairColumns} searchable={false} pageSize={20} emptyMessage="Chưa có đơn thay thế nào trong khoảng ngày đã chọn" fitColumns />
      ) : tab === "review" ? (
        <DataTable data={summary?.review ?? []} columns={reviewColumns} searchable={false} pageSize={20} emptyMessage="Không có đơn nào cần kiểm tra" fitColumns />
      ) : (
        <DataTable data={summary?.groups ?? []} columns={groupColumns} searchable={false} pageSize={20} emptyMessage="Không có dữ liệu trong khoảng ngày đã chọn" fitColumns />
      )}
    </div>
  );
}

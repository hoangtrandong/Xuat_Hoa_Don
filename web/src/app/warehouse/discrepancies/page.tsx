"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, CheckCircle2 } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Badge from "@/components/ui/Badge";
import { API_URL, apiFetch } from "@/lib/api";
import { formatDateTime, formatNumber } from "@/lib/format";

interface Discrepancy {
  id: number; warehouse_id: number; product_id: number; type: "SHORTAGE" | "EXCESS";
  document_quantity: number; actual_quantity: number; quantity: number; remaining_quantity: number;
  lot_number: string | null; invoice_number: string | null; document_date: string | null;
  created_at: string; status: "OPEN" | "PARTIAL" | "RESOLVED";
}
interface Suggestion extends Discrepancy { suggested_quantity: number }
interface Product { id: number; sku: string; name: string; supplier?: string | null }
interface Warehouse { id: number; name: string }

const statusLabels = { OPEN: "Mở", PARTIAL: "Một phần", RESOLVED: "Đã xử lý" };

export default function SupplierDiscrepanciesPage() {
  const [rows, setRows] = useState<Discrepancy[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [productId, setProductId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selected, setSelected] = useState<Discrepancy | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const productMap = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const warehouseMap = useMemo(() => new Map(warehouses.map((warehouse) => [warehouse.id, warehouse])), [warehouses]);
  const visibleRows = useMemo(() => rows.filter((row) => {
    const date = row.document_date ?? row.created_at;
    return (!fromDate || date >= fromDate) && (!toDate || date.slice(0, 10) <= toDate);
  }), [rows, fromDate, toDate]);

  const load = useCallback(async () => {
    setError("");
    const query = new URLSearchParams();
    if (type) query.set("discrepancy_type", type);
    if (status) query.set("status", status);
    if (warehouseId) query.set("warehouse_id", warehouseId);
    if (productId) query.set("product_id", productId);
    try {
      const [discrepancyResponse, productResponse, warehouseResponse] = await Promise.all([
        apiFetch(`${API_URL}/inventory/supplier-discrepancies/?${query}`),
        apiFetch(`${API_URL}/products/`),
        apiFetch(`${API_URL}/inventory/warehouses/`),
      ]);
      if (!discrepancyResponse.ok || !productResponse.ok || !warehouseResponse.ok) throw new Error("Không thể tải sổ nợ NCC.");
      setRows(await discrepancyResponse.json() as Discrepancy[]);
      setProducts(await productResponse.json() as Product[]);
      setWarehouses(await warehouseResponse.json() as Warehouse[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Không thể tải sổ nợ NCC.");
    }
  }, [type, status, warehouseId, productId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  async function openSuggestions(row: Discrepancy) {
    setSelected(row); setSuggestions([]); setError("");
    if (row.status === "RESOLVED") return;
    const response = await apiFetch(`${API_URL}/inventory/supplier-discrepancies/${row.id}/offset-suggestions`);
    if (!response.ok) { setError("Không thể tải gợi ý bù trừ."); return; }
    setSuggestions(await response.json() as Suggestion[]);
  }

  async function confirmOffset(candidate: Suggestion) {
    if (!selected) return;
    setBusy(true); setError("");
    try {
      const shortageId = selected.type === "SHORTAGE" ? selected.id : candidate.id;
      const excessId = selected.type === "EXCESS" ? selected.id : candidate.id;
      const response = await apiFetch(`${API_URL}/inventory/supplier-discrepancies/offsets/confirm`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shortage_id: shortageId, excess_id: excessId, quantity: candidate.suggested_quantity, created_by: "admin" }),
      });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "Không thể xác nhận bù trừ.");
      setSelected(null); await load();
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "Không thể xác nhận bù trừ.");
    } finally { setBusy(false); }
  }

  function exportCsv() {
    const header = ["Ngày", "Kho", "SKU", "Loại", "SL chứng từ", "SL thực nhận", "SL gốc", "Đã bù trừ", "Còn nợ", "Hóa đơn", "Trạng thái"];
    const lines = rows.map((row) => [
      formatDateTime(row.created_at), warehouseMap.get(row.warehouse_id)?.name ?? row.warehouse_id,
      productMap.get(row.product_id)?.sku ?? row.product_id, row.type, row.document_quantity,
      row.actual_quantity, row.quantity - row.remaining_quantity, row.remaining_quantity,
      row.remaining_quantity, row.invoice_number ?? "", statusLabels[row.status],
    ].map((value) => `"${String(value).replaceAll("\"", "\"\"")}"`).join(","));
    const blob = new Blob(["\ufeff" + [header.join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "so-no-nha-cung-cap.csv"; anchor.click(); URL.revokeObjectURL(url);
  }

  return <div className="space-y-6">
    <PageHeader title="Theo dõi nợ NCC" subtitle="Đối soát thiếu/thừa theo SKU, kho và hóa đơn" actions={<div className="flex gap-2"><button onClick={() => void load()} className="p-2 rounded-lg border border-gray-200"><RefreshCw size={17} /></button><button onClick={exportCsv} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500 text-white text-sm"><Download size={16} /> Xuất CSV</button></div>} />
    {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      <select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} className="border rounded-lg px-3 py-2 text-sm"><option value="">Tất cả kho</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select>
      <select value={productId} onChange={(event) => setProductId(event.target.value)} className="border rounded-lg px-3 py-2 text-sm"><option value="">Tất cả SKU</option>{products.map((product) => <option key={product.id} value={product.id}>{product.sku} - {product.name}</option>)}</select>
      <select value={type} onChange={(event) => setType(event.target.value)} className="border rounded-lg px-3 py-2 text-sm"><option value="">Thiếu và thừa</option><option value="SHORTAGE">Thiếu</option><option value="EXCESS">Thừa</option></select>
      <select value={status} onChange={(event) => setStatus(event.target.value)} className="border rounded-lg px-3 py-2 text-sm"><option value="">Mọi trạng thái</option><option value="OPEN">Mở</option><option value="PARTIAL">Một phần</option><option value="RESOLVED">Đã xử lý</option></select>
      <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="border rounded-lg px-3 py-2 text-sm" aria-label="Từ ngày" />
      <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="border rounded-lg px-3 py-2 text-sm" aria-label="Đến ngày" />
    </div>
    <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-sm"><thead className="bg-gray-50 text-gray-500"><tr><th className="px-4 py-3 text-left">Ngày</th><th className="px-4 py-3 text-left">Hóa đơn</th><th className="px-4 py-3 text-left">NCC / SKU</th><th className="px-4 py-3 text-left">Loại</th><th className="px-4 py-3 text-right">SL gốc</th><th className="px-4 py-3 text-right">Đã bù</th><th className="px-4 py-3 text-right">Còn nợ</th><th className="px-4 py-3">Trạng thái</th><th /></tr></thead><tbody>{visibleRows.map((row) => <tr key={row.id} className="border-t"><td className="px-4 py-3">{formatDateTime(row.document_date ?? row.created_at)}</td><td className="px-4 py-3">{row.invoice_number ?? "—"}</td><td className="px-4 py-3">{productMap.get(row.product_id)?.supplier ?? "—"}<div className="font-medium">{productMap.get(row.product_id)?.sku ?? `#${row.product_id}`}</div><div className="text-xs text-gray-400">{warehouseMap.get(row.warehouse_id)?.name}</div></td><td className="px-4 py-3"><Badge variant={row.type === "SHORTAGE" ? "danger" : "warning"}>{row.type === "SHORTAGE" ? "Thiếu" : "Thừa"}</Badge></td><td className="px-4 py-3 text-right">{formatNumber(row.quantity)}</td><td className="px-4 py-3 text-right">{formatNumber(row.quantity - row.remaining_quantity)}</td><td className="px-4 py-3 text-right font-semibold">{formatNumber(row.remaining_quantity)}</td><td className="px-4 py-3"><Badge variant={row.status === "RESOLVED" ? "success" : row.status === "PARTIAL" ? "warning" : "default"}>{statusLabels[row.status]}</Badge></td><td className="px-4 py-3 text-right"><button onClick={() => void openSuggestions(row)} className="text-sky-600 hover:underline text-xs">Gợi ý bù trừ</button></td></tr>)}</tbody></table>{visibleRows.length === 0 && <p className="p-8 text-center text-gray-500">Chưa có khoản nợ NCC.</p>}</div>
    {selected && <div className="rounded-xl border border-sky-100 bg-sky-50 p-4"><div className="flex items-center justify-between"><div><h2 className="font-semibold">Gợi ý bù trừ</h2><p className="text-xs text-gray-600 mt-1">Cùng SKU và cùng kho, ưu tiên khoản cũ hơn.</p></div><button onClick={() => setSelected(null)} className="text-sm text-gray-500">Đóng</button></div>{suggestions.length === 0 ? <p className="mt-3 text-sm text-gray-600">Chưa có khoản đối ứng phù hợp.</p> : <div className="mt-3 space-y-2">{suggestions.map((candidate) => <div key={candidate.id} className="flex items-center justify-between rounded-lg bg-white p-3 text-sm"><span>{candidate.type === "SHORTAGE" ? "Thiếu" : "Thừa"} · HĐ {candidate.invoice_number ?? "—"} · còn {candidate.remaining_quantity} hộp</span><button disabled={busy} onClick={() => void confirmOffset(candidate)} className="flex items-center gap-1 rounded-lg bg-sky-500 px-3 py-1.5 text-white disabled:opacity-50"><CheckCircle2 size={14} /> Bù {candidate.suggested_quantity}</button></div>)}</div>}</div>}
  </div>;
}

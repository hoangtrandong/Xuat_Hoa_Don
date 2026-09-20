"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2, Link2, Trash2 } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import DataTable, { Column } from "@/components/ui/DataTable";
import Badge from "@/components/ui/Badge";
import { API_URL } from "@/lib/api";

type CompanyAssignment = { id: number; company_id: number; company_name: string; role: string; status: string };
type ProductCompanyRow = { product_id: number; sku: string; name: string; companies: CompanyAssignment[] };
type Company = { id: number; code: string; name: string; status: string };

export default function ProductCompanyManagementPage() {
  const [rows, setRows] = useState<ProductCompanyRow[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selected, setSelected] = useState<ProductCompanyRow | null>(null);
  const [companyId, setCompanyId] = useState("");
  const [role, setRole] = useState("MANAGER");
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load(): Promise<ProductCompanyRow[]> {
    const [productsResponse, companiesResponse] = await Promise.all([
      fetch(`${API_URL}/product-groups/products/company-links`),
      fetch(`${API_URL}/companies/?limit=5000`),
    ]);
    if (!productsResponse.ok || !companiesResponse.ok) throw new Error("Không thể tải dữ liệu quản lý SKU theo công ty.");
    const loadedRows = await productsResponse.json() as ProductCompanyRow[];
    setRows(loadedRows);
    setCompanies(await companiesResponse.json() as Company[]);
    return loadedRows;
  }

  useEffect(() => { load().catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Không thể tải dữ liệu.")); }, []);

  const filteredRows = useMemo(() => rows.filter((row) => `${row.sku} ${row.name} ${row.companies.map((company) => company.company_name).join(" ")}`.toLocaleLowerCase("vi").includes(filter.trim().toLocaleLowerCase("vi"))), [rows, filter]);

  async function addCompany() {
    if (!selected || !companyId) return;
    setError(""); setMessage("");
    try {
      const response = await fetch(`${API_URL}/product-groups/products/${selected.product_id}/companies`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ company_id: Number(companyId), role }),
      });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "Không thể gán công ty cho SKU.");
      const loadedRows = await load();
      const updated = loadedRows.find((row) => row.product_id === selected.product_id);
      setSelected(updated ?? selected);
      setCompanyId(""); setMessage("Đã gán công ty cho SKU.");
    } catch (addError) { setError(addError instanceof Error ? addError.message : "Không thể gán công ty."); }
  }

  async function removeCompany(link: CompanyAssignment) {
    if (!selected || !window.confirm(`Gỡ ${link.company_name} khỏi SKU ${selected.sku}?`)) return;
    const response = await fetch(`${API_URL}/product-groups/products/${selected.product_id}/companies/${link.company_id}`, { method: "DELETE" });
    const result = await response.json().catch(() => ({})) as { detail?: string };
    if (!response.ok) { setError(result.detail ?? "Không thể gỡ công ty."); return; }
    await load();
    setSelected((current) => current ? { ...current, companies: current.companies.filter((item) => item.company_id !== link.company_id) } : current);
    setMessage("Đã gỡ công ty khỏi SKU.");
  }

  const columns: Column<ProductCompanyRow>[] = [
    { key: "sku", title: "Mã SKU", sortable: true },
    { key: "name", title: "Tên sản phẩm", sortable: true },
    { key: "companies", title: "Công ty quản lý", render: (_, row) => row.companies.length ? row.companies.map((company) => company.company_name).join(", ") : <span className="text-gray-400">Chưa gán</span> },
    { key: "company_count", title: "Số công ty", render: (_, row) => row.companies.length },
    { key: "id", title: "Thao tác", render: (_, row) => <button onClick={() => { setSelected(row); setError(""); setMessage(""); }} className="inline-flex items-center gap-1 rounded-lg bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-100"><Link2 size={14} />Quản lý</button> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="SKU theo công ty quản lý" subtitle="Gán một SKU cho một hoặc nhiều công ty quản lý độc lập." />
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {message && <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm"><p className="text-xs text-gray-500">Tổng SKU</p><p className="mt-1 text-2xl font-bold text-gray-900">{rows.length}</p></div>
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm"><p className="text-xs text-gray-500">SKU đã gán công ty</p><p className="mt-1 text-2xl font-bold text-emerald-600">{rows.filter((row) => row.companies.length > 0).length}</p></div>
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm"><p className="text-xs text-gray-500">Tổng quan hệ</p><p className="mt-1 text-2xl font-bold text-sky-600">{rows.reduce((sum, row) => sum + row.companies.length, 0)}</p></div>
      </div>
      <DataTable data={filteredRows} columns={columns} searchKeys={["sku", "name"]} searchPlaceholder="Tìm SKU hoặc tên sản phẩm..." toolbar={<input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Lọc cả công ty quản lý" className="rounded-lg border border-gray-200 px-3 py-2 text-sm" />} />

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSelected(null)}>
          <div className="w-full max-w-xl rounded-xl bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between border-b border-gray-100 p-5"><div><p className="text-xs text-gray-500">SKU {selected.sku}</p><h2 className="text-lg font-semibold text-gray-900">{selected.name}</h2></div><Building2 className="text-sky-500" size={22} /></div>
            <div className="space-y-4 p-5">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_150px_auto]"><select value={companyId} onChange={(event) => setCompanyId(event.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm"><option value="">Chọn công ty</option>{companies.filter((company) => !selected.companies.some((link) => link.company_id === company.id)).map((company) => <option key={company.id} value={company.id}>{company.code} - {company.name}</option>)}</select><select value={role} onChange={(event) => setRole(event.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm"><option value="MANAGER">MANAGER</option><option value="DISTRIBUTOR">DISTRIBUTOR</option><option value="SUPPLIER">SUPPLIER</option></select><button onClick={addCompany} disabled={!companyId} className="rounded-lg bg-sky-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Gán</button></div>
              <div className="divide-y divide-gray-100 rounded-lg border border-gray-100">{selected.companies.map((link) => <div key={link.company_id} className="flex items-center justify-between px-3 py-3"><div><p className="text-sm font-medium text-gray-800">{link.company_name}</p><Badge variant="info">{link.role}</Badge></div><button onClick={() => removeCompany(link)} title="Gỡ công ty" className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={16} /></button></div>)}{selected.companies.length === 0 && <p className="px-3 py-5 text-center text-sm text-gray-400">SKU chưa được gán công ty nào.</p>}</div>
            </div>
            <div className="flex justify-end border-t border-gray-100 p-4"><button onClick={() => setSelected(null)} className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700">Đóng</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

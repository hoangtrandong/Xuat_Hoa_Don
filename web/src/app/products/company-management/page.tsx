"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, Link2, Trash2, Download, Upload, UsersRound } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import DataTable, { Column } from "@/components/ui/DataTable";
import Badge from "@/components/ui/Badge";
import { API_URL } from "@/lib/api";

type CompanyAssignment = { id: number; company_id: number; company_name: string; role: string; status: string; distributor_sku?: string | null; distributor_name?: string | null };
type ProductCompanyRow = { product_group_id: number; group_name: string; representative_sku: string; representative_name: string; member_skus: string[]; member_names: string[]; companies: CompanyAssignment[] };
type Company = { id: number; code: string; name: string; status: string };

export default function ProductCompanyManagementPage() {
  const [rows, setRows] = useState<ProductCompanyRow[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selected, setSelected] = useState<ProductCompanyRow | null>(null);
  const [companyId, setCompanyId] = useState("");
  const [distributorSku, setDistributorSku] = useState("");
  const [distributorName, setDistributorName] = useState("");
  const [role, setRole] = useState("MANAGER");
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function load(): Promise<ProductCompanyRow[]> {
    const [productsResponse, companiesResponse] = await Promise.all([
      fetch(`${API_URL}/product-groups/products/company-links`),
      fetch(`${API_URL}/companies/?limit=5000`),
    ]);
    if (!productsResponse.ok || !companiesResponse.ok) throw new Error("Không thể tải dữ liệu quản lý mã NPP nội bộ.");
    const loadedRows = await productsResponse.json() as Partial<ProductCompanyRow>[];
    const normalizedRows = loadedRows.map((row) => ({
      product_group_id: row.product_group_id ?? 0,
      group_name: row.group_name ?? "Chưa đặt tên SKU dùng chung",
      representative_sku: row.representative_sku ?? "—",
      representative_name: row.representative_name ?? "—",
      member_skus: row.member_skus ?? [],
      member_names: row.member_names ?? [],
      companies: row.companies ?? [],
    }));
    setRows(normalizedRows);
    setCompanies(await companiesResponse.json() as Company[]);
    return normalizedRows;
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      load().catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Không thể tải dữ liệu."));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const filteredRows = useMemo(() => rows.filter((row) => `${row.group_name ?? ""} ${row.representative_sku ?? ""} ${row.representative_name ?? ""} ${(row.member_skus ?? []).join(" ")} ${(row.member_names ?? []).join(" ")} ${(row.companies ?? []).map((company) => `${company.company_name ?? ""} ${company.distributor_sku ?? ""} ${company.distributor_name ?? ""}`).join(" ")}`.toLocaleLowerCase("vi").includes(filter.trim().toLocaleLowerCase("vi"))), [rows, filter]);

  async function addCompany() {
    if (!selected || !companyId) return;
    setError(""); setMessage("");
    try {
      const response = await fetch(`${API_URL}/product-groups/${selected.product_group_id}/companies`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ company_id: Number(companyId), role, distributor_sku: distributorSku, distributor_name: distributorName }),
      });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "Không thể gán công ty cho SKU.");
      const loadedRows = await load();
      const updated = loadedRows.find((row) => row.product_group_id === selected.product_group_id);
      setSelected(updated ?? selected);
      setCompanyId(""); setDistributorSku(""); setDistributorName(""); setMessage("Đã gán công ty và mã NPP cho SKU dùng chung.");
    } catch (addError) { setError(addError instanceof Error ? addError.message : "Không thể gán công ty."); }
  }

  async function removeCompany(link: CompanyAssignment) {
    if (!selected || !window.confirm(`Gỡ ${link.company_name} khỏi SKU dùng chung ${selected.group_name}?`)) return;
    const response = await fetch(`${API_URL}/product-groups/${selected.product_group_id}/companies/${link.company_id}`, { method: "DELETE" });
    const result = await response.json().catch(() => ({})) as { detail?: string };
    if (!response.ok) { setError(result.detail ?? "Không thể gỡ công ty."); return; }
    await load();
    setSelected((current) => current ? { ...current, companies: current.companies.filter((item) => item.company_id !== link.company_id) } : current);
    setMessage("Đã gỡ công ty khỏi SKU.");
  }

  async function uploadAssignments(file: File) {
    setBusy(true); setError(""); setMessage("");
    try {
      const body = new FormData(); body.append("file", file);
      const response = await fetch(`${API_URL}/product-groups/products/companies/upload`, { method: "POST", body });
      const result = await response.json() as { added?: number; skipped?: number; detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "Không thể nhập file Excel.");
      await load();
      setMessage(`Đã gán ${result.added ?? 0} quan hệ SKU-công ty; bỏ qua ${result.skipped ?? 0} quan hệ đã có.`);
    } catch (uploadError) { setError(uploadError instanceof Error ? uploadError.message : "Không thể nhập file Excel."); }
    finally { setBusy(false); }
  }

  async function assignAllToTwoCompanies() {
    const targets = companies.filter((company) => company.code === "001" || company.code === "002");
    if (targets.length !== 2) { setError("Không tìm đủ Cty Trung Đông (001) và Cty Mai Gold (002)."); return; }
    if (!window.confirm(`Gán ${targets.map((company) => company.name).join(" và ")} cho toàn bộ ${rows.length} SKU hiện tại?`)) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`${API_URL}/product-groups/companies/assign-all`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(targets.map((company) => company.id)) });
      const result = await response.json() as { added?: number; products?: number; detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "Không thể gán công ty cho toàn bộ SKU.");
      await load();
      setMessage(`Đã gán ${result.added ?? 0} quan hệ cho ${result.products ?? rows.length} SKU.`);
    } catch (assignError) { setError(assignError instanceof Error ? assignError.message : "Không thể gán công ty."); }
    finally { setBusy(false); }
  }

  const columns: Column<ProductCompanyRow>[] = [
    { key: "member_skus", title: "Mã SKU", render: (_, row) => <div className="space-y-1">{(row.member_skus ?? []).map((sku) => <p key={sku}>{sku}</p>)}</div> },
    { key: "member_names", title: "Tên sản phẩm", render: (_, row) => <div className="space-y-1">{(row.member_names ?? []).map((name, index) => <p key={`${name}-${index}`}>{name}</p>)}</div> },
    { key: "companies", title: "Công ty quản lý", render: (_, row) => row.companies.length ? row.companies.map((company) => company.company_name).join(", ") : <span className="text-gray-400">Chưa gán</span> },
    { key: "distributor_sku", title: "Mã NPP", render: (_, row) => row.companies.length ? <div className="space-y-1">{row.companies.map((company) => <p key={company.company_id} className="font-medium text-emerald-700">{company.distributor_sku ?? "—"}</p>)}</div> : <span className="text-gray-400">—</span> },
    { key: "distributor_name", title: "Tên sản phẩm NPP", render: (_, row) => row.companies.length ? <div className="space-y-1">{row.companies.map((company) => <p key={company.company_id}>{company.distributor_name ?? "—"}</p>)}</div> : <span className="text-gray-400">—</span> },
    { key: "company_count", title: "Số công ty", render: (_, row) => row.companies.length },
    { key: "id", title: "Thao tác", render: (_, row) => <button onClick={() => { setSelected(row); setError(""); setMessage(""); }} className="inline-flex items-center gap-1 rounded-lg bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-100"><Link2 size={14} />Quản lý</button> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Quản lý mã NPP nội bộ" subtitle="Quản lý mã NPP theo công ty cho các SKU dùng chung." actions={<div className="flex flex-wrap gap-2"><a href={`${API_URL}/product-groups/products/companies/template`} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700"><Download size={16} />Tải mẫu Excel</a><button onClick={() => fileInput.current?.click()} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 disabled:opacity-50"><Upload size={16} />Upload Excel</button><input ref={fileInput} type="file" accept=".xlsx,.xlsm" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadAssignments(file); event.target.value = ""; }} /><button onClick={assignAllToTwoCompanies} disabled={busy || rows.length === 0} className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"><UsersRound size={16} />Gán công ty</button></div>} />
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {message && <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm"><p className="text-xs text-gray-500">Tổng SKU</p><p className="mt-1 text-2xl font-bold text-gray-900">{rows.length}</p></div>
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm"><p className="text-xs text-gray-500">SKU đã gán công ty</p><p className="mt-1 text-2xl font-bold text-emerald-600">{rows.filter((row) => row.companies.length > 0).length}</p></div>
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm"><p className="text-xs text-gray-500">Tổng quan hệ</p><p className="mt-1 text-2xl font-bold text-sky-600">{rows.reduce((sum, row) => sum + row.companies.length, 0)}</p></div>
      </div>
      <DataTable data={filteredRows} columns={columns} searchKeys={["representative_sku", "group_name", "member_skus"]} searchPlaceholder="Tìm SKU dùng chung hoặc mã SKU..." toolbar={<input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Lọc SKU dùng chung, SKU, mã NPP" className="rounded-lg border border-gray-200 px-3 py-2 text-sm" />} />

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSelected(null)}>
          <div className="w-full max-w-xl rounded-xl bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between border-b border-gray-100 p-5"><div><p className="text-xs text-gray-500">SKU dùng chung: {selected.group_name}</p><h2 className="text-lg font-semibold text-gray-900">Mã SKU: {selected.member_skus.join(", ")}</h2></div><Building2 className="text-sky-500" size={22} /></div>
            <div className="space-y-4 p-5">
              <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_1fr_150px_auto]"><select value={companyId} onChange={(event) => setCompanyId(event.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm"><option value="">Chọn công ty</option>{companies.filter((company) => !selected.companies.some((link) => link.company_id === company.id)).map((company) => <option key={company.id} value={company.id}>{company.code} - {company.name}</option>)}</select><input value={distributorSku} onChange={(event) => setDistributorSku(event.target.value)} placeholder="Mã NPP nội bộ" className="rounded-lg border border-gray-200 px-3 py-2 text-sm" /><input value={distributorName} onChange={(event) => setDistributorName(event.target.value)} placeholder="Tên sản phẩm NPP" className="rounded-lg border border-gray-200 px-3 py-2 text-sm" /><select value={role} onChange={(event) => setRole(event.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm"><option value="MANAGER">MANAGER</option><option value="DISTRIBUTOR">DISTRIBUTOR</option><option value="SUPPLIER">SUPPLIER</option></select><button onClick={addCompany} disabled={!companyId || !distributorSku.trim()} className="rounded-lg bg-sky-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Gán</button></div>
              <div className="divide-y divide-gray-100 rounded-lg border border-gray-100">{selected.companies.map((link) => <div key={link.company_id} className="flex items-center justify-between px-3 py-3"><div><p className="text-sm font-medium text-gray-800">{link.company_name}</p><p className="text-sm text-emerald-700">{link.distributor_sku ?? "Chưa có mã NPP nội bộ"}</p><p className="text-xs text-gray-500">{link.distributor_name ?? "Chưa có tên sản phẩm NPP"}</p><Badge variant="info">{link.role}</Badge></div><button onClick={() => removeCompany(link)} title="Gỡ công ty" className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={16} /></button></div>)}{selected.companies.length === 0 && <p className="px-3 py-5 text-center text-sm text-gray-400">SKU dùng chung chưa được gán công ty nào.</p>}</div>
            </div>
            <div className="flex justify-end border-t border-gray-100 p-4"><button onClick={() => setSelected(null)} className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700">Đóng</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

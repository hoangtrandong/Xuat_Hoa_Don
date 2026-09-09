"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Package, CheckCircle, FolderOpen, Truck, Plus, Download, Upload, Pencil, Trash2 } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import DataTable, { Column } from "@/components/ui/DataTable";
import Badge from "@/components/ui/Badge";
import Drawer from "@/components/ui/Drawer";
import { formatVND } from "@/lib/format";
import { cn } from "@/lib/utils";
import { API_URL } from "@/lib/api";

type CategoryOption = { id: number; name: string };
type UnitOption = { id: number; name: string };
type ProductRow = {
  id: number;
  code: string;
  name: string;
  category_id: number;
  category: string;
  unit_id: number;
  unit: string;
  supplier: string;
  price: number;
  cost_price: number;
  boxes_per_carton: number;
  stock: number;
  status: string;
};

export default function ProductsPage() {
  const router = useRouter();
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [categoryFilter, setCategoryFilter] = useState("Táº¥t cáº£");
  const [supplierFilter, setSupplierFilter] = useState("Táº¥t cáº£");
  const [statusFilter, setStatusFilter] = useState("Táº¥t cáº£");
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductRow | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [form, setForm] = useState({ sku: "", name: "", category_id: "1", unit_id: "1", supplier: "", base_price: "0", cost_price: "0", boxes_per_carton: "1" });
  const [editForm, setEditForm] = useState({ sku: "", name: "", category_id: "1", unit_id: "1", supplier: "", base_price: "0", cost_price: "0", boxes_per_carton: "1", status: "active" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([]);
  const [unitOptions, setUnitOptions] = useState<UnitOption[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; name: string } | null>(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  async function uploadProducts(file: File) {
    const body = new FormData();
    body.append("file", file);
    const response = await fetch(`${API_URL}/products/upload`, { method: "POST", body });
    const result = await response.json() as { imported?: number; detail?: string };
    if (!response.ok) throw new Error(result.detail ?? "KhÃ´ng thá»ƒ táº£i danh sÃ¡ch SKU.");
    setMessage(`ÄÃ£ nháº­p ${result.imported ?? 0} SKU vÃ o PostgreSQL.`);
    window.location.reload();
  }
  useEffect(() => {
    Promise.all([
      fetch(`${API_URL}/products/categories/`),
      fetch(`${API_URL}/products/units/`),
      fetch(`${API_URL}/products/`),
    ]).then(async ([categoryResponse, unitResponse, productResponse]) => {
      if (!categoryResponse.ok || !unitResponse.ok || !productResponse.ok) throw new Error("KhÃ´ng thá»ƒ táº£i danh má»¥c, Ä‘Æ¡n vá»‹ vÃ  SKU.");
      const loadedCategories = await categoryResponse.json() as CategoryOption[];
      const loadedUnits = await unitResponse.json() as UnitOption[];
      const loadedProducts = await productResponse.json();
      setCategories(loadedCategories);
      setCategoryOptions(loadedCategories);
      setUnitOptions(loadedUnits);
      setProducts(loadedProducts.map((product: { id: number; sku: string; name: string; category_id: number; unit_id: number; supplier?: string; base_price: number; cost_price: number; boxes_per_carton: number; status: string }) => ({
        id: product.id,
        code: product.sku,
        name: product.name,
        category_id: product.category_id,
        category: loadedCategories.find((category) => category.id === product.category_id)?.name ?? "ChÆ°a xÃ¡c Ä‘á»‹nh",
        unit_id: product.unit_id,
        unit: loadedUnits.find((unit) => unit.id === product.unit_id)?.name ?? "ChÆ°a xÃ¡c Ä‘á»‹nh",
        supplier: product.supplier ?? "",
        price: product.base_price,
        cost_price: product.cost_price ?? 0,
        boxes_per_carton: product.boxes_per_carton ?? 1,
        stock: 0,
        status: product.status,
      })));
    }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "KhÃ´ng thá»ƒ táº£i dá»¯ liá»‡u."));
  }, []);
  async function createProduct() {
    setMessage(""); setError("");
    try {
      const response = await fetch(`${API_URL}/products/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, category_id: Number(form.category_id), unit_id: Number(form.unit_id), base_price: Number(form.base_price), cost_price: Number(form.cost_price), boxes_per_carton: Number(form.boxes_per_carton) }) });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "KhÃ´ng thá»ƒ táº¡o SKU.");
      setMessage("ÄÃ£ táº¡o SKU thÃ nh cÃ´ng trong PostgreSQL."); setCreateOpen(false);
    } catch (e) { setError(e instanceof Error ? e.message : "KhÃ´ng thá»ƒ táº¡o SKU."); }
  }

  async function updateProduct() {
    setMessage(""); setError("");
    if (!editingProduct) return;
    try {
      const response = await fetch(`${API_URL}/products/${editingProduct.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...editForm, category_id: Number(editForm.category_id), unit_id: Number(editForm.unit_id), base_price: Number(editForm.base_price), cost_price: Number(editForm.cost_price), boxes_per_carton: Number(editForm.boxes_per_carton) }) });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "KhÃ´ng thá»ƒ cáº­p nháº­t SKU.");
      setMessage("ÄÃ£ cáº­p nháº­t SKU thÃ nh cÃ´ng."); setEditOpen(false); setEditingProduct(null);
      window.location.reload();
    } catch (e) { setError(e instanceof Error ? e.message : "KhÃ´ng thá»ƒ cáº­p nháº­t SKU."); }
  }

  async function deleteProduct(productId: number) {
    setMessage(""); setError("");
    try {
      const response = await fetch(`${API_URL}/products/${productId}`, { method: "DELETE" });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "KhÃ´ng thá»ƒ xÃ³a SKU.");
      setMessage("ÄÃ£ xÃ³a SKU thÃ nh cÃ´ng."); setDeleteConfirm(null);
      window.location.reload();
    } catch (e) { setError(e instanceof Error ? e.message : "KhÃ´ng thá»ƒ xÃ³a SKU."); }
  }

  async function bulkDeleteProducts() {
    setMessage(""); setError("");
    if (selectedIds.size === 0) return;
    try {
      const response = await fetch(`${API_URL}/products/bulk-delete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Array.from(selectedIds)) });
      const result = await response.json() as { deleted?: number; detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "KhÃ´ng thá»ƒ xÃ³a SKU.");
      setMessage(`ÄÃ£ xÃ³a ${result.deleted ?? 0} SKU thÃ nh cÃ´ng.`); setBulkDeleteConfirm(false); setSelectedIds(new Set());
      window.location.reload();
    } catch (e) { setError(e instanceof Error ? e.message : "KhÃ´ng thá»ƒ xÃ³a SKU."); }
  }

  function openEditDrawer(product: ProductRow) {
    setEditingProduct(product);
    setEditForm({
      sku: product.code,
      name: product.name,
      category_id: String(product.category_id),
      unit_id: String(product.unit_id),
      supplier: product.supplier,
      base_price: String(product.price),
      cost_price: String(product.cost_price),
      boxes_per_carton: String(product.boxes_per_carton),
      status: product.status,
    });
    setEditOpen(true);
  }

  function toggleSelectProduct(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === filteredProducts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredProducts.map(p => p.id)));
    }
  }

  const activeProducts = products.filter((p) => p.status === "active").length;
  const uniqueSuppliers = new Set(products.map((p) => p.supplier)).size;

  const filteredProducts = products.filter((p) => {
    if (categoryFilter !== "Táº¥t cáº£" && p.category !== categoryFilter) return false;
    if (supplierFilter !== "Táº¥t cáº£" && p.supplier !== supplierFilter) return false;
    if (statusFilter !== "Táº¥t cáº£" && p.status !== statusFilter) return false;
    return true;
  });

  const columns: Column<typeof products[0]>[] = [
    {
      key: "id",
      title: "",
      render: (_, row) => (
        <input
          type="checkbox"
          checked={selectedIds.has(row.id)}
          onChange={() => toggleSelectProduct(row.id)}
          className="rounded"
        />
      ),
    },
    { key: "code", title: "MÃ£ SKU", sortable: true },
    { key: "name", title: "TÃªn sáº£n pháº©m", sortable: true },
    { key: "category", title: "Danh má»¥c", sortable: true },
    { key: "unit", title: "ÄVT" },
    { key: "supplier", title: "NhÃ  cung cáº¥p", sortable: true },
    {
      key: "boxes_per_carton",
      title: "Sá»‘ há»™p/thÃ¹ng",
      align: "right",
      render: (val) => <span className="text-gray-600">{Number(val)}</span>,
    },
    {
      key: "price",
      title: "GiÃ¡ bÃ¡n",
      sortable: true,
      align: "right",
      render: (val) => formatVND(val as number),
    },
    {
      key: "status",
      title: "Tráº¡ng thÃ¡i",
      render: (val) =>
        val === "active" ? (
          <Badge variant="success">Hoáº¡t Ä‘á»™ng</Badge>
        ) : (
          <Badge variant="danger">Ngá»«ng kinh doanh</Badge>
        ),
    },
    {
      key: "id",
      title: "Thao tÃ¡c",
      render: (_, row) => (
        <div className="flex items-center gap-1">
          <button
            onClick={() => openEditDrawer(row)}
            className="p-1.5 text-gray-500 hover:text-sky-600 hover:bg-sky-50 rounded transition-colors"
            title="Sá»­a"
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={() => setDeleteConfirm({ id: row.id, name: row.name })}
            className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
            title="XÃ³a"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ),
    },
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Danh sÃ¡ch HÃ ng hÃ³a"
        actions={
          <div className="flex gap-2">
          <a href={`${API_URL}/products/template`} className="flex items-center gap-2 border border-gray-200 bg-white text-gray-700 px-3 py-2 rounded-lg text-sm font-medium"><Download size={16} />Táº£i máº«u Excel</a>
          <button onClick={() => fileInput.current?.click()} className="flex items-center gap-2 border border-gray-200 bg-white text-gray-700 px-3 py-2 rounded-lg text-sm font-medium"><Upload size={16} />Upload Excel</button>
          <input ref={fileInput} type="file" accept=".xlsx,.xlsm" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadProducts(file).catch((uploadError: unknown) => setError(uploadError instanceof Error ? uploadError.message : "KhÃ´ng thá»ƒ táº£i file Excel.")); event.target.value = ""; }} />
          <button onClick={() => { setError(""); setMessage(""); setCreateOpen(true); }} className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            <Plus size={16} />
            ThÃªm SKU
          </button>
          </div>
        }
      />

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Tá»•ng SKU" value={products.length} icon={<Package size={20} />} color="bg-blue-50 text-blue-600" />
        <StatCard label="SKU Hoáº¡t Ä‘á»™ng" value={activeProducts} icon={<CheckCircle size={20} />} color="bg-emerald-50 text-emerald-600" />
        <StatCard label="Danh má»¥c" value={categories.length} icon={<FolderOpen size={20} />} color="bg-purple-50 text-purple-600" />
        <StatCard label="NhÃ  cung cáº¥p" value={uniqueSuppliers} icon={<Truck size={20} />} color="bg-amber-50 text-amber-600" />
      </div>

      <DataTable
        data={filteredProducts}
        columns={columns}
        searchKeys={["code", "name", "supplier"]}
        searchPlaceholder="TÃ¬m mÃ£, tÃªn, nhÃ  cung cáº¥p..."
        onRowClick={(row) => router.push(`/products/${row.id}`)}
        toolbar={
          <>
            {selectedIds.size > 0 && (
              <button
                onClick={() => setBulkDeleteConfirm(true)}
                className="flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                <Trash2 size={16} />
                XÃ³a ({selectedIds.size})
              </button>
            )}
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="Táº¥t cáº£">Táº¥t cáº£ danh má»¥c</option>
              {categories.map((c) => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
            <select
              value={supplierFilter}
              onChange={(e) => setSupplierFilter(e.target.value)}
              className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="Táº¥t cáº£">Táº¥t cáº£ NCC</option>
              <option value="Unilever">Unilever</option>
              <option value="Viá»‡t Äáº¡i">Viá»‡t Äáº¡i</option>
              <option value="Cáº§u Äá»">Cáº§u Äá»</option>
              <option value="Hayat">Hayat</option>
              <option value="Vinamilk">Vinamilk</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="Táº¥t cáº£">Táº¥t cáº£ tráº¡ng thÃ¡i</option>
              <option value="active">Hoáº¡t Ä‘á»™ng</option>
              <option value="inactive">Ngá»«ng kinh doanh</option>
            </select>
          </>
        }
      />
      {message && <div className="bg-emerald-50 text-emerald-700 rounded-lg px-4 py-3 text-sm">{message}</div>}
      <Drawer open={createOpen} onClose={() => setCreateOpen(false)} title="ThÃªm SKU" subtitle="Táº¡o sáº£n pháº©m trong PostgreSQL">
        <div className="p-5 space-y-4">
          {error && <div className="bg-red-50 text-red-700 rounded-lg px-3 py-2 text-sm">{error}</div>}
          {(["sku", "name", "supplier", "base_price", "cost_price", "boxes_per_carton"] as const).map((field) => (
            <label key={field} className="block"><span className="text-xs text-gray-500">{field === "sku" ? "MÃ£ SKU" : field === "name" ? "TÃªn sáº£n pháº©m" : field === "supplier" ? "NhÃ  cung cáº¥p" : field === "base_price" ? "GiÃ¡ bÃ¡n" : field === "cost_price" ? "GiÃ¡ vá»‘n" : "Sá»‘ há»™p / thÃ¹ng"}</span><input type={field.includes("price") || field === "boxes_per_carton" ? "number" : "text"} min={field === "boxes_per_carton" ? 1 : undefined} value={form[field]} onChange={(e) => setForm({ ...form, [field]: e.target.value })} className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" /></label>
          ))}
          <label className="block"><span className="text-xs text-gray-500">Danh má»¥c</span><select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"><option value="">-- Chá»n danh má»¥c --</option>{categoryOptions.map((option, index) => <option key={option.id} value={option.id}>{index + 1}. {option.name}</option>)}</select></label>
          <label className="block"><span className="text-xs text-gray-500">ÄÆ¡n vá»‹ tÃ­nh</span><select value={form.unit_id} onChange={(e) => setForm({ ...form, unit_id: e.target.value })} className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"><option value="">-- Chá»n Ä‘Æ¡n vá»‹ --</option>{unitOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
          <button onClick={createProduct} className="w-full bg-sky-500 text-white rounded-lg py-2.5 text-sm font-medium">LÆ°u SKU</button>
        </div>
      </Drawer>

      {/* Edit Drawer */}
      <Drawer open={editOpen} onClose={() => { setEditOpen(false); setEditingProduct(null); }} title="Sá»­a SKU" subtitle="Cáº­p nháº­t thÃ´ng tin sáº£n pháº©m">
        <div className="p-5 space-y-4">
          {error && <div className="bg-red-50 text-red-700 rounded-lg px-3 py-2 text-sm">{error}</div>}
          {(["sku", "name", "supplier", "base_price", "cost_price", "boxes_per_carton"] as const).map((field) => (
            <label key={field} className="block"><span className="text-xs text-gray-500">{field === "sku" ? "MÃ£ SKU" : field === "name" ? "TÃªn sáº£n pháº©m" : field === "supplier" ? "NhÃ  cung cáº¥p" : field === "base_price" ? "GiÃ¡ bÃ¡n" : field === "cost_price" ? "GiÃ¡ vá»‘n" : "Sá»‘ há»™p / thÃ¹ng"}</span><input type={field.includes("price") || field === "boxes_per_carton" ? "number" : "text"} min={field === "boxes_per_carton" ? 1 : undefined} value={editForm[field]} onChange={(e) => setEditForm({ ...editForm, [field]: e.target.value })} className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" /></label>
          ))}
          <label className="block"><span className="text-xs text-gray-500">Danh má»¥c</span><select value={editForm.category_id} onChange={(e) => setEditForm({ ...editForm, category_id: e.target.value })} className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"><option value="">-- Chá»n danh má»¥c --</option>{categoryOptions.map((option, index) => <option key={option.id} value={option.id}>{index + 1}. {option.name}</option>)}</select></label>
          <label className="block"><span className="text-xs text-gray-500">ÄÆ¡n vá»‹ tÃ­nh</span><select value={editForm.unit_id} onChange={(e) => setEditForm({ ...editForm, unit_id: e.target.value })} className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"><option value="">-- Chá»n Ä‘Æ¡n vá»‹ --</option>{unitOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
          <label className="block"><span className="text-xs text-gray-500">Tráº¡ng thÃ¡i</span><select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })} className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"><option value="active">Hoáº¡t Ä‘á»™ng</option><option value="inactive">Ngá»«ng kinh doanh</option></select></label>
          <button onClick={updateProduct} className="w-full bg-sky-500 text-white rounded-lg py-2.5 text-sm font-medium">Cáº­p nháº­t SKU</button>
        </div>
      </Drawer>

      {/* Delete Confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900">XÃ¡c nháº­n xÃ³a</h3>
            <p className="mt-2 text-sm text-gray-600">Báº¡n cÃ³ cháº¯c cháº¯n muá»‘n xÃ³a SKU <strong>{deleteConfirm.name}</strong>? HÃ nh Ä‘á»™ng nÃ y khÃ´ng thá»ƒ hoÃ n tÃ¡c.</p>
            <div className="mt-4 flex gap-3 justify-end">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Há»§y</button>
              <button onClick={() => deleteProduct(deleteConfirm.id)} className="px-4 py-2 text-sm font-medium text-white bg-red-500 rounded-lg hover:bg-red-600">XÃ³a</button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Confirmation */}
      {bulkDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900">XÃ¡c nháº­n xÃ³a hÃ ng loáº¡t</h3>
            <p className="mt-2 text-sm text-gray-600">Báº¡n cÃ³ cháº¯c cháº¯n muá»‘n xÃ³a <strong>{selectedIds.size}</strong> SKU Ä‘Ã£ chá»n? HÃ nh Ä‘á»™ng nÃ y khÃ´ng thá»ƒ hoÃ n tÃ¡c.</p>
            <div className="mt-4 flex gap-3 justify-end">
              <button onClick={() => setBulkDeleteConfirm(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Há»§y</button>
              <button onClick={bulkDeleteProducts} className="px-4 py-2 text-sm font-medium text-white bg-red-500 rounded-lg hover:bg-red-600">XÃ³a {selectedIds.size} SKU</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

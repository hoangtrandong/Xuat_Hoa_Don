"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Package, CheckCircle, FolderOpen, Truck, Plus, Download, Upload } from "lucide-react";
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
  unit: string;
  supplier: string;
  price: number;
  stock: number;
  status: string;
};

export default function ProductsPage() {
  const router = useRouter();
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [categoryFilter, setCategoryFilter] = useState("Tất cả");
  const [supplierFilter, setSupplierFilter] = useState("Tất cả");
  const [statusFilter, setStatusFilter] = useState("Tất cả");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ sku: "", name: "", category_id: "1", unit_id: "1", supplier: "", base_price: "0", cost_price: "0", boxes_per_carton: "1" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([]);
  const [unitOptions, setUnitOptions] = useState<UnitOption[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  async function uploadProducts(file: File) {
    const body = new FormData();
    body.append("file", file);
    const response = await fetch(`${API_URL}/products/upload`, { method: "POST", body });
    const result = await response.json() as { imported?: number; detail?: string };
    if (!response.ok) throw new Error(result.detail ?? "Không thể tải danh sách SKU.");
    setMessage(`Đã nhập ${result.imported ?? 0} SKU vào PostgreSQL.`);
    window.location.reload();
  }
  useEffect(() => {
    Promise.all([
      fetch(`${API_URL}/products/categories/`),
      fetch(`${API_URL}/products/units/`),
      fetch(`${API_URL}/products/`),
    ]).then(async ([categoryResponse, unitResponse, productResponse]) => {
      if (!categoryResponse.ok || !unitResponse.ok || !productResponse.ok) throw new Error("Không thể tải danh mục, đơn vị và SKU.");
      const loadedCategories = await categoryResponse.json() as CategoryOption[];
      const loadedUnits = await unitResponse.json() as UnitOption[];
      const loadedProducts = await productResponse.json();
      setCategories(loadedCategories);
      setCategoryOptions(loadedCategories);
      setUnitOptions(loadedUnits);
      setProducts(loadedProducts.map((product: { id: number; sku: string; name: string; category_id: number; unit_id: number; supplier?: string; base_price: number; status: string }) => ({
        id: product.id,
        code: product.sku,
        name: product.name,
        category_id: product.category_id,
        category: loadedCategories.find((category) => category.id === product.category_id)?.name ?? "Chưa xác định",
        unit: loadedUnits.find((unit) => unit.id === product.unit_id)?.name ?? "Chưa xác định",
        supplier: product.supplier ?? "",
        price: product.base_price,
        stock: 0,
        status: product.status,
      })));
    }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Không thể tải dữ liệu."));
  }, []);
  async function createProduct() {
    setMessage(""); setError("");
    try {
      const response = await fetch(`${API_URL}/products/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, category_id: Number(form.category_id), unit_id: Number(form.unit_id), base_price: Number(form.base_price), cost_price: Number(form.cost_price), boxes_per_carton: Number(form.boxes_per_carton) }) });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "Không thể tạo SKU.");
      setMessage("Đã tạo SKU thành công trong PostgreSQL."); setCreateOpen(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Không thể tạo SKU."); }
  }

  const activeProducts = products.filter((p) => p.status === "active").length;
  const uniqueSuppliers = new Set(products.map((p) => p.supplier)).size;

  const filteredProducts = products.filter((p) => {
    if (categoryFilter !== "Tất cả" && p.category !== categoryFilter) return false;
    if (supplierFilter !== "Tất cả" && p.supplier !== supplierFilter) return false;
    if (statusFilter !== "Tất cả" && p.status !== statusFilter) return false;
    return true;
  });

  const columns: Column<typeof products[0]>[] = [
    { key: "code", title: "Mã SKU", sortable: true },
    { key: "name", title: "Tên sản phẩm", sortable: true },
    { key: "category", title: "Danh mục", sortable: true },
    { key: "unit", title: "ĐVT" },
    { key: "supplier", title: "Nhà cung cấp", sortable: true },
    {
      key: "price",
      title: "Giá bán",
      sortable: true,
      align: "right",
      render: (val) => formatVND(val as number),
    },
    {
      key: "stock",
      title: "Tồn kho",
      sortable: true,
      align: "right",
      render: (val) => (
        <span className={cn((val as number) < 20 ? "text-red-600 font-medium" : "text-gray-900")}>
          {val as number}
        </span>
      ),
    },
    {
      key: "status",
      title: "Trạng thái",
      render: (val) =>
        val === "active" ? (
          <Badge variant="success">Hoạt động</Badge>
        ) : (
          <Badge variant="danger">Ngừng kinh doanh</Badge>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Danh sách Hàng hóa"
        actions={
          <div className="flex gap-2">
          <a href={`${API_URL}/products/template`} className="flex items-center gap-2 border border-gray-200 bg-white text-gray-700 px-3 py-2 rounded-lg text-sm font-medium"><Download size={16} />Tải mẫu Excel</a>
          <button onClick={() => fileInput.current?.click()} className="flex items-center gap-2 border border-gray-200 bg-white text-gray-700 px-3 py-2 rounded-lg text-sm font-medium"><Upload size={16} />Upload Excel</button>
          <input ref={fileInput} type="file" accept=".xlsx,.xlsm" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadProducts(file).catch((uploadError: unknown) => setError(uploadError instanceof Error ? uploadError.message : "Không thể tải file Excel.")); event.target.value = ""; }} />
          <button onClick={() => { setError(""); setMessage(""); setCreateOpen(true); }} className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            <Plus size={16} />
            Thêm SKU
          </button>
          </div>
        }
      />

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Tổng SKU" value={products.length} icon={<Package size={20} />} color="bg-blue-50 text-blue-600" />
        <StatCard label="SKU Hoạt động" value={activeProducts} icon={<CheckCircle size={20} />} color="bg-emerald-50 text-emerald-600" />
        <StatCard label="Danh mục" value={categories.length} icon={<FolderOpen size={20} />} color="bg-purple-50 text-purple-600" />
        <StatCard label="Nhà cung cấp" value={uniqueSuppliers} icon={<Truck size={20} />} color="bg-amber-50 text-amber-600" />
      </div>

      <DataTable
        data={filteredProducts}
        columns={columns}
        searchKeys={["code", "name", "supplier"]}
        searchPlaceholder="Tìm mã, tên, nhà cung cấp..."
        onRowClick={(row) => router.push(`/products/${row.id}`)}
        toolbar={
          <>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="Tất cả">Tất cả danh mục</option>
              {categories.map((c) => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
            <select
              value={supplierFilter}
              onChange={(e) => setSupplierFilter(e.target.value)}
              className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="Tất cả">Tất cả NCC</option>
              <option value="Unilever">Unilever</option>
              <option value="Việt Đại">Việt Đại</option>
              <option value="Cầu Đỏ">Cầu Đỏ</option>
              <option value="Hayat">Hayat</option>
              <option value="Vinamilk">Vinamilk</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="Tất cả">Tất cả trạng thái</option>
              <option value="active">Hoạt động</option>
              <option value="inactive">Ngừng kinh doanh</option>
            </select>
          </>
        }
      />
      {message && <div className="bg-emerald-50 text-emerald-700 rounded-lg px-4 py-3 text-sm">{message}</div>}
      <Drawer open={createOpen} onClose={() => setCreateOpen(false)} title="Thêm SKU" subtitle="Tạo sản phẩm trong PostgreSQL">
        <div className="p-5 space-y-4">
          {error && <div className="bg-red-50 text-red-700 rounded-lg px-3 py-2 text-sm">{error}</div>}
          {(["sku", "name", "supplier", "base_price", "cost_price", "boxes_per_carton"] as const).map((field) => (
            <label key={field} className="block"><span className="text-xs text-gray-500">{field === "sku" ? "Mã SKU" : field === "name" ? "Tên sản phẩm" : field === "supplier" ? "Nhà cung cấp" : field === "base_price" ? "Giá bán" : field === "cost_price" ? "Giá vốn" : "Số hộp / thùng"}</span><input type={field.includes("price") || field === "boxes_per_carton" ? "number" : "text"} min={field === "boxes_per_carton" ? 1 : undefined} value={form[field]} onChange={(e) => setForm({ ...form, [field]: e.target.value })} className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" /></label>
          ))}
          <label className="block"><span className="text-xs text-gray-500">Danh mục</span><select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"><option value="">-- Chọn danh mục --</option>{categoryOptions.map((option, index) => <option key={option.id} value={option.id}>{index + 1}. {option.name}</option>)}</select></label>
          <label className="block"><span className="text-xs text-gray-500">Đơn vị tính</span><select value={form.unit_id} onChange={(e) => setForm({ ...form, unit_id: e.target.value })} className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"><option value="">-- Chọn đơn vị --</option>{unitOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
          <button onClick={createProduct} className="w-full bg-sky-500 text-white rounded-lg py-2.5 text-sm font-medium">Lưu SKU</button>
        </div>
      </Drawer>
    </div>
  );
}

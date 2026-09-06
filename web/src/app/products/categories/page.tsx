"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { FolderOpen, Package, ArrowRight } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import { cn } from "@/lib/utils";

type Category = { id: number; name: string };
type Product = { category_id: number; status: string };

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("http://localhost:8000/api/v1/products/categories/"),
      fetch("http://localhost:8000/api/v1/products/"),
    ]).then(async ([categoryResponse, productResponse]) => {
      if (!categoryResponse.ok || !productResponse.ok) throw new Error("Không thể tải danh mục hàng hóa.");
      setCategories(await categoryResponse.json());
      setProducts(await productResponse.json());
    }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Không thể tải dữ liệu."));
  }, []);

  const totalCategories = categories.length;
  const totalSkus = products.length;
  const activeSkus = products.filter((p) => p.status === "active").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Danh mục hàng hóa"
        subtitle="Phân nhóm sản phẩm theo ngành hàng để quản lý và báo cáo"
      />
      {error && <div className="bg-red-50 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label="Tổng danh mục" value={totalCategories} icon={<FolderOpen size={20} />} color="bg-sky-50 text-sky-600" />
        <StatCard label="Tổng SKU" value={totalSkus} icon={<Package size={20} />} color="bg-purple-50 text-purple-600" />
        <StatCard label="SKU đang bán" value={activeSkus} icon={<Package size={20} />} color="bg-emerald-50 text-emerald-600" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {categories.map((cat, index) => {
          const catProducts = products.filter((p) => p.category_id === cat.id);
          return (
            <div key={cat.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", ["bg-sky-50 text-sky-600", "bg-purple-50 text-purple-600", "bg-amber-50 text-amber-600", "bg-emerald-50 text-emerald-600", "bg-rose-50 text-rose-600"][index % 5])}>
                  <FolderOpen size={18} />
                </div>
                <Link
                  href="/products"
                  className="inline-flex items-center gap-1 text-xs font-medium text-sky-600 hover:text-sky-700"
                >
                  Xem SKU
                  <ArrowRight size={12} />
                </Link>
              </div>
              <p className="font-bold text-gray-900">{index + 1}. {cat.name}</p>
              <p className="text-xs text-gray-400 mt-1">Nhóm sản phẩm trong hệ thống PostgreSQL.</p>
              <div className="flex items-center gap-4 mt-4 pt-3 border-t border-gray-100 text-xs">
                <span className="text-gray-500">
                <strong className="text-gray-900">{catProducts.length}</strong> SKU
                </span>
                <span className="text-gray-500">
                Đang bán: <strong className="text-gray-900">{catProducts.filter((p) => p.status === "active").length}</strong>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
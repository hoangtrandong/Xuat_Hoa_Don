import { notFound } from "next/navigation";
import { Package, Tag, Boxes, CircleDollarSign, TriangleAlert } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Badge from "@/components/ui/Badge";
import { priceListItems } from "@/lib/mock-products";
import { stockLevels, ledgerEntries, ledgerLabels, type LedgerType } from "@/lib/mock-inventory";
import { formatVNDFull, formatDateTime, formatNumber } from "@/lib/format";
import { API_URL, apiFetch } from "@/lib/api";

function typeBadge(type: LedgerType) {
  if (type === "IN") return { label: ledgerLabels[type], cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" };
  if (type === "OUT") return { label: ledgerLabels[type], cls: "bg-sky-50 text-sky-700 ring-sky-200" };
  if (type === "ADJUST") return { label: ledgerLabels[type], cls: "bg-amber-50 text-amber-700 ring-amber-200" };
  return { label: ledgerLabels[type], cls: "bg-purple-50 text-purple-700 ring-purple-200" };
}

interface CategoryOption { id: number; name: string }
interface UnitOption { id: number; name: string }
interface ApiProduct {
  id: number;
  sku: string;
  name: string;
  category_id: number;
  unit_id: number;
  supplier: string | null;
  base_price: number;
  cost_price: number;
  boxes_per_carton: number;
  status: string;
  representative_sku: string | null;
  representative_name: string | null;
}

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [catRes, unitRes, prodRes] = await Promise.all([
    apiFetch(`${API_URL}/products/categories/`),
    apiFetch(`${API_URL}/products/units/`),
    apiFetch(`${API_URL}/products/${id}`, { cache: "no-store" }),
  ]);

  if (!prodRes.ok) notFound();
  const product = await prodRes.json() as ApiProduct;
  const categories = (await catRes.json()) as CategoryOption[];
  const units = (await unitRes.json()) as UnitOption[];

  const category = categories.find((c) => c.id === product.category_id)?.name ?? "Chưa xác định";
  const unit = units.find((u) => u.id === product.unit_id)?.name ?? "Chưa xác định";

  const stock = stockLevels.find((s) => s.productCode === product.sku);
  const txHistory = ledgerEntries.filter((e) => e.productCode === product.sku);
  const priceInLists = priceListItems.map((pl) => {
    const item = pl.items.find((i) => i.productCode === product.sku);
    return item ? { list: pl.name, price: item.price } : null;
  }).filter(Boolean);
  const lowStock = stock ? stock.onHand <= stock.reorderPoint : false;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Chi tiết sản phẩm"
        subtitle={`${product.sku} · ${category}`}
        backHref="/products"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Thông tin chính */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center flex-shrink-0">
              <Package size={26} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-bold text-gray-900">{product.name}</h2>
                {product.status === "active" ? <Badge variant="success">Đang bán</Badge> : <Badge variant="danger">Ngừng kinh doanh</Badge>}
              </div>
              <p className="text-sm text-gray-500 mt-1">Mã SKU: <strong className="text-gray-800">{product.sku}</strong></p>
              <div className="flex flex-wrap gap-2 mt-3">
                <Badge variant="info">{category}</Badge>
                <Badge variant="default">ĐVT: {unit}</Badge>
                <Badge variant="purple">NCC: {product.supplier ?? "—"}</Badge>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
            <MiniStat icon={<Tag size={16} />} value={formatVNDFull(product.base_price)} label="Giá bán lẻ" />
            <MiniStat icon={<CircleDollarSign size={16} />} value={formatVNDFull(product.cost_price)} label="Giá vốn" />
            <MiniStat
              icon={<Boxes size={16} />}
              value={`${formatNumber(stock?.onHand ?? 0)} ${unit}`}
              label="Tồn kho"
              alert={lowStock}
            />
            <MiniStat
              icon={<TriangleAlert size={16} />}
              value={`${formatNumber(stock?.reorderPoint ?? 0)} ${unit}`}
              label="Điểm đặt lại"
              alert={lowStock}
            />
          </div>

          {lowStock && (
            <p className="mt-4 text-xs bg-amber-50 text-amber-700 rounded-lg px-3 py-2">
              ⚠️ SKU đang ở mức tồn thấp (≤ điểm đặt lại), cần nhập bổ sung.
            </p>
          )}
        </div>

        {/* Bảng giá */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Bảng giá</h3>
          {priceInLists.length > 0 ? (
            <div className="space-y-2">
              {priceInLists.map((p) => (
                <div key={p!.list} className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">{p!.list}</span>
                  <span className="text-sm font-bold text-gray-900">{formatVNDFull(p!.price)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-400">Chưa có bảng giá</p>
          )}
        </div>
      </div>

      {/* Lịch sử giao dịch kho */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 pt-5 pb-4">
          <h3 className="text-sm font-semibold text-gray-700">Lịch sử giao dịch kho ({product.sku})</h3>
          <p className="text-xs text-gray-400 mt-0.5">Trích từ sổ nhật ký inventory_transactions</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-gray-100 bg-gray-50">
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Mã GD</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Thời gian</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Loại</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Kho</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">SL</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Chứng từ</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Ghi chú</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {txHistory.map((tx) => {
                const badge = typeBadge(tx.type);
                return (
                  <tr key={tx.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-semibold text-gray-700">{tx.code}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{formatDateTime(tx.createdAt)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1 ${badge.cls}`}>{badge.label}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">{tx.warehouse}</td>
                    <td className={`px-4 py-3 text-right font-bold ${tx.quantity > 0 ? "text-emerald-600" : "text-red-500"}`}>
                      {tx.quantity > 0 ? "+" : ""}{formatNumber(tx.quantity)}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{tx.refType} · {tx.refCode}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{tx.note}</td>
                  </tr>
                );
              })}
              {txHistory.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-gray-400 text-sm">Chưa có giao dịch tồn kho cho sản phẩm này.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ icon, value, label, alert }: { icon: React.ReactNode; value: string; label: string; alert?: boolean }) {
  return (
    <div className={`rounded-xl p-3 ${alert ? "bg-amber-50" : "bg-gray-50"}`}>
      <div className={`flex items-center gap-1.5 mb-1 ${alert ? "text-amber-600" : "text-sky-600"}`}>{icon}</div>
      <p className="text-sm font-bold text-gray-900">{value}</p>
      <p className="text-[11px] text-gray-400 mt-0.5">{label}</p>
    </div>
  );
}
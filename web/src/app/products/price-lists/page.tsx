"use client";
// src/app/products/price-lists/page.tsx
import { useState } from "react";
import { Tag, CalendarDays, Percent } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import DataTable, { Column } from "@/components/ui/DataTable";
import Badge from "@/components/ui/Badge";
import { priceListItems, type PriceListItem } from "@/lib/mock-products";
import { formatVNDFull, formatDate } from "@/lib/format";

export default function PriceListsPage() {
  const [activeList, setActiveList] = useState(priceListItems[0].id);
  const selected = priceListItems.find((pl) => pl.id === activeList) ?? priceListItems[0];

  const columns: Column<PriceListItem>[] = [
    { key: "productCode", title: "Mã SKU", sortable: true },
    {
      key: "productName",
      title: "Sản phẩm",
      sortable: true,
      render: (val) => <p className="font-medium text-gray-900">{String(val)}</p>,
    },
    { key: "unit", title: "ĐVT" },
    {
      key: "basePrice",
      title: "Giá bán lẻ",
      sortable: true,
      align: "right",
      render: (val) => <span className="text-gray-500">{formatVNDFull(val as number)}</span>,
    },
    {
      key: "price",
      title: "Giá trong bảng giá",
      sortable: true,
      align: "right",
      render: (val) => <span className="font-semibold text-gray-900">{formatVNDFull(val as number)}</span>,
    },
    {
      key: "priceDiff",
      title: "Chênh lệch",
      align: "right",
      render: (_val, row) => {
        const diff = row.basePrice - row.price;
        return diff > 0 ? (
          <span className="text-emerald-600 font-medium">-{((diff / row.basePrice) * 100).toFixed(0)}%</span>
        ) : (
          <span className="text-gray-400">0%</span>
        );
      },
    },
    {
      key: "status",
      title: "Trạng thái",
      render: (val) =>
        val === "active" ? <Badge variant="success">Còn bán</Badge> : <Badge variant="danger">Ngừng bán</Badge>,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bảng giá"
        subtitle="Thiết lập giá bán theo nhóm khách hàng và kênh phân phối"
      />

      <div className="flex flex-wrap items-center gap-4">
        {priceListItems.map((pl) => (
          <button
            key={pl.id}
            onClick={() => setActiveList(pl.id)}
            className={`flex-1 min-w-[220px] text-left rounded-xl border p-4 transition-all ${
              pl.id === activeList
                ? "border-sky-500 ring-2 ring-sky-100 bg-sky-50/50 shadow-sm"
                : "border-gray-200 bg-white hover:border-sky-300 hover:shadow-sm"
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center">
                <Tag size={15} />
              </div>
              <span className="font-semibold text-sm text-gray-900">{pl.name}</span>
            </div>
            <p className="text-xs text-gray-400 flex items-center gap-1">
              <CalendarDays size={11} /> Hiệu lực từ {formatDate(pl.effectiveDate)}
            </p>
            <p className="text-xs text-gray-500 mt-1.5">
              <Badge variant="info">{pl.customerType}</Badge>
            </p>
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">{selected.name}</h3>
            <p className="text-xs text-gray-400 mt-0.5">{selected.note} · Hiệu lực từ {formatDate(selected.effectiveDate)}</p>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg bg-gray-50 px-3 py-1.5 text-xs text-gray-500">
            <Percent size={13} className="text-sky-500" />
            {selected.items.length} sản phẩm trong bảng giá
          </div>
        </div>
      </div>

      <DataTable
        data={selected.items}
        columns={columns}
        searchKeys={["productCode", "productName"]}
        searchPlaceholder="Tìm SKU, tên sản phẩm..."
      />
    </div>
  );
}
"use client";
/* eslint-disable react-hooks/set-state-in-effect */
// src/app/sales/create/page.tsx - Tao don hang (Buoc 3)
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Trash2, User, CheckCircle2, AlertTriangle, X } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Badge from "@/components/ui/Badge";
import { customers, type Customer } from "@/lib/mock-customers";
import { priceListItems } from "@/lib/mock-products";
import { warehouses } from "@/lib/mock-inventory";
import { getAllStockLevels } from "@/lib/inventory-store";
import { createOrder, reserveOrderStock } from "@/lib/order-store";
import { formatVND, formatVNDFull, formatNumber, getInitials } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Line {
  productCode: string;
  productName: string;
  unit: string;
  quantity: number;
  price: number;
  discount: number;
  lineTotal: number;
}

const paymentMethods = ["Chuyển khoản", "Tiền mặt", "COD"];

export default function CreateOrderPage() {
  const router = useRouter();
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerOpen, setCustomerOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [priceListId, setPriceListId] = useState(priceListItems[0].id);
  const [productQuery, setProductQuery] = useState("");
  const [productOpen, setProductOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [pickError, setPickError] = useState("");
  const [warehouse, setWarehouse] = useState(warehouses[0].name);
  const [orderDiscount, setOrderDiscount] = useState(0);
  const [note, setNote] = useState("");
  const [paymentMethod, setPaymentMethod] = useState(paymentMethods[0]);
  const [amountPaidRaw, setAmountPaidRaw] = useState("0");
  const [submitError, setSubmitError] = useState("");
  const stockMap = useMemo(() => {
    const m = new Map<string, { available: number }>();
    getAllStockLevels().forEach((s) => m.set(s.productCode, { available: s.available }));
    return m;
  }, []);

  const priceList = priceListItems.find((pl) => pl.id === priceListId) ?? priceListItems[0];

  useEffect(() => {
    const key = new URLSearchParams(window.location.search).get("customer");
    if (key) {
      const c = customers.find((x) => x.code === key);
      if (c) setSelectedCustomer(c);
    }
  }, []);

  const filteredCustomers = useMemo(() => {
    const q = customerQuery.trim().toLowerCase();
    if (!q) return customers.slice(0, 8);
    return customers
      .filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q) || c.phone.includes(q))
      .slice(0, 8);
  }, [customerQuery]);

  const filteredProducts = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    const list = q
      ? priceList.items.filter(
          (it) => it.productName.toLowerCase().includes(q) || it.productCode.toLowerCase().includes(q)
        )
      : priceList.items;
    return list.slice(0, 7);
  }, [productQuery, priceList]);

  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  const discountAmt = Math.round((subtotal * orderDiscount) / 100);
  const total = subtotal - discountAmt;
  const amountPaid = Math.max(0, Math.min(Number(amountPaidRaw) || 0, total));
  const paymentStatus =
    total > 0 && amountPaid >= total ? "Đã thanh toán" : amountPaid > 0 ? "Thanh toán một phần" : "Chưa thanh toán";

  function recompute(list: Line[]): Line[] {
    return list.map((l) => ({
      ...l,
      lineTotal: Math.round(l.price * l.quantity * (1 - l.discount / 100)),
    }));
  }

  function addProduct(productCode: string) {
    setPickError("");
    if (lines.some((l) => l.productCode === productCode)) {
      setPickError("Sản phẩm đã có trong đơn hàng.");
      return;
    }
    const item = priceList.items.find((it) => it.productCode === productCode);
    if (!item) return;
    setLines((prev) => [
      ...prev,
      { productCode: item.productCode, productName: item.productName, unit: item.unit, quantity: 1, price: item.price, discount: 0, lineTotal: item.price },
    ]);
    setProductQuery("");
    setProductOpen(false);
  }

  function updateLine(idx: number, patch: Partial<Line>) {
    setLines((prev) => recompute(prev.map((l, i) => (i === idx ? { ...l, ...patch } : l))));
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleSubmit() {
    setSubmitError("");
    if (!selectedCustomer) {
      setSubmitError("Vui lòng chọn khách hàng.");
      return;
    }
    if (lines.length === 0) {
      setSubmitError("Vui lòng thêm ít nhất 1 sản phẩm vào đơn.");
      return;
    }
    const invalid = lines.find((l) => {
      const stock = stockMap.get(l.productCode);
      return l.quantity < 1 || (stock && l.quantity > stock.available);
    });
    if (invalid) {
      setSubmitError(
        `Số lượng của "${invalid.productName}" vượt tồn khả dụng (còn ${stockMap.get(invalid.productCode)?.available ?? 0} ${invalid.unit}).`
      );
      return;
    }
    const order = createOrder({
      customer: selectedCustomer,
      warehouse,
      items: lines,
      orderDiscount,
      paymentMethod,
      amountPaid,
      note: note.trim() || undefined,
    });
    reserveOrderStock(lines);
    window.sessionStorage.setItem("dms-order-created", order.code);
    router.push("/sales/orders");
  }

  const statusBadge =
    paymentStatus === "Đã thanh toán" ? (
      <Badge variant="success">Đã thanh toán</Badge>
    ) : paymentStatus === "Thanh toán một phần" ? (
      <Badge variant="warning">Thanh toán một phần</Badge>
    ) : (
      <Badge variant="default">Chưa thanh toán</Badge>
    );
  return (
    <div className="space-y-6">
      <PageHeader
        title="Tạo đơn hàng"
        subtitle="Lập phiếu bán mới: chọn khách hàng, thêm sản phẩm và xác nhận thanh toán"
        backHref="/sales/orders"
        actions={
          <button onClick={handleSubmit} className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            <CheckCircle2 size={16} /> Lưu đơn hàng
          </button>
        }
      />
      {submitError && (
        <div className="flex items-center gap-2 bg-red-50 text-red-700 rounded-xl px-4 py-3 text-sm">
          <AlertTriangle size={16} /> {submitError}
        </div>
      )}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
          {/* 1. Khach hang */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">1. Khách hàng</h3>
            {selectedCustomer ? (
              <div className="flex items-center gap-3 rounded-xl border border-sky-200 bg-sky-50/50 p-3">
                <div className="w-9 h-9 rounded-full bg-sky-500 flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-xs font-bold">{getInitials(selectedCustomer.name)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{selectedCustomer.name}</p>
                  <p className="text-xs text-gray-500">{selectedCustomer.code} · {selectedCustomer.type} · {selectedCustomer.district}</p>
                </div>
                <button onClick={() => setSelectedCustomer(null)} className="p-1.5 rounded-lg hover:bg-white text-gray-400" aria-label="Bỏ chọn">
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={customerQuery}
                  onChange={(e) => { setCustomerQuery(e.target.value); setCustomerOpen(true); }}
                  onFocus={() => setCustomerOpen(true)}
                  placeholder="Tìm khách hàng theo mã, tên, số điện thoại..."
                  className="pl-8 pr-3 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-sky-500 focus:bg-white"
                />
                {customerOpen && (
                  <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 max-h-72 overflow-y-auto">
                    {filteredCustomers.length === 0 && <p className="px-4 py-3 text-sm text-gray-400">Không tìm thấy khách hàng.</p>}
                    {filteredCustomers.map((c) => (
                      <button
                        key={c.code}
                        onClick={() => { setSelectedCustomer(c); setCustomerOpen(false); setCustomerQuery(""); }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-sky-50 transition-colors text-left"
                      >
                        <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                          <User size={13} className="text-gray-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{c.name}</p>
                          <p className="text-xs text-gray-400">{c.code} · {c.type} · {c.district}</p>
                        </div>
                        <Badge variant="default">Tier {c.tier}</Badge>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>          {/* 2. San pham */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <h3 className="text-sm font-semibold text-gray-700">2. Sản phẩm &amp; số lượng</h3>
              <select value={priceListId} onChange={(e) => setPriceListId(e.target.value)} className="px-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500">
                {priceListItems.map((pl) => (
                  <option key={pl.id} value={pl.id}>{pl.name}</option>
                ))}
              </select>
            </div>
            <div className="relative mb-3">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={productQuery}
                onChange={(e) => { setProductQuery(e.target.value); setProductOpen(true); }}
                onFocus={() => setProductOpen(true)}
                placeholder="Tìm sản phẩm để thêm vào đơn..."
                className="pl-8 pr-3 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-sky-500 focus:bg-white"
              />
              {productOpen && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 max-h-80 overflow-y-auto">
                  {pickError && <p className="px-3 pt-2 text-xs text-red-600">{pickError}</p>}
                  {filteredProducts.length === 0 && <p className="px-4 py-3 text-sm text-gray-400">Không tìm thấy sản phẩm.</p>}
                  {filteredProducts.map((p) => {
                    const stock = stockMap.get(p.productCode);
                    const disabled = stock ? stock.available <= 0 : false;
                    return (
                      <button
                        key={p.productCode}
                        onClick={() => addProduct(p.productCode)}
                        disabled={disabled}
                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-sky-50 transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <div className="w-7 h-7 rounded-lg bg-sky-50 flex items-center justify-center flex-shrink-0">
                          <CheckCircle2 size={13} className="text-sky-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{p.productName}</p>
                          <p className="text-xs text-gray-400">{p.productCode} · ĐVT: {p.unit} · Tồn khả dụng: {formatNumber(stock?.available ?? 0)}</p>
                        </div>
                        <span className="text-sm font-semibold text-gray-900">{formatVNDFull(p.price)}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            {lines.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8 bg-gray-50 rounded-xl">Chưa có sản phẩm nào. Hãy tìm và thêm sản phẩm vào đơn.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-gray-100">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500">Sản phẩm</th>
                      <th className="text-center px-3 py-2.5 text-xs font-semibold text-gray-500">Tồn</th>
                      <th className="text-center px-3 py-2.5 text-xs font-semibold text-gray-500">SL</th>
                      <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-500">Đơn giá</th>
                      <th className="text-center px-3 py-2.5 text-xs font-semibold text-gray-500">CK %</th>
                      <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-500">Thành tiền</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {lines.map((l, idx) => {
                      const stock = stockMap.get(l.productCode);
                      const over = stock ? l.quantity > stock.available : false;
                      return (
                        <tr key={l.productCode} className="hover:bg-gray-50">
                          <td className="px-3 py-2.5">
                            <p className="font-medium text-gray-900">{l.productName}</p>
                            <p className="text-xs text-gray-400">{l.productCode} · {l.unit}</p>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <span className={cn("text-xs font-medium", over ? "text-red-600" : "text-emerald-600")}>
                              {formatNumber(stock?.available ?? 0)}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <input
                              type="number"
                              min={1}
                              value={l.quantity}
                              onChange={(e) => updateLine(idx, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                              className={cn("w-16 text-center px-2 py-1 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-sky-500", over ? "border-red-300 bg-red-50 text-red-700" : "border-gray-200")}
                            />
                          </td>
                          <td className="px-3 py-2.5 text-right text-gray-700">{formatVNDFull(l.price)}</td>
                          <td className="px-3 py-2.5 text-center">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={l.discount}
                              onChange={(e) => updateLine(idx, { discount: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                              className="w-16 text-center px-2 py-1 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                            />
                          </td>
                          <td className="px-3 py-2.5 text-right font-semibold text-gray-900">{formatVNDFull(l.lineTotal)}</td>
                          <td className="px-2 py-2.5">
                            <button onClick={() => removeLine(idx)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors" aria-label="Xóa">
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Ghi chú đơn hàng (nếu có)..." className="mt-3 w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 focus:bg-white" />
          </div>
        </div>        {/* Cot tom tat */}
        <div>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4 lg:sticky lg:top-20">
            <h3 className="text-sm font-semibold text-gray-700">Tóm tắt đơn hàng</h3>
            <div className="space-y-1.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Tạm tính ({lines.length} dòng)</span>
                <span className="font-medium text-gray-800">{formatVNDFull(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Chiết khấu đơn</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number" min={0} max={100} value={orderDiscount}
                    onChange={(e) => setOrderDiscount(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                    className="w-14 text-right px-2 py-1 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                  <span className="text-gray-400">%</span>
                </div>
              </div>
              <div className="flex items-center justify-between text-gray-500">
                <span>Giảm giá</span>
                <span className="text-red-500 font-medium">-{formatVNDFull(discountAmt)}</span>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                <span className="font-bold text-gray-900">Tổng cộng</span>
                <span className="font-bold text-sky-600 text-base">{formatVNDFull(total)}</span>
              </div>
            </div>
            <div className="space-y-2 border-t border-gray-100 pt-3">
              <label className="block">
                <span className="text-xs text-gray-500">Kho xuất</span>
                <select value={warehouse} onChange={(e) => setWarehouse(e.target.value)} className="mt-1 w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500">
                  {warehouses.map((w) => <option key={w.id} value={w.name}>{w.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-gray-500">Phương thức thanh toán</span>
                <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="mt-1 w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500">
                  {paymentMethods.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-gray-500">Số tiền thu ({formatVND(total)})</span>
                <input
                  type="number" min={0} step={1000} value={amountPaidRaw}
                  onChange={(e) => setAmountPaidRaw(e.target.value)}
                  className="mt-1 w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </label>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500">Trạng thái</span>
              {statusBadge}
            </div>
            <button onClick={handleSubmit} disabled={!selectedCustomer || lines.length === 0} className="w-full flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-600 disabled:bg-gray-300 text-white text-sm font-medium rounded-lg py-2.5 transition-colors disabled:cursor-not-allowed">
              Lưu đơn hàng
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
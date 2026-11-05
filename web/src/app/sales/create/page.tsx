"use client";
/* eslint-disable react-hooks/set-state-in-effect */
// src/app/sales/create/page.tsx - Tao don hang tu tao (ma don bat dau bang TC-), hien thi chung voi don dong bo tu DMS
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Trash2, User, CheckCircle2, AlertTriangle, X, Loader2 } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import Badge from "@/components/ui/Badge";
import { API_URL, apiFetch } from "@/lib/api";
import { formatVNDFull, formatNumber, getInitials } from "@/lib/format";
import { cn } from "@/lib/utils";

interface SystemCustomer {
  id: number;
  code: string;
  name: string;
  type: string;
  tier: string;
  status: string;
  staffCode: string;
  staffName: string;
  storeName: string;
}

interface SystemProduct {
  id: number;
  sku: string;
  name: string;
  unit: string;
  supplier: string;
  basePrice: number;
}

interface WarehouseOption {
  id: number;
  name: string;
}

interface EmployeeOption {
  code: string;
  name: string;
  status: string;
}

interface CurrentUser {
  username: string;
  full_name: string;
  employee_code: string | null;
  employee_name: string | null;
}

interface Line {
  productCode: string;
  productName: string;
  unit: string;
  quantity: number;
  promoQuantity: number;
  price: number;
  discountAmount: number;
}

const customerTypeLabel: Record<string, string> = {
  DISTRIBUTOR: "Nhà phân phối",
  WHOLESALE: "Đại lý",
  HORECA: "HORECA",
  RETAIL: "Cửa hàng",
};

const ORDER_TYPES = ["001-Xuất hàng", "002-Dương Số"] as const;

function todayStr() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function normalizeText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
}

export default function CreateOrderPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<SystemCustomer[]>([]);
  const [products, setProducts] = useState<SystemProduct[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [stockMap, setStockMap] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [customerQuery, setCustomerQuery] = useState("");
  const [customerOpen, setCustomerOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<SystemCustomer | null>(null);
  const [orderType, setOrderType] = useState<string>("001-Xuất hàng");
  const [staffCode, setStaffCode] = useState("");
  const [staffName, setStaffName] = useState("");
  const hasOwnStaffRef = useRef(false);
  const [deliveryEmployees, setDeliveryEmployees] = useState<EmployeeOption[]>([]);
  const [deliveryEmployeeCode, setDeliveryEmployeeCode] = useState("");
  const [address, setAddress] = useState("");
  const [orderDate, setOrderDate] = useState(todayStr());
  const [deliveryDate, setDeliveryDate] = useState(todayStr());

  const [productQuery, setProductQuery] = useState("");
  const [productOpen, setProductOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [pickError, setPickError] = useState("");
  const [note, setNote] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Tai du lieu that tu he thong: khach hang, Danh sach SKU, kho
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [custRes, prodRes, unitRes, whRes, meRes, empRes] = await Promise.all([
          apiFetch(`${API_URL}/customers/?limit=5000`),
          apiFetch(`${API_URL}/products/?limit=10000`),
          apiFetch(`${API_URL}/products/units/`),
          apiFetch(`${API_URL}/inventory/warehouses/`),
          apiFetch(`${API_URL}/auth/me`),
          apiFetch(`${API_URL}/employees/?status=active&limit=1000`),
        ]);
        if (!custRes.ok) throw new Error("Không thể tải danh sách khách hàng.");
        if (!prodRes.ok) throw new Error("Không thể tải Danh sách SKU.");
        const custRows = (await custRes.json()) as Array<Record<string, unknown>>;
        const prodRows = (await prodRes.json()) as Array<Record<string, unknown>>;
        const unitRows = unitRes.ok ? ((await unitRes.json()) as Array<{ id: number; name: string }>) : [];
        const whRows = whRes.ok ? ((await whRes.json()) as Array<{ id: number; name: string }>) : [];
        const me = meRes.ok ? ((await meRes.json()) as CurrentUser) : null;
        const empRows = empRes.ok ? ((await empRes.json()) as EmployeeOption[]) : [];
        if (cancelled) return;
        // NVBH mac dinh = nhan vien gan voi tai khoan dang dang nhap.
        // Tai khoan quan tri (vd: admin) khong gan nhan vien -> NVBH lay theo khach hang khi chon KH.
        if (me?.employee_code) {
          hasOwnStaffRef.current = true;
          setStaffCode(me.employee_code);
          setStaffName(me.employee_name ?? "");
        }
        // NVGH: nhan vien dang hoat dong co ma bat dau bang NV (giong man hinh Yeu cau xuat hang)
        setDeliveryEmployees(
          (Array.isArray(empRows) ? empRows : []).filter(
            (e) => e.status?.toLowerCase() === "active" && e.code?.trim().toUpperCase().startsWith("NV")
          )
        );
        const unitName = new Map(unitRows.map((u) => [u.id, u.name]));
        const loadedCustomers = custRows
          .filter((row) => row.status !== "inactive")
          .map((row) => ({
            id: Number(row.id),
            code: String(row.code ?? ""),
            name: String(row.name ?? ""),
            type: customerTypeLabel[String(row.type ?? "")] ?? String(row.type ?? ""),
            tier: String(row.tier ?? ""),
            status: String(row.status ?? "active"),
            staffCode: String(row.staff_code ?? ""),
            staffName: String(row.staff_name ?? ""),
            storeName: String(row.store_name ?? ""),
          }));
        setCustomers(loadedCustomers);
        setProducts(
          prodRows
            .filter((row) => row.status !== "inactive")
            .map((row) => ({
              id: Number(row.id),
              sku: String(row.sku ?? ""),
              name: String(row.name ?? ""),
              unit: unitName.get(Number(row.unit_id)) ?? "",
              supplier: String(row.supplier ?? ""),
              basePrice: Number(row.base_price ?? 0),
            }))
        );
        setWarehouses(whRows.map((w) => ({ id: w.id, name: w.name })));
        if (whRows.length > 0) setWarehouseId(whRows[0].id);
        const key = new URLSearchParams(window.location.search).get("customer");
        if (key) {
          const c = loadedCustomers.find((x) => x.code === key);
          if (c) selectCustomer(c);
        }
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Không thể tải dữ liệu.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Ton kha dung theo kho (chi de canh bao)
  useEffect(() => {
    if (warehouseId == null) return;
    apiFetch(`${API_URL}/inventory/stock-levels/?warehouse_id=${warehouseId}`)
      .then(async (res) => (res.ok ? ((await res.json()) as Array<{ product_code: string; available: number }>) : []))
      .then((rows) => setStockMap(new Map(rows.map((r) => [r.product_code.toUpperCase(), Number(r.available ?? 0)]))))
      .catch(() => setStockMap(new Map()));
  }, [warehouseId]);

  function selectCustomer(c: SystemCustomer) {
    setSelectedCustomer(c);
    // Tai khoan gan nhan vien: giu NVBH la nguoi dang nhap. Tai khoan quan tri: dung NVBH cua khach hang.
    if (!hasOwnStaffRef.current) {
      setStaffCode(c.staffCode);
      setStaffName(c.staffName);
    }
    setAddress("");
    setCustomerOpen(false);
    setCustomerQuery("");
  }

  const filteredCustomers = useMemo(() => {
    const q = normalizeText(customerQuery.trim());
    const list = q
      ? customers.filter((c) =>
          [c.code, c.name, c.staffCode, c.staffName, c.storeName].some((v) => normalizeText(v).includes(q))
        )
      : customers;
    return list.slice(0, 20);
  }, [customerQuery, customers]);

  const filteredProducts = useMemo(() => {
    const q = normalizeText(productQuery.trim());
    const list = q
      ? products.filter((p) => [p.sku, p.name, p.supplier].some((v) => normalizeText(v).includes(q)))
      : products;
    return list.slice(0, 20);
  }, [productQuery, products]);

  const lineValue = (l: Line) => Math.round(l.price * l.quantity);
  const lineTotal = (l: Line) => Math.max(0, lineValue(l) - l.discountAmount);
  const subtotal = lines.reduce((s, l) => s + lineValue(l), 0);
  const totalDiscount = lines.reduce((s, l) => s + Math.min(l.discountAmount, lineValue(l)), 0);
  const total = subtotal - totalDiscount;
  const stockOf = (code: string) => stockMap.get(code.toUpperCase());

  function addProduct(product: SystemProduct) {
    setPickError("");
    if (lines.some((l) => l.productCode === product.sku)) {
      setPickError("Sản phẩm đã có trong đơn hàng.");
      return;
    }
    setLines((prev) => [
      ...prev,
      {
        productCode: product.sku,
        productName: product.name,
        unit: product.unit,
        quantity: 1,
        promoQuantity: 0,
        price: product.basePrice,
        discountAmount: 0,
      },
    ]);
    setProductQuery("");
    setProductOpen(false);
  }

  function updateLine(idx: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit() {
    setSubmitError("");
    if (!selectedCustomer) {
      setSubmitError("Vui lòng chọn khách hàng.");
      return;
    }
    if (lines.length === 0) {
      setSubmitError("Vui lòng thêm ít nhất 1 sản phẩm vào đơn.");
      return;
    }
    if (lines.some((l) => l.quantity <= 0)) {
      setSubmitError("Số lượng sản phẩm phải lớn hơn 0.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await apiFetch(`${API_URL}/sync/vinamilk-orders/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_code: selectedCustomer.code,
          order_type: orderType,
          order_date: orderDate || null,
          delivery_date: deliveryDate || null,
          staff_code: staffCode.trim() || null,
          staff_name: staffName.trim() || null,
          delivery_employee_code: deliveryEmployeeCode || null,
          delivery_employee_name: deliveryEmployees.find((e) => e.code === deliveryEmployeeCode)?.name ?? null,
          customer_address: address.trim() || null,
          note: note.trim() || null,
          lines: lines.map((l) => ({
            product_code: l.productCode,
            quantity: l.quantity,
            promo_quantity: l.promoQuantity,
            unit_price: l.price,
            discount_amount: l.discountAmount,
          })),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { order_number?: string; detail?: unknown };
      if (!response.ok) {
        throw new Error(typeof payload.detail === "string" ? payload.detail : "Không thể lưu đơn hàng.");
      }
      window.sessionStorage.setItem("dms-order-created", payload.order_number ?? "");
      router.push("/sales/orders");
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Không thể lưu đơn hàng.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls =
    "mt-1 w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 focus:bg-white";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tạo đơn hàng"
        subtitle="Đơn tự tạo có mã bắt đầu bằng TC- và hiển thị chung với đơn đồng bộ từ DMS"
        backHref="/sales/orders"
        actions={
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 disabled:bg-gray-300 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} Lưu đơn hàng
          </button>
        }
      />
      {(submitError || loadError) && (
        <div className="flex items-center gap-2 bg-red-50 text-red-700 rounded-xl px-4 py-3 text-sm">
          <AlertTriangle size={16} /> {submitError || loadError}
        </div>
      )}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
          {/* 1. Khach hang */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">1. Khách hàng</h3>
            {selectedCustomer ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3 rounded-xl border border-sky-200 bg-sky-50/50 p-3">
                  <div className="w-9 h-9 rounded-full bg-sky-500 flex items-center justify-center flex-shrink-0">
                    <span className="text-white text-xs font-bold">{getInitials(selectedCustomer.name)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{selectedCustomer.name}</p>
                    <p className="text-xs text-gray-500">
                      {selectedCustomer.code} · {selectedCustomer.type}
                      {selectedCustomer.storeName ? ` · ${selectedCustomer.storeName}` : ""}
                    </p>
                  </div>
                  <button onClick={() => setSelectedCustomer(null)} className="p-1.5 rounded-lg hover:bg-white text-gray-400" aria-label="Bỏ chọn">
                    <X size={16} />
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-xs text-gray-500">Mã NVBH</span>
                    <input value={staffCode} onChange={(e) => setStaffCode(e.target.value)} className={inputCls} />
                  </label>
                  <label className="block">
                    <span className="text-xs text-gray-500">Tên NVBH</span>
                    <input value={staffName} onChange={(e) => setStaffName(e.target.value)} className={inputCls} />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="text-xs text-gray-500">Nhân viên giao hàng (NVGH)</span>
                    <select value={deliveryEmployeeCode} onChange={(e) => setDeliveryEmployeeCode(e.target.value)} className={inputCls}>
                      <option value="">-- Chọn NVGH --</option>
                      {deliveryEmployees.map((e) => (
                        <option key={e.code} value={e.code}>
                          {e.code} - {e.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="text-xs text-gray-500">Địa chỉ giao hàng</span>
                    <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Để trống sẽ dùng địa chỉ mặc định của khách hàng" className={inputCls} />
                  </label>
                </div>
              </div>
            ) : (
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={customerQuery}
                  onChange={(e) => { setCustomerQuery(e.target.value); setCustomerOpen(true); }}
                  onFocus={() => setCustomerOpen(true)}
                  placeholder={loading ? "Đang tải khách hàng..." : `Tìm trong ${formatNumber(customers.length)} khách hàng theo mã, tên, NVBH...`}
                  className="pl-8 pr-3 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-sky-500 focus:bg-white"
                />
                {customerOpen && !loading && (
                  <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 max-h-72 overflow-y-auto">
                    {filteredCustomers.length === 0 && <p className="px-4 py-3 text-sm text-gray-400">Không tìm thấy khách hàng.</p>}
                    {filteredCustomers.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => selectCustomer(c)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-sky-50 transition-colors text-left"
                      >
                        <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                          <User size={13} className="text-gray-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{c.name}</p>
                          <p className="text-xs text-gray-400 truncate">
                            {c.code} · {c.type}
                            {c.staffName ? ` · NVBH: ${c.staffName}` : ""}
                          </p>
                        </div>
                        {c.tier && <Badge variant="default">Tier {c.tier}</Badge>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 2. San pham */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">2. Sản phẩm &amp; số lượng</h3>
            <div className="relative mb-3">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={productQuery}
                onChange={(e) => { setProductQuery(e.target.value); setProductOpen(true); }}
                onFocus={() => setProductOpen(true)}
                onBlur={() => setTimeout(() => setProductOpen(false), 150)}
                placeholder={loading ? "Đang tải Danh sách SKU..." : `Tìm trong ${formatNumber(products.length)} SKU theo mã, tên, nhà cung cấp...`}
                className="pl-8 pr-3 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-sky-500 focus:bg-white"
              />
              {productOpen && !loading && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 max-h-80 overflow-y-auto">
                  {pickError && <p className="px-3 pt-2 text-xs text-red-600">{pickError}</p>}
                  {filteredProducts.length === 0 && <p className="px-4 py-3 text-sm text-gray-400">Không tìm thấy sản phẩm.</p>}
                  {filteredProducts.map((p) => {
                    const stock = stockOf(p.sku);
                    return (
                      <button
                        key={p.id}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => addProduct(p)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-sky-50 transition-colors text-left"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{p.name}</p>
                          <p className="text-xs text-gray-400 truncate">
                            {p.sku} · ĐVT: {p.unit || "—"}
                            {p.supplier ? ` · NCC: ${p.supplier}` : ""} · Tồn: {stock == null ? "—" : formatNumber(stock)}
                          </p>
                        </div>
                        <span className="text-sm font-semibold text-gray-900">{formatVNDFull(p.basePrice)}</span>
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
                      <th className="text-center px-3 py-2.5 text-xs font-semibold text-gray-500">SL KM</th>
                      <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-500">Đơn giá</th>
                      <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-500">Tiền CK</th>
                      <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-500">Thành tiền</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {lines.map((l, idx) => {
                      const stock = stockOf(l.productCode);
                      const over = stock != null && l.quantity + l.promoQuantity > stock;
                      return (
                        <tr key={l.productCode} className="hover:bg-gray-50">
                          <td className="px-3 py-2.5">
                            <p className="font-medium text-gray-900">{l.productName}</p>
                            <p className="text-xs text-gray-400">{l.productCode} · {l.unit}</p>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <span className={cn("text-xs font-medium", over ? "text-red-600" : "text-emerald-600")} title={over ? "Vượt tồn khả dụng" : undefined}>
                              {stock == null ? "—" : formatNumber(stock)}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <input
                              type="number" min={1} value={l.quantity}
                              onChange={(e) => updateLine(idx, { quantity: Math.max(0, Number(e.target.value) || 0) })}
                              className={cn("w-20 text-center px-2 py-1 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-sky-500", over ? "border-red-300 bg-red-50 text-red-700" : "border-gray-200")}
                            />
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <input
                              type="number" min={0} value={l.promoQuantity}
                              onChange={(e) => updateLine(idx, { promoQuantity: Math.max(0, Number(e.target.value) || 0) })}
                              className="w-16 text-center px-2 py-1 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                            />
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <input
                              type="number" min={0} step={1} value={l.price}
                              onChange={(e) => updateLine(idx, { price: Math.max(0, Number(e.target.value) || 0) })}
                              className="w-28 text-right px-2 py-1 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                            />
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <input
                              type="number" min={0} step={1000} value={l.discountAmount}
                              onChange={(e) => updateLine(idx, { discountAmount: Math.max(0, Number(e.target.value) || 0) })}
                              className="w-28 text-right px-2 py-1 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                            />
                          </td>
                          <td className="px-3 py-2.5 text-right font-semibold text-gray-900">{formatVNDFull(lineTotal(l))}</td>
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
        </div>

        {/* Cot tom tat */}
        <div>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4 lg:sticky lg:top-20">
            <h3 className="text-sm font-semibold text-gray-700">Tóm tắt đơn hàng</h3>
            <div className="space-y-3 border-b border-gray-100 pb-3">
              <div>
                <span className="text-xs font-semibold text-gray-700">Trạng thái tạo đơn</span>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  {ORDER_TYPES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setOrderType(t)}
                      className={cn(
                        "px-2.5 py-1.5 text-xs font-semibold rounded-lg border text-center transition-all",
                        orderType === t
                          ? "bg-sky-50 text-sky-700 border-sky-300 ring-2 ring-sky-200 shadow-xs"
                          : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <label className="block">
                <span className="text-xs text-gray-500">Ngày đơn hàng</span>
                <input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} className={inputCls} />
              </label>
              <label className="block">
                <span className="text-xs text-gray-500">Ngày giao</span>
                <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} className={inputCls} />
              </label>
              <label className="block">
                <span className="text-xs text-gray-500">Kho (xem tồn khả dụng)</span>
                <select value={warehouseId ?? ""} onChange={(e) => setWarehouseId(Number(e.target.value))} className={inputCls}>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </label>
            </div>
            <div className="space-y-1.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Giá trị ({lines.length} dòng)</span>
                <span className="font-medium text-gray-800">{formatVNDFull(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between text-gray-500">
                <span>Chiết khấu</span>
                <span className="text-red-500 font-medium">-{formatVNDFull(totalDiscount)}</span>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                <span className="font-bold text-gray-900">Tổng cộng</span>
                <span className="font-bold text-sky-600 text-base">{formatVNDFull(total)}</span>
              </div>
            </div>
            <p className="text-xs text-gray-400">Mã đơn sẽ được cấp tự động theo dạng <b>TC-YYMMDD-001</b>.</p>
            <button onClick={handleSubmit} disabled={!selectedCustomer || lines.length === 0 || submitting} className="w-full flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-600 disabled:bg-gray-300 text-white text-sm font-medium rounded-lg py-2.5 transition-colors disabled:cursor-not-allowed">
              {submitting && <Loader2 size={16} className="animate-spin" />} Lưu đơn hàng
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

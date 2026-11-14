"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Building2,
  Plus,
  RefreshCw,
  Settings,
  Link2,
  Receipt,
  CheckCircle2,
  AlertCircle,
  Upload,
  Sparkles,
  Trash2,
  Edit3,
  ArrowRight,
  Database,
  FileSpreadsheet,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import Badge from "@/components/ui/Badge";
import Drawer from "@/components/ui/Drawer";
import { API_URL, apiFetch } from "@/lib/api";

interface DistributorItem {
  id: number;
  code: string;
  name: string;
  tax_code: string;
  phone: string;
  email: string;
  address: string;
  representative_name: string;
  status: string;
  supplier_config_count: number;
  invoice_config_count: number;
  issued_invoice_count: number;
}

interface SupplierConfigItem {
  id: number;
  distributor_id: number;
  distributor_code: string;
  distributor_name: string;
  supplier_code: string;
  supplier_name: string;
  connector_type: string;
  api_endpoint_url: string;
  auth_type: string;
  username: string;
  has_secret: boolean;
  has_cookie: boolean;
  field_mapping: Record<string, string>;
  request_config: Record<string, unknown>;
  status: string;
  last_synced_at: string | null;
}

interface InvoiceConfigItem {
  id: number;
  distributor_id: number;
  distributor_code: string;
  distributor_name: string;
  config_name: string;
  provider: string;
  api_url: string;
  app_id: string;
  username: string;
  invoice_template_code: string;
  invoice_series: string;
  default_vat_rate: number;
  combine_orders: boolean;
  promo_handling: string;
  discount_display: string;
  product_code_source: string;
  default_payment_method: string;
  seller_bank_account: string;
  seller_bank_name: string;
  form_layout_config: {
    header_title?: string;
    theme_color?: string;
    show_order_ref?: boolean;
    footer_note?: string;
  };
  auto_sign: boolean;
  is_default: boolean;
  status: string;
}

const CANONICAL_FIELDS: Array<{ key: string; label: string; group: string }> = [
  { key: "order_number", label: "Số đơn hàng", group: "Thông tin Đơn" },
  { key: "order_date", label: "Ngày đơn hàng", group: "Thông tin Đơn" },
  { key: "delivery_date", label: "Ngày giao hàng", group: "Thông tin Đơn" },
  { key: "customer_code", label: "Mã khách hàng", group: "Khách hàng" },
  { key: "customer_name", label: "Tên khách hàng", group: "Khách hàng" },
  { key: "customer_tax_code", label: "Mã số thuế người mua", group: "Khách hàng" },
  { key: "customer_address", label: "Địa chỉ giao/xuất HĐ", group: "Khách hàng" },
  { key: "product_code", label: "Mã sản phẩm (SKU)", group: "Hàng hóa & Tiền" },
  { key: "product_name", label: "Tên sản phẩm", group: "Hàng hóa & Tiền" },
  { key: "unit", label: "Đơn vị tính", group: "Hàng hóa & Tiền" },
  { key: "quantity", label: "Số lượng bán", group: "Hàng hóa & Tiền" },
  { key: "promo_quantity", label: "Số lượng khuyến mãi", group: "Hàng hóa & Tiền" },
  { key: "unit_price", label: "Đơn giá", group: "Hàng hóa & Tiền" },
  { key: "discount_amount", label: "Tiền chiết khấu", group: "Hàng hóa & Tiền" },
  { key: "vat_rate", label: "Thuế suất GTGT (%)", group: "Hàng hóa & Tiền" },
  { key: "line_total", label: "Thành tiền dòng", group: "Hàng hóa & Tiền" },
  { key: "staff_code", label: "Mã NVBH", group: "Nhân viên" },
  { key: "staff_name", label: "Tên NVBH", group: "Nhân viên" },
];

export default function MultiTenantSupplierConfigsPage() {
  const [activeTab, setActiveTab] = useState<"suppliers" | "invoices" | "distributors">("suppliers");
  const [distributors, setDistributors] = useState<DistributorItem[]>([]);
  const [selectedDistributorId, setSelectedDistributorId] = useState<number | null>(null);
  const [supplierConfigs, setSupplierConfigs] = useState<SupplierConfigItem[]>([]);
  const [invoiceConfigs, setInvoiceConfigs] = useState<InvoiceConfigItem[]>([]);
  const [presets, setPresets] = useState<Record<string, Record<string, unknown>>>({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // Drawer states
  const [distDrawerOpen, setDistDrawerOpen] = useState(false);
  const [editingDistId, setEditingDistId] = useState<number | null>(null);
  const [distForm, setDistForm] = useState({
    code: "",
    name: "",
    tax_code: "",
    phone: "",
    email: "",
    address: "",
    representative_name: "",
    status: "active",
  });

  const [supDrawerOpen, setSupDrawerOpen] = useState(false);
  const [editingSupId, setEditingSupId] = useState<number | null>(null);
  const [supForm, setSupForm] = useState<{
    supplier_code: string;
    supplier_name: string;
    connector_type: string;
    api_endpoint_url: string;
    auth_type: string;
    username: string;
    encrypted_secret: string;
    session_cookie: string;
    field_mapping: Record<string, string>;
  }>({
    supplier_code: "MASAN",
    supplier_name: "Masan Consumer (Masan DMS)",
    connector_type: "REST_API",
    api_endpoint_url: "https://dms-api.masangroup.com/v2/distributor/orders",
    auth_type: "BEARER_TOKEN",
    username: "",
    encrypted_secret: "",
    session_cookie: "",
    field_mapping: {},
  });

  const [invDrawerOpen, setInvDrawerOpen] = useState(false);
  const [editingInvId, setEditingInvId] = useState<number | null>(null);
  const [invForm, setInvForm] = useState({
    config_name: "Cấu hình HĐĐT MISA meInvoice",
    provider: "MISA",
    api_url: "https://api.meinvoice.vn/api/v2/itg/invoicepublishing",
    app_id: "",
    username: "",
    encrypted_secret: "",
    invoice_template_code: "1/001",
    invoice_series: "1C26TDD",
    default_vat_rate: 8,
    combine_orders: false,
    promo_handling: "ZERO_PRICE",
    discount_display: "BY_LINE",
    product_code_source: "SUPPLIER_SKU",
    default_payment_method: "TM/CK",
    seller_bank_account: "",
    seller_bank_name: "",
    header_title: "HÓA ĐƠN GIÁ TRỊ GIA TĂNG",
    theme_color: "#0284c7",
    footer_note: "",
    auto_sign: true,
    is_default: true,
  });

  const excelInputRef = useRef<HTMLInputElement>(null);
  const [uploadingSupId, setUploadingSupId] = useState<number | null>(null);

  const loadAll = useCallback(async (distId?: number | null) => {
    setLoading(true);
    setError("");
    try {
      const [distRes, presetRes] = await Promise.all([
        apiFetch(`${API_URL}/einvoice/distributors`),
        apiFetch(`${API_URL}/einvoice/supplier-presets`),
      ]);
      const distList: DistributorItem[] = distRes.ok ? await distRes.json() : [];
      const presetMap = presetRes.ok ? await presetRes.json() : {};
      setDistributors(distList);
      setPresets(presetMap);

      const effectiveDistId = distId ?? selectedDistributorId ?? (distList[0]?.id ?? null);
      if (effectiveDistId && effectiveDistId !== selectedDistributorId) {
        setSelectedDistributorId(effectiveDistId);
      }

      const query = effectiveDistId ? `?distributor_id=${effectiveDistId}` : "";
      const [supRes, invRes] = await Promise.all([
        apiFetch(`${API_URL}/einvoice/supplier-configs${query}`),
        apiFetch(`${API_URL}/einvoice/invoice-configs${query}`),
      ]);
      if (supRes.ok) setSupplierConfigs(await supRes.json());
      if (invRes.ok) setInvoiceConfigs(await invRes.json());
    } catch {
      setError("Không thể tải dữ liệu cấu hình đa Nhà phân phối.");
    } finally {
      setLoading(false);
    }
  }, [selectedDistributorId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const currentDistributor = distributors.find((d) => d.id === selectedDistributorId) ?? null;

  function applySupplierPreset(code: string) {
    const preset = presets[code];
    if (!preset) return;
    setSupForm((prev) => ({
      ...prev,
      supplier_code: code,
      supplier_name: String(preset.supplier_name ?? code),
      connector_type: String(preset.connector_type ?? "REST_API"),
      api_endpoint_url: String(preset.api_endpoint_url ?? ""),
      auth_type: String(preset.auth_type ?? "BEARER_TOKEN"),
      field_mapping: { ...((preset.field_mapping as Record<string, string>) || {}) },
    }));
  }

  async function saveDistributor() {
    setError("");
    setMessage("");
    try {
      const url = editingDistId
        ? `${API_URL}/einvoice/distributors/${editingDistId}`
        : `${API_URL}/einvoice/distributors`;
      const res = await apiFetch(url, {
        method: editingDistId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(distForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Không thể lưu Nhà phân phối.");
      setMessage(editingDistId ? "Đã cập nhật Nhà phân phối." : `Đã tạo Nhà phân phối ${data.code}.`);
      setDistDrawerOpen(false);
      setEditingDistId(null);
      await loadAll(data.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi khi lưu Nhà phân phối.");
    }
  }

  async function saveSupplierConfig() {
    if (!selectedDistributorId) return;
    setError("");
    setMessage("");
    try {
      const url = editingSupId
        ? `${API_URL}/einvoice/supplier-configs/${editingSupId}`
        : `${API_URL}/einvoice/supplier-configs`;
      const res = await apiFetch(url, {
        method: editingSupId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          distributor_id: selectedDistributorId,
          ...supForm,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Không thể lưu cấu hình Nhà cung cấp.");
      setMessage(`Đã lưu cấu hình nguồn dữ liệu & ánh xạ trường cho ${supForm.supplier_code}.`);
      setSupDrawerOpen(false);
      setEditingSupId(null);
      await loadAll(selectedDistributorId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi khi lưu cấu hình Nhà cung cấp.");
    }
  }

  async function syncOrdersFromSupplier(cfg: SupplierConfigItem) {
    setError("");
    setMessage("");
    setLoading(true);
    try {
      const res = await apiFetch(`${API_URL}/einvoice/supplier-configs/${cfg.id}/sync-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Không thể đồng bộ đơn hàng.");
      setMessage(
        `[${cfg.supplier_code}] Đã đồng bộ & chuẩn hóa thành công ${data.synced_orders} đơn hàng (${data.synced_lines} dòng sản phẩm): ${(data.order_numbers || []).join(", ")}`
      );
      await loadAll(selectedDistributorId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi khi đồng bộ đơn hàng từ NCC.");
    } finally {
      setLoading(false);
    }
  }

  async function handleUploadSupplierExcel(file: File) {
    if (!uploadingSupId) return;
    setError("");
    setMessage("");
    setLoading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await apiFetch(`${API_URL}/einvoice/supplier-configs/${uploadingSupId}/upload-excel`, {
        method: "POST",
        body,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Không thể nhập file Excel.");
      setMessage(
        `Đã ánh xạ & nhập thành công ${data.synced_orders} đơn hàng từ file Excel của ${data.supplier_code}!`
      );
      await loadAll(selectedDistributorId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi khi nhập file Excel.");
    } finally {
      setLoading(false);
      setUploadingSupId(null);
    }
  }

  async function saveInvoiceConfig() {
    if (!selectedDistributorId) return;
    setError("");
    setMessage("");
    try {
      const url = editingInvId
        ? `${API_URL}/einvoice/invoice-configs/${editingInvId}`
        : `${API_URL}/einvoice/invoice-configs`;
      const res = await apiFetch(url, {
        method: editingInvId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          distributor_id: selectedDistributorId,
          config_name: invForm.config_name,
          provider: invForm.provider,
          api_url: invForm.api_url,
          app_id: invForm.app_id,
          username: invForm.username,
          encrypted_secret: invForm.encrypted_secret,
          invoice_template_code: invForm.invoice_template_code,
          invoice_series: invForm.invoice_series,
          default_vat_rate: Number(invForm.default_vat_rate),
          combine_orders: invForm.combine_orders,
          promo_handling: invForm.promo_handling,
          discount_display: invForm.discount_display,
          product_code_source: invForm.product_code_source,
          default_payment_method: invForm.default_payment_method,
          seller_bank_account: invForm.seller_bank_account,
          seller_bank_name: invForm.seller_bank_name,
          form_layout_config: {
            header_title: invForm.header_title,
            theme_color: invForm.theme_color,
            show_order_ref: true,
            footer_note: invForm.footer_note,
          },
          auto_sign: invForm.auto_sign,
          is_default: invForm.is_default,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Không thể lưu cấu hình HĐĐT.");
      setMessage(`Đã lưu cấu hình Form & Cổng HĐĐT (${data.provider}).`);
      setInvDrawerOpen(false);
      setEditingInvId(null);
      await loadAll(selectedDistributorId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi khi lưu cấu hình HĐĐT.");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quản lý Đa Nhà Phân Phối, Nguồn Đơn NCC & Mẫu Hóa Đơn"
        subtitle="Mỗi Nhà phân phối tự cấu hình URL & Bảng ánh xạ trường dữ liệu cho từng Nhà cung cấp (Vinamilk, Masan, Unilever...) và Form Hóa đơn điện tử riêng (MISA, Viettel, VNPT)"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                setEditingDistId(null);
                setDistForm({
                  code: "",
                  name: "",
                  tax_code: "",
                  phone: "",
                  email: "",
                  address: "",
                  representative_name: "",
                  status: "active",
                });
                setDistDrawerOpen(true);
              }}
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 text-sm font-medium"
            >
              <Building2 size={16} /> Thêm Nhà Phân Phối
            </button>
            <button
              onClick={() => loadAll(selectedDistributorId)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 text-sm font-medium"
            >
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Làm mới
            </button>
          </div>
        }
      />

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center gap-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}
      {message && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 flex items-center gap-2">
          <CheckCircle2 size={16} /> {message}
        </div>
      )}

      {/* Bộ chọn Nhà phân phối (Tenant Context Bar) */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-500 text-white flex items-center justify-center font-bold">
            NPP
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
              Nhà phân phối đang làm việc (Active Tenant)
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              <select
                value={selectedDistributorId ?? ""}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  setSelectedDistributorId(id);
                  loadAll(id);
                }}
                className="text-base font-bold text-gray-900 bg-gray-50 border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                {distributors.map((d) => (
                  <option key={d.id} value={d.id}>
                    [{d.code}] {d.name} — MST: {d.tax_code || "Chưa cập nhật"}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {currentDistributor && (
          <div className="flex flex-wrap items-center gap-4 text-xs text-gray-600 bg-slate-50 px-4 py-2.5 rounded-lg border border-slate-200">
            <span>
              <strong>Mã số thuế:</strong> {currentDistributor.tax_code || "—"}
            </span>
            <span>•</span>
            <span>
              <strong>Địa chỉ:</strong> {currentDistributor.address || "—"}
            </span>
            <span>•</span>
            <span>
              <strong>Nguồn NCC:</strong> {supplierConfigs.length} hãng
            </span>
            <span>•</span>
            <span>
              <strong>Mẫu HĐĐT:</strong> {invoiceConfigs.length} mẫu
            </span>
          </div>
        )}
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Tổng số Nhà Phân Phối"
          value={distributors.length}
          sub="Độc lập dữ liệu & cấu hình"
          icon={<Building2 size={20} />}
          color="bg-sky-50 text-sky-600"
        />
        <StatCard
          label="Nguồn Đơn Hàng NCC"
          value={supplierConfigs.length}
          sub="URL & Bảng ánh xạ trường động"
          icon={<Database size={20} />}
          color="bg-emerald-50 text-emerald-600"
        />
        <StatCard
          label="Mẫu Form Xuất Hóa Đơn"
          value={invoiceConfigs.length}
          sub="MISA / Viettel / VNPT / EasyInvoice"
          icon={<Receipt size={20} />}
          color="bg-amber-50 text-amber-600"
        />
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 flex gap-2">
        <button
          onClick={() => setActiveTab("suppliers")}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === "suppliers"
              ? "border-sky-500 text-sky-600"
              : "border-transparent text-gray-500 hover:text-gray-800"
          }`}
        >
          <Link2 size={16} /> 1. Nguồn Đơn Hàng NCC & Ánh Xạ Trường ({supplierConfigs.length})
        </button>
        <button
          onClick={() => setActiveTab("invoices")}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === "invoices"
              ? "border-sky-500 text-sky-600"
              : "border-transparent text-gray-500 hover:text-gray-800"
          }`}
        >
          <Receipt size={16} /> 2. Cấu hình Form & Cổng HĐĐT ({invoiceConfigs.length})
        </button>
        <button
          onClick={() => setActiveTab("distributors")}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === "distributors"
              ? "border-sky-500 text-sky-600"
              : "border-transparent text-gray-500 hover:text-gray-800"
          }`}
        >
          <Building2 size={16} /> 3. Danh sách Nhà Phân Phối ({distributors.length})
        </button>
      </div>

      <input
        ref={excelInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleUploadSupplierExcel(f);
          e.target.value = "";
        }}
      />

      {/* TAB 1: SUPPLIER CONFIGS & DYNAMIC FIELD MAPPING */}
      {activeTab === "suppliers" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-gray-900">
                Các nguồn dữ liệu Nhà Cung Cấp của {currentDistributor?.name}
              </h2>
              <p className="text-xs text-gray-500">
                Mỗi Nhà cung cấp có URL kết nối và tên các trường dữ liệu khác nhau, được chuẩn hóa tự động về Canonical Order.
              </p>
            </div>
            <button
              onClick={() => {
                setEditingSupId(null);
                const defaultPreset = presets["MASAN"] || {};
                setSupForm({
                  supplier_code: "MASAN",
                  supplier_name: String(defaultPreset.supplier_name || "Masan Consumer (Masan DMS)"),
                  connector_type: String(defaultPreset.connector_type || "REST_API"),
                  api_endpoint_url: String(
                    defaultPreset.api_endpoint_url || "https://dms-api.masangroup.com/v2/distributor/orders"
                  ),
                  auth_type: String(defaultPreset.auth_type || "BEARER_TOKEN"),
                  username: "",
                  encrypted_secret: "",
                  session_cookie: "",
                  field_mapping: { ...((defaultPreset.field_mapping as Record<string, string>) || {}) },
                });
                setSupDrawerOpen(true);
              }}
              className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-sm"
            >
              <Plus size={16} /> Thêm Nguồn Nhà Cung Cấp
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {supplierConfigs.map((cfg) => (
              <div
                key={cfg.id}
                className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm flex flex-col justify-between space-y-4"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-md bg-sky-100 text-sky-800 font-bold text-xs">
                          {cfg.supplier_code}
                        </span>
                        <h3 className="font-bold text-gray-900 text-base">{cfg.supplier_name}</h3>
                      </div>
                      <p className="text-xs text-gray-500 mt-1 break-all">
                        <strong>URL lấy đơn:</strong> {cfg.api_endpoint_url || "Chưa khai báo"}
                      </p>
                    </div>
                    <Badge variant="info">{cfg.connector_type}</Badge>
                  </div>

                  <div className="bg-slate-50 rounded-lg p-3 border border-slate-200 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-700">
                        Bảng ánh xạ trường dữ liệu (Field Mapping):
                      </span>
                      <span className="text-slate-500">
                        {Object.keys(cfg.field_mapping || {}).length} trường đã ánh xạ
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-xs">
                      {CANONICAL_FIELDS.slice(0, 9).map((f) => (
                        <div
                          key={f.key}
                          className="bg-white px-2 py-1 rounded border border-slate-200 truncate"
                          title={`${f.label}: ${cfg.field_mapping?.[f.key] || "—"}`}
                        >
                          <span className="text-gray-400">{f.label}:</span>{" "}
                          <span className="font-mono font-semibold text-sky-700">
                            {cfg.field_mapping?.[f.key] || "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-gray-100">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => syncOrdersFromSupplier(cfg)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm"
                    >
                      <Sparkles size={14} /> Đồng bộ & Chuẩn hóa Đơn
                    </button>
                    <button
                      onClick={() => {
                        setUploadingSupId(cfg.id);
                        excelInputRef.current?.click();
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-xs font-medium"
                    >
                      <FileSpreadsheet size={14} /> Nhập Excel theo Mapping
                    </button>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        setEditingSupId(cfg.id);
                        setSupForm({
                          supplier_code: cfg.supplier_code,
                          supplier_name: cfg.supplier_name,
                          connector_type: cfg.connector_type,
                          api_endpoint_url: cfg.api_endpoint_url,
                          auth_type: cfg.auth_type,
                          username: cfg.username,
                          encrypted_secret: "",
                          session_cookie: "",
                          field_mapping: { ...(cfg.field_mapping || {}) },
                        });
                        setSupDrawerOpen(true);
                      }}
                      className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-sky-600"
                      title="Cấu hình URL & Ánh xạ trường"
                    >
                      <Edit3 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: INVOICE CONFIGS & DYNAMIC FORM TEMPLATES */}
      {activeTab === "invoices" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-gray-900">
                Cấu hình Form & Cổng Hóa Đơn Điện Tử của {currentDistributor?.name}
              </h2>
              <p className="text-xs text-gray-500">
                Tùy chỉnh nhà mạng (MISA, Viettel, VNPT, EasyInvoice), Ký hiệu, Gộp đơn và cách thể hiện hàng khuyến mãi cho từng NPP.
              </p>
            </div>
            <button
              onClick={() => {
                setEditingInvId(null);
                setInvForm({
                  config_name: `Mẫu HĐĐT Mới - ${currentDistributor?.code || ""}`,
                  provider: "MISA",
                  api_url: "https://api.meinvoice.vn/api/v2/itg/invoicepublishing",
                  app_id: "",
                  username: "",
                  encrypted_secret: "",
                  invoice_template_code: "1/001",
                  invoice_series: "1C26TDD",
                  default_vat_rate: 8,
                  combine_orders: false,
                  promo_handling: "ZERO_PRICE",
                  discount_display: "BY_LINE",
                  product_code_source: "SUPPLIER_SKU",
                  default_payment_method: "TM/CK",
                  seller_bank_account: "",
                  seller_bank_name: "",
                  header_title: "HÓA ĐƠN GIÁ TRỊ GIA TĂNG",
                  theme_color: "#0284c7",
                  footer_note: "",
                  auto_sign: true,
                  is_default: false,
                });
                setInvDrawerOpen(true);
              }}
              className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-sm"
            >
              <Plus size={16} /> Thêm Mẫu Form HĐĐT
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {invoiceConfigs.map((ic) => (
              <div
                key={ic.id}
                className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm flex flex-col justify-between space-y-4"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-md bg-amber-100 text-amber-800 font-bold text-xs">
                          {ic.provider}
                        </span>
                        {ic.is_default && <Badge variant="success">Mặc định</Badge>}
                        <h3 className="font-bold text-gray-900 text-sm">{ic.config_name}</h3>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        Mẫu số: <strong>{ic.invoice_template_code}</strong> • Ký hiệu:{" "}
                        <strong>{ic.invoice_series}</strong> • Thuế GTGT mặc định:{" "}
                        <strong>{ic.default_vat_rate}%</strong>
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs">
                    <div>
                      <span className="text-gray-500">Chế độ gộp đơn:</span>{" "}
                      <strong className="text-gray-900">
                        {ic.combine_orders ? "Gộp nhiều đơn cùng KH" : "Xuất lẻ từng đơn (1-1)"}
                      </strong>
                    </div>
                    <div>
                      <span className="text-gray-500">Hàng khuyến mãi:</span>{" "}
                      <strong className="text-gray-900">
                        {ic.promo_handling === "ZERO_PRICE"
                          ? "Xuất dòng giá 0đ"
                          : ic.promo_handling === "DISCOUNT_LINE"
                          ? "Chiết khấu 100%"
                          : "Ghi chú cuối HĐ"}
                      </strong>
                    </div>
                    <div>
                      <span className="text-gray-500">Mã hàng trên HĐ:</span>{" "}
                      <strong className="text-gray-900">
                        {ic.product_code_source === "DISTRIBUTOR_SKU"
                          ? "Mã NPP nội bộ"
                          : "Mã SKU Nhà cung cấp"}
                      </strong>
                    </div>
                    <div>
                      <span className="text-gray-500">Hiển thị chiết khấu:</span>{" "}
                      <strong className="text-gray-900">
                        {ic.discount_display === "BY_LINE" ? "Theo từng dòng" : "Tổng ở cuối đơn"}
                      </strong>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-gray-100 text-xs">
                  <span className="text-gray-500 truncate max-w-[300px]">
                    API: {ic.api_url || "Sandbox Mode"}
                  </span>
                  <button
                    onClick={() => {
                      setEditingInvId(ic.id);
                      setInvForm({
                        config_name: ic.config_name,
                        provider: ic.provider,
                        api_url: ic.api_url,
                        app_id: ic.app_id,
                        username: ic.username,
                        encrypted_secret: "",
                        invoice_template_code: ic.invoice_template_code,
                        invoice_series: ic.invoice_series,
                        default_vat_rate: ic.default_vat_rate,
                        combine_orders: ic.combine_orders,
                        promo_handling: ic.promo_handling,
                        discount_display: ic.discount_display,
                        product_code_source: ic.product_code_source,
                        default_payment_method: ic.default_payment_method,
                        seller_bank_account: ic.seller_bank_account,
                        seller_bank_name: ic.seller_bank_name,
                        header_title:
                          ic.form_layout_config?.header_title || "HÓA ĐƠN GIÁ TRỊ GIA TĂNG",
                        theme_color: ic.form_layout_config?.theme_color || "#0284c7",
                        footer_note: ic.form_layout_config?.footer_note || "",
                        auto_sign: ic.auto_sign,
                        is_default: ic.is_default,
                      });
                      setInvDrawerOpen(true);
                    }}
                    className="flex items-center gap-1 text-sky-600 hover:text-sky-700 font-semibold"
                  >
                    <Edit3 size={14} /> Chỉnh sửa Form
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: DISTRIBUTORS */}
      {activeTab === "distributors" && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase border-b border-gray-200">
              <tr>
                <th className="px-4 py-3">Mã NPP</th>
                <th className="px-4 py-3">Tên Nhà Phân Phối</th>
                <th className="px-4 py-3">Mã Số Thuế</th>
                <th className="px-4 py-3">Địa chỉ</th>
                <th className="px-4 py-3 text-center">Nguồn NCC</th>
                <th className="px-4 py-3 text-center">Mẫu HĐĐT</th>
                <th className="px-4 py-3 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {distributors.map((d) => (
                <tr key={d.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-bold text-sky-700">{d.code}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{d.name}</td>
                  <td className="px-4 py-3 font-mono text-gray-700">{d.tax_code || "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{d.address || "—"}</td>
                  <td className="px-4 py-3 text-center">{d.supplier_config_count}</td>
                  <td className="px-4 py-3 text-center">{d.invoice_config_count}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => {
                        setEditingDistId(d.id);
                        setDistForm({
                          code: d.code,
                          name: d.name,
                          tax_code: d.tax_code,
                          phone: d.phone,
                          email: d.email,
                          address: d.address,
                          representative_name: d.representative_name,
                          status: d.status,
                        });
                        setDistDrawerOpen(true);
                      }}
                      className="text-sky-600 hover:underline text-xs font-semibold mr-3"
                    >
                      Sửa
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* DRAWER 1: SUPPLIER CONFIG & DYNAMIC FIELD MAPPING */}
      <Drawer
        open={supDrawerOpen}
        onClose={() => setSupDrawerOpen(false)}
        title={
          editingSupId
            ? `Cấu hình Nguồn & Ánh xạ Trường: ${supForm.supplier_code}`
            : "Thêm Nguồn Đơn Hàng Nhà Cung Cấp Mới"
        }
        size="2xl"
      >
        <div className="p-5 space-y-5">
          <div className="bg-sky-50 border border-sky-200 rounded-xl p-3.5 text-xs text-sky-900">
            <strong>Chọn nhanh mẫu Nhà cung cấp (Preset):</strong> Hệ thống sẽ tự điền URL mẫu và bộ tên trường dữ liệu chuẩn của hãng đó.
            <div className="flex flex-wrap gap-2 mt-2">
              {Object.keys(presets).map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => applySupplierPreset(code)}
                  className={`px-3 py-1 rounded-lg font-semibold border transition-colors ${
                    supForm.supplier_code === code
                      ? "bg-sky-600 text-white border-sky-600"
                      : "bg-white text-sky-700 border-sky-300 hover:bg-sky-100"
                  }`}
                >
                  {code}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600">Mã Nhà Cung Cấp *</label>
              <input
                value={supForm.supplier_code}
                onChange={(e) =>
                  setSupForm({ ...supForm, supplier_code: e.target.value.toUpperCase() })
                }
                placeholder="VD: VINAMILK, MASAN, UNILEVER..."
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Tên Nhà Cung Cấp *</label>
              <input
                value={supForm.supplier_name}
                onChange={(e) => setSupForm({ ...supForm, supplier_name: e.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Phương thức kết nối</label>
              <select
                value={supForm.connector_type}
                onChange={(e) => setSupForm({ ...supForm, connector_type: e.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
              >
                <option value="REST_API">REST API (JSON Endpoint)</option>
                <option value="PORTAL_PLAYWRIGHT">DMS Web Portal (HTTP Client / Cookie)</option>
                <option value="EXCEL_DYNAMIC">File Excel Động (Dynamic Column Mapping)</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Kiểu xác thực (Auth Type)</label>
              <select
                value={supForm.auth_type}
                onChange={(e) => setSupForm({ ...supForm, auth_type: e.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
              >
                <option value="BEARER_TOKEN">Bearer Token</option>
                <option value="API_KEY">Header X-API-Key</option>
                <option value="COOKIE">Session Cookie</option>
                <option value="BASIC_AUTH">Username / Password</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-gray-600">
                URL lấy dữ liệu đơn hàng của NCC
              </label>
              <input
                value={supForm.api_endpoint_url}
                onChange={(e) => setSupForm({ ...supForm, api_endpoint_url: e.target.value })}
                placeholder="https://api.supplier.com/v1/orders"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Tài khoản / Client ID</label>
              <input
                value={supForm.username}
                onChange={(e) => setSupForm({ ...supForm, username: e.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">
                Mật khẩu / API Token (Để trống nếu giữ nguyên)
              </label>
              <input
                type="password"
                value={supForm.encrypted_secret}
                onChange={(e) => setSupForm({ ...supForm, encrypted_secret: e.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="border-t border-gray-200 pt-4">
            <h4 className="text-sm font-bold text-gray-900 mb-1">
              Bảng Ánh Xạ Trường Dữ Liệu Động (Dynamic Field Mapping)
            </h4>
            <p className="text-xs text-gray-500 mb-3">
              Khai báo tên trường JSON hoặc tên cột Excel của Nhà cung cấp tương ứng với trường chuẩn của hệ thống:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-80 overflow-y-auto pr-1">
              {CANONICAL_FIELDS.map((field) => (
                <div
                  key={field.key}
                  className="flex items-center justify-between gap-2 bg-gray-50 p-2 rounded-lg border border-gray-200"
                >
                  <div className="min-w-[135px]">
                    <p className="text-xs font-semibold text-gray-800">{field.label}</p>
                    <p className="text-[10px] font-mono text-gray-400">{field.key}</p>
                  </div>
                  <ArrowRight size={13} className="text-gray-400 flex-shrink-0" />
                  <input
                    value={supForm.field_mapping[field.key] || ""}
                    onChange={(e) =>
                      setSupForm({
                        ...supForm,
                        field_mapping: {
                          ...supForm.field_mapping,
                          [field.key]: e.target.value,
                        },
                      })
                    }
                    placeholder="Tên trường nguồn..."
                    className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs font-mono text-sky-800"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
            <button
              onClick={() => setSupDrawerOpen(false)}
              className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600"
            >
              Hủy
            </button>
            <button
              onClick={saveSupplierConfig}
              className="px-5 py-2 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold"
            >
              Lưu cấu hình Nguồn NCC
            </button>
          </div>
        </div>
      </Drawer>

      {/* DRAWER 2: INVOICE FORM & PROVIDER CONFIG */}
      <Drawer
        open={invDrawerOpen}
        onClose={() => setInvDrawerOpen(false)}
        title={
          editingInvId
            ? `Chỉnh sửa Mẫu Form HĐĐT (${invForm.provider})`
            : "Tạo Cấu hình Form & Cổng Hóa Đơn Điện Tử Mới"
        }
        size="xl"
      >
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-gray-600">Tên gợi nhớ cấu hình *</label>
              <input
                value={invForm.config_name}
                onChange={(e) => setInvForm({ ...invForm, config_name: e.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">
                Đơn vị Hóa Đơn Điện Tử (Provider) *
              </label>
              <select
                value={invForm.provider}
                onChange={(e) => setInvForm({ ...invForm, provider: e.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white font-semibold"
              >
                <option value="MISA">MISA meInvoice</option>
                <option value="VIETTEL">Viettel S-Invoice</option>
                <option value="VNPT">VNPT e-Invoice</option>
                <option value="EASYINVOICE">EasyInvoice (Softdreams)</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Thuế suất GTGT mặc định (%)</label>
              <select
                value={invForm.default_vat_rate}
                onChange={(e) =>
                  setInvForm({ ...invForm, default_vat_rate: Number(e.target.value) })
                }
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
              >
                <option value={8}>8% (Nghị định giảm thuế GTGT)</option>
                <option value={10}>10% (Thuế suất tiêu chuẩn)</option>
                <option value={5}>5% (Hàng thiết yếu / nông sản)</option>
                <option value={0}>0% (Không chịu thuế / 0%)</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Mẫu số hóa đơn (Template)</label>
              <input
                value={invForm.invoice_template_code}
                onChange={(e) =>
                  setInvForm({ ...invForm, invoice_template_code: e.target.value })
                }
                placeholder="1/001"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Ký hiệu hóa đơn (Series)</label>
              <input
                value={invForm.invoice_series}
                onChange={(e) =>
                  setInvForm({ ...invForm, invoice_series: e.target.value.toUpperCase() })
                }
                placeholder="1C26TDD"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono"
              />
            </div>

            <div className="sm:col-span-2 bg-amber-50/70 border border-amber-200 rounded-xl p-3.5 space-y-3">
              <p className="text-xs font-bold text-amber-900 uppercase">
                Quy tắc sinh Form Hóa Đơn riêng của NPP
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-700">Chế độ Gộp / Tách đơn</label>
                  <select
                    value={invForm.combine_orders ? "COMBINE" : "SINGLE"}
                    onChange={(e) =>
                      setInvForm({ ...invForm, combine_orders: e.target.value === "COMBINE" })
                    }
                    className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs bg-white"
                  >
                    <option value="SINGLE">Xuất lẻ: 1 Đơn hàng = 1 Hóa đơn</option>
                    <option value="COMBINE">Gộp nhiều đơn cùng Khách hàng = 1 HĐ</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">
                    Cách thể hiện Hàng Khuyến Mãi
                  </label>
                  <select
                    value={invForm.promo_handling}
                    onChange={(e) => setInvForm({ ...invForm, promo_handling: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs bg-white"
                  >
                    <option value="ZERO_PRICE">Xuất dòng riêng - Đơn giá 0đ</option>
                    <option value="DISCOUNT_LINE">Quy thành dòng Chiết khấu 100%</option>
                    <option value="NOTE_ONLY">Chỉ ghi chú ở chân Hóa đơn</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">
                    Mã sản phẩm in trên Hóa đơn
                  </label>
                  <select
                    value={invForm.product_code_source}
                    onChange={(e) =>
                      setInvForm({ ...invForm, product_code_source: e.target.value })
                    }
                    className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs bg-white"
                  >
                    <option value="SUPPLIER_SKU">Mã SKU gốc của Nhà cung cấp</option>
                    <option value="DISTRIBUTOR_SKU">Mã NPP nội bộ đã quy đổi</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">
                    Hiển thị Chiết khấu thương mại
                  </label>
                  <select
                    value={invForm.discount_display}
                    onChange={(e) => setInvForm({ ...invForm, discount_display: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs bg-white"
                  >
                    <option value="BY_LINE">Trừ trực tiếp trên từng dòng hàng</option>
                    <option value="TOTAL_BOTTOM">Tách dòng Chiết khấu tổng cuối đơn</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-gray-600">Tiêu đề Form Hóa Đơn</label>
              <input
                value={invForm.header_title}
                onChange={(e) => setInvForm({ ...invForm, header_title: e.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Số tài khoản Ngân hàng</label>
              <input
                value={invForm.seller_bank_account}
                onChange={(e) => setInvForm({ ...invForm, seller_bank_account: e.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Tên Ngân hàng</label>
              <input
                value={invForm.seller_bank_name}
                onChange={(e) => setInvForm({ ...invForm, seller_bank_name: e.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
            <button
              onClick={() => setInvDrawerOpen(false)}
              className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600"
            >
              Hủy
            </button>
            <button
              onClick={saveInvoiceConfig}
              className="px-5 py-2 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold"
            >
              Lưu Mẫu Form HĐĐT
            </button>
          </div>
        </div>
      </Drawer>

      {/* DRAWER 3: DISTRIBUTOR CREATE/EDIT */}
      <Drawer
        open={distDrawerOpen}
        onClose={() => setDistDrawerOpen(false)}
        title={editingDistId ? "Cập nhật Nhà Phân Phối" : "Thêm Nhà Phân Phối Mới"}
      >
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-600">Mã Nhà Phân Phối *</label>
            <input
              value={distForm.code}
              onChange={(e) => setDistForm({ ...distForm, code: e.target.value.toUpperCase() })}
              placeholder="VD: NPP-MIENBAC"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Tên pháp lý Nhà Phân Phối *</label>
            <input
              value={distForm.name}
              onChange={(e) => setDistForm({ ...distForm, name: e.target.value })}
              placeholder="Công ty TNHH Phân Phối..."
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Mã số thuế (In trên Hóa đơn)</label>
            <input
              value={distForm.tax_code}
              onChange={(e) => setDistForm({ ...distForm, tax_code: e.target.value })}
              placeholder="010xxxxxxx"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Địa chỉ trụ sở</label>
            <input
              value={distForm.address}
              onChange={(e) => setDistForm({ ...distForm, address: e.target.value })}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600">Số điện thoại</label>
              <input
                value={distForm.phone}
                onChange={(e) => setDistForm({ ...distForm, phone: e.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Người đại diện</label>
              <input
                value={distForm.representative_name}
                onChange={(e) =>
                  setDistForm({ ...distForm, representative_name: e.target.value })
                }
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
            <button
              onClick={() => setDistDrawerOpen(false)}
              className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600"
            >
              Hủy
            </button>
            <button
              onClick={saveDistributor}
              className="px-5 py-2 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold"
            >
              Lưu Nhà Phân Phối
            </button>
          </div>
        </div>
      </Drawer>
    </div>
  );
}

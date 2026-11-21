"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Check,
  ChevronDown,
  X,
  Eye,
  EyeOff,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import Badge from "@/components/ui/Badge";
import Drawer from "@/components/ui/Drawer";
import { API_URL, apiFetch } from "@/lib/api";
import { useAuthSession } from "@/lib/auth-session";
import { useDistributorContext } from "@/lib/distributor-context";

interface DistributorItem {
  id: number;
  code: string;
  name: string;
  tax_code: string;
  phone: string;
  email: string;
  address: string;
  representative_name: string;
  company_allocation_mode?: string;
  status: string;
  login_username?: string;
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
  { key: "supplier_name", label: "Nhà cung cấp", group: "Thông tin Đơn" },
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

function FieldMappingCombobox({
  fieldKey,
  fieldLabel,
  value,
  onChange,
  detectedFields,
}: {
  fieldKey: string;
  fieldLabel: string;
  value: string;
  onChange: (val: string) => void;
  detectedFields: Array<{ key: string; sample?: string; type?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const [filterText, setFilterText] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const handleOpen = () => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setOpenUpward(spaceBelow < 250);
    }
    setOpen(true);
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  const selectedField = detectedFields.find(
    (f) => f.key.toLowerCase() === value.trim().toLowerCase()
  );

  const filteredFields = detectedFields.filter((f) => {
    if (!filterText) return true;
    const q = filterText.toLowerCase();
    return (
      f.key.toLowerCase().includes(q) ||
      (f.sample && String(f.sample).toLowerCase().includes(q))
    );
  });

  return (
    <div className="relative w-full min-w-0" ref={containerRef}>
      <div className="flex items-center rounded border border-slate-300 bg-white focus-within:border-sky-500 focus-within:ring-1 focus-within:ring-sky-500">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={handleOpen}
          placeholder="Chọn hoặc gõ tên trường..."
          className="w-full min-w-0 bg-transparent px-2 py-1 text-xs font-mono text-slate-800 placeholder:text-slate-400 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => (open ? setOpen(false) : handleOpen())}
          className="px-1.5 py-1 text-slate-400 hover:text-slate-700 transition-colors"
          tabIndex={-1}
          title="Xem danh sách trường & dữ liệu mẫu từ URL"
        >
          <ChevronDown
            size={14}
            className={open ? "rotate-180 transition-transform" : "transition-transform"}
          />
        </button>
      </div>

      {/* Hiển thị mẫu dữ liệu trực tiếp dưới ô nếu trường đã được chọn */}
      {selectedField && (
        <div
          className="mt-1 flex items-center gap-1.5 text-[10px] text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded truncate"
          title={`Giá trị mẫu từ URL: ${selectedField.sample}`}
        >
          <span className="shrink-0 font-semibold text-emerald-700">✓ Mẫu URL:</span>
          <span className="font-mono truncate text-emerald-900 font-medium">
            {selectedField.sample !== "" && selectedField.sample != null
              ? `"${selectedField.sample}"`
              : "(rỗng)"}
          </span>
          {selectedField.type && (
            <span className="ml-auto shrink-0 text-[9px] text-emerald-600 opacity-75">
              [{selectedField.type}]
            </span>
          )}
        </div>
      )}

      {/* Dropdown danh sách các trường và mẫu trả về */}
      {open && (
        <div
          className={`absolute left-0 right-0 z-50 max-h-64 overflow-hidden rounded-lg border border-slate-300 bg-white shadow-2xl flex flex-col ${
            openUpward ? "bottom-full mb-1" : "top-full mt-1"
          }`}
        >
          {detectedFields.length > 5 && (
            <div className="border-b border-slate-100 p-1.5 bg-slate-50 flex items-center gap-1.5">
              <input
                type="text"
                autoFocus
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Tìm tên trường hoặc giá trị mẫu..."
                className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs focus:border-sky-500 focus:outline-none"
              />
              {filterText && (
                <button
                  type="button"
                  onClick={() => setFilterText("")}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          )}

          <div className="overflow-y-auto max-h-56 divide-y divide-slate-100">
            {value && (
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 transition-colors"
              >
                <X size={12} />
                <span>Bỏ ánh xạ (để trống trường này)</span>
              </button>
            )}

            {filteredFields.length === 0 ? (
              <div className="px-3 py-3 text-center text-xs text-slate-400">
                {detectedFields.length === 0
                  ? "Chưa có trường mẫu. Hãy bấm 'Test Kết Nối & Lấy Mẫu Trường' ở phía trên."
                  : "Không tìm thấy trường khớp với từ khóa tìm kiếm."}
              </div>
            ) : (
              filteredFields.map((f) => {
                const isSelected = f.key.toLowerCase() === value.trim().toLowerCase();
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => {
                      onChange(f.key);
                      setOpen(false);
                      setFilterText("");
                    }}
                    className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left transition-colors ${
                      isSelected
                        ? "bg-sky-50 font-semibold text-sky-900"
                        : "hover:bg-slate-50 text-slate-800"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs font-bold text-sky-700">{f.key}</span>
                        {f.type && (
                          <span className="rounded bg-slate-100 px-1 text-[9px] font-mono text-slate-500">
                            {f.type}
                          </span>
                        )}
                        {isSelected && <Check size={12} className="text-emerald-600 shrink-0" />}
                      </div>
                      <p className="truncate text-[10px] text-slate-500 mt-0.5">
                        Mẫu:{" "}
                        <span className="font-mono text-slate-700">
                          {f.sample !== "" && f.sample != null ? `"${f.sample}"` : "(rỗng)"}
                        </span>
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function MultiTenantSupplierConfigsPage() {
  const authSession = useAuthSession();
  const {
    effectiveDistributorId,
    setSelectedDistributorId: setGlobalDistributorId,
    refreshDistributors,
  } = useDistributorContext();
  const isNppScoped = Boolean(authSession.distributorId);
  const [activeTab, setActiveTab] = useState<"suppliers" | "invoices" | "distributors">("suppliers");
  const [distributors, setDistributors] = useState<DistributorItem[]>([]);
  const [selectedDistributorId, setSelectedDistributorId] = useState<number | null>(
    effectiveDistributorId ?? authSession.distributorId ?? null
  );

  useEffect(() => {
    if (effectiveDistributorId !== null && effectiveDistributorId !== selectedDistributorId) {
      setSelectedDistributorId(effectiveDistributorId);
    }
  }, [effectiveDistributorId, selectedDistributorId]);
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
    company_allocation_mode: "BY_CUSTOMER",
    status: "active",
    login_username: "",
    login_password: "",
  });

  const [supDrawerOpen, setSupDrawerOpen] = useState(false);
  const [editingSupId, setEditingSupId] = useState<number | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [supForm, setSupForm] = useState<{
    supplier_code: string;
    supplier_name: string;
    connector_type: string;
    api_endpoint_url: string;
    auth_type: string;
    username: string;
    distributor_code: string;
    encrypted_secret: string;
    has_secret: boolean;
    session_cookie: string;
    field_mapping: Record<string, string>;
  }>({
    supplier_code: "MASAN",
    supplier_name: "Masan Consumer (Masan DMS)",
    connector_type: "PORTAL_PLAYWRIGHT",
    api_endpoint_url: "https://dms-api.masangroup.com/v2/distributor/orders",
    auth_type: "BEARER_TOKEN",
    username: "",
    distributor_code: "",
    encrypted_secret: "",
    has_secret: false,
    session_cookie: "",
    field_mapping: {},
  });

  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    is_live: boolean;
    message: string;
    detected_fields: Array<{ key: string; sample: string; type: string }>;
    sample_row: Record<string, unknown>;
    sample_rows?: Array<Record<string, unknown>>;
  } | null>(null);

  const availableDetectedFields = useMemo(() => {
    if (testResult?.detected_fields && testResult.detected_fields.length > 0) {
      return testResult.detected_fields;
    }
    const currentPreset = presets[supForm.supplier_code];
    if (currentPreset && typeof currentPreset.field_mapping === "object" && currentPreset.field_mapping) {
      const mapping = currentPreset.field_mapping as Record<string, string>;
      return Object.values(mapping)
        .filter(Boolean)
        .map((fieldVal) => ({
          key: fieldVal,
          sample: `Mẫu chuẩn ${supForm.supplier_code}`,
          type: "str",
        }));
    }
    return [];
  }, [testResult, presets, supForm.supplier_code]);

  const displaySampleRows = useMemo(() => {
    if (testResult?.sample_rows && testResult.sample_rows.length > 0) {
      return testResult.sample_rows.slice(0, 10);
    }
    if (testResult?.sample_row && Object.keys(testResult.sample_row).length > 0) {
      return [testResult.sample_row];
    }
    return [];
  }, [testResult]);

  const handleColumnMappingChange = (colKey: string, newCanonicalKey: string) => {
    setSupForm((prev) => {
      const nextMapping = { ...prev.field_mapping };
      // Xóa ánh xạ cũ của cột này nếu có
      for (const [k, v] of Object.entries(nextMapping)) {
        if (v === colKey) {
          delete nextMapping[k];
        }
      }
      // Nếu chọn trường chuẩn mới, gán vào cột này
      if (newCanonicalKey) {
        delete nextMapping[newCanonicalKey];
        nextMapping[newCanonicalKey] = colKey;
      }
      return { ...prev, field_mapping: nextMapping };
    });
  };

  const autoMapColumnsFromData = useCallback(() => {
    const newMapping: Record<string, string> = {};
    availableDetectedFields.forEach((f) => {
      const col = f.key.toLowerCase().trim();
      if (col === "số đơn hàng" || col === "code" || col === "ordernumber" || col === "ordercode" || col === "mã đơn hàng") {
        newMapping["order_number"] = f.key;
      } else if (col === "ngày đơn hàng" || col === "ngày" || col === "purchasedate" || col === "orderdate" || col === "createddate") {
        newMapping["order_date"] = f.key;
      } else if (col === "ngày giao hàng" || col === "deliverydate") {
        newMapping["delivery_date"] = f.key;
      } else if (col === "nhà cung cấp" || col === "ncc" || col === "supplier" || col === "suppliername") {
        newMapping["supplier_name"] = f.key;
      } else if (col === "mã kh" || col === "customercode" || col === "mã khách hàng") {
        newMapping["customer_code"] = f.key;
      } else if (col === "tên kh" || col === "customername" || col === "tên khách hàng") {
        newMapping["customer_name"] = f.key;
      } else if (col === "mã số thuế" || col === "taxcode" || col === "customertaxcode") {
        newMapping["customer_tax_code"] = f.key;
      } else if (col === "địa chỉ" || col === "address" || col === "customeraddress") {
        newMapping["customer_address"] = f.key;
      } else if (col === "mã sản phẩm" || col === "productcode" || col === "sku") {
        newMapping["product_code"] = f.key;
      } else if (col === "tên sản phẩm" || col === "sản phẩm" || col === "productname") {
        newMapping["product_name"] = f.key;
      } else if (col === "đvt" || col === "unit") {
        newMapping["unit"] = f.key;
      } else if (col === "số lượng" || col === "quantity" || col === "totalquantity") {
        newMapping["quantity"] = f.key;
      } else if (col === "số lượng km" || col === "promoquantity" || col === "promotionquantity") {
        newMapping["promo_quantity"] = f.key;
      } else if (col === "giá bán" || col === "đơn giá" || col === "price" || col === "unitprice") {
        newMapping["unit_price"] = f.key;
      } else if (col === "số tiền ck" || col === "chiết khấu" || col === "discount" || col === "discountamount") {
        newMapping["discount_amount"] = f.key;
      } else if (col === "thuế suất" || col === "vat" || col === "vatrate") {
        newMapping["vat_rate"] = f.key;
      } else if (col === "thành tiền" || col === "giá trị" || col === "total" || col === "totalpayment" || col === "linetotal") {
        newMapping["line_total"] = f.key;
      } else if (col === "mã nvbh" || col === "staffcode") {
        newMapping["staff_code"] = f.key;
      } else if (col === "tên nvbh" || col === "staffname") {
        newMapping["staff_name"] = f.key;
      }
    });
    setSupForm((prev) => ({
      ...prev,
      field_mapping: { ...prev.field_mapping, ...newMapping },
    }));
  }, [availableDetectedFields]);

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
  const [deletingSupId, setDeletingSupId] = useState<number | null>(null);
  const [deletingDistId, setDeletingDistId] = useState<number | null>(null);

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

      const effectiveDistId =
        authSession.distributorId ??
        effectiveDistributorId ??
        distId ??
        selectedDistributorId ??
        (distList[0]?.id ?? null);
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
  }, [authSession.distributorId, effectiveDistributorId, selectedDistributorId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const currentDistributor = distributors.find((d) => d.id === selectedDistributorId) ?? null;

  function applySupplierPreset(code: string) {
    const preset = presets[code];
    if (!preset) return;
    let defaultUrl = String(preset.api_endpoint_url ?? "");
    if (code === "KIOTVIET" && (!defaultUrl || defaultUrl.includes("public.kiotapi.com"))) {
      defaultUrl = "https://api-man1.kiotviet.vn/api/invoices?format=json&$top=15";
    } else if (code === "NAZZY" && !defaultUrl) {
      defaultUrl = "http://dms21.nazzy.vn/handler/BillsHandler.ashx";
    }
    setSupForm((prev) => ({
      ...prev,
      supplier_code: code,
      supplier_name: String(preset.supplier_name ?? code),
      connector_type: String(preset.connector_type ?? "PORTAL_PLAYWRIGHT"),
      api_endpoint_url: prev.api_endpoint_url && editingSupId ? prev.api_endpoint_url : defaultUrl,
      auth_type: String(preset.auth_type ?? (code === "NAZZY" ? "COOKIE" : "BEARER_TOKEN")),
      distributor_code:
        code === "NAZZY"
          ? (prev.distributor_code || "MAITRUNG")
          : prev.distributor_code,
      field_mapping: { ...((preset.field_mapping as Record<string, string>) || {}) },
    }));
  }

  async function deleteDistributor(dist: DistributorItem) {
    const accountHint = dist.login_username ? ` và tài khoản đăng nhập @${dist.login_username}` : "";
    if (
      !window.confirm(
        `Bạn có chắc muốn xóa Nhà phân phối [${dist.code}] ${dist.name}${accountHint}?\n\nLưu ý: Các cấu hình nguồn NCC, mẫu HĐĐT và tài khoản CQT thuộc NPP này cũng sẽ bị xóa.`,
      )
    ) {
      return;
    }
    setDeletingDistId(dist.id);
    setError("");
    setMessage("");
    try {
      const res = await apiFetch(`${API_URL}/einvoice/distributors/${dist.id}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => ({}))) as { detail?: string; deleted_users?: number };
      if (!res.ok) throw new Error(data.detail || "Không thể xóa Nhà phân phối.");
      if (effectiveDistributorId === dist.id) {
        setGlobalDistributorId(null);
      }
      refreshDistributors();
      setMessage(
        `Đã xóa Nhà phân phối [${dist.code}] ${dist.name}${
          data.deleted_users ? ` (kèm ${data.deleted_users} tài khoản đăng nhập)` : ""
        }.`,
      );
      await loadAll(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi khi xóa Nhà phân phối.");
    } finally {
      setDeletingDistId(null);
    }
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

  async function handleTestConnection() {
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await apiFetch(`${API_URL}/einvoice/supplier-configs/test-connection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connector_type: supForm.connector_type,
          api_endpoint_url: supForm.api_endpoint_url,
          auth_type: supForm.auth_type,
          username: supForm.username,
          encrypted_secret: supForm.encrypted_secret,
          session_cookie: supForm.session_cookie,
          supplier_code: supForm.supplier_code,
          request_config: {
            distributor_code: supForm.distributor_code,
          },
        }),
      });
      const data = await res.json();
      setTestResult(data);
      if (data.detected_fields && data.detected_fields.length > 0) {
        const newMapping: Record<string, string> = { ...supForm.field_mapping };
        data.detected_fields.forEach((f: { key: string }) => {
          const col = f.key.toLowerCase().trim();
          if (col === "số đơn hàng" || col === "code" || col === "ordernumber" || col === "ordercode" || col === "mã đơn hàng") {
            newMapping["order_number"] = f.key;
          } else if (col === "ngày đơn hàng" || col === "ngày" || col === "purchasedate" || col === "orderdate" || col === "createddate") {
            newMapping["order_date"] = f.key;
          } else if (col === "ngày giao hàng" || col === "deliverydate") {
            newMapping["delivery_date"] = f.key;
          } else if (col === "mã kh" || col === "customercode" || col === "mã khách hàng") {
            newMapping["customer_code"] = f.key;
          } else if (col === "tên kh" || col === "customername" || col === "tên khách hàng") {
            newMapping["customer_name"] = f.key;
          } else if (col === "mã số thuế" || col === "taxcode" || col === "customertaxcode") {
            newMapping["customer_tax_code"] = f.key;
          } else if (col === "địa chỉ" || col === "address" || col === "customeraddress") {
            newMapping["customer_address"] = f.key;
          } else if (col === "mã sản phẩm" || col === "productcode" || col === "sku") {
            newMapping["product_code"] = f.key;
          } else if (col === "tên sản phẩm" || col === "sản phẩm" || col === "productname") {
            newMapping["product_name"] = f.key;
          } else if (col === "đvt" || col === "unit") {
            newMapping["unit"] = f.key;
          } else if (col === "số lượng" || col === "quantity" || col === "totalquantity") {
            newMapping["quantity"] = f.key;
          } else if (col === "số lượng km" || col === "promoquantity" || col === "promotionquantity") {
            newMapping["promo_quantity"] = f.key;
          } else if (col === "giá bán" || col === "đơn giá" || col === "price" || col === "unitprice") {
            newMapping["unit_price"] = f.key;
          } else if (col === "số tiền ck" || col === "chiết khấu" || col === "discount" || col === "discountamount") {
            newMapping["discount_amount"] = f.key;
          } else if (col === "thuế suất" || col === "vat" || col === "vatrate") {
            newMapping["vat_rate"] = f.key;
          } else if (col === "thành tiền" || col === "giá trị" || col === "total" || col === "totalpayment" || col === "linetotal") {
            newMapping["line_total"] = f.key;
          } else if (col === "mã nvbh" || col === "staffcode") {
            newMapping["staff_code"] = f.key;
          } else if (col === "tên nvbh" || col === "staffname") {
            newMapping["staff_name"] = f.key;
          }
        });
        setSupForm((prev) => ({ ...prev, field_mapping: newMapping }));
      }
    } catch (err) {
      setTestResult({
        success: false,
        is_live: false,
        message: err instanceof Error ? err.message : "Lỗi khi kiểm tra kết nối.",
        detected_fields: [],
        sample_row: {},
      });
    } finally {
      setTestLoading(false);
    }
  }

  function autoMapFields() {
    if (!testResult?.detected_fields?.length) return;
    const detectedKeys = testResult.detected_fields.map((f) => f.key);
    const newMapping = { ...supForm.field_mapping };

    CANONICAL_FIELDS.forEach((cf) => {
      const match = detectedKeys.find((dk) => {
        const dkl = dk.toLowerCase();
        if (dkl === cf.key.toLowerCase()) return true;
        if (cf.key === "order_number" && (dkl.includes("order") || dkl === "code" || dkl === "so_don" || dkl.includes("docnum"))) return true;
        if (cf.key === "order_date" && (dkl.includes("date") || dkl.includes("ngay") || dkl === "createddate")) return true;
        if (cf.key === "delivery_date" && (dkl.includes("deliv") || dkl.includes("ship") || dkl === "modifieddate")) return true;
        if (cf.key === "supplier_name" && (dkl.includes("supplier") || dkl.includes("nhacungcap") || dkl.includes("nhà cung cấp") || dkl === "ncc")) return true;
        if (cf.key === "customer_code" && ((dkl.includes("cust") && dkl.includes("code")) || dkl === "customercode" || dkl.includes("makh"))) return true;
        if (cf.key === "customer_name" && ((dkl.includes("cust") && dkl.includes("name")) || dkl === "customername" || dkl.includes("tenkh"))) return true;
        if (cf.key === "customer_tax_code" && (dkl.includes("tax") || dkl.includes("mst"))) return true;
        if (cf.key === "customer_address" && (dkl.includes("addr") || dkl.includes("diachi"))) return true;
        if (cf.key === "product_code" && ((dkl.includes("prod") && dkl.includes("code")) || dkl === "productcode" || dkl.includes("sku") || dkl.includes("itemcode") || dkl.includes("masanpham"))) return true;
        if (cf.key === "product_name" && ((dkl.includes("prod") && dkl.includes("name")) || dkl === "productname" || dkl.includes("itemname") || dkl.includes("tensanpham"))) return true;
        if (cf.key === "unit" && (dkl === "unit" || dkl === "uom" || dkl.includes("dvt"))) return true;
        if (cf.key === "quantity" && (dkl === "quantity" || dkl === "qty" || dkl.includes("soluong"))) return true;
        if (cf.key === "promo_quantity" && (dkl.includes("bonus") || dkl.includes("free") || dkl.includes("km"))) return true;
        if (cf.key === "unit_price" && (dkl === "price" || dkl === "unitprice" || dkl.includes("giaban") || dkl.includes("dongia"))) return true;
        if (cf.key === "discount_amount" && (dkl.includes("disc") || dkl.includes("chietkhau") || dkl.includes("ck"))) return true;
        if (cf.key === "vat_rate" && (dkl.includes("vat") || dkl.includes("taxrate") || dkl.includes("thue"))) return true;
        if (cf.key === "line_total" && (dkl === "subtotal" || dkl === "total" || dkl.includes("thanhtien") || dkl.includes("giatri"))) return true;
        if (cf.key === "staff_code" && (dkl.includes("staff") || dkl.includes("usercode") || dkl.includes("nvbh"))) return true;
        if (cf.key === "staff_name" && (dkl.includes("username") || dkl.includes("tennv"))) return true;
        return false;
      });
      if (match) {
        newMapping[cf.key] = match;
      }
    });

    setSupForm({ ...supForm, field_mapping: newMapping });
    setMessage("Đã tự động ánh xạ các trường khớp với dữ liệu Nhà cung cấp!");
  }

  async function saveSupplierConfig() {
    if (!selectedDistributorId) return;
    setError("");
    setMessage("");
    try {
      const url = editingSupId
        ? `${API_URL}/einvoice/supplier-configs/${editingSupId}`
        : `${API_URL}/einvoice/supplier-configs`;
      let res = await apiFetch(url, {
        method: editingSupId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          distributor_id: selectedDistributorId,
          ...supForm,
          request_config: {
            distributor_code: supForm.distributor_code,
          },
        }),
      });

      // Nếu PATCH bị 404 (do ID cũ không còn tồn tại trong DB), tự động POST tạo mới
      if (!res.ok && res.status === 404 && editingSupId) {
        res = await apiFetch(`${API_URL}/einvoice/supplier-configs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            distributor_id: selectedDistributorId,
            ...supForm,
            request_config: {
              distributor_code: supForm.distributor_code,
            },
          }),
        });
      }

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

  async function deleteSupplierConfig(cfg: SupplierConfigItem) {
    if (
      !window.confirm(
        `Xóa cấu hình Nhà cung cấp ${cfg.supplier_name} (${cfg.supplier_code})? Thao tác này không thể hoàn tác.`
      )
    ) {
      return;
    }

    setError("");
    setMessage("");
    setDeletingSupId(cfg.id);
    try {
      const res = await apiFetch(`${API_URL}/einvoice/supplier-configs/${cfg.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Không thể xóa cấu hình Nhà cung cấp.");
      setMessage(`Đã xóa cấu hình Nhà cung cấp ${cfg.supplier_name} (${cfg.supplier_code}).`);
      await loadAll(selectedDistributorId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi khi xóa cấu hình Nhà cung cấp.");
    } finally {
      setDeletingSupId(null);
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
        title={
          isNppScoped
            ? `Cấu hình Nguồn Đơn NCC & Mẫu Hóa Đơn — ${currentDistributor?.name || authSession.distributorName}`
            : "Quản lý Đa Nhà Phân Phối, Nguồn Đơn NCC & Mẫu Hóa Đơn"
        }
        subtitle="Mỗi Nhà phân phối tự cấu hình URL & Bảng ánh xạ trường dữ liệu cho từng Nhà cung cấp (Vinamilk, Masan, Unilever...) và Form Hóa đơn điện tử riêng (MISA, Viettel, VNPT)"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {!isNppScoped && (
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
                    company_allocation_mode: "BY_CUSTOMER",
                    status: "active",
                    login_username: "",
                    login_password: "",
                  });
                  setDistDrawerOpen(true);
                }}
                className="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 text-sm font-medium"
              >
                <Building2 size={16} /> Thêm Nhà Phân Phối
              </button>
            )}
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

      {/* Thông tin Nhà phân phối đang làm việc (đồng bộ trực tiếp từ thanh Phạm vi NPP trên Header) */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-500 text-white flex items-center justify-center font-bold shrink-0">
            NPP
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">
              Nhà phân phối đang làm việc (đồng bộ từ thanh Phạm vi NPP)
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              {currentDistributor ? (
                <span className="text-base font-bold text-gray-900">
                  [{currentDistributor.code}] {currentDistributor.name}
                </span>
              ) : (
                <span className="text-sm italic text-gray-500">Chưa chọn Nhà phân phối</span>
              )}
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-gray-900">
                Các nguồn dữ liệu Nhà Cung Cấp của {currentDistributor?.name}
              </h2>
              <p className="text-xs text-gray-500">
                Mỗi Nhà cung cấp có URL kết nối và tên các trường dữ liệu khác nhau, được chuẩn hóa tự động về Canonical Order.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditingSupId(null);
                  const defaultPreset = presets["MASAN"] || {};
                  setSupForm({
                    supplier_code: "MASAN",
                    supplier_name: String(defaultPreset.supplier_name || "Masan Consumer (Masan DMS)"),
                    connector_type: "PORTAL_PLAYWRIGHT",
                    api_endpoint_url: String(
                      defaultPreset.api_endpoint_url || "https://dms-api.masangroup.com/v2/distributor/orders"
                    ),
                    auth_type: String(defaultPreset.auth_type || "BEARER_TOKEN"),
                    username: "",
                    distributor_code: "",
                    encrypted_secret: "",
                    has_secret: false,
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
                      <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[11px]">
                        <span className="text-slate-600">
                          Tài khoản: <strong className="font-mono text-slate-800">{cfg.username || "Chưa nhập"}</strong>
                        </span>
                        <span className="text-slate-300">•</span>
                        {cfg.has_secret ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 size={11} className="text-emerald-600" /> Đã lưu mật khẩu
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                            <AlertCircle size={11} className="text-amber-600" /> Chưa có mật khẩu
                          </span>
                        )}
                        {cfg.has_cookie && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-50 text-sky-700 border border-sky-200">
                            ✓ Session Cookie
                          </span>
                        )}
                      </div>
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
                  <div className="flex flex-wrap items-center gap-2">
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
                        let url = cfg.api_endpoint_url || "";
                        if (cfg.supplier_code === "KIOTVIET" && (!url || url.includes("public.kiotapi.com"))) {
                          url = "https://api-man1.kiotviet.vn/api/invoices?format=json&$top=15";
                        }
                        const reqCfg = cfg.request_config || {};
                        const distCode = String(reqCfg.distributor_code || reqCfg.distributorCode || "");
                        setSupForm({
                          supplier_code: cfg.supplier_code,
                          supplier_name: cfg.supplier_name,
                          connector_type: cfg.connector_type,
                          api_endpoint_url: url,
                          auth_type: cfg.auth_type,
                          username: cfg.username,
                          distributor_code: distCode,
                          encrypted_secret: "",
                          has_secret: Boolean(cfg.has_secret),
                          session_cookie: "",
                          field_mapping: { ...(cfg.field_mapping || {}) },
                        });
                        setShowSecret(false);
                        setSupDrawerOpen(true);
                      }}
                      className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-sky-600"
                      title="Cấu hình URL & Ánh xạ trường"
                    >
                      <Edit3 size={15} />
                    </button>
                    <button
                      onClick={() => deleteSupplierConfig(cfg)}
                      disabled={deletingSupId === cfg.id}
                      className="p-1.5 rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                      title="Xóa cấu hình Nhà cung cấp"
                      aria-label={`Xóa cấu hình Nhà cung cấp ${cfg.supplier_name}`}
                    >
                      <Trash2 size={15} />
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
                <th className="px-4 py-3">Tài khoản đăng nhập</th>
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
                  <td className="px-4 py-3">
                    {d.login_username ? (
                      <span className="inline-flex items-center gap-1 rounded bg-sky-50 border border-sky-200 px-2 py-0.5 font-mono text-xs font-semibold text-sky-800">
                        @{d.login_username}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">Chưa cấp</span>
                    )}
                  </td>
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
                          company_allocation_mode: d.company_allocation_mode || "BY_CUSTOMER",
                          status: d.status,
                          login_username: d.login_username || "",
                          login_password: "",
                        });
                        setDistDrawerOpen(true);
                      }}
                      className="text-sky-600 hover:underline text-xs font-semibold mr-3"
                    >
                      Sửa / Tài khoản
                    </button>
                    {!isNppScoped && (
                      <button
                        type="button"
                        disabled={deletingDistId === d.id}
                        onClick={() => void deleteDistributor(d)}
                        className="text-red-600 hover:underline text-xs font-semibold disabled:opacity-50"
                      >
                        {deletingDistId === d.id ? "Đang xóa..." : "Xóa"}
                      </button>
                    )}
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
        onClose={() => {
          setSupDrawerOpen(false);
          setEditingSupId(null);
        }}
        title={
          editingSupId
            ? `Cấu hình Nguồn & Ánh xạ Trường: ${supForm.supplier_code}`
            : "Thêm Nguồn Đơn Hàng Nhà Cung Cấp Mới"
        }
        size="wide"
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
                <option value="PORTAL_PLAYWRIGHT">HTTP Client (Cookie)</option>
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
            {supForm.supplier_code === "NAZZY" && (
              <div className="sm:col-span-2 rounded-lg border border-sky-300 bg-sky-50/70 p-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-wide text-sky-800">
                    Mã Doanh Nghiệp Nazzy (txtDistributor) *
                  </label>
                  <span className="rounded bg-sky-200/80 px-2 py-0.5 text-[10px] font-semibold text-sky-900">
                    Bắt buộc cho Nazzy DMS
                  </span>
                </div>
                <input
                  value={supForm.distributor_code}
                  onChange={(e) =>
                    setSupForm({ ...supForm, distributor_code: e.target.value.toUpperCase() })
                  }
                  placeholder="VD: MAITRUNG (Tên DN trên màn hình đăng nhập web Nazzy)"
                  className="mt-1.5 w-full rounded-lg border border-sky-300 bg-white px-3 py-2 text-sm font-mono font-bold uppercase text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Hệ thống tự động sử dụng Mã DN này cùng Mã NV và Mật khẩu để đăng nhập HTTP thuần lấy Session Cookie xác thực, sau đó kéo đơn hàng từ Nazzy DMS.
                </p>
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-gray-600">
                {supForm.supplier_code === "NAZZY"
                  ? "Mã Nhân viên / Tài khoản Nazzy (txtCode) *"
                  : supForm.supplier_code === "KIOTVIET"
                  ? "Tài khoản (KiotViet: ctyquyanhna/TênĐăngNhập)"
                  : "Tài khoản đăng nhập"}
              </label>
              <input
                value={supForm.username}
                onChange={(e) => setSupForm({ ...supForm, username: e.target.value })}
                placeholder={
                  supForm.supplier_code === "NAZZY"
                    ? "VD: AVL4HrI... hoặc Tên NV"
                    : "VD: ctyquyanhna/0364341308"
                }
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-gray-600">
                  {supForm.supplier_code === "NAZZY"
                    ? "Mật khẩu Nazzy (txtPassword)"
                    : "Mật khẩu / Token JWT / Cookie"}
                </label>
                {supForm.has_secret && (
                  <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 border border-emerald-300">
                    <CheckCircle2 size={11} className="text-emerald-600" /> Đã lưu mật khẩu
                  </span>
                )}
              </div>
              <div className="relative mt-1">
                <input
                  type={showSecret ? "text" : "password"}
                  value={supForm.encrypted_secret}
                  onChange={(e) => setSupForm({ ...supForm, encrypted_secret: e.target.value })}
                  placeholder={
                    supForm.has_secret
                      ? "•••••••• (Đã lưu trong hệ thống — để trống nếu không đổi)"
                      : supForm.supplier_code === "NAZZY"
                      ? "Nhập mật khẩu Nazzy (txtPassword)"
                      : "VD: Bearer eyJ... hoặc Mật khẩu"
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-9 text-xs font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret(!showSecret)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  title={showSecret ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                >
                  {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              {supForm.has_secret ? (
                <p className="mt-1 text-[11px] text-emerald-700 flex items-center gap-1">
                  <CheckCircle2 size={12} className="text-emerald-600 shrink-0" />
                  Hệ thống đã lưu mật khẩu an toàn. Chỉ cần nhập vào đây khi bạn muốn đổi mật khẩu mới.
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-gray-400">
                  Nhập mật khẩu dùng để xác thực và đồng bộ đơn hàng.
                </p>
              )}
            </div>
          </div>

          {/* NÚT TEST KẾT NỐI & LẤY MẪU TRƯỜNG DỮ LIỆU */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                  <Sparkles size={14} className="text-amber-500" /> Kiểm tra kết nối & Phân tích cấu trúc dữ liệu
                </p>
                <p className="text-[11px] text-gray-500">
                  Gửi thử yêu cầu tới URL của NCC để lấy mẫu các trường dữ liệu thực tế và hỗ trợ ánh xạ tự động.
                </p>
              </div>
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testLoading}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-sm transition-colors disabled:opacity-50"
              >
                <RefreshCw size={13} className={testLoading ? "animate-spin" : ""} />
                {testLoading ? "Đang gọi thử URL..." : "Test Kết Nối & Lấy Mẫu Trường"}
              </button>
            </div>

            {testResult && (
              <div
                className={`p-3 rounded-lg border text-xs space-y-2 ${
                  testResult.is_live
                    ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                    : testResult.success
                    ? "bg-amber-50 border-amber-200 text-amber-800"
                    : "bg-red-50 border-red-200 text-red-800"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold flex items-center gap-1.5">
                    {testResult.is_live ? (
                      <CheckCircle2 size={14} className="text-emerald-600" />
                    ) : (
                      <AlertCircle size={14} />
                    )}
                    {testResult.message}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* BẢNG DỮ LIỆU THỰC TẾ & CHỌN ÁNH XẠ TRỰC TIẾP TRÊN CỘT */}
          <div className="border border-slate-300 rounded overflow-hidden shadow-xs bg-white">
            <div className="bg-[#14263d] px-3.5 py-2.5 text-white flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Database size={16} className="text-emerald-400" />
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wide">
                    Bảng Dữ Liệu Thực Tế & Chọn Ánh Xạ Trực Tiếp Trên Từng Cột
                  </h4>
                  <p className="text-[10px] text-slate-300">
                    Chọn trường hệ thống tương ứng ngay tại dòng "Ánh xạ:" ở đầu mỗi cột dữ liệu thực tế bên dưới.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {testResult?.is_live ? (
                  <span className="rounded bg-emerald-600 text-white font-bold px-2.5 py-1 text-[10px] shadow-xs flex items-center gap-1">
                    <CheckCircle2 size={12} /> DỮ LIỆU THẬT TỪ MÁY CHỦ (LIVE)
                  </span>
                ) : testResult ? (
                  <span className="rounded bg-amber-600 text-white font-bold px-2.5 py-1 text-[10px] shadow-xs flex items-center gap-1">
                    <AlertCircle size={12} /> MẪU THAM KHẢO (CHƯA LIVE)
                  </span>
                ) : null}

                {availableDetectedFields.length > 0 && (
                  <button
                    type="button"
                    onClick={autoMapColumnsFromData}
                    className="inline-flex items-center gap-1 rounded bg-sky-500 hover:bg-sky-400 text-white px-2.5 py-1 text-[11px] font-semibold transition-colors shadow-xs"
                    title="Hệ thống tự động so khớp tên cột với trường chuẩn"
                  >
                    <Sparkles size={12} /> Tự động nhận diện cột (Auto-Map)
                  </button>
                )}

                <span className="rounded bg-slate-800 text-slate-200 border border-slate-600 px-2 py-1 text-[10px] font-mono">
                  {displaySampleRows.length} dòng thực tế · {availableDetectedFields.length} cột
                </span>
              </div>
            </div>

            {/* Checklist các trường bắt buộc */}
            <div className="border-b border-slate-200 bg-sky-50/70 px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <div className="flex items-center gap-1.5 text-slate-700 font-semibold">
                <span>Trường bắt buộc tạo đơn:</span>
                {[
                  { key: "order_number", label: "Số đơn" },
                  { key: "order_date", label: "Ngày đơn" },
                  { key: "customer_name", label: "Khách hàng" },
                  { key: "product_code", label: "Mã SKU" },
                  { key: "quantity", label: "Số lượng" },
                  { key: "unit_price", label: "Đơn giá" },
                ].map((req) => {
                  const isMapped = Boolean(supForm.field_mapping[req.key]);
                  return (
                    <span
                      key={req.key}
                      className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-mono font-medium ${
                        isMapped
                          ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                          : "bg-amber-100 text-amber-800 border border-amber-300"
                      }`}
                    >
                      {isMapped ? "✓" : "○"} {req.label}
                    </span>
                  );
                })}
              </div>
              <span className="text-[10px] text-slate-500 font-mono">
                Đã ánh xạ:{" "}
                <strong className="text-emerald-700">
                  {Object.keys(supForm.field_mapping).length}
                </strong>{" "}
                trường chuẩn
              </span>
            </div>

            {displaySampleRows.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 bg-slate-50">
                <Database size={28} className="mx-auto text-slate-300 mb-2" />
                <p className="font-semibold text-slate-700">Chưa có dữ liệu mẫu thực tế.</p>
                <p className="mt-1">
                  Vui lòng bấm nút{" "}
                  <strong className="text-sky-700">"Test Kết Nối & Lấy Mẫu Trường"</strong> ở phía trên để tải bảng 10 dòng dữ liệu thực tế từ URL của Nhà cung cấp.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[500px] overflow-y-auto pb-4">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 z-20 bg-slate-100 shadow-xs border-b border-slate-300">
                    {/* Dòng 1 Header: Tên cột gốc từ URL */}
                    <tr className="border-b border-slate-200 text-[10px] font-semibold text-slate-600">
                      <th className="px-2 py-2 w-10 text-center sticky left-0 bg-slate-100 z-30 border-r border-slate-300">
                        #
                      </th>
                      {availableDetectedFields.map((f) => {
                        const mappedKey = Object.entries(supForm.field_mapping).find(
                          ([, v]) => v === f.key
                        )?.[0];
                        return (
                          <th
                            key={f.key}
                            className={`px-2.5 py-1.5 whitespace-nowrap border-r border-slate-200 last:border-r-0 min-w-[190px] ${
                              mappedKey ? "bg-emerald-50/80" : ""
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-mono font-bold text-sky-900 truncate" title={f.key}>
                                {f.key}
                              </span>
                              {f.type && (
                                <span className="text-[9px] text-slate-400 font-normal">
                                  [{f.type}]
                                </span>
                              )}
                            </div>
                          </th>
                        );
                      })}
                    </tr>

                    {/* Dòng 2 Header: Ô chọn ánh xạ (Mapping Selector) */}
                    <tr className="bg-sky-50/50 border-b border-slate-300 text-[10px]">
                      <th className="px-1 py-1.5 text-center font-bold text-sky-800 sticky left-0 bg-sky-100 z-30 border-r border-slate-300">
                        Ánh xạ:
                      </th>
                      {availableDetectedFields.map((f) => {
                        const mappedKey = Object.entries(supForm.field_mapping).find(
                          ([, v]) => v === f.key
                        )?.[0] || "";
                        return (
                          <th
                            key={`map-${f.key}`}
                            className={`px-2 py-1.5 border-r border-slate-200 last:border-r-0 ${
                              mappedKey ? "bg-emerald-100/60" : ""
                            }`}
                          >
                            <select
                              value={mappedKey}
                              onChange={(e) => handleColumnMappingChange(f.key, e.target.value)}
                              className={`w-full rounded border px-1.5 py-1 text-[11px] font-medium transition-colors focus:outline-none ${
                                mappedKey
                                  ? "border-emerald-500 bg-emerald-50 text-emerald-900 font-bold shadow-xs ring-1 ring-emerald-400"
                                  : "border-slate-300 bg-white text-slate-600 hover:border-slate-400"
                              }`}
                            >
                              <option value="">-- Bỏ qua cột này --</option>
                              <optgroup label="Thông tin Đơn hàng">
                                <option value="order_number">★ Số đơn hàng</option>
                                <option value="order_date">★ Ngày đơn hàng</option>
                                <option value="delivery_date">Ngày giao hàng</option>
                                <option value="supplier_name">Nhà cung cấp</option>
                              </optgroup>
                              <optgroup label="Khách hàng">
                                <option value="customer_code">Mã khách hàng</option>
                                <option value="customer_name">★ Tên khách hàng</option>
                                <option value="customer_tax_code">Mã số thuế</option>
                                <option value="customer_address">Địa chỉ giao/xuất HĐ</option>
                              </optgroup>
                              <optgroup label="Hàng hóa & Tiền">
                                <option value="product_code">★ Mã sản phẩm (SKU)</option>
                                <option value="product_name">★ Tên sản phẩm</option>
                                <option value="unit">Đơn vị tính (ĐVT)</option>
                                <option value="quantity">★ Số lượng bán</option>
                                <option value="promo_quantity">Số lượng KM</option>
                                <option value="unit_price">★ Đơn giá bán</option>
                                <option value="discount_amount">Tiền chiết khấu</option>
                                <option value="vat_rate">Thuế suất VAT (%)</option>
                                <option value="line_total">Thành tiền dòng</option>
                              </optgroup>
                              <optgroup label="Nhân viên">
                                <option value="staff_code">Mã NVBH</option>
                                <option value="staff_name">Tên NVBH</option>
                              </optgroup>
                            </select>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-100">
                    {displaySampleRows.map((row, rIdx) => (
                      <tr
                        key={rIdx}
                        className="border-b border-slate-100 even:bg-amber-50/30 hover:bg-sky-50/60 transition-colors text-[11px] font-mono"
                      >
                        <td className="px-2 py-1.5 text-center text-[10px] text-slate-400 font-semibold sticky left-0 bg-white even:bg-amber-50/30 z-10 border-r border-slate-300">
                          {rIdx + 1}
                        </td>
                        {availableDetectedFields.map((f) => {
                          const val = row[f.key];
                          const isNull = val === null || val === undefined;
                          const isNumber = typeof val === "number";
                          const mappedKey = Object.entries(supForm.field_mapping).find(
                            ([, v]) => v === f.key
                          )?.[0];
                          return (
                            <td
                              key={f.key}
                              className={`px-2.5 py-1.5 whitespace-nowrap border-r border-slate-100 last:border-r-0 text-slate-800 ${
                                isNumber ? "text-right font-medium" : ""
                              } ${isNull ? "text-slate-300 italic" : ""} ${
                                mappedKey ? "bg-emerald-50/30 font-medium" : ""
                              }`}
                              title={`${f.key}: ${String(val ?? "null")}`}
                            >
                              {isNull ? "(null)" : String(val)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="px-3 py-1.5 bg-slate-50 border-t border-slate-200 text-[10px] text-slate-500 flex flex-wrap items-center justify-between gap-2">
              <span>* Cuộn ngang bảng để xem tất cả các cột dữ liệu nhận được từ máy chủ</span>
              <span className="font-mono font-medium text-slate-700">
                Hiển thị {displaySampleRows.length} dòng dữ liệu thực tế từ máy chủ
              </span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 bg-slate-50 px-2 py-2 -mx-5 -mb-5 rounded-b-xl">
            <button
              onClick={() => {
                setSupDrawerOpen(false);
                setEditingSupId(null);
              }}
              className="rounded bg-red-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-red-800 transition-colors"
            >
              Đóng
            </button>
            <button
              onClick={saveSupplierConfig}
              className="inline-flex items-center gap-1.5 rounded bg-sky-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 transition-colors shadow-xs"
            >
              <CheckCircle2 size={13} />
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
        size="wide"
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

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 bg-slate-50 px-2 py-2 -mx-5 -mb-5 rounded-b-xl">
            <button
              onClick={() => setInvDrawerOpen(false)}
              className="rounded bg-red-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-red-800 transition-colors"
            >
              Đóng
            </button>
            <button
              onClick={saveInvoiceConfig}
              className="inline-flex items-center gap-1.5 rounded bg-sky-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 transition-colors shadow-xs"
            >
              <CheckCircle2 size={13} />
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

          <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 space-y-1.5">
            <label className="text-xs font-bold uppercase text-amber-900 block">
              Cách phân bổ Công ty quản lý khi xuất Hóa đơn
            </label>
            <select
              value={distForm.company_allocation_mode}
              onChange={(e) =>
                setDistForm({ ...distForm, company_allocation_mode: e.target.value })
              }
              className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="BY_CUSTOMER">Theo Mã Khách hàng (mặc định — KH thuộc Cty nào xuất Cty đó)</option>
              <option value="BY_PRODUCT">Theo Mã Sản phẩm (tự tách đơn theo Cty quản lý của từng SKU)</option>
              <option value="HYBRID_CUSTOMER_FIRST">Kết hợp: Ưu tiên Mã Khách hàng → Fallback theo Mã Sản phẩm</option>
              <option value="HYBRID_PRODUCT_FIRST">Kết hợp: Ưu tiên Mã Sản phẩm → Fallback theo Mã Khách hàng</option>
            </select>
            <p className="text-[11px] text-amber-800">
              Quy định cách hệ thống tự động chọn pháp nhân xuất hóa đơn &amp; tách đơn trong màn Tổng hợp DMS.
            </p>
          </div>

          <div className="rounded-lg border border-sky-200 bg-sky-50/60 p-3.5 space-y-3">
            <div className="text-xs font-bold uppercase text-sky-800">
              Tài khoản Đăng nhập Quản lý riêng của Nhà Phân Phối
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-700">
                  Tên đăng nhập (Username)
                </label>
                <input
                  value={distForm.login_username}
                  onChange={(e) =>
                    setDistForm({
                      ...distForm,
                      login_username: e.target.value.toLowerCase().replace(/\s+/g, "_"),
                    })
                  }
                  placeholder="VD: npp_mienbac"
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700">
                  {editingDistId ? "Mật khẩu mới (Để trống nếu giữ nguyên)" : "Mật khẩu khởi tạo"}
                </label>
                <input
                  type="password"
                  value={distForm.login_password}
                  onChange={(e) =>
                    setDistForm({ ...distForm, login_password: e.target.value })
                  }
                  placeholder={editingDistId ? "•••••••••••• (Để trống nếu giữ nguyên)" : "Nhập mật khẩu (tối thiểu 6 ký tự)"}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                />
              </div>
            </div>
            <p className="text-[11px] text-slate-600">
              Khi đăng nhập bằng tài khoản này, hệ thống sẽ tự động hiển thị không gian quản lý riêng của NPP (Đơn hàng, Hóa đơn mua vào, Phát hành HĐĐT, Cấu hình NCC).
            </p>
          </div>
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 bg-slate-50 px-2 py-2 -mx-5 -mb-5 rounded-b-xl">
            <button
              onClick={() => setDistDrawerOpen(false)}
              className="rounded bg-red-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-red-800 transition-colors"
            >
              Đóng
            </button>
            <button
              onClick={saveDistributor}
              className="inline-flex items-center gap-1.5 rounded bg-sky-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 transition-colors shadow-xs"
            >
              <CheckCircle2 size={13} />
              Lưu Nhà Phân Phối
            </button>
          </div>
        </div>
      </Drawer>
    </div>
  );
}

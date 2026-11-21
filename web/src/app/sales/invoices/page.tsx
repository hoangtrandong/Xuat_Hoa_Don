"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Receipt,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  FileCode2,
  Send,
  FileCheck2,
  Building2,
  Eye,
  Sparkles,
  Layers,
  ShieldCheck,
  FileSpreadsheet,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import Badge from "@/components/ui/Badge";
import Drawer from "@/components/ui/Drawer";
import ExportViettelSinvoiceModal from "@/components/sales/ExportViettelSinvoiceModal";
import DmsInvoiceConsolidationPanel from "@/components/sales/DmsInvoiceConsolidationPanel";
import TaxInventoryByMstPanel from "@/components/sales/TaxInventoryByMstPanel";
import AdjustInvoiceModal from "@/components/sales/AdjustInvoiceModal";
import { API_URL, apiFetch } from "@/lib/api";
import { useAuthSession } from "@/lib/auth-session";
import { useDistributorContext } from "@/lib/distributor-context";
import { formatVND } from "@/lib/format";

interface DistributorOption {
  id: number;
  code: string;
  name: string;
  tax_code: string;
  address: string;
}

interface InvoiceConfigOption {
  id: number;
  distributor_id: number;
  config_name: string;
  provider: string;
  invoice_template_code: string;
  invoice_series: string;
  default_vat_rate: number;
  combine_orders: boolean;
  promo_handling: string;
  discount_display: string;
  product_code_source: string;
  default_payment_method: string;
  is_default: boolean;
}

interface CandidateOrder {
  order_number: string;
  supplier_code: string;
  order_date: string;
  customer_code: string;
  customer_name: string;
  customer_tax_code: string;
  customer_address: string;
  item_count: number;
  total_quantity: number;
  total_promo_quantity: number;
  subtotal: number;
  discount: number;
  net_amount: number;
  invoice_info?: {
    invoice_id: number;
    invoice_number: string;
    invoice_series: string;
    provider: string;
    status: string;
  } | null;
}

interface PreviewLine {
  line_number: number;
  item_type: string;
  product_code: string;
  product_name: string;
  unit_name: string;
  quantity: number;
  unit_price: number;
  discount_rate: number;
  discount_amount: number;
  amount_before_tax: number;
  vat_rate: number;
  vat_amount: number;
  total_amount: number;
  source_order_number?: string;
}

interface PreviewDocument {
  distributor_id: number;
  distributor_code: string;
  distributor_name: string;
  seller_tax_code: string;
  seller_address: string;
  seller_phone: string;
  seller_bank_account: string;
  seller_bank_name: string;
  invoice_config_id: number;
  provider: string;
  invoice_template_code: string;
  invoice_series: string;
  supplier_code: string;
  source_order_numbers: string[];
  buyer_code: string;
  buyer_name: string;
  buyer_legal_name: string;
  buyer_tax_code: string;
  buyer_address: string;
  payment_method: string;
  subtotal_before_tax: number;
  discount_amount: number;
  vat_rate: number;
  vat_amount: number;
  total_payment: number;
  amount_in_words: string;
  note: string;
  form_layout_config: {
    header_title?: string;
    theme_color?: string;
    footer_note?: string;
  };
  items: PreviewLine[];
  provider_payload_preview: Record<string, unknown>;
}

interface IssuedInvoiceRecord {
  id: number;
  distributor_code: string;
  distributor_name: string;
  provider: string;
  invoice_template_code: string;
  invoice_series: string;
  invoice_number: string;
  tax_authority_code: string;
  transaction_id: string;
  status: string;
  supplier_code: string;
  source_order_numbers: string[];
  buyer_code: string;
  buyer_name: string;
  buyer_legal_name: string;
  buyer_tax_code: string;
  buyer_address: string;
  payment_method: string;
  subtotal_before_tax: number;
  discount_amount: number;
  vat_rate: number;
  vat_amount: number;
  total_payment: number;
  amount_in_words: string;
  note: string;
  issued_at: string | null;
  items: PreviewLine[];
  provider_payload: Record<string, unknown>;
}

export default function EInvoiceGatewayPage() {
  const authSession = useAuthSession();
  const { effectiveDistributorId } = useDistributorContext();
  const [activeTab, setActiveTab] = useState<"consolidate" | "issue" | "history" | "tax_inventory">("consolidate");
  const [adjustingInvoice, setAdjustingInvoice] = useState<IssuedInvoiceRecord | null>(null);
  const [distributors, setDistributors] = useState<DistributorOption[]>([]);
  const [selectedDistId, setSelectedDistId] = useState<number | null>(
    effectiveDistributorId ?? authSession.distributorId ?? null
  );

  useEffect(() => {
    if (effectiveDistributorId !== null && effectiveDistributorId !== selectedDistId) {
      setSelectedDistId(effectiveDistributorId);
    }
  }, [effectiveDistributorId, selectedDistId]);
  const [invoiceConfigs, setInvoiceConfigs] = useState<InvoiceConfigOption[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState<number | null>(null);
  const [supplierFilter, setSupplierFilter] = useState<string>("");
  const [candidateOrders, setCandidateOrders] = useState<CandidateOrder[]>([]);
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [previewDocs, setPreviewDocs] = useState<PreviewDocument[]>([]);
  const [issuedList, setIssuedList] = useState<IssuedInvoiceRecord[]>([]);
  const [showPayloadJson, setShowPayloadJson] = useState(false);
  const [selectedHistoryInvoice, setSelectedHistoryInvoice] = useState<IssuedInvoiceRecord | null>(null);
  const [isExportViettelModalOpen, setIsExportViettelModalOpen] = useState(false);

  // Tùy chỉnh nhanh thông tin người mua trên Form Preview
  const [buyerOverride, setBuyerOverride] = useState({
    buyer_name: "",
    buyer_tax_code: "",
    buyer_address: "",
    payment_method: "",
  });

  const [loading, setLoading] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadData = useCallback(async (distId?: number | null, supCode?: string) => {
    setLoading(true);
    setError("");
    try {
      const distRes = await apiFetch(`${API_URL}/einvoice/distributors`);
      const distList: DistributorOption[] = distRes.ok ? await distRes.json() : [];
      setDistributors(distList);

      const effDistId =
        authSession.distributorId ?? distId ?? selectedDistId ?? (distList[0]?.id ?? null);
      if (effDistId && effDistId !== selectedDistId) {
        setSelectedDistId(effDistId);
      }

      const candParams = new URLSearchParams();
      if (effDistId) candParams.set("distributor_id", String(effDistId));
      if (supCode ?? supplierFilter) {
        candParams.set("supplier_code", supCode ?? supplierFilter);
      }
      const candQs = candParams.toString();

      const [cfgRes, ordRes, issRes] = await Promise.all([
        apiFetch(`${API_URL}/einvoice/invoice-configs${effDistId ? `?distributor_id=${effDistId}` : ""}`),
        apiFetch(`${API_URL}/einvoice/candidate-orders${candQs ? `?${candQs}` : ""}`),
        apiFetch(`${API_URL}/einvoice/issued${effDistId ? `?distributor_id=${effDistId}` : ""}`),
      ]);

      const cfgList: InvoiceConfigOption[] = cfgRes.ok ? await cfgRes.json() : [];
      setInvoiceConfigs(cfgList);
      const defaultCfg = cfgList.find((c) => c.is_default) || cfgList[0] || null;
      setSelectedConfigId((prev) =>
        cfgList.some((c) => c.id === prev) ? prev : (defaultCfg?.id ?? null)
      );

      if (ordRes.ok) {
        const ords: CandidateOrder[] = await ordRes.json();
        setCandidateOrders(ords);
      }
      if (issRes.ok) {
        setIssuedList(await issRes.json());
      }
    } catch {
      setError("Không thể tải dữ liệu Cổng Hóa Đơn Điện Tử.");
    } finally {
      setLoading(false);
    }
  }, [selectedDistId, supplierFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Tự động sinh Preview mỗi khi người dùng chọn đơn hàng hoặc đổi Mẫu Form Hóa Đơn của NPP
  const generatePreview = useCallback(async () => {
    if (!selectedDistId || !selectedConfigId || selectedOrders.length === 0) {
      setPreviewDocs([]);
      return;
    }
    try {
      const cleanOverride: Record<string, string> = {};
      if (buyerOverride.buyer_name.trim()) cleanOverride.buyer_name = buyerOverride.buyer_name.trim();
      if (buyerOverride.buyer_tax_code.trim()) cleanOverride.buyer_tax_code = buyerOverride.buyer_tax_code.trim();
      if (buyerOverride.buyer_address.trim()) cleanOverride.buyer_address = buyerOverride.buyer_address.trim();
      if (buyerOverride.payment_method.trim()) cleanOverride.payment_method = buyerOverride.payment_method.trim();

      const res = await apiFetch(`${API_URL}/einvoice/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          distributor_id: selectedDistId,
          invoice_config_id: selectedConfigId,
          order_numbers: selectedOrders,
          buyer_override: Object.keys(cleanOverride).length > 0 ? cleanOverride : undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setPreviewDocs(data.documents || []);
      }
    } catch {
      // ignore preview error
    }
  }, [selectedDistId, selectedConfigId, selectedOrders, buyerOverride]);

  useEffect(() => {
    generatePreview();
  }, [generatePreview]);

  function toggleOrderSelection(orderNumber: string) {
    setSelectedOrders((prev) =>
      prev.includes(orderNumber)
        ? prev.filter((o) => o !== orderNumber)
        : [...prev, orderNumber]
    );
  }

  function toggleSelectAllCandidateOrders() {
    if (selectedOrders.length === candidateOrders.length && candidateOrders.length > 0) {
      setSelectedOrders([]);
    } else {
      setSelectedOrders(candidateOrders.map((o) => o.order_number));
    }
  }

  async function quickSyncSampleMultiSupplierOrders() {
    if (!selectedDistId) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const supRes = await apiFetch(
        `${API_URL}/einvoice/supplier-configs?distributor_id=${selectedDistId}`
      );
      const sups: Array<{ id: number; supplier_code: string }> = supRes.ok
        ? await supRes.json()
        : [];
      let totalOrders = 0;
      for (const s of sups) {
        if (s.supplier_code !== "VINAMILK") {
          const r = await apiFetch(`${API_URL}/einvoice/supplier-configs/${s.id}/sync-orders`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
          if (r.ok) {
            const d = await r.json();
            totalOrders += Number(d.synced_orders || 0);
          }
        }
      }
      setMessage(
        `Đã nạp & chuẩn hóa thành công ${totalOrders} đơn hàng từ các Nhà cung cấp của NPP đang chọn!`
      );
      await loadData(selectedDistId);
    } catch {
      setError("Không thể nạp đơn hàng mẫu từ các NCC.");
    } finally {
      setLoading(false);
    }
  }

  async function handleIssueInvoices(publishImmediately: boolean) {
    if (!selectedDistId || !selectedConfigId || selectedOrders.length === 0) return;
    setIssuing(true);
    setError("");
    setMessage("");
    try {
      const cleanOverride: Record<string, string> = {};
      if (buyerOverride.buyer_name.trim()) cleanOverride.buyer_name = buyerOverride.buyer_name.trim();
      if (buyerOverride.buyer_tax_code.trim()) cleanOverride.buyer_tax_code = buyerOverride.buyer_tax_code.trim();
      if (buyerOverride.buyer_address.trim()) cleanOverride.buyer_address = buyerOverride.buyer_address.trim();
      if (buyerOverride.payment_method.trim()) cleanOverride.payment_method = buyerOverride.payment_method.trim();

      const res = await apiFetch(`${API_URL}/einvoice/issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          distributor_id: selectedDistId,
          invoice_config_id: selectedConfigId,
          order_numbers: selectedOrders,
          publish_immediately: publishImmediately,
          buyer_override: Object.keys(cleanOverride).length > 0 ? cleanOverride : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Không thể phát hành Hóa đơn điện tử.");

      const nums = (data.invoices || [])
        .map(
          (i: { invoice_series: string; invoice_number?: string; provider: string }) =>
            `${i.provider} [${i.invoice_series} - Số: ${i.invoice_number || "NHÁP"}]`
        )
        .join(", ");
      setMessage(
        publishImmediately
          ? `Đã ký số & phát hành thành công ${data.issued_count} Hóa đơn điện tử: ${nums}`
          : `Đã lưu ${data.issued_count} Hóa đơn nháp: ${nums}`
      );
      setSelectedOrders([]);
      setPreviewDocs([]);
      await loadData(selectedDistId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi khi phát hành HĐĐT.");
    } finally {
      setIssuing(false);
    }
  }

  const currentConfig = invoiceConfigs.find((c) => c.id === selectedConfigId) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cổng Xuất Hóa Đơn Điện Tử Đa Nhà Phân Phối"
        subtitle="Tự động sinh Form Hóa đơn theo quy chuẩn riêng của từng Nhà phân phối (MISA meInvoice, Viettel S-Invoice, VNPT e-Invoice, EasyInvoice)"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setIsExportViettelModalOpen(true)}
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold shadow-sm transition-colors"
              title="Xuất file Excel theo đúng định dạng mẫu của Viettel S-Invoice (C26TTD)"
            >
              <FileSpreadsheet size={16} /> Xuất Excel Viettel S-Invoice (C26TTD)
            </button>
            <button
              onClick={quickSyncSampleMultiSupplierOrders}
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium shadow-sm"
            >
              <Sparkles size={15} /> Đồng bộ nhanh Đơn đa NCC (Masan/Unilever)
            </button>
            <button
              onClick={() => loadData(selectedDistId)}
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

      {/* Thanh thông tin Nhà Phân Phối & Chọn Mẫu Form Hóa Đơn */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-bold text-gray-500 uppercase flex items-center gap-1.5">
            <Building2 size={14} className="text-sky-600" /> 1. Nhà Phân Phối phát hành hóa đơn (theo Phạm vi NPP)
          </label>
          <div className="mt-1.5 w-full rounded-lg border border-sky-200 bg-sky-50/60 px-3 py-2 text-sm font-bold text-slate-900">
            {(() => {
              const activeDist = distributors.find((d) => d.id === selectedDistId);
              return activeDist
                ? `[${activeDist.code}] ${activeDist.name} (MST: ${activeDist.tax_code || "—"})`
                : "Đang tải Nhà phân phối...";
            })()}
          </div>
        </div>

        <div>
          <label className="text-xs font-bold text-gray-500 uppercase flex items-center gap-1.5">
            <Receipt size={14} className="text-amber-600" /> 2. Chọn Mẫu Form & Cổng HĐĐT của NPP
          </label>
          <select
            value={selectedConfigId ?? ""}
            onChange={(e) => setSelectedConfigId(Number(e.target.value))}
            className="mt-1.5 w-full rounded-lg border border-amber-300 bg-amber-50/50 px-3 py-2 text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            {invoiceConfigs.map((c) => (
              <option key={c.id} value={c.id}>
                [{c.provider}] {c.config_name} — Mẫu: {c.invoice_template_code} | Ký hiệu:{" "}
                {c.invoice_series}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Đơn hàng chờ xuất HĐ"
          value={candidateOrders.filter((o) => !o.invoice_info).length}
          sub={`Tổng ${candidateOrders.length} đơn đã đồng bộ`}
          icon={<Layers size={20} />}
          color="bg-sky-50 text-sky-600"
        />
        <StatCard
          label="Đơn đang chọn để phát hành"
          value={selectedOrders.length}
          sub={`Sinh ra ${previewDocs.length} tờ Hóa đơn`}
          icon={<Receipt size={20} />}
          color="bg-amber-50 text-amber-600"
        />
        <StatCard
          label="Hóa đơn đã phát hành"
          value={issuedList.length}
          sub={`Nhà mạng hiện tại: ${currentConfig?.provider || "MISA"}`}
          icon={<ShieldCheck size={20} />}
          color="bg-emerald-50 text-emerald-600"
        />
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 flex flex-wrap gap-2">
        <button
          onClick={() => setActiveTab("consolidate")}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === "consolidate"
              ? "border-sky-500 text-sky-600"
              : "border-transparent text-gray-500 hover:text-gray-800"
          }`}
        >
          <FileSpreadsheet size={16} /> Tổng Hợp DMS Theo Ngày & Xuất File HĐĐT
        </button>
        <button
          onClick={() => setActiveTab("issue")}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === "issue"
              ? "border-sky-500 text-sky-600"
              : "border-transparent text-gray-500 hover:text-gray-800"
          }`}
        >
          <Receipt size={16} /> Chọn Đơn Hàng & Xem Trước Form Hóa Đơn Động
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === "history"
              ? "border-sky-500 text-sky-600"
              : "border-transparent text-gray-500 hover:text-gray-800"
          }`}
        >
          <FileCheck2 size={16} /> Lịch Sử Hóa Đơn Đã Phát Hành ({issuedList.length})
        </button>
        <button
          onClick={() => setActiveTab("tax_inventory")}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === "tax_inventory"
              ? "border-sky-500 text-sky-600"
              : "border-transparent text-gray-500 hover:text-gray-800"
          }`}
        >
          <ShieldCheck size={16} /> Tồn Kho Thuế Theo MST
        </button>
      </div>

      {activeTab === "tax_inventory" && (
        <TaxInventoryByMstPanel distributorId={selectedDistId} />
      )}

      {activeTab === "consolidate" && (
        <DmsInvoiceConsolidationPanel
          distributorId={selectedDistId}
          distributorLabel={
            distributors.find((d) => d.id === selectedDistId)
              ? `[${distributors.find((d) => d.id === selectedDistId)!.code}] ${distributors.find((d) => d.id === selectedDistId)!.name}`
              : undefined
          }
        />
      )}

      {activeTab === "issue" && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Cột trái: Danh sách đơn hàng từ các NCC */}
          <div className="xl:col-span-5 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-gray-900">
                  Danh sách Đơn Hàng Chuẩn Hóa (Đa NCC)
                </h3>
                <p className="text-xs text-gray-500">
                  Tích chọn 1 hoặc nhiều đơn hàng để sinh Form Hóa Đơn ở cột bên phải
                </p>
              </div>
              <select
                value={supplierFilter}
                onChange={(e) => {
                  const val = e.target.value;
                  setSupplierFilter(val);
                  loadData(selectedDistId, val);
                }}
                className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-gray-50 font-medium"
              >
                <option value="">Tất cả Nhà cung cấp</option>
                <option value="VINAMILK">VINAMILK</option>
                <option value="MASAN">MASAN</option>
                <option value="UNILEVER">UNILEVER</option>
                <option value="NESTLE">NESTLE</option>
              </select>
            </div>

            {/* Quick Action Toolbar for Candidates */}
            {candidateOrders.length > 0 && (
              <div className="bg-slate-50 px-3.5 py-2 border-b border-gray-200 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleSelectAllCandidateOrders}
                    className="font-medium text-sky-700 hover:text-sky-900 hover:underline"
                  >
                    {selectedOrders.length === candidateOrders.length
                      ? "Bỏ chọn tất cả"
                      : `Chọn tất cả (${candidateOrders.length})`}
                  </button>
                  <span className="text-gray-400">|</span>
                  <span className="text-gray-600 font-medium">
                    Đã chọn: <strong className="text-sky-800">{selectedOrders.length}</strong>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsExportViettelModalOpen(true)}
                  disabled={selectedOrders.length === 0}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                  title="Xuất các đơn đang chọn ra file Excel mẫu Viettel S-Invoice"
                >
                  <FileSpreadsheet size={13} /> Xuất Viettel ({selectedOrders.length})
                </button>
              </div>
            )}

            <div className="max-h-[620px] overflow-y-auto divide-y divide-gray-100">
              {candidateOrders.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-500 space-y-3">
                  <p>Chưa có đơn hàng nào trong danh sách.</p>
                  <button
                    onClick={quickSyncSampleMultiSupplierOrders}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-500 text-white text-xs font-semibold"
                  >
                    <Sparkles size={14} /> Nạp ngay đơn hàng mẫu Masan & Unilever
                  </button>
                </div>
              ) : (
                candidateOrders.map((ord) => {
                  const checked = selectedOrders.includes(ord.order_number);
                  return (
                    <label
                      key={ord.order_number}
                      className={`flex items-start gap-3 p-3.5 cursor-pointer transition-colors ${
                        checked ? "bg-sky-50/70" : "hover:bg-gray-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleOrderSelection(ord.order_number)}
                        className="mt-1 h-4 w-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-bold text-[10px]">
                              {ord.supplier_code}
                            </span>
                            <span className="font-mono font-bold text-sm text-gray-900">
                              {ord.order_number}
                            </span>
                          </div>
                          {ord.invoice_info ? (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                              Đã xuất #{ord.invoice_info.invoice_number}
                            </span>
                          ) : (
                            <span className="text-xs font-bold text-sky-700">
                              {formatVND(ord.net_amount)}
                            </span>
                          )}
                        </div>
                        <p className="text-xs font-medium text-gray-800 mt-1 truncate">
                          {ord.customer_name}{" "}
                          <span className="text-gray-400">({ord.customer_code})</span>
                        </p>
                        <div className="flex items-center gap-3 text-[11px] text-gray-500 mt-0.5">
                          <span>Ngày: {ord.order_date}</span>
                          <span>•</span>
                          <span>{ord.item_count} SP</span>
                          {ord.total_promo_quantity > 0 && (
                            <>
                              <span>•</span>
                              <span className="text-amber-600 font-medium">
                                +{ord.total_promo_quantity} KM
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          {/* Cột phải: Bản Xem Trước Form Hóa Đơn Động (Dynamic Form Preview) */}
          <div className="xl:col-span-7 space-y-4">
            {previewDocs.length === 0 ? (
              <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center space-y-2">
                <Receipt size={36} className="mx-auto text-gray-300" />
                <h3 className="text-base font-bold text-gray-800">
                  Xem trước Form Hóa Đơn Điện Tử Động
                </h3>
                <p className="text-xs text-gray-500 max-w-md mx-auto">
                  Hãy tích chọn ít nhất 1 đơn hàng ở danh sách bên trái. Hệ thống sẽ tự động áp dụng mẫu Form của{" "}
                  <strong>{currentConfig?.provider || "NPP"}</strong> (gộp/tách đơn, xử lý hàng KM, thuế suất) để hiển thị bản xem trước.
                </p>
              </div>
            ) : (
              <>
                {/* Khung tùy biến nhanh thông tin người mua */}
                <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-gray-700 uppercase">
                      Tùy chỉnh nhanh thông tin Người Mua trên Form (Nếu khách yêu cầu đổi MST/Địa chỉ)
                    </span>
                    <button
                      onClick={() => setShowPayloadJson(!showPayloadJson)}
                      className="flex items-center gap-1.5 text-xs font-semibold text-sky-600 hover:text-sky-700"
                    >
                      <FileCode2 size={14} />{" "}
                      {showPayloadJson ? "Ẩn Payload API" : `Xem Payload chuẩn ${currentConfig?.provider}`}
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                    <input
                      value={buyerOverride.buyer_name}
                      onChange={(e) =>
                        setBuyerOverride({ ...buyerOverride, buyer_name: e.target.value })
                      }
                      placeholder="Đổi tên người mua..."
                      className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs"
                    />
                    <input
                      value={buyerOverride.buyer_tax_code}
                      onChange={(e) =>
                        setBuyerOverride({ ...buyerOverride, buyer_tax_code: e.target.value })
                      }
                      placeholder="Đổi Mã số thuế..."
                      className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-mono"
                    />
                    <input
                      value={buyerOverride.buyer_address}
                      onChange={(e) =>
                        setBuyerOverride({ ...buyerOverride, buyer_address: e.target.value })
                      }
                      placeholder="Đổi địa chỉ xuất HĐ..."
                      className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs"
                    />
                    <select
                      value={buyerOverride.payment_method}
                      onChange={(e) =>
                        setBuyerOverride({ ...buyerOverride, payment_method: e.target.value })
                      }
                      className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs bg-white"
                    >
                      <option value="">HTTT theo cấu hình ({currentConfig?.default_payment_method})</option>
                      <option value="TM/CK">TM/CK</option>
                      <option value="CK">Chuyển khoản (CK)</option>
                      <option value="TM">Tiền mặt (TM)</option>
                    </select>
                  </div>
                </div>

                {/* Danh sách tờ Hóa Đơn Preview */}
                {previewDocs.map((doc, idx) => {
                  const themeColor = doc.form_layout_config?.theme_color || "#0284c7";
                  return (
                    <div
                      key={idx}
                      className="bg-white rounded-2xl border-2 shadow-md overflow-hidden"
                      style={{ borderColor: themeColor }}
                    >
                      {/* Header Tờ Hóa Đơn */}
                      <div
                        className="px-6 py-4 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        style={{ backgroundColor: themeColor }}
                      >
                        <div>
                          <span className="text-[11px] font-bold uppercase tracking-wider bg-white/20 px-2.5 py-0.5 rounded">
                            Cổng HĐĐT: {doc.provider} • Tờ #{idx + 1}/{previewDocs.length}
                          </span>
                          <h2 className="text-lg font-extrabold mt-1">
                            {doc.form_layout_config?.header_title || "HÓA ĐƠN GIÁ TRỊ GIA TĂNG"}
                          </h2>
                          <p className="text-xs opacity-90">
                            Đơn hàng gốc: {doc.source_order_numbers.join(", ")} (Nguồn NCC:{" "}
                            {doc.supplier_code})
                          </p>
                        </div>
                        <div className="text-left sm:text-right text-xs bg-black/15 px-3.5 py-2 rounded-xl font-mono">
                          <div>Mẫu số: {doc.invoice_template_code}</div>
                          <div>Ký hiệu: {doc.invoice_series}</div>
                          <div>Số HĐ: [Cấp khi ký số]</div>
                        </div>
                      </div>

                      {/* Thông tin Đơn vị bán (NPP) & Người mua */}
                      <div className="p-6 space-y-4 text-xs">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
                          <div className="space-y-1">
                            <p className="text-[10px] font-bold uppercase text-slate-400">
                              Đơn vị bán hàng (Nhà Phân Phối)
                            </p>
                            <p className="font-bold text-gray-900 text-sm">{doc.distributor_name}</p>
                            <p>
                              <strong>Mã số thuế:</strong>{" "}
                              <span className="font-mono font-bold text-sky-700">
                                {doc.seller_tax_code}
                              </span>
                            </p>
                            <p>
                              <strong>Địa chỉ:</strong> {doc.seller_address}
                            </p>
                            {doc.seller_bank_account && (
                              <p>
                                <strong>Số TK:</strong> {doc.seller_bank_account} —{" "}
                                {doc.seller_bank_name}
                              </p>
                            )}
                          </div>

                          <div className="space-y-1 border-t md:border-t-0 md:border-l border-slate-200 pt-3 md:pt-0 md:pl-4">
                            <p className="text-[10px] font-bold uppercase text-slate-400">
                              Thông tin Người mua hàng
                            </p>
                            <p className="font-bold text-gray-900 text-sm">{doc.buyer_name}</p>
                            <p>
                              <strong>Mã KH:</strong> {doc.buyer_code} • <strong>MST:</strong>{" "}
                              <span className="font-mono font-semibold">
                                {doc.buyer_tax_code || "Khách lẻ không lấy MST"}
                              </span>
                            </p>
                            <p>
                              <strong>Địa chỉ:</strong> {doc.buyer_address}
                            </p>
                            <p>
                              <strong>Hình thức thanh toán:</strong> {doc.payment_method}
                            </p>
                          </div>
                        </div>

                        {/* Bảng chi tiết hàng hóa dịch vụ */}
                        <div className="overflow-x-auto border border-gray-200 rounded-xl">
                          <table className="w-full text-xs text-left">
                            <thead className="bg-gray-100 text-gray-700 font-bold border-b border-gray-200">
                              <tr>
                                <th className="px-3 py-2 text-center">STT</th>
                                <th className="px-3 py-2">Mã hàng</th>
                                <th className="px-3 py-2">Tên hàng hóa, dịch vụ</th>
                                <th className="px-3 py-2 text-center">ĐVT</th>
                                <th className="px-3 py-2 text-right">SL</th>
                                <th className="px-3 py-2 text-right">Đơn giá</th>
                                <th className="px-3 py-2 text-right">Chiết khấu</th>
                                <th className="px-3 py-2 text-right">Thành tiền</th>
                                <th className="px-3 py-2 text-center">% VAT</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {doc.items.map((it) => (
                                <tr
                                  key={it.line_number}
                                  className={
                                    it.item_type === "PROMOTION"
                                      ? "bg-amber-50/60 text-amber-900"
                                      : it.item_type === "DISCOUNT"
                                      ? "bg-rose-50/60 text-rose-900 font-medium"
                                      : ""
                                  }
                                >
                                  <td className="px-3 py-2 text-center">{it.line_number}</td>
                                  <td className="px-3 py-2 font-mono font-semibold">
                                    {it.product_code}
                                  </td>
                                  <td className="px-3 py-2">{it.product_name}</td>
                                  <td className="px-3 py-2 text-center">{it.unit_name}</td>
                                  <td className="px-3 py-2 text-right font-semibold">
                                    {it.quantity}
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    {formatVND(it.unit_price)}
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    {it.discount_amount > 0 ? formatVND(it.discount_amount) : "0"}
                                  </td>
                                  <td className="px-3 py-2 text-right font-semibold">
                                    {formatVND(it.amount_before_tax)}
                                  </td>
                                  <td className="px-3 py-2 text-center">{it.vat_rate}%</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {/* Tổng kết tiền & Đọc số thành chữ */}
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center bg-gray-50 p-4 rounded-xl border border-gray-200">
                          <div className="md:col-span-7 space-y-1">
                            <p className="text-gray-600">
                              <strong>Số tiền viết bằng chữ:</strong>{" "}
                              <span className="italic font-semibold text-gray-900">
                                {doc.amount_in_words}
                              </span>
                            </p>
                            <p className="text-[11px] text-gray-500">{doc.note}</p>
                          </div>
                          <div className="md:col-span-5 space-y-1 text-right">
                            <div className="flex justify-between">
                              <span className="text-gray-500">Cộng tiền hàng (trước thuế):</span>
                              <span className="font-semibold">
                                {formatVND(doc.subtotal_before_tax)}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-500">Tổng chiết khấu thương mại:</span>
                              <span className="font-semibold text-amber-700">
                                {formatVND(doc.discount_amount)}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-500">
                                Tiền thuế GTGT ({doc.vat_rate}%):
                              </span>
                              <span className="font-semibold">{formatVND(doc.vat_amount)}</span>
                            </div>
                            <div className="flex justify-between text-sm font-extrabold text-sky-700 pt-1 border-t border-gray-200">
                              <span>Tổng cộng tiền thanh toán:</span>
                              <span>{formatVND(doc.total_payment)}</span>
                            </div>
                          </div>
                        </div>

                        {/* Hiển thị JSON Payload chuẩn của từng nhà mạng (MISA/Viettel/VNPT) */}
                        {showPayloadJson && (
                          <div className="bg-slate-900 text-slate-100 rounded-xl p-4 font-mono text-[11px] overflow-x-auto max-h-64">
                            <p className="text-sky-400 font-bold mb-2">
                              // Payload chuẩn tích hợp API {doc.provider}:
                            </p>
                            <pre>{JSON.stringify(doc.provider_payload_preview, null, 2)}</pre>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Thanh nút hành động Phát hành Hóa Đơn */}
                <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs text-gray-600">
                    Sẵn sàng tạo <strong>{previewDocs.length}</strong> Hóa đơn qua cổng{" "}
                    <strong>{currentConfig?.provider}</strong> (Ký hiệu:{" "}
                    <strong>{currentConfig?.invoice_series}</strong>)
                  </div>
                  <div className="flex items-center gap-2.5">
                    <button
                      disabled={issuing}
                      onClick={() => handleIssueInvoices(false)}
                      className="px-4 py-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 text-sm font-semibold"
                    >
                      Lưu Hóa Đơn Nháp
                    </button>
                    <button
                      disabled={issuing}
                      onClick={() => handleIssueInvoices(true)}
                      className="flex items-center gap-2 px-5 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold shadow-sm"
                    >
                      <Send size={15} /> Ký Số & Phát Hành HĐĐT ({previewDocs.length})
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: LỊCH SỬ HÓA ĐƠN ĐÃ PHÁT HÀNH */}
      {activeTab === "history" && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase border-b border-gray-200">
              <tr>
                <th className="px-4 py-3">Nhà mạng</th>
                <th className="px-4 py-3">Ký hiệu / Số HĐ</th>
                <th className="px-4 py-3">Mã Cơ Quan Thuế</th>
                <th className="px-4 py-3">Đơn hàng gốc</th>
                <th className="px-4 py-3">Khách hàng</th>
                <th className="px-4 py-3 text-right">Tổng thanh toán</th>
                <th className="px-4 py-3 text-center">Trạng thái</th>
                <th className="px-4 py-3 text-right">Chi tiết</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {issuedList.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                    Chưa có hóa đơn điện tử nào được phát hành.
                  </td>
                </tr>
              ) : (
                issuedList.map((inv) => (
                  <tr key={inv.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span className="px-2.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold text-xs">
                        {inv.provider}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono">
                      <span className="text-gray-500">{inv.invoice_series}</span> •{" "}
                      <strong className="text-sky-700">{inv.invoice_number}</strong>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-emerald-700">
                      {inv.tax_authority_code || "Chưa cấp mã"}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono">
                      {inv.source_order_numbers.join(", ")}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{inv.buyer_name}</div>
                      <div className="text-xs text-gray-400">MST: {inv.buyer_tax_code || "—"}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-gray-900">
                      {formatVND(inv.total_payment)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge
                        variant={
                          inv.status === "ISSUED"
                            ? "success"
                            : inv.status === "REPLACED" || inv.status === "CANCELLED"
                            ? "danger"
                            : "warning"
                        }
                      >
                        {inv.status === "ISSUED"
                          ? "Đã phát hành"
                          : inv.status === "ADJUSTED"
                          ? "Đã điều chỉnh"
                          : inv.status === "REPLACED"
                          ? "Đã thay thế"
                          : "Nháp"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-2.5">
                        {inv.status !== "CANCELLED" && inv.status !== "REPLACED" && (
                          <button
                            type="button"
                            onClick={() => setAdjustingInvoice(inv)}
                            className="text-amber-700 hover:underline text-xs font-semibold"
                            title="Lập hóa đơn điều chỉnh giảm (trả hàng) hoặc thay thế theo NĐ 123"
                          >
                            ĐC / Thay thế
                          </button>
                        )}
                        <button
                          onClick={() => setSelectedHistoryInvoice(inv)}
                          className="inline-flex items-center gap-1 text-sky-600 hover:underline text-xs font-semibold"
                        >
                          <Eye size={14} /> Xem HĐ
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal Điều chỉnh giảm / Thay thế Hóa đơn (NĐ 123) */}
      {adjustingInvoice && (
        <AdjustInvoiceModal
          invoice={adjustingInvoice}
          onClose={() => setAdjustingInvoice(null)}
          onSuccess={(msg) => {
            setMessage(msg);
            void loadData(selectedDistId);
          }}
        />
      )}

      {/* Drawer xem chi tiết Hóa Đơn đã phát hành */}
      <Drawer
        open={Boolean(selectedHistoryInvoice)}
        onClose={() => setSelectedHistoryInvoice(null)}
        title={
          selectedHistoryInvoice
            ? `Chi tiết HĐĐT #${selectedHistoryInvoice.invoice_number} (${selectedHistoryInvoice.provider})`
            : ""
        }
        size="2xl"
      >
        {selectedHistoryInvoice && (
          <div className="p-5 space-y-4 text-xs">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 space-y-1">
              <div className="font-bold text-emerald-900 text-sm">
                Số hóa đơn: {selectedHistoryInvoice.invoice_series} -{" "}
                {selectedHistoryInvoice.invoice_number}
              </div>
              <div>
                <strong>Mã của Cơ quan Thuế:</strong>{" "}
                <span className="font-mono font-bold text-emerald-800">
                  {selectedHistoryInvoice.tax_authority_code || "Đang chờ cấp mã"}
                </span>
              </div>
              <div>
                <strong>Đơn hàng DMS gốc:</strong>{" "}
                {selectedHistoryInvoice.source_order_numbers.join(", ")}
              </div>
            </div>

            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Mã SP</th>
                    <th className="px-3 py-2">Tên hàng hóa</th>
                    <th className="px-3 py-2 text-right">SL</th>
                    <th className="px-3 py-2 text-right">Đơn giá</th>
                    <th className="px-3 py-2 text-right">Thành tiền</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {selectedHistoryInvoice.items.map((it) => (
                    <tr key={it.line_number}>
                      <td className="px-3 py-2">{it.line_number}</td>
                      <td className="px-3 py-2 font-mono">{it.product_code}</td>
                      <td className="px-3 py-2">{it.product_name}</td>
                      <td className="px-3 py-2 text-right">{it.quantity}</td>
                      <td className="px-3 py-2 text-right">{formatVND(it.unit_price)}</td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {formatVND(it.amount_before_tax)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-gray-50 p-3.5 rounded-xl border border-gray-200 space-y-1">
              <div className="flex justify-between">
                <span>Tiền trước thuế:</span>
                <strong>{formatVND(selectedHistoryInvoice.subtotal_before_tax)}</strong>
              </div>
              <div className="flex justify-between">
                <span>Tiền thuế GTGT ({selectedHistoryInvoice.vat_rate}%):</span>
                <strong>{formatVND(selectedHistoryInvoice.vat_amount)}</strong>
              </div>
              <div className="flex justify-between text-sm font-bold text-sky-700 pt-1 border-t border-gray-200">
                <span>Tổng thanh toán:</span>
                <span>{formatVND(selectedHistoryInvoice.total_payment)}</span>
              </div>
              <p className="italic text-gray-600 pt-1">
                Bằng chữ: {selectedHistoryInvoice.amount_in_words}
              </p>
            </div>

            <div className="bg-slate-900 text-slate-100 rounded-xl p-3 font-mono text-[11px] overflow-x-auto max-h-60">
              <p className="text-sky-400 font-bold mb-1">
                // Payload đã gửi sang {selectedHistoryInvoice.provider}:
              </p>
              <pre>{JSON.stringify(selectedHistoryInvoice.provider_payload, null, 2)}</pre>
            </div>
          </div>
        )}
      </Drawer>

      {/* Modal Xuất Excel Viettel S-Invoice */}
      <ExportViettelSinvoiceModal
        isOpen={isExportViettelModalOpen}
        onClose={() => setIsExportViettelModalOpen(false)}
        selectedOrderNumbers={selectedOrders}
        candidateOrders={candidateOrders}
        onSuccess={(msg) => setMessage(msg)}
      />
    </div>
  );
}

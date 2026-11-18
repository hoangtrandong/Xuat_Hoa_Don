"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FileText,
  RefreshCw,
  CheckCircle2,
  Loader2,
  KeyRound,
  Download,
  Eye,
  X,
  Building2,
  FileCode2,
  Layers,
  ShieldCheck,
  AlertTriangle,
  Printer,
  Trash2,
  Search,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  FileArchive,
  FileSpreadsheet,
} from "lucide-react";
import { API_URL, apiFetch } from "@/lib/api";
import { useAuthSession } from "@/lib/auth-session";
import { formatNumber } from "@/lib/format";
import { downloadExcel } from "@/lib/excel";

const inputCls =
  "w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-100";

interface DistributorOption {
  id: number;
  code: string;
  name: string;
  tax_code: string;
  address: string;
}

interface CredentialStatus {
  distributor_id: number;
  distributor_name: string;
  username: string;
  has_bearer_token: boolean;
  last_synced_at: string | null;
  accounts: TaxAccount[];
}

interface TaxAccount {
  id: number;
  username: string;
  has_password: boolean;
  has_bearer_token: boolean;
  token_preview: string;
  token_updated_at: string | null;
  last_synced_at: string | null;
  invoice_count: number;
}

interface CaptchaData {
  key: string;
  content: string;
}

interface SellerOption {
  tax_code: string;
  name: string;
}

interface PurchaseInvoiceLine {
  id: number;
  line_number: number;
  product_code: string;
  product_name: string;
  unit_name: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  amount_before_tax: number;
  vat_rate: string;
}

interface PurchaseInvoiceRow {
  id: number;
  distributor_id: number;
  tax_credential_id: number | null;
  tax_account_username: string;
  invoice_template: string;
  invoice_symbol: string;
  invoice_number: string;
  invoice_date: string;
  invoice_date_iso: string | null;
  seller_tax_code: string;
  seller_name: string;
  seller_address: string;
  buyer_tax_code: string;
  buyer_name: string;
  invoice_category: string;
  ttxly: string;
  kqkt_label: string;
  tthai: string;
  tthai_label: string;
  is_mtt: boolean;
  replaced_invoice_number: string;
  replaced_invoice_date: string;
  is_replaced: boolean;
  replaced_by_invoice_number: string;
  amount_before_tax: number;
  tax_amount: number;
  discount_amount: number;
  fee_amount: number;
  total_amount: number;
  currency: string;
  xml_downloaded: boolean;
  has_html: boolean;
  item_count: number;
  synced_at: string | null;
  items: PurchaseInvoiceLine[];
}

interface GoodsSummaryRow {
  product_code: string;
  product_name: string;
  unit_name: string;
  unit_price: number;
  total_quantity: number;
  total_amount: number;
  invoice_count: number;
  seller_names: string;
}

interface PurchaseStats {
  total_invoices: number;
  hddt_count: number;
  co_ma_count: number;
  khong_ma_count: number;
  mtt_count: number;
  replaced_count: number;
  total_before_tax: number;
  total_tax: number;
  total_discount: number;
  total_fee: number;
  total_payment: number;
}

interface PurchaseInvoiceDetail {
  id: number;
  tax_credential_id: number | null;
  tax_account_username: string;
  invoice_template: string;
  invoice_symbol: string;
  invoice_number: string;
  invoice_date: string;
  seller_tax_code: string;
  seller_name: string;
  seller_address: string;
  buyer_tax_code: string;
  buyer_name: string;
  ttxly?: string;
  kqkt_label?: string;
  tthai?: string;
  tthai_label?: string;
  replaced_invoice_number: string;
  replaced_invoice_date: string;
  amount_before_tax: number;
  tax_amount: number;
  discount_amount?: number;
  fee_amount?: number;
  total_amount: number;
  xml_content: string;
  html_content: string;
  items: PurchaseInvoiceLine[];
}

function getDefaultMonthRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return {
    from: `${y}-${m}-01`,
    to: `${y}-${m}-${d}`,
  };
}

export default function PurchaseInvoicesPage() {
  const authSession = useAuthSession();
  const defaultDates = getDefaultMonthRange();
  const [distributors, setDistributors] = useState<DistributorOption[]>([]);
  const [selectedDistId, setSelectedDistId] = useState<number>(
    authSession.distributorId ?? 1
  );

  // Các trường bộ lọc chuẩn Cổng Thuế (hoadondientu.gdt.gov.vn)
  const [sellerTaxOrName, setSellerTaxOrName] = useState<string>("");
  const [buyerIdentity, setBuyerIdentity] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL"); // Trạng thái hóa đơn (*)
  const [checkResultFilter, setCheckResultFilter] = useState<string>("ALL"); // Kết quả kiểm tra (*)
  const [invoiceNumberFilter, setInvoiceNumberFilter] = useState<string>(""); // Số hóa đơn
  const [invoiceTemplateFilter, setInvoiceTemplateFilter] = useState<string>(""); // Ký hiệu mẫu số hóa đơn
  const [invoiceSymbolFilter, setInvoiceSymbolFilter] = useState<string>(""); // Ký hiệu hóa đơn
  const [delegatedInvoice, setDelegatedInvoice] = useState<boolean>(false); // Hóa đơn ủy nhiệm
  const [fromDate, setFromDate] = useState<string>(defaultDates.from);
  const [toDate, setToDate] = useState<string>(defaultDates.to);
  const [searchQuery, setSearchQuery] = useState<string>("");

  // 3 Tab: "hddt" (Hóa đơn điện tử) | "mtt" (Hóa đơn có mã khởi tạo từ máy tính tiền) | "summary" (Bảng tổng hợp hàng hóa)
  const [activeTab, setActiveTab] = useState<"hddt" | "mtt" | "summary">("hddt");

  // Phân trang & Chọn dòng
  const [pageSize, setPageSize] = useState<number>(15);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [selectedRowId, setSelectedRowId] = useState<number | null>(null);
  const [checkedIds, setCheckedIds] = useState<number[]>([]);
  const [downloadingZip, setDownloadingZip] = useState<boolean>(false);

  const [credStatus, setCredStatus] = useState<CredentialStatus | null>(null);
  const [sellers, setSellers] = useState<SellerOption[]>([]);
  const [stats, setStats] = useState<PurchaseStats>({
    total_invoices: 0,
    hddt_count: 0,
    co_ma_count: 0,
    khong_ma_count: 0,
    mtt_count: 0,
    replaced_count: 0,
    total_before_tax: 0,
    total_tax: 0,
    total_discount: 0,
    total_fee: 0,
    total_payment: 0,
  });
  const [invoices, setInvoices] = useState<PurchaseInvoiceRow[]>([]);
  const [goodsSummary, setGoodsSummary] = useState<GoodsSummaryRow[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [bannerMsg, setBannerMsg] = useState<{
    type: "success" | "error" | "info" | "warning";
    text: string;
  } | null>(null);

  // Modal xác thực Cổng Thuế (Bearer Token CQT / cURL / Playwright)
  const [authModalOpen, setAuthModalOpen] = useState<boolean>(false);
  const [authUsername, setAuthUsername] = useState<string>("");
  const [authPassword, setAuthPassword] = useState<string>("");
  const [authManualToken, setAuthManualToken] = useState<string>("");
  const [savingToken, setSavingToken] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string>("");
  const [captcha, setCaptcha] = useState<CaptchaData | null>(null);
  const [captchaValue, setCaptchaValue] = useState<string>("");
  const [captchaLoading, setCaptchaLoading] = useState<boolean>(false);
  const [showManualToken, setShowManualToken] = useState<boolean>(false);
  const [activeTaxCredentialId, setActiveTaxCredentialId] = useState<number | null>(null);
  const [deletingTaxAccount, setDeletingTaxAccount] = useState<TaxAccount | null>(null);
  const [deletingAccount, setDeletingAccount] = useState<boolean>(false);

  // Modal xem chi tiết Hóa đơn mua vào
  const [detailModalOpen, setDetailModalOpen] = useState<boolean>(false);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [detailData, setDetailData] = useState<PurchaseInvoiceDetail | null>(null);
  const [detailViewMode, setDetailViewMode] = useState<"html" | "items" | "xml">("items");
  const activeTaxAccount = useMemo(
    () =>
      credStatus?.accounts.find((account) => account.id === activeTaxCredentialId) ??
      null,
    [credStatus, activeTaxCredentialId]
  );

  // 1. Tải danh sách Nhà phân phối
  useEffect(() => {
    apiFetch(`${API_URL}/einvoice/distributors`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: DistributorOption[]) => {
        setDistributors(list);
        if (authSession.distributorId && list.some((d) => d.id === authSession.distributorId)) {
          setSelectedDistId(authSession.distributorId);
        } else if (list.length > 0) {
          setSelectedDistId(list[0].id);
        }
      })
      .catch(() => {});
  }, [authSession.distributorId]);

  // 2. Tải trạng thái tài khoản CQT
  const loadCredentialsStatus = useCallback(async (distId: number) => {
    try {
      const res = await apiFetch(
        `${API_URL}/einvoice/purchase-invoices/credentials?distributor_id=${distId}`
      );
      if (res.ok) {
        const data = (await res.json()) as CredentialStatus;
        setCredStatus(data);
        const accounts = data.accounts || [];
        setActiveTaxCredentialId((current) =>
          current && accounts.some((account) => account.id === current)
            ? current
            : accounts[0]?.id ?? null
        );
        const activeAccount = accounts[0];
        setAuthUsername(activeAccount?.username || data.username || "");
      }
    } catch {
      // ignore
    }
  }, []);

  // 3. Tải danh sách hóa đơn theo bộ lọc
  const loadPurchaseInvoices = useCallback(async () => {
    if (!selectedDistId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        distributor_id: String(selectedDistId),
        seller_tax_code: sellerTaxOrName,
        buyer_identity: buyerIdentity,
        status_filter: statusFilter,
        check_result: checkResultFilter,
        invoice_number: invoiceNumberFilter,
        invoice_template: invoiceTemplateFilter,
        invoice_symbol: invoiceSymbolFilter,
        search: searchQuery,
      });
      if (fromDate) params.set("from_date", fromDate);
      if (toDate) params.set("to_date", toDate);

      const res = await apiFetch(
        `${API_URL}/einvoice/purchase-invoices?${params.toString()}`
      );
      if (!res.ok) {
        throw new Error("Không thể tải danh sách hóa đơn mua vào.");
      }
      const data = await res.json();
      setStats(data.stats);
      setSellers(data.sellers || []);
      const list = (data.invoices || []) as PurchaseInvoiceRow[];
      setInvoices(list);
      setGoodsSummary(data.goods_summary || []);
      setCurrentPage(1);
      setCheckedIds([]);
      if (list.length > 0) {
        setSelectedRowId(list[0].id);
      } else {
        setSelectedRowId(null);
      }
    } catch (err) {
      setBannerMsg({
        type: "error",
        text:
          err instanceof Error ? err.message : "Lỗi tải dữ liệu hóa đơn mua vào.",
      });
    } finally {
      setLoading(false);
    }
  }, [
    selectedDistId,
    fromDate,
    toDate,
    sellerTaxOrName,
    buyerIdentity,
    statusFilter,
    checkResultFilter,
    invoiceNumberFilter,
    invoiceTemplateFilter,
    invoiceSymbolFilter,
    searchQuery,
  ]);

  useEffect(() => {
    if (selectedDistId) {
      // These callbacks perform asynchronous external data loading.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadCredentialsStatus(selectedDistId);
      loadPurchaseInvoices();
    }
  }, [selectedDistId, loadCredentialsStatus, loadPurchaseInvoices]);

  // Danh sách hóa đơn theo Tab đang chọn (Hóa đơn điện tử vs Hóa đơn máy tính tiền)
  const filteredInvoicesByTab = useMemo(() => {
    if (activeTab === "mtt") {
      return invoices.filter(
        (inv) => inv.is_mtt || inv.invoice_category === "MAY_TINH_TIEN" || inv.ttxly === "8"
      );
    }
    if (activeTab === "hddt") {
      return invoices.filter(
        (inv) => !(inv.is_mtt || inv.invoice_category === "MAY_TINH_TIEN" || inv.ttxly === "8")
      );
    }
    return invoices;
  }, [invoices, activeTab]);

  // Tính tổng cộng của các hóa đơn trên Tab hiện tại
  const tabTotals = useMemo(() => {
    let beforeTax = 0;
    let tax = 0;
    let discount = 0;
    let fee = 0;
    let payment = 0;
    for (const inv of filteredInvoicesByTab) {
      const mult = inv.is_replaced ? -1 : 1;
      beforeTax += (inv.amount_before_tax || 0) * mult;
      tax += (inv.tax_amount || 0) * mult;
      discount += (inv.discount_amount || 0) * mult;
      fee += (inv.fee_amount || 0) * mult;
      payment += (inv.total_amount || 0) * mult;
    }
    return { beforeTax, tax, discount, fee, payment };
  }, [filteredInvoicesByTab]);

  const totalPages = Math.max(1, Math.ceil(filteredInvoicesByTab.length / pageSize));
  const pagedInvoices = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredInvoicesByTab.slice(start, start + pageSize);
  }, [filteredInvoicesByTab, currentPage, pageSize]);

  const isLocalHost =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1");

  const loadCaptcha = useCallback(async () => {
    setCaptchaLoading(true);
    setCaptchaValue("");
    try {
      const res = await apiFetch(`${API_URL}/einvoice/purchase-invoices/captcha`);
      const data = (await res.json()) as CaptchaData & { detail?: string };
      if (!res.ok) {
        throw new Error(data.detail || "Không thể tải CAPTCHA Cổng Thuế.");
      }
      setCaptcha(data);
    } catch (err) {
      setCaptcha(null);
      setAuthError(
        err instanceof Error ? err.message : "Không thể tải CAPTCHA Cổng Thuế."
      );
    } finally {
      setCaptchaLoading(false);
    }
  }, []);

  const captchaSrc = useMemo(() => {
    if (!captcha?.content) return "";
    if (captcha.content.startsWith("data:image/")) return captcha.content;
    if (captcha.content.trim().startsWith("<")) {
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
        captcha.content
      )}`;
    }
    return `data:image/svg+xml;base64,${captcha.content}`;
  }, [captcha]);

  // Reset bộ lọc ("Bỏ tìm kiếm" giống Web Thuế)
  const handleResetFilters = () => {
    const def = getDefaultMonthRange();
    setSellerTaxOrName("");
    setBuyerIdentity("");
    setStatusFilter("ALL");
    setCheckResultFilter("ALL");
    setInvoiceNumberFilter("");
    setInvoiceTemplateFilter("");
    setInvoiceSymbolFilter("");
    setDelegatedInvoice(false);
    setSearchQuery("");
    setFromDate(def.from);
    setToDate(def.to);
    setCurrentPage(1);
  };

  const openAuthModal = useCallback((accountId?: number) => {
    const account =
      credStatus?.accounts.find((item) => item.id === accountId) ??
      credStatus?.accounts[0];
    setActiveTaxCredentialId(account?.id ?? null);
    setAuthUsername(account?.username ?? "");
    setAuthPassword("");
    setAuthManualToken("");
    setShowManualToken(false);
    setAuthError("");
    setAuthModalOpen(true);
    void loadCaptcha();
  }, [credStatus, loadCaptcha]);

  // Lưu Bearer Token CQT (hoặc parse cURL) và đồng bộ trực tiếp qua HTTP thuần
  const handleSaveTokenAndSync = useCallback(async () => {
    if (!selectedDistId) return;
    const cleanToken = authManualToken.trim();
    const hasExistingToken = Boolean(
      activeTaxAccount?.has_bearer_token || credStatus?.has_bearer_token
    );

    if (!cleanToken && !hasExistingToken && !captchaValue.trim()) {
      setAuthError(
        "Vui lòng dán Bearer Token hoặc lệnh cURL từ Cổng Thuế (hoadondientu.gdt.gov.vn)."
      );
      return;
    }

    setSavingToken(true);
    setAuthError("");
    try {
      let targetCredId = activeTaxCredentialId;

      // 1. Nếu người dùng dán Token mới -> Lưu Token vào hệ thống
      if (cleanToken || captchaValue.trim()) {
        const authRes = await apiFetch(
          `${API_URL}/einvoice/purchase-invoices/authenticate`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              distributor_id: selectedDistId,
              credential_id: activeTaxCredentialId || undefined,
              username: authUsername,
              password: authPassword || undefined,
              manual_bearer_token: cleanToken || undefined,
              ckey: cleanToken ? undefined : captcha?.key,
              cvalue: cleanToken ? undefined : captchaValue.trim(),
            }),
          }
        );
        const authData = await authRes.json();
        if (!authRes.ok && !cleanToken) {
          await loadCaptcha();
          setAuthError(
            authData.detail ||
              "Đăng nhập Cổng Thuế thất bại. Vui lòng kiểm tra CAPTCHA và mật khẩu."
          );
          return;
        }
        if (!authRes.ok) {
          throw new Error(authData.detail || "Không thể lưu Bearer Token CQT.");
        }
        targetCredId = authData.credential_id || activeTaxCredentialId;
        await loadCredentialsStatus(selectedDistId);
      }

      setAuthModalOpen(false);
      setBannerMsg({
        type: "info",
        text: cleanToken
          ? "Đã cập nhật Bearer Token CQT. Đang kết nối tải danh sách hóa đơn mua vào..."
          : "Đang kết nối tải danh sách hóa đơn mua vào từ Cổng Tổng cục Thuế...",
      });

      // 2. Chạy đồng bộ hóa đơn mua vào qua HTTP
      setSyncing(true);
      const syncRes = await apiFetch(
        `${API_URL}/einvoice/purchase-invoices/sync`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            distributor_id: selectedDistId,
            tax_credential_id: targetCredId || undefined,
            from_date: fromDate,
            to_date: toDate,
          }),
        }
      );
      const syncData = await syncRes.json();
      if (syncRes.status === 428 || syncRes.status === 401) {
        setAuthModalOpen(true);
        void loadCaptcha();
        setAuthError(
          "Phiên Bearer Token đã hết hạn (Cổng Thuế hết hạn sau 24h). Vui lòng mở https://hoadondientu.gdt.gov.vn, đăng nhập lại và dán Token mới vào khung bên dưới."
        );
        return;
      }
      if (!syncRes.ok) {
        throw new Error(
          syncData.detail || "Lỗi khi đồng bộ hóa đơn mua vào từ Tổng cục Thuế."
        );
      }

      setBannerMsg({
        type: "success",
        text: `Đồng bộ thành công từ Tổng cục Thuế: Tìm thấy ${syncData.total_found} hóa đơn, đã lưu ${syncData.saved_invoices} hóa đơn và bóc tách chi tiết ${syncData.xml_extracted_count} file XML!`,
      });
      await loadPurchaseInvoices();
    } catch (err) {
      setBannerMsg({
        type: "error",
        text:
          err instanceof Error
            ? err.message
            : "Lỗi khi cập nhật Token hoặc tải hóa đơn.",
      });
    } finally {
      setSavingToken(false);
      setSyncing(false);
    }
  }, [
    selectedDistId,
    activeTaxCredentialId,
    activeTaxAccount,
    credStatus,
    authManualToken,
    authUsername,
    authPassword,
    captcha,
    captchaValue,
    fromDate,
    toDate,
    loadCredentialsStatus,
    loadCaptcha,
    loadPurchaseInvoices,
  ]);

  // Mở cửa sổ trình duyệt hoadondientu.gdt.gov.vn để đăng nhập thủ công -> Tự bắt Token -> Tự đồng bộ (dành cho local có Playwright)
  const handleInteractiveLoginAndSync = useCallback(async () => {
    if (!selectedDistId) return;
    setSyncing(true);
    setAuthModalOpen(false);
    setBannerMsg({
      type: "info",
      text: "Đang mở cửa sổ trang Thuế (hoadondientu.gdt.gov.vn)... Bạn hãy nhập CAPTCHA và bấm Đăng nhập trên cửa sổ đó, hệ thống sẽ tự động bắt Bearer Token và tải toàn bộ hóa đơn về!",
    });
    try {
      const res = await apiFetch(
        `${API_URL}/einvoice/purchase-invoices/interactive-login-sync`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            distributor_id: selectedDistId,
            tax_credential_id: activeTaxCredentialId || undefined,
            from_date: fromDate,
            to_date: toDate,
            username: authUsername || undefined,
            password: authPassword || undefined,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.detail || "Không thể lấy Token hoặc đồng bộ từ cửa sổ trình duyệt."
        );
      }
      setBannerMsg({
        type: "success",
        text: `Đã tự động bắt Bearer Token & đồng bộ thành công: Tìm thấy ${data.total_found} hóa đơn, lưu ${data.saved_invoices} hóa đơn và bóc tách chi tiết ${data.xml_extracted_count} file XML!`,
      });
      await loadCredentialsStatus(selectedDistId);
      await loadPurchaseInvoices();
    } catch (err) {
      setBannerMsg({
        type: "error",
        text:
          err instanceof Error
            ? err.message
            : "Lỗi khi đăng nhập hoặc đồng bộ hóa đơn mua vào.",
      });
    } finally {
      setSyncing(false);
    }
  }, [
    selectedDistId,
    activeTaxCredentialId,
    fromDate,
    toDate,
    authUsername,
    authPassword,
    loadCredentialsStatus,
    loadPurchaseInvoices,
  ]);

  // Thực thi đồng bộ từ Cổng Thuế
  const handleSyncFromGdt = useCallback(async () => {
    if (!selectedDistId) return;
    setSyncing(true);
    setBannerMsg({
      type: "info",
      text: "Đang kết nối Cổng Tổng cục Thuế (hoadondientu.gdt.gov.vn) để tra cứu và bóc tách XML hóa đơn mua vào...",
    });
    try {
      const res = await apiFetch(`${API_URL}/einvoice/purchase-invoices/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          distributor_id: selectedDistId,
          from_date: fromDate,
          to_date: toDate,
        }),
      });
      const data = await res.json();
      if (res.status === 428 || res.status === 401) {
        setAuthModalOpen(true);
        setAuthError(
          data.detail ||
            "Phiên Bearer Token Cổng Thuế chưa có hoặc đã hết hạn. Vui lòng dán Bearer Token (hoặc lệnh cURL từ F12 DevTools) để làm mới phiên."
        );
        setBannerMsg({
          type: "warning",
          text: "Phiên kết nối Cổng Thuế đã hết hạn. Vui lòng cập nhật Bearer Token CQT để tiếp tục.",
        });
        return;
      }
      if (!res.ok) {
        throw new Error(data.detail || "Không thể đồng bộ hóa đơn mua vào.");
      }
      setBannerMsg({
        type:
          data.errors?.length || data.warnings?.length || data.skipped_accounts
            ? "warning"
            : "success",
        text: `Đồng bộ ${data.synced_accounts || 1} tài khoản: Tìm thấy ${data.total_found} hóa đơn, đã lưu ${data.saved_invoices} hóa đơn, bóc tách ${data.xml_extracted_count} XML.${
          data.errors?.length
            ? ` Có ${data.errors.length} tài khoản lỗi.`
            : ""
        }${
          data.skipped_accounts
            ? ` Có ${data.skipped_accounts} tài khoản chưa có token nên bị bỏ qua.`
            : ""
        }${
          data.warnings?.length
            ? ` Có ${data.warnings.length} cảnh báo trong quá trình lấy dữ liệu.`
            : ""
        }`,
      });
      await loadCredentialsStatus(selectedDistId);
      await loadPurchaseInvoices();
    } catch (err) {
      setBannerMsg({
        type: "error",
        text: err instanceof Error ? err.message : "Lỗi đồng bộ hóa đơn mua vào.",
      });
    } finally {
      setSyncing(false);
    }
  }, [
    selectedDistId,
    fromDate,
    toDate,
    loadCredentialsStatus,
    loadPurchaseInvoices,
  ]);

  const handleAuthenticateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await handleSaveTokenAndSync();
  };

  const handleDeleteTaxAccount = async () => {
    if (!deletingTaxAccount) return;
    setDeletingAccount(true);
    try {
      const res = await apiFetch(
        `${API_URL}/einvoice/purchase-invoices/credentials/${deletingTaxAccount.id}?distributor_id=${selectedDistId}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Không thể xóa tài khoản thuế.");
      }
      setBannerMsg({
        type: "success",
        text: `Đã xóa tài khoản thuế ${data.username} cùng ${data.deleted_invoices} hóa đơn đã đồng bộ.`,
      });
      setDeletingTaxAccount(null);
      await Promise.all([
        loadCredentialsStatus(selectedDistId),
        loadPurchaseInvoices(),
      ]);
    } catch (err) {
      setBannerMsg({
        type: "error",
        text: err instanceof Error ? err.message : "Lỗi khi xóa tài khoản thuế.",
      });
    } finally {
      setDeletingAccount(false);
    }
  };

  // Xem chi tiết Hóa đơn mua vào (Khi click vào dòng hoặc bấm nút Xem)
  const openInvoiceDetail = async (
    invoiceId: number,
    initialMode: "html" | "items" | "xml" = "items"
  ) => {
    setSelectedRowId(invoiceId);
    setDetailModalOpen(true);
    setDetailLoading(true);
    setDetailViewMode(initialMode);
    try {
      const res = await apiFetch(
        `${API_URL}/einvoice/purchase-invoices/${invoiceId}/detail`
      );
      if (!res.ok) throw new Error("Không thể tải chi tiết hóa đơn.");
      const data = (await res.json()) as PurchaseInvoiceDetail;
      setDetailData(data);
      if (initialMode === "html" && !data.html_content) {
        setDetailViewMode("items");
      }
    } catch (err) {
      setBannerMsg({
        type: "error",
        text: err instanceof Error ? err.message : "Lỗi tải chi tiết hóa đơn.",
      });
      setDetailModalOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  // In trực tiếp hóa đơn đang chọn
  const handlePrintSelectedInvoice = async (invoiceId?: number) => {
    const targetId = invoiceId || selectedRowId;
    if (!targetId) {
      setBannerMsg({
        type: "info",
        text: "Vui lòng click chọn một hóa đơn trong danh sách để in.",
      });
      return;
    }
    try {
      const res = await apiFetch(
        `${API_URL}/einvoice/purchase-invoices/${targetId}/detail`
      );
      if (!res.ok) throw new Error("Không thể tải bản thể hiện hóa đơn.");
      const data = (await res.json()) as PurchaseInvoiceDetail;
      if (data.html_content) {
        const win = window.open("", "_blank");
        if (win) {
          win.document.write(data.html_content);
          win.document.close();
          win.focus();
          win.print();
        }
      } else {
        openInvoiceDetail(targetId, "items");
      }
    } catch {
      openInvoiceDetail(targetId, "items");
    }
  };

  const handleDeleteInvoice = async (invoiceId: number, shdon: string) => {
    if (!window.confirm(`Xóa hóa đơn mua vào số ${shdon} khỏi hệ thống?`)) return;
    try {
      const res = await apiFetch(
        `${API_URL}/einvoice/purchase-invoices/${invoiceId}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        await loadPurchaseInvoices();
      }
    } catch {
      // ignore
    }
  };

  // Tải 1 file XML gốc
  const downloadSingleXml = (detail: PurchaseInvoiceDetail) => {
    if (!detail.xml_content) return;
    const blob = new Blob(["\uFEFF" + detail.xml_content], {
      type: "application/xml;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${detail.seller_tax_code}_${detail.invoice_template}_${detail.invoice_symbol}_${detail.invoice_number}.xml`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  };

  // Tải 1 file HTML bản thể hiện riêng
  const downloadSingleHtml = (detail: PurchaseInvoiceDetail) => {
    if (!detail.html_content) return;
    const blob = new Blob([detail.html_content], {
      type: "text/html;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${detail.seller_tax_code}_${detail.invoice_template}_${detail.invoice_symbol}_${detail.invoice_number}.html`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  };

  // Tải riêng XML, riêng HTML hoặc gói ZIP (XML + HTML) cho 1 hoặc nhiều hóa đơn
  const handleDownloadZip = async (
    specificIds?: number[],
    fileType: "all" | "xml" | "html" = "all"
  ) => {
    if (!selectedDistId) return;
    const targetIds =
      specificIds && specificIds.length > 0
        ? specificIds
        : checkedIds.length > 0
        ? checkedIds
        : filteredInvoicesByTab.map((r) => r.id);

    if (targetIds.length === 0) {
      setBannerMsg({
        type: "info",
        text: "Không có hóa đơn nào để tải xuống.",
      });
      return;
    }

    setDownloadingZip(true);
    try {
      const res = await apiFetch(
        `${API_URL}/einvoice/purchase-invoices/download-zip`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            distributor_id: selectedDistId,
            invoice_ids: targetIds,
            file_type: fileType,
          }),
        }
      );
      if (!res.ok) {
        throw new Error("Không thể tải file hóa đơn.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      if (targetIds.length === 1 && fileType === "xml") {
        const inv = invoices.find((x) => x.id === targetIds[0]);
        a.download = inv
          ? `${inv.seller_tax_code}_${inv.invoice_template}_${inv.invoice_symbol}_${inv.invoice_number}.xml`
          : `Hoa_don_${targetIds[0]}.xml`;
      } else if (targetIds.length === 1 && fileType === "html") {
        const inv = invoices.find((x) => x.id === targetIds[0]);
        a.download = inv
          ? `${inv.seller_tax_code}_${inv.invoice_template}_${inv.invoice_symbol}_${inv.invoice_number}.html`
          : `Hoa_don_${targetIds[0]}.html`;
      } else {
        const suffix =
          fileType === "xml" ? "XML" : fileType === "html" ? "HTML" : "XML_HTML";
        a.download =
          targetIds.length === 1
            ? `Hoa_don_mua_vao_${targetIds[0]}_${suffix}.zip`
            : `Hoa_don_mua_vao_${suffix}_${fromDate}_${toDate}.zip`;
      }
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 150);
    } catch (err) {
      setBannerMsg({
        type: "error",
        text: err instanceof Error ? err.message : "Lỗi khi tải file ZIP hóa đơn.",
      });
    } finally {
      setDownloadingZip(false);
    }
  };

  // Xuất Excel danh sách hóa đơn hoặc bảng tổng hợp hàng hóa
  const handleExportExcel = () => {
    if (activeTab === "summary") {
      if (goodsSummary.length === 0) return;
      downloadExcel(
        goodsSummary.map((row, idx) => ({
          STT: idx + 1,
          "Mã hàng hóa dịch vụ": row.product_code,
          "Tên hàng hóa dịch vụ": row.product_name,
          "Đơn vị tính": row.unit_name,
          "Nhà cung cấp": row.seller_names,
          "Đơn giá": row.unit_price,
          "Tổng số lượng": row.total_quantity,
          "Tổng thành tiền": row.total_amount,
        })),
        `Bang_tong_hop_hang_hoa_mua_vao_${fromDate}_${toDate}`,
        "Tổng hợp hàng hóa"
      );
    } else {
      const sourceList =
        checkedIds.length > 0
          ? filteredInvoicesByTab.filter((i) => checkedIds.includes(i.id))
          : filteredInvoicesByTab;
      if (sourceList.length === 0) return;
      const flatRows: Record<string, unknown>[] = [];
      for (const inv of sourceList) {
        if (inv.items && inv.items.length > 0) {
          for (const it of inv.items) {
            flatRows.push({
              "MST Người mua": inv.buyer_tax_code,
              "Ký hiệu mẫu số": inv.invoice_template,
              "Ký hiệu hóa đơn": inv.invoice_symbol,
              "Số hóa đơn": inv.invoice_number,
              "Ngày lập": inv.invoice_date,
              "MST Người bán": inv.seller_tax_code,
              "Tên người bán": inv.seller_name,
              "Tổng tiền chưa thuế (HĐ)": inv.amount_before_tax,
              "Tổng tiền thuế (HĐ)": inv.tax_amount,
              "Tổng tiền CKTM (HĐ)": inv.discount_amount,
              "Tổng tiền phí (HĐ)": inv.fee_amount,
              "Tổng tiền thanh toán (HĐ)": inv.total_amount,
              "Trạng thái HĐ": inv.tthai_label,
              "Kết quả kiểm tra": inv.kqkt_label,
              "Số HĐ Thay thế/Liên quan": inv.replaced_invoice_number,
              "Mã hàng hóa dịch vụ": it.product_code,
              "Tên hàng hóa dịch vụ": it.product_name,
              "Đơn vị tính": it.unit_name,
              "Số lượng": it.quantity,
              "Đơn giá": it.unit_price,
              "Chiết khấu dòng": it.discount_amount,
              "Thành tiền trước thuế": it.amount_before_tax,
              "Thuế suất": it.vat_rate,
            });
          }
        } else {
          flatRows.push({
            "MST Người mua": inv.buyer_tax_code,
            "Ký hiệu mẫu số": inv.invoice_template,
            "Ký hiệu hóa đơn": inv.invoice_symbol,
            "Số hóa đơn": inv.invoice_number,
            "Ngày lập": inv.invoice_date,
            "MST Người bán": inv.seller_tax_code,
            "Tên người bán": inv.seller_name,
            "Tổng tiền chưa thuế (HĐ)": inv.amount_before_tax,
            "Tổng tiền thuế (HĐ)": inv.tax_amount,
            "Tổng tiền CKTM (HĐ)": inv.discount_amount,
            "Tổng tiền phí (HĐ)": inv.fee_amount,
            "Tổng tiền thanh toán (HĐ)": inv.total_amount,
            "Trạng thái HĐ": inv.tthai_label,
            "Kết quả kiểm tra": inv.kqkt_label,
            "Số HĐ Thay thế/Liên quan": inv.replaced_invoice_number,
            "Mã hàng hóa dịch vụ": "",
            "Tên hàng hóa dịch vụ": "",
            "Đơn vị tính": "",
            "Số lượng": 0,
            "Đơn giá": 0,
            "Chiết khấu dòng": 0,
            "Thành tiền trước thuế": inv.amount_before_tax,
            "Thuế suất": "",
          });
        }
      }
      downloadExcel(
        flatRows,
        `Danh_sach_hoa_don_mua_vao_${fromDate}_${toDate}`,
        "Hóa đơn mua vào"
      );
    }
  };

  const toggleCheckAll = () => {
    const pageIds = pagedInvoices.map((r) => r.id);
    const allChecked =
      pageIds.length > 0 && pageIds.every((id) => checkedIds.includes(id));
    if (allChecked) {
      setCheckedIds((prev) => prev.filter((id) => !pageIds.includes(id)));
    } else {
      setCheckedIds((prev) => Array.from(new Set([...prev, ...pageIds])));
    }
  };

  const toggleCheckRow = (id: number) => {
    setCheckedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  return (
    <div className="space-y-3">
      {/* KHUNG CHÍNH (Chuẩn CreateOrderForm + Bố cục Cổng Thuế GDT) */}
      <div className="border border-slate-400 bg-white shadow-lg">
        {/* 1. HEADER MODAL / FORM */}
        <div className="bg-[#14263d] px-3 py-2 text-white flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileText size={17} className="text-red-500" />
            <span className="text-xs font-bold uppercase tracking-wide text-white">
              Danh Sách Hóa Đơn Điện Tử Mua Vào (Cổng Thuế - hoadondientu.gdt.gov.vn)
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Chọn Nhà phân phối */}
            <select
              value={selectedDistId}
              onChange={(e) => setSelectedDistId(Number(e.target.value))}
              className="rounded border border-slate-500 bg-[#1e3554] px-2 py-1 text-[11px] font-semibold text-white focus:border-sky-400 focus:outline-none"
            >
              {distributors.map((d) => (
                <option key={d.id} value={d.id}>
                  NPP: {d.code} - {d.name} (MST: {d.tax_code || "N/A"})
                </option>
              ))}
            </select>

            {credStatus?.has_bearer_token ? (
              <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 border border-emerald-400/40 px-2 py-0.5 text-[10px] font-semibold text-emerald-200">
                <ShieldCheck size={12} />
                Đã kết nối {credStatus.accounts.filter((item) => item.has_bearer_token).length}/
                {credStatus.accounts.length} tài khoản CQT
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded bg-amber-500/20 border border-amber-400/40 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
                <AlertTriangle size={12} />
                Chưa có phiên CQT
              </span>
            )}

            <button
              type="button"
              onClick={() => openAuthModal()}
              className="inline-flex items-center gap-1 rounded bg-white/10 hover:bg-white/20 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors"
            >
              <KeyRound size={12} />
              Mở Web Thuế / Token CQT
            </button>

            <button
              type="button"
              onClick={handleSyncFromGdt}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 rounded bg-sky-600 hover:bg-sky-700 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {syncing ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
              Đồng bộ Hóa đơn & Tải XML từ CQT
            </button>
          </div>
        </div>

        {/* 2. BỘ LỌC TRA CỨU Y HỆT BỐ CỤC 2 CỘT CỦA TRANG WEB THUẾ */}
        <div className="border-b border-slate-200 px-4 py-3 bg-white">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-2.5">
            {/* CỘT TRÁI */}
            <div className="space-y-2">
              {/* MST người bán */}
              <div className="grid grid-cols-12 items-center gap-2">
                <label className="col-span-4 text-[11px] font-semibold text-slate-700">
                  MST người bán
                </label>
                <div className="col-span-8">
                  <input
                    type="text"
                    list="gdt-sellers-list"
                    placeholder="Nhập MST hoặc tên người bán (VD: 0700242558)..."
                    value={sellerTaxOrName}
                    onChange={(e) => setSellerTaxOrName(e.target.value)}
                    className={inputCls}
                  />
                  <datalist id="gdt-sellers-list">
                    {sellers.map((s) => (
                      <option key={s.tax_code} value={s.tax_code}>
                        {s.tax_code} - {s.name}
                      </option>
                    ))}
                  </datalist>
                </div>
              </div>

              {/* Trạng thái hóa đơn (*) */}
              <div className="grid grid-cols-12 items-center gap-2">
                <label className="col-span-4 text-[11px] font-semibold text-slate-700">
                  Trạng thái hóa đơn <span className="text-red-600">(*)</span>
                </label>
                <div className="col-span-8">
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className={inputCls}
                  >
                    <option value="ALL">Tất cả</option>
                    <option value="1">Hóa đơn mới</option>
                    <option value="2">Hóa đơn thay thế</option>
                    <option value="3">Hóa đơn điều chỉnh</option>
                    <option value="4">Hóa đơn đã bị thay thế</option>
                    <option value="5">Hóa đơn đã bị điều chỉnh</option>
                    <option value="6">Hóa đơn đã bị hủy</option>
                  </select>
                </div>
              </div>

              {/* Kết quả kiểm tra (*) */}
              <div className="grid grid-cols-12 items-center gap-2">
                <label className="col-span-4 text-[11px] font-semibold text-slate-700">
                  Kết quả kiểm tra <span className="text-red-600">(*)</span>
                </label>
                <div className="col-span-8">
                  <select
                    value={checkResultFilter}
                    onChange={(e) => setCheckResultFilter(e.target.value)}
                    className={inputCls}
                  >
                    <option value="ALL">Tất cả (Đã cấp mã + Không mã + Máy tính tiền)</option>
                    <option value="5">Đã cấp mã hóa đơn</option>
                    <option value="6">Cục Thuế đã nhận không mã</option>
                    <option value="8">Đã cấp mã hóa đơn có mã khởi tạo từ máy tính tiền</option>
                  </select>
                </div>
              </div>

              {/* Số hóa đơn */}
              <div className="grid grid-cols-12 items-center gap-2">
                <label className="col-span-4 text-[11px] font-semibold text-slate-700">
                  Số hóa đơn
                </label>
                <div className="col-span-8">
                  <input
                    type="text"
                    placeholder="VD: 16407"
                    value={invoiceNumberFilter}
                    onChange={(e) => setInvoiceNumberFilter(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>

              {/* Hóa đơn ủy nhiệm */}
              <div className="grid grid-cols-12 items-center gap-2">
                <label className="col-span-4 text-[11px] font-semibold text-slate-700">
                  Hóa đơn ủy nhiệm
                </label>
                <div className="col-span-8 flex items-center gap-4">
                  <input
                    type="checkbox"
                    checked={delegatedInvoice}
                    onChange={(e) => setDelegatedInvoice(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                  />
                  <input
                    type="text"
                    placeholder="Tìm nhanh theo tên sản phẩm / mã hàng hóa..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>
            </div>

            {/* CỘT PHẢI */}
            <div className="space-y-2">
              {/* CCCD người mua */}
              <div className="grid grid-cols-12 items-center gap-2">
                <label className="col-span-4 text-[11px] font-semibold text-slate-700">
                  CCCD / MST người mua
                </label>
                <div className="col-span-8">
                  <input
                    type="text"
                    placeholder="Nhập MST hoặc CCCD người mua..."
                    value={buyerIdentity}
                    onChange={(e) => setBuyerIdentity(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>

              {/* Ngày lập hóa đơn (*) Từ ngày - Đến ngày */}
              <div className="grid grid-cols-12 items-center gap-2">
                <label className="col-span-4 text-[11px] font-semibold text-slate-700">
                  Ngày lập hóa đơn <span className="text-red-600">(*)</span>
                </label>
                <div className="col-span-8 grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-slate-500 whitespace-nowrap">
                      Từ ngày
                    </span>
                    <input
                      type="date"
                      value={fromDate}
                      onChange={(e) => setFromDate(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-slate-500 whitespace-nowrap">
                      Đến ngày
                    </span>
                    <input
                      type="date"
                      value={toDate}
                      onChange={(e) => setToDate(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                </div>
              </div>

              {/* Ký hiệu mẫu số hóa đơn */}
              <div className="grid grid-cols-12 items-center gap-2">
                <label className="col-span-4 text-[11px] font-semibold text-slate-700">
                  Ký hiệu mẫu số hóa đơn
                </label>
                <div className="col-span-8">
                  <select
                    value={invoiceTemplateFilter}
                    onChange={(e) => setInvoiceTemplateFilter(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">Tất cả mẫu số</option>
                    <option value="1">1 - Hóa đơn giá trị gia tăng</option>
                    <option value="2">2 - Hóa đơn bán hàng</option>
                    <option value="3">3 - Hóa đơn bán tài sản công</option>
                    <option value="4">4 - Hóa đơn bán hàng dự trữ quốc gia</option>
                    <option value="5">5 - Các loại hóa đơn khác</option>
                    <option value="6">6 - Các chứng từ được in, phát hành như hóa đơn</option>
                  </select>
                </div>
              </div>

              {/* Ký hiệu hóa đơn */}
              <div className="grid grid-cols-12 items-center gap-2">
                <label className="col-span-4 text-[11px] font-semibold text-slate-700">
                  Ký hiệu hóa đơn
                </label>
                <div className="col-span-8">
                  <input
                    type="text"
                    placeholder="VD: C26THP"
                    value={invoiceSymbolFilter}
                    onChange={(e) => setInvoiceSymbolFilter(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* HÀNG NÚT GIỮA: TÌM KIẾM | BỎ TÌM KIẾM (Chuẩn bố cục Web Thuế) */}
          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={loadPurchaseInvoices}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded bg-[#14263d] hover:bg-[#1e3554] px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors"
            >
              <Search size={13} />
              Tìm kiếm
            </button>
            <button
              type="button"
              onClick={handleResetFilters}
              className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-slate-100 hover:bg-slate-200 px-4 py-1.5 text-xs font-semibold text-slate-700 transition-colors"
            >
              <RotateCcw size={13} />
              Bỏ tìm kiếm
            </button>
          </div>
        </div>

        {/* Thông báo trạng thái */}
        {bannerMsg && (
          <div
            className={`border-b px-3 py-2 text-xs flex items-center justify-between ${
              bannerMsg.type === "error"
                ? "border-red-200 bg-red-50 text-red-700"
                : bannerMsg.type === "warning"
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : bannerMsg.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-sky-200 bg-sky-50 text-sky-800"
            }`}
          >
            <span>{bannerMsg.text}</span>
            <button
              type="button"
              onClick={() => setBannerMsg(null)}
              className="text-slate-400 hover:text-slate-600"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* 3. THANH KẾT QUẢ + PHÂN TRANG + TOOLBAR ICON BÊN PHẢI (Giống ảnh chụp Web Thuế) */}
        <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3 text-xs text-slate-700">
            <span>
              Có{" "}
              <strong className="font-bold text-slate-900">
                {activeTab === "summary"
                  ? goodsSummary.length
                  : filteredInvoicesByTab.length}
              </strong>{" "}
              kết quả
            </span>
            {checkedIds.length > 0 && (
              <span className="rounded bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800">
                Đang chọn {checkedIds.length} hóa đơn
              </span>
            )}
          </div>

          {/* Phân trang + 4 Nút công cụ Xem / In / Xuất Excel / Tải ZIP XML */}
          <div className="flex flex-wrap items-center gap-1.5">
            {activeTab !== "summary" && (
              <div className="flex items-center gap-1 mr-1">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="rounded border border-slate-300 bg-white p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                  title="Trang trước"
                >
                  <ChevronLeft size={13} />
                </button>
                <span className="px-2 text-[11px] font-semibold text-slate-700">
                  {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="rounded border border-slate-300 bg-white p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                  title="Trang sau"
                >
                  <ChevronRight size={13} />
                </button>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-700"
                >
                  <option value={15}>15</option>
                  <option value={30}>30</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            )}

            {/* Icon 1: Xem chi tiết hóa đơn đang chọn */}
            <button
              type="button"
              onClick={() => {
                if (selectedRowId) {
                  openInvoiceDetail(selectedRowId, "items");
                } else if (filteredInvoicesByTab.length > 0) {
                  openInvoiceDetail(filteredInvoicesByTab[0].id, "items");
                }
              }}
              disabled={filteredInvoicesByTab.length === 0}
              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white hover:bg-sky-50 px-2 py-1 text-[11px] font-semibold text-slate-700 transition-colors disabled:opacity-40"
              title="Xem chi tiết hóa đơn đang chọn"
            >
              <Eye size={13} className="text-sky-700" />
              Xem HĐ
            </button>

            {/* Icon 2: In bản thể hiện hóa đơn */}
            <button
              type="button"
              onClick={() => handlePrintSelectedInvoice()}
              disabled={filteredInvoicesByTab.length === 0}
              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white hover:bg-sky-50 px-2 py-1 text-[11px] font-semibold text-slate-700 transition-colors disabled:opacity-40"
              title="In bản thể hiện hóa đơn đang chọn"
            >
              <Printer size={13} className="text-slate-700" />
              In HĐ
            </button>

            {/* Icon 3: Xuất Excel */}
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={
                (activeTab !== "summary" && filteredInvoicesByTab.length === 0) ||
                (activeTab === "summary" && goodsSummary.length === 0)
              }
              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white hover:bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 transition-colors disabled:opacity-40"
              title="Xuất danh sách ra file Excel (.xlsx)"
            >
              <FileSpreadsheet size={13} className="text-emerald-600" />
              Xuất Excel
            </button>

            {/* Icon 4: Tải riêng XML */}
            <button
              type="button"
              onClick={() => handleDownloadZip(undefined, "xml")}
              disabled={downloadingZip || filteredInvoicesByTab.length === 0}
              className="inline-flex items-center gap-1 rounded border border-sky-600 bg-white hover:bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-700 transition-colors disabled:opacity-40"
              title="Tải riêng file .XML của các hóa đơn đã chọn (hoặc đang lọc)"
            >
              <FileCode2 size={13} />
              Tải XML
              {checkedIds.length > 0 ? ` (${checkedIds.length})` : ""}
            </button>

            {/* Icon 5: Tải riêng HTML (Bản thể hiện) */}
            <button
              type="button"
              onClick={() => handleDownloadZip(undefined, "html")}
              disabled={downloadingZip || filteredInvoicesByTab.length === 0}
              className="inline-flex items-center gap-1 rounded border border-amber-600 bg-white hover:bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800 transition-colors disabled:opacity-40"
              title="Tải riêng file .HTML (Bản thể hiện) của các hóa đơn đã chọn (hoặc đang lọc)"
            >
              <FileText size={13} />
              Tải HTML
              {checkedIds.length > 0 ? ` (${checkedIds.length})` : ""}
            </button>

            {/* Icon 6: Download gói ZIP (XML + HTML) */}
            <button
              type="button"
              onClick={() => handleDownloadZip(undefined, "all")}
              disabled={downloadingZip || filteredInvoicesByTab.length === 0}
              className="inline-flex items-center gap-1 rounded bg-sky-600 hover:bg-sky-700 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors disabled:opacity-40"
              title="Tải gói file .ZIP gồm cả XML gốc + Bản thể hiện HTML của các hóa đơn"
            >
              {downloadingZip ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <FileArchive size={13} />
              )}
              Tải ZIP (XML+HTML)
              {checkedIds.length > 0 ? ` (${checkedIds.length})` : ""}
            </button>
          </div>
        </div>

        {/* 4. THANH CHUYỂN TAB GIỐNG WEB THUẾ: [Hóa đơn điện tử] | [Hóa đơn có mã khởi tạo từ máy tính tiền] | [Bảng tổng hợp hàng hóa] */}
        <div className="border-b border-slate-300 bg-slate-100 px-3 pt-1.5 flex flex-wrap items-end justify-between gap-2">
          <div className="flex items-end gap-1">
            <button
              type="button"
              onClick={() => {
                setActiveTab("hddt");
                setCurrentPage(1);
              }}
              className={`px-3.5 py-1.5 text-xs font-bold border-t border-l border-r rounded-t transition-colors ${
                activeTab === "hddt"
                  ? "bg-white text-amber-800 border-slate-300 -mb-px"
                  : "bg-slate-200/80 text-slate-600 border-transparent hover:bg-slate-200"
              }`}
            >
              Hóa đơn điện tử ({stats.hddt_count})
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab("mtt");
                setCurrentPage(1);
              }}
              className={`px-3.5 py-1.5 text-xs font-bold border-t border-l border-r rounded-t transition-colors ${
                activeTab === "mtt"
                  ? "bg-white text-amber-800 border-slate-300 -mb-px"
                  : "bg-slate-200/80 text-slate-600 border-transparent hover:bg-slate-200"
              }`}
            >
              Hóa đơn có mã khởi tạo từ máy tính tiền ({stats.mtt_count})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("summary")}
              className={`inline-flex items-center gap-1 px-3.5 py-1.5 text-xs font-bold border-t border-l border-r rounded-t transition-colors ${
                activeTab === "summary"
                  ? "bg-white text-sky-800 border-slate-300 -mb-px"
                  : "bg-slate-200/80 text-slate-600 border-transparent hover:bg-slate-200"
              }`}
            >
              <Layers size={12} />
              Bảng tổng hợp hàng hóa đầu vào ({goodsSummary.length} mặt hàng)
            </button>
          </div>
          <span className="pb-1 text-[10px] text-slate-500 italic">
            * Click trực tiếp vào bất kỳ dòng hóa đơn nào để xem chi tiết Hàng hóa, Bản thể hiện & XML
          </span>
        </div>

        {/* 5. BẢNG DỮ LIỆU CHUẨN CỔNG THUẾ */}
        {activeTab !== "summary" ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead className="bg-slate-100 text-[10px] font-semibold text-slate-700">
                <tr>
                  <th className="border-b border-r border-slate-200 px-2 py-2 text-center w-8">
                    <input
                      type="checkbox"
                      checked={
                        pagedInvoices.length > 0 &&
                        pagedInvoices.every((r) => checkedIds.includes(r.id))
                      }
                      onChange={toggleCheckAll}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-sky-600"
                    />
                  </th>
                  <th className="border-b border-r border-slate-200 px-2 py-2 text-center w-10">
                    STT
                  </th>
                  <th className="border-b border-r border-slate-200 px-2.5 py-2 text-center">
                    Tài khoản đồng bộ
                  </th>
                  <th className="border-b border-r border-slate-200 px-2.5 py-2 text-center">
                    Mã số thuế
                  </th>
                  <th className="border-b border-r border-slate-200 px-2 py-2 text-center">
                    Ký hiệu mẫu số
                  </th>
                  <th className="border-b border-r border-slate-200 px-2.5 py-2 text-center">
                    Ký hiệu hóa đơn
                  </th>
                  <th className="border-b border-r border-slate-200 px-2.5 py-2 text-center">
                    Số hóa đơn
                  </th>
                  <th className="border-b border-r border-slate-200 px-2.5 py-2 text-center">
                    Ngày lập
                  </th>
                  <th className="border-b border-r border-slate-200 px-2.5 py-2 min-w-[240px]">
                    Thông tin người bán
                  </th>
                  <th className="border-b border-r border-slate-200 px-2.5 py-2 text-right">
                    Tổng tiền chưa thuế
                  </th>
                  <th className="border-b border-r border-slate-200 px-2.5 py-2 text-right">
                    Tổng tiền thuế
                  </th>
                  <th className="border-b border-r border-slate-200 px-2.5 py-2 text-right">
                    Tổng tiền chiết khấu thương mại
                  </th>
                  <th className="border-b border-r border-slate-200 px-2.5 py-2 text-right">
                    Tổng tiền phí
                  </th>
                  <th className="border-b border-r border-slate-200 px-2.5 py-2 text-right">
                    Tổng tiền thanh toán
                  </th>
                  <th className="border-b border-r border-slate-200 px-2.5 py-2">
                    Trạng thái hóa đơn
                  </th>
                  <th className="border-b border-slate-200 px-2.5 py-2 text-center">
                    Tải về / Chi tiết
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td
                      colSpan={16}
                      className="px-3 py-8 text-center text-xs text-slate-500"
                    >
                      <Loader2 size={16} className="animate-spin inline mr-1.5" />
                      Đang tải danh sách hóa đơn mua vào...
                    </td>
                  </tr>
                ) : pagedInvoices.length === 0 ? (
                  <tr>
                    <td
                      colSpan={16}
                      className="px-3 py-8 text-center text-xs text-slate-500"
                    >
                      Không có hóa đơn nào khớp với điều kiện lọc. Hãy bấm{" "}
                      <strong className="text-sky-700">
                        &ldquo;Đồng bộ Hóa đơn & Tải XML từ CQT&rdquo;
                      </strong>{" "}
                      trên góc phải để lấy dữ liệu mới từ Tổng cục Thuế.
                    </td>
                  </tr>
                ) : (
                  pagedInvoices.map((inv, idx) => {
                    const stt = (currentPage - 1) * pageSize + idx + 1;
                    const isSelected = selectedRowId === inv.id;
                    return (
                      <tr
                        key={inv.id}
                        onClick={() => openInvoiceDetail(inv.id, "items")}
                        className={`cursor-pointer border-b border-slate-200 text-[11px] transition-colors ${
                          isSelected
                            ? "bg-amber-100/70 hover:bg-amber-100"
                            : "even:bg-amber-50/40 hover:bg-sky-50/60"
                        } ${
                          inv.is_replaced
                            ? "line-through text-slate-400 bg-rose-50/40"
                            : ""
                        }`}
                      >
                        <td
                          className="border-r border-slate-200 px-2 py-2 text-center"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={checkedIds.includes(inv.id)}
                            onChange={() => toggleCheckRow(inv.id)}
                            className="h-3.5 w-3.5 rounded border-slate-300 text-sky-600"
                          />
                        </td>
                        <td className="border-r border-slate-200 px-2 py-2 text-center font-semibold text-slate-600">
                          {stt}
                        </td>
                        <td className="border-r border-slate-200 px-2 py-2 text-center font-mono font-semibold text-sky-800">
                          {inv.tax_account_username || "—"}
                        </td>
                        <td className="border-r border-slate-200 px-2.5 py-2 text-center font-mono text-slate-700">
                          {inv.buyer_tax_code || "—"}
                        </td>
                        <td className="border-r border-slate-200 px-2 py-2 text-center font-semibold text-slate-700">
                          {inv.invoice_template}
                        </td>
                        <td className="border-r border-slate-200 px-2.5 py-2 text-center font-mono font-semibold text-slate-800">
                          {inv.invoice_symbol}
                        </td>
                        <td className="border-r border-slate-200 px-2.5 py-2 text-center font-mono font-bold text-sky-800">
                          {inv.invoice_number}
                        </td>
                        <td className="border-r border-slate-200 px-2.5 py-2 text-center text-slate-700">
                          {inv.invoice_date}
                        </td>
                        <td className="border-r border-slate-200 px-2.5 py-2 text-slate-800">
                          <div className="text-[11px] text-slate-600">
                            MST người bán:{" "}
                            <span className="font-mono font-semibold text-slate-800">
                              {inv.seller_tax_code}
                            </span>
                          </div>
                          <div className="font-semibold text-slate-900">
                            Tên người bán: {inv.seller_name}
                          </div>
                        </td>
                        <td className="border-r border-slate-200 px-2.5 py-2 text-right font-medium text-slate-700">
                          {formatNumber(inv.amount_before_tax)}
                        </td>
                        <td className="border-r border-slate-200 px-2.5 py-2 text-right font-medium text-slate-700">
                          {formatNumber(inv.tax_amount)}
                        </td>
                        <td className="border-r border-slate-200 px-2.5 py-2 text-right font-medium text-slate-700">
                          {inv.discount_amount > 0
                            ? formatNumber(inv.discount_amount)
                            : ""}
                        </td>
                        <td className="border-r border-slate-200 px-2.5 py-2 text-right font-medium text-slate-700">
                          {inv.fee_amount > 0 ? formatNumber(inv.fee_amount) : ""}
                        </td>
                        <td className="border-r border-slate-200 px-2.5 py-2 text-right font-bold text-slate-900">
                          {formatNumber(inv.total_amount)}
                        </td>
                        <td className="border-r border-slate-200 px-2.5 py-2">
                          <div className="font-semibold text-slate-700">
                            {inv.tthai_label}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {inv.kqkt_label}
                          </div>
                          {inv.is_replaced && (
                            <span className="inline-block mt-0.5 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                              Bị thay thế bởi #{inv.replaced_by_invoice_number}
                            </span>
                          )}
                          {!inv.is_replaced && inv.replaced_invoice_number && (
                            <span className="inline-block mt-0.5 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800">
                              Thay thế HĐ #{inv.replaced_invoice_number}
                            </span>
                          )}
                        </td>
                        <td
                          className="px-2 py-2 text-center"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openInvoiceDetail(inv.id, "items")}
                              className="inline-flex items-center gap-1 rounded bg-sky-600 hover:bg-sky-700 px-2 py-1 text-[10px] font-semibold text-white transition-colors"
                              title="Xem chi tiết hóa đơn & mặt hàng"
                            >
                              <Eye size={11} />
                              Chi tiết
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDownloadZip([inv.id], "xml")}
                              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white hover:bg-sky-50 px-1.5 py-1 text-[10px] font-semibold text-sky-700 transition-colors"
                              title="Tải riêng file .XML gốc của hóa đơn này"
                            >
                              <Download size={11} />
                              XML
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDownloadZip([inv.id], "html")}
                              disabled={!inv.has_html}
                              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white hover:bg-amber-50 px-1.5 py-1 text-[10px] font-semibold text-amber-800 transition-colors disabled:opacity-40"
                              title="Tải riêng file .HTML (Bản thể hiện) của hóa đơn này"
                            >
                              <Download size={11} />
                              HTML
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleDeleteInvoice(inv.id, inv.invoice_number)
                              }
                              className="rounded p-1 text-red-600 hover:bg-red-50"
                              title="Xóa hóa đơn"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {filteredInvoicesByTab.length > 0 && (
                <tfoot className="border-t border-slate-300 bg-slate-50 text-[11px] font-semibold text-slate-700">
                  <tr>
                    <td
                      colSpan={8}
                      className="border-r border-slate-200 px-2.5 py-2 text-right uppercase"
                    >
                      Tổng cộng ({filteredInvoicesByTab.length} hóa đơn):
                    </td>
                    <td className="border-r border-slate-200 px-2.5 py-2 text-right font-bold text-slate-900">
                      {formatNumber(tabTotals.beforeTax)}
                    </td>
                    <td className="border-r border-slate-200 px-2.5 py-2 text-right font-bold text-emerald-700">
                      {formatNumber(tabTotals.tax)}
                    </td>
                    <td className="border-r border-slate-200 px-2.5 py-2 text-right font-bold text-amber-700">
                      {tabTotals.discount > 0
                        ? formatNumber(tabTotals.discount)
                        : "0"}
                    </td>
                    <td className="border-r border-slate-200 px-2.5 py-2 text-right font-bold text-slate-700">
                      {tabTotals.fee > 0 ? formatNumber(tabTotals.fee) : "0"}
                    </td>
                    <td className="border-r border-slate-200 px-2.5 py-2 text-right font-bold text-red-700">
                      {formatNumber(tabTotals.payment)}
                    </td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        ) : (
          /* TAB 3: BẢNG TỔNG HỢP HÀNG HÓA ĐẦU VÀO */
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600">
                <tr>
                  <th className="border-b border-slate-200 px-2.5 py-2 text-center w-10">
                    STT
                  </th>
                  <th className="border-b border-slate-200 px-2.5 py-2">
                    Mã hàng hóa dịch vụ (MHHDVu)
                  </th>
                  <th className="border-b border-slate-200 px-2.5 py-2">
                    Tên hàng hóa dịch vụ (THHDVu)
                  </th>
                  <th className="border-b border-slate-200 px-2.5 py-2 text-center">
                    Đơn vị tính
                  </th>
                  <th className="border-b border-slate-200 px-2.5 py-2">
                    Nhà cung cấp (Người bán)
                  </th>
                  <th className="border-b border-slate-200 px-2.5 py-2 text-right">
                    Đơn giá
                  </th>
                  <th className="border-b border-slate-200 px-2.5 py-2 text-center">
                    Tổng số lượng thực
                  </th>
                  <th className="border-b border-slate-200 px-2.5 py-2 text-right">
                    Tổng thành tiền trước thuế
                  </th>
                </tr>
              </thead>
              <tbody>
                {goodsSummary.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-3 py-8 text-center text-xs text-slate-500"
                    >
                      Chưa có dữ liệu hàng hóa bóc tách từ XML.
                    </td>
                  </tr>
                ) : (
                  goodsSummary.map((row, idx) => (
                    <tr
                      key={`${row.product_code}_${row.product_name}_${idx}`}
                      className="border-b border-slate-100 even:bg-amber-50/40 hover:bg-sky-50/50 text-[11px]"
                    >
                      <td className="px-2.5 py-1.5 text-center font-semibold text-slate-500">
                        {idx + 1}
                      </td>
                      <td className="px-2.5 py-1.5 font-mono font-semibold text-sky-800">
                        {row.product_code || "—"}
                      </td>
                      <td className="px-2.5 py-1.5 font-medium text-slate-800">
                        {row.product_name}
                      </td>
                      <td className="px-2.5 py-1.5 text-center text-slate-700">
                        {row.unit_name || "—"}
                      </td>
                      <td
                        className="px-2.5 py-1.5 text-slate-600 max-w-xs truncate"
                        title={row.seller_names}
                      >
                        {row.seller_names}
                      </td>
                      <td className="px-2.5 py-1.5 text-right font-medium text-slate-700">
                        {formatNumber(row.unit_price)}
                      </td>
                      <td className="px-2.5 py-1.5 text-center font-semibold text-slate-900">
                        {formatNumber(row.total_quantity)}
                      </td>
                      <td className="px-2.5 py-1.5 text-right font-bold text-slate-900">
                        {formatNumber(row.total_amount)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {goodsSummary.length > 0 && (
                <tfoot className="border-t border-slate-200 bg-slate-50 text-[10px] font-semibold text-slate-600">
                  <tr>
                    <td colSpan={6} className="px-2.5 py-2 text-right uppercase">
                      Tổng cộng bảng tổng hợp hàng hóa:
                    </td>
                    <td className="px-2.5 py-2 text-center font-bold text-slate-900">
                      {formatNumber(
                        goodsSummary.reduce((acc, r) => acc + r.total_quantity, 0)
                      )}
                    </td>
                    <td className="px-2.5 py-2 text-right font-bold text-red-700">
                      {formatNumber(
                        goodsSummary.reduce((acc, r) => acc + r.total_amount, 0)
                      )}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        {/* 6. THANH FOOTER DƯỚI CÙNG */}
        <div className="border-t border-slate-300 bg-slate-100 px-3 py-2 flex items-center justify-between gap-3">
          <span className="text-[10px] text-slate-500">
            Nguồn dữ liệu: Cổng Hóa đơn điện tử Tổng cục Thuế (https://hoadondientu.gdt.gov.vn) · Click vào bất kỳ dòng hóa đơn nào để xem chi tiết & tải XML/HTML.
          </span>
          <span className="text-[10px] text-slate-600 font-medium">
            {credStatus?.last_synced_at
              ? `Đồng bộ gần nhất: ${new Date(credStatus.last_synced_at).toLocaleString("vi-VN")}`
              : "Chưa đồng bộ lần nào"}
          </span>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* MODAL 1: ĐĂNG NHẬP & XÁC THỰC TÀI KHOẢN CỔNG THUẾ                     */}
      {/* ===================================================================== */}
      {authModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={handleAuthenticateSubmit}
            className="w-full max-w-2xl border border-slate-400 bg-white shadow-lg"
          >
            {/* Header */}
            <div className="bg-[#14263d] px-3 py-2 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound size={17} className="text-red-500" />
                <span className="text-xs font-bold uppercase tracking-wide text-white">
                  Xác Thực Cổng Hóa Đơn Điện Tử Tổng Cục Thuế (hoadondientu.gdt.gov.vn)
                </span>
              </div>
              <button
                type="button"
                onClick={() => setAuthModalOpen(false)}
                className="rounded p-1 text-white hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="border-b border-slate-200 px-3 py-3 space-y-3 max-h-[80vh] overflow-y-auto">
              {authError && (
                <div className="rounded border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
                  {authError}
                </div>
              )}

              <div className="rounded border border-slate-300 bg-white p-2.5">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold uppercase text-slate-700">
                    Tài khoản thuế của NPP
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTaxCredentialId(null);
                      setAuthUsername("");
                      setAuthPassword("");
                      setAuthManualToken("");
                    }}
                    className="inline-flex items-center gap-1 rounded bg-sky-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-sky-700"
                  >
                    + Thêm tài khoản
                  </button>
                </div>
                {credStatus?.accounts.length ? (
                  <div className="grid gap-1 sm:grid-cols-2">
                    {credStatus.accounts.map((account) => (
                      <div
                        key={account.id}
                        className={`flex items-center justify-between gap-2 rounded border px-2 py-1.5 ${
                          account.id === activeTaxCredentialId
                            ? "border-sky-500 bg-sky-50"
                            : "border-slate-200 bg-slate-50"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setActiveTaxCredentialId(account.id);
                            setAuthUsername(account.username);
                            setAuthPassword("");
                            setAuthManualToken("");
                          }}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="font-mono text-[11px] font-bold text-slate-800">
                            {account.username}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {account.invoice_count} hóa đơn ·{" "}
                            {account.has_bearer_token ? "Đã có token" : "Chưa có token"}
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingTaxAccount(account)}
                          className="rounded p-1 text-red-700 hover:bg-red-100"
                          title={`Xóa tài khoản ${account.username}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[10px] text-slate-500">
                    NPP chưa có tài khoản thuế. Nhập MST, mật khẩu và CAPTCHA để thêm tài khoản đầu tiên.
                  </p>
                )}
              </div>

              {/* KHỐI 1: NHẬP / DÁN TOKEN CQT (KHUYẾN NGHỊ) */}
              <details
                className="rounded border border-slate-300 bg-slate-50 p-2.5"
                open={showManualToken}
                onToggle={(event) => setShowManualToken(event.currentTarget.open)}
              >
                <summary className="flex cursor-pointer list-none items-center justify-between mb-1.5">
                  <label className="text-[11px] font-bold text-sky-900 uppercase flex items-center gap-1.5">
                    <CheckCircle2 size={13} className="text-sky-600" />
                    Cách 1: Dán Bearer Token hoặc Lệnh cURL từ Cổng Thuế (Khuyến nghị)
                  </label>
                  {activeTaxAccount?.has_bearer_token && (
                    <span className="text-[10px] text-emerald-700 font-semibold bg-emerald-100 px-2 py-0.5 rounded">
                      Đã có Token ({activeTaxAccount.token_preview})
                    </span>
                  )}
                </summary>

                <textarea
                  rows={4}
                  placeholder="Dán Bearer eyJ... hoặc toàn bộ lệnh cURL tại đây..."
                  value={authManualToken}
                  onChange={(e) => setAuthManualToken(e.target.value)}
                  className="mt-2 w-full min-w-0 rounded border border-sky-300 bg-white p-2 text-xs font-mono text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </details>

              {/* KHỐI 2: THÔNG TIN TÀI KHOẢN THUẾ (TÙY CHỌN ĐỂ TỰ ĐIỀN) */}
              <div className="border border-slate-200 rounded p-2.5 bg-slate-50">
                <div className="text-[11px] font-bold text-slate-700 uppercase mb-2">
                  Đăng nhập Cổng Thuế bằng CAPTCHA
                </div>
                <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2">
                  <div>
                    <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                      Mã số thuế đăng nhập CQT
                    </label>
                    <input
                      type="text"
                      placeholder="VD: 0315566789"
                      value={authUsername}
                      onChange={(e) => setAuthUsername(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                      Mật khẩu Cổng Thuế{" "}
                      {activeTaxAccount?.has_password
                        ? "(Đã lưu mật khẩu)"
                        : "(Tùy chọn)"}
                    </label>
                    <input
                      type="password"
                      placeholder={
                        activeTaxAccount?.has_password
                          ? "•••••••• (Đã lưu mật khẩu)"
                          : "Nhập mật khẩu Cổng Thuế"
                      }
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-[180px_1fr] sm:items-end">
                  <button
                    type="button"
                    onClick={() => void loadCaptcha()}
                    disabled={captchaLoading}
                    className="flex min-h-14 items-center justify-center rounded border border-slate-300 bg-white p-1 hover:bg-sky-50 disabled:cursor-wait"
                    title="Lấy CAPTCHA mới"
                  >
                    {captchaLoading ? (
                      <Loader2 size={18} className="animate-spin text-sky-600" />
                    ) : captchaSrc ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={captchaSrc}
                        alt="Mã CAPTCHA Cổng Thuế"
                        className="max-h-16 w-full object-contain"
                      />
                    ) : (
                      <span className="text-[10px] text-slate-500">
                        Bấm để tải CAPTCHA
                      </span>
                    )}
                  </button>
                  <div>
                    <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                      Ký tự CAPTCHA
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        autoComplete="off"
                        placeholder="Nhập CAPTCHA"
                        value={captchaValue}
                        onChange={(event) => setCaptchaValue(event.target.value)}
                        className={inputCls}
                      />
                      <button
                        type="button"
                        onClick={() => void loadCaptcha()}
                        disabled={captchaLoading}
                        className="inline-flex shrink-0 items-center gap-1 rounded border border-slate-300 bg-white px-2 text-[10px] font-semibold text-slate-700 hover:bg-slate-100 disabled:bg-slate-100"
                      >
                        <RefreshCw size={12} />
                        Đổi mã
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer Action Bar */}
            <div className="border-t border-slate-300 bg-slate-100 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[10px] text-slate-500">
                Token CQT có hiệu lực 24 giờ. Kết nối trực tiếp HTTP an toàn.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAuthModalOpen(false)}
                  className="rounded bg-red-700 hover:bg-red-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
                >
                  Đóng
                </button>
                {isLocalHost && (
                  <button
                    type="button"
                    onClick={handleInteractiveLoginAndSync}
                    disabled={syncing || savingToken}
                    title="Chỉ hoạt động khi chạy trên máy tính nội bộ có cài Playwright"
                    className="inline-flex items-center gap-1 rounded bg-slate-600 hover:bg-slate-700 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {syncing ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <KeyRound size={12} />
                    )}
                    Mở Web Thuế (Local)
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSaveTokenAndSync}
                  disabled={syncing || savingToken}
                  className="inline-flex items-center gap-1.5 rounded bg-sky-600 hover:bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {savingToken || syncing ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <CheckCircle2 size={13} />
                  )}
                  {captchaValue.trim()
                    ? "Đăng nhập & Đồng bộ"
                    : authManualToken.trim()
                    ? "Lưu Token & Đồng bộ ngay"
                    : activeTaxAccount?.has_bearer_token || credStatus?.has_bearer_token
                    ? "Đồng bộ ngay với Token đã lưu"
                    : "Nhập CAPTCHA để đăng nhập"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {deletingTaxAccount && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md border border-slate-400 bg-white shadow-lg">
            <div className="flex items-center justify-between bg-[#14263d] px-3 py-2 text-white">
              <div className="flex items-center gap-2">
                <AlertTriangle size={17} className="text-red-500" />
                <span className="text-xs font-bold uppercase tracking-wide">
                  Xác nhận xóa tài khoản thuế
                </span>
              </div>
              <button
                type="button"
                onClick={() => setDeletingTaxAccount(null)}
                disabled={deletingAccount}
                className="rounded p-1 text-white hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </div>
            <div className="border-b border-slate-200 px-3 py-3 text-xs text-slate-700">
              Tài khoản{" "}
              <strong className="font-mono text-slate-900">
                {deletingTaxAccount.username}
              </strong>{" "}
              và{" "}
              <strong className="text-red-700">
                {deletingTaxAccount.invoice_count} hóa đơn đã đồng bộ
              </strong>{" "}
              sẽ bị xóa khỏi hệ thống. Các tài khoản thuế khác của NPP không bị ảnh hưởng.
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-300 bg-slate-100 px-3 py-2">
              <button
                type="button"
                onClick={() => setDeletingTaxAccount(null)}
                disabled={deletingAccount}
                className="rounded bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800 disabled:bg-slate-300"
              >
                Không xóa
              </button>
              <button
                type="button"
                onClick={handleDeleteTaxAccount}
                disabled={deletingAccount}
                className="inline-flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:bg-slate-300"
              >
                {deletingAccount ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Trash2 size={13} />
                )}
                Xác nhận xóa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 2: CHI TIẾT HÓA ĐƠN MUA VÀO (KHI CLICK VÀO TỪNG HÓA ĐƠN)        */}
      {/* ===================================================================== */}
      {detailModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-5xl border border-slate-400 bg-white shadow-lg flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="bg-[#14263d] px-3 py-2 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 size={17} className="text-red-500" />
                <span className="text-xs font-bold uppercase tracking-wide text-white">
                  Chi Tiết Hóa Đơn Mua Vào{" "}
                  {detailData
                    ? `Mẫu ${detailData.invoice_template} · Ký hiệu ${detailData.invoice_symbol} · Số ${detailData.invoice_number} (Ngày lập: ${detailData.invoice_date})`
                    : ""}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setDetailModalOpen(false)}
                className="rounded p-1 text-white hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </div>

            {/* Sub-header chọn chế độ xem + Nút Download */}
            <div className="border-b border-sky-100 bg-sky-50/60 px-3 py-1.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setDetailViewMode("items")}
                  className={`rounded px-2.5 py-1 text-[11px] font-bold uppercase transition-colors ${
                    detailViewMode === "items"
                      ? "bg-[#14263d] text-white"
                      : "bg-white text-slate-700 border border-slate-300 hover:bg-slate-100"
                  }`}
                >
                  1. Thông tin & Danh sách Hàng hóa ({detailData?.items.length || 0})
                </button>
                <button
                  type="button"
                  onClick={() => setDetailViewMode("html")}
                  disabled={!detailData?.html_content}
                  className={`rounded px-2.5 py-1 text-[11px] font-bold uppercase transition-colors disabled:opacity-40 ${
                    detailViewMode === "html"
                      ? "bg-[#14263d] text-white"
                      : "bg-white text-slate-700 border border-slate-300 hover:bg-slate-100"
                  }`}
                >
                  2. Bản thể hiện Hóa đơn (HTML chuẩn Thuế)
                </button>
                <button
                  type="button"
                  onClick={() => setDetailViewMode("xml")}
                  disabled={!detailData?.xml_content}
                  className={`rounded px-2.5 py-1 text-[11px] font-bold uppercase transition-colors disabled:opacity-40 ${
                    detailViewMode === "xml"
                      ? "bg-[#14263d] text-white"
                      : "bg-white text-slate-700 border border-slate-300 hover:bg-slate-100"
                  }`}
                >
                  3. Cấu trúc XML gốc
                </button>
              </div>

              {detailData && (
                <div className="flex items-center gap-1.5">
                  {detailData.xml_content && (
                    <button
                      type="button"
                      onClick={() => downloadSingleXml(detailData)}
                      className="inline-flex items-center gap-1 rounded border border-sky-600 bg-white hover:bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700"
                    >
                      <FileCode2 size={12} />
                      Tải file .XML
                    </button>
                  )}
                  {detailData.html_content && (
                    <button
                      type="button"
                      onClick={() => downloadSingleHtml(detailData)}
                      className="inline-flex items-center gap-1 rounded border border-amber-600 bg-white hover:bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800"
                    >
                      <FileText size={12} />
                      Tải file .HTML
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDownloadZip([detailData.id], "all")}
                    className="inline-flex items-center gap-1 rounded bg-sky-600 hover:bg-sky-700 px-2.5 py-1 text-[11px] font-semibold text-white"
                  >
                    <Download size={12} />
                    Tải gói .ZIP (XML + HTML)
                  </button>
                </div>
              )}
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto">
              {detailLoading || !detailData ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  <Loader2 size={16} className="animate-spin inline mr-1.5" />
                  Đang tải chi tiết hóa đơn...
                </div>
              ) : detailViewMode === "items" ? (
                <div>
                  {/* Thông tin chung Người bán / Người mua */}
                  <div className="border-b border-slate-200 px-3 py-2.5 grid gap-x-4 gap-y-2 sm:grid-cols-2 xl:grid-cols-4 text-xs bg-slate-50/50">
                    <div>
                      <span className="text-[10px] font-semibold text-slate-500 block">
                        Đơn vị bán (Nhà cung cấp)
                      </span>
                      <span className="font-bold text-slate-900">
                        {detailData.seller_name}
                      </span>
                      <span className="block text-[11px] font-mono text-slate-600">
                        MST người bán: {detailData.seller_tax_code}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] font-semibold text-slate-500 block">
                        Địa chỉ người bán
                      </span>
                      <span className="text-slate-700">
                        {detailData.seller_address || "—"}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] font-semibold text-slate-500 block">
                        Đơn vị mua (Nhà phân phối)
                      </span>
                      <span className="font-semibold text-slate-800">
                        {detailData.buyer_name || "—"}
                      </span>
                      <span className="block text-[11px] font-mono text-slate-600">
                        MST người mua: {detailData.buyer_tax_code || "—"}
                      </span>
                      <div className="text-[11px] text-slate-600">
                        Tài khoản thuế đồng bộ:{" "}
                        <strong className="font-mono text-sky-800">
                          {detailData.tax_account_username || "—"}
                        </strong>
                      </div>
                    </div>
                    <div>
                      <span className="text-[10px] font-semibold text-slate-500 block">
                        Trạng thái & Kết quả kiểm tra
                      </span>
                      <span className="font-semibold text-sky-800 block">
                        {detailData.tthai_label || "Hóa đơn mới"} ·{" "}
                        {detailData.kqkt_label || "Đã cấp mã hóa đơn"}
                      </span>
                      <span className="text-[11px] text-slate-600">
                        {detailData.replaced_invoice_number
                          ? `Thay thế/ĐC cho HĐ số ${detailData.replaced_invoice_number} (${detailData.replaced_invoice_date})`
                          : "Hóa đơn gốc"}
                      </span>
                    </div>
                  </div>

                  {/* Bảng hàng hóa chi tiết <HHDVu> */}
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left">
                      <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600">
                        <tr>
                          <th className="border-b border-slate-200 px-2.5 py-2 text-center w-10">
                            STT
                          </th>
                          <th className="border-b border-slate-200 px-2.5 py-2">
                            Mã hàng (MHHDVu)
                          </th>
                          <th className="border-b border-slate-200 px-2.5 py-2">
                            Tên hàng hóa dịch vụ (THHDVu)
                          </th>
                          <th className="border-b border-slate-200 px-2.5 py-2 text-center">
                            ĐVT
                          </th>
                          <th className="border-b border-slate-200 px-2.5 py-2 text-center">
                            Số lượng
                          </th>
                          <th className="border-b border-slate-200 px-2.5 py-2 text-right">
                            Đơn giá
                          </th>
                          <th className="border-b border-slate-200 px-2.5 py-2 text-right">
                            Chiết khấu
                          </th>
                          <th className="border-b border-slate-200 px-2.5 py-2 text-right">
                            Thành tiền trước thuế
                          </th>
                          <th className="border-b border-slate-200 px-2.5 py-2 text-center">
                            Thuế suất
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailData.items.length === 0 ? (
                          <tr>
                            <td
                              colSpan={9}
                              className="px-3 py-6 text-center text-xs text-slate-500"
                            >
                              Chưa có chi tiết dòng hàng hóa.
                            </td>
                          </tr>
                        ) : (
                          detailData.items.map((it) => (
                            <tr
                              key={it.id}
                              className="border-b border-slate-100 even:bg-amber-50/40 hover:bg-sky-50/50 text-[11px]"
                            >
                              <td className="px-2.5 py-1.5 text-center font-semibold text-slate-500">
                                {it.line_number}
                              </td>
                              <td className="px-2.5 py-1.5 font-mono text-sky-800 font-semibold">
                                {it.product_code || "—"}
                              </td>
                              <td className="px-2.5 py-1.5 font-medium text-slate-800">
                                {it.product_name}
                              </td>
                              <td className="px-2.5 py-1.5 text-center text-slate-700">
                                {it.unit_name || "—"}
                              </td>
                              <td className="px-2.5 py-1.5 text-center font-semibold">
                                {formatNumber(it.quantity)}
                              </td>
                              <td className="px-2.5 py-1.5 text-right font-medium text-slate-700">
                                {formatNumber(it.unit_price)}
                              </td>
                              <td className="px-2.5 py-1.5 text-right font-medium text-slate-700">
                                {formatNumber(it.discount_amount)}
                              </td>
                              <td className="px-2.5 py-1.5 text-right font-bold text-slate-900">
                                {formatNumber(it.amount_before_tax)}
                              </td>
                              <td className="px-2.5 py-1.5 text-center text-slate-600">
                                {it.vat_rate || "—"}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                      <tfoot className="border-t border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                        <tr>
                          <td colSpan={7} className="px-2.5 py-1.5 text-right">
                            Tổng tiền chưa thuế (TgTCThue):
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-bold text-slate-800">
                            {formatNumber(detailData.amount_before_tax)}
                          </td>
                          <td></td>
                        </tr>
                        <tr>
                          <td colSpan={7} className="px-2.5 py-1.5 text-right">
                            Tổng tiền chiết khấu thương mại (TTCKTMai):
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-bold text-amber-700">
                            {formatNumber(detailData.discount_amount || 0)}
                          </td>
                          <td></td>
                        </tr>
                        <tr>
                          <td colSpan={7} className="px-2.5 py-1.5 text-right">
                            Tổng tiền thuế GTGT (TgTThue):
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-bold text-emerald-700">
                            {formatNumber(detailData.tax_amount)}
                          </td>
                          <td></td>
                        </tr>
                        <tr>
                          <td
                            colSpan={7}
                            className="px-2.5 py-1.5 text-right uppercase"
                          >
                            Tổng cộng tiền thanh toán (TgTTTBSo):
                          </td>
                          <td className="px-2.5 py-1.5 text-right font-bold text-red-700 text-xs">
                            {formatNumber(detailData.total_amount)}
                          </td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              ) : detailViewMode === "html" ? (
                <div className="p-3 bg-slate-100">
                  <iframe
                    title="Bản thể hiện Hóa đơn điện tử"
                    srcDoc={detailData.html_content}
                    className="w-full h-[65vh] bg-white border border-slate-300 shadow-sm"
                  />
                </div>
              ) : (
                <div className="p-3">
                  <pre className="w-full h-[65vh] overflow-auto rounded border border-slate-300 bg-slate-900 p-3 text-[11px] font-mono text-emerald-300">
                    {detailData.xml_content}
                  </pre>
                </div>
              )}
            </div>

            {/* Footer Action Bar */}
            <div className="border-t border-slate-300 bg-slate-100 px-3 py-2 flex items-center justify-between gap-3">
              <span className="text-[10px] text-slate-500">
                Dữ liệu gốc giải nén trực tiếp từ gói ZIP/XML của Tổng cục Thuế.
              </span>
              <div className="flex items-center gap-2">
                {detailData?.html_content && (
                  <button
                    type="button"
                    onClick={() => {
                      const win = window.open("", "_blank");
                      if (win) {
                        win.document.write(detailData.html_content);
                        win.document.close();
                        win.focus();
                        win.print();
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded bg-sky-600 hover:bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
                  >
                    <Printer size={13} />
                    In bản thể hiện
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setDetailModalOpen(false)}
                  className="rounded bg-red-700 hover:bg-red-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

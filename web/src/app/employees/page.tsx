"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Users,
  Plus,
  Search,
  X,
  Loader2,
  RefreshCw,
  Pencil,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Upload,
  Download,
  FileSpreadsheet,
  ChevronLeft,
  ChevronRight,
  Truck,
  Phone,
  ShieldCheck,
  KeyRound,
  Eye,
  EyeOff,
  Lock,
  Unlock,
} from "lucide-react";
import { API_URL, apiFetch } from "@/lib/api";
import { downloadExcel } from "@/lib/excel";
import { formatNumber } from "@/lib/format";
import AuthenticatedDownloadLink from "@/components/ui/AuthenticatedDownloadLink";

const inputCls =
  "w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-100";

const POSITION_OPTIONS = [
  "Nhân viên giao hàng",
  "Nhân viên kinh doanh",
  "Kế toán",
  "Thủ kho",
  "Sales Admin",
  "Admin",
];

type EmployeeRow = {
  id: number;
  code: string;
  name: string;
  nickname: string | null;
  position: string;
  phone: string;
  email: string | null;
  territory_id: number | null;
  target: number;
  debt_limit: number;
  vinamilk_code: string | null;
  status: string;
  join_date: string | null;
  account_username: string | null;
  account_user_id: number | null;
  account_is_active: boolean | null;
};

export default function EmployeesPage() {
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [toastMessage, setToastMessage] = useState<string>("");

  const [searchQuery, setSearchQuery] = useState<string>("");
  const [positionFilter, setPositionFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [pageSize, setPageSize] = useState<number>(25);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Modal Thêm / Sửa
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editingRow, setEditingRow] = useState<EmployeeRow | null>(null);
  const [formCode, setFormCode] = useState<string>("");
  const [formName, setFormName] = useState<string>("");
  const [formNickname, setFormNickname] = useState<string>("");
  const [formPosition, setFormPosition] = useState<string>("Nhân viên giao hàng");
  const [formPhone, setFormPhone] = useState<string>("");
  const [formEmail, setFormEmail] = useState<string>("");
  const [formVinamilkCode, setFormVinamilkCode] = useState<string>("");
  const [formStatus, setFormStatus] = useState<string>("active");
  const [formCreateAccount, setFormCreateAccount] = useState<boolean>(false);
  const [formAccountPassword, setFormAccountPassword] = useState<string>("");
  const [showFormPassword, setShowFormPassword] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [formError, setFormError] = useState<string>("");

  // Modal Cấp tài khoản / Đặt lại mật khẩu nhanh
  const [accountRow, setAccountRow] = useState<EmployeeRow | null>(null);
  const [accountPassword, setAccountPassword] = useState<string>("");
  const [showAccountPassword, setShowAccountPassword] = useState<boolean>(false);
  const [accountIsActive, setAccountIsActive] = useState<boolean>(true);
  const [savingAccount, setSavingAccount] = useState<boolean>(false);
  const [accountError, setAccountError] = useState<string>("");

  // Thông tin tài khoản vừa khởi tạo (nếu chọn create_account)
  const [createdAccountInfo, setCreatedAccountInfo] = useState<{
    username: string;
    password: string;
    name: string;
  } | null>(null);

  // Modal Xóa
  const [deletingRow, setDeletingRow] = useState<EmployeeRow | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string>("");

  // Upload Excel
  const [uploading, setUploading] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(""), 5000);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`${API_URL}/employees/?limit=1000`);
      if (!res.ok) throw new Error("Không thể tải danh sách nhân viên.");
      const data = (await res.json()) as EmployeeRow[];
      setRows(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi khi tải danh sách nhân viên.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const positionList = useMemo(() => {
    const s = new Set<string>(POSITION_OPTIONS);
    for (const r of rows) {
      if (r.position && r.position.trim()) s.add(r.position.trim());
    }
    return Array.from(s);
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((r) => {
      if (positionFilter !== "ALL" && (r.position || "").trim() !== positionFilter) return false;
      if (statusFilter !== "ALL" && (r.status || "active") !== statusFilter) return false;
      if (q) {
        const hit =
          (r.code || "").toLowerCase().includes(q) ||
          (r.name || "").toLowerCase().includes(q) ||
          (r.nickname || "").toLowerCase().includes(q) ||
          (r.phone || "").toLowerCase().includes(q) ||
          (r.email || "").toLowerCase().includes(q) ||
          (r.vinamilk_code || "").toLowerCase().includes(q) ||
          (r.position || "").toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [rows, searchQuery, positionFilter, statusFilter]);

  const stats = useMemo(() => {
    let active = 0;
    let delivery = 0;
    let sales = 0;
    for (const r of rows) {
      if (r.status === "active") active++;
      const pos = (r.position || "").toLowerCase();
      if (pos.includes("giao hàng") || pos.includes("nvgh") || pos.includes("tài xế")) delivery++;
      if (pos.includes("kinh doanh") || pos.includes("bán hàng") || pos.includes("nvbh")) sales++;
    }
    return {
      total: rows.length,
      active,
      inactive: rows.length - active,
      delivery,
      sales,
    };
  }, [rows]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pagedRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, safePage, pageSize]);

  function openCreateModal() {
    setEditingRow(null);
    setFormCode("");
    setFormName("");
    setFormNickname("");
    setFormPosition("Nhân viên giao hàng");
    setFormPhone("");
    setFormEmail("");
    setFormVinamilkCode("");
    setFormStatus("active");
    setFormCreateAccount(false);
    setFormAccountPassword("");
    setShowFormPassword(false);
    setFormError("");
    setModalOpen(true);
  }

  function openEditModal(row: EmployeeRow) {
    setEditingRow(row);
    setFormCode(row.code);
    setFormName(row.name);
    setFormNickname(row.nickname || "");
    setFormPosition(row.position || "Nhân viên giao hàng");
    setFormPhone(row.phone || "");
    setFormEmail(row.email || "");
    setFormVinamilkCode(row.vinamilk_code || "");
    setFormStatus(row.status || "active");
    setFormCreateAccount(false);
    setFormAccountPassword("");
    setShowFormPassword(false);
    setFormError("");
    setModalOpen(true);
  }

  function openAccountModal(row: EmployeeRow) {
    setAccountRow(row);
    setAccountPassword("");
    setShowAccountPassword(false);
    setAccountIsActive(row.account_is_active !== false);
    setAccountError("");
  }

  async function handleSaveAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!accountRow) return;
    const trimmedPw = accountPassword.trim();
    if (trimmedPw && trimmedPw.length < 6) {
      setAccountError("Mật khẩu phải có tối thiểu 6 ký tự.");
      return;
    }
    const isExisting = Boolean(accountRow.account_username);
    if (isExisting && !trimmedPw && accountIsActive === (accountRow.account_is_active !== false)) {
      setAccountError("Vui lòng nhập mật khẩu mới hoặc thay đổi trạng thái tài khoản.");
      return;
    }

    setSavingAccount(true);
    setAccountError("");
    try {
      const res = await apiFetch(`${API_URL}/employees/${accountRow.id}/account`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: trimmedPw || null,
          is_active: accountIsActive,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as EmployeeRow & {
        initial_username?: string | null;
        initial_password?: string | null;
        detail?: string;
      };
      if (!res.ok) throw new Error(data.detail || "Không thể cập nhật tài khoản nhân viên.");

      setAccountRow(null);
      if (data.initial_username && data.initial_password) {
        setCreatedAccountInfo({
          username: data.initial_username,
          password: data.initial_password,
          name: accountRow.name,
        });
      }
      showToast(
        isExisting
          ? trimmedPw
            ? `Đã đặt lại mật khẩu cho tài khoản '${accountRow.account_username}'.`
            : `Đã ${accountIsActive ? "mở khóa" : "khóa"} tài khoản '${accountRow.account_username}'.`
          : `Đã cấp tài khoản đăng nhập '${data.initial_username || accountRow.code}' cho nhân viên '${accountRow.name}'.`
      );
      await loadData();
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : "Lỗi khi cập nhật tài khoản.");
    } finally {
      setSavingAccount(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const cleanCode = formCode.trim().toUpperCase();
    const cleanName = formName.trim();
    if (!cleanCode || !cleanName) {
      setFormError("Mã nhân viên và Họ và tên không được để trống.");
      return;
    }

    setSaving(true);
    setFormError("");
    try {
      if (editingRow) {
        const trimmedPw = formAccountPassword.trim();
        if ((formCreateAccount || editingRow.account_username) && trimmedPw && trimmedPw.length < 6) {
          setFormError("Mật khẩu phải có tối thiểu 6 ký tự.");
          setSaving(false);
          return;
        }
        const res = await apiFetch(`${API_URL}/employees/${editingRow.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: cleanCode,
            name: cleanName,
            nickname: formNickname.trim() || null,
            position: formPosition.trim() || "Nhân viên giao hàng",
            phone: formPhone.trim(),
            email: formEmail.trim() || null,
            vinamilk_code: formVinamilkCode.trim().toUpperCase() || null,
            status: formStatus,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as EmployeeRow & { detail?: string };
        if (!res.ok) throw new Error(data.detail || "Không thể cập nhật thông tin nhân viên.");

        // Nếu chọn cấp tài khoản mới hoặc nhập mật khẩu mới cho tài khoản hiện có
        if ((!editingRow.account_username && formCreateAccount) || (editingRow.account_username && trimmedPw)) {
          const accRes = await apiFetch(`${API_URL}/employees/${editingRow.id}/account`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              password: trimmedPw || null,
            }),
          });
          const accData = (await accRes.json().catch(() => ({}))) as EmployeeRow & {
            initial_username?: string | null;
            initial_password?: string | null;
            detail?: string;
          };
          if (!accRes.ok) {
            throw new Error(
              accData.detail || "Đã lưu thông tin nhân viên nhưng không thiết lập được tài khoản."
            );
          }
          if (accData.initial_username && accData.initial_password) {
            setCreatedAccountInfo({
              username: accData.initial_username,
              password: accData.initial_password,
              name: cleanName,
            });
          }
        }

        setModalOpen(false);
        showToast(`Đã cập nhật nhân viên '${cleanCode} - ${cleanName}'.`);
        await loadData();
      } else {
        const trimmedPw = formAccountPassword.trim();
        if (formCreateAccount && trimmedPw && trimmedPw.length < 6) {
          setFormError("Mật khẩu phải có tối thiểu 6 ký tự.");
          setSaving(false);
          return;
        }
        const res = await apiFetch(`${API_URL}/employees/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: cleanCode,
            name: cleanName,
            nickname: formNickname.trim() || null,
            position: formPosition.trim() || "Nhân viên giao hàng",
            phone: formPhone.trim(),
            email: formEmail.trim() || null,
            vinamilk_code: formVinamilkCode.trim().toUpperCase() || null,
            status: formStatus,
            create_account: formCreateAccount,
            account_password: formCreateAccount ? trimmedPw || null : null,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as EmployeeRow & {
          initial_username?: string | null;
          initial_password?: string | null;
          detail?: string;
        };
        if (!res.ok) throw new Error(data.detail || "Không thể thêm mới nhân viên.");
        setModalOpen(false);
        if (data.initial_username && data.initial_password) {
          setCreatedAccountInfo({
            username: data.initial_username,
            password: data.initial_password,
            name: cleanName,
          });
        }
        showToast(`Đã thêm mới nhân viên '${cleanCode} - ${cleanName}'.`);
        await loadData();
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Lỗi khi lưu thông tin nhân viên.");
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmDelete() {
    if (!deletingRow) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const res = await apiFetch(`${API_URL}/employees/${deletingRow.id}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) {
        const data = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(data.detail || "Không thể xóa nhân viên.");
      }
      const deletedLabel = `${deletingRow.code} - ${deletingRow.name}`;
      setDeletingRow(null);
      showToast(`Đã xóa nhân viên '${deletedLabel}'.`);
      await loadData();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Lỗi khi xóa nhân viên.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleUploadExcel(file: File) {
    setUploading(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await apiFetch(`${API_URL}/employees/upload`, {
        method: "POST",
        body: fd,
      });
      const data = (await res.json().catch(() => ({}))) as {
        created?: number;
        updated?: number;
        detail?: string;
      };
      if (!res.ok) throw new Error(data.detail || "Không thể nhập danh sách nhân viên từ Excel.");
      showToast(
        `Nhập Excel thành công: Thêm mới ${data.created ?? 0}, cập nhật ${data.updated ?? 0} nhân viên.`
      );
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi khi tải lên file Excel.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleExportExcel() {
    if (filteredRows.length === 0) return;
    const excelRows = filteredRows.map((r, idx) => ({
      STT: idx + 1,
      "Mã nhân viên": r.code,
      "Họ và tên": r.name,
      "Tên gọi": r.nickname || "",
      "Vị trí": r.position || "",
      "Số điện thoại": r.phone || "",
      Email: r.email || "",
      "Mã DMS / Vinamilk": r.vinamilk_code || "",
      "Tài khoản": r.account_username || "",
      "Trạng thái": r.status === "active" ? "Đang làm việc" : "Đã nghỉ",
    }));
    downloadExcel(
      excelRows,
      `Danh_sach_nhan_vien_${new Date().toISOString().slice(0, 10)}`,
      "Danh sách nhân viên"
    );
  }

  return (
    <div className="space-y-3">
      {toastMessage && (
        <div className="flex items-center justify-between rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 shadow-sm">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 size={15} className="text-emerald-600" />
            {toastMessage}
          </span>
          <button
            type="button"
            onClick={() => setToastMessage("")}
            className="text-emerald-600 hover:text-emerald-800"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {createdAccountInfo && (
        <div className="flex items-center justify-between rounded border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-900 shadow-sm">
          <div className="flex items-center gap-2">
            <ShieldCheck size={15} className="text-sky-600 shrink-0" />
            <span>
              Đã tạo tài khoản đăng nhập cho <strong>{createdAccountInfo.name}</strong> — Tên đăng nhập:{" "}
              <code className="rounded bg-white px-1.5 py-0.5 font-mono font-bold text-sky-900 border border-sky-200">
                {createdAccountInfo.username}
              </code>{" "}
              | Mật khẩu ban đầu:{" "}
              <code className="rounded bg-white px-1.5 py-0.5 font-mono font-bold text-red-700 border border-sky-200">
                {createdAccountInfo.password}
              </code>
            </span>
          </div>
          <button
            type="button"
            onClick={() => setCreatedAccountInfo(null)}
            className="rounded p-1 text-sky-600 hover:bg-sky-100"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center justify-between rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
          <span className="flex items-center gap-1.5">
            <AlertTriangle size={14} className="text-red-600 shrink-0" />
            {error}
          </span>
          <button type="button" onClick={() => setError("")} className="text-red-600 hover:text-red-800">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="border border-slate-400 bg-white shadow-lg">
        {/* 1. HEADER */}
        <header className="bg-[#14263d] px-3 py-2 text-white flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Users size={17} className="text-red-500" />
            <h1 className="text-xs font-bold uppercase tracking-wide text-white">
              Danh Mục Nhân Viên
            </h1>
            <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-sky-200">
              {formatNumber(rows.length)} nhân viên
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center gap-1 rounded bg-sky-600 hover:bg-sky-700 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors"
            >
              <Plus size={13} />
              Thêm nhân viên
            </button>

            <AuthenticatedDownloadLink
              href={`${API_URL}/employees/template`}
              className="inline-flex items-center gap-1 rounded bg-white/10 hover:bg-white/20 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors"
            >
              <Download size={12} />
              Mẫu Excel
            </AuthenticatedDownloadLink>

            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xlsm"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUploadExcel(f);
              }}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1 rounded bg-white/10 hover:bg-white/20 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors disabled:opacity-50"
            >
              {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
              Upload Excel
            </button>

            <button
              type="button"
              disabled={filteredRows.length === 0}
              onClick={handleExportExcel}
              className="inline-flex items-center gap-1 rounded bg-emerald-700 hover:bg-emerald-800 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors disabled:opacity-40"
            >
              <FileSpreadsheet size={12} />
              Xuất Excel
            </button>

            <button
              type="button"
              onClick={() => void loadData()}
              disabled={loading}
              className="inline-flex items-center gap-1 rounded bg-white/10 hover:bg-white/20 px-2 py-1 text-[11px] font-semibold text-white transition-colors"
              title="Tải lại danh sách"
            >
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </header>

        {/* 2. THỐNG KÊ NHANH */}
        <section className="grid grid-cols-2 gap-2 border-b border-slate-200 bg-slate-50/70 px-3 py-2 sm:grid-cols-4">
          <div className="flex items-center justify-between rounded border border-slate-200 bg-white px-2.5 py-1.5">
            <div>
              <div className="text-[10px] font-semibold text-slate-500">Tổng nhân viên</div>
              <div className="text-sm font-bold text-slate-900">{formatNumber(stats.total)}</div>
            </div>
            <Users size={16} className="text-slate-400" />
          </div>
          <div className="flex items-center justify-between rounded border border-sky-200 bg-sky-50/60 px-2.5 py-1.5">
            <div>
              <div className="text-[10px] font-semibold text-sky-700">NV Giao hàng</div>
              <div className="text-sm font-bold text-sky-900">{formatNumber(stats.delivery)}</div>
            </div>
            <Truck size={16} className="text-sky-600" />
          </div>
          <div className="flex items-center justify-between rounded border border-emerald-200 bg-emerald-50/60 px-2.5 py-1.5">
            <div>
              <div className="text-[10px] font-semibold text-emerald-700">Đang làm việc</div>
              <div className="text-sm font-bold text-emerald-900">{formatNumber(stats.active)}</div>
            </div>
            <CheckCircle2 size={16} className="text-emerald-600" />
          </div>
          <div className="flex items-center justify-between rounded border border-amber-200 bg-amber-50/60 px-2.5 py-1.5">
            <div>
              <div className="text-[10px] font-semibold text-amber-700">NV Kinh doanh</div>
              <div className="text-sm font-bold text-amber-900">{formatNumber(stats.sales)}</div>
            </div>
            <Users size={16} className="text-amber-600" />
          </div>
        </section>

        {/* 3. BỘ LỌC */}
        <section className="border-b border-slate-200 px-3 py-2.5">
          <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2 xl:grid-cols-4">
            <div className="sm:col-span-2">
              <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                Tìm kiếm Mã NV / Họ tên / Tên gọi / SĐT / Mã DMS
              </label>
              <div className="relative">
                <Search
                  size={13}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                  placeholder="Nhập mã NV, họ tên, số điện thoại..."
                  className={`${inputCls} pl-7 pr-6`}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      setCurrentPage(1);
                    }}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                Vị trí / Bộ phận
              </label>
              <select
                value={positionFilter}
                onChange={(e) => {
                  setPositionFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className={inputCls}
              >
                <option value="ALL">Tất cả vị trí</option>
                {positionList.map((pos) => (
                  <option key={pos} value={pos}>
                    {pos}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                Trạng thái
              </label>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className={inputCls}
              >
                <option value="ALL">Tất cả trạng thái</option>
                <option value="active">Đang làm việc</option>
                <option value="inactive">Đã nghỉ</option>
              </select>
            </div>
          </div>
        </section>

        {/* 4. BẢNG DỮ LIỆU */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead className="bg-slate-100 text-[10px] font-semibold uppercase text-slate-600">
              <tr className="border-b border-slate-300">
                <th className="w-10 px-2 py-2 text-center">STT</th>
                <th className="px-2.5 py-2">Mã NV</th>
                <th className="px-2.5 py-2">Họ và tên</th>
                <th className="px-2.5 py-2">Tên gọi</th>
                <th className="px-2.5 py-2">Vị trí</th>
                <th className="px-2.5 py-2">Số điện thoại</th>
                <th className="px-2.5 py-2">Mã DMS</th>
                <th className="px-2.5 py-2">Tài khoản</th>
                <th className="px-2 py-2 text-center">Trạng thái</th>
                <th className="w-20 px-2 py-2 text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-xs text-slate-500">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 size={15} className="animate-spin text-sky-600" />
                      Đang tải danh sách nhân viên...
                    </span>
                  </td>
                </tr>
              ) : pagedRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-xs text-slate-500">
                    Chưa có nhân viên nào khớp với bộ lọc hiện tại. Bấm{" "}
                    <strong>Thêm nhân viên</strong> hoặc <strong>Upload Excel</strong> để khởi tạo.
                  </td>
                </tr>
              ) : (
                pagedRows.map((row, idx) => {
                  const stt = (safePage - 1) * pageSize + idx + 1;
                  const isDelivery = (row.position || "").toLowerCase().includes("giao hàng");
                  return (
                    <tr
                      key={row.id}
                      onClick={() => openEditModal(row)}
                      className="cursor-pointer border-b border-slate-100 text-[11px] transition-colors even:bg-amber-50/40 hover:bg-sky-50/50"
                    >
                      <td className="px-2 py-1.5 text-center font-medium text-slate-500">{stt}</td>
                      <td className="whitespace-nowrap px-2.5 py-1.5 font-mono font-bold text-sky-800">
                        <span className="rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5">
                          {row.code}
                        </span>
                      </td>
                      <td className="px-2.5 py-1.5 font-semibold text-slate-800">{row.name}</td>
                      <td className="px-2.5 py-1.5 text-slate-600">{row.nickname || "—"}</td>
                      <td className="whitespace-nowrap px-2.5 py-1.5">
                        <span
                          className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                            isDelivery
                              ? "border-sky-300 bg-sky-50 text-sky-800"
                              : "border-slate-200 bg-slate-50 text-slate-700"
                          }`}
                        >
                          {isDelivery && <Truck size={10} />}
                          {row.position || "—"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-1.5 text-slate-700">
                        {row.phone ? (
                          <span className="inline-flex items-center gap-1 font-mono text-[11px]">
                            <Phone size={10} className="text-slate-400" />
                            {row.phone}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-1.5 font-mono text-[10px] text-slate-600">
                        {row.vinamilk_code || "—"}
                      </td>
                      <td
                        className="whitespace-nowrap px-2.5 py-1.5 font-mono text-[10px] text-slate-600"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {row.account_username ? (
                          <button
                            type="button"
                            onClick={() => openAccountModal(row)}
                            title="Bấm để đặt lại mật khẩu hoặc khóa/mở tài khoản"
                            className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-semibold transition-colors ${
                              row.account_is_active === false
                                ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                                : "border-indigo-200 bg-indigo-50 text-indigo-800 hover:bg-indigo-100"
                            }`}
                          >
                            {row.account_is_active === false ? <Lock size={10} /> : <KeyRound size={10} />}
                            <span>{row.account_username}</span>
                            {row.account_is_active === false && (
                              <span className="font-sans text-[9px] uppercase">(Khóa)</span>
                            )}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openAccountModal(row)}
                            title="Cấp tài khoản đăng nhập bằng Mã NV"
                            className="inline-flex items-center gap-1 rounded border border-dashed border-slate-300 bg-white px-1.5 py-0.5 font-sans text-[10px] font-semibold text-slate-500 transition-colors hover:border-sky-400 hover:bg-sky-50 hover:text-sky-700"
                          >
                            <KeyRound size={10} /> Cấp TK
                          </button>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-center">
                        {row.status === "active" ? (
                          <span className="inline-flex items-center rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                            Đang làm việc
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                            Đã nghỉ
                          </span>
                        )}
                      </td>
                      <td
                        className="whitespace-nowrap px-2 py-1.5 text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openAccountModal(row)}
                            className="rounded p-1 text-indigo-600 hover:bg-indigo-50 hover:text-indigo-800"
                            title={
                              row.account_username
                                ? "Đặt lại mật khẩu / Quản lý tài khoản"
                                : "Cấp tài khoản đăng nhập bằng Mã NV"
                            }
                          >
                            <KeyRound size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModal(row)}
                            className="rounded p-1 text-slate-500 hover:bg-sky-50 hover:text-sky-700"
                            title="Chỉnh sửa nhân viên"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDeletingRow(row);
                              setDeleteError("");
                            }}
                            className="rounded p-1 text-slate-500 hover:bg-red-50 hover:text-red-700"
                            title="Xóa nhân viên"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            <tfoot className="border-t border-slate-200 bg-slate-50 text-[10px] font-semibold text-slate-600">
              <tr>
                <td colSpan={6} className="px-3 py-2">
                  Danh sách nhân viên đang làm việc sẽ tự động hiển thị tại mục chọn{" "}
                  <strong className="text-sky-800">Nhân viên giao hàng</strong> trên màn hình Đơn hàng DMS (Tách đơn / Gộp đơn / Phiếu giao).
                </td>
                <td colSpan={4} className="px-3 py-2 text-right text-slate-500">
                  Hiển thị {pagedRows.length} / {filteredRows.length} nhân viên
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* 5. FOOTER PHÂN TRANG */}
        <footer className="border-t border-slate-300 bg-slate-100 px-3 py-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[10px] text-slate-500">
            <label className="inline-flex items-center gap-1 font-semibold text-slate-700">
              Hiển thị:
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] text-slate-800"
              >
                <option value={25}>25 dòng</option>
                <option value={50}>50 dòng</option>
                <option value={100}>100 dòng</option>
              </select>
            </label>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="mr-1 text-[11px] font-semibold text-slate-600">
              Trang {safePage} / {totalPages}
            </span>
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronLeft size={13} /> Trước
            </button>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Sau <ChevronRight size={13} />
            </button>
          </div>
        </footer>
      </div>

      {/* MODAL THÊM MỚI / CHỈNH SỬA NHÂN VIÊN (Chuẩn CreateOrderForm) */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            if (!saving) setModalOpen(false);
          }}
        >
          <div
            className="w-full max-w-2xl border border-slate-400 bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="bg-[#14263d] px-3 py-2 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                {editingRow ? (
                  <Pencil size={17} className="text-red-500" />
                ) : (
                  <Plus size={17} className="text-red-500" />
                )}
                <h2 className="text-xs font-bold uppercase tracking-wide text-white">
                  {editingRow
                    ? `Cập Nhật Nhân Viên · ${editingRow.code}`
                    : "Thêm Mới Nhân Viên"}
                </h2>
              </div>
              <button
                type="button"
                disabled={saving}
                onClick={() => setModalOpen(false)}
                className="rounded p-1 text-white hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </header>

            <form onSubmit={handleSave}>
              <div className="border-b border-slate-200 px-3 py-2.5 space-y-2.5">
                {formError && (
                  <div className="flex items-center gap-2 rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
                    <AlertTriangle size={14} className="shrink-0" />
                    <span>{formError}</span>
                  </div>
                )}

                <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2">
                  <div>
                    <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                      Mã nhân viên <span className="text-red-600">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formCode}
                      onChange={(e) => setFormCode(e.target.value.toUpperCase())}
                      placeholder="VD: NVGH01"
                      className={`${inputCls} font-mono font-bold uppercase`}
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                      Vị trí / Bộ phận
                    </label>
                    <select
                      value={formPosition}
                      onChange={(e) => setFormPosition(e.target.value)}
                      className={inputCls}
                    >
                      {positionList.map((pos) => (
                        <option key={pos} value={pos}>
                          {pos}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                      Họ và tên <span className="text-red-600">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder="VD: Nguyễn Văn A"
                      className={inputCls}
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                      Tên gọi / Biệt danh
                    </label>
                    <input
                      type="text"
                      value={formNickname}
                      onChange={(e) => setFormNickname(e.target.value)}
                      placeholder="VD: Anh A (xe 1)"
                      className={inputCls}
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                      Số điện thoại
                    </label>
                    <input
                      type="text"
                      value={formPhone}
                      onChange={(e) => setFormPhone(e.target.value)}
                      placeholder="VD: 0912345678"
                      className={inputCls}
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                      Email
                    </label>
                    <input
                      type="email"
                      value={formEmail}
                      onChange={(e) => setFormEmail(e.target.value)}
                      placeholder="VD: nva@congty.vn"
                      className={inputCls}
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                      Mã nhân viên trên DMS / Vinamilk
                    </label>
                    <input
                      type="text"
                      value={formVinamilkCode}
                      onChange={(e) => setFormVinamilkCode(e.target.value.toUpperCase())}
                      placeholder="Tùy chọn (VD: NVBH01)"
                      className={`${inputCls} font-mono uppercase`}
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                      Trạng thái
                    </label>
                    <select
                      value={formStatus}
                      onChange={(e) => setFormStatus(e.target.value)}
                      className={inputCls}
                    >
                      <option value="active">Đang làm việc</option>
                      <option value="inactive">Đã nghỉ</option>
                    </select>
                  </div>
                </div>

                {/* Khu vực Tài khoản đăng nhập hệ thống (hỗ trợ cả Thêm mới và Cập nhật) */}
                {!editingRow || !editingRow.account_username ? (
                  <div className="rounded border border-sky-200 bg-sky-50/60 px-2.5 py-2 space-y-2">
                    <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formCreateAccount}
                        onChange={(e) => setFormCreateAccount(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                      />
                      <span>
                        {editingRow
                          ? `Cấp tài khoản đăng nhập hệ thống (tên đăng nhập = ${formCode.trim() || editingRow.code})`
                          : "Tự động tạo tài khoản đăng nhập hệ thống (tên đăng nhập = Mã nhân viên)"}
                      </span>
                    </label>

                    {formCreateAccount && (
                      <div>
                        <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                          Mật khẩu khởi tạo (tùy chọn — để trống để tự sinh ngẫu nhiên 16 ký tự)
                        </label>
                        <div className="relative">
                          <input
                            type={showFormPassword ? "text" : "password"}
                            value={formAccountPassword}
                            onChange={(e) => setFormAccountPassword(e.target.value)}
                            placeholder="Tối thiểu 6 ký tự (hoặc bỏ trống để hệ thống tự sinh)"
                            className={`${inputCls} pr-8`}
                            autoComplete="new-password"
                          />
                          <button
                            type="button"
                            onClick={() => setShowFormPassword((v) => !v)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                            title={showFormPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                          >
                            {showFormPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded border border-indigo-200 bg-indigo-50/50 px-2.5 py-2 space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-indigo-900">
                        <KeyRound size={13} className="text-indigo-600" />
                        Tài khoản đăng nhập:{" "}
                        <span className="font-mono rounded bg-white px-1.5 py-0.5 border border-indigo-200">
                          {editingRow.account_username}
                        </span>
                        {editingRow.account_is_active === false && (
                          <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
                            Đang khóa
                          </span>
                        )}
                      </span>
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                        Đặt lại mật khẩu mới (để trống nếu giữ nguyên mật khẩu hiện tại)
                      </label>
                      <div className="relative">
                        <input
                          type={showFormPassword ? "text" : "password"}
                          value={formAccountPassword}
                          onChange={(e) => setFormAccountPassword(e.target.value)}
                          placeholder="Nhập mật khẩu mới (tối thiểu 6 ký tự)"
                          className={`${inputCls} pr-8`}
                          autoComplete="new-password"
                        />
                        <button
                          type="button"
                          onClick={() => setShowFormPassword((v) => !v)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                          title={showFormPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                        >
                          {showFormPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <footer className="border-t border-slate-300 bg-slate-100 px-3 py-2 flex items-center justify-between gap-3">
                <span className="text-[10px] text-slate-500">
                  * Nhân viên trạng thái &quot;Đang làm việc&quot; sẽ xuất hiện ngay trong danh sách chọn NVGH trên Đơn hàng DMS.
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setModalOpen(false)}
                    className="rounded bg-red-700 hover:bg-red-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
                  >
                    Đóng
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 rounded bg-sky-600 hover:bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {saving ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <CheckCircle2 size={13} />
                    )}
                    {editingRow ? "Lưu thay đổi" : "Thêm nhân viên"}
                  </button>
                </div>
              </footer>
            </form>
          </div>
        </div>
      )}

      {/* MODAL CẤP TÀI KHOẢN / ĐẶT LẠI MẬT KHẨU (Chuẩn CreateOrderForm) */}
      {accountRow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            if (!savingAccount) setAccountRow(null);
          }}
        >
          <div
            className="w-full max-w-md border border-slate-400 bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="bg-[#14263d] px-3 py-2 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound size={17} className="text-red-500" />
                <h2 className="text-xs font-bold uppercase tracking-wide text-white">
                  {accountRow.account_username
                    ? `Quản Lý Tài Khoản · ${accountRow.account_username}`
                    : `Cấp Tài Khoản Đăng Nhập · ${accountRow.code}`}
                </h2>
              </div>
              <button
                type="button"
                disabled={savingAccount}
                onClick={() => setAccountRow(null)}
                className="rounded p-1 text-white hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </header>

            <form onSubmit={handleSaveAccount}>
              <div className="border-b border-slate-200 px-3 py-3 space-y-2.5">
                <div className="rounded border border-sky-200 bg-sky-50/70 px-2.5 py-2 text-xs text-sky-900 space-y-0.5">
                  <div>
                    <strong>Nhân viên:</strong> {accountRow.name}{" "}
                    <span className="text-[10px] text-slate-600">({accountRow.position})</span>
                  </div>
                  <div>
                    <strong>Tên đăng nhập:</strong>{" "}
                    <span className="font-mono font-bold text-indigo-800">
                      {accountRow.account_username || accountRow.code}
                    </span>
                  </div>
                </div>

                {accountError && (
                  <div className="flex items-center gap-1.5 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
                    <AlertTriangle size={13} className="shrink-0" />
                    <span>{accountError}</span>
                  </div>
                )}

                <div>
                  <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                    {accountRow.account_username
                      ? "Mật khẩu mới (để trống nếu không đổi mật khẩu)"
                      : "Mật khẩu khởi tạo (để trống để hệ thống tự sinh ngẫu nhiên)"}
                  </label>
                  <div className="relative">
                    <input
                      type={showAccountPassword ? "text" : "password"}
                      value={accountPassword}
                      onChange={(e) => setAccountPassword(e.target.value)}
                      placeholder="Tối thiểu 6 ký tự"
                      className={`${inputCls} pr-8`}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowAccountPassword((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                      title={showAccountPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                    >
                      {showAccountPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                </div>

                {accountRow.account_username && (
                  <div className="rounded border border-slate-200 bg-slate-50 px-2.5 py-2 flex items-center justify-between gap-2">
                    <div className="text-xs">
                      <span className="font-semibold text-slate-700">Trạng thái tài khoản: </span>
                      {accountIsActive ? (
                        <span className="font-bold text-emerald-700">Đang hoạt động</span>
                      ) : (
                        <span className="font-bold text-red-700">Đang khóa</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setAccountIsActive((v) => !v)}
                      className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold text-white transition-colors ${
                        accountIsActive
                          ? "bg-amber-600 hover:bg-amber-700"
                          : "bg-emerald-600 hover:bg-emerald-700"
                      }`}
                    >
                      {accountIsActive ? <Lock size={11} /> : <Unlock size={11} />}
                      {accountIsActive ? "Khóa TK" : "Mở khóa TK"}
                    </button>
                  </div>
                )}
              </div>

              <footer className="border-t border-slate-300 bg-slate-100 px-3 py-2 flex items-center justify-between gap-3">
                <span className="text-[10px] text-slate-500">
                  * Nhân viên đăng nhập bằng đúng Mã NV và mật khẩu đã thiết lập.
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={savingAccount}
                    onClick={() => setAccountRow(null)}
                    className="rounded bg-red-700 hover:bg-red-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
                  >
                    Đóng
                  </button>
                  <button
                    type="submit"
                    disabled={savingAccount}
                    className="inline-flex items-center gap-1.5 rounded bg-sky-600 hover:bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:bg-slate-300"
                  >
                    {savingAccount ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <CheckCircle2 size={13} />
                    )}
                    {accountRow.account_username ? "Lưu tài khoản" : "Cấp tài khoản"}
                  </button>
                </div>
              </footer>
            </form>
          </div>
        </div>
      )}

      {/* MODAL XÁC NHẬN XÓA NHÂN VIÊN */}
      {deletingRow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            if (!deleting) setDeletingRow(null);
          }}
        >
          <div
            className="w-full max-w-md border border-slate-400 bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="bg-[#14263d] px-3 py-2 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trash2 size={17} className="text-red-500" />
                <h2 className="text-xs font-bold uppercase tracking-wide text-white">
                  Xác Nhận Xóa Nhân Viên
                </h2>
              </div>
              <button
                type="button"
                disabled={deleting}
                onClick={() => setDeletingRow(null)}
                className="rounded p-1 text-white hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </header>

            <div className="border-b border-slate-200 px-3 py-3 space-y-2 text-xs text-slate-700">
              <p>
                Bạn có chắc muốn xóa nhân viên{" "}
                <strong className="font-mono text-sky-900">{deletingRow.code}</strong> —{" "}
                <strong>{deletingRow.name}</strong>?
              </p>
              {deleteError && (
                <div className="flex items-center gap-1.5 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
                  <AlertTriangle size={13} className="shrink-0" />
                  <span>{deleteError}</span>
                </div>
              )}
            </div>

            <footer className="border-t border-slate-300 bg-slate-100 px-3 py-2 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setDeletingRow(null)}
                className="rounded bg-slate-500 hover:bg-slate-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void handleConfirmDelete()}
                className="inline-flex items-center gap-1.5 rounded bg-red-700 hover:bg-red-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-50"
              >
                {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                Xóa nhân viên
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

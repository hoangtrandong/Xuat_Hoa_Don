"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  History,
  KeyRound,
  Loader2,
  Monitor,
  Moon,
  Palette,
  RefreshCw,
  Shield,
  ShieldCheck,
  Sun,
  User,
  UserCog,
  X,
} from "lucide-react";
import { API_URL, apiFetch } from "@/lib/api";
import { getStoredAccessToken, saveAuthSession } from "@/lib/auth-session";
import { useTheme } from "@/lib/theme";

export type AccountSettingsTab =
  | "profile"
  | "security"
  | "permissions"
  | "activity"
  | "preferences";

interface MeProfile {
  id: number;
  username: string;
  email: string;
  full_name: string;
  must_change_password: boolean;
  created_at: string | null;
  last_login_at: string | null;
  last_login_ip: string | null;
  employee_code: string | null;
  employee_name: string | null;
  distributor_id: number | null;
  distributor_code: string | null;
  distributor_name: string | null;
  distributor_tax_code: string | null;
  roles: string[];
  permissions: string[];
  is_admin: boolean;
  is_super_admin: boolean;
}

interface ActivityItem {
  id: number;
  action: string;
  resource: string;
  resource_id: string | null;
  path: string;
  status_code: number;
  ip_address: string | null;
  created_at: string | null;
}

interface AccountSettingsModalProps {
  open: boolean;
  initialTab?: AccountSettingsTab;
  forcedPasswordChange?: boolean;
  onClose: () => void;
}

const inputCls =
  "w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-100";

const RESOURCE_LABELS: Record<string, string> = {
  customers: "Khách hàng",
  stores: "Cửa hàng / Điểm bán",
  companies: "Công ty quản lý",
  products: "Sản phẩm & Bảng giá",
  "product-groups": "Nhóm sản phẩm",
  "sales-orders": "Đơn hàng bán",
  inventory: "Kho hàng & Tồn kho",
  employees: "Nhân viên",
  payments: "Thanh toán",
  debt: "Công nợ tổng hợp",
  "delivery-requests": "Yêu cầu giao hàng",
  "delivery-returns": "Hàng trả lại",
  "employee-debts": "Công nợ nhân viên",
  "store-debts": "Công nợ điểm bán",
  "cash-receipts": "Phiếu thu tiền mặt",
  "bank-receipts": "Phiếu thu ngân hàng",
  "debt-transfers": "Chuyển công nợ",
  "employee-borrowing": "Nhân viên mượn hàng",
  promotions: "Khuyến mãi",
  einvoice: "Hóa đơn điện tử & Thuế",
  "supplier-dictionaries": "Danh mục Nhà cung cấp",
  sync: "Đồng bộ dữ liệu DMS/NCC",
  users: "Quản trị tài khoản & Phân quyền",
  auth: "Bảo mật & Xác thực",
};

const ACTION_LABELS: Record<string, { label: string; cls: string }> = {
  login: {
    label: "Đăng nhập thành công",
    cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  login_failed: {
    label: "Đăng nhập thất bại",
    cls: "bg-red-50 text-red-700 border-red-200",
  },
  change_password: {
    label: "Đổi mật khẩu",
    cls: "bg-sky-50 text-sky-700 border-sky-200",
  },
  update_profile: {
    label: "Cập nhật hồ sơ",
    cls: "bg-indigo-50 text-indigo-700 border-indigo-200",
  },
  create: {
    label: "Tạo mới",
    cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  update: {
    label: "Cập nhật",
    cls: "bg-amber-50 text-amber-800 border-amber-200",
  },
  delete: {
    label: "Xóa dữ liệu",
    cls: "bg-red-50 text-red-700 border-red-200",
  },
};

function formatDateTimeVN(iso: string | null): string {
  if (!iso) return "—";
  const normalized = iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function evaluatePassword(pw: string) {
  const checks = {
    length: pw.length >= 8,
    upperLower: /[a-z]/.test(pw) && /[A-Z]/.test(pw),
    number: /\d/.test(pw),
    special: /[^A-Za-z0-9]/.test(pw),
  };
  const score = Object.values(checks).filter(Boolean).length;
  const levels = [
    { label: "Chưa nhập", color: "bg-slate-200", text: "text-slate-500" },
    { label: "Yếu", color: "bg-red-500", text: "text-red-600" },
    { label: "Trung bình", color: "bg-amber-500", text: "text-amber-600" },
    { label: "Khá mạnh", color: "bg-sky-500", text: "text-sky-600" },
    { label: "Mạnh", color: "bg-emerald-600", text: "text-emerald-700" },
  ];
  return { checks, score, level: levels[pw ? Math.max(1, score) : 0] };
}

export default function AccountSettingsModal({
  open,
  initialTab = "profile",
  forcedPasswordChange = false,
  onClose,
}: AccountSettingsModalProps) {
  const { theme, setTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<AccountSettingsTab>(
    forcedPasswordChange ? "security" : initialTab,
  );
  const [profile, setProfile] = useState<MeProfile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);

  // Profile form state
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // Password form state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // Activity state
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [activityCategory, setActivityCategory] = useState<"all" | "security" | "operations">("all");
  const [loadedActivityKey, setLoadedActivityKey] = useState<string | null>(null);
  const [refreshingActivity, setRefreshingActivity] = useState(false);

  // Permissions search
  const [permQuery, setPermQuery] = useState("");

  const loadingProfile = !profileLoaded;
  const loadingActivity = refreshingActivity || loadedActivityKey !== activityCategory;

  const fetchProfile = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_URL}/auth/me`);
      if (res.ok) {
        const data = (await res.json()) as MeProfile;
        setProfile(data);
        setFullName(data.full_name || "");
        setEmail(data.email || "");
      }
    } finally {
      setProfileLoaded(true);
    }
  }, []);

  const fetchActivity = useCallback(
    async (category: "all" | "security" | "operations", manual = false) => {
      if (manual) setRefreshingActivity(true);
      try {
        const qs =
          category === "all" ? "?limit=40" : `?limit=40&category=${category}`;
        const res = await apiFetch(`${API_URL}/auth/me/activity${qs}`);
        if (res.ok) {
          const rows = (await res.json()) as ActivityItem[];
          setActivities(rows);
        }
      } finally {
        setLoadedActivityKey(category);
        if (manual) setRefreshingActivity(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiFetch(`${API_URL}/auth/me`)
      .then((res) => (res.ok ? (res.json() as Promise<MeProfile>) : null))
      .then((data) => {
        if (cancelled) return;
        if (data) {
          setProfile(data);
          setFullName(data.full_name || "");
          setEmail(data.email || "");
        }
        setProfileLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setProfileLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || activeTab !== "activity") return;
    let cancelled = false;
    const qs =
      activityCategory === "all" ? "?limit=40" : `?limit=40&category=${activityCategory}`;
    apiFetch(`${API_URL}/auth/me/activity${qs}`)
      .then((res) => (res.ok ? (res.json() as Promise<ActivityItem[]>) : null))
      .then((rows) => {
        if (cancelled) return;
        if (rows) setActivities(rows);
        setLoadedActivityKey(activityCategory);
      })
      .catch(() => {
        if (!cancelled) setLoadedActivityKey(activityCategory);
      });
    return () => {
      cancelled = true;
    };
  }, [open, activeTab, activityCategory]);

  // Close on Escape unless forced
  useEffect(() => {
    if (!open || forcedPasswordChange) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, forcedPasswordChange, onClose]);

  const pwEval = useMemo(() => evaluatePassword(newPassword), [newPassword]);

  const permissionMatrix = useMemo(() => {
    const perms = profile?.permissions || [];
    const grouped = new Map<string, { read: boolean; write: boolean }>();
    for (const code of perms) {
      const [resource, action] = code.split(":");
      if (!resource) continue;
      const cur = grouped.get(resource) || { read: false, write: false };
      if (action === "read") cur.read = true;
      if (action === "write") cur.write = true;
      grouped.set(resource, cur);
    }
    const q = permQuery.trim().toLowerCase();
    return Array.from(grouped.entries())
      .map(([resource, flags]) => ({
        resource,
        label: RESOURCE_LABELS[resource] || resource,
        ...flags,
      }))
      .filter(
        (item) =>
          !q ||
          item.label.toLowerCase().includes(q) ||
          item.resource.toLowerCase().includes(q),
      )
      .sort((a, b) => a.label.localeCompare(b.label, "vi"));
  }, [profile?.permissions, permQuery]);

  async function handleSaveProfile(e: FormEvent) {
    e.preventDefault();
    setProfileMsg(null);
    setSavingProfile(true);
    try {
      const res = await apiFetch(`${API_URL}/auth/me`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fullName.trim(),
          email: email.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          typeof data.detail === "string"
            ? data.detail
            : Array.isArray(data.detail) && data.detail[0]?.msg
              ? String(data.detail[0].msg)
              : "Không thể cập nhật thông tin tài khoản.";
        setProfileMsg({ type: "err", text: msg });
        return;
      }
      setProfile(data as MeProfile);
      const token = getStoredAccessToken();
      if (token) {
        saveAuthSession(token, data.username, {
          fullName: data.full_name || "",
          distributorId: data.distributor_id ?? null,
          distributorCode: data.distributor_code || "",
          distributorName: data.distributor_name || "",
          distributorTaxCode: data.distributor_tax_code || "",
          isSuperAdmin: Boolean(data.is_super_admin),
          mustChangePassword: Boolean(data.must_change_password),
        });
      }
      setProfileMsg({ type: "ok", text: "Đã lưu thông tin hồ sơ tài khoản." });
    } catch {
      setProfileMsg({ type: "err", text: "Lỗi kết nối máy chủ. Vui lòng thử lại." });
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    setPasswordMsg(null);
    if (newPassword.length < 8) {
      setPasswordMsg({ type: "err", text: "Mật khẩu mới phải có tối thiểu 8 ký tự." });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ type: "err", text: "Xác nhận mật khẩu mới không khớp." });
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordMsg({
        type: "err",
        text: "Mật khẩu mới không được trùng với mật khẩu hiện tại.",
      });
      return;
    }

    setSavingPassword(true);
    try {
      const res = await apiFetch(`${API_URL}/auth/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          typeof data.detail === "string"
            ? data.detail
            : Array.isArray(data.detail) && data.detail[0]?.msg
              ? String(data.detail[0].msg)
              : "Không thể đổi mật khẩu.";
        setPasswordMsg({ type: "err", text: msg });
        return;
      }

      const nextToken = data.access_token || getStoredAccessToken();
      if (nextToken && profile) {
        saveAuthSession(nextToken, profile.username, {
          fullName: profile.full_name,
          distributorId: profile.distributor_id,
          distributorCode: profile.distributor_code,
          distributorName: profile.distributor_name,
          distributorTaxCode: profile.distributor_tax_code,
          isSuperAdmin: profile.is_super_admin,
          mustChangePassword: false,
        });
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMsg({
        type: "ok",
        text: data.detail || "Đổi mật khẩu thành công. Phiên đăng nhập đã được làm mới.",
      });
      void fetchProfile();
    } catch {
      setPasswordMsg({ type: "err", text: "Lỗi kết nối máy chủ. Vui lòng thử lại." });
    } finally {
      setSavingPassword(false);
    }
  }

  if (!open) return null;

  const tabs: { id: AccountSettingsTab; label: string; icon: typeof User }[] = [
    { id: "profile", label: "Hồ sơ cá nhân", icon: User },
    { id: "security", label: "Đổi mật khẩu", icon: KeyRound },
    { id: "permissions", label: "Phân quyền & NPP", icon: Shield },
    { id: "activity", label: "Nhật ký hoạt động", icon: History },
    { id: "preferences", label: "Giao diện", icon: Palette },
  ];

  const formId =
    activeTab === "profile"
      ? "account-profile-form"
      : activeTab === "security"
        ? "account-password-form"
        : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-3"
      onClick={(e) => {
        if (e.target === e.currentTarget && !forcedPasswordChange) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Cấu hình tài khoản"
        className="w-full max-w-3xl border border-slate-400 bg-white shadow-lg flex flex-col max-h-[90vh]"
      >
        {/* 1.1 Header Modal chuẩn CreateOrderForm */}
        <div className="bg-[#14263d] px-3 py-2 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <UserCog size={17} className="text-red-500 shrink-0" />
            <h2 className="text-xs font-bold uppercase tracking-wide text-white truncate">
              Cấu Hình Tài Khoản {profile ? `— @${profile.username}` : ""}
            </h2>
          </div>
          {!forcedPasswordChange && (
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-white hover:bg-white/10"
              aria-label="Đóng cửa sổ cấu hình tài khoản"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Thanh Tab gọn kiểu Enterprise */}
        <div className="border-b border-slate-200 bg-slate-50 px-3 pt-1.5 flex items-center gap-1 overflow-x-auto shrink-0">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            const disabled = forcedPasswordChange && tab.id !== "security";
            return (
              <button
                key={tab.id}
                type="button"
                disabled={disabled}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold border-b-2 transition-colors whitespace-nowrap ${
                  isActive
                    ? "border-sky-600 text-sky-700 bg-white"
                    : "border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                <Icon size={13} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Thân Modal */}
        <div className="flex-1 overflow-y-auto">
          {loadingProfile && !profile ? (
            <div className="flex items-center justify-center py-12 text-xs text-slate-500 gap-2">
              <Loader2 size={15} className="animate-spin text-sky-600" />
              Đang tải thông tin tài khoản...
            </div>
          ) : (
            <>
              {/* TAB 1: HỒ SƠ CÁ NHÂN */}
              {activeTab === "profile" && (
                <form id="account-profile-form" onSubmit={handleSaveProfile}>
                  <div className="border-b border-sky-100 bg-sky-50/60 px-3 py-2 text-[11px] font-bold text-sky-800 uppercase">
                    1. Thông tin cá nhân có thể cập nhật
                  </div>
                  <div className="border-b border-slate-200 px-3 py-2.5">
                    <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2">
                      <div>
                        <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                          Họ và tên hiển thị <span className="text-red-600">(*)</span>
                        </label>
                        <input
                          type="text"
                          required
                          maxLength={120}
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          placeholder="Nhập họ và tên..."
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                          Email liên hệ / nhận thông báo <span className="text-red-600">(*)</span>
                        </label>
                        <input
                          type="email"
                          required
                          maxLength={120}
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="email@congty.vn"
                          className={inputCls}
                        />
                      </div>
                    </div>

                    {profileMsg && (
                      <div
                        role={profileMsg.type === "err" ? "alert" : "status"}
                        className={`mt-2.5 rounded border px-2.5 py-1.5 text-xs font-medium ${
                          profileMsg.type === "ok"
                            ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                            : "border-red-300 bg-red-50 text-red-700"
                        }`}
                      >
                        {profileMsg.text}
                      </div>
                    )}
                  </div>

                  <div className="border-b border-sky-100 bg-sky-50/60 px-3 py-2 text-[11px] font-bold text-sky-800 uppercase">
                    2. Định danh hệ thống & Đơn vị công tác (Chỉ đọc)
                  </div>
                  <div className="px-3 py-2.5">
                    <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2 xl:grid-cols-4">
                      <div>
                        <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                          Tên đăng nhập
                        </label>
                        <input
                          type="text"
                          disabled
                          value={profile?.username || ""}
                          className={`${inputCls} font-mono`}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                          Mã nhân viên liên kết
                        </label>
                        <input
                          type="text"
                          disabled
                          value={
                            profile?.employee_code
                              ? `${profile.employee_code}${profile.employee_name ? ` - ${profile.employee_name}` : ""}`
                              : "Chưa liên kết nhân viên"
                          }
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                          Vai trò hệ thống
                        </label>
                        <input
                          type="text"
                          disabled
                          value={
                            profile?.roles?.length
                              ? profile.roles.join(", ")
                              : "Chưa gán vai trò"
                          }
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                          Ngày tạo tài khoản
                        </label>
                        <input
                          type="text"
                          disabled
                          value={formatDateTimeVN(profile?.created_at || null)}
                          className={inputCls}
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                          Nhà phân phối trực thuộc
                        </label>
                        <input
                          type="text"
                          disabled
                          value={
                            profile?.distributor_code
                              ? `[${profile.distributor_code}] ${profile.distributor_name || ""}`
                              : profile?.is_super_admin
                                ? "Quản trị toàn hệ thống (Super Admin)"
                                : "Toàn hệ thống"
                          }
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                          Mã số thuế NPP
                        </label>
                        <input
                          type="text"
                          disabled
                          value={profile?.distributor_tax_code || "—"}
                          className={`${inputCls} font-mono`}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                          Đăng nhập gần nhất
                        </label>
                        <input
                          type="text"
                          disabled
                          value={formatDateTimeVN(profile?.last_login_at || null)}
                          className={inputCls}
                        />
                      </div>
                    </div>
                  </div>
                </form>
              )}

              {/* TAB 2: ĐỔI MẬT KHẨU & BẢO MẬT */}
              {activeTab === "security" && (
                <form id="account-password-form" onSubmit={handleChangePassword}>
                  {forcedPasswordChange && (
                    <div className="mx-3 mt-2.5 flex items-start gap-2 rounded border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
                      <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold">Yêu cầu đổi mật khẩu lần đầu</p>
                        <p className="text-[11px]">
                          Tài khoản của bạn đang được đánh dấu bắt buộc đổi mật khẩu trước khi
                          tiếp tục sử dụng các chức năng bán hàng và xuất hóa đơn.
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="border-b border-sky-100 bg-sky-50/60 px-3 py-2 text-[11px] font-bold text-sky-800 uppercase mt-0">
                    Đổi mật khẩu đăng nhập
                  </div>
                  <div className="border-b border-slate-200 px-3 py-2.5 space-y-2.5">
                    <div className="grid gap-x-3 gap-y-2 sm:grid-cols-3">
                      <div>
                        <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                          Mật khẩu hiện tại <span className="text-red-600">(*)</span>
                        </label>
                        <div className="relative">
                          <input
                            type={showCurrentPw ? "text" : "password"}
                            autoComplete="current-password"
                            required
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            placeholder="Nhập mật khẩu cũ..."
                            className={`${inputCls} pr-7`}
                          />
                          <button
                            type="button"
                            onClick={() => setShowCurrentPw((v) => !v)}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                            aria-label="Hiện hoặc ẩn mật khẩu hiện tại"
                          >
                            {showCurrentPw ? <EyeOff size={13} /> : <Eye size={13} />}
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                          Mật khẩu mới <span className="text-red-600">(*)</span>
                        </label>
                        <div className="relative">
                          <input
                            type={showNewPw ? "text" : "password"}
                            autoComplete="new-password"
                            required
                            minLength={8}
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder="Tối thiểu 8 ký tự..."
                            className={`${inputCls} pr-7`}
                          />
                          <button
                            type="button"
                            onClick={() => setShowNewPw((v) => !v)}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                            aria-label="Hiện hoặc ẩn mật khẩu mới"
                          >
                            {showNewPw ? <EyeOff size={13} /> : <Eye size={13} />}
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="text-[10px] font-semibold text-slate-600 block mb-0.5">
                          Xác nhận mật khẩu mới <span className="text-red-600">(*)</span>
                        </label>
                        <div className="relative">
                          <input
                            type={showConfirmPw ? "text" : "password"}
                            autoComplete="new-password"
                            required
                            minLength={8}
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder="Nhập lại mật khẩu mới..."
                            className={`${inputCls} pr-7`}
                          />
                          <button
                            type="button"
                            onClick={() => setShowConfirmPw((v) => !v)}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                            aria-label="Hiện hoặc ẩn xác nhận mật khẩu"
                          >
                            {showConfirmPw ? <EyeOff size={13} /> : <Eye size={13} />}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Thanh đo độ mạnh mật khẩu */}
                    <div className="rounded border border-slate-200 bg-slate-50 p-2.5">
                      <div className="flex items-center justify-between text-[11px] mb-1.5">
                        <span className="font-semibold text-slate-600">Độ mạnh mật khẩu mới:</span>
                        <span className={`font-bold ${pwEval.level.text}`}>
                          {pwEval.level.label}
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-1 mb-2">
                        {[1, 2, 3, 4].map((step) => (
                          <div
                            key={step}
                            className={`h-1.5 rounded-full transition-colors ${
                              newPassword && pwEval.score >= step
                                ? pwEval.level.color
                                : "bg-slate-200"
                            }`}
                          />
                        ))}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[10px]">
                        {[
                          { ok: pwEval.checks.length, label: "Tối thiểu 8 ký tự" },
                          { ok: pwEval.checks.upperLower, label: "Chữ hoa & chữ thường" },
                          { ok: pwEval.checks.number, label: "Có chữ số (0-9)" },
                          { ok: pwEval.checks.special, label: "Có ký tự đặc biệt" },
                        ].map((rule) => (
                          <div
                            key={rule.label}
                            className={`flex items-center gap-1 ${
                              rule.ok ? "text-emerald-700 font-semibold" : "text-slate-500"
                            }`}
                          >
                            <Check size={11} className={rule.ok ? "opacity-100" : "opacity-30"} />
                            <span>{rule.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {passwordMsg && (
                      <div
                        role={passwordMsg.type === "err" ? "alert" : "status"}
                        className={`rounded border px-2.5 py-1.5 text-xs font-medium ${
                          passwordMsg.type === "ok"
                            ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                            : "border-red-300 bg-red-50 text-red-700"
                        }`}
                      >
                        {passwordMsg.text}
                      </div>
                    )}
                  </div>

                  {/* Chính sách bảo mật tài khoản */}
                  <div className="border-b border-sky-100 bg-sky-50/60 px-3 py-2 text-[11px] font-bold text-sky-800 uppercase">
                    Chính sách bảo vệ tài khoản
                  </div>
                  <div className="px-3 py-2.5 grid gap-2 sm:grid-cols-3 text-[11px]">
                    <div className="rounded border border-slate-200 p-2">
                      <p className="text-[10px] font-semibold text-slate-500">Chống dò mật khẩu</p>
                      <p className="font-bold text-slate-800 mt-0.5">
                        Khóa 15 phút sau 5 lần sai
                      </p>
                    </div>
                    <div className="rounded border border-slate-200 p-2">
                      <p className="text-[10px] font-semibold text-slate-500">Đăng nhập gần nhất</p>
                      <p className="font-bold text-slate-800 mt-0.5">
                        {formatDateTimeVN(profile?.last_login_at || null)}
                      </p>
                    </div>
                    <div className="rounded border border-slate-200 p-2">
                      <p className="text-[10px] font-semibold text-slate-500">IP gần nhất</p>
                      <p className="font-bold font-mono text-slate-800 mt-0.5">
                        {profile?.last_login_ip || "—"}
                      </p>
                    </div>
                  </div>
                </form>
              )}

              {/* TAB 3: PHÂN QUYỀN & PHẠM VI NPP */}
              {activeTab === "permissions" && (
                <div>
                  <div className="border-b border-sky-100 bg-sky-50/60 px-3 py-2 text-[11px] font-bold text-sky-800 uppercase">
                    Phạm vi dữ liệu & Vai trò được cấp
                  </div>
                  <div className="border-b border-slate-200 px-3 py-2.5 grid gap-2 sm:grid-cols-2 text-xs">
                    <div className="rounded border border-slate-200 p-2.5 flex items-start gap-2">
                      {profile?.is_super_admin ? (
                        <ShieldCheck size={16} className="text-indigo-600 shrink-0 mt-0.5" />
                      ) : (
                        <Building2 size={16} className="text-sky-600 shrink-0 mt-0.5" />
                      )}
                      <div>
                        <p className="text-[10px] font-semibold text-slate-500 uppercase">
                          Phạm vi Nhà phân phối (Tenant)
                        </p>
                        <p className="font-bold text-slate-800 mt-0.5">
                          {profile?.distributor_code
                            ? `[${profile.distributor_code}] ${profile.distributor_name || ""}`
                            : profile?.is_super_admin
                              ? "Toàn hệ thống (Super Admin — chuyển đổi mọi NPP)"
                              : "Nội bộ (chưa khóa cứng NPP)"}
                        </p>
                        {profile?.distributor_tax_code && (
                          <p className="text-[11px] text-slate-500 font-mono">
                            MST: {profile.distributor_tax_code}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="rounded border border-slate-200 p-2.5">
                      <p className="text-[10px] font-semibold text-slate-500 uppercase">
                        Vai trò hiện tại ({profile?.roles?.length || 0})
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {profile?.roles?.length ? (
                          profile.roles.map((r) => (
                            <span
                              key={r}
                              className="inline-flex items-center rounded border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-bold text-sky-800"
                            >
                              {r}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-slate-500">Chưa gán vai trò</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="border-b border-sky-100 bg-sky-50/60 px-3 py-2 flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold text-sky-800 uppercase">
                      Ma trận quyền hạn ({permissionMatrix.length} phân hệ)
                    </span>
                    <input
                      type="text"
                      value={permQuery}
                      onChange={(e) => setPermQuery(e.target.value)}
                      placeholder="Lọc nhanh phân hệ..."
                      className="w-48 rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-800 focus:border-sky-500 focus:outline-none"
                    />
                  </div>
                  <div className="overflow-x-auto max-h-72">
                    <table className="w-full border-collapse text-left">
                      <thead className="sticky top-0 bg-slate-100 text-[10px] font-semibold text-slate-600">
                        <tr>
                          <th className="px-3 py-1.5 border-b border-slate-200">Phân hệ nghiệp vụ</th>
                          <th className="px-3 py-1.5 border-b border-slate-200 font-mono">Mã quyền</th>
                          <th className="px-3 py-1.5 border-b border-slate-200 text-center w-24">
                            Xem (Read)
                          </th>
                          <th className="px-3 py-1.5 border-b border-slate-200 text-center w-28">
                            Thao tác (Write)
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {permissionMatrix.length === 0 ? (
                          <tr>
                            <td
                              colSpan={4}
                              className="px-3 py-6 text-center text-xs text-slate-500"
                            >
                              Không tìm thấy quyền phù hợp.
                            </td>
                          </tr>
                        ) : (
                          permissionMatrix.map((row) => (
                            <tr
                              key={row.resource}
                              className="border-b border-slate-100 even:bg-amber-50/40 hover:bg-sky-50/50 text-[11px]"
                            >
                              <td className="px-3 py-1.5 font-semibold text-slate-800">
                                {row.label}
                              </td>
                              <td className="px-3 py-1.5 font-mono text-[10px] text-slate-500">
                                {row.resource}
                              </td>
                              <td className="px-3 py-1.5 text-center">
                                {row.read ? (
                                  <span className="inline-flex rounded bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                                    Có
                                  </span>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </td>
                              <td className="px-3 py-1.5 text-center">
                                {row.write ? (
                                  <span className="inline-flex rounded bg-sky-50 border border-sky-200 px-1.5 py-0.5 text-[10px] font-bold text-sky-700">
                                    Có
                                  </span>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 4: NHẬT KÝ ĐĂNG NHẬP & HOẠT ĐỘNG */}
              {activeTab === "activity" && (
                <div>
                  <div className="border-b border-sky-100 bg-sky-50/60 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      {(
                        [
                          { id: "all", label: "Tất cả" },
                          { id: "security", label: "Bảo mật & Đăng nhập" },
                          { id: "operations", label: "Thao tác nghiệp vụ" },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setActivityCategory(opt.id)}
                          className={`rounded px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                            activityCategory === opt.id
                              ? "bg-sky-600 text-white"
                              : "bg-white border border-slate-300 text-slate-600 hover:bg-slate-100"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => void fetchActivity(activityCategory, true)}
                      disabled={loadingActivity}
                      className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                    >
                      <RefreshCw size={11} className={loadingActivity ? "animate-spin" : ""} />
                      Làm mới
                    </button>
                  </div>

                  <div className="overflow-x-auto max-h-80">
                    <table className="w-full border-collapse text-left">
                      <thead className="sticky top-0 bg-slate-100 text-[10px] font-semibold text-slate-600">
                        <tr>
                          <th className="px-3 py-1.5 border-b border-slate-200">Thời gian</th>
                          <th className="px-3 py-1.5 border-b border-slate-200">Hành động</th>
                          <th className="px-3 py-1.5 border-b border-slate-200">Phân hệ</th>
                          <th className="px-3 py-1.5 border-b border-slate-200 text-center">HTTP</th>
                          <th className="px-3 py-1.5 border-b border-slate-200">Địa chỉ IP</th>
                        </tr>
                      </thead>
                      <tbody>
                        {loadingActivity ? (
                          <tr>
                            <td colSpan={5} className="px-3 py-8 text-center text-xs text-slate-500">
                              <Loader2 size={14} className="inline animate-spin mr-1.5" />
                              Đang tải nhật ký...
                            </td>
                          </tr>
                        ) : activities.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-3 py-8 text-center text-xs text-slate-500">
                              Chưa có dữ liệu nhật ký hoạt động cho tài khoản này.
                            </td>
                          </tr>
                        ) : (
                          activities.map((item) => {
                            const badge = ACTION_LABELS[item.action] || {
                              label: item.action,
                              cls: "bg-slate-100 text-slate-700 border-slate-200",
                            };
                            const okStatus = item.status_code >= 200 && item.status_code < 400;
                            return (
                              <tr
                                key={item.id}
                                className="border-b border-slate-100 even:bg-amber-50/40 hover:bg-sky-50/50 text-[11px]"
                              >
                                <td className="px-3 py-1.5 whitespace-nowrap font-mono text-[10px] text-slate-600">
                                  {formatDateTimeVN(item.created_at)}
                                </td>
                                <td className="px-3 py-1.5">
                                  <span
                                    className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold ${badge.cls}`}
                                  >
                                    {badge.label}
                                  </span>
                                </td>
                                <td className="px-3 py-1.5 text-slate-700">
                                  <div className="font-medium">
                                    {RESOURCE_LABELS[item.resource] || item.resource}
                                  </div>
                                  <div className="text-[10px] font-mono text-slate-400 truncate max-w-[220px]">
                                    {item.path}
                                  </div>
                                </td>
                                <td className="px-3 py-1.5 text-center font-mono text-[10px] font-bold">
                                  <span
                                    className={okStatus ? "text-emerald-700" : "text-red-600"}
                                  >
                                    {item.status_code}
                                  </span>
                                </td>
                                <td className="px-3 py-1.5 font-mono text-[10px] text-slate-600">
                                  {item.ip_address || "—"}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 5: TÙY CHỌN GIAO DIỆN */}
              {activeTab === "preferences" && (
                <div>
                  <div className="border-b border-sky-100 bg-sky-50/60 px-3 py-2 text-[11px] font-bold text-sky-800 uppercase">
                    Chế độ hiển thị giao diện
                  </div>
                  <div className="px-3 py-3 grid gap-2.5 sm:grid-cols-3">
                    {(
                      [
                        {
                          id: "light",
                          label: "Giao diện sáng",
                          desc: "Tối ưu cho môi trường văn phòng ban ngày",
                          icon: Sun,
                        },
                        {
                          id: "dark",
                          label: "Giao diện tối",
                          desc: "Giảm mỏi mắt khi quyết toán & làm việc tối",
                          icon: Moon,
                        },
                        {
                          id: "system",
                          label: "Theo hệ thống",
                          desc: "Tự động đồng bộ theo thiết lập Windows/macOS",
                          icon: Monitor,
                        },
                      ] as const
                    ).map((opt) => {
                      const Icon = opt.icon;
                      const selected = theme === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setTheme(opt.id)}
                          className={`rounded border p-3 text-left transition-colors ${
                            selected
                              ? "border-sky-600 bg-sky-50/70 ring-1 ring-sky-500"
                              : "border-slate-300 bg-white hover:bg-slate-50"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <Icon
                              size={16}
                              className={selected ? "text-sky-600" : "text-slate-500"}
                            />
                            {selected && (
                              <span className="rounded bg-sky-600 px-1.5 py-0.5 text-[9px] font-bold text-white uppercase">
                                Đang dùng
                              </span>
                            )}
                          </div>
                          <p className="mt-2 text-xs font-bold text-slate-800">{opt.label}</p>
                          <p className="mt-0.5 text-[10px] text-slate-500">{opt.desc}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* 1.4 Footer Action Bar chuẩn CreateOrderForm */}
        <div className="border-t border-slate-300 bg-slate-100 px-3 py-2 flex items-center justify-between gap-3 shrink-0">
          <span className="text-[10px] text-slate-500">
            {activeTab === "profile"
              ? "Thay đổi họ tên và email sẽ được cập nhật ngay trên phiên hiện tại."
              : activeTab === "security"
                ? "Khuyến nghị sử dụng mật khẩu mạnh kết hợp chữ hoa, số và ký tự đặc biệt."
                : activeTab === "permissions"
                  ? "Liên hệ Quản trị hệ thống nếu cần bổ sung quyền nghiệp vụ."
                  : activeTab === "activity"
                    ? "Hiển thị tối đa 40 bản ghi gần nhất của riêng tài khoản này."
                    : "Thiết lập giao diện được lưu tự động trên trình duyệt này."}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            {!forcedPasswordChange && (
              <button
                type="button"
                onClick={onClose}
                className="rounded bg-red-700 hover:bg-red-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
              >
                Đóng
              </button>
            )}
            {formId && (
              <button
                type="submit"
                form={formId}
                disabled={savingProfile || savingPassword}
                className="inline-flex items-center gap-1.5 rounded bg-sky-600 hover:bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {savingProfile || savingPassword ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <CheckCircle2 size={13} />
                )}
                {activeTab === "profile"
                  ? savingProfile
                    ? "Đang lưu..."
                    : "Lưu hồ sơ"
                  : savingPassword
                    ? "Đang cập nhật..."
                    : "Đổi mật khẩu"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

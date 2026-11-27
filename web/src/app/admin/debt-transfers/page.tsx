"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Camera,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
  X,
  XCircle,
} from "lucide-react";
import { API_URL, apiFetch } from "@/lib/api";
import { formatDateTime, formatVND } from "@/lib/format";

const inputCls =
  "w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-100";

type DebtTransferRecord = {
  id: number;
  code: string;
  from_party_type: string;
  from_party_id: number;
  to_party_type: string;
  to_party_id: number;
  delivery_request_order_id?: number | null;
  pod_image_url?: string | null;
  amount: number;
  reason?: string | null;
  status: string;
  requested_by?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  rejected_by?: string | null;
  rejected_at?: string | null;
  reject_reason?: string | null;
  override_limit_by?: string | null;
  override_limit_reason?: string | null;
  created_at: string;
};

type EmployeeDebtSummary = {
  employee_id: number;
  code: string;
  name: string;
  current_debt: number;
  debt_limit: number;
};

type StoreDebtSummary = {
  store_id: number;
  code: string;
  name: string;
  current_debt: number;
};

type TabStatus = "PENDING_APPROVAL" | "COMPLETED" | "REJECTED";

export default function DebtTransfersApprovalPage() {
  const [activeTab, setActiveTab] = useState<TabStatus>("PENDING_APPROVAL");
  const [transfers, setTransfers] = useState<DebtTransferRecord[]>([]);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [empMap, setEmpMap] = useState<Record<number, EmployeeDebtSummary>>({});
  const [storeMap, setStoreMap] = useState<Record<number, StoreDebtSummary>>({});
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Approve modal state
  const [approveTarget, setApproveTarget] = useState<DebtTransferRecord | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reject modal state
  const [rejectTarget, setRejectTarget] = useState<DebtTransferRecord | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const loadData = useCallback(async (tab: TabStatus) => {
    setLoading(true);
    setError("");
    try {
      const [resList, resPending, resEmps, resStores] = await Promise.all([
        apiFetch(`${API_URL}/debt-transfers?status=${tab}`),
        apiFetch(`${API_URL}/debt-transfers?status=PENDING_APPROVAL`),
        apiFetch(`${API_URL}/employee-debts`),
        apiFetch(`${API_URL}/store-debts`),
      ]);
      if (!resList.ok) {
        const d = await resList.json().catch(() => ({}));
        throw new Error(d.detail || "Không thể tải danh sách yêu cầu chuyển công nợ.");
      }
      setTransfers((await resList.json()) as DebtTransferRecord[]);
      if (resPending.ok) {
        const pList = (await resPending.json()) as DebtTransferRecord[];
        setPendingCount(pList.length);
      }
      if (resEmps.ok) {
        const emps = (await resEmps.json()) as EmployeeDebtSummary[];
        const next: Record<number, EmployeeDebtSummary> = {};
        for (const e of emps) next[e.employee_id] = e;
        setEmpMap(next);
      }
      if (resStores.ok) {
        const stores = (await resStores.json()) as StoreDebtSummary[];
        const next: Record<number, StoreDebtSummary> = {};
        for (const s of stores) next[s.store_id] = s;
        setStoreMap(next);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi khi tải dữ liệu.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData(activeTab);
  }, [activeTab, loadData]);

  const getPartyLabel = useCallback(
    (type: string, id: number) => {
      if (type === "EMPLOYEE") {
        const emp = empMap[id];
        return emp
          ? { code: emp.code, name: emp.name, debt: emp.current_debt, badge: "NVGH" }
          : { code: `NV#${id}`, name: "", debt: 0, badge: "NVGH" };
      }
      const st = storeMap[id];
      return st
        ? { code: st.code, name: st.name, debt: st.current_debt, badge: "Cửa hàng" }
        : { code: `CH#${id}`, name: "", debt: 0, badge: "Cửa hàng" };
    },
    [empMap, storeMap]
  );

  const filteredTransfers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return transfers;
    return transfers.filter((t) => {
      const fromP = getPartyLabel(t.from_party_type, t.from_party_id);
      const toP = getPartyLabel(t.to_party_type, t.to_party_id);
      return [t.code, fromP.code, fromP.name, toP.code, toP.name, t.reason || "", t.requested_by || ""]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [transfers, search, getPartyLabel]);

  async function handleConfirmApprove() {
    if (!approveTarget) return;
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const res = await apiFetch(`${API_URL}/debt-transfers/${approveTarget.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          override_limit_reason: overrideReason.trim() || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || "Không thể duyệt chuyển công nợ.");
      }
      setNotice(
        `Đã duyệt phiếu ${approveTarget.code} (${formatVND(approveTarget.amount)}). Sổ cái công nợ NVGH & Cửa hàng đã được cập nhật.`
      );
      setApproveTarget(null);
      setOverrideReason("");
      await loadData(activeTab);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi khi duyệt phiếu chuyển nợ.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmReject() {
    if (!rejectTarget) return;
    if (!rejectReason.trim()) {
      setError("Vui lòng nhập lý do từ chối.");
      return;
    }
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const res = await apiFetch(`${API_URL}/debt-transfers/${rejectTarget.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reject_reason: rejectReason.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || "Không thể từ chối phiếu chuyển công nợ.");
      }
      setNotice(`Đã từ chối phiếu ${rejectTarget.code}. Công nợ vẫn giữ nguyên trên bên chuyển.`);
      setRejectTarget(null);
      setRejectReason("");
      await loadData(activeTab);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi khi từ chối phiếu.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-3">
      <div className="border border-slate-400 bg-white shadow-lg">
        {/* Header chuẩn CreateOrderForm */}
        <header className="flex items-center justify-between bg-[#14263d] px-3 py-2 text-white">
          <div className="flex items-center gap-2">
            <ShieldCheck size={17} className="text-red-500" />
            <h1 className="text-xs font-bold uppercase tracking-wide text-white">
              Duyệt Yêu Cầu Chuyển Công Nợ (NVGH → Cửa Hàng · Kèm POD)
            </h1>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadData(activeTab)}
            className="inline-flex items-center gap-1 rounded bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-white/20"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            Làm mới
          </button>
        </header>

        {/* Thanh Tabs & Bộ lọc */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setActiveTab("PENDING_APPROVAL")}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1 text-xs font-semibold transition-colors ${
                activeTab === "PENDING_APPROVAL"
                  ? "bg-amber-600 text-white"
                  : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              }`}
            >
              <Clock size={12} />
              Chờ duyệt
              {pendingCount > 0 && (
                <span className="rounded-full bg-red-600 px-1.5 py-0.2 text-[10px] font-bold text-white">
                  {pendingCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("COMPLETED")}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1 text-xs font-semibold transition-colors ${
                activeTab === "COMPLETED"
                  ? "bg-emerald-600 text-white"
                  : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              }`}
            >
              <CheckCircle2 size={12} />
              Đã duyệt
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("REJECTED")}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1 text-xs font-semibold transition-colors ${
                activeTab === "REJECTED"
                  ? "bg-red-700 text-white"
                  : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              }`}
            >
              <XCircle size={12} />
              Đã từ chối
            </button>
          </div>

          <div className="w-full sm:w-72">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm mã phiếu, NVGH, cửa hàng, lý do..."
              className={inputCls}
            />
          </div>
        </div>

        {/* Alerts */}
        {(error || notice) && (
          <div className="border-b border-slate-200 px-3 py-2">
            {error && (
              <div className="flex items-center gap-2 rounded border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
                <AlertTriangle size={14} className="shrink-0 text-red-600" />
                <span>{error}</span>
              </div>
            )}
            {notice && (
              <div className="flex items-center gap-2 rounded border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-800">
                <CheckCircle2 size={14} className="shrink-0 text-emerald-600" />
                <span>{notice}</span>
              </div>
            )}
          </div>
        )}

        {/* Data Table chuẩn CreateOrderForm */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead className="bg-slate-100 text-[10px] font-semibold uppercase text-slate-600">
              <tr className="border-b border-slate-200">
                <th className="px-3 py-2">Mã phiếu / Thời gian</th>
                <th className="px-3 py-2">Bên chuyển (NVGH)</th>
                <th className="px-3 py-2">Bên nhận (Cửa hàng)</th>
                <th className="px-3 py-2 text-right">Số tiền chuyển</th>
                <th className="px-3 py-2">Ảnh ký nhận (POD)</th>
                <th className="px-3 py-2">Lý do / Ghi chú</th>
                <th className="px-3 py-2 text-center">Trạng thái / Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-xs text-slate-500">
                    <Loader2 size={18} className="mx-auto animate-spin text-sky-600" />
                  </td>
                </tr>
              ) : filteredTransfers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-xs text-slate-500">
                    Không có yêu cầu chuyển công nợ nào ở trạng thái này.
                  </td>
                </tr>
              ) : (
                filteredTransfers.map((trf) => {
                  const fromP = getPartyLabel(trf.from_party_type, trf.from_party_id);
                  const toP = getPartyLabel(trf.to_party_type, trf.to_party_id);
                  return (
                    <tr
                      key={trf.id}
                      className="border-b border-slate-100 text-[11px] even:bg-amber-50/40 hover:bg-sky-50/50"
                    >
                      <td className="px-3 py-2">
                        <div className="font-mono font-bold text-[#14263d]">{trf.code}</div>
                        <div className="text-[10px] text-slate-500">{formatDateTime(trf.created_at)}</div>
                        {trf.requested_by && (
                          <div className="text-[10px] text-slate-400">Gửi bởi: {trf.requested_by}</div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-semibold text-slate-800">
                          <span className="mr-1 rounded bg-slate-200 px-1 py-0.5 text-[9px] font-bold text-slate-700">
                            {fromP.badge}
                          </span>
                          {fromP.code} {fromP.name && `- ${fromP.name}`}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          Nợ hiện tại: <strong>{formatVND(fromP.debt)}</strong>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-semibold text-slate-800">
                          <span className="mr-1 rounded bg-sky-100 px-1 py-0.5 text-[9px] font-bold text-sky-800">
                            {toP.badge}
                          </span>
                          {toP.code} {toP.name && `- ${toP.name}`}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          Nợ hiện tại: <strong>{formatVND(toP.debt)}</strong>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-bold text-sky-700">
                        {formatVND(trf.amount)}
                      </td>
                      <td className="px-3 py-2">
                        {trf.pod_image_url ? (
                          <a
                            href={trf.pod_image_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-100"
                          >
                            <Camera size={11} /> Xem POD <ExternalLink size={10} />
                          </a>
                        ) : (
                          <span className="text-[10px] italic text-slate-400">Không có ảnh</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        <div>{trf.reason || "—"}</div>
                        {trf.override_limit_reason && (
                          <div className="mt-0.5 text-[10px] font-semibold text-amber-700">
                            [Admin vượt hạn mức: {trf.override_limit_reason}]
                          </div>
                        )}
                        {trf.reject_reason && (
                          <div className="mt-0.5 text-[10px] font-semibold text-red-700">
                            [Từ chối: {trf.reject_reason}]
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {trf.status === "PENDING_APPROVAL" ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setApproveTarget(trf);
                                setOverrideReason("");
                                setError("");
                              }}
                              className="inline-flex items-center gap-1 rounded bg-sky-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-sky-700"
                            >
                              <CheckCircle2 size={12} /> Duyệt
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRejectTarget(trf);
                                setRejectReason("");
                                setError("");
                              }}
                              className="inline-flex items-center gap-1 rounded bg-red-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-red-800"
                            >
                              <XCircle size={12} /> Từ chối
                            </button>
                          </div>
                        ) : trf.status === "COMPLETED" ? (
                          <div>
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                              <CheckCircle2 size={11} /> Đã duyệt
                            </span>
                            {trf.approved_by && (
                              <div className="mt-0.5 text-[10px] text-slate-500">
                                Bởi {trf.approved_by}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div>
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-800">
                              <XCircle size={11} /> Đã từ chối
                            </span>
                            {trf.rejected_by && (
                              <div className="mt-0.5 text-[10px] text-slate-500">
                                Bởi {trf.rejected_by}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            <tfoot className="border-t border-slate-200 bg-slate-50 text-[10px] font-semibold text-slate-600">
              <tr>
                <td colSpan={3} className="px-3 py-2">
                  Tổng cộng: {filteredTransfers.length} phiếu
                </td>
                <td className="px-3 py-2 text-right font-bold text-slate-800">
                  {formatVND(filteredTransfers.reduce((s, t) => s + Number(t.amount || 0), 0))}
                </td>
                <td colSpan={3} className="px-3 py-2" />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Modal Duyệt chuyển công nợ (chuẩn CreateOrderForm) */}
      {approveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3">
          <div className="w-full max-w-lg overflow-hidden border border-slate-400 bg-white shadow-2xl">
            <header className="flex items-center justify-between bg-[#14263d] px-3 py-2 text-white">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={17} className="text-red-500" />
                <h2 className="text-xs font-bold uppercase tracking-wide text-white">
                  Xác Nhận Duyệt Chuyển Công Nợ · {approveTarget.code}
                </h2>
              </div>
              <button
                type="button"
                disabled={submitting}
                onClick={() => setApproveTarget(null)}
                className="rounded p-1 text-white hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </header>

            <div className="space-y-2.5 px-3 py-3 text-xs">
              <div className="flex items-center justify-between rounded border border-sky-200 bg-sky-50/70 px-3 py-2">
                <div>
                  <div className="text-[10px] text-slate-500">Bên chuyển</div>
                  <div className="font-bold text-slate-800">
                    {getPartyLabel(approveTarget.from_party_type, approveTarget.from_party_id).code}
                  </div>
                </div>
                <ArrowRight size={16} className="text-sky-600" />
                <div>
                  <div className="text-[10px] text-slate-500">Bên nhận</div>
                  <div className="font-bold text-slate-800">
                    {getPartyLabel(approveTarget.to_party_type, approveTarget.to_party_id).code}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-slate-500">Số tiền</div>
                  <div className="font-bold text-sky-700">{formatVND(approveTarget.amount)}</div>
                </div>
              </div>

              {approveTarget.pod_image_url && (
                <div className="rounded border border-slate-200 bg-slate-50 p-2">
                  <div className="mb-1 text-[10px] font-semibold text-slate-600">
                    Chứng từ ký nhận (POD):
                  </div>
                  <a
                    href={approveTarget.pod_image_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 break-all text-xs font-semibold text-indigo-700 underline"
                  >
                    {approveTarget.pod_image_url} <ExternalLink size={11} />
                  </a>
                </div>
              )}

              <div>
                <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                  Lý do duyệt vượt hạn mức (Chỉ nhập nếu Cửa hàng vượt hạn mức &amp; bạn là Admin)
                </label>
                <input
                  type="text"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Để trống nếu Cửa hàng còn trong hạn mức công nợ..."
                  className={inputCls}
                />
              </div>
            </div>

            <footer className="flex items-center justify-between gap-3 border-t border-slate-300 bg-slate-100 px-3 py-2">
              <span className="text-[10px] text-slate-500">
                Duyệt sẽ tự động ghi bút toán TRANSFER_OUT / TRANSFER_IN trên sổ cái.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setApproveTarget(null)}
                  className="rounded bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800"
                >
                  Đóng
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleConfirmApprove()}
                  className="inline-flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:bg-slate-300"
                >
                  {submitting ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                  Xác nhận Duyệt
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}

      {/* Modal Từ chối chuyển công nợ (chuẩn CreateOrderForm) */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3">
          <div className="w-full max-w-md overflow-hidden border border-slate-400 bg-white shadow-2xl">
            <header className="flex items-center justify-between bg-[#14263d] px-3 py-2 text-white">
              <div className="flex items-center gap-2">
                <XCircle size={17} className="text-red-500" />
                <h2 className="text-xs font-bold uppercase tracking-wide text-white">
                  Từ Chối Chuyển Công Nợ · {rejectTarget.code}
                </h2>
              </div>
              <button
                type="button"
                disabled={submitting}
                onClick={() => setRejectTarget(null)}
                className="rounded p-1 text-white hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </header>

            <div className="space-y-2 px-3 py-3">
              <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                Lý do từ chối <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="VD: Ảnh POD bị mờ, thiếu chữ ký xác nhận của chủ cửa hàng..."
                className={inputCls}
              />
            </div>

            <footer className="flex items-center justify-between gap-3 border-t border-slate-300 bg-slate-100 px-3 py-2">
              <span className="text-[10px] text-slate-500">
                Công nợ sẽ giữ nguyên trên NV Giao hàng.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setRejectTarget(null)}
                  className="rounded bg-slate-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
                >
                  Đóng
                </button>
                <button
                  type="button"
                  disabled={submitting || !rejectReason.trim()}
                  onClick={() => void handleConfirmReject()}
                  className="inline-flex items-center gap-1.5 rounded bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800 disabled:bg-slate-300"
                >
                  {submitting ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />}
                  Xác nhận Từ chối
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

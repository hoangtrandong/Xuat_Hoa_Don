"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRightLeft,
  Banknote,
  BookOpen,
  CheckCircle2,
  Clock3,
  Loader2,
  Receipt,
  RefreshCw,
  Search,
  Store,
  Users,
  Wallet,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import Badge from "@/components/ui/Badge";
import CashReceiptModal, {
  type CashReceiptTarget,
} from "@/components/finance/CashReceiptModal";
import DebtLedgerModal, {
  type DebtLedgerParty,
} from "@/components/finance/DebtLedgerModal";
import { API_URL, apiFetch } from "@/lib/api";
import { formatDateTime, formatVNDFull } from "@/lib/format";

interface EmployeeDebtSummary {
  employee_id: number;
  code: string;
  vinamilk_code: string | null;
  name: string;
  phone: string | null;
  position: string | null;
  status: string;
  debt_limit: number;
  current_debt: number;
  pending_delivery_debt: number;
  projected_debt: number;
  total_debit: number;
  total_credit: number;
  is_over_limit: boolean;
  last_active_at: string | null;
}

interface StoreDebtSummary {
  store_id: number;
  code: string;
  name: string;
  phone: string | null;
  owner_name: string | null;
  address: string | null;
  city: string | null;
  customer_count: number;
  current_debt: number;
  total_debit: number;
  total_credit: number;
  last_active_at: string | null;
}

interface CashReceiptItem {
  id: number;
  code: string;
  party_type: "EMPLOYEE" | "STORE" | string;
  party_id: number;
  party_code: string | null;
  party_name: string | null;
  settlement_date: string | null;
  amount: number;
  receipt_date: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

type MainTab = "EMPLOYEES" | "STORES" | "RECEIPTS";
type QuickFilter = "ALL" | "IN_DEBT" | "OVER_LIMIT";

export default function FinanceDebtsPage() {
  const [activeTab, setActiveTab] = useState<MainTab>("EMPLOYEES");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("ALL");
  const [search, setSearch] = useState("");

  const [employeeDebts, setEmployeeDebts] = useState<EmployeeDebtSummary[]>([]);
  const [storeDebts, setStoreDebts] = useState<StoreDebtSummary[]>([]);
  const [cashReceipts, setCashReceipts] = useState<CashReceiptItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const [ledgerParty, setLedgerParty] = useState<DebtLedgerParty | null>(null);
  const [receiptTarget, setReceiptTarget] = useState<CashReceiptTarget | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [empRes, storeRes, recRes] = await Promise.all([
        apiFetch(`${API_URL}/employee-debts`),
        apiFetch(`${API_URL}/store-debts`),
        apiFetch(`${API_URL}/cash-receipts?limit=150`),
      ]);
      if (!empRes.ok) throw new Error("Không thể tải công nợ nhân viên.");
      if (!storeRes.ok) throw new Error("Không thể tải công nợ khách hàng / cửa hàng.");
      const [empData, storeData, recData] = await Promise.all([
        empRes.json() as Promise<EmployeeDebtSummary[]>,
        storeRes.json() as Promise<StoreDebtSummary[]>,
        recRes.ok ? (recRes.json() as Promise<CashReceiptItem[]>) : Promise.resolve([]),
      ]);
      setEmployeeDebts(empData);
      setStoreDebts(storeData);
      setCashReceipts(recData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi tải dữ liệu công nợ.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const empStats = useMemo(() => {
    const totalDebt = employeeDebts.reduce((s, e) => s + Math.max(0, Number(e.current_debt || 0)), 0);
    const totalPending = employeeDebts.reduce(
      (s, e) => s + Math.max(0, Number(e.pending_delivery_debt || 0)),
      0
    );
    const inDebtCount = employeeDebts.filter((e) => Number(e.current_debt || 0) > 0.01).length;
    const overLimitCount = employeeDebts.filter((e) => e.is_over_limit).length;
    return { totalDebt, totalPending, inDebtCount, overLimitCount };
  }, [employeeDebts]);

  const storeStats = useMemo(() => {
    const totalDebt = storeDebts.reduce((s, st) => s + Math.max(0, Number(st.current_debt || 0)), 0);
    const inDebtCount = storeDebts.filter((st) => Number(st.current_debt || 0) > 0.01).length;
    const totalDebit = storeDebts.reduce((s, st) => s + Number(st.total_debit || 0), 0);
    const totalCredit = storeDebts.reduce((s, st) => s + Number(st.total_credit || 0), 0);
    return { totalDebt, inDebtCount, totalDebit, totalCredit };
  }, [storeDebts]);

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employeeDebts
      .filter((e) => {
        if (quickFilter === "IN_DEBT" && Number(e.current_debt || 0) <= 0.01) return false;
        if (quickFilter === "OVER_LIMIT" && !e.is_over_limit) return false;
        if (!q) return true;
        return (
          (e.code || "").toLowerCase().includes(q) ||
          (e.name || "").toLowerCase().includes(q) ||
          (e.phone || "").toLowerCase().includes(q) ||
          (e.vinamilk_code || "").toLowerCase().includes(q) ||
          (e.position || "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => Number(b.current_debt || 0) - Number(a.current_debt || 0));
  }, [employeeDebts, quickFilter, search]);

  const filteredStores = useMemo(() => {
    const q = search.trim().toLowerCase();
    return storeDebts
      .filter((st) => {
        if (quickFilter === "IN_DEBT" && Number(st.current_debt || 0) <= 0.01) return false;
        if (!q) return true;
        return (
          (st.code || "").toLowerCase().includes(q) ||
          (st.name || "").toLowerCase().includes(q) ||
          (st.owner_name || "").toLowerCase().includes(q) ||
          (st.phone || "").toLowerCase().includes(q) ||
          (st.address || "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => Number(b.current_debt || 0) - Number(a.current_debt || 0));
  }, [storeDebts, quickFilter, search]);

  const filteredReceipts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cashReceipts.filter((r) => {
      if (!q) return true;
      return (
        (r.code || "").toLowerCase().includes(q) ||
        (r.party_code || "").toLowerCase().includes(q) ||
        (r.party_name || "").toLowerCase().includes(q) ||
        (r.note || "").toLowerCase().includes(q) ||
        (r.created_by || "").toLowerCase().includes(q)
      );
    });
  }, [cashReceipts, search]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Quản lý Công nợ Nhân viên & Khách hàng"
        subtitle="Theo dõi dư nợ xuất kho giao hàng của NVGH, công nợ cửa hàng/khách hàng, sổ cái Nợ/Có và lập phiếu thu tiền mặt"
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/admin/debt-transfers"
              className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <ArrowRightLeft size={13} />
              Duyệt chuyển công nợ (POD)
            </Link>
            <button
              type="button"
              onClick={() => void loadAll()}
              className="inline-flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              Làm mới
            </button>
          </div>
        }
      />

      {toast && (
        <div className="flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
          <CheckCircle2 size={15} className="shrink-0 text-emerald-600" />
          <span>{toast}</span>
        </div>
      )}

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* KPI Cards */}
      {activeTab === "STORES" ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="Tổng dư nợ Khách hàng / CH"
            value={formatVNDFull(storeStats.totalDebt)}
            icon={<Store size={20} />}
            color="bg-rose-50 text-rose-600"
          />
          <StatCard
            label="Cửa hàng đang có công nợ"
            value={storeStats.inDebtCount}
            icon={<Users size={20} />}
            color="bg-amber-50 text-amber-600"
          />
          <StatCard
            label="Tổng phát sinh nợ (+)"
            value={formatVNDFull(storeStats.totalDebit)}
            icon={<Wallet size={20} />}
            color="bg-sky-50 text-sky-600"
          />
          <StatCard
            label="Tổng đã thanh toán (-)"
            value={formatVNDFull(storeStats.totalCredit)}
            icon={<CheckCircle2 size={20} />}
            color="bg-emerald-50 text-emerald-600"
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="Tổng dư nợ NVGH hiện tại"
            value={formatVNDFull(empStats.totalDebt)}
            icon={<Wallet size={20} />}
            color="bg-rose-50 text-rose-600"
          />
          <StatCard
            label="Công nợ đang chờ xuất kho"
            value={formatVNDFull(empStats.totalPending)}
            icon={<Clock3 size={20} />}
            color="bg-amber-50 text-amber-600"
          />
          <StatCard
            label="NVGH đang có công nợ"
            value={empStats.inDebtCount}
            icon={<Users size={20} />}
            color="bg-sky-50 text-sky-600"
          />
          <StatCard
            label="NVGH vượt hạn mức nợ"
            value={empStats.overLimitCount}
            icon={<AlertTriangle size={20} />}
            color={empStats.overLimitCount > 0 ? "bg-red-100 text-red-700" : "bg-emerald-50 text-emerald-600"}
          />
        </div>
      )}

      {/* Tabs + Filter bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-slate-200 bg-slate-100 p-0.5">
            <button
              type="button"
              onClick={() => {
                setActiveTab("EMPLOYEES");
                setQuickFilter("ALL");
              }}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === "EMPLOYEES"
                  ? "bg-[#14263d] text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Users size={13} />
              Công nợ Nhân viên ({employeeDebts.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab("STORES");
                setQuickFilter("ALL");
              }}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === "STORES"
                  ? "bg-[#14263d] text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Store size={13} />
              Công nợ Khách hàng / CH ({storeDebts.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab("RECEIPTS");
                setQuickFilter("ALL");
              }}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === "RECEIPTS"
                  ? "bg-[#14263d] text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Receipt size={13} />
              Phiếu thu tiền mặt ({cashReceipts.length})
            </button>
          </div>

          {activeTab !== "RECEIPTS" && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setQuickFilter("ALL")}
                className={`rounded px-2 py-1 text-[11px] font-semibold ${
                  quickFilter === "ALL"
                    ? "bg-sky-100 text-sky-800"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                Tất cả
              </button>
              <button
                type="button"
                onClick={() => setQuickFilter("IN_DEBT")}
                className={`rounded px-2 py-1 text-[11px] font-semibold ${
                  quickFilter === "IN_DEBT"
                    ? "bg-rose-100 text-rose-800"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                Đang có nợ
              </button>
              {activeTab === "EMPLOYEES" && (
                <button
                  type="button"
                  onClick={() => setQuickFilter("OVER_LIMIT")}
                  className={`rounded px-2 py-1 text-[11px] font-semibold ${
                    quickFilter === "OVER_LIMIT"
                      ? "bg-red-600 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  Vượt hạn mức ({empStats.overLimitCount})
                </button>
              )}
            </div>
          )}
        </div>

        <div className="relative w-full sm:w-72">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              activeTab === "EMPLOYEES"
                ? "Tìm mã NV, tên NV, SĐT..."
                : activeTab === "STORES"
                ? "Tìm mã CH, tên CH, chủ CH, SĐT..."
                : "Tìm mã phiếu thu, đối tượng, ghi chú..."
            }
            className="w-full rounded border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
        </div>
      </div>

      {/* Main Data Table */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          {activeTab === "EMPLOYEES" && (
            <table className="w-full border-collapse text-left">
              <thead className="bg-slate-100 text-[10px] font-semibold uppercase text-slate-600">
                <tr>
                  <th className="px-3 py-2">Nhân viên</th>
                  <th className="px-3 py-2">Chức vụ / SĐT</th>
                  <th className="px-3 py-2 text-right">Phát sinh nợ (+)</th>
                  <th className="px-3 py-2 text-right">Đã thu / Trả (-)</th>
                  <th className="px-3 py-2 text-right">Chờ xuất kho</th>
                  <th className="px-3 py-2 text-right">Dư nợ hiện tại</th>
                  <th className="px-3 py-2">Hạn mức công nợ</th>
                  <th className="px-3 py-2 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-xs text-slate-500">
                      <Loader2 size={16} className="mr-1.5 inline animate-spin text-sky-600" />
                      Đang tải công nợ nhân viên...
                    </td>
                  </tr>
                ) : filteredEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-xs text-slate-400">
                      Không có nhân viên nào phù hợp bộ lọc.
                    </td>
                  </tr>
                ) : (
                  filteredEmployees.map((emp) => {
                    const pct =
                      emp.debt_limit > 0
                        ? Math.min(100, Math.round((Math.max(0, emp.projected_debt) / emp.debt_limit) * 100))
                        : 0;
                    return (
                      <tr
                        key={emp.employee_id}
                        className="border-b border-slate-100 text-[11px] even:bg-amber-50/40 hover:bg-sky-50/50"
                      >
                        <td className="px-3 py-2">
                          <div className="font-bold text-slate-800">
                            {emp.code} · {emp.name}
                          </div>
                          {emp.vinamilk_code && (
                            <div className="text-[10px] text-slate-500">
                              DMS: {emp.vinamilk_code}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-600">
                          <div>{emp.position || "—"}</div>
                          <div className="text-[10px] text-slate-400">{emp.phone || "—"}</div>
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-slate-700">
                          {formatVNDFull(emp.total_debit)}
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-emerald-700">
                          {formatVNDFull(emp.total_credit)}
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-amber-700">
                          {emp.pending_delivery_debt > 0
                            ? formatVNDFull(emp.pending_delivery_debt)
                            : "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <span
                            className={`font-bold ${
                              emp.current_debt > 0 ? "text-rose-600" : "text-emerald-700"
                            }`}
                          >
                            {formatVNDFull(emp.current_debt)}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-between gap-2 text-[10px]">
                            <span className="text-slate-600">{formatVNDFull(emp.debt_limit)}</span>
                            {emp.is_over_limit && <Badge variant="danger">Vượt HM</Badge>}
                          </div>
                          <div className="mt-1 h-1.5 w-28 overflow-hidden rounded-full bg-slate-200">
                            <div
                              className={`h-full ${
                                emp.is_over_limit
                                  ? "bg-red-600"
                                  : pct >= 80
                                  ? "bg-amber-500"
                                  : "bg-sky-500"
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                setLedgerParty({
                                  partyType: "EMPLOYEE",
                                  partyId: emp.employee_id,
                                  code: emp.code,
                                  name: emp.name,
                                  currentDebt: emp.current_debt,
                                  totalDebit: emp.total_debit,
                                  totalCredit: emp.total_credit,
                                })
                              }
                              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              <BookOpen size={12} />
                              Sổ cái
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setReceiptTarget({
                                  partyType: "EMPLOYEE",
                                  partyId: emp.employee_id,
                                  code: emp.code,
                                  name: emp.name,
                                  currentDebt: emp.current_debt,
                                })
                              }
                              className="inline-flex items-center gap-1 rounded bg-sky-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-sky-700"
                            >
                              <Banknote size={12} />
                              Thu tiền
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}

          {activeTab === "STORES" && (
            <table className="w-full border-collapse text-left">
              <thead className="bg-slate-100 text-[10px] font-semibold uppercase text-slate-600">
                <tr>
                  <th className="px-3 py-2">Khách hàng / Cửa hàng</th>
                  <th className="px-3 py-2">Chủ CH / SĐT</th>
                  <th className="px-3 py-2">Địa chỉ</th>
                  <th className="px-3 py-2 text-right">Phát sinh nợ (+)</th>
                  <th className="px-3 py-2 text-right">Đã thanh toán (-)</th>
                  <th className="px-3 py-2 text-right">Dư nợ hiện tại</th>
                  <th className="px-3 py-2">Cập nhật gần nhất</th>
                  <th className="px-3 py-2 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-xs text-slate-500">
                      <Loader2 size={16} className="mr-1.5 inline animate-spin text-sky-600" />
                      Đang tải công nợ khách hàng / cửa hàng...
                    </td>
                  </tr>
                ) : filteredStores.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-xs text-slate-400">
                      Không có cửa hàng / khách hàng nào phù hợp bộ lọc.
                    </td>
                  </tr>
                ) : (
                  filteredStores.map((st) => (
                    <tr
                      key={st.store_id}
                      className="border-b border-slate-100 text-[11px] even:bg-amber-50/40 hover:bg-sky-50/50"
                    >
                      <td className="px-3 py-2">
                        <div className="font-bold text-slate-800">
                          {st.code} · {st.name}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {st.customer_count} mã KH liên kết
                        </div>
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        <div>{st.owner_name || "—"}</div>
                        <div className="text-[10px] text-slate-400">{st.phone || "—"}</div>
                      </td>
                      <td className="max-w-[220px] truncate px-3 py-2 text-slate-600">
                        {st.address || st.city || "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-slate-700">
                        {formatVNDFull(st.total_debit)}
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-emerald-700">
                        {formatVNDFull(st.total_credit)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span
                          className={`font-bold ${
                            st.current_debt > 0 ? "text-rose-600" : "text-emerald-700"
                          }`}
                        >
                          {formatVNDFull(st.current_debt)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[10px] text-slate-500">
                        {st.last_active_at ? formatDateTime(st.last_active_at) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              setLedgerParty({
                                partyType: "STORE",
                                partyId: st.store_id,
                                code: st.code,
                                name: st.name,
                                currentDebt: st.current_debt,
                                totalDebit: st.total_debit,
                                totalCredit: st.total_credit,
                              })
                            }
                            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            <BookOpen size={12} />
                            Sổ cái
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setReceiptTarget({
                                partyType: "STORE",
                                partyId: st.store_id,
                                code: st.code,
                                name: st.name,
                                currentDebt: st.current_debt,
                              })
                            }
                            className="inline-flex items-center gap-1 rounded bg-sky-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-sky-700"
                          >
                            <Banknote size={12} />
                            Thu tiền
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {activeTab === "RECEIPTS" && (
            <table className="w-full border-collapse text-left">
              <thead className="bg-slate-100 text-[10px] font-semibold uppercase text-slate-600">
                <tr>
                  <th className="px-3 py-2">Mã phiếu thu</th>
                  <th className="px-3 py-2">Phân loại</th>
                  <th className="px-3 py-2">Đối tượng nộp</th>
                  <th className="px-3 py-2 text-right">Số tiền thu</th>
                  <th className="px-3 py-2">Ghi chú</th>
                  <th className="px-3 py-2">Người thu</th>
                  <th className="px-3 py-2">Thời điểm</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-xs text-slate-500">
                      <Loader2 size={16} className="mr-1.5 inline animate-spin text-sky-600" />
                      Đang tải danh sách phiếu thu...
                    </td>
                  </tr>
                ) : filteredReceipts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-xs text-slate-400">
                      Chưa có phiếu thu tiền mặt nào.
                    </td>
                  </tr>
                ) : (
                  filteredReceipts.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-slate-100 text-[11px] even:bg-amber-50/40 hover:bg-sky-50/50"
                    >
                      <td className="px-3 py-2 font-mono font-bold text-slate-800">{r.code}</td>
                      <td className="px-3 py-2">
                        {r.party_type === "EMPLOYEE" ? (
                          <Badge variant="info">Nhân viên</Badge>
                        ) : (
                          <Badge variant="success">Cửa hàng</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-800">
                        {r.party_code ? `${r.party_code} · ` : ""}
                        {r.party_name || `#${r.party_id}`}
                      </td>
                      <td className="px-3 py-2 text-right font-bold text-emerald-700">
                        {formatVNDFull(r.amount)}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{r.note || "—"}</td>
                      <td className="px-3 py-2 text-[10px] text-slate-500">
                        {r.created_by || "—"}
                      </td>
                      <td className="px-3 py-2 text-[10px] text-slate-500">
                        {formatDateTime(r.receipt_date || r.created_at)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Modal Sổ cái công nợ chi tiết */}
      <DebtLedgerModal
        party={ledgerParty}
        onClose={() => setLedgerParty(null)}
        onOpenCashReceipt={(target) => {
          setLedgerParty(null);
          setReceiptTarget(target);
        }}
      />

      {/* Modal Lập phiếu thu tiền mặt */}
      <CashReceiptModal
        target={receiptTarget}
        onClose={() => setReceiptTarget(null)}
        onCreated={(msg) => {
          setToast(msg);
          void loadAll();
        }}
      />
    </div>
  );
}

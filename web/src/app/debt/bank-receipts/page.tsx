"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Banknote,
  Receipt,
  Plus,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Trash2,
  Zap,
  History,
  X,
  CreditCard,
  Search,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import Badge from "@/components/ui/Badge";
import Drawer from "@/components/ui/Drawer";
import { formatVND, formatDateTime } from "@/lib/format";
import { API_URL, apiFetch } from "@/lib/api";

interface PaymentAllocationItem {
  id: number;
  code: string;
  bank_receipt_id: number;
  order_id: number | null;
  order_number: string | null;
  employee_id: number | null;
  employee_code: string | null;
  employee_name: string | null;
  store_id: number | null;
  settlement_date: string | null;
  amount: number;
  allocation_date: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

interface BankReceipt {
  id: number;
  code: string;
  bank_name: string | null;
  account_number: string | null;
  ref_number: string | null;
  transaction_date: string;
  party_type: string;
  store_id: number | null;
  store_code: string | null;
  store_name: string | null;
  customer_id: number | null;
  amount: number;
  allocated_amount: number;
  unallocated_amount: number;
  status: "UNALLOCATED" | "PARTIALLY_ALLOCATED" | "FULLY_ALLOCATED";
  description: string | null;
  created_by: string | null;
  created_at: string;
  allocations: PaymentAllocationItem[];
}

interface AllocatableEmployeeDay {
  employee_id: number;
  employee_code: string;
  employee_name: string | null;
  settlement_date: string;
  allocated_amount: number;
  paid_bank: number;
  remaining_employee_debt: number;
}

interface AllocatableStoreDebt {
  store_id: number;
  store_code: string;
  store_name: string;
  remaining_store_debt: number;
}

interface StoreOption {
  id: number;
  code: string;
  name: string;
}

function statusBadge(status: string) {
  switch (status) {
    case "FULLY_ALLOCATED":
      return <Badge variant="success">Đã phân bổ đủ</Badge>;
    case "PARTIALLY_ALLOCATED":
      return <Badge variant="warning">Đang phân bổ</Badge>;
    default:
      return <Badge variant="danger">Chờ phân bổ</Badge>;
  }
}

export default function BankReceiptsPage() {
  const [receipts, setReceipts] = useState<BankReceipt[]>([]);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Filters
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [storeFilter, setStoreFilter] = useState("");

  // Add receipt modal state
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addStoreId, setAddStoreId] = useState<number | "">("");
  const [addStoreSearch, setAddStoreSearch] = useState("");
  const [addBankName, setAddBankName] = useState("Vietcombank");
  const [addRefNumber, setAddRefNumber] = useState("");
  const [addAmount, setAddAmount] = useState<number | "">("");
  const [addDate, setAddDate] = useState(() => new Date().toISOString().slice(0, 16));
  const [addDescription, setAddDescription] = useState("");
  const [submittingAdd, setSubmittingAdd] = useState(false);

  const filteredModalStores = useMemo(() => {
    if (!addStoreSearch.trim()) return stores;
    const q = addStoreSearch.trim().toLowerCase();
    return stores.filter((s) => s.code.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
  }, [stores, addStoreSearch]);

  // Allocate modal state
  const [allocateModalOpen, setAllocateModalOpen] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState<BankReceipt | null>(null);
  const [allocatableEmployeeDays, setAllocatableEmployeeDays] = useState<AllocatableEmployeeDay[]>([]);
  const [allocatableStoreDebt, setAllocatableStoreDebt] = useState<AllocatableStoreDebt | null>(null);
  const [allocationMode, setAllocationMode] = useState<"EMPLOYEE_DAY" | "STORE">("EMPLOYEE_DAY");
  const [allocationLoadError, setAllocationLoadError] = useState("");
  const [allocAmounts, setAllocAmounts] = useState<Record<string, number>>({});
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [submittingAlloc, setSubmittingAlloc] = useState(false);

  // History Drawer state
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [historyReceipt, setHistoryReceipt] = useState<BankReceipt | null>(null);

  const fetchData = useCallback(async () => {
      const [receiptsRes, storesRes] = await Promise.all([
        apiFetch(`${API_URL}/bank-receipts`),
        apiFetch(`${API_URL}/stores?limit=5000`),
      ]);
      if (!receiptsRes.ok) throw new Error("Không thể tải danh sách phiếu chuyển khoản.");
      if (!storesRes.ok) throw new Error("Không thể tải danh sách cửa hàng.");

      const receiptsData = await receiptsRes.json();
      const storesData = await storesRes.json();
      return { receipts: receiptsData as BankReceipt[], stores: storesData as StoreOption[] };
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchData();
      setReceipts(data.receipts);
      setStores(data.stores);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
    } finally {
      setLoading(false);
    }
  }, [fetchData]);

  useEffect(() => {
    let active = true;
    void fetchData()
      .then((data) => {
        if (!active) return;
        setReceipts(data.receipts);
        setStores(data.stores);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fetchData]);

  const filteredReceipts = useMemo(() => {
    return receipts.filter((r) => {
      if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
      if (storeFilter && String(r.store_id) !== storeFilter) return false;
      return true;
    });
  }, [receipts, statusFilter, storeFilter]);

  const stats = useMemo(() => {
    return receipts.reduce(
      (acc, r) => ({
        totalAmount: acc.totalAmount + r.amount,
        allocatedAmount: acc.allocatedAmount + r.allocated_amount,
        unallocatedAmount: acc.unallocatedAmount + r.unallocated_amount,
        unallocatedCount: acc.unallocatedCount + (r.status !== "FULLY_ALLOCATED" ? 1 : 0),
      }),
      { totalAmount: 0, allocatedAmount: 0, unallocatedAmount: 0, unallocatedCount: 0 }
    );
  }, [receipts]);

  // Open allocate modal
  async function handleOpenAllocate(receipt: BankReceipt) {
    setSelectedReceipt(receipt);
    setAllocAmounts({});
    setAllocatableEmployeeDays([]);
    setAllocatableStoreDebt(null);
    setAllocationMode("EMPLOYEE_DAY");
    setAllocationLoadError("");
    setAllocateModalOpen(true);
    setLoadingOrders(true);
    try {
      const [employeeDaysRes, storeDebtRes] = await Promise.all([
        apiFetch(`${API_URL}/bank-receipts/${receipt.id}/allocatable-employee-days`),
        apiFetch(`${API_URL}/bank-receipts/${receipt.id}/allocatable-store-debt`),
      ]);
      if (!employeeDaysRes.ok) {
        const result = await employeeDaysRes.json();
        throw new Error(result.detail || "Không thể tải công nợ ngày/nhân viên của cửa hàng.");
      }
      if (!storeDebtRes.ok) {
        const result = await storeDebtRes.json();
        throw new Error(result.detail || "Không thể tải công nợ cửa hàng.");
      }
      const targets: AllocatableEmployeeDay[] = await employeeDaysRes.json();
      const storeDebt: AllocatableStoreDebt | null = await storeDebtRes.json();
      setAllocatableEmployeeDays(targets);
      setAllocatableStoreDebt(storeDebt);
    } catch (err) {
      setAllocationLoadError(err instanceof Error ? err.message : "Lỗi tải công nợ để phân bổ.");
    } finally {
      setLoadingOrders(false);
    }
  }

  function handleAutoAllocate() {
    if (!selectedReceipt || allocationMode !== "EMPLOYEE_DAY") return;
    let budget = selectedReceipt.unallocated_amount;
    const newAmounts: Record<string, number> = {};

    for (const target of [...allocatableEmployeeDays].sort((a, b) =>
      a.settlement_date.localeCompare(b.settlement_date) ||
      a.employee_code.localeCompare(b.employee_code)
    )) {
      if (budget <= 0.01) break;
      const key = `${target.settlement_date}:${target.employee_id}`;
      const take = Math.min(target.remaining_employee_debt, budget);
      if (take > 0) {
        newAmounts[key] = take;
        budget -= take;
      }
    }
    setAllocAmounts(newAmounts);
  }

  const currentTotalAllocating = useMemo(() => {
    return Object.values(allocAmounts).reduce((sum, v) => sum + (Number(v) || 0), 0);
  }, [allocAmounts]);

  async function handleConfirmAllocate() {
    if (!selectedReceipt) return;
    const allocationsToSubmit: Array<{
      employee_id?: number;
      settlement_date?: string;
      store_id?: number;
      amount: number;
    }> = Object.entries(allocAmounts)
      .filter(([key]) => key !== "STORE")
      .map(([key, amount]) => {
        const [settlement_date, employeeId] = key.split(":");
        return {
          employee_id: Number(employeeId),
          settlement_date,
          amount: Number(amount) || 0,
        };
      })
      .filter((a) => a.amount > 0);
    if (allocationMode === "STORE" && allocatableStoreDebt) {
      const amount = allocAmounts.STORE ?? 0;
      if (amount > 0) {
        allocationsToSubmit.push({
          store_id: allocatableStoreDebt.store_id,
          amount,
        });
      }
    }

    if (allocationsToSubmit.length === 0) {
      alert("Vui lòng chọn ít nhất một nhân viên/ngày và nhập số tiền phân bổ.");
      return;
    }

    setSubmittingAlloc(true);
    try {
      const res = await apiFetch(`${API_URL}/bank-receipts/${selectedReceipt.id}/allocate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allocations: allocationsToSubmit }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Không thể phân bổ khoản chuyển tiền.");
      }
      setMessage(`Đã phân bổ thành công ${formatVND(currentTotalAllocating)} theo nhân viên/ngày.`);
      setAllocateModalOpen(false);
      await loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Lỗi phân bổ.");
    } finally {
      setSubmittingAlloc(false);
    }
  }

  async function handleCreateReceipt(e: React.FormEvent) {
    e.preventDefault();
    if (!addStoreId) {
      alert("Vui lòng chọn Cửa hàng chuyển tiền.");
      return;
    }
    if (!addAmount || Number(addAmount) <= 0) {
      alert("Số tiền chuyển khoản phải lớn hơn 0.");
      return;
    }

    setSubmittingAdd(true);
    try {
      const res = await apiFetch(`${API_URL}/bank-receipts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_id: Number(addStoreId),
          bank_name: addBankName,
          ref_number: addRefNumber || undefined,
          amount: Number(addAmount),
          transaction_date: addDate ? new Date(addDate).toISOString() : undefined,
          description: addDescription || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Không thể tạo phiếu chuyển khoản.");
      }
      setAddModalOpen(false);
      setAddAmount("");
      setAddRefNumber("");
      setAddDescription("");
      setMessage("Đã ghi nhận khoản tiền chuyển khoản mới thành công.");
      await loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Lỗi tạo phiếu.");
    } finally {
      setSubmittingAdd(false);
    }
  }

  async function handleCancelAlloc(receiptId: number, allocationId: number) {
    if (!confirm("Bạn có chắc chắn muốn hủy dòng phân bổ này? Công nợ liên quan sẽ được phục hồi.")) return;
    try {
      const res = await apiFetch(`${API_URL}/bank-receipts/${receiptId}/allocations/${allocationId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Không thể hủy phân bổ.");
      }
      setMessage("Đã hủy phân bổ thành công.");
      await loadData();
      if (historyReceipt && historyReceipt.id === receiptId) {
        const updated = await apiFetch(`${API_URL}/bank-receipts/${receiptId}`);
        if (updated.ok) {
          setHistoryReceipt(await updated.json());
        }
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Lỗi hủy phân bổ.");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Thu chuyển khoản & Phân bổ"
        subtitle="Xác nhận tiền cửa hàng chuyển khoản và phân bổ giảm công nợ theo ngày / nhân viên"
        actions={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void loadData()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
              Làm mới
            </button>
            <button
              type="button"
              onClick={() => setAddModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 shadow-sm"
            >
              <Plus size={16} />
              Thêm khoản chuyển khoản
            </button>
          </div>
        }
      />

      {message && (
        <div className="flex items-center justify-between rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} />
            {message}
          </div>
          <button type="button" onClick={() => setMessage("")} className="text-emerald-600 hover:text-emerald-900">
            <X size={16} />
          </button>
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard
          label="Tổng tiền chuyển về"
          value={formatVND(stats.totalAmount)}
          icon={<Banknote size={20} />}
          color="bg-sky-50 text-sky-600"
        />
        <StatCard
          label="Đã phân bổ giảm công nợ"
          value={formatVND(stats.allocatedAmount)}
          icon={<Receipt size={20} />}
          color="bg-emerald-50 text-emerald-600"
        />
        <StatCard
          label="Tiền chờ phân bổ (Treo)"
          value={formatVND(stats.unallocatedAmount)}
          icon={<Clock size={20} />}
          color="bg-amber-50 text-amber-600"
        />
        <StatCard
          label="Món tiền còn treo"
          value={stats.unallocatedCount}
          icon={<CreditCard size={20} />}
          color="bg-purple-50 text-purple-600"
        />
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
        <label className="text-sm text-gray-600">
          Trạng thái
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="mt-1 block rounded-lg border border-gray-200 px-3 py-2 text-sm"
          >
            <option value="ALL">Tất cả trạng thái</option>
            <option value="UNALLOCATED">Chờ phân bổ</option>
            <option value="PARTIALLY_ALLOCATED">Đang phân bổ</option>
            <option value="FULLY_ALLOCATED">Đã phân bổ đủ</option>
          </select>
        </label>
        <label className="text-sm text-gray-600">
          Cửa hàng
          <select
            value={storeFilter}
            onChange={(e) => setStoreFilter(e.target.value)}
            className="mt-1 block min-w-56 rounded-lg border border-gray-200 px-3 py-2 text-sm"
          >
            <option value="">Tất cả cửa hàng</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} - {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Main Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left">Mã phiếu</th>
              <th className="px-4 py-3 text-left">Ngày GD</th>
              <th className="px-4 py-3 text-left">Cửa hàng chuyển</th>
              <th className="px-4 py-3 text-left">Ngân hàng / Mã GD</th>
              <th className="px-4 py-3 text-right">Tổng tiền</th>
              <th className="px-4 py-3 text-right">Đã phân bổ</th>
              <th className="px-4 py-3 text-right">Còn lại</th>
              <th className="px-4 py-3 text-center">Trạng thái</th>
              <th className="px-4 py-3 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-gray-500">
                  Đang tải danh sách khoản chuyển khoản...
                </td>
              </tr>
            )}
            {!loading && filteredReceipts.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-gray-500">
                  Không có dữ liệu chuyển khoản nào phù hợp.
                </td>
              </tr>
            )}
            {!loading &&
              filteredReceipts.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{row.code}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                    {formatDateTime(row.transaction_date)}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-gray-900">{row.store_name || "—"}</p>
                    <p className="text-xs text-gray-500">{row.store_code}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    <p className="font-medium text-gray-800">{row.bank_name || "Ngân hàng"}</p>
                    <p className="text-xs text-gray-500 font-mono">{row.ref_number || "—"}</p>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900">
                    {formatVND(row.amount)}
                  </td>
                  <td className="px-4 py-3 text-right text-emerald-600 font-medium">
                    {formatVND(row.allocated_amount)}
                  </td>
                  <td className="px-4 py-3 text-right text-amber-600 font-semibold">
                    {formatVND(row.unallocated_amount)}
                  </td>
                  <td className="px-4 py-3 text-center">{statusBadge(row.status)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap space-x-2">
                    {row.unallocated_amount > 0.01 && (
                      <button
                        type="button"
                        onClick={() => handleOpenAllocate(row)}
                        className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-sky-700 shadow-sm"
                      >
                        <Zap size={14} />
                        Phân bổ
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setHistoryReceipt(row);
                        setHistoryDrawerOpen(true);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      <History size={14} />
                      Lịch sử ({row.allocations?.length || 0})
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Modal Add Bank Receipt */}
      {addModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-lg font-semibold text-gray-900">Ghi nhận khoản tiền chuyển khoản</h3>
              <button
                type="button"
                onClick={() => setAddModalOpen(false)}
                className="rounded p-1 text-gray-400 hover:text-gray-600"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreateReceipt} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Cửa hàng chuyển tiền <span className="text-red-500">*</span>
                </label>
                <div className="relative mb-1.5">
                  <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Tìm nhanh theo mã hoặc tên cửa hàng..."
                    value={addStoreSearch}
                    onChange={(e) => setAddStoreSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>
                <select
                  required
                  value={addStoreId}
                  onChange={(e) => setAddStoreId(Number(e.target.value) || "")}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-sky-500"
                >
                  <option value="">-- Chọn Cửa hàng / Điểm bán ({filteredModalStores.length} cửa hàng) --</option>
                  {filteredModalStores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} - {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Số tiền (VND) *</label>
                  <input
                    type="number"
                    required
                    min={1000}
                    step={1}
                    placeholder="VD: 20000000"
                    value={addAmount}
                    onChange={(e) => setAddAmount(Number(e.target.value) || "")}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Ngân hàng</label>
                  <input
                    type="text"
                    value={addBankName}
                    onChange={(e) => setAddBankName(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    placeholder="VCB, BIDV, v.v."
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Mã giao dịch / FT</label>
                  <input
                    type="text"
                    value={addRefNumber}
                    onChange={(e) => setAddRefNumber(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono"
                    placeholder="VD: FT261014-9988"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Thời gian GD</label>
                  <input
                    type="datetime-local"
                    value={addDate}
                    onChange={(e) => setAddDate(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nội dung chuyển khoản</label>
                <textarea
                  rows={2}
                  value={addDescription}
                  onChange={(e) => setAddDescription(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  placeholder="Ghi chú theo nội dung biến động số dư ngân hàng..."
                />
              </div>

              <div className="flex justify-end gap-2 border-t pt-3">
                <button
                  type="button"
                  onClick={() => setAddModalOpen(false)}
                  className="rounded-lg border px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={submittingAdd}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {submittingAdd ? "Đang lưu..." : "Xác nhận tạo phiếu"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Allocate Bank Receipt */}
      {allocateModalOpen && selectedReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex h-[90vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900">
                  Phân bổ khoản chuyển khoản - {selectedReceipt.code}
                </h3>
                <p className="text-xs text-gray-500">
                  Cửa hàng: <strong className="text-gray-800">{selectedReceipt.store_name}</strong> ({selectedReceipt.store_code})
                  {" • "}
                  Mã GD: <span className="font-mono">{selectedReceipt.ref_number || "—"}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAllocateModalOpen(false)}
                className="rounded p-1 text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>

            {/* Top Budget Bar */}
            <div className="grid grid-cols-3 gap-4 border-b bg-sky-50/60 px-6 py-3 text-sm">
              <div>
                <span className="text-gray-500">Tiền còn có thể phân bổ:</span>
                <p className="text-base font-bold text-sky-700">{formatVND(selectedReceipt.unallocated_amount)}</p>
              </div>
              <div>
                <span className="text-gray-500">Tổng đang phân bổ:</span>
                <p className={`text-base font-bold ${currentTotalAllocating > selectedReceipt.unallocated_amount ? "text-red-600" : "text-emerald-700"}`}>
                  {formatVND(currentTotalAllocating)}
                </p>
              </div>
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={handleAutoAllocate}
                  disabled={allocationMode !== "EMPLOYEE_DAY" || allocatableEmployeeDays.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 shadow-sm"
                >
                  <Zap size={14} />
                  Tự phân bổ nhân viên/ngày
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Loại công nợ cần phân bổ">
                <button
                  type="button"
                  role="tab"
                  aria-selected={allocationMode === "EMPLOYEE_DAY"}
                  onClick={() => {
                    setAllocationMode("EMPLOYEE_DAY");
                    setAllocAmounts({});
                  }}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                    allocationMode === "EMPLOYEE_DAY"
                      ? "bg-sky-600 text-white"
                      : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  Phân bổ cho nhân viên theo ngày ({allocatableEmployeeDays.length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={allocationMode === "STORE"}
                  onClick={() => {
                    setAllocationMode("STORE");
                    setAllocAmounts({});
                  }}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                    allocationMode === "STORE"
                      ? "bg-emerald-600 text-white"
                      : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  Phân bổ cho cửa hàng
                </button>
              </div>
              {allocationLoadError && (
                <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {allocationLoadError}
                </div>
              )}

              {allocationMode === "EMPLOYEE_DAY" ? (
                <>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                Công nợ còn lại theo ngày/nhân viên ({allocatableEmployeeDays.length} dòng)
              </h4>
              <p className="mb-3 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-800">
                Sau khi xác nhận với cửa hàng, chọn đúng nhân viên và ngày mà khoản chuyển khoản cần giảm trừ.
                Danh sách hiển thị công nợ còn lại của nhân viên; số phân bổ bị giới hạn theo khoản chuyển còn dư và công nợ ngày.
              </p>

              {loadingOrders && <p className="py-10 text-center text-sm text-gray-500">Đang tải công nợ ngày/nhân viên...</p>}

              {!loadingOrders && !allocationLoadError && allocatableEmployeeDays.length === 0 && (
                <div className="rounded-xl border border-dashed border-gray-200 py-12 text-center text-sm text-gray-500">
                  Hiện không có công nợ nhân viên/ngày còn lại. Kiểm tra ngày xuất hàng đã hoàn tất hoặc khoản nợ đã được ghi nhận/đối trừ chưa.
                </div>
              )}

              {!loadingOrders && allocatableEmployeeDays.length > 0 && (
                <div className="overflow-hidden rounded-xl border border-gray-200">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 text-xs font-semibold uppercase text-gray-600">
                      <tr>
                        <th className="px-3 py-2.5">Ngày quyết toán</th>
                        <th className="px-3 py-2.5">Nhân viên</th>
                        <th className="px-3 py-2.5 text-right">Tổng công nợ ngày</th>
                        <th className="px-3 py-2.5 text-right">Đã chuyển khoản</th>
                        <th className="px-3 py-2.5 text-right">Còn công nợ</th>
                        <th className="px-3 py-2.5 text-right w-44">Số tiền phân bổ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {allocatableEmployeeDays.map((target) => {
                        const key = `${target.settlement_date}:${target.employee_id}`;
                        const curVal = allocAmounts[key] ?? "";
                        return (
                          <tr key={key} className="hover:bg-gray-50">
                            <td className="px-3 py-2.5">
                              {new Date(`${target.settlement_date}T00:00:00`).toLocaleDateString("vi-VN")}
                            </td>
                            <td className="px-3 py-2.5">
                              <span className="inline-flex items-center rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800">
                                {target.employee_code} - {target.employee_name || ""}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-right text-gray-600">
                              {formatVND(target.allocated_amount)}
                            </td>
                            <td className="px-3 py-2.5 text-right font-medium text-amber-700">
                              {formatVND(target.paid_bank)}
                            </td>
                            <td className="px-3 py-2.5 text-right font-semibold text-amber-700">
                              {formatVND(target.remaining_employee_debt)}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <input
                                  type="number"
                                  min={0}
                                  max={target.remaining_employee_debt}
                                  step={1}
                                  value={curVal}
                                  placeholder="0"
                                  onChange={(e) => {
                                    const val = Number(e.target.value) || 0;
                                    setAllocAmounts((prev) => ({
                                      ...prev,
                                      [key]: Math.min(val, target.remaining_employee_debt),
                                    }));
                                  }}
                                  className="w-32 rounded border border-gray-300 px-2 py-1 text-right text-sm font-semibold focus:border-sky-500"
                                />
                                <button
                                  type="button"
                                  title="Phân bổ tối đa cho nhân viên/ngày này"
                                  onClick={() => {
                                    setAllocAmounts((prev) => ({
                                      ...prev,
                                      [key]: target.remaining_employee_debt,
                                    }));
                                  }}
                                  className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-600 hover:bg-gray-200"
                                >
                                  Max
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
                </>
              ) : (
                <>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Công nợ trên sổ cửa hàng
                  </h4>
                  {loadingOrders && <p className="py-10 text-center text-sm text-gray-500">Đang tải công nợ cửa hàng...</p>}
                  {!loadingOrders && !allocationLoadError && !allocatableStoreDebt && (
                    <div className="rounded-xl border border-dashed border-gray-200 py-12 text-center text-sm text-gray-500">
                      Cửa hàng chuyển tiền hiện không có dư nợ cửa hàng để phân bổ.
                    </div>
                  )}
                  {!loadingOrders && allocatableStoreDebt && (
                    <div className="rounded-xl border border-gray-200 bg-white p-4">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div>
                          <p className="font-semibold text-gray-900">
                            {allocatableStoreDebt.store_code} - {allocatableStoreDebt.store_name}
                          </p>
                          <p className="mt-1 text-xs text-gray-500">
                            Cửa hàng được xác định theo phiếu chuyển khoản đã ghi nhận.
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-gray-500">Công nợ cửa hàng còn lại</p>
                          <p className="font-bold text-amber-700">{formatVND(allocatableStoreDebt.remaining_store_debt)}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            max={allocatableStoreDebt.remaining_store_debt}
                            step={1}
                            value={allocAmounts.STORE ?? ""}
                            placeholder="Số tiền phân bổ"
                            onChange={(event) => {
                              const amount = Number(event.target.value) || 0;
                              setAllocAmounts({
                                STORE: Math.min(amount, allocatableStoreDebt.remaining_store_debt),
                              });
                            }}
                            className="w-44 rounded border border-gray-300 px-2 py-2 text-right text-sm font-semibold"
                          />
                          <button
                            type="button"
                            onClick={() => setAllocAmounts({ STORE: allocatableStoreDebt.remaining_store_debt })}
                            className="rounded bg-gray-100 px-3 py-2 text-xs text-gray-700 hover:bg-gray-200"
                          >
                            Max
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t bg-gray-50 px-6 py-4">
              <div className="text-sm">
                <span className="text-gray-500">Số tiền thừa còn lại: </span>
                <strong className="text-gray-900">
                  {formatVND(Math.max(0, selectedReceipt.unallocated_amount - currentTotalAllocating))}
                </strong>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAllocateModalOpen(false)}
                  className="rounded-lg border px-4 py-2 text-sm font-medium text-gray-600 hover:bg-white"
                >
                  Đóng
                </button>
                <button
                  type="button"
                  disabled={submittingAlloc || currentTotalAllocating <= 0 || currentTotalAllocating > selectedReceipt.unallocated_amount}
                  onClick={handleConfirmAllocate}
                  className="rounded-lg bg-sky-600 px-5 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50 shadow-sm"
                >
                  {submittingAlloc ? "Đang xử lý..." : "Xác nhận phân bổ"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* History Drawer */}
      <Drawer
        open={historyDrawerOpen}
        onClose={() => setHistoryDrawerOpen(false)}
        title={`Lịch sử phân bổ - ${historyReceipt?.code || ""}`}
      >
        <div className="space-y-4 p-4 text-sm">
          {historyReceipt && (
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 space-y-1">
              <p className="font-semibold text-gray-900">{historyReceipt.store_name}</p>
              <p className="text-xs text-gray-500">
                Tổng tiền: <strong>{formatVND(historyReceipt.amount)}</strong> • Đã phân bổ:{" "}
                <strong className="text-emerald-600">{formatVND(historyReceipt.allocated_amount)}</strong>
              </p>
            </div>
          )}

          <h5 className="font-semibold text-gray-800">Lịch sử các khoản phân bổ:</h5>

          {(!historyReceipt?.allocations || historyReceipt.allocations.length === 0) && (
            <p className="text-xs text-gray-500">Chưa có bút toán phân bổ nào.</p>
          )}

          {historyReceipt?.allocations?.map((alloc) => (
            <div key={alloc.id} className="flex items-center justify-between rounded-lg border p-3 bg-white shadow-xs">
              <div>
                <p className="font-semibold text-gray-900">
                  {alloc.order_number ? `Đơn: ${alloc.order_number}` : alloc.employee_id ? "Phân bổ công nợ nhân viên" : "Giảm nợ cửa hàng"}
                </p>
                <p className="text-xs text-gray-500">
                  NV: <span className="font-medium text-gray-700">{alloc.employee_code || "—"}</span> ({alloc.employee_name || ""})
                  {alloc.settlement_date && ` · Ngày quyết toán ${new Date(`${alloc.settlement_date}T00:00:00`).toLocaleDateString("vi-VN")}`}
                </p>
                <p className="text-xs text-gray-400">{formatDateTime(alloc.created_at)}</p>
              </div>
              <div className="text-right space-y-1">
                <p className="font-bold text-emerald-600">{formatVND(alloc.amount)}</p>
                <button
                  type="button"
                  onClick={() => handleCancelAlloc(historyReceipt.id, alloc.id)}
                  className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-800"
                >
                  <Trash2 size={12} />
                  Hủy phân bổ
                </button>
              </div>
            </div>
          ))}
        </div>
      </Drawer>
    </div>
  );
}

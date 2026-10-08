"use client";

import { useCallback, useEffect, useState } from "react";
import { UserCheck, Wallet, AlertTriangle, ArrowRightLeft, Plus, History } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import DataTable, { Column } from "@/components/ui/DataTable";
import Badge from "@/components/ui/Badge";
import Drawer from "@/components/ui/Drawer";
import { formatVND, formatDateTime } from "@/lib/format";
import { API_URL, apiFetch } from "@/lib/api";

interface EmployeeDebt {
  employee_id: number;
  code: string;
  vinamilk_code: string | null;
  name: string;
  phone: string | null;
  position: string | null;
  status: string;
  debt_limit: number;
  current_debt: number;
  total_debit: number;
  total_credit: number;
  is_over_limit: boolean;
  last_active_at: string | null;
}

interface LedgerEntry {
  id: number;
  party_type: string;
  party_id: number;
  entry_type: string;
  amount: number;
  source_type: string;
  source_id: number | null;
  source_code: string | null;
  document_date: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

interface StoreItem {
  id: number;
  code: string;
  name: string;
  phone?: string;
}

function entryTypeLabel(type: string): { label: string; variant: "success" | "danger" | "warning" | "default" } {
  switch (type) {
    case "DELIVERY_ISSUE":
      return { label: "Xuất hàng giao (+Nợ)", variant: "danger" };
    case "CASH_RECEIPT":
      return { label: "Thu tiền mặt (-Nợ)", variant: "success" };
    case "BANK_RECEIPT":
      return { label: "Ngân hàng báo có (-Nợ)", variant: "success" };
    case "TRANSFER_OUT":
      return { label: "Chuyển nợ sang Cửa hàng (-Nợ)", variant: "warning" };
    case "TRANSFER_IN":
      return { label: "Nhận nợ từ NV (+Nợ)", variant: "danger" };
    case "RETURN":
      return { label: "Hàng trả về (-Nợ)", variant: "success" };
    default:
      return { label: type, variant: "default" };
  }
}

export default function EmployeeDebtsPage() {
  const [employees, setEmployees] = useState<EmployeeDebt[]>([]);
  const [stores, setStores] = useState<StoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Drawer ledger state
  const [selectedEmp, setSelectedEmp] = useState<EmployeeDebt | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [loadingLedger, setLoadingLedger] = useState(false);

  // Cash receipt modal state
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [receiptEmpId, setReceiptEmpId] = useState<number | "">("");
  const [receiptAmount, setReceiptAmount] = useState<number | "">("");
  const [receiptNote, setReceiptNote] = useState("");
  const [submittingReceipt, setSubmittingReceipt] = useState(false);

  // Debt transfer modal state
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [transferEmpId, setTransferEmpId] = useState<number | "">("");
  const [transferStoreId, setTransferStoreId] = useState<number | "">("");
  const [transferAmount, setTransferAmount] = useState<number | "">("");
  const [transferReason, setTransferReason] = useState("");
  const [submittingTransfer, setSubmittingTransfer] = useState(false);

  // Quick store creation inside transfer modal
  const [quickStoreCode, setQuickStoreCode] = useState("");
  const [quickStoreName, setQuickStoreName] = useState("");
  const [showQuickStore, setShowQuickStore] = useState(false);

  const fetchEmployees = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiFetch(`${API_URL}/employee-debts`);
      if (!res.ok) throw new Error("Không thể tải danh sách công nợ nhân viên.");
      const data = await res.json();
      setEmployees(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Lỗi khi tải dữ liệu.");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchStores = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_URL}/stores/?limit=500`);
      if (res.ok) {
        const data = await res.json();
        setStores(data);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchEmployees();
    fetchStores();
  }, [fetchEmployees, fetchStores]);

  const openLedger = async (emp: EmployeeDebt) => {
    setSelectedEmp(emp);
    setLoadingLedger(true);
    try {
      const res = await apiFetch(`${API_URL}/employee-debts/${emp.employee_id}/ledger`);
      if (res.ok) {
        setLedgerEntries(await res.json());
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Lỗi tải sổ công nợ.");
    } finally {
      setLoadingLedger(false);
    }
  };

  const handleCreateCashReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receiptEmpId || !receiptAmount || Number(receiptAmount) <= 0) {
      setError("Vui lòng chọn nhân viên và nhập số tiền thu hợp lệ.");
      return;
    }
    setSubmittingReceipt(true);
    setError("");
    setMessage("");
    try {
      const res = await apiFetch(`${API_URL}/cash-receipts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          party_type: "EMPLOYEE",
          party_id: Number(receiptEmpId),
          amount: Number(receiptAmount),
          note: receiptNote,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Không thể lập phiếu thu.");
      setMessage(`Đã thu thành công ${formatVND(Number(receiptAmount))} cho nhân viên!`);
      setReceiptModalOpen(false);
      setReceiptAmount("");
      setReceiptNote("");
      fetchEmployees();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Lỗi lập phiếu thu.");
    } finally {
      setSubmittingReceipt(false);
    }
  };

  const handleCreateTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    let finalStoreId = transferStoreId;

    if (showQuickStore) {
      if (!quickStoreCode || !quickStoreName) {
        setError("Vui lòng nhập mã và tên cửa hàng mới.");
        return;
      }
      try {
        const createStoreRes = await apiFetch(`${API_URL}/stores/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: quickStoreCode, name: quickStoreName }),
        });
        const storeData = await createStoreRes.json();
        if (!createStoreRes.ok) throw new Error(storeData.detail || "Không thể tạo cửa hàng mới.");
        finalStoreId = storeData.id;
        fetchStores();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Lỗi tạo cửa hàng.");
        return;
      }
    }

    if (!transferEmpId || !finalStoreId || !transferAmount || Number(transferAmount) <= 0) {
      setError("Vui lòng điền đầy đủ thông tin chuyển nợ.");
      return;
    }

    setSubmittingTransfer(true);
    setError("");
    setMessage("");
    try {
      const res = await apiFetch(`${API_URL}/debt-transfers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_employee_id: Number(transferEmpId),
          to_store_id: Number(finalStoreId),
          amount: Number(transferAmount),
          reason: transferReason,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Không thể gửi đề nghị chuyển nợ.");
      setMessage(`Đã gửi đề nghị chuyển nợ ${formatVND(Number(transferAmount))} sang Cửa hàng. Chờ kế toán duyệt.`);
      setTransferModalOpen(false);
      setTransferAmount("");
      setTransferReason("");
      setShowQuickStore(false);
      fetchEmployees();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Lỗi chuyển nợ.");
    } finally {
      setSubmittingTransfer(false);
    }
  };

  const totalDebt = employees.reduce((acc, e) => acc + e.current_debt, 0);
  const inDebtCount = employees.filter((e) => e.current_debt > 0).length;
  const overLimitCount = employees.filter((e) => e.is_over_limit).length;
  const totalDebit = employees.reduce((acc, e) => acc + e.total_debit, 0);

  const columns: Column<EmployeeDebt>[] = [
    {
      key: "code",
      title: "Mã NV",
      render: (_, r) => (
        <div>
          <span className="font-semibold text-gray-900">{r.code}</span>
          {r.vinamilk_code && (
            <div className="text-xs text-gray-400">VNM: {r.vinamilk_code}</div>
          )}
        </div>
      ),
    },
    {
      key: "name",
      title: "Họ và tên",
      render: (_, r) => (
        <div>
          <div className="font-medium text-gray-800">{r.name}</div>
          <div className="text-xs text-gray-400">{r.position || "SALES"} • {r.phone || "—"}</div>
        </div>
      ),
    },
    {
      key: "debt_limit",
      title: "Hạn mức",
      align: "right",
      render: (_, r) => <span className="font-mono text-gray-600">{formatVND(r.debt_limit)}</span>,
    },
    {
      key: "current_debt",
      title: "Dư nợ hiện tại",
      align: "right",
      render: (_, r) => (
        <span className={`font-mono font-bold ${r.current_debt > 0 ? "text-red-600" : "text-gray-700"}`}>
          {formatVND(r.current_debt)}
        </span>
      ),
    },
    {
      key: "total_debit",
      title: "Tổng phát sinh",
      align: "right",
      render: (_, r) => <span className="font-mono text-gray-500">{formatVND(r.total_debit)}</span>,
    },
    {
      key: "total_credit",
      title: "Đã thu / Giảm",
      align: "right",
      render: (_, r) => <span className="font-mono text-emerald-600">{formatVND(r.total_credit)}</span>,
    },
    {
      key: "is_over_limit",
      title: "Cảnh báo hạn mức",
      align: "center",
      render: (_, r) =>
        r.is_over_limit ? (
          <Badge variant="warning">⚠️ Vượt hạn mức 50tr</Badge>
        ) : (
          <Badge variant="success">An toàn</Badge>
        ),
    },
    {
      key: "actions",
      title: "Thao tác",
      align: "right",
      render: (_, r) => (
        <div className="flex items-center justify-end gap-1.5">
          <button
            onClick={() => openLedger(r)}
            className="p-1.5 text-xs font-medium text-sky-600 hover:bg-sky-50 rounded flex items-center gap-1 border border-sky-200"
            title="Xem sổ chi tiết"
          >
            <History size={13} /> Sổ nợ
          </button>
          <button
            onClick={() => {
              setReceiptEmpId(r.employee_id);
              setReceiptModalOpen(true);
            }}
            className="p-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 rounded flex items-center gap-1 border border-emerald-200"
            title="Thu tiền mặt"
          >
            <Wallet size={13} /> Thu tiền
          </button>
          <button
            onClick={() => {
              setTransferEmpId(r.employee_id);
              setTransferAmount(r.current_debt > 0 ? r.current_debt : "");
              setTransferModalOpen(true);
            }}
            className="p-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50 rounded flex items-center gap-1 border border-amber-200"
            title="Chuyển nợ sang cửa hàng"
          >
            <ArrowRightLeft size={13} /> Chuyển nợ
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Công nợ Nhân viên Giao hàng"
        subtitle="Quản lý hạn mức, theo dõi biến động nợ từ phiếu xuất hàng, thu tiền mặt và chuyển nợ sang cửa hàng"
        actions={
          <div className="flex gap-2">
            <button
              onClick={() => {
                setReceiptEmpId("");
                setReceiptModalOpen(true);
              }}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <Plus size={16} /> Thu tiền mặt
            </button>
            <button
              onClick={() => {
                setTransferEmpId("");
                setTransferModalOpen(true);
              }}
              className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white px-3.5 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <ArrowRightLeft size={16} /> Chuyển nợ Cửa hàng
            </button>
          </div>
        }
      />

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}
      {message && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg px-4 py-3 text-sm">
          {message}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Tổng công nợ NV hiện tại"
          value={formatVND(totalDebt)}
          icon={<Wallet size={20} />}
        />
        <StatCard
          label="Số NV đang có nợ"
          value={`${inDebtCount} / ${employees.length}`}
          icon={<UserCheck size={20} />}
        />
        <StatCard
          label="NV vượt hạn mức (50tr)"
          value={overLimitCount}
          icon={<AlertTriangle size={20} />}
          color={overLimitCount > 0 ? "bg-amber-50 text-amber-600" : "bg-sky-50 text-sky-600"}
        />
        <StatCard
          label="Tổng xuất hàng tích lũy"
          value={formatVND(totalDebit)}
          icon={<History size={20} />}
        />
      </div>

      {/* Main Table */}
      {loading ? (
        <div className="p-12 text-center text-sm text-gray-400 bg-white rounded-xl border border-gray-100">
          Đang tải danh sách công nợ...
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <DataTable
            columns={columns}
            data={employees}
            searchable
            searchPlaceholder="Tìm kiếm theo mã hoặc tên nhân viên..."
          />
        </div>
      )}

      {/* Sổ chi tiết Drawer */}
      <Drawer
        open={Boolean(selectedEmp)}
        onClose={() => setSelectedEmp(null)}
        title={selectedEmp ? `Sổ cái công nợ: ${selectedEmp.code} - ${selectedEmp.name}` : "Sổ công nợ"}
      >
        {selectedEmp && (
          <div className="space-y-4">
            <div className="bg-gray-50 p-4 rounded-xl space-y-2 border border-gray-100">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Dư nợ hiện tại:</span>
                <span className="font-bold text-red-600 font-mono text-base">{formatVND(selectedEmp.current_debt)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Hạn mức tối đa:</span>
                <span className="font-mono text-gray-700">{formatVND(selectedEmp.debt_limit)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Trạng thái:</span>
                <span>
                  {selectedEmp.is_over_limit ? (
                    <Badge variant="warning">⚠️ Vượt hạn mức 50tr</Badge>
                  ) : (
                    <Badge variant="success">An toàn</Badge>
                  )}
                </span>
              </div>
            </div>

            <h4 className="font-semibold text-gray-800 text-sm mt-4">Lịch sử bút toán công nợ (Bất biến)</h4>

            {loadingLedger ? (
              <div className="py-8 text-center text-sm text-gray-400">Đang tải sổ cái...</div>
            ) : ledgerEntries.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-400">Chưa có bút toán nào phát sinh.</div>
            ) : (
              <div className="space-y-2.5">
                {ledgerEntries.map((e) => {
                  const badgeInfo = entryTypeLabel(e.entry_type);
                  const isDebit = e.amount > 0;
                  return (
                    <div key={e.id} className="p-3 bg-white border border-gray-100 rounded-lg shadow-2xs space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <Badge variant={badgeInfo.variant}>{badgeInfo.label}</Badge>
                        <span className="text-gray-400">{formatDateTime(e.created_at)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500 font-mono">
                          Mã CT: {e.source_code || `ID#${e.source_id || e.id}`}
                        </span>
                        <span className={`font-mono font-bold text-sm ${isDebit ? "text-red-600" : "text-emerald-600"}`}>
                          {isDebit ? `+${formatVND(e.amount)}` : `-${formatVND(Math.abs(e.amount))}`}
                        </span>
                      </div>
                      {e.note && <div className="text-xs text-gray-600 bg-gray-50 p-1.5 rounded">{e.note}</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </Drawer>

      {/* Modal: Thu tiền mặt */}
      {receiptModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-gray-900">Lập Phiếu Thu Tiền Mặt</h3>
            <p className="text-xs text-gray-500">
              Ghi nhận tiền mặt nhân viên nộp về quỹ. Số tiền này sẽ tự động giảm trừ vào công nợ của nhân viên.
            </p>
            <form onSubmit={handleCreateCashReceipt} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Nhân viên nộp tiền *</label>
                <select
                  value={receiptEmpId}
                  onChange={(e) => setReceiptEmpId(Number(e.target.value))}
                  required
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white"
                >
                  <option value="">-- Chọn nhân viên --</option>
                  {employees.map((e) => (
                    <option key={e.employee_id} value={e.employee_id}>
                      {e.code} - {e.name} (Nợ: {formatVND(e.current_debt)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Số tiền nộp (VNĐ) *</label>
                <input
                  type="number"
                  min="1000"
                  step="1000"
                  value={receiptAmount}
                  onChange={(e) => setReceiptAmount(Number(e.target.value))}
                  required
                  placeholder="Ví dụ: 5000000"
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Ghi chú phiếu thu</label>
                <input
                  type="text"
                  value={receiptNote}
                  onChange={(e) => setReceiptNote(e.target.value)}
                  placeholder="Ví dụ: Nộp tiền chuyến hàng ngày 08/09"
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setReceiptModalOpen(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={submittingReceipt}
                  className="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg disabled:opacity-50"
                >
                  {submittingReceipt ? "Đang lưu..." : "Xác nhận thu tiền"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Chuyển nợ sang Cửa hàng */}
      {transferModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-gray-900">Đề Nghị Chuyển Nợ Sang Cửa Hàng</h3>
            <p className="text-xs text-gray-500">
              Trường hợp thu thiếu tiền và nhân viên xác nhận Cửa hàng nợ tiền, tạo đề nghị này để kế toán duyệt chuyển công nợ từ nhân viên sang cửa hàng tương ứng.
            </p>
            <form onSubmit={handleCreateTransfer} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Nhân viên giao hàng *</label>
                <select
                  value={transferEmpId}
                  onChange={(e) => setTransferEmpId(Number(e.target.value))}
                  required
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white"
                >
                  <option value="">-- Chọn nhân viên --</option>
                  {employees.map((e) => (
                    <option key={e.employee_id} value={e.employee_id}>
                      {e.code} - {e.name} (Dư nợ: {formatVND(e.current_debt)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-gray-700">Cửa hàng nhận nợ *</label>
                  <button
                    type="button"
                    onClick={() => setShowQuickStore(!showQuickStore)}
                    className="text-xs text-sky-600 hover:underline flex items-center gap-1"
                  >
                    {showQuickStore ? "Chọn từ danh sách có sẵn" : "+ Tạo nhanh Cửa hàng mới"}
                  </button>
                </div>

                {!showQuickStore ? (
                  <select
                    value={transferStoreId}
                    onChange={(e) => setTransferStoreId(Number(e.target.value))}
                    required={!showQuickStore}
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white"
                  >
                    <option value="">-- Chọn cửa hàng --</option>
                    {stores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code} - {s.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="grid grid-cols-2 gap-2 bg-sky-50/50 p-2.5 rounded-lg border border-sky-100">
                    <div>
                      <input
                        type="text"
                        placeholder="Mã CH (VD: CH_ANH_LAM)"
                        value={quickStoreCode}
                        onChange={(e) => setQuickStoreCode(e.target.value)}
                        className="w-full text-xs border rounded p-2 bg-white"
                      />
                    </div>
                    <div>
                      <input
                        type="text"
                        placeholder="Tên Cửa hàng (VD: Cửa hàng Ánh Lâm)"
                        value={quickStoreName}
                        onChange={(e) => setQuickStoreName(e.target.value)}
                        className="w-full text-xs border rounded p-2 bg-white"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Số tiền chuyển sang Cửa hàng (VNĐ) *</label>
                <input
                  type="number"
                  min="1000"
                  step="1000"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(Number(e.target.value))}
                  required
                  placeholder="Ví dụ: 2500000"
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Lý do / Giải trình</label>
                <input
                  type="text"
                  value={transferReason}
                  onChange={(e) => setTransferReason(e.target.value)}
                  placeholder="Ví dụ: Cửa hàng hẹn chuyển khoản sau 3 ngày"
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setTransferModalOpen(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={submittingTransfer}
                  className="px-4 py-2 text-sm bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg disabled:opacity-50"
                >
                  {submittingTransfer ? "Đang gửi..." : "Gửi đề nghị chuyển nợ"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

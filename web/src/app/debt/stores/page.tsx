"use client";

import { useCallback, useEffect, useState } from "react";
import { Store, Wallet, History, Users } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import DataTable, { Column } from "@/components/ui/DataTable";
import Badge from "@/components/ui/Badge";
import Drawer from "@/components/ui/Drawer";
import { formatVND, formatDateTime } from "@/lib/format";
import { API_URL, apiFetch } from "@/lib/api";

interface StoreDebt {
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

function entryTypeLabel(type: string): { label: string; variant: "success" | "danger" | "warning" | "default" } {
  switch (type) {
    case "TRANSFER_IN":
      return { label: "Nhận nợ từ NV (+Nợ)", variant: "danger" };
    case "CASH_RECEIPT":
      return { label: "Thu tiền mặt (-Nợ)", variant: "success" };
    case "BANK_RECEIPT":
      return { label: "Ngân hàng báo có (-Nợ)", variant: "success" };
    case "RETURN":
      return { label: "Hàng trả về (-Nợ)", variant: "success" };
    default:
      return { label: type, variant: "default" };
  }
}

export default function StoreDebtsPage() {
  const [stores, setStores] = useState<StoreDebt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [selectedStore, setSelectedStore] = useState<StoreDebt | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [loadingLedger, setLoadingLedger] = useState(false);

  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [receiptStoreId, setReceiptStoreId] = useState<number | "">("");
  const [receiptAmount, setReceiptAmount] = useState<number | "">("");
  const [receiptNote, setReceiptNote] = useState("");
  const [submittingReceipt, setSubmittingReceipt] = useState(false);

  const fetchStores = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiFetch(`${API_URL}/store-debts`);
      if (!res.ok) throw new Error("Không thể tải danh sách công nợ cửa hàng.");
      const data = await res.json();
      setStores(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Lỗi khi tải dữ liệu.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStores();
  }, [fetchStores]);

  const openLedger = async (st: StoreDebt) => {
    setSelectedStore(st);
    setLoadingLedger(true);
    try {
      const res = await apiFetch(`${API_URL}/store-debts/${st.store_id}/ledger`);
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
    if (!receiptStoreId || !receiptAmount || Number(receiptAmount) <= 0) {
      setError("Vui lòng chọn cửa hàng và nhập số tiền thu hợp lệ.");
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
          party_type: "STORE",
          party_id: Number(receiptStoreId),
          amount: Number(receiptAmount),
          note: receiptNote,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Không thể lập phiếu thu.");
      setMessage(`Đã thu thành công ${formatVND(Number(receiptAmount))} từ Cửa hàng!`);
      setReceiptModalOpen(false);
      setReceiptAmount("");
      setReceiptNote("");
      fetchStores();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Lỗi lập phiếu thu.");
    } finally {
      setSubmittingReceipt(false);
    }
  };

  const totalDebt = stores.reduce((acc, s) => acc + s.current_debt, 0);
  const inDebtCount = stores.filter((s) => s.current_debt > 0).length;
  const totalTransferred = stores.reduce((acc, s) => acc + s.total_debit, 0);

  const columns: Column<StoreDebt>[] = [
    {
      key: "code",
      title: "Mã Cửa hàng",
      render: (_, r) => <span className="font-semibold text-gray-900">{r.code}</span>,
    },
    {
      key: "name",
      title: "Tên Cửa hàng",
      render: (_, r) => (
        <div>
          <div className="font-medium text-gray-900">{r.name}</div>
          <div className="text-xs text-gray-400">
            {r.owner_name ? `Chủ CH: ${r.owner_name} • ` : ""}{r.address || "Chưa có địa chỉ"}
          </div>
        </div>
      ),
    },
    {
      key: "customer_count",
      title: "Mã KH liên kết",
      align: "center",
      render: (_, r) => (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-700">
          {r.customer_count} mã KH
        </span>
      ),
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
      title: "Nhận nợ chuyển sang",
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
              setReceiptStoreId(r.store_id);
              setReceiptAmount(r.current_debt > 0 ? r.current_debt : "");
              setReceiptModalOpen(true);
            }}
            className="p-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 rounded flex items-center gap-1 border border-emerald-200"
            title="Thu nợ từ cửa hàng"
          >
            <Wallet size={13} /> Thu tiền
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Công nợ Cửa hàng"
        subtitle="Theo dõi công nợ chuyển từ nhân viên giao hàng sang cửa hàng (khi thu thiếu tiền và cửa hàng nhận nợ)"
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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Tổng công nợ Cửa hàng"
          value={formatVND(totalDebt)}
          icon={<Wallet size={20} />}
        />
        <StatCard
          label="Số Cửa hàng đang nợ"
          value={`${inDebtCount} / ${stores.length}`}
          icon={<Store size={20} />}
        />
        <StatCard
          label="Tổng nợ nhận chuyển từ NV"
          value={formatVND(totalTransferred)}
          icon={<History size={20} />}
        />
      </div>

      {loading ? (
        <div className="p-12 text-center text-sm text-gray-400 bg-white rounded-xl border border-gray-100">
          Đang tải danh sách công nợ cửa hàng...
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <DataTable
            columns={columns}
            data={stores}
            searchable
            searchPlaceholder="Tìm kiếm mã hoặc tên cửa hàng..."
          />
        </div>
      )}

      {/* Sổ chi tiết Drawer */}
      <Drawer
        open={Boolean(selectedStore)}
        onClose={() => setSelectedStore(null)}
        title={selectedStore ? `Sổ công nợ Cửa hàng: ${selectedStore.code} - ${selectedStore.name}` : "Sổ công nợ"}
      >
        {selectedStore && (
          <div className="space-y-4">
            <div className="bg-gray-50 p-4 rounded-xl space-y-2 border border-gray-100">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Dư nợ hiện tại:</span>
                <span className="font-bold text-red-600 font-mono text-base">{formatVND(selectedStore.current_debt)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Mã KH quản lý:</span>
                <span className="font-medium text-gray-700">{selectedStore.customer_count} mã khách hàng</span>
              </div>
            </div>

            <h4 className="font-semibold text-gray-800 text-sm mt-4">Lịch sử bút toán công nợ Cửa hàng</h4>

            {loadingLedger ? (
              <div className="py-8 text-center text-sm text-gray-400">Đang tải sổ cái...</div>
            ) : ledgerEntries.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-400">Chưa có bút toán nào phát sinh cho cửa hàng này.</div>
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

      {/* Modal Thu tiền từ Cửa hàng */}
      {receiptModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-gray-900">Thu Tiền Công Nợ Cửa Hàng</h3>
            <p className="text-xs text-gray-500">
              Ghi nhận tiền thanh toán trực tiếp từ Cửa hàng. Số tiền này sẽ tự động giảm trừ vào công nợ cửa hàng.
            </p>
            <form onSubmit={handleCreateCashReceipt} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Cửa hàng thanh toán *</label>
                <select
                  value={receiptStoreId}
                  onChange={(e) => setReceiptStoreId(Number(e.target.value))}
                  required
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white"
                >
                  <option value="">-- Chọn cửa hàng --</option>
                  {stores.map((s) => (
                    <option key={s.store_id} value={s.store_id}>
                      {s.code} - {s.name} (Nợ: {formatVND(s.current_debt)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Số tiền thanh toán (VNĐ) *</label>
                <input
                  type="number"
                  min="1000"
                  step="1000"
                  value={receiptAmount}
                  onChange={(e) => setReceiptAmount(Number(e.target.value))}
                  required
                  placeholder="Ví dụ: 10000000"
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Ghi chú</label>
                <input
                  type="text"
                  value={receiptNote}
                  onChange={(e) => setReceiptNote(e.target.value)}
                  placeholder="Ví dụ: Cửa hàng thanh toán nợ đợt 1"
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
                  {submittingReceipt ? "Đang lưu..." : "Xác nhận thu nợ"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

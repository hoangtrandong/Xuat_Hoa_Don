"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, X } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { formatDateTime, formatVND } from "@/lib/format";
import { API_URL, apiFetch } from "@/lib/api";

type PartyType = "EMPLOYEE" | "STORE";

interface DebtParty {
  id: number;
  code: string;
  name: string;
}

interface DebtTransferItem {
  id: number;
  code: string;
  from_party_type: PartyType;
  from_party_id: number;
  to_party_type: PartyType;
  to_party_id: number;
  amount: number;
  reason: string | null;
  created_at: string;
}

function partyLabel(type: PartyType): string {
  return type === "EMPLOYEE" ? "Nhân viên" : "Cửa hàng";
}

function partyMapKey(type: PartyType, id: number): string {
  return `${type}:${id}`;
}

export default function DebtTransfersPage() {
  const [transfers, setTransfers] = useState<DebtTransferItem[]>([]);
  const [employees, setEmployees] = useState<DebtParty[]>([]);
  const [stores, setStores] = useState<DebtParty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [fromPartyType, setFromPartyType] = useState<PartyType>("EMPLOYEE");
  const [fromPartyId, setFromPartyId] = useState("");
  const [toPartyType, setToPartyType] = useState<PartyType>("STORE");
  const [toPartyId, setToPartyId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const partyOptions = useMemo(() => {
    const entries: Array<[string, string]> = [];
    for (const employee of employees) {
      entries.push([partyMapKey("EMPLOYEE", employee.id), `Nhân viên · ${employee.code} - ${employee.name}`]);
    }
    for (const store of stores) {
      entries.push([partyMapKey("STORE", store.id), `Cửa hàng · ${store.code} - ${store.name}`]);
    }
    return new Map(entries);
  }, [employees, stores]);

  const loadData = useCallback(async () => {
    try {
      const [transfersResponse, employeesResponse, storesResponse] = await Promise.all([
        apiFetch(`${API_URL}/debt-transfers`),
        apiFetch(`${API_URL}/employees/?limit=5000`),
        apiFetch(`${API_URL}/stores/?limit=5000`),
      ]);
      if (!transfersResponse.ok) throw new Error("Không thể tải danh sách chuyển công nợ.");
      if (!employeesResponse.ok) throw new Error("Không thể tải danh sách nhân viên.");
      if (!storesResponse.ok) throw new Error("Không thể tải danh sách cửa hàng.");
      const [transferRows, employeeRows, storeRows] = await Promise.all([
        transfersResponse.json() as Promise<DebtTransferItem[]>,
        employeesResponse.json() as Promise<DebtParty[]>,
        storesResponse.json() as Promise<DebtParty[]>,
      ]);
      setTransfers(transferRows);
      setEmployees(employeeRows);
      setStores(storeRows);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Không thể tải dữ liệu chuyển công nợ.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // The callback updates React state only after its network requests complete.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
  }, [loadData]);

  async function handleCreateTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!fromPartyId || !toPartyId || Number(amount) <= 0) {
      setError("Vui lòng chọn đủ bên chuyển, bên nhận và số tiền hợp lệ.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await apiFetch(`${API_URL}/debt-transfers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_party_type: fromPartyType,
          from_party_id: Number(fromPartyId),
          to_party_type: toPartyType,
          to_party_id: Number(toPartyId),
          amount: Number(amount),
          reason: reason.trim() || undefined,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || "Không thể tạo phiếu chuyển công nợ.");
      setMessage(`Đã chuyển công nợ ${formatVND(Number(amount))}; số dư hai bên đã được cập nhật.`);
      setModalOpen(false);
      setFromPartyId("");
      setToPartyId("");
      setAmount("");
      setReason("");
      setLoading(true);
      await loadData();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Không thể tạo phiếu chuyển công nợ.");
    } finally {
      setSaving(false);
    }
  }

  function partySelect(
    label: string,
    type: PartyType,
    id: string,
    onChange: (value: string) => void,
  ) {
    const options = type === "EMPLOYEE" ? employees : stores;
    return (
      <label className="block text-sm font-medium text-gray-700">
        {label} · {partyLabel(type)}
        <select
          required
          value={id}
          onChange={(event) => onChange(event.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
        >
          <option value="">Chọn {type === "EMPLOYEE" ? "nhân viên" : "cửa hàng"}</option>
          {options.map((party) => (
            <option key={party.id} value={party.id}>
              {party.code} - {party.name}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quản lý Chuyển Công nợ"
        subtitle="Kế toán lập phiếu và chuyển công nợ trực tiếp giữa nhân viên và cửa hàng"
        actions={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setError("");
                setLoading(true);
                void loadData();
              }}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
              Làm mới
            </button>
            <button
              type="button"
              onClick={() => {
                setError("");
                setMessage("");
                setModalOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-700"
            >
              <Plus size={16} />
              Tạo chuyển công nợ
            </button>
          </div>
        }
      />

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {message && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left">Mã Chuyển</th>
              <th className="px-4 py-3 text-left">Mã Nhận</th>
              <th className="px-4 py-3 text-right">Số tiền</th>
              <th className="px-4 py-3 text-left">Lý do</th>
              <th className="px-4 py-3 text-left">Thời gian</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-500">Đang tải lịch sử chuyển công nợ...</td></tr>}
            {!loading && transfers.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-500">Chưa có giao dịch chuyển công nợ.</td></tr>}
            {!loading && transfers.map((transfer) => (
              <tr key={transfer.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono font-medium text-gray-900">
                  {partyOptions.get(partyMapKey(transfer.from_party_type, transfer.from_party_id)) ?? `#${transfer.from_party_id}`}
                </td>
                <td className="px-4 py-3 font-mono font-medium text-gray-900">
                  {partyOptions.get(partyMapKey(transfer.to_party_type, transfer.to_party_id)) ?? `#${transfer.to_party_id}`}
                </td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatVND(transfer.amount)}</td>
                <td className="px-4 py-3 text-gray-600">{transfer.reason || "—"}</td>
                <td className="px-4 py-3 whitespace-nowrap text-gray-600">{formatDateTime(transfer.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={handleCreateTransfer} className="w-full max-w-2xl space-y-5 rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Tạo phiếu chuyển công nợ</h2>
                <p className="mt-1 text-xs text-gray-500">Lưu phiếu xong, công nợ hai bên được điều chuyển ngay.</p>
              </div>
              <button type="button" onClick={() => setModalOpen(false)} className="rounded p-1 text-gray-400 hover:text-gray-700" aria-label="Đóng">
                <X size={18} />
              </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium text-gray-700">
                Loại bên chuyển
                <select
                  value={fromPartyType}
                  onChange={(event) => {
                    setFromPartyType(event.target.value as PartyType);
                    setFromPartyId("");
                  }}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                >
                  <option value="EMPLOYEE">Nhân viên</option>
                  <option value="STORE">Cửa hàng</option>
                </select>
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Loại bên nhận
                <select
                  value={toPartyType}
                  onChange={(event) => {
                    setToPartyType(event.target.value as PartyType);
                    setToPartyId("");
                  }}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                >
                  <option value="EMPLOYEE">Nhân viên</option>
                  <option value="STORE">Cửa hàng</option>
                </select>
              </label>
              {partySelect("Mã Chuyển", fromPartyType, fromPartyId, setFromPartyId)}
              {partySelect("Mã Nhận", toPartyType, toPartyId, setToPartyId)}
              <label className="block text-sm font-medium text-gray-700">
                Số tiền
                <input
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-right tabular-nums"
                />
              </label>
              <label className="block text-sm font-medium text-gray-700 sm:col-span-2">
                Lý do
                <textarea
                  rows={3}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                  placeholder="Nhập lý do điều chuyển công nợ"
                />
              </label>
            </div>

            <div className="flex justify-end gap-2 border-t pt-4">
              <button type="button" onClick={() => setModalOpen(false)} disabled={saving} className="rounded-lg border px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
                Hủy
              </button>
              <button type="submit" disabled={saving} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
                {saving ? "Đang lưu..." : "Tạo phiếu & điều chuyển"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

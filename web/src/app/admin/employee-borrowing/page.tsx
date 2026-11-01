"use client";

import { useEffect, useRef, useState } from "react";
import { Check, RefreshCw, Trash2, Upload } from "lucide-react";
import DataTable, { Column } from "@/components/ui/DataTable";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import { API_URL, apiFetch } from "@/lib/api";
import { formatVND } from "@/lib/format";

type BorrowBalance = {
  employee_id: number | null;
  employee_code: string;
  employee_name: string;
  product_id: number;
  product_code: string;
  product_name: string;
  quantity: number;
  amount: number;
};

type BorrowEntry = BorrowBalance & {
  id: number;
  entry_type: "BORROW" | "OFFSET";
  batch_id: number | null;
  source_request_id: number | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

type PendingBatch = {
  id: number;
  filename: string;
  created_by: string | null;
  created_at: string;
  entries: BorrowEntry[];
};

type LedgerResponse = {
  balances: BorrowBalance[];
  entries: BorrowEntry[];
  pending_batches: PendingBatch[];
};

type ImportPreview = {
  batch_id: number;
  status: string;
  filename: string;
  entries: BorrowEntry[];
  message: string;
};

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("vi-VN");
}

export default function EmployeeBorrowingPage() {
  const [ledger, setLedger] = useState<LedgerResponse>({ balances: [], entries: [], pending_batches: [] });
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function load() {
    const response = await apiFetch(`${API_URL}/employee-borrowing/`);
    const result = await response.json() as LedgerResponse & { detail?: string };
    if (!response.ok) throw new Error(result.detail ?? "Không thể tải sổ hàng vay mượn.");
    setLedger(result);
    setPreview(null);
  }

  useEffect(() => {
    load().catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Không thể tải dữ liệu."));
  }, []);

  async function upload(file: File) {
    setError("");
    setMessage("");
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await apiFetch(`${API_URL}/employee-borrowing/import`, { method: "POST", body });
      const result = await response.json() as ImportPreview & { detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "Không thể đọc file vay mượn.");
      setPreview(result);
      setMessage(result.message);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Không thể đọc file.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmBatch(batchId: number) {
    setError("");
    setBusy(true);
    try {
      const response = await apiFetch(`${API_URL}/employee-borrowing/${batchId}/confirm`, { method: "POST" });
      const result = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "Không thể xác nhận số vay mượn.");
      setMessage("Đã ghi nhận số vay mượn âm cho nhân viên.");
      await load();
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "Không thể xác nhận.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelBatch(batchId: number) {
    setError("");
    setBusy(true);
    try {
      const response = await apiFetch(`${API_URL}/employee-borrowing/${batchId}`, { method: "DELETE" });
      if (!response.ok) {
        const result = await response.json() as { detail?: string };
        throw new Error(result.detail ?? "Không thể hủy bản import.");
      }
      setMessage("Đã hủy bản import chờ xác nhận.");
      await load();
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "Không thể hủy.");
    } finally {
      setBusy(false);
    }
  }

  const balanceColumns: Column<BorrowBalance>[] = [
    { key: "employee_code", title: "Mã NV", sortable: true },
    { key: "employee_name", title: "Nhân viên", sortable: true },
    { key: "product_code", title: "Mã NPP", sortable: true },
    { key: "product_name", title: "Sản phẩm", sortable: true },
    { key: "quantity", title: "Số dư vay (hộp)", align: "right", render: (value) => <span className="font-semibold text-rose-700">{Number(value).toLocaleString("vi-VN")}</span> },
    { key: "amount", title: "Số dư vay", align: "right", render: (value) => <span className="font-semibold text-rose-700">{formatVND(Number(value))}</span> },
  ];

  const historyColumns: Column<BorrowEntry>[] = [
    { key: "created_at", title: "Thời gian", sortable: true, render: (value) => formatDate(String(value)) },
    { key: "employee_code", title: "Mã NV", sortable: true },
    { key: "employee_name", title: "Nhân viên", sortable: true },
    { key: "product_code", title: "Mã NPP", sortable: true },
    { key: "entry_type", title: "Nghiệp vụ", render: (value) => value === "BORROW" ? "Vay -X" : "Xuất thực tế bù trừ" },
    { key: "quantity", title: "Số lượng", align: "right", render: (value) => <span className={Number(value) < 0 ? "text-rose-700" : "text-emerald-700"}>{Number(value).toLocaleString("vi-VN")}</span> },
    { key: "amount", title: "Thành tiền", align: "right", render: (value) => <span className={Number(value) < 0 ? "text-rose-700" : "text-emerald-700"}>{formatVND(Number(value))}</span> },
    { key: "note", title: "Ghi chú" },
  ];

  const totalQuantity = ledger.balances.reduce((sum, row) => sum + row.quantity, 0);
  const totalAmount = ledger.balances.reduce((sum, row) => sum + row.amount, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hàng vay mượn NVBH"
        subtitle="Theo dõi các cột nhân viên đánh dấu -X và bù trừ khi xuất hàng thực tế."
        actions={
          <div className="flex gap-2">
            <button onClick={() => load().catch((e) => setError(e instanceof Error ? e.message : "Không thể tải dữ liệu."))} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
              <RefreshCw size={16} /> Làm mới
            </button>
            <button onClick={() => fileInput.current?.click()} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
              <Upload size={16} /> Import file -X
            </button>
            <input ref={fileInput} type="file" accept=".xlsx,.xlsm" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} />
          </div>
        }
      />

      {error && <div role="alert" className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      {message && <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard label="Tổng số dư vay (hộp)" value={totalQuantity.toLocaleString("vi-VN")} icon={<span className="text-lg font-bold">−</span>} color="bg-rose-50 text-rose-700" />
        <StatCard label="Tổng số dư vay" value={formatVND(totalAmount)} icon={<span className="text-lg font-bold">−₫</span>} color="bg-rose-50 text-rose-700" />
      </div>
      <p className="text-sm text-gray-500">
        File tổng hợp chỉ có thành tiền theo nhân viên, không có đơn giá từng mã NPP; hệ thống phân bổ thành tiền theo tỷ trọng số lượng khi tạo số dư từng sản phẩm.
      </p>

      {preview && (
        <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div>
            <h2 className="font-semibold text-amber-900">Xác nhận import: {preview.filename}</h2>
            <p className="text-sm text-amber-800">Chưa ghi vào số dư nhân viên cho đến khi bấm xác nhận.</p>
          </div>
          <DataTable data={preview.entries} columns={balanceColumns} searchable={false} pageSize={10} />
          <div className="flex flex-wrap gap-2">
            <button onClick={() => void confirmBatch(preview.batch_id)} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
              <Check size={16} /> Xác nhận ghi nhận
            </button>
            <button onClick={() => void cancelBatch(preview.batch_id)} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-rose-300 px-3 py-2 text-sm text-rose-700 disabled:opacity-50">
              <Trash2 size={16} /> Hủy bản import
            </button>
          </div>
        </section>
      )}

      {ledger.pending_batches.length > 0 && (
        <section className="space-y-3 rounded-xl border border-amber-200 bg-white p-4">
          <h2 className="font-semibold text-gray-900">Import đang chờ xác nhận</h2>
          {ledger.pending_batches.map((batch) => (
            <div key={batch.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 py-3">
              <div><p className="font-medium">{batch.filename}</p><p className="text-xs text-gray-500">{batch.created_by ?? "—"} · {formatDate(batch.created_at)} · {batch.entries.length} dòng</p></div>
              <div className="flex gap-2">
                <button onClick={() => setPreview({ batch_id: batch.id, status: "PENDING", filename: batch.filename, entries: batch.entries, message: "" })} className="rounded-lg border border-gray-200 px-3 py-2 text-sm">Xem</button>
                <button onClick={() => void confirmBatch(batch.id)} disabled={busy} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white disabled:opacity-50">Xác nhận</button>
                <button onClick={() => void cancelBatch(batch.id)} disabled={busy} className="rounded-lg border border-rose-300 px-3 py-2 text-sm text-rose-700 disabled:opacity-50">Hủy</button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">Số dư theo nhân viên và mã NPP</h2>
        <DataTable data={ledger.balances} columns={balanceColumns} searchKeys={["employee_code", "employee_name", "product_code", "product_name"]} pageSize={20} emptyMessage="Chưa có số dư vay mượn." />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">Lịch sử vay và bù trừ</h2>
        <DataTable data={ledger.entries} columns={historyColumns} searchable={false} pageSize={20} emptyMessage="Chưa có giao dịch vay mượn." />
      </section>
    </div>
  );
}

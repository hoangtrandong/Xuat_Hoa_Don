"use client";

import { useCallback, useEffect, useState } from "react";
import { CreditCard, Users, Wallet, AlertTriangle } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import DataTable, { Column } from "@/components/ui/DataTable";
import Badge from "@/components/ui/Badge";
import Drawer from "@/components/ui/Drawer";
import { formatVND, formatDateTime } from "@/lib/format";
import { API_URL } from "@/lib/api";

interface DebtCustomer {
  customer_id: number;
  customer_code: string;
  customer_name: string;
  credit_limit: number;
  current_debt: number;
  open_receivables: number;
}

interface ReceivableRow {
  id: number;
  customer_id: number;
  customer_code: string | null;
  customer_name: string | null;
  order_code: string | null;
  amount: number;
  paid: number;
  balance: number;
  status: string;
  created_at: string;
}

interface DebtSummary {
  total_debt: number;
  customers_in_debt: number;
  open_receivables: number;
  customers: DebtCustomer[];
  recent_receivables: ReceivableRow[];
}

function statusVariant(status: string) {
  if (status === "PAID") return "success";
  if (status === "PARTIAL") return "warning";
  if (status === "OVERDUE") return "danger";
  return "default";
}

function statusLabel(status: string) {
  if (status === "PAID") return "Đã thu";
  if (status === "PARTIAL") return "Thu một phần";
  if (status === "OVERDUE") return "Quá hạn";
  return "Còn nợ";
}

export default function DebtPage() {
  const [summary, setSummary] = useState<DebtSummary | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<DebtCustomer | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("CASH");
  const [reference, setReference] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/debt/summary`);
      if (!response.ok) throw new Error("Không thể tải dữ liệu công nợ.");
      const data = await response.json() as DebtSummary;
      setSummary(data);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tải công nợ.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function submitPayment() {
    if (!selected) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Nhập số tiền thu hợp lệ.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`${API_URL}/payments/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_id: selected.customer_id,
          amount: value,
          method,
          reference: reference.trim() || null,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail ?? "Không thể ghi nhận thanh toán.");
      setMessage(`Đã thu ${formatVND(value)} từ ${selected.customer_name}.`);
      setSelected(null);
      setAmount("");
      setReference("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể ghi nhận thanh toán.");
    } finally {
      setSubmitting(false);
    }
  }

  const customerColumns: Column<DebtCustomer>[] = [
    { key: "customer_code", title: "Mã KH", sortable: true },
    { key: "customer_name", title: "Khách hàng", sortable: true },
    {
      key: "open_receivables",
      title: "Số khoản nợ",
      align: "right",
    },
    {
      key: "credit_limit",
      title: "Hạn mức",
      align: "right",
      render: (val) => formatVND(Number(val) || 0),
    },
    {
      key: "current_debt",
      title: "Công nợ",
      sortable: true,
      align: "right",
      render: (val) => (
        <span className="font-semibold text-rose-600">{formatVND(Number(val) || 0)}</span>
      ),
    },
  ];

  const receivableColumns: Column<ReceivableRow>[] = [
    {
      key: "created_at",
      title: "Ngày",
      render: (val) => formatDateTime(String(val)),
    },
    {
      key: "customer_name",
      title: "Khách hàng",
      render: (_, row) => (
        <div>
          <p className="font-medium text-gray-900">{row.customer_name ?? "—"}</p>
          <p className="text-xs text-gray-400">{row.customer_code}</p>
        </div>
      ),
    },
    { key: "order_code", title: "Đơn bán", render: (val) => String(val ?? "—") },
    {
      key: "balance",
      title: "Còn nợ",
      align: "right",
      render: (val) => formatVND(Number(val) || 0),
    },
    {
      key: "status",
      title: "Trạng thái",
      render: (val) => <Badge variant={statusVariant(String(val))}>{statusLabel(String(val))}</Badge>,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Công nợ & Thanh toán"
        subtitle="Công nợ khách hàng phát sinh khi thủ kho xuất kho thành công theo đơn bán"
      />

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>}
      {message && <div className="bg-emerald-50 text-emerald-700 rounded-lg px-4 py-3 text-sm">{message}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label="Tổng công nợ" value={formatVND(summary?.total_debt ?? 0)} icon={<Wallet size={20} />} color="bg-rose-50 text-rose-600" />
        <StatCard label="Khách đang nợ" value={summary?.customers_in_debt ?? 0} icon={<Users size={20} />} color="bg-amber-50 text-amber-600" />
        <StatCard label="Khoản phải thu mở" value={summary?.open_receivables ?? 0} icon={<AlertTriangle size={20} />} color="bg-sky-50 text-sky-600" />
      </div>

      <DataTable
        data={summary?.customers ?? []}
        columns={customerColumns}
        searchKeys={["customer_code", "customer_name"]}
        searchPlaceholder="Tìm khách hàng đang nợ..."
        onRowClick={(row) => {
          setSelected(row);
          setAmount(String(row.current_debt));
          setMessage("");
          setError("");
        }}
        emptyMessage="Chưa có khách hàng nào đang nợ"
      />

      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Khoản phải thu gần đây</h2>
        <DataTable
          data={summary?.recent_receivables ?? []}
          columns={receivableColumns}
          searchKeys={["customer_name", "customer_code", "order_code"]}
          searchPlaceholder="Tìm khoản phải thu..."
          emptyMessage="Chưa có khoản phải thu từ xuất kho"
        />
      </div>

      <Drawer
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title="Thu công nợ"
        subtitle={selected ? `${selected.customer_code} · ${selected.customer_name}` : ""}
      >
        {selected && (
          <div className="p-5 space-y-4">
            <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
              Công nợ hiện tại: <strong>{formatVND(selected.current_debt)}</strong>
              {selected.credit_limit > 0 && (
                <span className="text-rose-600"> · Hạn mức {formatVND(selected.credit_limit)}</span>
              )}
            </div>
            <label className="block">
              <span className="text-xs text-gray-500">Số tiền thu</span>
              <input
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-500">Hình thức</span>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
              >
                <option value="CASH">Tiền mặt</option>
                <option value="TRANSFER">Chuyển khoản</option>
                <option value="COD">COD</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-gray-500">Tham chiếu (tùy chọn)</span>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Mã giao dịch, số phiếu thu..."
                className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
              />
            </label>
            <button
              onClick={submitPayment}
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-600 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium"
            >
              <CreditCard size={16} />
              {submitting ? "Đang ghi nhận..." : "Ghi nhận thanh toán"}
            </button>
          </div>
        )}
      </Drawer>
    </div>
  );
}

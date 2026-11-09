"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, FileSpreadsheet, RefreshCw } from "lucide-react";
import DataTable, { Column } from "@/components/ui/DataTable";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import { API_URL, apiFetch } from "@/lib/api";
import { formatBorrowStatusText, formatVND } from "@/lib/format";

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

type LedgerResponse = {
  balances: BorrowBalance[];
  entries: BorrowEntry[];
};

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("vi-VN");
}

export default function EmployeeBorrowingPage() {
  const [ledger, setLedger] = useState<LedgerResponse>({ balances: [], entries: [] });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [typeFilter, setTypeFilter] = useState<"ALL" | "BORROW" | "OFFSET">("ALL");
  const [historySearch, setHistorySearch] = useState("");

  async function load() {
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch(`${API_URL}/employee-borrowing/`);
      const result = (await response.json()) as LedgerResponse & { detail?: string };
      if (!response.ok) throw new Error(result.detail ?? "Không thể tải sổ hàng vay mượn NVBH.");
      setLedger({
        balances: result.balances ?? [],
        entries: result.entries ?? [],
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Không thể tải dữ liệu.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const balanceColumns: Column<BorrowBalance>[] = [
    { key: "employee_code", title: "Mã NVBH", sortable: true },
    { key: "employee_name", title: "Tên NVBH", sortable: true },
    { key: "product_code", title: "Mã NPP", sortable: true },
    { key: "product_name", title: "Sản phẩm", sortable: true },
    {
      key: "quantity",
      title: "Số dư (hộp)",
      align: "right",
      sortable: true,
      render: (value) => {
        const num = Number(value);
        return (
          <span className={`font-semibold ${num < 0 ? "text-rose-700" : "text-emerald-700"}`}>
            {num > 0 ? `+${num.toLocaleString("vi-VN")}` : num.toLocaleString("vi-VN")}
          </span>
        );
      },
    },
    {
      key: "amount",
      title: "Số dư thành tiền",
      align: "right",
      sortable: true,
      render: (value) => {
        const num = Number(value);
        return (
          <span className={`font-semibold ${num < 0 ? "text-rose-700" : "text-emerald-700"}`}>
            {formatVND(num)}
          </span>
        );
      },
    },
  ];

  const historyColumns: Column<BorrowEntry>[] = [
    { key: "created_at", title: "Thời gian", sortable: true, render: (value) => formatDate(String(value)) },
    { key: "employee_code", title: "Mã NVBH", sortable: true },
    { key: "employee_name", title: "Tên NVBH", sortable: true },
    { key: "product_code", title: "Mã NPP", sortable: true },
    { key: "product_name", title: "Sản phẩm", sortable: true },
    {
      key: "entry_type",
      title: "Trạng thái",
      render: (value) =>
        value === "BORROW" ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-700">
            <ArrowDownLeft size={12} /> Dương Số
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
            <ArrowUpRight size={12} /> Âm Số
          </span>
        ),
    },
    {
      key: "quantity",
      title: "Số lượng (hộp)",
      align: "right",
      render: (value) => {
        const num = Number(value);
        return (
          <span className={`font-semibold ${num < 0 ? "text-rose-700" : "text-emerald-700"}`}>
            {num > 0 ? `+${num.toLocaleString("vi-VN")}` : num.toLocaleString("vi-VN")}
          </span>
        );
      },
    },
    {
      key: "amount",
      title: "Thành tiền",
      align: "right",
      render: (value) => {
        const num = Number(value);
        return (
          <span className={`font-semibold ${num < 0 ? "text-rose-700" : "text-emerald-700"}`}>
            {formatVND(num)}
          </span>
        );
      },
    },
    { key: "note", title: "Chi tiết đơn / Phiếu xuất", render: (value) => formatBorrowStatusText(String(value ?? "")) },
  ];

  const filteredEntries = useMemo(() => {
    const q = historySearch.trim().toLocaleLowerCase("vi");
    return ledger.entries.filter((entry) => {
      if (typeFilter !== "ALL" && entry.entry_type !== typeFilter) return false;
      if (!q) return true;
      return (
        entry.employee_code.toLocaleLowerCase("vi").includes(q) ||
        entry.employee_name.toLocaleLowerCase("vi").includes(q) ||
        entry.product_code.toLocaleLowerCase("vi").includes(q) ||
        entry.product_name.toLocaleLowerCase("vi").includes(q) ||
        (entry.note ?? "").toLocaleLowerCase("vi").includes(q)
      );
    });
  }, [ledger.entries, typeFilter, historySearch]);

  const totalQuantity = ledger.balances.reduce((sum, row) => sum + row.quantity, 0);
  const totalAmount = ledger.balances.reduce((sum, row) => sum + row.amount, 0);
  const borrowCount = ledger.entries.filter((e) => e.entry_type === "BORROW").length;
  const offsetCount = ledger.entries.filter((e) => e.entry_type === "OFFSET").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hàng vay mượn NVBH"
        subtitle="Theo dõi trạng thái Dương Số (-SL, -Tiền) và bù trừ Âm Số (+SL, +Tiền) của NVBH từ dữ liệu đơn hàng DMS."
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void load()}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw size={16} className={busy ? "animate-spin" : ""} /> Làm mới
            </button>
            <Link
              href="/inventory"
              className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-sky-700"
            >
              <FileSpreadsheet size={16} /> Tạo yêu cầu xuất kho (Upload DSDonHang)
            </Link>
          </div>
        }
      />

      {error && (
        <div role="alert" className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Tổng số dư vay (hộp)"
          value={totalQuantity.toLocaleString("vi-VN")}
          icon={<span className="text-lg font-bold">−</span>}
          color="bg-rose-50 text-rose-700"
        />
        <StatCard
          label="Tổng số dư thành tiền"
          value={formatVND(totalAmount)}
          icon={<span className="text-lg font-bold">−₫</span>}
          color="bg-rose-50 text-rose-700"
        />
        <StatCard
          label="Giao dịch Dương Số / Âm Số"
          value={`${borrowCount} Dương · ${offsetCount} Âm`}
          icon={<ArrowUpRight size={20} />}
          color="bg-sky-50 text-sky-700"
        />
      </div>

      <div className="rounded-xl border border-sky-100 bg-sky-50/60 px-4 py-3 text-xs text-sky-900">
        <strong>Quy tắc hạch toán mới:</strong> Khi upload file <code>DSDonHang</code> để tạo Yêu cầu xuất kho, các đơn trạng thái{" "}
        <span className="font-semibold text-rose-700">Dương Số</span> được ghi nhận âm (<code>-SL</code>, <code>-Tiền</code>) theo{" "}
        <strong>NVBH trên DMS</strong> ngay khi tạo yêu cầu; các đơn trạng thái{" "}
        <span className="font-semibold text-emerald-700">Âm Số</span> sẽ tự động ghi nhận dương (<code>+SL</code>, <code>+Tiền</code>) và bù trừ vào số dư của NVBH ngay khi Thủ kho bấm{" "}
        <strong>Hoàn tất xuất kho thực tế</strong>.
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">Số dư Dương Số / Âm Số theo NVBH và mã NPP</h2>
        <DataTable
          data={ledger.balances}
          columns={balanceColumns}
          searchKeys={["employee_code", "employee_name", "product_code", "product_name"]}
          pageSize={20}
          emptyMessage="Chưa có số dư Dương Số / Âm Số của NVBH."
        />
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-gray-900">Lịch sử Dương Số và Âm Số</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
              placeholder="Tìm NVBH, mã NPP, số đơn, phiếu xuất..."
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs focus:border-sky-500 focus:outline-none"
            />
            <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-xs">
              {[
                { key: "ALL", label: "Tất cả" },
                { key: "BORROW", label: "Dương Số" },
                { key: "OFFSET", label: "Âm Số" },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setTypeFilter(tab.key as "ALL" | "BORROW" | "OFFSET")}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                    typeFilter === tab.key ? "bg-sky-600 text-white" : "text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <DataTable
          data={filteredEntries}
          columns={historyColumns}
          searchable={false}
          pageSize={20}
          emptyMessage="Chưa có giao dịch Dương Số hoặc Âm Số."
        />
      </section>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRightLeft, CheckCircle2, XCircle, Clock, Plus } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import DataTable, { Column } from "@/components/ui/DataTable";
import Badge from "@/components/ui/Badge";
import { formatVND, formatDateTime } from "@/lib/format";
import { API_URL, apiFetch } from "@/lib/api";

interface DebtTransferItem {
  id: number;
  code: string;
  from_employee_id: number;
  to_store_id: number;
  amount: number;
  reason: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  requested_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

interface EmployeeItem {
  id: number;
  code: string;
  name: string;
}

interface StoreItem {
  id: number;
  code: string;
  name: string;
}

function statusBadge(status: string) {
  switch (status) {
    case "APPROVED":
      return <Badge variant="success">Đã duyệt</Badge>;
    case "REJECTED":
      return <Badge variant="danger">Đã từ chối</Badge>;
    case "PENDING":
    default:
      return <Badge variant="warning">Chờ duyệt</Badge>;
  }
}

export default function DebtTransfersPage() {
  const [transfers, setTransfers] = useState<DebtTransferItem[]>([]);
  const [employees, setEmployees] = useState<Map<number, EmployeeItem>>(new Map());
  const [stores, setStores] = useState<Map<number, StoreItem>>(new Map());
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const fetchTransfers = useCallback(async () => {
    try {
      setLoading(true);
      const url = statusFilter === "ALL" ? `${API_URL}/debt-transfers` : `${API_URL}/debt-transfers?status=${statusFilter}`;
      const res = await apiFetch(url);
      if (!res.ok) throw new Error("Không thể tải danh sách chuyển nợ.");
      const data = await res.json();
      setTransfers(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Lỗi khi tải dữ liệu.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  const fetchLookups = useCallback(async () => {
    try {
      const [empRes, storeRes] = await Promise.all([
        apiFetch(`${API_URL}/employees/?limit=500`),
        apiFetch(`${API_URL}/stores/?limit=500`),
      ]);
      if (empRes.ok) {
        const empData: EmployeeItem[] = await empRes.json();
        setEmployees(new Map(empData.map((e) => [e.id, e])));
      }
      if (storeRes.ok) {
        const storeData: StoreItem[] = await storeRes.json();
        setStores(new Map(storeData.map((s) => [s.id, s])));
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchLookups();
  }, [fetchLookups]);

  useEffect(() => {
    fetchTransfers();
  }, [fetchTransfers]);

  const handleApprove = async (id: number) => {
    if (!confirm("Bạn có chắc chắn muốn DUYỆT chuyển công nợ này? Bút toán giảm nợ NV và tăng nợ Cửa hàng sẽ được ghi ngay lập tức.")) return;
    setActionLoading(id);
    setError("");
    setMessage("");
    try {
      const res = await apiFetch(`${API_URL}/debt-approvals/transfers/${id}/approve`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Không thể duyệt chuyển nợ.");
      setMessage("Đã duyệt chuyển công nợ thành công!");
      fetchTransfers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Lỗi khi duyệt.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (id: number) => {
    const reason = prompt("Nhập lý do từ chối (tùy chọn):");
    if (reason === null) return;
    setActionLoading(id);
    setError("");
    setMessage("");
    try {
      const res = await apiFetch(`${API_URL}/debt-approvals/transfers/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Không thể từ chối.");
      setMessage("Đã từ chối đề nghị chuyển nợ.");
      fetchTransfers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Lỗi khi từ chối.");
    } finally {
      setActionLoading(null);
    }
  };

  const columns: Column<DebtTransferItem>[] = [
    {
      key: "code",
      title: "Mã đề nghị",
      render: (_, r) => <span className="font-semibold text-gray-900 font-mono text-xs">{r.code}</span>,
    },
    {
      key: "from_employee_id",
      title: "NV chuyển nợ",
      render: (_, r) => {
        const emp = employees.get(r.from_employee_id);
        return (
          <div>
            <div className="font-medium text-gray-800">{emp ? `${emp.code} - ${emp.name}` : `NV #${r.from_employee_id}`}</div>
            <div className="text-xs text-gray-400">Người lập: {r.requested_by || "—"}</div>
          </div>
        );
      },
    },
    {
      key: "to_store_id",
      title: "Cửa hàng nhận nợ",
      render: (_, r) => {
        const st = stores.get(r.to_store_id);
        return <span className="font-medium text-gray-800">{st ? `${st.code} - ${st.name}` : `CH #${r.to_store_id}`}</span>;
      },
    },
    {
      key: "amount",
      title: "Số tiền chuyển",
      align: "right",
      render: (_, r) => <span className="font-mono font-bold text-gray-900">{formatVND(r.amount)}</span>,
    },
    {
      key: "reason",
      title: "Lý do / Giải trình",
      render: (_, r) => <span className="text-xs text-gray-600">{r.reason || "—"}</span>,
    },
    {
      key: "status",
      title: "Trạng thái",
      align: "center",
      render: (_, r) => statusBadge(r.status),
    },
    {
      key: "created_at",
      title: "Thời gian",
      render: (_, r) => <span className="text-xs text-gray-500">{formatDateTime(r.created_at)}</span>,
    },
    {
      key: "actions",
      title: "Duyệt (Kế toán)",
      align: "right",
      render: (_, r) => {
        if (r.status !== "PENDING") {
          return (
            <span className="text-xs text-gray-400">
              {r.approved_by ? `Bởi: ${r.approved_by}` : "Đã xử lý"}
            </span>
          );
        }
        return (
          <div className="flex items-center justify-end gap-1.5">
            <button
              disabled={actionLoading === r.id}
              onClick={() => handleApprove(r.id)}
              className="p-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 rounded flex items-center gap-1 border border-emerald-300 disabled:opacity-50"
              title="Duyệt chuyển nợ"
            >
              <CheckCircle2 size={13} /> Duyệt
            </button>
            <button
              disabled={actionLoading === r.id}
              onClick={() => handleReject(r.id)}
              className="p-1.5 text-xs font-medium text-red-700 hover:bg-red-50 rounded flex items-center gap-1 border border-red-200 disabled:opacity-50"
              title="Từ chối chuyển nợ"
            >
              <XCircle size={13} /> Từ chối
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quản lý Chuyển Công nợ (NVGH → Cửa hàng)"
        subtitle="Quy trình kế toán duyệt chuyển công nợ khi nhân viên giao hàng xác nhận cửa hàng nợ tiền hàng"
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

      {/* Filter Tabs */}
      <div className="flex gap-2 border-b border-gray-200 pb-2">
        {[
          { key: "ALL", label: "Tất cả đề nghị" },
          { key: "PENDING", label: "Chờ duyệt" },
          { key: "APPROVED", label: "Đã duyệt" },
          { key: "REJECTED", label: "Đã từ chối" },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              statusFilter === tab.key
                ? "bg-sky-500 text-white"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        {loading ? (
          <div className="py-8 text-center text-sm text-gray-500">Đang tải danh sách đề nghị chuyển nợ...</div>
        ) : (
          <DataTable
            columns={columns}
            data={transfers}
            searchable={true}
            searchPlaceholder="Tìm kiếm theo mã đề nghị hoặc lý do..."
            searchKeys={["code", "reason"]}
          />
        )}
      </div>
    </div>
  );
}

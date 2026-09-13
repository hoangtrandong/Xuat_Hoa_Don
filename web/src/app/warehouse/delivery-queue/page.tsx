"use client";
// src/app/warehouse/delivery-queue/page.tsx
import { useEffect, useState } from "react";
import {
  ClipboardList, Package, CheckCircle2, Truck,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import DataTable, { Column } from "@/components/ui/DataTable";
import Badge from "@/components/ui/Badge";
import Drawer from "@/components/ui/Drawer";
import { API_URL } from "@/lib/api";

type DeliveryRequest = {
  id: number;
  code: string;
  warehouse_id: number;
  status: "DRAFT" | "SUBMITTED" | "RECEIVED" | "COMPLETED";
  note: string | null;
  created_by: string | null;
  submitted_at: string | null;
  received_at: string | null;
  completed_at: string | null;
  created_at: string;
  items: {
    id: number;
    product_id: number;
    sku: string;
    product_name: string;
    quantity: number;
    requested_quantity_raw: string | null;
    available_quantity: number;
    shortage_quantity: number;
  }[];
};

const statusLabel: Record<string, string> = {
  DRAFT: "Nháp",
  SUBMITTED: "Chờ nhận",
  RECEIVED: "Đang xuất",
  COMPLETED: "Hoàn thành",
  CANCELLED: "Đã hủy",
};

const statusVariant: Record<string, "default" | "info" | "warning" | "success" | "danger"> = {
  DRAFT: "default",
  SUBMITTED: "warning",
  RECEIVED: "info",
  COMPLETED: "success",
  CANCELLED: "danger",
};

export default function DeliveryQueuePage() {
  const [rows, setRows] = useState<DeliveryRequest[]>([]);
  const [selected, setSelected] = useState<DeliveryRequest | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const [statusFilter, setStatusFilter] = useState<"SUBMITTED" | "RECEIVED">("SUBMITTED");

  // Polling mỗi 5s để cập nhật trạng thái thời gian thực.
  useEffect(() => {
    const timer = window.setTimeout(() => load(), 5000);
    return () => window.clearTimeout(timer);
  }, [statusFilter]);

  async function load() {
    try {
      const response = await fetch(`${API_URL}/delivery-requests/`);
      if (!response.ok) throw new Error("Không thể tải hàng đợi yêu cầu.");
      const data: DeliveryRequest[] = await response.json();
      const sorted = data.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      
      const filtered = sorted.filter(r => r.status === statusFilter);
      setRows(filtered);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể tải dữ liệu.");
    }
  }

  useEffect(() => { load(); }, [statusFilter]);

  async function transition(id: number, action: "receive" | "complete" | "cancel") {
    setError(""); setMessage(""); setLoading(true);
    try {
      const response = await fetch(`${API_URL}/delivery-requests/${id}/${action}`, { method: "POST" });
      const result = await response.json().catch(() => ({})) as { detail?: string };
      if (!response.ok) {
        let actionStr = action === "receive" ? "nhận" : action === "complete" ? "hoàn thành" : "hủy";
        throw new Error(result.detail ?? `Không thể ${actionStr} yêu cầu.`);
      }
      let successMsg = action === "receive" ? "Đã nhận yêu cầu, tiến hành xuất kho." : 
                       action === "complete" ? "Đã xuất kho hoàn thành, tồn kho đã trừ." : 
                       "Đã hủy yêu cầu thành công.";
      setMessage(successMsg);
      setSelected(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Thao tác thất bại.");
    } finally {
      setLoading(false);
    }
  }

  const submittedCount = rows.filter((r) => r.status === "SUBMITTED").length;
  const receivedCount = rows.filter((r) => r.status === "RECEIVED").length;
  const totalItems = rows.reduce((sum, r) => sum + r.items.length, 0);

  const columns: Column<DeliveryRequest>[] = [
    { key: "code", title: "Mã yêu cầu", sortable: true },
    {
      key: "items",
      title: "Số SKU",
      align: "center",
      render: (_, row) => <span className="font-medium">{row.items.length}</span>,
    },
    {
      key: "created_by",
      title: "Người tạo",
      render: (val) => <span className="text-gray-600">{val ? String(val) : "—"}</span>,
    },
    {
      key: "submitted_at",
      title: "Giờ gửi",
      sortable: true,
      render: (_, row) => (
        <span className="text-gray-600 text-xs">
          {row.submitted_at ? new Date(row.submitted_at).toLocaleString("vi-VN") : "—"}
        </span>
      ),
    },
    {
      key: "status",
      title: "Trạng thái",
      sortable: true,
      render: (val) => <Badge variant={statusVariant[String(val)] ?? "default"}>{statusLabel[String(val)] ?? String(val)}</Badge>,
    },
  ];
return (
    <div className="space-y-6">
      <PageHeader
        title="Hàng đợi xuất kho"
        subtitle="Nhận yêu cầu giao hàng từ admin và xác nhận sau khi xuất kho hoàn thành"
      />

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>}
      {message && <div className="bg-emerald-50 text-emerald-700 rounded-lg px-4 py-3 text-sm">{message}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Chờ nhận" value={submittedCount} icon={<ClipboardList size={20} />} color="bg-amber-50 text-amber-600" />
        <StatCard label="Đang xuất" value={receivedCount} icon={<Package size={20} />} color="bg-sky-50 text-sky-600" />
        <StatCard label="Tổng SKU chờ xử lý" value={totalItems} icon={<Truck size={20} />} color="bg-purple-50 text-purple-600" />
        <StatCard label="Tổng yêu cầu" value={rows.length} icon={<CheckCircle2 size={20} />} color="bg-emerald-50 text-emerald-600" />
      </div>

      <div className="flex space-x-2 border-b border-gray-200 pb-2">
        <button
          onClick={() => setStatusFilter("SUBMITTED")}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg ${statusFilter === "SUBMITTED" ? "bg-blue-50 text-blue-600 border-b-2 border-blue-600" : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"}`}
        >
          Chờ nhận
        </button>
        <button
          onClick={() => setStatusFilter("RECEIVED")}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg ${statusFilter === "RECEIVED" ? "bg-blue-50 text-blue-600 border-b-2 border-blue-600" : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"}`}
        >
          Đang xuất
        </button>
      </div>

      <DataTable
        data={rows}
        columns={columns}
        searchKeys={["code", "created_by", "note"]}
        searchPlaceholder="Tìm mã yêu cầu, người tạo..."
        onRowClick={(row) => setSelected(row)}
        emptyMessage="Không có yêu cầu xuất kho nào cần xử lý"
      />
<Drawer open={selected !== null} onClose={() => setSelected(null)} title="Chi tiết yêu cầu xuất kho" subtitle={selected?.code}>
        {selected && (
          <div className="p-5 space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-sky-500 flex items-center justify-center flex-shrink-0">
                <ClipboardList size={20} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-gray-900 text-sm truncate">{selected.code}</p>
                <p className="text-xs text-gray-400">Kho #{selected.warehouse_id} · {selected.items.length} SKU</p>
              </div>
              <Badge variant={statusVariant[selected.status] ?? "default"}>{statusLabel[selected.status]}</Badge>
            </div>

            {selected.note && (
              <div className="rounded-xl bg-gray-50 px-4 py-3">
                <p className="text-xs text-gray-400 mb-1">Ghi chú</p>
                <p className="text-sm text-gray-700">{selected.note}</p>
              </div>
            )}

            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Danh sách sản phẩm</h4>
              <div className="rounded-xl border border-gray-100 divide-y divide-gray-50">
                {selected.items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{item.product_name}</p>
                      <p className="text-xs text-gray-400">{item.sku}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-gray-900">{item.quantity}</p>
                      <p className="text-xs text-gray-400">Yêu cầu</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setSelected(null)}
                className="rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                Đóng
              </button>
              {selected.status === "SUBMITTED" && (
                <button
                  onClick={() => transition(selected.id, "receive")}
                  disabled={loading}
                  className="rounded-lg bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white py-2.5 text-sm font-medium transition-colors"
                >
                  {loading ? "Đang xử lý..." : "Nhận yêu cầu"}
                </button>
              )}
              {selected.status === "RECEIVED" && (
                <button
                  onClick={() => transition(selected.id, "complete")}
                  disabled={loading}
                  className="rounded-lg bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white py-2.5 text-sm font-medium transition-colors"
                >
                  {loading ? "Đang xử lý..." : "Xuất xong"}
                </button>
              )}
              {selected.status === "COMPLETED" && (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 py-2.5 text-sm font-medium text-emerald-700 text-center">
                  ✓ Đã hoàn thành
                </div>
              )}
              {selected.status === "CANCELLED" && (
                <div className="rounded-lg bg-red-50 border border-red-200 py-2.5 text-sm font-medium text-red-700 text-center">
                  ✗ Đã hủy
                </div>
              )}
            </div>
            {(selected.status === "SUBMITTED" || selected.status === "RECEIVED") && (
              <div className="grid grid-cols-1">
                <button
                  onClick={() => transition(selected.id, "cancel")}
                  disabled={loading}
                  className="rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-600 py-2 text-sm font-medium transition-colors mt-2"
                >
                  {loading ? "Đang xử lý..." : "Hủy yêu cầu"}
                </button>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  PackageCheck,
  X,
} from "lucide-react";
import { API_URL, apiFetch } from "@/lib/api";
import { formatDateTime, formatNumber, formatVNDFull } from "@/lib/format";

export interface DeliveryReturnItemRecord {
  id: number;
  delivery_return_id: number;
  product_id: number;
  sku: string | null;
  product_name: string | null;
  quantity: number;
  actual_received_qty: number | null;
  cartons: number;
  loose_boxes: number;
  unit_price: number;
  amount: number;
  reason: string | null;
  location_id: number | null;
  location_code: string | null;
  lot_id: number | null;
  lot_number: string | null;
  expiry_date: string | null;
  item_condition: "GOOD" | "DAMAGED" | "EXPIRED" | string;
  damage_resolution: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
}

export interface DeliveryReturnRecord {
  id: number;
  code: string;
  delivery_request_id: number;
  delivery_request_code: string | null;
  employee_id: number;
  employee_code: string | null;
  employee_name: string | null;
  order_id: number | null;
  order_number: string | null;
  customer_code: string | null;
  customer_name: string | null;
  return_type: string;
  replacement_order_number: string | null;
  amount: number;
  status: string;
  settlement_party_type: string;
  settlement_party_id: number | null;
  note: string | null;
  created_by: string | null;
  approved_by: string | null;
  warehouse_received_by: string | null;
  warehouse_received_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  reject_reason: string | null;
  created_at: string;
  items: DeliveryReturnItemRecord[];
}

interface ReceiveEditRow {
  item_id: number;
  actual_received_qty: number;
  item_condition: "GOOD" | "DAMAGED" | "EXPIRED";
}

interface WarehouseReceiveReturnModalProps {
  record: DeliveryReturnRecord | null;
  onClose: () => void;
  onUpdated: (msg: string) => void;
}

const inputCls =
  "w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-slate-100";

export default function WarehouseReceiveReturnModal({
  record,
  onClose,
  onUpdated,
}: WarehouseReceiveReturnModalProps) {
  const [rows, setRows] = useState<Record<number, ReceiveEditRow>>({});
  const [restoreStock, setRestoreStock] = useState(true);
  const [warehouseNote, setWarehouseNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resolvingItemId, setResolvingItemId] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!record) return;
    const init: Record<number, ReceiveEditRow> = {};
    for (const it of record.items) {
      init[it.id] = {
        item_id: it.id,
        actual_received_qty: it.actual_received_qty ?? it.quantity,
        item_condition:
          it.item_condition === "DAMAGED" || it.item_condition === "EXPIRED"
            ? it.item_condition
            : "GOOD",
      };
    }
    setRows(init);
    setRestoreStock(true);
    setWarehouseNote("");
    setError("");
  }, [record]);

  if (!record) return null;

  const isPending = record.status === "PENDING_WAREHOUSE";

  const previewGoodCredit = record.items.length
    ? record.items.reduce((sum, it) => {
        const edit = rows[it.id];
        const qty = isPending
          ? (edit?.actual_received_qty ?? it.quantity)
          : (it.actual_received_qty ?? it.quantity);
        const cond = isPending ? (edit?.item_condition ?? "GOOD") : it.item_condition;
        const unitPrice =
          it.unit_price > 0 ? it.unit_price : it.quantity > 0 ? it.amount / it.quantity : 0;
        return cond === "GOOD" ? sum + qty * unitPrice : sum;
      }, 0)
    : record.amount;

  async function handleConfirmReceive() {
    if (!record) return;
    setSubmitting(true);
    setError("");
    try {
      const itemsPayload = record.items.map((it) => {
        const edit = rows[it.id];
        return {
          item_id: it.id,
          actual_received_qty: edit?.actual_received_qty ?? it.quantity,
          item_condition: edit?.item_condition ?? "GOOD",
        };
      });
      const res = await apiFetch(`${API_URL}/delivery-returns/${record.id}/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: itemsPayload,
          restore_stock: restoreStock,
          note: warehouseNote.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail ?? "Không thể xác nhận nhập kho hàng trả.");
      }
      onUpdated(
        `Thủ kho đã xác nhận nhận hàng phiếu ${record.code} thành công & tự động giảm công nợ cho NV ${record.employee_code || ""}.`
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi xác nhận nhập kho.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResolveDamage(
    itemId: number,
    resolution: "CHARGE_EMPLOYEE" | "COMPANY_ABSORB"
  ) {
    if (!record) return;
    setResolvingItemId(itemId);
    setError("");
    try {
      const res = await apiFetch(
        `${API_URL}/delivery-returns/${record.id}/items/${itemId}/resolve-damage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            resolution,
            note:
              resolution === "COMPANY_ABSORB"
                ? "Admin duyệt miễn trừ hàng hỏng (Công ty chịu)"
                : "Admin duyệt giữ công nợ đền bù hàng hỏng cho NVGH",
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail ?? "Không thể xử lý hàng hỏng.");
      }
      onUpdated(
        resolution === "COMPANY_ABSORB"
          ? "Đã duyệt miễn trừ hàng hỏng & tự động giảm công nợ cho nhân viên."
          : "Đã duyệt giữ công nợ đền bù hàng hỏng cho nhân viên."
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi xử lý hàng hỏng.");
    } finally {
      setResolvingItemId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col border border-slate-400 bg-white shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between bg-[#14263d] px-3 py-2 text-white">
          <div className="flex items-center gap-2">
            <PackageCheck size={17} className="text-red-500" />
            <h2 className="text-xs font-bold uppercase tracking-wide text-white">
              {isPending
                ? `Thủ kho kiểm đếm & Xác nhận nhận hàng trả — ${record.code}`
                : `Chi tiết phiếu trả hàng — ${record.code}`}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-white hover:bg-white/10"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="mx-3 mt-2.5 flex items-center gap-2 rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
              <AlertTriangle size={14} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Metadata grid */}
          <div className="grid gap-x-3 gap-y-2 border-b border-slate-200 px-3 py-2.5 sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <div className="text-[10px] font-semibold text-slate-500">Phiếu xuất kho / Đơn cũ</div>
              <div className="text-xs font-bold text-slate-800">
                {record.delivery_request_code || `#${record.delivery_request_id}`}
              </div>
              <div className="text-[11px] text-slate-600">{record.order_number || "—"}</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-slate-500">Loại / Đơn thay thế</div>
              {record.return_type === "ORDER_REPLACEMENT" && record.replacement_order_number ? (
                <div className="mt-0.5 flex items-center gap-1 text-xs font-bold text-sky-700">
                  <span>{record.order_number}</span>
                  <ArrowRight size={11} />
                  <span>{record.replacement_order_number}</span>
                </div>
              ) : (
                <div className="text-xs font-semibold text-slate-700">Trả hàng chuyến xe</div>
              )}
              <div className="text-[10px] text-slate-500">
                Tạo bởi: {record.created_by || "—"} ({formatDateTime(record.created_at)})
              </div>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-slate-500">NVGH giảm công nợ</div>
              <div className="text-xs font-bold text-slate-800">
                {record.employee_code} {record.employee_name ? `- ${record.employee_name}` : ""}
              </div>
              <div className="text-[11px] text-slate-600">
                KH: {record.customer_code ? `[${record.customer_code}] ` : ""}
                {record.customer_name || "—"}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-slate-500">
                Giá trị giảm công nợ (Hàng GOOD)
              </div>
              <div className="text-sm font-bold text-emerald-700">
                {formatVNDFull(previewGoodCredit)}
              </div>
              <div className="text-[10px] text-slate-500">
                Tổng phiếu: {formatVNDFull(record.amount)}
              </div>
            </div>
          </div>

          {/* Items Table */}
          <div className="border-b border-sky-100 bg-sky-50/60 px-3 py-2 text-[11px] font-bold uppercase text-sky-800">
            Danh sách sản phẩm yêu cầu trả về kho ({record.items.length} dòng)
          </div>

          <div className="overflow-x-auto px-3 py-2.5">
            {record.items.length === 0 ? (
              <div className="rounded border border-slate-200 bg-slate-50 py-4 text-center text-xs text-slate-500">
                Phiếu trả hàng theo tổng tiền ({formatVNDFull(record.amount)}), không có dòng SKU chi tiết.
              </div>
            ) : (
              <table className="w-full border-collapse text-left">
                <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600">
                  <tr>
                    <th className="px-2 py-1.5">Mã NPP</th>
                    <th className="px-2 py-1.5">Sản phẩm</th>
                    <th className="px-2 py-1.5 text-center">SL Yêu cầu</th>
                    <th className="px-2 py-1.5 text-center">SL Thực nhận</th>
                    <th className="px-2 py-1.5">Tình trạng hàng</th>
                    <th className="px-2 py-1.5">Vị trí / Lô</th>
                    <th className="px-2 py-1.5 text-right">Đơn giá</th>
                    <th className="px-2 py-1.5 text-right">Thành tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {record.items.map((it) => {
                    const edit = rows[it.id];
                    const actualQty = isPending
                      ? (edit?.actual_received_qty ?? it.quantity)
                      : (it.actual_received_qty ?? it.quantity);
                    const cond = isPending ? (edit?.item_condition ?? "GOOD") : it.item_condition;
                    const unitPrice =
                      it.unit_price > 0
                        ? it.unit_price
                        : it.quantity > 0
                        ? it.amount / it.quantity
                        : 0;
                    const lineAmt = actualQty * unitPrice;

                    return (
                      <tr
                        key={it.id}
                        className="border-b border-slate-100 text-[11px] even:bg-amber-50/40 hover:bg-sky-50/50"
                      >
                        <td className="px-2 py-1.5 font-mono font-semibold text-slate-700">
                          {it.sku || `#${it.product_id}`}
                        </td>
                        <td className="px-2 py-1.5 text-slate-800">
                          <div>{it.product_name || "—"}</div>
                          {it.damage_resolution === "PENDING" && (
                            <div className="mt-1 flex items-center gap-1.5">
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                                Chờ Admin duyệt hàng hỏng
                              </span>
                              <button
                                type="button"
                                disabled={resolvingItemId === it.id}
                                onClick={() => handleResolveDamage(it.id, "COMPANY_ABSORB")}
                                className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-emerald-700"
                              >
                                Miễn trừ (Giảm CN)
                              </button>
                              <button
                                type="button"
                                disabled={resolvingItemId === it.id}
                                onClick={() => handleResolveDamage(it.id, "CHARGE_EMPLOYEE")}
                                className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-rose-700"
                              >
                                NVGH đền bù
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-center font-semibold text-slate-700">
                          {formatNumber(it.quantity)}
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          {isPending ? (
                            <input
                              type="number"
                              min={0}
                              max={it.quantity}
                              value={actualQty}
                              onChange={(e) => {
                                const val = Math.max(
                                  0,
                                  Math.min(it.quantity, Number(e.target.value) || 0)
                                );
                                setRows((prev) => ({
                                  ...prev,
                                  [it.id]: {
                                    item_id: it.id,
                                    actual_received_qty: val,
                                    item_condition: prev[it.id]?.item_condition ?? "GOOD",
                                  },
                                }));
                              }}
                              className="w-16 rounded border border-slate-300 px-1.5 py-0.5 text-center text-xs font-semibold text-slate-800 focus:border-sky-500 focus:outline-none"
                            />
                          ) : (
                            <span className="font-semibold text-emerald-700">
                              {formatNumber(actualQty)}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          {isPending ? (
                            <select
                              value={cond}
                              onChange={(e) =>
                                setRows((prev) => ({
                                  ...prev,
                                  [it.id]: {
                                    item_id: it.id,
                                    actual_received_qty:
                                      prev[it.id]?.actual_received_qty ?? it.quantity,
                                    item_condition: e.target.value as
                                      | "GOOD"
                                      | "DAMAGED"
                                      | "EXPIRED",
                                  },
                                }))
                              }
                              className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] text-slate-800 focus:border-sky-500 focus:outline-none"
                            >
                              <option value="GOOD">Hàng tốt (Bán lại)</option>
                              <option value="DAMAGED">Hàng hỏng (Cách ly)</option>
                              <option value="EXPIRED">Hết hạn (Cách ly)</option>
                            </select>
                          ) : (
                            <span
                              className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                cond === "GOOD"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : "bg-rose-100 text-rose-700"
                              }`}
                            >
                              {cond === "GOOD"
                                ? "Hàng tốt"
                                : cond === "DAMAGED"
                                ? "Hàng hỏng"
                                : "Hết hạn"}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-[10px] text-slate-500">
                          {it.location_code || "Theo lô xuất gốc"}
                          {it.lot_number ? ` / ${it.lot_number}` : ""}
                        </td>
                        <td className="px-2 py-1.5 text-right font-medium text-slate-700">
                          {formatVNDFull(unitPrice)}
                        </td>
                        <td className="px-2 py-1.5 text-right font-semibold text-slate-800">
                          {formatVNDFull(lineAmt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {/* Warehouse Confirmation Options */}
            {isPending ? (
              <div className="mt-3 grid gap-2 border-t border-slate-200 pt-2.5 sm:grid-cols-2">
                <div>
                  <label className="mb-0.5 block text-[10px] font-semibold text-slate-600">
                    Ghi chú của thủ kho khi nhận hàng
                  </label>
                  <input
                    type="text"
                    value={warehouseNote}
                    onChange={(e) => setWarehouseNote(e.target.value)}
                    placeholder="VD: Đã kiểm đếm đủ hàng, nguyên đai nguyên kiện..."
                    className={inputCls}
                  />
                </div>
                <div className="flex items-end pb-1">
                  <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={restoreStock}
                      onChange={(e) => setRestoreStock(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                    />
                    <span>Tự động cộng tồn kho (FEFO theo lô xuất kho gốc)</span>
                  </label>
                </div>
              </div>
            ) : (
              <div className="mt-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <div>
                  <strong>Ghi chú:</strong> {record.note || "—"}
                </div>
                {record.warehouse_received_by && (
                  <div className="mt-1 text-emerald-700">
                    <strong>Thủ kho xác nhận:</strong> {record.warehouse_received_by} lúc{" "}
                    {formatDateTime(record.warehouse_received_at || "")}
                  </div>
                )}
                {record.reject_reason && (
                  <div className="mt-1 text-rose-700">
                    <strong>Lý do hủy:</strong> {record.reject_reason} ({record.rejected_by})
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-slate-300 bg-slate-100 px-3 py-2">
          <span className="text-[10px] text-slate-500">
            {isPending
              ? "Xác nhận nhận hàng sẽ chuyển trạng thái Thành công, cộng tồn kho & tự động giảm công nợ cho nhân viên."
              : `Trạng thái hiện tại: ${record.status}`}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded bg-red-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-800"
            >
              Đóng
            </button>
            {isPending && (
              <button
                type="button"
                disabled={submitting}
                onClick={handleConfirmReceive}
                className="inline-flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {submitting ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <CheckCircle2 size={13} />
                )}
                Xác nhận đã nhận đủ hàng &amp; Giảm công nợ
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

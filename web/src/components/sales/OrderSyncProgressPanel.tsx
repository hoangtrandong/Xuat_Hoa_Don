"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";

export interface SyncSourceProgressItem {
  id: number;
  code: string;
  name: string;
  status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";
  stage: string;
  raw_rows?: number;
  new_orders?: number;
  updated_orders?: number;
  new_lines?: number;
  updated_lines?: number;
  message?: string;
}

export interface SyncProgressLogEntry {
  time: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
}

export interface SyncProgressState {
  visible: boolean;
  phase: "preparing" | "running" | "success" | "failed";
  title: string;
  progress: number;
  message: string;
  startedAt: number;
  finishedAt: number | null;
  items: SyncSourceProgressItem[];
  logs: SyncProgressLogEntry[];
  summary?: {
    new_orders?: number;
    updated_orders?: number;
    new_lines?: number;
    updated_lines?: number;
    unchanged_lines?: number;
    failed_sources?: number;
    total_sources?: number;
  };
}

interface OrderSyncProgressPanelProps {
  state: SyncProgressState | null;
  onClose: () => void;
}

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatLogTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function OrderSyncProgressPanel({
  state,
  onClose,
}: OrderSyncProgressPanelProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [showLogs, setShowLogs] = useState(true);

  const isActive =
    Boolean(state?.visible) &&
    (state?.phase === "preparing" || state?.phase === "running");

  useEffect(() => {
    if (!isActive) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isActive]);

  if (!state || !state.visible) return null;

  const isPreparing = state.phase === "preparing";
  const isRunning = state.phase === "running";
  const isSuccess = state.phase === "success";
  const isFailed = state.phase === "failed";
  const elapsedMs = (state.finishedAt ?? nowMs) - state.startedAt;

  const pipelineSteps = [
    {
      label: "1. Tải cấu hình nguồn NCC",
      done: !isPreparing && !isFailed,
      active: isPreparing,
    },
    {
      label: "2. Kết nối & đồng bộ đơn hàng",
      done: isSuccess,
      active: isRunning,
    },
    {
      label: "3. Đối soát & cập nhật danh sách",
      done: isSuccess,
      active: false,
    },
  ];

  return (
    <section
      aria-live="polite"
      className="border border-slate-400 bg-white shadow-lg overflow-hidden"
    >
      {/* Header chuẩn CreateOrderForm (GEMINI.md) */}
      <div className="bg-[#14263d] px-3 py-2 text-white flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {isActive ? (
            <Loader2 size={16} className="text-red-500 animate-spin shrink-0" />
          ) : isSuccess ? (
            <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle size={16} className="text-red-500 shrink-0" />
          )}
          <span className="text-xs font-bold uppercase tracking-wide text-white truncate">
            {state.title}
          </span>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <span className="inline-flex items-center gap-1 rounded bg-white/10 px-2 py-0.5 font-mono text-[11px] text-slate-200">
            <Clock3 size={11} />
            {formatDuration(elapsedMs)}
          </span>
          <span className="font-mono text-xs font-bold text-sky-300">
            {isSuccess ? "100%" : `${Math.max(0, Math.min(100, state.progress))}%`}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-white hover:bg-white/10"
            aria-label="Đóng bảng tiến trình đồng bộ"
            title={isActive ? "Ẩn bảng (tiến trình vẫn chạy ngầm)" : "Đóng"}
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Thanh tiến độ & thông điệp bước hiện tại */}
      <div className="border-b border-slate-200 px-3 py-2.5 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span
            className={`font-semibold ${
              isFailed
                ? "text-red-700"
                : isSuccess
                  ? "text-emerald-700"
                  : "text-slate-800"
            }`}
          >
            {state.message}
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {isPreparing
              ? "Đang chuẩn bị"
              : isRunning
                ? "Đang thực thi"
                : isSuccess
                  ? "Hoàn tất"
                  : "Gặp lỗi"}
          </span>
        </div>

        <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ease-out ${
              isFailed
                ? "bg-red-600"
                : isSuccess
                  ? "bg-emerald-600"
                  : "bg-sky-600"
            }`}
            style={{
              width: `${isSuccess ? 100 : Math.max(4, state.progress)}%`,
            }}
          />
        </div>

        {/* 3 giai đoạn tổng quan */}
        <div className="grid gap-1.5 sm:grid-cols-3 pt-0.5">
          {pipelineSteps.map((step) => (
            <div
              key={step.label}
              className={`flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] font-medium ${
                step.done
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : step.active
                    ? "border-sky-300 bg-sky-50 text-sky-800 font-semibold"
                    : "border-slate-200 bg-slate-50 text-slate-500"
              }`}
            >
              {step.done ? (
                <CheckCircle2 size={12} className="text-emerald-600 shrink-0" />
              ) : step.active ? (
                <RefreshCw size={12} className="text-sky-600 animate-spin shrink-0" />
              ) : (
                <span className="h-2 w-2 rounded-full bg-slate-300 shrink-0" />
              )}
              <span className="truncate">{step.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Bảng trạng thái chi tiết từng nguồn Nhà cung cấp */}
      {state.items.length > 0 && (
        <div className="border-b border-slate-200">
          <div className="border-b border-sky-100 bg-sky-50/60 px-3 py-1.5 text-[11px] font-bold uppercase text-sky-800">
            Tiến trình từng nguồn Nhà cung cấp ({state.items.length})
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead className="bg-slate-100 text-[10px] font-semibold text-slate-600">
                <tr>
                  <th className="px-3 py-1.5 border-b border-slate-200">Nguồn dữ liệu</th>
                  <th className="px-3 py-1.5 border-b border-slate-200 w-32">Trạng thái</th>
                  <th className="px-3 py-1.5 border-b border-slate-200">Chi tiết giai đoạn</th>
                  <th className="px-3 py-1.5 border-b border-slate-200 text-center w-24">
                    Dòng tải
                  </th>
                  <th className="px-3 py-1.5 border-b border-slate-200 text-right w-40">
                    Kết quả đơn
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.items.map((item) => (
                  <tr
                    key={item.id}
                    className="border-b border-slate-100 even:bg-amber-50/40 hover:bg-sky-50/50 text-[11px]"
                  >
                    <td className="px-3 py-1.5 font-semibold text-slate-800">
                      <span>{item.name}</span>
                      {item.code && item.code !== item.name && (
                        <span className="ml-1.5 font-mono text-[10px] text-slate-500">
                          [{item.code}]
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      {item.status === "RUNNING" ? (
                        <span className="inline-flex items-center gap-1 rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
                          <Loader2 size={10} className="animate-spin" />
                          Đang đồng bộ
                        </span>
                      ) : item.status === "SUCCESS" ? (
                        <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                          <CheckCircle2 size={10} />
                          Hoàn tất
                        </span>
                      ) : item.status === "FAILED" ? (
                        <span className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                          <AlertTriangle size={10} />
                          Lỗi
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                          Chờ xử lý
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-slate-600">
                      <span className="block truncate max-w-md" title={item.message || item.stage}>
                        {item.status === "FAILED" && item.message ? item.message : item.stage}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-center font-mono font-semibold text-slate-700">
                      {item.raw_rows ?? 0}
                    </td>
                    <td className="px-3 py-1.5 text-right font-medium text-slate-700">
                      {item.status === "SUCCESS" ? (
                        <span>
                          <strong className="text-emerald-700">+{item.new_orders ?? 0}</strong> mới
                          {" / "}
                          <strong className="text-sky-700">{item.updated_orders ?? 0}</strong> sửa
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Nhật ký tiến trình trực tiếp */}
      {state.logs.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowLogs((v) => !v)}
            className="w-full border-b border-slate-200 bg-slate-50 px-3 py-1.5 flex items-center justify-between text-[10px] font-bold uppercase text-slate-600 hover:bg-slate-100"
          >
            <span>Nhật ký tiến trình ({state.logs.length} sự kiện)</span>
            {showLogs ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          {showLogs && (
            <div className="max-h-32 overflow-y-auto px-3 py-2 bg-slate-50/50 space-y-1 font-mono text-[11px]">
              {state.logs.map((entry, idx) => (
                <div key={`${entry.time}-${idx}`} className="flex items-start gap-2">
                  <span className="text-[10px] text-slate-400 shrink-0">
                    [{formatLogTime(entry.time)}]
                  </span>
                  <span
                    className={
                      entry.level === "error"
                        ? "text-red-700 font-semibold"
                        : entry.level === "success"
                          ? "text-emerald-700 font-semibold"
                          : entry.level === "warning"
                            ? "text-amber-700"
                            : "text-slate-700"
                    }
                  >
                    {entry.message}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Footer chuẩn CreateOrderForm */}
      <div className="border-t border-slate-300 bg-slate-100 px-3 py-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] text-slate-500">
          {isSuccess && state.summary
            ? `Tổng kết: +${state.summary.new_orders ?? 0} đơn mới (${state.summary.new_lines ?? 0} dòng), ${state.summary.updated_orders ?? 0} đơn cập nhật (${state.summary.updated_lines ?? 0} dòng), ${state.summary.unchanged_lines ?? 0} dòng không đổi.`
            : isActive
              ? "Hệ thống đang cập nhật tiến trình trực tiếp từng giây..."
              : "Kiểm tra lại kết nối hoặc cấu hình nguồn dữ liệu Nhà cung cấp nếu có lỗi."}
        </span>
        {!isActive && (
          <button
            type="button"
            onClick={onClose}
            className="rounded bg-red-700 hover:bg-red-800 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors"
          >
            Đóng
          </button>
        )}
      </div>
    </section>
  );
}

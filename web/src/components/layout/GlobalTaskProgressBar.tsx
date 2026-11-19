"use client";

import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, AlertTriangle, X } from "lucide-react";
import { API_URL, apiFetch } from "@/lib/api";

interface JobInfo {
  id: string;
  job_type: string;
  title: string;
  status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";
  progress: number;
  current_step: number;
  total_steps: number;
  message: string;
  result_summary?: Record<string, unknown>;
  error_detail?: string;
  created_at: string;
  updated_at: string;
}

export default function GlobalTaskProgressBar() {
  const [activeJobs, setActiveJobs] = useState<JobInfo[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let isMounted = true;

    async function checkJobs() {
      try {
        const res = await apiFetch(`${API_URL}/sync/jobs/active`);
        if (res.ok && isMounted) {
          const data = (await res.json()) as JobInfo[];
          setActiveJobs(data);
        }
      } catch {
        // bỏ qua lỗi polling mạng nhẹ
      }
    }

    // Kiểm tra ngay lập tức
    void checkJobs();

    // Polling định kỳ mỗi 2 giây
    const interval = setInterval(() => {
      void checkJobs();
    }, 2000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // Lọc các job chưa bị bấm đóng thủ công
  const visibleJobs = activeJobs.filter((j) => !dismissedIds.has(j.id));
  if (visibleJobs.length === 0) return null;

  return (
    <div className="z-20 w-full flex flex-col divide-y divide-slate-700/50 bg-[#14263d] text-white shadow-lg border-b border-sky-400/40">
      {visibleJobs.map((job) => {
        const isSuccess = job.status === "SUCCESS";
        const isFailed = job.status === "FAILED";
        const isRunning = job.status === "RUNNING" || job.status === "PENDING";

        return (
          <div key={job.id} className="px-4 py-2 flex flex-col gap-1.5 transition-all">
            {/* Header thông tin job */}
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 min-w-0">
                {isRunning && <Loader2 size={14} className="animate-spin text-sky-400 shrink-0" />}
                {isSuccess && <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />}
                {isFailed && <AlertTriangle size={14} className="text-red-400 shrink-0" />}

                <span className="font-bold text-[11px] uppercase tracking-wide text-sky-200 shrink-0">
                  {job.title}
                </span>

                <span className="text-[11px] text-slate-300 truncate max-w-md sm:max-w-xl">
                  {job.message}
                </span>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <span className="font-mono font-bold text-xs text-sky-300">
                  {isSuccess ? "100%" : `${job.progress}%`}
                </span>
                {(isSuccess || isFailed) && (
                  <button
                    type="button"
                    onClick={() => setDismissedIds((prev) => new Set([...prev, job.id]))}
                    className="text-slate-400 hover:text-white rounded p-0.5"
                    title="Đóng thông báo"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>

            {/* Thanh tiến độ % chuyển động mượt mà */}
            <div className="w-full h-1.5 bg-slate-700/80 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ease-out rounded-full ${
                  isSuccess
                    ? "bg-emerald-400"
                    : isFailed
                    ? "bg-red-500"
                    : "bg-gradient-to-r from-sky-400 via-indigo-400 to-sky-300"
                }`}
                style={{ width: `${Math.max(3, job.progress)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

"use client";
// src/components/ui/ComingSoon.tsx
import Link from "next/link";
import { Rocket, ArrowRight } from "lucide-react";

interface ComingSoonProps {
  title: string;
  description?: string;
  phase?: string;
}

export default function ComingSoon({ title, description, phase = "Phase 2" }: ComingSoonProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-10 flex flex-col items-center justify-center text-center min-h-[55vh]">
      <div className="w-16 h-16 rounded-2xl bg-sky-50 flex items-center justify-center mb-4">
        <Rocket size={28} className="text-sky-500" />
      </div>
      <span className="text-xs font-semibold uppercase tracking-wider text-sky-500 bg-sky-50 px-2.5 py-1 rounded-full mb-3">
        {phase}
      </span>
      <h2 className="text-lg font-bold text-gray-900">{title}</h2>
      <p className="text-sm text-gray-500 mt-2 max-w-md">
        {description ?? "Module này sẽ được triển khai trong giai đoạn tiếp theo của lộ trình DMS."}
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-sky-600 hover:text-sky-700 transition-colors"
      >
        Quay lại Dashboard
        <ArrowRight size={14} />
      </Link>
    </div>
  );
}
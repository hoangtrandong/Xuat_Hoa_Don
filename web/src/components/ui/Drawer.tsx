"use client";
// src/components/ui/Drawer.tsx
import { X } from "lucide-react";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  size?: "lg" | "xl" | "2xl" | "4xl";
  children: React.ReactNode;
}

export default function Drawer({ open, onClose, title, subtitle, size = "lg", children }: DrawerProps) {
  if (!open) return null;
  const widthClass = { lg: "max-w-lg", xl: "max-w-xl", "2xl": "max-w-2xl", "4xl": "max-w-4xl" }[size];
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className={`absolute right-0 top-0 h-full w-full ${widthClass} bg-white shadow-xl flex flex-col`}
        style={{ animation: "slideInRight 0.25s ease-out" }}
      >
        <header className="flex items-center justify-between bg-[#14263d] px-4 py-2.5 text-white flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-xs font-bold uppercase tracking-wide text-white truncate">{title}</h2>
            {subtitle && <span className="text-[10px] text-slate-300 truncate">· {subtitle}</span>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-white hover:bg-white/10 transition-colors -mr-1"
            aria-label="Đóng"
          >
            <X size={16} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
"use client";
// src/components/ui/Drawer.tsx
import { X } from "lucide-react";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  size?: "lg" | "xl" | "2xl" | "4xl" | "5xl" | "6xl" | "7xl" | "wide" | "full";
  mode?: "modal" | "drawer";
  children: React.ReactNode;
}

export default function Drawer({
  open,
  onClose,
  title,
  subtitle,
  size = "wide",
  mode = "modal",
  children,
}: DrawerProps) {
  if (!open) return null;

  const widthClass = {
    lg: "max-w-lg",
    xl: "max-w-xl",
    "2xl": "max-w-2xl",
    "4xl": "max-w-4xl",
    "5xl": "max-w-5xl",
    "6xl": "max-w-6xl",
    "7xl": "max-w-7xl",
    wide: "max-w-[1550px] w-[95vw]",
    full: "max-w-[97vw] w-[97vw]",
  }[size] || "max-w-[1550px] w-[95vw]";

  if (mode === "drawer") {
    return (
      <div className="fixed inset-0 z-50">
        <div className="absolute inset-0 bg-black/40" onClick={onClose} />
        <div
          className={`absolute right-0 top-0 h-full w-full ${widthClass} bg-white dark:bg-[#151d2b] shadow-xl flex flex-col`}
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

  // Centered Modal Mode (Single Source of Truth standard per GEMINI.md)
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-2 sm:p-4 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative z-10 flex flex-col w-full ${widthClass} max-h-[94vh] overflow-hidden rounded-lg bg-white dark:bg-[#151d2b] shadow-2xl border border-slate-400 dark:border-[#36445a]`}
      >
        <header className="flex items-center justify-between bg-[#14263d] px-3.5 py-2.5 text-white flex-shrink-0">
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

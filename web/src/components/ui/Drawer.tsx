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
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{title}</h2>
            {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 -mr-2 transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
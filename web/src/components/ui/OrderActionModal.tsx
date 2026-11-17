"use client";

import { FileText, X } from "lucide-react";
import { useEffect, useRef } from "react";

interface OrderActionModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}

function OpenOrderActionModal({ onClose, title, subtitle, children, footer }: Omit<OrderActionModalProps, "open">) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-0 m-auto h-[100dvh] max-h-none w-full max-w-[1500px] overflow-hidden border border-slate-400 bg-white p-0 shadow-lg backdrop:bg-slate-950/50 sm:h-[96dvh] sm:w-[calc(100%-2rem)] sm:rounded-xl"
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-3 bg-[#14263d] px-3 py-2 text-white">
          <div className="flex min-w-0 items-center gap-2">
            <FileText size={17} className="shrink-0 text-red-500" />
            <div className="min-w-0">
              <h2 className="truncate text-xs font-bold uppercase tracking-wide text-white">{title}</h2>
              <p className="mt-0.5 truncate text-[10px] text-white/70">{subtitle}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng" className="rounded p-1 text-white hover:bg-white/10">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        <div className="shrink-0 border-t border-slate-300 bg-slate-100 px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          {footer}
        </div>
      </div>
    </dialog>
  );
}

export default function OrderActionModal({ open, ...props }: OrderActionModalProps) {
  return open ? <OpenOrderActionModal {...props} /> : null;
}

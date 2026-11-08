"use client";

import { X } from "lucide-react";
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
      className="fixed inset-0 m-auto h-[100dvh] max-h-none w-full max-w-[1500px] overflow-hidden bg-white p-0 shadow-xl backdrop:bg-slate-950/50 sm:h-[96dvh] sm:w-[calc(100%-2rem)] sm:rounded-xl"
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-200 px-4 py-3 sm:px-5 sm:py-4">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-gray-900 sm:text-lg">{title}</h2>
            <p className="mt-0.5 text-xs text-gray-500 sm:text-sm">{subtitle}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100">
            <X size={20} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        <div className="shrink-0 border-t border-gray-200 bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
          {footer}
        </div>
      </div>
    </dialog>
  );
}

export default function OrderActionModal({ open, ...props }: OrderActionModalProps) {
  return open ? <OpenOrderActionModal {...props} /> : null;
}

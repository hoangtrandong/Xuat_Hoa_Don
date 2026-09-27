"use client";

import { useState, type ReactNode } from "react";
import { apiFetch } from "@/lib/api";

interface AuthenticatedDownloadLinkProps {
  href: string;
  className: string;
  children: ReactNode;
}

export default function AuthenticatedDownloadLink({
  href,
  className,
  children,
}: AuthenticatedDownloadLinkProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState("");

  async function download() {
    setIsDownloading(true);
    setError("");
    try {
      const response = await apiFetch(href);
      if (!response.ok) {
        setError("Không thể tải file mẫu. Vui lòng thử lại.");
        return;
      }

      const blob = await response.blob();
      const filename = decodeURIComponent(
        new URL(href).pathname.split("/").pop() || "template.xlsx",
      );
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } catch {
      setError("Không thể tải file mẫu. Vui lòng kiểm tra kết nối.");
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button"
        onClick={download}
        disabled={isDownloading}
        className={className}
      >
        {children}
      </button>
      {error && <span role="alert" className="mt-1 text-xs text-red-600">{error}</span>}
    </span>
  );
}

// src/lib/format.ts

export function formatVND(value: number): string {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)} Tỷ`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)} Triệu`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(0)}K`;
  }
  return value.toLocaleString("vi-VN");
}

export function formatVNDFull(value: number): string {
  return value.toLocaleString("vi-VN") + " ₫";
}

export function formatNumber(value: number): string {
  return value.toLocaleString("vi-VN");
}

export function formatPercent(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export function formatDate(iso: string | number | Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatDateTime(iso: string | number | Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const date = d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
  const time = d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  return `${date} ${time}`;
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(-2)
    .join("")
    .toUpperCase();
}

/**
 * Quy đổi số lượng lẻ sang Thùng và Hộp lẻ
 * Ví dụ: 125 hộp, 48 hộp/thùng -> { cartons: 2, looseBoxes: 29, bpc: 48 }
 */
export function splitCartons(quantity: number, boxesPerCarton?: number | null): {
  cartons: number;
  looseBoxes: number;
  bpc: number;
} {
  const safeQty = Number.isFinite(quantity) ? Math.max(0, Math.floor(quantity)) : 0;
  const bpc = Number.isFinite(boxesPerCarton) && (boxesPerCarton ?? 0) > 1
    ? Math.floor(boxesPerCarton as number)
    : 1;
  const cartons = Math.floor(safeQty / bpc);
  const looseBoxes = safeQty % bpc;
  return { cartons, looseBoxes, bpc };
}

/**
 * Hiển thị số lượng theo định dạng: "2T 29H (125 hộp)" hoặc "2T (96 hộp)" hoặc "15H"
 */
export function formatCartonBox(quantity: number, boxesPerCarton?: number | null, unit: string = "hộp"): string {
  const { cartons, looseBoxes, bpc } = splitCartons(quantity, boxesPerCarton);
  if (bpc <= 1) {
    return `${quantity.toLocaleString("vi-VN")} ${unit}`;
  }
  if (cartons > 0 && looseBoxes > 0) {
    return `${cartons}T ${looseBoxes}H (${quantity.toLocaleString("vi-VN")} ${unit})`;
  }
  if (cartons > 0) {
    return `${cartons}T (${quantity.toLocaleString("vi-VN")} ${unit})`;
  }
  return `${looseBoxes}H`;
}

/**
 * Hiển thị ngắn gọn: "2T 29H" hoặc "2T" hoặc "15H"
 */
export function formatCartonBoxShort(quantity: number, boxesPerCarton?: number | null): string {
  const { cartons, looseBoxes, bpc } = splitCartons(quantity, boxesPerCarton);
  if (bpc <= 1) {
    return `${quantity.toLocaleString("vi-VN")}`;
  }
  if (cartons > 0 && looseBoxes > 0) {
    return `${cartons}T ${looseBoxes}H`;
  }
  if (cartons > 0) {
    return `${cartons}T`;
  }
  return `${looseBoxes}H`;
}
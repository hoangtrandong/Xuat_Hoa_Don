// src/lib/format.ts

const VIETNAM_TIME_ZONE = "Asia/Ho_Chi_Minh";

function parseDateTime(value: string | number | Date): Date {
  if (typeof value !== "string") return new Date(value);
  const normalizedValue = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value)
    && !/(Z|[+-]\d{2}:?\d{2})$/i.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  return new Date(normalizedValue);
}

function dateParts(value: string | number | Date): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: VIETNAM_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(parseDateTime(value)).map(({ type, value }) => [type, value]),
  );
}

export function formatDateKey(value: string | number | Date): string {
  const parts = dateParts(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

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

export function formatUnitPrice(value: number | string | null | undefined, decimals = 4): string {
  if (value === null || value === undefined || value === "") return (0).toFixed(decimals);
  const num = Number(value);
  if (Number.isNaN(num)) return String(value);
  return num.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatNumber(value: number): string {
  return value.toLocaleString("vi-VN");
}

export function formatBorrowStatusText(value: string): string {
  return value.replace(/Mượn Số/gi, "Dương Số").replace(/Trả Số/gi, "Âm Số");
}

export function formatCustomerCode(code: string | null | undefined): string {
  return (code ?? "").trim().slice(-3);
}

export function formatPercent(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export function formatDate(iso: string | number | Date): string {
  if (typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [year, month, day] = iso.split("-");
    return `${day}/${month}/${year}`;
  }
  const d = parseDateTime(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: VIETNAM_TIME_ZONE,
  }).format(d);
}

export function formatDateTime(iso: string | number | Date): string {
  const d = parseDateTime(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const time = new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: VIETNAM_TIME_ZONE,
  }).format(d);
  return `${formatDate(d)} ${time}`;
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
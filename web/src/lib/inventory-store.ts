// src/lib/inventory-store.ts
// LocalStorage store: tồn kho & sổ nhật ký (inventory_transactions) cho giao dịch tạo mới

import {
  stockLevels,
  ledgerEntries,
  type StockLevel,
  type LedgerEntry,
  type LedgerType,
} from "./mock-inventory";

const STOCK_KEY = "dms.stock.overrides.v1";
const LEDGER_KEY = "dms.ledger.additions.v1";

export interface StockPatch {
  onHand?: number;
  reserved?: number;
}

function readJSON<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJSON(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function readStockOverrides(): Record<string, StockPatch> {
  return readJSON<Record<string, StockPatch>>(STOCK_KEY) ?? {};
}

function writeStockOverrides(overrides: Record<string, StockPatch>): void {
  writeJSON(STOCK_KEY, overrides);
}

/** Bảng tồn kho đầy đủ (mock + overrides từ localStorage) */
export function getAllStockLevels(): StockLevel[] {
  const overrides = readStockOverrides();
  return stockLevels.map((s) => {
    const p = overrides[s.productCode];
    if (!p) return s;
    const onHand = p.onHand ?? s.onHand;
    const reserved = p.reserved ?? s.reserved;
    return {
      ...s,
      onHand,
      reserved,
      available: Math.max(0, onHand - reserved),
      totalValue: onHand * s.unitValue,
    };
  });
}

export function readLedgerAdditions(): LedgerEntry[] {
  return readJSON<LedgerEntry[]>(LEDGER_KEY) ?? [];
}

/** Sổ nhật ký đầy đủ (mock + bổ sung) */
export function getAllLedgerEntries(): LedgerEntry[] {
  return [...ledgerEntries, ...readLedgerAdditions()];
}

let counter = 900;

function pad(n: string | number, len = 3): string {
  return String(n).padStart(len, "0");
}

/** Sinh mã phiếu nhập/xuất/điều chỉnh mới: ITT-yymmdd-<seq> */
export function generateLedgerCode(): string {
  counter += 1;
  const now = new Date();
  const dd = pad(now.getDate());
  const mm = pad(now.getMonth() + 1);
  const yy = String(now.getFullYear()).slice(2);
  const dayEntries = ledgerEntries.filter((e) => e.createdAt.startsWith(now.toISOString().slice(0, 10)));
  const seq = Math.max(0, ...dayEntries.map((e) => parseInt(e.code.split("-").pop() ?? "0", 10) || 0), counter);
  return `ITT-${yy}${mm}${dd}-${pad(seq + 1)}`;
}

function toSignedQty(type: LedgerType, rawQty: number): number {
  if (type === "IN" || type === "OPENING") return Math.abs(rawQty);
  return -Math.abs(rawQty); // OUT / ADJUST giảm tồn
}

/**
 * Ghi 1 dòng sổ nhật ký + cập nhật tồn kho tương ứng.
 * quantity đầu vào là số dương; hướng (+/-) suy từ loại giao dịch.
 */
export function applyLedgerEntry(input: {
  type: LedgerType;
  productCode: string;
  warehouse: string;
  quantity: number;
  note: string;
  createdBy: string;
  refType?: string;
  refCode?: string;
}): LedgerEntry {
  const signed = toSignedQty(input.type, input.quantity);
  const base = stockLevels.find((s) => s.productCode === input.productCode);
  if (!base) throw new Error(`Không tìm thấy sản phẩm ${input.productCode}`);

  const now = new Date().toISOString();
  const entry: LedgerEntry = {
    id: Date.now(),
    code: generateLedgerCode(),
    type: input.type === "OPENING" ? "OPENING" : input.type,
    productCode: base.productCode,
    productName: base.productName,
    unit: base.unit,
    warehouse: input.warehouse,
    quantity: signed,
    refType: input.refType ?? (input.type === "IN" ? "PO" : input.type === "OUT" ? "SO" : "ADJ"),
    refCode: input.refCode ?? input.type !== "ADJUST" ? "" : `THỦ-CÔNG-${now.slice(11, 16)}`,
    createdAt: now,
    createdBy: input.createdBy,
    note: input.note,
  };

  writeJSON(LEDGER_KEY, [entry, ...readLedgerAdditions()]);

  // Cập nhật tồn kho
  const overrides = readStockOverrides();
  const prev = overrides[input.productCode] ?? {};
  const prevOnHand = prev.onHand ?? base.onHand;
  const nextOnHand = Math.max(0, prevOnHand + signed);
  overrides[input.productCode] = { ...prev, onHand: nextOnHand };
  writeStockOverrides(overrides);

  return entry;
}

/** Giữ chỗ tồn kho khi tạo đơn (tăng reserved, giảm available) */
export function reserveStock(productCode: string, quantity: number): void {
  const base = stockLevels.find((s) => s.productCode === productCode);
  if (!base || quantity <= 0) return;
  const overrides = readStockOverrides();
  const prev = overrides[productCode] ?? {};
  const reserved = (prev.reserved ?? base.reserved) + quantity;
  overrides[productCode] = { ...prev, reserved: Math.max(0, reserved) };
  writeStockOverrides(overrides);
}
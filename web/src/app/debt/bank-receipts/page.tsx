"use client";

import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import * as XLSX from "xlsx";
import {
  Banknote,
  Receipt,
  Plus,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Trash2,
  Zap,
  History,
  X,
  CreditCard,
  Search,
  FileSpreadsheet,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import Badge from "@/components/ui/Badge";
import Drawer from "@/components/ui/Drawer";
import { formatVND, formatVNDFull, formatDateKey, formatDateTime } from "@/lib/format";
import { API_URL, apiFetch } from "@/lib/api";

interface PaymentAllocationItem {
  id: number;
  code: string;
  bank_receipt_id: number;
  order_id: number | null;
  order_number: string | null;
  employee_id: number | null;
  employee_code: string | null;
  employee_name: string | null;
  store_id: number | null;
  settlement_date: string | null;
  amount: number;
  allocation_date: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

interface BankReceipt {
  id: number;
  code: string;
  bank_name: string | null;
  account_number?: string | null;
  ref_number: string | null;
  transaction_date: string;
  party_type: string;
  store_id: number | null;
  store_code: string | null;
  store_name: string | null;
  customer_id: number | null;
  amount: number;
  allocated_amount: number;
  unallocated_amount: number;
  status: "UNALLOCATED" | "PARTIALLY_ALLOCATED" | "FULLY_ALLOCATED";
  description: string | null;
  created_by: string | null;
  created_at: string;
  allocations: PaymentAllocationItem[];
}

interface CashReceipt {
  id: number;
  code: string;
  party_type: "EMPLOYEE" | "STORE";
  party_id: number;
  party_code: string | null;
  party_name: string | null;
  settlement_date: string | null;
  amount: number;
  receipt_date: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

type ReceiptListRow =
  | { method: "BANK"; sortDate: string; receipt: BankReceipt }
  | { method: "CASH"; sortDate: string; receipt: CashReceipt };

interface AllocatableEmployeeDay {
  employee_id: number;
  employee_code: string;
  employee_name: string | null;
  settlement_date: string;
  allocated_amount: number;
  paid_bank: number;
  remaining_employee_debt: number;
}

interface AllocatableStoreDebt {
  store_id: number;
  store_code: string;
  store_name: string;
  remaining_store_debt: number;
}

interface StoreOption {
  id: number;
  code: string;
  name: string;
}

interface EmployeeOption {
  id: number;
  code: string;
  name: string;
  status: string;
}

interface StatementImportRow {
  rowNumber: number;
  transactionDate: string;
  transactionDateLabel: string;
  description: string;
  amount: number;
  balance: number | null;
  reference: string;
  storeId: number | "";
  duplicate: boolean;
  imported: boolean;
  error: string;
}

function statementHash(value: string): string {
  let first = 2166136261;
  let second = 2246822519;
  for (const byte of new TextEncoder().encode(value)) {
    first = Math.imul(first ^ byte, 16777619) >>> 0;
    second = Math.imul(second ^ byte, 3266489917) >>> 0;
  }
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

function statementDate(value: unknown): { iso: string; label: string } | null {
  let match: RegExpMatchArray | null = null;
  if (typeof value === "string") {
    match = value.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  }
  let day: number;
  let month: number;
  let year: number;
  let hour: number;
  let minute: number;
  let second: number;
  if (match) {
    day = Number(match[1]);
    month = Number(match[2]);
    year = Number(match[3]);
    hour = Number(match[4] || 0);
    minute = Number(match[5] || 0);
    second = Number(match[6] || 0);
  } else if (value instanceof Date && !Number.isNaN(value.getTime())) {
    day = value.getDate();
    month = value.getMonth() + 1;
    year = value.getFullYear();
    hour = value.getHours();
    minute = value.getMinutes();
    second = value.getSeconds();
  } else if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    ({ d: day, m: month, y: year, H: hour, M: minute, S: second } = parsed);
  } else {
    return null;
  }
  const localDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    localDate.getUTCFullYear() !== year
    || localDate.getUTCMonth() !== month - 1
    || localDate.getUTCDate() !== day
    || hour > 23
    || minute > 59
    || second > 59
  ) return null;
  const utcDate = new Date(localDate.getTime() - 7 * 60 * 60 * 1000);
  const iso = utcDate.toISOString();
  const label = `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
  return { iso, label };
}

function statementAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/[,\.\s]/g, "");
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function statusBadge(status: string) {
  switch (status) {
    case "FULLY_ALLOCATED":
      return <Badge variant="success">Đã phân bổ đủ</Badge>;
    case "PARTIALLY_ALLOCATED":
      return <Badge variant="warning">Đang phân bổ</Badge>;
    default:
      return <Badge variant="danger">Chờ phân bổ</Badge>;
  }
}

function localDateTimeInput(date: Date): string {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 16);
}

export default function BankReceiptsPage() {
  const [receipts, setReceipts] = useState<BankReceipt[]>([]);
  const [cashReceipts, setCashReceipts] = useState<CashReceipt[]>([]);
  const [cashReceiptHistoryLoading, setCashReceiptHistoryLoading] = useState(false);
  const [cashReceiptHistoryError, setCashReceiptHistoryError] = useState("");
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Filters
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [storeFilter, setStoreFilter] = useState("");
  const [paymentMethodFilter, setPaymentMethodFilter] = useState<"ALL" | "BANK" | "CASH">("ALL");

  // Add receipt modal state
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addStoreId, setAddStoreId] = useState<number | "">("");
  const [addStoreSearch, setAddStoreSearch] = useState("");
  const [addBankName, setAddBankName] = useState("Vietcombank");
  const [addRefNumber, setAddRefNumber] = useState("");
  const [addAmount, setAddAmount] = useState<number | "">("");
  const [addDate, setAddDate] = useState(() => localDateTimeInput(new Date()));
  const [addDescription, setAddDescription] = useState("");
  const [submittingAdd, setSubmittingAdd] = useState(false);
  const [cashReceiptModalOpen, setCashReceiptModalOpen] = useState(false);
  const [cashReceiptEmployees, setCashReceiptEmployees] = useState<EmployeeOption[]>([]);
  const [cashReceiptEmployeeSearch, setCashReceiptEmployeeSearch] = useState("");
  const [cashReceiptEmployeeId, setCashReceiptEmployeeId] = useState("");
  const [cashReceiptDate, setCashReceiptDate] = useState(() => formatDateKey(new Date()));
  const [cashReceiptAmount, setCashReceiptAmount] = useState<number | "">("");
  const [cashReceiptNote, setCashReceiptNote] = useState("");
  const [cashReceiptRemaining, setCashReceiptRemaining] = useState<number | null>(null);
  const [cashReceiptEmployeesLoading, setCashReceiptEmployeesLoading] = useState(false);
  const [cashReceiptLoading, setCashReceiptLoading] = useState(false);
  const [cashReceiptSubmitting, setCashReceiptSubmitting] = useState(false);
  const [cashReceiptError, setCashReceiptError] = useState("");

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importRows, setImportRows] = useState<StatementImportRow[]>([]);
  const [importAccountNumber, setImportAccountNumber] = useState("");
  const [importBankName, setImportBankName] = useState("VietinBank");
  const [importFileName, setImportFileName] = useState("");
  const [importError, setImportError] = useState("");
  const [parsingStatement, setParsingStatement] = useState(false);
  const [importingStatement, setImportingStatement] = useState(false);

  const filteredModalStores = useMemo(() => {
    if (!addStoreSearch.trim()) return stores;
    const q = addStoreSearch.trim().toLowerCase();
    return stores.filter((s) => s.code.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
  }, [stores, addStoreSearch]);

  const pendingStatementRows = useMemo(
    () => importRows.filter((row) => !row.duplicate && !row.imported),
    [importRows],
  );
  const canImportStatement = pendingStatementRows.length > 0
    && pendingStatementRows.every((row) => row.storeId !== "");

  // Allocate modal state
  const [allocateModalOpen, setAllocateModalOpen] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState<BankReceipt | null>(null);
  const [allocatableEmployeeDays, setAllocatableEmployeeDays] = useState<AllocatableEmployeeDay[]>([]);
  const [allocatableStoreDebt, setAllocatableStoreDebt] = useState<AllocatableStoreDebt | null>(null);
  const [allocationEmployeeId, setAllocationEmployeeId] = useState("");
  const [allocationEmployeeSearch, setAllocationEmployeeSearch] = useState("");
  const [allocationSettlementDate, setAllocationSettlementDate] = useState("");
  const [allocationTargetType, setAllocationTargetType] = useState<"EMPLOYEE" | "STORE">("EMPLOYEE");
  const [allocationAmountInput, setAllocationAmountInput] = useState<number | "">("");
  const [allocationFormError, setAllocationFormError] = useState("");
  const [allocationLoadError, setAllocationLoadError] = useState("");
  const [allocAmounts, setAllocAmounts] = useState<Record<string, number>>({});
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [submittingAlloc, setSubmittingAlloc] = useState(false);

  // History Drawer state
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [historyReceipt, setHistoryReceipt] = useState<BankReceipt | null>(null);

  const fetchData = useCallback(async () => {
      const [receiptsRes, storesRes] = await Promise.all([
        apiFetch(`${API_URL}/bank-receipts`),
        apiFetch(`${API_URL}/stores?limit=5000`),
      ]);
      if (!receiptsRes.ok) throw new Error("Không thể tải danh sách phiếu chuyển khoản.");
      if (!storesRes.ok) throw new Error("Không thể tải danh sách cửa hàng.");

      const receiptsData = await receiptsRes.json();
      const storesData = await storesRes.json();
      return { receipts: receiptsData as BankReceipt[], stores: storesData as StoreOption[] };
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchData();
      setReceipts(data.receipts);
      setStores(data.stores);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
    } finally {
      setLoading(false);
    }
  }, [fetchData]);

  const loadCashReceiptHistory = useCallback(async () => {
    setCashReceiptHistoryLoading(true);
    setCashReceiptHistoryError("");
    try {
      const response = await apiFetch(`${API_URL}/cash-receipts?limit=200`);
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.detail || "Không thể tải lịch sử tiền mặt.");
      }
      setCashReceipts(await response.json() as CashReceipt[]);
    } catch (err) {
      setCashReceiptHistoryError(err instanceof Error ? err.message : "Không thể tải lịch sử tiền mặt.");
    } finally {
      setCashReceiptHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void fetchData()
      .then((data) => {
        if (!active) return;
        setReceipts(data.receipts);
        setStores(data.stores);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : "Đã có lỗi xảy ra.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fetchData]);

  useEffect(() => {
    // Keep the displayed cash receipt history synchronized with persisted API data.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCashReceiptHistory();
  }, [loadCashReceiptHistory]);

  async function handleStatementFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setParsingStatement(true);
    setImportError("");
    setImportRows([]);
    setImportFileName(file.name);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!firstSheet) throw new Error("File không có sheet dữ liệu.");
      const rows = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, {
        header: 1,
        raw: true,
        defval: "",
      });
      const normalized = (value: unknown) => String(value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
      const headerIndex = rows.findIndex((row) => {
        const headings = row.map(normalized);
        return headings.includes("ngay")
          && headings.includes("noi dung")
          && headings.includes("so tien gd");
      });
      if (headerIndex < 0) {
        throw new Error("Không tìm thấy dòng tiêu đề gồm Ngày, Nội dung và Số tiền GD.");
      }
      const headers = rows[headerIndex].map(normalized);
      const dateColumn = headers.indexOf("ngay");
      const descriptionColumn = headers.indexOf("noi dung");
      const amountColumn = headers.indexOf("so tien gd");
      const balanceColumn = headers.indexOf("so du");
      const metadata = rows.slice(0, headerIndex + 1)
        .flatMap((row) => row.map((cell) => String(cell ?? "")))
        .join(" ");
      const normalizedMetadata = normalized(metadata);
      const accountNumber = normalizedMetadata.match(/so tai khoan\s*:\s*([\d ]+)/i)?.[1]?.replace(/\s/g, "") ?? "";
      if (!accountNumber) {
        throw new Error("Không xác định được số tài khoản từ phần đầu sao kê.");
      }
      const detectedBank = /vietinbank/i.test(metadata) ? "VietinBank" : importBankName;
      const seenReferences = new Set<string>();
      const nextRows: StatementImportRow[] = [];

      rows.slice(headerIndex + 1).forEach((row, index) => {
        const amount = statementAmount(row[amountColumn]);
        if (amount === null || amount <= 0) return;
        const date = statementDate(row[dateColumn]);
        const description = String(row[descriptionColumn] ?? "").trim();
        if (!date || !description) {
          nextRows.push({
            rowNumber: headerIndex + index + 2,
            transactionDate: "",
            transactionDateLabel: String(row[dateColumn] ?? "Không rõ ngày"),
            description,
            amount,
            balance: null,
            reference: "",
            storeId: "",
            duplicate: false,
            imported: false,
            error: !date ? "Ngày giao dịch không hợp lệ" : "Thiếu nội dung giao dịch",
          });
          return;
        }
        const canonical = `${accountNumber}|${date.iso}|${amount.toFixed(2)}|${description.replace(/\s+/g, " ").toUpperCase()}`;
        const reference = `STMT-${statementHash(canonical)}`;
        const balance = balanceColumn >= 0 ? statementAmount(row[balanceColumn]) : null;
        const duplicate = seenReferences.has(reference) || receipts.some(
          (receipt) => receipt.account_number === accountNumber && receipt.ref_number === reference,
        );
        seenReferences.add(reference);
        nextRows.push({
          rowNumber: headerIndex + index + 2,
          transactionDate: date.iso,
          transactionDateLabel: date.label,
          description,
          amount,
          balance,
          reference,
          storeId: "",
          duplicate,
          imported: false,
          error: "",
        });
      });
      if (nextRows.length === 0) {
        throw new Error("Không tìm thấy giao dịch tiền vào hợp lệ trong file.");
      }
      setImportAccountNumber(accountNumber);
      setImportBankName(detectedBank);
      setImportRows(nextRows);
    } catch (parseError) {
      setImportError(parseError instanceof Error
        ? `Không thể đọc sao kê: ${parseError.message}`
        : "Không thể đọc file sao kê.");
    } finally {
      setParsingStatement(false);
    }
  }

  async function handleImportStatement() {
    const rowsToImport = importRows.filter((row) => !row.duplicate && !row.imported && !row.error);
    if (rowsToImport.length === 0) {
      setImportError("Không còn giao dịch hợp lệ để nhập.");
      return;
    }
    if (rowsToImport.some((row) => row.storeId === "")) {
      setImportError("Vui lòng xác nhận cửa hàng cho từng giao dịch trước khi ghi nhận.");
      return;
    }
    setImportingStatement(true);
    setImportError("");
    let importedCount = 0;
    let duplicateCount = 0;
    const failed: string[] = [];
    for (const row of rowsToImport) {
      try {
        const response = await apiFetch(`${API_URL}/bank-receipts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bank_name: importBankName,
            account_number: importAccountNumber,
            ref_number: row.reference,
            transaction_date: row.transactionDate,
            store_id: Number(row.storeId),
            amount: row.amount,
            description: row.description,
          }),
        });
        if (response.status === 409) {
          duplicateCount += 1;
          setImportRows((current) => current.map((item) =>
            item.reference === row.reference ? { ...item, duplicate: true } : item
          ));
          continue;
        }
        if (!response.ok) {
          const payload = await response.json();
          throw new Error(payload.detail || `Không thể nhập dòng ${row.rowNumber}.`);
        }
        importedCount += 1;
        setImportRows((current) => current.map((item) =>
          item.reference === row.reference ? { ...item, imported: true } : item
        ));
      } catch (importError) {
        failed.push(`Dòng ${row.rowNumber}: ${importError instanceof Error ? importError.message : "Lỗi không xác định"}`);
      }
    }
    setImportingStatement(false);
    await loadData();
    if (failed.length) {
      setImportError(`Đã nhập ${importedCount} khoản, bỏ qua ${duplicateCount} khoản trùng. ${failed.join("; ")}`);
    } else {
      setMessage(`Đã ghi nhận ${importedCount} khoản chuyển khoản chưa phân bổ${duplicateCount ? `; bỏ qua ${duplicateCount} khoản trùng` : ""}. Chưa có công nợ nào bị giảm.`);
      setImportModalOpen(false);
    }
  }

  const filteredReceipts = useMemo(() => {
    return receipts.filter((r) => {
      if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
      if (storeFilter && String(r.store_id) !== storeFilter) return false;
      return true;
    });
  }, [receipts, statusFilter, storeFilter]);

  const receiptRows = useMemo<ReceiptListRow[]>(() => {
    const bankRows: ReceiptListRow[] = paymentMethodFilter === "CASH"
      ? []
      : filteredReceipts.map((receipt) => ({
        method: "BANK",
        sortDate: receipt.transaction_date,
        receipt,
      }));
    const cashRows: ReceiptListRow[] = (paymentMethodFilter === "BANK" ? [] : cashReceipts)
      .filter(() => statusFilter === "ALL" || statusFilter === "FULLY_ALLOCATED")
      .map((receipt) => ({
        method: "CASH",
        sortDate: receipt.receipt_date,
        receipt,
      }));
    return [...bankRows, ...cashRows].sort(
      (left, right) => new Date(right.sortDate).getTime() - new Date(left.sortDate).getTime(),
    );
  }, [filteredReceipts, cashReceipts, paymentMethodFilter, statusFilter]);

  const stats = useMemo(() => {
    return receipts.reduce(
      (acc, r) => ({
        totalAmount: acc.totalAmount + r.amount,
        allocatedAmount: acc.allocatedAmount + r.allocated_amount,
        unallocatedAmount: acc.unallocatedAmount + r.unallocated_amount,
        unallocatedCount: acc.unallocatedCount + (r.status !== "FULLY_ALLOCATED" ? 1 : 0),
      }),
      { totalAmount: 0, allocatedAmount: 0, unallocatedAmount: 0, unallocatedCount: 0 }
    );
  }, [receipts]);

  // Open allocate modal
  async function handleOpenAllocate(receipt: BankReceipt) {
    setSelectedReceipt(receipt);
    setAllocAmounts({});
    setAllocatableEmployeeDays([]);
    setAllocatableStoreDebt(null);
    setAllocationEmployeeId("");
    setAllocationEmployeeSearch("");
    setAllocationSettlementDate("");
    setAllocationTargetType("EMPLOYEE");
    setAllocationAmountInput("");
    setAllocationFormError("");
    setAllocationLoadError("");
    setAllocateModalOpen(true);
    setLoadingOrders(true);
    try {
      const [employeeDaysRes, storeDebtRes] = await Promise.all([
        apiFetch(`${API_URL}/bank-receipts/${receipt.id}/allocatable-employee-days`),
        apiFetch(`${API_URL}/bank-receipts/${receipt.id}/allocatable-store-debt`),
      ]);
      if (!employeeDaysRes.ok) {
        const result = await employeeDaysRes.json();
        throw new Error(result.detail || "Không thể tải công nợ nhân viên/ngày của cửa hàng.");
      }
      if (!storeDebtRes.ok) {
        const result = await storeDebtRes.json();
        throw new Error(result.detail || "Không thể tải công nợ cửa hàng.");
      }
      const targets: AllocatableEmployeeDay[] = await employeeDaysRes.json();
      const storeDebt: AllocatableStoreDebt | null = await storeDebtRes.json();
      setAllocatableEmployeeDays(targets);
      setAllocatableStoreDebt(storeDebt);
    } catch (err) {
      setAllocationLoadError(err instanceof Error ? err.message : "Lỗi tải công nợ để phân bổ.");
    } finally {
      setLoadingOrders(false);
    }
  }

  const currentTotalAllocating = useMemo(() => {
    return Object.values(allocAmounts).reduce((sum, v) => sum + (Number(v) || 0), 0);
  }, [allocAmounts]);

  const allocationEmployees = useMemo(() => {
    const byId = new Map<number, AllocatableEmployeeDay>();
    for (const target of allocatableEmployeeDays) {
      if (!byId.has(target.employee_id)) byId.set(target.employee_id, target);
    }
    const search = allocationEmployeeSearch.trim().toLowerCase();
    return [...byId.values()].filter((employee) =>
      !search
      || employee.employee_code.toLowerCase().includes(search)
      || (employee.employee_name || "").toLowerCase().includes(search)
    );
  }, [allocatableEmployeeDays, allocationEmployeeSearch]);

  const employeeSettlementDays = useMemo(
    () => allocatableEmployeeDays.filter((target) => String(target.employee_id) === allocationEmployeeId),
    [allocatableEmployeeDays, allocationEmployeeId],
  );

  const filteredCashReceiptEmployees = useMemo(() => {
    const query = cashReceiptEmployeeSearch.trim().toLocaleLowerCase("vi");
    if (!query) return cashReceiptEmployees;
    return cashReceiptEmployees.filter((employee) =>
      `${employee.code} ${employee.name}`.toLocaleLowerCase("vi").includes(query),
    );
  }, [cashReceiptEmployees, cashReceiptEmployeeSearch]);

  function handleAddAllocation() {
    if (!selectedReceipt) return;
    const amount = Number(allocationAmountInput);
    if (!Number.isFinite(amount) || amount <= 0) {
      setAllocationFormError("Nhập số tiền lớn hơn 0.");
      return;
    }

    let key: string;
    let targetRemaining: number;
    if (allocationTargetType === "STORE") {
      if (!allocatableStoreDebt) {
        setAllocationFormError("Cửa hàng chưa có công nợ trực tiếp để phân bổ.");
        return;
      }
      if (allocAmounts.STORE !== undefined) {
        setAllocationFormError("Cửa hàng đã được thêm. Hãy sửa số tiền ngay trong danh sách.");
        return;
      }
      key = "STORE";
      targetRemaining = allocatableStoreDebt.remaining_store_debt;
    } else {
      if (!allocationEmployeeId || !allocationSettlementDate) {
        setAllocationFormError("Chọn nhân viên và ngày quyết toán.");
        return;
      }
      key = `${allocationSettlementDate}:${allocationEmployeeId}`;
      if (allocAmounts[key] !== undefined) {
        setAllocationFormError("Nhân viên/ngày này đã có trong danh sách.");
        return;
      }
      const target = employeeSettlementDays.find((item) => item.settlement_date === allocationSettlementDate);
      if (!target) {
        setAllocationFormError("Không tìm thấy công nợ của nhân viên/ngày đã chọn.");
        return;
      }
      targetRemaining = target.remaining_employee_debt;
    }

    const availableReceiptAmount = selectedReceipt.unallocated_amount - currentTotalAllocating;
    const maximum = Math.max(0, Math.min(targetRemaining, availableReceiptAmount));
    if (amount > maximum) {
      setAllocationFormError(`Số tiền tối đa có thể thêm là ${formatVND(maximum)}.`);
      return;
    }

    setAllocAmounts((current) => ({ ...current, [key]: amount }));
    setAllocationAmountInput("");
    setAllocationEmployeeId("");
    setAllocationEmployeeSearch("");
    setAllocationSettlementDate("");
    setAllocationFormError("");
  }

  async function handleConfirmAllocate() {
    if (!selectedReceipt) return;
    const allocationsToSubmit: Array<{
      employee_id?: number;
      settlement_date?: string;
      store_id?: number;
      amount: number;
    }> = Object.entries(allocAmounts)
      .filter(([key]) => key !== "STORE")
      .map(([key, amount]) => {
        const [settlement_date, employeeId] = key.split(":");
        return {
          employee_id: Number(employeeId),
          settlement_date,
          amount: Number(amount) || 0,
        };
      })
      .filter((a) => a.amount > 0);
    if (allocatableStoreDebt) {
      const amount = allocAmounts.STORE ?? 0;
      if (amount > 0) {
        allocationsToSubmit.push({
          store_id: allocatableStoreDebt.store_id,
          amount,
        });
      }
    }

    if (allocationsToSubmit.length === 0) {
      alert("Vui lòng thêm ít nhất một khoản phân bổ và nhập số tiền.");
      return;
    }

    setSubmittingAlloc(true);
    try {
      const res = await apiFetch(`${API_URL}/bank-receipts/${selectedReceipt.id}/allocate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allocations: allocationsToSubmit }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Không thể phân bổ khoản chuyển tiền.");
      }
      setMessage(`Đã phân bổ thành công ${formatVND(currentTotalAllocating)}.`);
      setAllocateModalOpen(false);
      await loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Lỗi phân bổ.");
    } finally {
      setSubmittingAlloc(false);
    }
  }

  function openAddReceipt() {
    setAddStoreId("");
    setAddStoreSearch("");
    setAddAmount("");
    setAddRefNumber("");
    setAddDescription("");
    setAddDate(localDateTimeInput(new Date()));
    setAddModalOpen(true);
  }

  async function handleCreateReceipt(e: React.FormEvent) {
    e.preventDefault();
    if (!addStoreId) {
      alert("Vui lòng chọn Cửa hàng chuyển tiền.");
      return;
    }
    if (!addAmount || Number(addAmount) <= 0) {
      alert("Số tiền chuyển khoản phải lớn hơn 0.");
      return;
    }
    setSubmittingAdd(true);
    try {
      const res = await apiFetch(`${API_URL}/bank-receipts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_id: Number(addStoreId),
          bank_name: addBankName,
          ref_number: addRefNumber || undefined,
          amount: Number(addAmount),
          transaction_date: addDate ? new Date(addDate).toISOString() : undefined,
          description: addDescription || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Không thể tạo phiếu thu.");
      }
      setAddModalOpen(false);
      setAddAmount("");
      setAddRefNumber("");
      setAddDescription("");
      setMessage("Đã ghi nhận khoản tiền chuyển khoản mới thành công.");
      await loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Lỗi tạo phiếu.");
    } finally {
      setSubmittingAdd(false);
    }
  }

  async function openCashReceiptModal() {
    setCashReceiptEmployees([]);
    setCashReceiptEmployeeId("");
    setCashReceiptEmployeeSearch("");
    setCashReceiptAmount("");
    setCashReceiptNote("");
    setCashReceiptRemaining(null);
    setCashReceiptError("");
    setCashReceiptDate(formatDateKey(new Date()));
    setCashReceiptModalOpen(true);
    setCashReceiptEmployeesLoading(true);
    try {
      const response = await apiFetch(`${API_URL}/employees/?limit=5000&status=active`);
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.detail || "Không thể tải danh sách nhân viên.");
      }
      setCashReceiptEmployees(await response.json() as EmployeeOption[]);
    } catch (err) {
      setCashReceiptError(err instanceof Error ? err.message : "Không thể tải danh sách nhân viên.");
    } finally {
      setCashReceiptEmployeesLoading(false);
    }
  }

  async function loadCashReceiptRemaining(employeeId: string, settlementDate: string) {
    setCashReceiptRemaining(null);
    setCashReceiptError("");
    if (!employeeId || !settlementDate) return;
    setCashReceiptLoading(true);
    try {
      const params = new URLSearchParams({ from_date: settlementDate, to_date: settlementDate });
      const response = await apiFetch(`${API_URL}/delivery-requests/daily-settlements?${params.toString()}`);
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.detail || "Không thể tải công nợ quyết toán ngày.");
      }
      const settlement = (result as Array<{ employee_id: number; remaining_employee_debt: number }>)
        .find((row) => row.employee_id === Number(employeeId));
      setCashReceiptRemaining(settlement?.remaining_employee_debt ?? 0);
    } catch (err) {
      setCashReceiptError(err instanceof Error ? err.message : "Không thể tải công nợ quyết toán ngày.");
    } finally {
      setCashReceiptLoading(false);
    }
  }

  async function handleCreateCashReceipt(event: React.FormEvent) {
    event.preventDefault();
    if (!cashReceiptEmployeeId || !cashReceiptDate || !cashReceiptAmount || Number(cashReceiptAmount) <= 0) {
      setCashReceiptError("Chọn nhân viên, ngày quyết toán và nhập số tiền hợp lệ.");
      return;
    }
    setCashReceiptSubmitting(true);
    setCashReceiptError("");
    try {
      const response = await apiFetch(`${API_URL}/cash-receipts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          party_type: "EMPLOYEE",
          party_id: Number(cashReceiptEmployeeId),
          settlement_date: cashReceiptDate,
          amount: Number(cashReceiptAmount),
          note: cashReceiptNote.trim() || `Nhân viên nộp tiền mặt quyết toán ngày ${cashReceiptDate}`,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.detail || "Không thể ghi nhận tiền nhân viên nộp.");
      }
      const employee = cashReceiptEmployees.find((item) => item.id === Number(cashReceiptEmployeeId));
      setCashReceiptModalOpen(false);
      await loadCashReceiptHistory();
      setMessage(`Đã ghi nhận ${formatVND(Number(cashReceiptAmount))} tiền mặt nhân viên ${employee?.code || ""}; khoản thu đã trừ công nợ ngày ${cashReceiptDate}.`);
    } catch (err) {
      setCashReceiptError(err instanceof Error ? err.message : "Không thể ghi nhận tiền nhân viên nộp.");
    } finally {
      setCashReceiptSubmitting(false);
    }
  }

  async function handleCancelAlloc(receiptId: number, allocationId: number) {
    if (!confirm("Bạn có chắc chắn muốn hủy dòng phân bổ này? Công nợ liên quan sẽ được phục hồi.")) return;
    try {
      const res = await apiFetch(`${API_URL}/bank-receipts/${receiptId}/allocations/${allocationId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Không thể hủy phân bổ.");
      }
      setMessage("Đã hủy phân bổ thành công.");
      await loadData();
      if (historyReceipt && historyReceipt.id === receiptId) {
        const updated = await apiFetch(`${API_URL}/bank-receipts/${receiptId}`);
        if (updated.ok) {
          setHistoryReceipt(await updated.json());
        }
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Lỗi hủy phân bổ.");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Thu chuyển khoản & Nộp tiền mặt"
        subtitle="Theo dõi khoản chuyển khoản và ghi nhận tiền mặt nhân viên nộp theo ngày quyết toán"
        actions={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                void loadData();
                void loadCashReceiptHistory();
              }}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
              Làm mới
            </button>
            <button
              type="button"
              onClick={() => {
                setImportError("");
                setImportRows([]);
                setImportFileName("");
                setImportModalOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-50"
            >
              <FileSpreadsheet size={16} />
              Nhập sao kê Excel
            </button>
            <button
              type="button"
              onClick={() => void openCashReceiptModal()}
              className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 shadow-sm"
            >
              <Plus size={16} />
              Nhân viên nộp tiền mặt
            </button>
            <button
              type="button"
              onClick={openAddReceipt}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 shadow-sm"
            >
              <Plus size={16} />
              Thêm chuyển khoản
            </button>
          </div>
        }
      />

      {message && (
        <div className="flex items-center justify-between rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} />
            {message}
          </div>
          <button type="button" onClick={() => setMessage("")} className="text-emerald-600 hover:text-emerald-900">
            <X size={16} />
          </button>
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard
          label="Tổng tiền chuyển về"
          value={formatVND(stats.totalAmount)}
          icon={<Banknote size={20} />}
          color="bg-sky-50 text-sky-600"
        />
        <StatCard
          label="Đã phân bổ giảm công nợ"
          value={formatVND(stats.allocatedAmount)}
          icon={<Receipt size={20} />}
          color="bg-emerald-50 text-emerald-600"
        />
        <StatCard
          label="Tiền chờ phân bổ (Treo)"
          value={formatVND(stats.unallocatedAmount)}
          icon={<Clock size={20} />}
          color="bg-amber-50 text-amber-600"
        />
        <StatCard
          label="Món tiền còn treo"
          value={stats.unallocatedCount}
          icon={<CreditCard size={20} />}
          color="bg-purple-50 text-purple-600"
        />
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
        <label className="text-sm text-gray-600">
          Trạng thái
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="mt-1 block rounded-lg border border-gray-200 px-3 py-2 text-sm"
          >
            <option value="ALL">Tất cả trạng thái</option>
            <option value="UNALLOCATED">Chờ phân bổ</option>
            <option value="PARTIALLY_ALLOCATED">Đang phân bổ</option>
            <option value="FULLY_ALLOCATED">Đã phân bổ đủ</option>
          </select>
        </label>
        <label className="text-sm text-gray-600">
          Phương thức thu
          <select
            value={paymentMethodFilter}
            onChange={(event) => setPaymentMethodFilter(event.target.value as "ALL" | "BANK" | "CASH")}
            className="mt-1 block rounded-lg border border-gray-200 px-3 py-2 text-sm"
          >
            <option value="ALL">Tất cả phương thức</option>
            <option value="BANK">Chuyển khoản</option>
            <option value="CASH">Tiền mặt</option>
          </select>
        </label>
        <label className="text-sm text-gray-600">
          Cửa hàng <span className="text-xs text-gray-400">(lọc phiếu chuyển khoản)</span>
          <select
            value={storeFilter}
            onChange={(e) => setStoreFilter(e.target.value)}
            className="mt-1 block min-w-56 rounded-lg border border-gray-200 px-3 py-2 text-sm"
          >
            <option value="">Tất cả cửa hàng</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} - {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Unified receipt table */}
      <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left">Mã phiếu</th>
              <th className="px-4 py-3 text-left">Ngày thu</th>
              <th className="px-4 py-3 text-left">Phương thức</th>
              <th className="px-4 py-3 text-left">Người nộp</th>
              <th className="px-4 py-3 text-left">Thông tin</th>
              <th className="px-4 py-3 text-right">Tổng tiền</th>
              <th className="px-4 py-3 text-right">Đã ghi nhận</th>
              <th className="px-4 py-3 text-right">Còn lại</th>
              <th className="px-4 py-3 text-center">Trạng thái</th>
              <th className="px-4 py-3 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-gray-500">
                  Đang tải danh sách phiếu thu...
                </td>
              </tr>
            )}
            {!loading && cashReceiptHistoryError && (
              <tr>
                <td colSpan={10} className="px-4 py-3">
                  <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    Không thể tải phiếu tiền mặt: {cashReceiptHistoryError}
                  </div>
                </td>
              </tr>
            )}
            {!loading && cashReceiptHistoryLoading && cashReceipts.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-gray-500">
                  Đang tải lịch sử tiền mặt...
                </td>
              </tr>
            )}
            {!loading && !cashReceiptHistoryLoading && !cashReceiptHistoryError && receiptRows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-gray-500">
                  Không có phiếu thu nào phù hợp.
                </td>
              </tr>
            )}
            {!loading && receiptRows.map((item) => {
              if (item.method === "CASH") {
                const receipt = item.receipt;
                return (
                  <tr key={`CASH-${receipt.id}`} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{receipt.code}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">{formatDateTime(receipt.receipt_date)}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">Tiền mặt</span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-gray-900">{receipt.party_code || "—"} - {receipt.party_name || "Không xác định"}</p>
                      <p className="text-xs text-gray-500">{receipt.party_type === "EMPLOYEE" ? "Nhân viên bán hàng" : "Cửa hàng"}</p>
                    </td>
                    <td className="max-w-xs px-4 py-3 text-gray-600">
                      {receipt.settlement_date && <p>Ngày quyết toán: {formatDateKey(receipt.settlement_date)}</p>}
                      <p className="truncate text-xs text-gray-500">{receipt.note || `Người ghi nhận: ${receipt.created_by || "—"}`}</p>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">{formatVND(receipt.amount)}</td>
                    <td className="px-4 py-3 text-right font-medium text-emerald-600">{formatVND(receipt.amount)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-400">{formatVND(0)}</td>
                    <td className="px-4 py-3 text-center"><Badge variant="success">Đã ghi nhận</Badge></td>
                    <td className="px-4 py-3 text-right text-xs text-gray-400">Đã ghi nhận</td>
                  </tr>
                );
              }

              const receipt = item.receipt;
              return (
                <tr key={`BANK-${receipt.id}`} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{receipt.code}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-600">{formatDateTime(receipt.transaction_date)}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-800">Chuyển khoản</span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-gray-900">{receipt.store_name || "—"}</p>
                    <p className="text-xs text-gray-500">{receipt.store_code || "Chưa xác minh cửa hàng"}</p>
                  </td>
                  <td className="max-w-xs px-4 py-3 text-gray-600">
                    <p>{receipt.bank_name || "Ngân hàng"}</p>
                    <p className="truncate text-xs text-gray-500">{receipt.ref_number || receipt.description || "—"}</p>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900">{formatVND(receipt.amount)}</td>
                  <td className="px-4 py-3 text-right font-medium text-emerald-600">{formatVND(receipt.allocated_amount)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-amber-600">{formatVND(receipt.unallocated_amount)}</td>
                  <td className="px-4 py-3 text-center">{statusBadge(receipt.status)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap space-x-2">
                    {receipt.unallocated_amount > 0.01 && (
                      <button
                        type="button"
                        onClick={() => handleOpenAllocate(receipt)}
                        className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-sky-700 shadow-sm"
                      >
                        <Zap size={14} />
                        Phân bổ
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setHistoryReceipt(receipt);
                        setHistoryDrawerOpen(true);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      <History size={14} />
                      Lịch sử ({receipt.allocations?.length || 0})
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {importModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Nhập sao kê ngân hàng</h3>
                <p className="mt-1 text-xs text-gray-500">
                  Xem lại giao dịch tiền vào, xác nhận cửa hàng rồi mới ghi nhận phiếu.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setImportModalOpen(false)}
                disabled={importingStatement}
                className="rounded p-1 text-gray-400 hover:text-gray-600 disabled:opacity-50"
                aria-label="Đóng"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4 overflow-y-auto px-6 py-4">
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Ghi nhận sao kê chỉ tạo khoản tiền chờ phân bổ, chưa tự giảm công nợ. Mỗi giao dịch cần được xác nhận cửa hàng trước khi ghi nhận.
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <label className="min-w-72 flex-1 text-sm font-medium text-gray-700">
                  File sao kê (.xlsx)
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={(event) => void handleStatementFile(event)}
                    disabled={parsingStatement || importingStatement}
                    className="mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-emerald-50 file:px-3 file:py-1 file:font-medium file:text-emerald-800"
                  />
                </label>
                <label className="w-52 text-sm font-medium text-gray-700">
                  Ngân hàng
                  <input
                    value={importBankName}
                    onChange={(event) => setImportBankName(event.target.value)}
                    disabled={importingStatement}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  />
                </label>
                {importAccountNumber && (
                  <div className="pb-2 text-sm text-gray-600">
                    Tài khoản nhận: <strong className="font-mono text-gray-900">{importAccountNumber}</strong>
                  </div>
                )}
              </div>
              {importFileName && <p className="text-xs text-gray-500">File: {importFileName}</p>}
              {parsingStatement && <p className="text-sm text-sky-700">Đang đọc và kiểm tra sao kê...</p>}
              {importError && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {importError}
                </div>
              )}

              {importRows.length > 0 && (
                <>
                  <div className="text-sm text-gray-700">
                    Giao dịch vào: <strong>{importRows.length}</strong>
                    {" · "}Chờ xác nhận cửa hàng: <strong>{pendingStatementRows.filter((row) => row.storeId === "").length}</strong>
                    {" · "}Đã có trong hệ thống: <strong>{importRows.filter((row) => row.duplicate || row.imported).length}</strong>
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="min-w-[1050px] w-full text-sm">
                      <thead className="bg-gray-50 text-xs font-semibold uppercase text-gray-500">
                        <tr>
                          <th className="px-3 py-2 text-right">Dòng</th>
                          <th className="px-3 py-2 text-left">Ngày giờ (UTC+7)</th>
                          <th className="px-3 py-2 text-left">Nội dung chuyển tiền</th>
                          <th className="px-3 py-2 text-right">Số tiền vào</th>
                          <th className="px-3 py-2 text-right">Số dư</th>
                          <th className="px-3 py-2 text-left">Xác nhận cửa hàng</th>
                          <th className="px-3 py-2 text-left">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {importRows.map((row) => (
                          <tr key={`${row.rowNumber}-${row.reference || row.description}`} className="align-top">
                            <td className="px-3 py-2 text-right text-gray-500">{row.rowNumber}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{row.transactionDateLabel}</td>
                            <td className="max-w-sm px-3 py-2 text-gray-700">{row.description || "—"}</td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatVNDFull(row.amount)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{row.balance === null ? "—" : formatVNDFull(row.balance)}</td>
                            <td className="px-3 py-2">
                              {row.duplicate || row.imported || row.error ? (
                                <span className="text-gray-500">
                                  {stores.find((store) => store.id === row.storeId)?.code || "—"}
                                </span>
                              ) : (
                                <select
                                  value={row.storeId}
                                  onChange={(event) => {
                                    const value = Number(event.target.value) || "";
                                    setImportRows((current) => current.map((item) =>
                                      item.rowNumber === row.rowNumber ? { ...item, storeId: value } : item
                                    ));
                                  }}
                                  disabled={importingStatement}
                                  className="w-60 rounded border border-gray-200 px-2 py-1.5 text-xs"
                                >
                                  <option value="">Chọn cửa hàng để xác nhận</option>
                                  {stores.map((store) => (
                                    <option key={store.id} value={store.id}>{store.code} - {store.name}</option>
                                  ))}
                                </select>
                              )}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              {row.duplicate ? (
                                <span className="text-amber-700">Đã nhập trước đó</span>
                              ) : row.imported ? (
                                <span className="text-emerald-700">Đã ghi nhận</span>
                              ) : row.error ? (
                                <span className="text-red-700">{row.error}</span>
                              ) : row.storeId === "" ? (
                                <span className="text-amber-700">Chờ xác minh</span>
                              ) : (
                                <span className="text-sky-700">Sẵn sàng ghi nhận</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t px-6 py-4">
              <p className="text-xs text-gray-500">
                Số tiền lưu chưa phân bổ; sau đó kế toán chọn phân bổ cho cửa hàng hoặc nhân viên/ngày quyết toán.
              </p>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => setImportModalOpen(false)}
                  disabled={importingStatement}
                  className="rounded-lg border px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  Đóng
                </button>
                <button
                  type="button"
                  onClick={() => void handleImportStatement()}
                  disabled={!canImportStatement || importingStatement || parsingStatement}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {importingStatement ? "Đang ghi nhận..." : `Ghi nhận ${pendingStatementRows.length} khoản`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {cashReceiptModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Ghi nhận nhân viên nộp tiền mặt</h3>
                <p className="mt-1 text-xs text-gray-500">Khoản thu được ghi thẳng vào quyết toán nhân viên/ngày đã chọn.</p>
              </div>
              <button
                type="button"
                onClick={() => setCashReceiptModalOpen(false)}
                className="rounded p-1 text-gray-400 hover:text-gray-600"
                aria-label="Đóng"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreateCashReceipt} className="mt-4 space-y-4">
              <label className="block text-sm font-medium text-gray-700">
                Nhân viên bán hàng <span className="text-red-500">*</span>
                <input
                  type="search"
                  value={cashReceiptEmployeeSearch}
                  onChange={(event) => setCashReceiptEmployeeSearch(event.target.value)}
                  placeholder="Tìm theo mã hoặc tên"
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
                <select
                  required
                  value={cashReceiptEmployeeId}
                  disabled={cashReceiptEmployeesLoading}
                  onChange={(event) => {
                    const employeeId = event.target.value;
                    setCashReceiptEmployeeId(employeeId);
                    void loadCashReceiptRemaining(employeeId, cashReceiptDate);
                  }}
                  className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm disabled:bg-gray-100"
                >
                  <option value="">{cashReceiptEmployeesLoading ? "Đang tải nhân viên..." : "Chọn nhân viên"}</option>
                  {filteredCashReceiptEmployees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.code} - {employee.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-medium text-gray-700">
                  Ngày quyết toán <span className="text-red-500">*</span>
                  <input
                    type="date"
                    required
                    value={cashReceiptDate}
                    onChange={(event) => {
                      const settlementDate = event.target.value;
                      setCashReceiptDate(settlementDate);
                      void loadCashReceiptRemaining(cashReceiptEmployeeId, settlementDate);
                    }}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  />
                </label>
                <div className="text-sm font-medium text-gray-700">
                  Công nợ ngày còn lại
                  <p className="mt-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-amber-700">
                    {cashReceiptLoading
                      ? "Đang tải..."
                      : cashReceiptRemaining === null
                        ? "Chọn nhân viên và ngày"
                        : formatVND(cashReceiptRemaining)}
                  </p>
                </div>
              </div>

              <label className="block text-sm font-medium text-gray-700">
                Số tiền nhân viên bàn giao (VND) <span className="text-red-500">*</span>
                <input
                  type="number"
                  required
                  min={1}
                  max={cashReceiptRemaining ?? undefined}
                  step={1}
                  value={cashReceiptAmount}
                  onChange={(event) => setCashReceiptAmount(event.target.value === "" ? "" : Number(event.target.value))}
                  placeholder="Nhập số tiền nhận"
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-right text-base font-semibold"
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                Ghi chú / mã biên nhận
                <textarea
                  rows={2}
                  value={cashReceiptNote}
                  onChange={(event) => setCashReceiptNote(event.target.value)}
                  placeholder="Thông tin bàn giao, ca bán hàng hoặc biên nhận (nếu có)"
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
              </label>
              {cashReceiptError && (
                <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{cashReceiptError}</p>
              )}
              <div className="flex justify-end gap-2 border-t pt-3">
                <button
                  type="button"
                  onClick={() => setCashReceiptModalOpen(false)}
                  className="rounded-lg border px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={
                    cashReceiptSubmitting
                    || cashReceiptLoading
                    || cashReceiptRemaining === null
                    || cashReceiptRemaining <= 0
                    || !cashReceiptAmount
                    || Number(cashReceiptAmount) > cashReceiptRemaining
                  }
                  className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {cashReceiptSubmitting ? "Đang ghi nhận..." : "Ghi nhận và trừ công nợ"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Add Bank Receipt */}
      {addModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-lg font-semibold text-gray-900">Ghi nhận khoản tiền chuyển khoản</h3>
              <button
                type="button"
                onClick={() => setAddModalOpen(false)}
                className="rounded p-1 text-gray-400 hover:text-gray-600"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreateReceipt} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Cửa hàng chuyển tiền <span className="text-red-500">*</span>
                </label>
                <div className="relative mb-1.5">
                  <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Tìm nhanh theo mã hoặc tên cửa hàng..."
                    value={addStoreSearch}
                    onChange={(e) => setAddStoreSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>
                <select
                  required
                  value={addStoreId}
                  onChange={(e) => setAddStoreId(Number(e.target.value) || "")}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-sky-500"
                >
                  <option value="">-- Chọn Cửa hàng / Điểm bán ({filteredModalStores.length} cửa hàng) --</option>
                  {filteredModalStores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} - {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Số tiền (VND) *</label>
                  <input
                    type="number"
                    required
                    min={1000}
                    step={1}
                    placeholder="VD: 20000000"
                    value={addAmount}
                    onChange={(e) => setAddAmount(Number(e.target.value) || "")}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Ngân hàng</label>
                  <input
                    type="text"
                    value={addBankName}
                    onChange={(e) => setAddBankName(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    placeholder="VCB, BIDV, v.v."
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Mã giao dịch / FT</label>
                  <input
                    type="text"
                    value={addRefNumber}
                    onChange={(e) => setAddRefNumber(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono"
                    placeholder="VD: FT261014-9988"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Thời gian GD</label>
                  <input
                    type="datetime-local"
                    value={addDate}
                    onChange={(e) => setAddDate(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nội dung chuyển khoản
                </label>
                <textarea
                  rows={2}
                  value={addDescription}
                  onChange={(e) => setAddDescription(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  placeholder="Ghi chú theo nội dung biến động số dư ngân hàng..."
                />
              </div>

              <div className="flex justify-end gap-2 border-t pt-3">
                <button
                  type="button"
                  onClick={() => setAddModalOpen(false)}
                  className="rounded-lg border px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={submittingAdd}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {submittingAdd ? "Đang lưu..." : "Xác nhận tạo phiếu"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Allocate Bank Receipt */}
      {allocateModalOpen && selectedReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900">
                  Phân bổ khoản thu - {selectedReceipt.code}
                </h3>
                <p className="text-xs text-gray-500">
                  Cửa hàng: <strong className="text-gray-800">{selectedReceipt.store_name}</strong> ({selectedReceipt.store_code})
                  {" • "}
                  Mã GD: <span className="font-mono">{selectedReceipt.ref_number || "—"}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAllocateModalOpen(false)}
                className="rounded p-1 text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>

            {/* Top Budget Bar */}
            <div className="grid grid-cols-3 gap-4 border-b bg-sky-50/60 px-6 py-3 text-sm">
              <div>
                <span className="text-gray-500">Khoản chuyển còn lại:</span>
                <p className="text-base font-bold text-sky-700">{formatVND(selectedReceipt.unallocated_amount)}</p>
              </div>
              <div>
                <span className="text-gray-500">Đã thêm:</span>
                <p className={`text-base font-bold ${currentTotalAllocating > selectedReceipt.unallocated_amount ? "text-red-600" : "text-emerald-700"}`}>
                  {formatVND(currentTotalAllocating)}
                </p>
              </div>
              <div>
                <span className="text-gray-500">Còn lại để phân bổ:</span>
                <p className="text-base font-bold text-gray-900">
                  {formatVND(Math.max(0, selectedReceipt.unallocated_amount - currentTotalAllocating))}
                </p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {allocationLoadError && (
                <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {allocationLoadError}
                </div>
              )}

              {loadingOrders && <p className="py-8 text-center text-sm text-gray-500">Đang tải các khoản công nợ còn lại...</p>}
              {!loadingOrders && !allocationLoadError && (
                <div className="space-y-5">
                  <section className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <h4 className="text-sm font-semibold text-gray-900">Thêm khoản phân bổ</h4>
                    <p className="mt-1 text-xs text-gray-500">Chọn một đối tượng, nhập số tiền rồi thêm vào danh sách.</p>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <label className="text-xs font-medium text-gray-700">
                        Loại đối tượng
                        <select
                          value={allocationTargetType}
                          onChange={(event) => {
                            setAllocationTargetType(event.target.value as "EMPLOYEE" | "STORE");
                            setAllocationAmountInput("");
                            setAllocationFormError("");
                          }}
                          className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm"
                        >
                          <option value="EMPLOYEE">Nhân viên</option>
                          <option value="STORE">Cửa hàng</option>
                        </select>
                      </label>
                      {allocationTargetType === "EMPLOYEE" ? (
                        <div className="space-y-3">
                          <label className="block text-xs font-medium text-gray-700">
                            Tìm nhân viên theo mã hoặc tên
                            <input
                              type="search"
                              value={allocationEmployeeSearch}
                              onChange={(event) => {
                                setAllocationEmployeeSearch(event.target.value);
                                setAllocationEmployeeId("");
                                setAllocationSettlementDate("");
                                setAllocationFormError("");
                              }}
                              placeholder="Nhập mã hoặc tên"
                              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm"
                            />
                          </label>
                          <label className="block text-xs font-medium text-gray-700">
                            Nhân viên
                            <select
                              value={allocationEmployeeId}
                              onChange={(event) => {
                                setAllocationEmployeeId(event.target.value);
                                setAllocationSettlementDate("");
                                setAllocationFormError("");
                              }}
                              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm"
                            >
                              <option value="">Chọn nhân viên ({allocationEmployees.length})</option>
                              {allocationEmployees.map((employee) => (
                                <option key={employee.employee_id} value={employee.employee_id}>
                                  {employee.employee_code} - {employee.employee_name || ""}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      ) : (
                        <div className="text-xs font-medium text-gray-700">
                          Cửa hàng
                          <p className="mt-1 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold text-gray-900">
                            {selectedReceipt.store_code} - {selectedReceipt.store_name}
                          </p>
                        </div>
                      )}
                      {allocationTargetType === "EMPLOYEE" && (
                        <label className="text-xs font-medium text-gray-700">
                          Ngày quyết toán
                          <select
                            value={allocationSettlementDate}
                            onChange={(event) => {
                              setAllocationSettlementDate(event.target.value);
                              setAllocationFormError("");
                            }}
                            disabled={!allocationEmployeeId}
                            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm disabled:bg-gray-100"
                          >
                            <option value="">Chọn ngày có công nợ</option>
                            {employeeSettlementDays.map((target) => {
                              const alreadyAdded = allocAmounts[`${target.settlement_date}:${target.employee_id}`] !== undefined;
                              return (
                                <option
                                  key={target.settlement_date}
                                  value={target.settlement_date}
                                  disabled={alreadyAdded}
                                >
                                  {new Date(`${target.settlement_date}T00:00:00`).toLocaleDateString("vi-VN")} · Còn {formatVND(target.remaining_employee_debt)}{alreadyAdded ? " · Đã thêm" : ""}
                                </option>
                              );
                            })}
                          </select>
                        </label>
                      )}
                      {allocationTargetType === "STORE" && (
                        <div className="text-xs font-medium text-gray-700">
                          Công nợ cửa hàng còn lại
                          <p className="mt-1 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold text-amber-700">
                            {formatVND(allocatableStoreDebt?.remaining_store_debt ?? 0)}
                          </p>
                        </div>
                      )}
                      <label className="text-xs font-medium text-gray-700">
                        Số tiền phân bổ (VNĐ)
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={allocationAmountInput}
                          onChange={(event) => {
                            setAllocationAmountInput(event.target.value === "" ? "" : Number(event.target.value));
                            setAllocationFormError("");
                          }}
                          placeholder="Nhập số tiền"
                          className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-right text-base font-semibold"
                        />
                      </label>
                      <div className="flex items-end">
                        <button
                          type="button"
                          onClick={handleAddAllocation}
                          disabled={
                            !allocationAmountInput
                            || (allocationTargetType === "EMPLOYEE" && (!allocationEmployeeId || !allocationSettlementDate))
                            || (allocationTargetType === "STORE" && (
                              !allocatableStoreDebt
                              || allocatableStoreDebt.remaining_store_debt <= 0
                              || allocAmounts.STORE !== undefined
                            ))
                          }
                          className="w-full rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Thêm vào danh sách
                        </button>
                      </div>
                    </div>
                    {allocationFormError && (
                      <p role="alert" className="mt-3 text-sm text-red-600">{allocationFormError}</p>
                    )}
                    {allocationTargetType === "STORE" && !allocatableStoreDebt && (
                      <p className="mt-3 text-xs text-amber-700">Cửa hàng chưa có dư nợ trực tiếp để phân bổ.</p>
                    )}
                    {allocationTargetType === "STORE" && allocAmounts.STORE !== undefined && (
                      <p className="mt-3 text-xs text-gray-500">Cửa hàng đã có trong danh sách; có thể chỉnh sửa số tiền tại dòng bên dưới.</p>
                    )}
                  </section>

                  {Object.keys(allocAmounts).length > 0 ? (
                        <div className="overflow-x-auto rounded-xl border border-gray-200">
                          <table className="w-full min-w-[620px] text-left text-sm">
                            <thead className="bg-gray-50 text-xs font-semibold uppercase text-gray-600">
                              <tr>
                                <th className="px-3 py-2.5">Đối tượng</th>
                                <th className="px-3 py-2.5">Ngày quyết toán</th>
                                <th className="px-3 py-2.5 text-right">Còn công nợ</th>
                                <th className="px-3 py-2.5 text-right">Số tiền phân bổ</th>
                                <th className="px-3 py-2.5"></th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {allocAmounts.STORE !== undefined && allocatableStoreDebt && (
                                <tr key="STORE">
                                  <td className="px-3 py-2.5 font-medium text-gray-900">
                                    {allocatableStoreDebt.store_code} - {allocatableStoreDebt.store_name}
                                  </td>
                                  <td className="px-3 py-2.5 text-gray-400">—</td>
                                  <td className="px-3 py-2.5 text-right text-amber-700">
                                    {formatVND(allocatableStoreDebt.remaining_store_debt)}
                                  </td>
                                  <td className="px-3 py-2.5 text-right">
                                    <input
                                      type="number"
                                      min={0}
                                      max={allocatableStoreDebt.remaining_store_debt}
                                      step={1}
                                      value={allocAmounts.STORE}
                                      onChange={(event) => {
                                        const amount = Number(event.target.value) || 0;
                                        const available = selectedReceipt.unallocated_amount - (currentTotalAllocating - allocAmounts.STORE);
                                        setAllocAmounts((current) => ({
                                          ...current,
                                          STORE: Math.min(amount, allocatableStoreDebt.remaining_store_debt, available),
                                        }));
                                      }}
                                      className="w-40 rounded border border-gray-300 px-2 py-1.5 text-right text-sm font-semibold focus:border-sky-500"
                                    />
                                  </td>
                                  <td className="px-3 py-2.5 text-right">
                                    <button
                                      type="button"
                                      onClick={() => setAllocAmounts((current) => {
                                        const next = { ...current };
                                        delete next.STORE;
                                        return next;
                                      })}
                                      className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                                      title="Bỏ dòng phân bổ"
                                    >
                                      <Trash2 size={16} />
                                    </button>
                                  </td>
                                </tr>
                              )}
                              {Object.entries(allocAmounts)
                                .filter(([key]) => key !== "STORE")
                                .map(([key, value]) => {
                                  const [settlementDate, employeeId] = key.split(":");
                                  const target = allocatableEmployeeDays.find((item) =>
                                    item.settlement_date === settlementDate
                                    && String(item.employee_id) === employeeId
                                  );
                                  if (!target) return null;
                                  return (
                                    <tr key={key}>
                                      <td className="px-3 py-2.5 font-medium text-gray-900">
                                        {target.employee_code} - {target.employee_name || ""}
                                      </td>
                                      <td className="px-3 py-2.5">
                                        {new Date(`${target.settlement_date}T00:00:00`).toLocaleDateString("vi-VN")}
                                      </td>
                                      <td className="px-3 py-2.5 text-right text-amber-700">
                                        {formatVND(target.remaining_employee_debt)}
                                      </td>
                                      <td className="px-3 py-2.5 text-right">
                                        <div className="flex items-center justify-end gap-1">
                                          <input
                                            type="number"
                                            min={0}
                                            max={target.remaining_employee_debt}
                                            step={1}
                                            value={value || ""}
                                            placeholder="Nhập số tiền"
                                            onChange={(event) => {
                                              const amount = Number(event.target.value) || 0;
                                              const available = selectedReceipt.unallocated_amount - (currentTotalAllocating - value);
                                              setAllocAmounts((current) => ({
                                                ...current,
                                                [key]: Math.min(amount, target.remaining_employee_debt, available),
                                              }));
                                            }}
                                            className="w-40 rounded border border-gray-300 px-2 py-1.5 text-right text-sm font-semibold focus:border-sky-500"
                                          />
                                          <button
                                            type="button"
                                            title="Phân bổ tối đa cho dòng này"
                                            onClick={() => setAllocAmounts((current) => {
                                              const available = selectedReceipt.unallocated_amount - (currentTotalAllocating - value);
                                              return {
                                                ...current,
                                                [key]: Math.min(target.remaining_employee_debt, available),
                                              };
                                            })}
                                            className="rounded bg-gray-100 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-200"
                                          >
                                            Max
                                          </button>
                                        </div>
                                      </td>
                                      <td className="px-3 py-2.5 text-right">
                                        <button
                                          type="button"
                                          onClick={() => setAllocAmounts((current) => {
                                            const next = { ...current };
                                            delete next[key];
                                            return next;
                                          })}
                                          className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                                          title="Bỏ dòng phân bổ"
                                        >
                                          <Trash2 size={16} />
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                })}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="rounded-lg border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-500">
                          Chưa thêm khoản phân bổ nào.
                        </p>
                      )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end border-t bg-gray-50 px-6 py-4">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAllocateModalOpen(false)}
                  className="rounded-lg border px-4 py-2 text-sm font-medium text-gray-600 hover:bg-white"
                >
                  Đóng
                </button>
                <button
                  type="button"
                  disabled={submittingAlloc || currentTotalAllocating <= 0 || currentTotalAllocating > selectedReceipt.unallocated_amount}
                  onClick={handleConfirmAllocate}
                  className="rounded-lg bg-sky-600 px-5 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50 shadow-sm"
                >
                  {submittingAlloc ? "Đang xử lý..." : "Xác nhận phân bổ"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* History Drawer */}
      <Drawer
        open={historyDrawerOpen}
        onClose={() => setHistoryDrawerOpen(false)}
        title={`Lịch sử phân bổ - ${historyReceipt?.code || ""}`}
      >
        <div className="space-y-4 p-4 text-sm">
          {historyReceipt && (
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 space-y-1">
              <p className="font-semibold text-gray-900">{historyReceipt.store_name}</p>
              <p className="text-xs text-gray-500">
                Tổng tiền: <strong>{formatVND(historyReceipt.amount)}</strong> • Đã phân bổ:{" "}
                <strong className="text-emerald-600">{formatVND(historyReceipt.allocated_amount)}</strong>
              </p>
            </div>
          )}

          <h5 className="font-semibold text-gray-800">Lịch sử các khoản phân bổ:</h5>

          {(!historyReceipt?.allocations || historyReceipt.allocations.length === 0) && (
            <p className="text-xs text-gray-500">Chưa có bút toán phân bổ nào.</p>
          )}

          {historyReceipt?.allocations?.map((alloc) => (
            <div key={alloc.id} className="flex items-center justify-between rounded-lg border p-3 bg-white shadow-xs">
              <div>
                <p className="font-semibold text-gray-900">
                  {alloc.order_number ? `Đơn: ${alloc.order_number}` : alloc.employee_id ? "Phân bổ công nợ nhân viên" : "Giảm nợ cửa hàng"}
                </p>
                <p className="text-xs text-gray-500">
                  NV: <span className="font-medium text-gray-700">{alloc.employee_code || "—"}</span> ({alloc.employee_name || ""})
                  {alloc.settlement_date && ` · Ngày quyết toán ${new Date(`${alloc.settlement_date}T00:00:00`).toLocaleDateString("vi-VN")}`}
                </p>
                <p className="text-xs text-gray-400">{formatDateTime(alloc.created_at)}</p>
              </div>
              <div className="text-right space-y-1">
                <p className="font-bold text-emerald-600">{formatVND(alloc.amount)}</p>
                <button
                  type="button"
                  onClick={() => handleCancelAlloc(historyReceipt.id, alloc.id)}
                  className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-800"
                >
                  <Trash2 size={12} />
                  Hủy phân bổ
                </button>
              </div>
            </div>
          ))}
        </div>
      </Drawer>
    </div>
  );
}

"use client";
// src/components/ui/DataTable.tsx
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Search, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  title: string;
  render?: (value: unknown, row: T) => React.ReactNode;
  sortable?: boolean;
  /** CSS size such as `8rem` or `140px`, applied as min/width so columns stay consistent. */
  width?: string;
  align?: "left" | "center" | "right";
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  searchable?: boolean;
  searchPlaceholder?: string;
  searchKeys?: (keyof T)[];
  pageSize?: number;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  toolbar?: React.ReactNode;
  selectable?: boolean;
  selectedKeys?: Set<string>;
  onSelectedKeysChange?: (keys: Set<string>) => void;
  getRowKey?: (row: T, index: number) => string;
  isRowSelectable?: (row: T) => boolean;
  /** Size columns to content, keep cells on one line, and scroll horizontally. */
  fitColumns?: boolean;
  defaultSortKey?: string;
  defaultSortDir?: "asc" | "desc";
}

function getByKey<T>(row: T, key: string): unknown {
  return (row as Record<string, unknown>)[key];
}

export default function DataTable<T>({
  data,
  columns,
  searchable = true,
  searchPlaceholder = "Tìm kiếm...",
  searchKeys = [],
  pageSize = 10,
  onRowClick,
  emptyMessage = "Không có dữ liệu",
  toolbar,
  selectable = false,
  selectedKeys,
  onSelectedKeysChange,
  getRowKey,
  isRowSelectable,
  fitColumns = false,
  defaultSortKey,
  defaultSortDir = "asc",
}: DataTableProps<T>) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<string | null>(defaultSortKey ?? null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(defaultSortDir);
  const headerCheckboxRef = useRef<HTMLInputElement>(null);

  const filtered = data.filter((row) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return searchKeys.some((k) =>
      String(getByKey(row, String(k)) ?? "").toLowerCase().includes(q)
    );
  });

  const sorted = sortKey
    ? [...filtered].sort((a, b) => {
        const va = getByKey(a, sortKey) ?? "";
        const vb = getByKey(b, sortKey) ?? "";
        if (typeof va === "number" && typeof vb === "number") {
          return sortDir === "asc" ? va - vb : vb - va;
        }
        const cmp = String(va).localeCompare(String(vb), "vi", { numeric: true });
        return sortDir === "asc" ? cmp : -cmp;
      })
    : filtered;

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const paginated = sorted.slice((page - 1) * pageSize, page * pageSize);

  const selection = selectedKeys ?? new Set<string>();
  const keyForRow = (row: T, index: number) => (getRowKey ? getRowKey(row, index) : String(index));
  const canSelect = (row: T) => (isRowSelectable ? isRowSelectable(row) : true);
  const pageKeys = paginated
    .map((row, index) => ({ row, key: keyForRow(row, (page - 1) * pageSize + index) }))
    .filter(({ row }) => canSelect(row))
    .map(({ key }) => key);
  const allPageSelected = pageKeys.length > 0 && pageKeys.every((key) => selection.has(key));
  const somePageSelected = pageKeys.some((key) => selection.has(key));

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = somePageSelected && !allPageSelected;
    }
  }, [somePageSelected, allPageSelected]);

  const toggleRowSelection = (key: string, checked: boolean) => {
    if (!onSelectedKeysChange) return;
    const next = new Set(selection);
    if (checked) next.add(key);
    else next.delete(key);
    onSelectedKeysChange(next);
  };

  const togglePageSelection = (checked: boolean) => {
    if (!onSelectedKeysChange) return;
    const next = new Set(selection);
    pageKeys.forEach((key) => {
      if (checked) next.add(key);
      else next.delete(key);
    });
    onSelectedKeysChange(next);
  };

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      {(searchable || toolbar) && (
        <div className="flex items-center gap-3 p-4 border-b border-gray-100">
          {searchable && (
            <div className="relative flex-1 max-w-xs">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder={searchPlaceholder}
                className="pl-9 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-sky-500 focus:bg-white"
              />
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">{toolbar}</div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className={cn("text-sm", fitColumns ? "w-max table-fixed" : "w-full")}>
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              {selectable && (
                <th className="w-10 min-w-10 px-4 py-3" scope="col">
                  <input
                    ref={headerCheckboxRef}
                    type="checkbox"
                    checked={allPageSelected}
                    disabled={pageKeys.length === 0}
                    onChange={(event) => togglePageSelection(event.target.checked)}
                    className="h-4 w-4 cursor-pointer rounded border-gray-300 text-sky-600 focus:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Chọn tất cả dòng trên trang"
                  />
                </th>
              )}
              {columns.map((col, colIndex) => (
                <th
                  key={`${col.key}-${colIndex}`}
                  style={col.width ? { width: col.width, minWidth: col.width, maxWidth: col.width } : undefined}
                  className={cn(
                    "px-4 py-3 text-xs font-semibold text-gray-500 uppercase align-middle",
                    fitColumns ? "whitespace-nowrap overflow-hidden text-ellipsis tracking-normal" : "tracking-wide",
                    col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left",
                    col.sortable && "cursor-pointer hover:text-gray-700 select-none"
                  )}
                  onClick={() => col.sortable && handleSort(col.key)}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.title}
                    {col.sortable && sortKey === col.key && (
                      sortDir === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {paginated.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0)} className="px-4 py-12 text-center text-gray-400 text-sm">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              paginated.map((row, i) => {
                const globalIndex = (page - 1) * pageSize + i;
                const rowKey = keyForRow(row, globalIndex);
                return (
                  <tr
                    key={rowKey}
                    onClick={() => onRowClick?.(row)}
                    className={cn(
                      "hover:bg-gray-50 transition-colors",
                      onRowClick && "cursor-pointer",
                      selectable && selection.has(rowKey) && "bg-sky-50/60"
                    )}
                  >
                    {selectable && (
                      <td className="w-10 min-w-10 px-4 py-3 align-middle" onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selection.has(rowKey)}
                          disabled={!canSelect(row)}
                          onChange={(event) => toggleRowSelection(rowKey, event.target.checked)}
                          className="h-4 w-4 cursor-pointer rounded border-gray-300 text-sky-600 focus:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label="Chọn dòng"
                        />
                      </td>
                    )}
                    {columns.map((col, colIndex) => (
                      <td
                        key={`${col.key}-${colIndex}`}
                        style={col.width ? { width: col.width, minWidth: col.width, maxWidth: col.width } : undefined}
                        className={cn(
                          "px-4 py-3 text-gray-700 align-middle",
                          fitColumns && "whitespace-nowrap overflow-hidden text-ellipsis",
                          col.align === "right" && "tabular-nums",
                          col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"
                        )}
                      >
                        {col.render
                          ? col.render(getByKey(row, col.key), row)
                          : String(getByKey(row, col.key) ?? "")}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
        <span className="text-xs text-gray-400">
          {filtered.length} kết quả {search && `cho "${search}"`}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPage(1)}
            disabled={page === 1}
            title="Về trang đầu"
            aria-label="Về trang đầu"
            className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronsLeft size={16} />
          </button>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={16} />
          </button>
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            const pg = totalPages <= 5 ? i + 1 : Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
            return (
              <button
                key={pg}
                onClick={() => setPage(pg)}
                className={cn(
                  "w-7 h-7 rounded text-xs font-medium",
                  pg === page ? "bg-sky-500 text-white" : "hover:bg-gray-100 text-gray-600"
                )}
              >
                {pg}
              </button>
            );
          })}
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronRight size={16} />
          </button>
          <button
            onClick={() => setPage(totalPages)}
            disabled={page === totalPages}
            title="Về trang cuối"
            aria-label="Về trang cuối"
            className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronsRight size={16} />
          </button>
          <form
            className="ml-2 flex items-center gap-1 text-xs text-gray-500"
            onSubmit={(event) => {
              event.preventDefault();
              const value = Number(new FormData(event.currentTarget).get("page"));
              if (Number.isFinite(value) && value >= 1) setPage(Math.min(totalPages, Math.floor(value)));
              event.currentTarget.reset();
            }}
          >
            <span>Đến trang</span>
            <input
              name="page"
              type="number"
              min={1}
              max={totalPages}
              placeholder={`${page}/${totalPages}`}
              aria-label="Nhập số trang cần đến"
              className="h-7 w-16 rounded border border-gray-200 px-1.5 text-xs text-gray-700"
            />
            <button type="submit" className="h-7 rounded border border-gray-200 px-2 font-medium text-gray-600 hover:bg-gray-100">Đi</button>
          </form>
        </div>
      </div>
    </div>
  );
}
import * as XLSX from "xlsx";

export function downloadExcel(
  rows: Array<Record<string, unknown>>,
  filename: string,
  sheetName = "Data",
) {
  if (rows.length === 0) return;
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

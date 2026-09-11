// Minimal RFC 4180 CSV parser for Google Sheets "export?format=csv" output.
// Handles quoted fields, escaped quotes, and newlines inside quotes.

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.startsWith("﻿") ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Turns a CSV table into objects keyed by the header row. Headers are
 * trimmed and lower-cased; empty header cells are skipped. Rows that are
 * entirely empty are dropped.
 */
export function csvToObjects(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const out: Record<string, string>[] = [];
  for (const row of rows.slice(1)) {
    if (row.every((c) => c.trim() === "")) continue;
    const obj: Record<string, string> = {};
    header.forEach((h, i) => {
      if (h) obj[h] = (row[i] ?? "").trim();
    });
    out.push(obj);
  }
  return out;
}

export interface CSVExportItem {
  title: string;
  description: string;
  category: string;
}

export function escapeCSV(value: string): string {
  if (!value) return "";
  let stringValue = String(value);
  if (/^[=+\-@\t\r]/.test(stringValue)) {
    stringValue = "'" + stringValue;
  }
  if (stringValue.includes(",") || stringValue.includes('"') || stringValue.includes("\n")) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

export function exportToCSV(items: CSVExportItem[], filename: string): void {
  const headers = ["Title", "Description", "Category"];
  const rows = items.map((item) => [
    escapeCSV(item.title),
    escapeCSV(item.description),
    escapeCSV(item.category),
  ]);

  const csvContent = [
    headers.join(","),
    ...rows.map((row) => row.join(",")),
  ].join("\n");

  downloadCSVBlob(csvContent, filename);
}

export function downloadCSVBlob(csvContent: string, filename: string): void {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename.replace(/[^a-zA-Z0-9]/g, "_")}_${new Date().toISOString().split("T")[0]}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export interface ContentAssetCSVRow {
  title: string;
  description: string;
  url: string;
  category: string;
  status: string;
  fileType: string;
  createdDate: string;
}

export function exportContentAssetsToCSV(items: ContentAssetCSVRow[], filename: string): void {
  const headers = ["Title", "Description", "URL", "Category", "Status", "File Type", "Created Date"];
  const rows = items.map((item) => [
    escapeCSV(item.title),
    escapeCSV(item.description),
    escapeCSV(item.url),
    escapeCSV(item.category),
    escapeCSV(item.status),
    escapeCSV(item.fileType),
    escapeCSV(item.createdDate),
  ]);

  const csvContent = [
    headers.join(","),
    ...rows.map((row) => row.join(",")),
  ].join("\n");

  downloadCSVBlob(csvContent, filename);
}

export interface BrandAssetCSVRow {
  name: string;
  description: string;
  url: string;
  category: string;
  status: string;
  fileType: string;
  createdDate: string;
}

export function exportBrandAssetsToCSV(items: BrandAssetCSVRow[], filename: string): void {
  const headers = ["Name", "Description", "URL", "Category", "Status", "File Type", "Created Date"];
  const rows = items.map((item) => [
    escapeCSV(item.name),
    escapeCSV(item.description),
    escapeCSV(item.url),
    escapeCSV(item.category),
    escapeCSV(item.status),
    escapeCSV(item.fileType),
    escapeCSV(item.createdDate),
  ]);

  const csvContent = [
    headers.join(","),
    ...rows.map((row) => row.join(",")),
  ].join("\n");

  downloadCSVBlob(csvContent, filename);
}

export function parseCSV(text: string): Record<string, string>[] {
  const allRows = parseCSVRows(text);
  if (allRows.length < 2) return [];

  const headers = allRows[0].map(h => h.trim());
  const result: Record<string, string>[] = [];

  for (let i = 1; i < allRows.length; i++) {
    const values = allRows[i];
    const row: Record<string, string> = {};
    headers.forEach((header, idx) => {
      row[header] = (values[idx] || "").trim();
    });
    result.push(row);
  }

  return result;
}

function parseCSVRows(text: string): string[][] {
  const rows: string[][] = [];
  let current = "";
  let inQuotes = false;
  let fields: string[] = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current);
        current = "";
      } else if (ch === '\r') {
        if (i + 1 < text.length && text[i + 1] === '\n') {
          i++;
        }
        fields.push(current);
        current = "";
        if (fields.some(f => f.trim())) rows.push(fields);
        fields = [];
      } else if (ch === '\n') {
        fields.push(current);
        current = "";
        if (fields.some(f => f.trim())) rows.push(fields);
        fields = [];
      } else {
        current += ch;
      }
    }
  }

  fields.push(current);
  if (fields.some(f => f.trim())) rows.push(fields);

  return rows;
}

export interface CSVExportItem {
  title: string;
  description: string;
  category: string;
}

export function exportToCSV(items: CSVExportItem[], filename: string): void {
  const escapeCSV = (value: string): string => {
    if (!value) return "";
    const stringValue = String(value);
    if (stringValue.includes(",") || stringValue.includes('"') || stringValue.includes("\n")) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    return stringValue;
  };

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

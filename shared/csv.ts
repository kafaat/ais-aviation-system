/**
 * Escape CSV field value
 */
export function escapeCSV(value: string): string {
  // Spreadsheet applications interpret formula-leading untrusted text on open.
  if (/^[\s\u0000-\u001f]*[=+@-]/u.test(value) || /^[\t\r\n]/u.test(value))
    value = "'" + value;
  if (
    value.includes(",") ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

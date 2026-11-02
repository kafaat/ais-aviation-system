/**
 * Helper function to download file from content
 */
export function downloadFile(
  content: string,
  filename: string,
  contentType: string,
  encoding?: string
) {
  let blob: Blob;
  if (encoding === "base64") {
    const byteCharacters = atob(content);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    blob = new Blob([byteArray], { type: contentType });
  } else {
    blob = new Blob([content], { type: contentType });
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

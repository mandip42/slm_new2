/**
 * File download and upload helpers.
 *
 * Everything happens locally: a Blob URL is created, clicked and revoked. No
 * export ever leaves the device unless the user explicitly shares the file
 * afterwards.
 */

import { APP_SHORT_NAME } from '@/lib/branding';
import { filenameTimestamp, slugify } from '@/lib/format';

/** Prefix on every exported file, so exports stay recognisable in a downloads folder. */
const FILE_PREFIX = APP_SHORT_NAME.toLowerCase();

export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadText(text: string, filename: string, mime = 'text/plain'): void {
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename);
}

export function downloadCsv(text: string, filename: string): void {
  // A BOM makes Excel open UTF-8 CSV correctly, which matters for the degree and
  // micro signs that appear in notes fields.
  downloadBlob(new Blob(['\uFEFF', text], { type: 'text/csv;charset=utf-8' }), filename);
}

export function downloadJson(value: unknown, filename: string): void {
  downloadText(JSON.stringify(value, null, 2), filename, 'application/json');
}

/** Build a descriptive, filesystem-safe filename. */
export function exportFilename(
  parts: { subject: string; kind: string; at?: number; extension: string }
): string {
  const stamp = filenameTimestamp(parts.at);
  return `${FILE_PREFIX}-${slugify(parts.subject)}-${slugify(parts.kind)}-${stamp}.${parts.extension}`;
}

/** Open an HTML report in a new tab, falling back to a download when blocked. */
export function openHtmlReport(html: string, filename: string): void {
  if (typeof window === 'undefined') return;
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, '_blank', 'noopener');
  if (!opened) {
    // Popup blocked: give the user the file instead of silently doing nothing.
    URL.revokeObjectURL(url);
    downloadBlob(blob, filename);
    return;
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Prompt for a file and return its text content. */
export function pickTextFile(accept = '.json,application/json'): Promise<{
  name: string;
  text: string;
} | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    let settled = false;

    const finish = (value: { name: string; text: string } | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(value);
    };

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        finish(null);
        return;
      }
      file
        .text()
        .then((text) => finish({ name: file.name, text }))
        .catch(() => finish(null));
    });
    // `cancel` is not supported everywhere; the dialogue simply resolves null on
    // the next change event or never, which is harmless.
    input.addEventListener('cancel', () => finish(null));

    document.body.appendChild(input);
    input.click();
  });
}

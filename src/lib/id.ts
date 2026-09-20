/**
 * Identifier generation.
 *
 * Uses crypto.randomUUID where available and falls back to a time-ordered id so
 * that ids stay sortable by creation time even on older engines.
 */

export function createId(prefix = ''): string {
  const base =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : fallbackId();
  return prefix ? `${prefix}_${base}` : base;
}

function fallbackId(): string {
  const time = Date.now().toString(36);
  let random = '';
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    random = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  } else {
    random = Math.random().toString(36).slice(2, 12);
  }
  return `${time}-${random}`;
}

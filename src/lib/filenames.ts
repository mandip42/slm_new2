/**
 * User-chosen file names.
 *
 * A recording is downloaded to the phone's own storage and will very likely be
 * copied onward to a laptop, a share or an analysis tool, so the name the user
 * types has to survive every one of those filesystems. This module is the single
 * place that decides what a legal name is, rather than each download site
 * guessing.
 *
 * The rules are deliberately conservative: anything reserved on Windows, macOS,
 * Linux or Android is removed, because the most common failure is a name that
 * works on the phone and then cannot be copied off it.
 */

export const WAV_EXTENSION = 'wav';

/**
 * Cap on the user-visible part of the name.
 *
 * Most filesystems allow 255 bytes, but the browser appends " (1)", " (2)" and so
 * on when a name collides in the download folder, and a non-ASCII character can
 * take up to four bytes. 80 characters leaves ample headroom for both.
 */
export const MAX_BASE_NAME_LENGTH = 80;

/**
 * Characters that are illegal or dangerous in a file name.
 *
 * `< > : " / \ | ? *` are reserved on Windows, `/` is the POSIX path separator,
 * and the C0 control range breaks tooling in ways that are hard to diagnose.
 */
const ILLEGAL_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;

/**
 * Names Windows still treats as devices rather than files, with or without an
 * extension. `CON.wav` cannot be created on Windows, so a recording named that
 * way on the phone would be impossible to copy across.
 */
const RESERVED_DEVICE_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

/** Remove one trailing `.wav`, case-insensitively, so the user edits the name only. */
export function stripWavExtension(name: string): string {
  return name.replace(/\.wav$/i, '');
}

/** Remove one trailing occurrence of the given extension, case-insensitively. */
export function stripExtension(name: string, extension: string): string {
  const suffix = `.${extension.replace(/^\./, '')}`;
  return name.toLowerCase().endsWith(suffix.toLowerCase())
    ? name.slice(0, -suffix.length)
    : name;
}

/**
 * Make an arbitrary string usable as the name part of a file.
 *
 * Illegal characters become spaces rather than being deleted, so `L/R channel`
 * reads as `L R channel` instead of collapsing into `LR channel` and quietly
 * changing what the file claims to be.
 */
export function sanitiseBaseName(input: string, fallback = 'recording'): string {
  let name = input
    // A colon between digits is a clock time, and the default measurement name
    // contains one. Turning "19:04" into "19-04" keeps it readable, where the
    // general rule below would leave the bare "19 04".
    .replace(/(\d):(\d)/g, '$1-$2')
    .replace(ILLEGAL_CHARACTERS, ' ')
    .replace(/\s+/g, ' ')
    // Windows silently strips leading and trailing dots and spaces, which turns
    // two distinct names into one. Drop them here so what is shown is what is
    // written.
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '');

  if (name.length > MAX_BASE_NAME_LENGTH) {
    name = name.slice(0, MAX_BASE_NAME_LENGTH).replace(/[.\s]+$/, '');
  }

  if (!name) return fallback;
  if (RESERVED_DEVICE_NAMES.has(name.toLowerCase())) return `${name}-recording`;
  return name;
}

/**
 * The exact file name a WAV download will be written with.
 *
 * Always ends in `.wav`: a 24-bit PCM WAV with some other extension is a file
 * that will not open by double-click, and the user cannot be expected to know
 * that.
 */
export function wavFilename(input: string, fallback = 'recording'): string {
  return filenameWithExtension(input, WAV_EXTENSION, fallback);
}

/**
 * The exact file name a download will be written with, for any extension.
 *
 * The extension is always appended rather than trusted from the typed text, so a
 * JPEG cannot end up named `.wav` because the name was pasted from elsewhere.
 */
export function filenameWithExtension(
  input: string,
  extension: string,
  fallback = 'file'
): string {
  const ext = extension.replace(/^\./, '').toLowerCase();
  return `${sanitiseBaseName(stripExtension(input, ext), fallback)}.${ext}`;
}

/** True when the typed name would be written unchanged. */
export function isCleanBaseName(input: string): boolean {
  return sanitiseBaseName(input) === input.trim() && input.trim().length > 0;
}

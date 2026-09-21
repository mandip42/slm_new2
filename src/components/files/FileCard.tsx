'use client';

/**
 * Name a stored file, write it to the device, or hand it to another app.
 *
 * Shared by audio recordings and by photographs, because the rules are the same
 * for both: the name is editable after the fact, since the name worth having is
 * rarely known while measuring; the extension is decided by the file's format, not
 * by what was typed; and downloading also stores the name, so what is held on the
 * device always matches the file that was last written.
 */

import { useState, type ReactNode } from 'react';
import { filenameWithExtension, stripExtension, MAX_BASE_NAME_LENGTH } from '@/lib/filenames';
import { useIsHydrated } from '@/lib/useIsHydrated';
import { downloadBlob } from '@/reports/download';
import { Banner, Button, Field, KeyValue, TextInput } from '@/components/ui/primitives';

export function FileCard({
  blob,
  storedName,
  extension,
  fallbackName,
  entries,
  preview,
  mimeType,
  nameLabel,
  downloadLabel = 'Download',
  onRename,
  onDelete,
  deleteLabel = 'Delete',
  footnote,
}: {
  blob: Blob;
  /** Name the file is currently stored under, including extension. */
  storedName: string;
  /** Extension the file will always be written with. */
  extension: string;
  /** Used when the typed name sanitises to nothing. */
  fallbackName: string;
  /** Metadata rows shown above the name field. */
  entries: ReadonlyArray<[ReactNode, ReactNode]>;
  /** Optional thumbnail or player shown above the metadata. */
  preview?: ReactNode;
  mimeType: string;
  /** Accessible label for the name field; must be unique on the screen. */
  nameLabel: string;
  /** Visible label of the download button, e.g. "Download WAV". */
  downloadLabel?: string;
  /** Persist the new name. Omit to make the name read-only. */
  onRename?: (filename: string) => Promise<void>;
  /** Supplied when the file may be deleted from where it is shown. */
  onDelete?: () => void;
  deleteLabel?: string;
  /** Extra explanation under the buttons. */
  footnote?: ReactNode;
}) {
  const hydrated = useIsHydrated();
  const [baseName, setBaseName] = useState(() => stripExtension(storedName, extension));
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const filename = filenameWithExtension(baseName, extension, fallbackName);
  const nameChanged = filename !== storedName;

  /**
   * `navigator.share` is only offered where the browser has it. On Android Chrome
   * it opens the system share sheet, which is the only way to put the file
   * somewhere other than the download folder. Checked after hydration because
   * reading `navigator` during render would not match the prerendered HTML.
   */
  const shareSupported =
    hydrated && typeof navigator !== 'undefined' && typeof navigator.canShare === 'function';

  const persistName = async (): Promise<void> => {
    if (!nameChanged || !onRename) return;
    await onRename(filename);
  };

  const handleDownload = async (): Promise<void> => {
    downloadBlob(blob, filename);
    try {
      await persistName();
    } catch {
      // The file is already written; failing to remember the name is worth saying
      // but does not undo the download.
      setMessage({
        tone: 'bad',
        text: `${filename} was saved, but the new name could not be stored.`,
      });
      return;
    }
    setMessage({
      tone: 'good',
      text: `${filename} written to this device. Look in the browser's download location, usually the Download folder.`,
    });
  };

  const handleSaveName = async (): Promise<void> => {
    try {
      await persistName();
      setMessage({ tone: 'good', text: `Renamed to ${filename}.` });
    } catch {
      setMessage({ tone: 'bad', text: 'The new name could not be saved to local storage.' });
    }
  };

  const handleShare = async (): Promise<void> => {
    const file = new File([blob], filename, { type: mimeType });
    if (!navigator.canShare({ files: [file] })) {
      setMessage({
        tone: 'bad',
        text: 'This browser will not share this kind of file. Use Download instead.',
      });
      return;
    }
    try {
      await navigator.share({ files: [file], title: filename });
      await persistName();
    } catch (error) {
      // Dismissing the share sheet is a normal outcome, not a failure.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setMessage({
        tone: 'bad',
        text: error instanceof Error ? `Sharing failed: ${error.message}` : 'Sharing failed.',
      });
    }
  };

  return (
    <div className="space-y-3">
      {preview}

      <KeyValue entries={entries} />

      <Field
        label="File name"
        hint={nameChanged ? `Will be saved as ${filename}` : `Saved as ${filename}`}
      >
        <TextInput
          value={baseName}
          onChange={(value) => {
            setBaseName(value);
            setMessage(null);
          }}
          ariaLabel={nameLabel}
          maxLength={MAX_BASE_NAME_LENGTH}
        />
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="accent"
          ariaLabel={`Download ${filename}`}
          onClick={() => void handleDownload()}
        >
          {downloadLabel}
        </Button>
        {shareSupported ? (
          <Button size="sm" ariaLabel={`Share ${filename}`} onClick={() => void handleShare()}>
            Share or save to&hellip;
          </Button>
        ) : null}
        {onRename ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={!nameChanged}
            ariaLabel="Save the typed name"
            onClick={() => void handleSaveName()}
          >
            Save name
          </Button>
        ) : null}
        {onDelete ? (
          <Button
            size="sm"
            variant={confirmDelete ? 'danger' : 'ghost'}
            onClick={() => {
              if (confirmDelete) {
                setConfirmDelete(false);
                onDelete();
              } else {
                setConfirmDelete(true);
                setTimeout(() => setConfirmDelete(false), 4000);
              }
            }}
          >
            {confirmDelete ? 'Tap to confirm' : deleteLabel}
          </Button>
        ) : null}
      </div>

      {message ? <Banner tone={message.tone}>{message.text}</Banner> : null}

      <p className="text-[11px] leading-relaxed text-faint">
        Download writes the file into this device&rsquo;s own storage, in whatever location the
        browser uses for downloads. The name is remembered with the file, so the next download
        produces the same name.
        {shareSupported
          ? ' Share hands the same file to another app, which is how you put it somewhere other than the download folder.'
          : ''}{' '}
        {footnote}
      </p>
    </div>
  );
}

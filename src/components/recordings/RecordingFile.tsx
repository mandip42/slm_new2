'use client';

/**
 * Recording file actions: name it, write it to the device, hand it to another app.
 *
 * The file name is editable here rather than fixed at record time, because the
 * name that matters is the one you want on the file when you look at it a week
 * later, and that is rarely known while measuring.
 *
 * Downloading persists the name alongside the recording, so what is stored always
 * matches the file that was last written.
 */

import { useState, type ReactNode } from 'react';
import { formatBytes, formatDateTime, formatDurationWords } from '@/lib/format';
import { stripWavExtension, wavFilename, MAX_BASE_NAME_LENGTH } from '@/lib/filenames';
import { useIsHydrated } from '@/lib/useIsHydrated';
import { downloadBlob } from '@/reports/download';
import { renameRecording } from '@/storage/recordingStore';
import type { RecordingRecord } from '@/storage/types';
import { Banner, Button, Field, KeyValue, TextInput } from '@/components/ui/primitives';

export function RecordingFile({
  recording,
  onRenamed,
  onDelete,
  extraEntries = [],
}: {
  recording: RecordingRecord;
  /** Called with the updated record after a successful rename. */
  onRenamed?: (record: RecordingRecord) => void;
  /** Supplied when this recording may be deleted from where it is shown. */
  onDelete?: () => void;
  /** Extra metadata rows, e.g. a link back to the measurement. */
  extraEntries?: ReadonlyArray<[ReactNode, ReactNode]>;
}) {
  const hydrated = useIsHydrated();
  const [baseName, setBaseName] = useState(() => stripWavExtension(recording.name));
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const filename = wavFilename(baseName);
  const nameChanged = filename !== recording.name;

  /**
   * `navigator.share` is only offered when the browser has it. On Android Chrome
   * it opens the system share sheet, which is the only way to put the file
   * somewhere other than the download folder. It is checked after hydration
   * because reading `navigator` during render would not match the prerendered
   * HTML.
   */
  const shareSupported =
    hydrated && typeof navigator !== 'undefined' && typeof navigator.canShare === 'function';

  const persistName = async (): Promise<void> => {
    if (!nameChanged) return;
    const updated = await renameRecording(recording.id, filename);
    if (updated) onRenamed?.(updated);
  };

  const handleDownload = async (): Promise<void> => {
    downloadBlob(recording.blob, filename);
    try {
      await persistName();
    } catch {
      // The file has already been written; failing to remember the new name is
      // worth reporting but does not undo the download.
      setMessage({ tone: 'bad', text: `${filename} was saved, but the new name could not be stored.` });
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
    const file = new File([recording.blob], filename, { type: 'audio/wav' });
    if (!navigator.canShare({ files: [file] })) {
      setMessage({
        tone: 'bad',
        text: 'This browser will not share audio files. Use Download instead.',
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
      <KeyValue
        entries={[
          ['Duration', formatDurationWords(recording.durationSeconds)],
          ['Format', `${recording.bitDepth}-bit PCM WAV, mono, ${recording.sampleRate} Hz`],
          ['Size', formatBytes(recording.sizeBytes)],
          ['Recorded', formatDateTime(recording.createdAt)],
          ...extraEntries,
        ]}
      />

      <Field
        label="File name"
        hint={
          nameChanged
            ? `Will be saved as ${filename}`
            : `Saved as ${filename}`
        }
      >
        <TextInput
          value={baseName}
          onChange={(value) => {
            setBaseName(value);
            setMessage(null);
          }}
          ariaLabel="Recording file name"
          placeholder="Measurement name"
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
          Download WAV
        </Button>
        {shareSupported ? (
          <Button size="sm" ariaLabel={`Share ${filename}`} onClick={() => void handleShare()}>
            Share or save to&hellip;
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          disabled={!nameChanged}
          ariaLabel="Save the typed name"
          onClick={() => void handleSaveName()}
        >
          Save name
        </Button>
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
            {confirmDelete ? 'Tap to confirm' : 'Delete audio'}
          </Button>
        ) : null}
      </div>

      {message ? <Banner tone={message.tone}>{message.text}</Banner> : null}

      <p className="text-[11px] leading-relaxed text-faint">
        Download writes the file into this device&rsquo;s own storage, in whatever location the
        browser is configured to use for downloads. The name is remembered with the recording, so
        the next download produces the same file name.
        {shareSupported
          ? ' Share hands the same file to another app, which is how you put it somewhere other than the download folder.'
          : ''}
      </p>
    </div>
  );
}

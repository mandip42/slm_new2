'use client';

/**
 * Audio recording file actions.
 *
 * A thin wrapper over {@link FileCard}: the naming, download and share rules are
 * shared with photographs, and only the metadata and the persistence call differ.
 */

import type { ReactNode } from 'react';
import { formatBytes, formatDateTime, formatDurationWords } from '@/lib/format';
import { WAV_EXTENSION } from '@/lib/filenames';
import { renameRecording } from '@/storage/recordingStore';
import type { RecordingRecord } from '@/storage/types';
import { FileCard } from '@/components/files/FileCard';

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
  return (
    <FileCard
      blob={recording.blob}
      storedName={recording.name}
      extension={WAV_EXTENSION}
      fallbackName="recording"
      mimeType="audio/wav"
      nameLabel="Recording file name"
      downloadLabel="Download WAV"
      deleteLabel="Delete audio"
      entries={[
        ['Duration', formatDurationWords(recording.durationSeconds)],
        ['Format', `${recording.bitDepth}-bit PCM WAV, mono, ${recording.sampleRate} Hz`],
        ['Size', formatBytes(recording.sizeBytes)],
        ['Recorded', formatDateTime(recording.createdAt)],
        ...extraEntries,
      ]}
      onRename={async (filename) => {
        const updated = await renameRecording(recording.id, filename);
        if (updated) onRenamed?.(updated);
      }}
      onDelete={onDelete}
    />
  );
}

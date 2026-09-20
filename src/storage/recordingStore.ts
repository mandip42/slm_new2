/**
 * WAV recording persistence.
 *
 * Recordings are stored as Blobs and are always deletable independently of the
 * measurement results they accompany: a user may want to keep a session's
 * numbers while removing the audio.
 */

import { createId } from '@/lib/id';
import { STORES, get, getAll, put, remove } from './db';
import { RECORD_SCHEMA_VERSION, type RecordingRecord } from './types';
import { WAV_BIT_DEPTH } from '@/audio/wavRecorder';

export async function saveRecording(input: {
  blob: Blob;
  sessionId: string | null;
  durationSeconds: number;
  sampleRate: number;
  name: string;
}): Promise<RecordingRecord> {
  const record: RecordingRecord = {
    id: createId('rec'),
    schemaVersion: RECORD_SCHEMA_VERSION,
    sessionId: input.sessionId,
    createdAt: Date.now(),
    durationSeconds: input.durationSeconds,
    sampleRate: input.sampleRate,
    bitDepth: WAV_BIT_DEPTH,
    sizeBytes: input.blob.size,
    name: input.name,
    blob: input.blob,
  };
  await put(STORES.recordings, record);
  return record;
}

export function loadRecording(id: string): Promise<RecordingRecord | undefined> {
  return get<RecordingRecord>(STORES.recordings, id);
}

export async function listRecordings(): Promise<RecordingRecord[]> {
  const recordings = await getAll<RecordingRecord>(STORES.recordings);
  return recordings.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteRecording(id: string): Promise<void> {
  await remove(STORES.recordings, id);
}

/** Total bytes used by stored recordings. */
export async function recordingsSizeBytes(): Promise<number> {
  const recordings = await listRecordings();
  return recordings.reduce((acc, r) => acc + r.sizeBytes, 0);
}

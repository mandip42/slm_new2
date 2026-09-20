/**
 * Session persistence.
 *
 * Sessions are split across two stores: a light record for the list and a heavy
 * time-series record fetched only when a session is opened. Typed arrays are
 * stored directly, so a one-hour measurement at 4 Hz costs about 60 kB per trace
 * rather than a megabyte of JSON.
 *
 * Losing a measurement is treated as the worst possible failure, so an
 * in-progress session is autosaved and can be recovered after a crash, a reload
 * or an accidental navigation.
 */

import { STORES, get, getAll, getAllByIndex, put, remove, removeAcross } from './db';
import {
  RECORD_SCHEMA_VERSION,
  type SessionRecord,
  type SessionSeries,
} from './types';

export async function saveSession(session: SessionRecord): Promise<void> {
  await put(STORES.sessions, session);
}

export async function saveSessionSeries(series: SessionSeries): Promise<void> {
  await put(STORES.sessionSeries, series);
}

export function loadSession(id: string): Promise<SessionRecord | undefined> {
  return get<SessionRecord>(STORES.sessions, id);
}

export function loadSessionSeries(sessionId: string): Promise<SessionSeries | undefined> {
  return get<SessionSeries>(STORES.sessionSeries, sessionId);
}

export async function listSessions(): Promise<SessionRecord[]> {
  const sessions = await getAll<SessionRecord>(STORES.sessions);
  return sessions.sort((a, b) => b.startedAt - a.startedAt);
}

export async function deleteSession(id: string): Promise<void> {
  const session = await loadSession(id);
  const entries: Array<{ store: typeof STORES.sessions | typeof STORES.sessionSeries | typeof STORES.recordings; key: string }> = [
    { store: STORES.sessions, key: id },
    { store: STORES.sessionSeries, key: id },
  ];
  if (session?.recordingId) {
    entries.push({ store: STORES.recordings, key: session.recordingId });
  }
  await removeAcross(entries);
}

/** Delete only the audio recording, keeping the measurement results. */
export async function deleteSessionRecording(id: string): Promise<void> {
  const session = await loadSession(id);
  if (!session?.recordingId) return;
  await remove(STORES.recordings, session.recordingId);
  await put(STORES.sessions, { ...session, recordingId: null });
}

export async function renameSession(id: string, name: string): Promise<SessionRecord | null> {
  const session = await loadSession(id);
  if (!session) return null;
  const next = { ...session, name: name.trim() || session.name };
  await put(STORES.sessions, next);
  return next;
}

export async function updateSessionNotes(id: string, notes: string): Promise<SessionRecord | null> {
  const session = await loadSession(id);
  if (!session) return null;
  const next = { ...session, notes };
  await put(STORES.sessions, next);
  return next;
}

/** Sessions that were never stopped cleanly. */
export async function listIncompleteSessions(): Promise<SessionRecord[]> {
  // IndexedDB cannot index a boolean, so `incomplete` is stored as a boolean and
  // filtered in memory; the session list is small enough for that to be free.
  const sessions = await getAll<SessionRecord>(STORES.sessions);
  return sessions.filter((s) => s.incomplete).sort((a, b) => b.startedAt - a.startedAt);
}

/** Mark a recovered session as finished so it stops being offered for recovery. */
export async function finaliseRecoveredSession(id: string): Promise<void> {
  const session = await loadSession(id);
  if (!session) return;
  await put(STORES.sessions, { ...session, incomplete: false });
}

export async function sessionsUsingProfile(profileId: string): Promise<SessionRecord[]> {
  const sessions = await getAll<SessionRecord>(STORES.sessions);
  return sessions.filter((s) => s.calibration.profileId === profileId);
}

/** Empty series record, used when a session has no time series. */
export function emptySeries(sessionId: string): SessionSeries {
  return {
    sessionId,
    schemaVersion: RECORD_SCHEMA_VERSION,
    sampleIntervalMs: 0,
    elapsed: new Float32Array(0),
    LAF: new Float32Array(0),
    LAS: new Float32Array(0),
    LCF: new Float32Array(0),
    LZF: new Float32Array(0),
    LAeq: new Float32Array(0),
    calibrated: false,
    calibrationIntercept: 0,
    calibrationSlope: 1,
  };
}

export function listRecordingsForSession(sessionId: string) {
  return getAllByIndex(STORES.recordings, 'sessionId', sessionId);
}

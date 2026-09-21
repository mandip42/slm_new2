'use client';

/**
 * Stored audio recordings.
 *
 * Recordings live in the local database until they are downloaded or deleted, and
 * they are deliberately independent of the measurements they accompany: a
 * recording made without saving a measurement is still reachable here, and
 * deleting audio never touches the numbers.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { formatBytes, formatDateTime, formatDurationWords } from '@/lib/format';
import {
  deleteRecording,
  listRecordings,
} from '@/storage/recordingStore';
import type { RecordingRecord } from '@/storage/types';
import { useSettings } from '@/state/SettingsProvider';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { RecordingFile } from '@/components/recordings/RecordingFile';
import {
  Badge,
  Banner,
  Button,
  EmptyState,
  KeyValue,
  Panel,
  PanelHeader,
} from '@/components/ui/primitives';

export default function RecordingsPage() {
  const { settings } = useSettings();
  const [recordings, setRecordings] = useState<RecordingRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async (): Promise<RecordingRecord[]> => {
    return await listRecordings();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await load();
        if (!cancelled) {
          setRecordings(loaded);
          setError(null);
        }
      } catch (caught) {
        if (cancelled) return;
        setError(
          caught instanceof Error
            ? caught.message
            : 'Stored recordings could not be read from local storage.'
        );
        setRecordings([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const refresh = useCallback(() => {
    void load()
      .then((loaded) => {
        setRecordings(loaded);
        setError(null);
      })
      .catch(() => {
        setError('Stored recordings could not be re-read from local storage.');
      });
  }, [load]);

  const totalBytes = (recordings ?? []).reduce((sum, item) => sum + item.sizeBytes, 0);
  const totalSeconds = (recordings ?? []).reduce((sum, item) => sum + item.durationSeconds, 0);

  return (
    <div className="space-y-3">
      <ScreenHeader
        title="Audio recordings"
        subtitle="Name a recording, write it to this device as a WAV file, or delete it. Audio never leaves the device unless you share it yourself."
      />

      {error ? <Banner tone="bad">{error}</Banner> : null}

      {recordings === null ? (
        <Panel>
          <p className="text-xs text-faint">Reading stored recordings&hellip;</p>
        </Panel>
      ) : recordings.length === 0 ? (
        <EmptyState
          title="No recordings stored"
          action={
            <Link href="/settings">
              <Button size="sm" variant="accent">
                Open settings
              </Button>
            </Link>
          }
        >
          {settings.recordingEnabled
            ? 'Recording is enabled. Start a measurement on the meter screen and press "Record audio"; the recording appears here once you stop it.'
            : 'Audio recording is switched off. Enable it in settings, then start a measurement and press "Record audio" on the meter screen.'}
        </EmptyState>
      ) : (
        <>
          <Panel>
            <PanelHeader title="Stored on this device" />
            <KeyValue
              entries={[
                ['Recordings', String(recordings.length)],
                ['Total duration', formatDurationWords(totalSeconds)],
                ['Total size', formatBytes(totalBytes)],
              ]}
            />
          </Panel>

          <ul className="space-y-2">
            {recordings.map((recording) => {
              const open = expanded === recording.id;
              return (
                <li key={recording.id} className="panel p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-ink">
                          {recording.name}
                        </span>
                        {recording.sessionId ? (
                          <Badge tone="info">measurement</Badge>
                        ) : (
                          <Badge tone="warn">no measurement</Badge>
                        )}
                      </div>
                      <p className="tnum mt-0.5 text-[11px] text-faint">
                        {formatDateTime(recording.createdAt)} &middot;{' '}
                        {formatDurationWords(recording.durationSeconds)} &middot;{' '}
                        {formatBytes(recording.sizeBytes)} &middot; {recording.sampleRate} Hz
                      </p>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Button
                      size="sm"
                      variant={open ? 'default' : 'accent'}
                      ariaLabel={`${open ? 'Close' : 'Open'} file options for ${recording.name}`}
                      onClick={() => setExpanded(open ? null : recording.id)}
                    >
                      {open ? 'Close' : 'Name and download'}
                    </Button>
                    {recording.sessionId ? (
                      <Link href={`/sessions?id=${encodeURIComponent(recording.sessionId)}`}>
                        <Button size="sm" variant="ghost">
                          Open measurement
                        </Button>
                      </Link>
                    ) : null}
                  </div>

                  {open ? (
                    <div className="mt-3 border-t border-line pt-3">
                      <RecordingFile
                        recording={recording}
                        onRenamed={(updated) =>
                          setRecordings((current) =>
                            (current ?? []).map((item) =>
                              item.id === updated.id ? updated : item
                            )
                          )
                        }
                        onDelete={() => {
                          void deleteRecording(recording.id).then(() => {
                            setExpanded(null);
                            refresh();
                          });
                        }}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <Panel>
            <PanelHeader title="About these files" />
            <p className="text-xs leading-relaxed text-muted">
              Recordings are 24-bit mono PCM WAV at the sample rate the audio graph was running at,
              which is the same stream the meter measured. 16-bit would discard roughly 20 dB of
              usable range at the quiet end, so it is not offered. A recording marked{' '}
              <em>no measurement</em> was stopped without a measurement being saved; the audio is
              intact and can still be downloaded.
            </p>
          </Panel>
        </>
      )}
    </div>
  );
}

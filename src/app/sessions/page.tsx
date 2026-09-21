'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { blobToDataUrl } from '@/lib/blobs';
import { formatDateTime, formatDuration, formatDurationWords, formatLevel, NO_VALUE } from '@/lib/format';
import {
  histogramCsv,
  sessionBandCsv,
  sessionSummaryCsv,
  sessionTimeSeriesCsv,
} from '@/reports/csv';
import { buildHtmlReport } from '@/reports/htmlReport';
import { buildSessionExport } from '@/reports/json';
import { downloadCsv, downloadJson, exportFilename, openHtmlReport } from '@/reports/download';
import { loadRecording } from '@/storage/recordingStore';
import { deletePhoto, listPhotosForSession } from '@/storage/photoStore';
import {
  deleteSession,
  deleteSessionRecording,
  finaliseRecoveredSession,
  listSessions,
  loadSession,
  loadSessionSeries,
  renameSession,
  updateSessionNotes,
} from '@/storage/sessionStore';
import type { PhotoRecord, RecordingRecord, SessionRecord, SessionSeries } from '@/storage/types';
import { useMeasurement } from '@/state/MeasurementProvider';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { PhotoFile } from '@/components/photos/PhotoFile';
import { RecordingFile } from '@/components/recordings/RecordingFile';
import {
  Badge,
  Banner,
  Button,
  EmptyState,
  Field,
  KeyValue,
  Metric,
  Panel,
  PanelHeader,
  Spinner,
  TextArea,
  TextInput,
  cx,
} from '@/components/ui/primitives';

export default function SessionsPage() {
  return (
    <Suspense fallback={<Spinner label="Loading sessions" />}>
      <SessionsContent />
    </Suspense>
  );
}

function SessionsContent() {
  const router = useRouter();
  const params = useSearchParams();
  const selectedId = params.get('id');
  const { reloadRecoverable } = useMeasurement();

  const [sessions, setSessions] = useState<SessionRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSessions(await listSessions());
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Saved measurements could not be read from local storage.'
      );
      setSessions([]);
    }
  }, []);

  // Initial load: the read is awaited before any state is written, so nothing
  // happens synchronously inside the effect body.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await listSessions();
        if (!cancelled) {
          setSessions(loaded);
          setError(null);
        }
      } catch (caught) {
        if (cancelled) return;
        setError(
          caught instanceof Error
            ? caught.message
            : 'Saved measurements could not be read from local storage.'
        );
        setSessions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (selectedId) {
    return (
      <SessionDetail
        id={selectedId}
        onBack={() => router.push('/sessions')}
        onChanged={() => {
          void refresh();
          void reloadRecoverable();
        }}
      />
    );
  }

  return (
    <div className="space-y-3">
      <ScreenHeader
        title="Sessions"
        subtitle="Saved measurements with full metadata, reports and exports. Everything stays on this device."
      />

      {error ? <Banner tone="bad">{error}</Banner> : null}

      {sessions === null ? (
        <Panel>
          <Spinner label="Reading saved measurements" />
        </Panel>
      ) : sessions.length === 0 ? (
        <EmptyState title="No saved measurements yet">
          Press START on the meter screen and then STOP. The measurement is saved automatically,
          including a full report and export data.
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {sessions.map((session) => (
            <li key={session.id} className="panel p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-semibold text-ink">{session.name}</span>
                    {session.incomplete ? <Badge tone="warn">incomplete</Badge> : null}
                    {session.clippingAffected ? <Badge tone="bad">clipping</Badge> : null}
                    {!session.summary.calibrated ? <Badge tone="warn">uncalibrated</Badge> : null}
                    {session.recordingId ? <Badge tone="info">audio</Badge> : null}
                  </div>
                  <p className="mt-0.5 text-[11px] text-faint">
                    {formatDateTime(session.startedAt)} &middot;{' '}
                    {formatDurationWords(session.durationSeconds)} &middot; {session.sampleRate} Hz
                  </p>
                  <p className="tnum mt-1 text-xs text-muted">
                    LAeq {formatLevel(session.summary.LAeq)} &middot; max{' '}
                    {formatLevel(session.summary.LAFmax)} &middot; L90{' '}
                    {session.summary.percentiles
                      ? formatLevel(session.summary.percentiles.L90)
                      : NO_VALUE}{' '}
                    <span className="text-faint">{session.summary.unit}</span>
                  </p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  variant="accent"
                  onClick={() => router.push(`/sessions?id=${encodeURIComponent(session.id)}`)}
                >
                  Open
                </Button>
                <Button
                  size="sm"
                  variant={confirmDelete === session.id ? 'danger' : 'ghost'}
                  onClick={() => {
                    if (confirmDelete === session.id) {
                      void deleteSession(session.id).then(() => {
                        setConfirmDelete(null);
                        void refresh();
                      });
                    } else {
                      setConfirmDelete(session.id);
                      setTimeout(() => setConfirmDelete(null), 4000);
                    }
                  }}
                >
                  {confirmDelete === session.id ? 'Tap to confirm delete' : 'Delete'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function SessionDetail({
  id,
  onBack,
  onChanged,
}: {
  id: string;
  onBack: () => void;
  onChanged: () => void;
}) {
  /**
   * Loaded data is kept in one state object tagged with the id it belongs to, so
   * "loading" is derived from a mismatch rather than mirrored into its own state.
   * That removes the need to set state synchronously when the id changes.
   */
  const [loaded, setLoaded] = useState<{
    id: string;
    session: SessionRecord | null;
    series: SessionSeries | null;
    recording: RecordingRecord | null;
    photos: PhotoRecord[];
  } | null>(null);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [saved, setSaved] = useState<string | null>(null);

  const loading = loaded?.id !== id;
  const session = loaded?.id === id ? loaded.session : null;
  const series = loaded?.id === id ? loaded.series : null;
  const recording = loaded?.id === id ? loaded.recording : null;
  const photos = loaded?.id === id ? loaded.photos : [];
  const notFound = loaded?.id === id && loaded.session === null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const record = await loadSession(id).catch(() => undefined);
      if (cancelled) return;
      if (!record) {
        setLoaded({ id, session: null, series: null, recording: null, photos: [] });
        return;
      }
      const [seriesRecord, recordingRecord, photoRecords] = await Promise.all([
        loadSessionSeries(id).catch(() => undefined),
        record.recordingId
          ? loadRecording(record.recordingId).catch(() => undefined)
          : Promise.resolve(undefined),
        listPhotosForSession(id).catch(() => []),
      ]);
      if (cancelled) return;
      setLoaded({
        id,
        session: record,
        series: seriesRecord ?? null,
        recording: recordingRecord ?? null,
        photos: photoRecords,
      });
      setName(record.name);
      setNotes(record.notes);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const patchSession = (next: SessionRecord) => {
    setLoaded((current) => (current && current.id === id ? { ...current, session: next } : current));
  };
  const clearRecording = () => {
    setLoaded((current) => (current && current.id === id ? { ...current, recording: null } : current));
  };

  const percentileEntries = useMemo(() => {
    if (!session?.summary.percentiles) return [];
    return Object.entries(session.summary.percentiles).map(
      ([key, value]) => [key, `${formatLevel(value)} ${session.summary.unit}`] as [string, string]
    );
  }, [session]);

  if (loading) {
    return (
      <div className="space-y-3">
        <ScreenHeader title="Session" action={<Button size="sm" variant="ghost" onClick={onBack}>Back</Button>} />
        <Panel>
          <Spinner label="Loading measurement" />
        </Panel>
      </div>
    );
  }

  if (notFound || !session) {
    return (
      <div className="space-y-3">
        <ScreenHeader title="Session not found" action={<Button size="sm" variant="ghost" onClick={onBack}>Back</Button>} />
        <EmptyState title="This measurement no longer exists">
          It may have been deleted, or the local database may have been cleared.
        </EmptyState>
      </div>
    );
  }

  const unit = session.summary.unit;
  const s = session.summary;

  return (
    <div className="space-y-3">
      <ScreenHeader
        title={session.name}
        subtitle={`${formatDateTime(session.startedAt)} \u00b7 ${formatDuration(session.durationSeconds)}`}
        action={
          <Button size="sm" variant="ghost" onClick={onBack}>
            Back
          </Button>
        }
      />

      {saved ? <Banner tone="good">{saved}</Banner> : null}

      {session.incomplete ? (
        <Banner
          tone="warn"
          title="Incomplete measurement"
          action={
            <Button
              size="sm"
              onClick={() =>
                void finaliseRecoveredSession(session.id).then(() => {
                  patchSession({ ...session, incomplete: false });
                  setSaved('Marked as complete.');
                  onChanged();
                })
              }
            >
              Mark as complete
            </Button>
          }
        >
          This session was recovered after an interruption rather than stopped normally. The final
          moments before the interruption may be missing. It stays flagged in every report and export
          until you mark it complete.
        </Banner>
      ) : null}

      {session.clippingAffected ? (
        <Banner tone="bad" title="Affected by clipping">
          {session.clipping.events} clipping event(s) covering {session.clipping.clippedSamples}{' '}
          samples ({(session.clipping.clippedFraction * 100).toFixed(3)} % of the measurement). Levels
          during those periods are underestimated. Affected samples are flagged in the time-series
          export.
        </Banner>
      ) : null}

      {!s.calibrated ? (
        <Banner tone="warn" title="Uncalibrated measurement">
          All levels below are digital full-scale values (dBFS), not sound pressure levels. The raw
          values are stored in the JSON export, so this measurement can be re-derived if you calibrate
          later.
        </Banner>
      ) : null}

      <Panel>
        <PanelHeader title={`Summary (${unit})`} />
        <div className="grid grid-cols-3 gap-2">
          <Metric label="LAeq" value={formatLevel(s.LAeq)} size="md" />
          <Metric label="LCeq" value={formatLevel(s.LCeq)} size="md" />
          <Metric label="LZeq" value={formatLevel(s.LZeq)} size="md" />
          <Metric label="LAFmax" value={formatLevel(s.LAFmax)} size="sm" />
          <Metric label="LASmax" value={formatLevel(s.LASmax)} size="sm" />
          <Metric label="LAFmin" value={formatLevel(s.LAFmin)} size="sm" />
          <Metric label="LCpeak" value={formatLevel(s.LCpeak)} size="sm" />
          <Metric label="LZpeak" value={formatLevel(s.LZpeak)} size="sm" />
          <Metric label="LAE (SEL)" value={formatLevel(s.LAE)} size="sm" />
        </div>
      </Panel>

      {percentileEntries.length > 0 ? (
        <Panel>
          <PanelHeader title="Statistical levels" hint="Ln is the level exceeded n % of the time." />
          <KeyValue entries={percentileEntries} columns={2} />
        </Panel>
      ) : null}

      {session.exposure ? (
        <Panel>
          <PanelHeader
            title="Noise exposure"
            hint={`${session.exposure.scheme === 'niosh' ? 'NIOSH-style' : 'OSHA-style'}: ${session.exposure.criterionLevelDb} dBA criterion, ${session.exposure.exchangeRateDb} dB exchange rate`}
          />
          <KeyValue
            entries={[
              ['Dose', `${session.exposure.dosePercent.toFixed(1)} %`],
              ['Time-weighted average', `${formatLevel(session.exposure.twaDb)} dBA`],
              ['Projected 8 h level', `${formatLevel(session.exposure.projected8hDb)} dBA`],
              ['Projected full-shift dose', `${session.exposure.projectedDosePercent.toFixed(0)} %`],
              [
                'Threshold',
                session.exposure.thresholdDb === null
                  ? 'None applied'
                  : `${session.exposure.thresholdDb} dBA${session.exposure.belowThreshold ? ' (measurement below threshold)' : ''}`,
              ],
            ]}
          />
        </Panel>
      ) : null}

      <Panel>
        <PanelHeader title="Measurement metadata" />
        <KeyValue
          entries={[
            ['Session id', session.id],
            ['Started', formatDateTime(session.startedAt)],
            ['Ended', session.endedAt ? formatDateTime(session.endedAt) : NO_VALUE],
            ['Duration', formatDuration(session.durationSeconds)],
            ['Sample rate', `${session.sampleRate} Hz`],
            ['Device', `${session.device.model} / ${session.device.browser}`],
            ['Input', session.device.deviceLabel],
            [
              'Device audio processing',
              session.device.processingSuspected
                ? 'Could not be confirmed disabled'
                : 'Reported as disabled',
            ],
            ['Calibration status', session.calibration.status],
            ['Calibration profile', session.calibration.profileName ?? 'None'],
            ['Reference instrument', session.calibration.referenceInstrument ?? NO_VALUE],
            [
              'Calibration transform',
              `SPL = ${session.calibration.slope.toFixed(6)} \u00d7 dBFS + ${session.calibration.intercept.toFixed(3)}`,
            ],
            [
              'Frequency correction',
              session.calibration.frequencyCorrectionApplied ? 'Applied' : 'Not applied',
            ],
            ['Weighting shown', `${session.settings.weighting} / ${session.settings.timeWeighting}`],
            ['Band pre-weighting', session.settings.bankWeighting],
            ['DC blocker', session.settings.dcBlock ? 'On (10 Hz)' : 'Off'],
            ['Peak input level', `${formatLevel(session.clipping.peakDbfs)} dBFS`],
            [
              'Pauses',
              session.pauses.length === 0
                ? 'None'
                : `${session.pauses.length} (paused time excluded)`,
            ],
            ['Time series points', series ? series.elapsed.length.toLocaleString() : '0'],
            ['Series resolution', series ? `${series.sampleIntervalMs} ms` : NO_VALUE],
          ]}
        />
      </Panel>

      <Panel>
        <PanelHeader title="Name and notes" />
        <div className="space-y-3">
          <Field label="Name">
            <TextInput value={name} onChange={setName} ariaLabel="Session name" />
          </Field>
          <Field label="Notes">
            <TextArea value={notes} onChange={setNotes} rows={3} ariaLabel="Session notes" />
          </Field>
          <Button
            size="sm"
            variant="primary"
            onClick={() =>
              void (async () => {
                const renamed = await renameSession(session.id, name);
                const withNotes = await updateSessionNotes(session.id, notes);
                patchSession(withNotes ?? renamed ?? session);
                setSaved('Saved.');
                onChanged();
              })()
            }
          >
            Save changes
          </Button>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Report and export" />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="accent"
            onClick={() =>
              void (async () => {
                // Photos are embedded, so they have to be read out of the database
                // before the document can be built. A photo that cannot be read is
                // left out rather than failing the whole report.
                const embedded = await Promise.all(
                  photos.map(async (photo) => {
                    const dataUrl = await blobToDataUrl(photo.blob).catch(() => null);
                    return dataUrl
                      ? {
                          name: photo.name,
                          dataUrl,
                          createdAt: photo.createdAt,
                          atSeconds: photo.atSeconds,
                          width: photo.width,
                          height: photo.height,
                        }
                      : null;
                  })
                );
                openHtmlReport(
                  buildHtmlReport({
                    session,
                    series,
                    photos: embedded.filter((photo) => photo !== null),
                  }),
                  exportFilename({ subject: session.name, kind: 'report', extension: 'html' })
                );
              })()
            }
          >
            Printable report
          </Button>
          <Button
            size="sm"
            onClick={() =>
              downloadCsv(
                sessionSummaryCsv(session),
                exportFilename({ subject: session.name, kind: 'summary', extension: 'csv' })
              )
            }
          >
            Summary CSV
          </Button>
          <Button
            size="sm"
            disabled={!series || series.elapsed.length === 0}
            onClick={() =>
              series &&
              downloadCsv(
                sessionTimeSeriesCsv(session, series),
                exportFilename({ subject: session.name, kind: 'timeseries', extension: 'csv' })
              )
            }
          >
            Time series CSV
          </Button>
          <Button
            size="sm"
            disabled={!session.octave}
            onClick={() =>
              session.octave &&
              downloadCsv(
                sessionBandCsv(session, session.octave, 'octave'),
                exportFilename({ subject: session.name, kind: 'octave', extension: 'csv' })
              )
            }
          >
            Octave CSV
          </Button>
          <Button
            size="sm"
            disabled={!session.thirdOctave}
            onClick={() =>
              session.thirdOctave &&
              downloadCsv(
                sessionBandCsv(session, session.thirdOctave, 'one-third-octave'),
                exportFilename({ subject: session.name, kind: 'third-octave', extension: 'csv' })
              )
            }
          >
            1/3-octave CSV
          </Button>
          <Button
            size="sm"
            disabled={!session.histogram}
            onClick={() => {
              const csv = histogramCsv(session);
              if (csv) {
                downloadCsv(
                  csv,
                  exportFilename({ subject: session.name, kind: 'distribution', extension: 'csv' })
                );
              }
            }}
          >
            Distribution CSV
          </Button>
          <Button
            size="sm"
            onClick={() =>
              downloadJson(
                buildSessionExport(session, series),
                exportFilename({ subject: session.name, kind: 'session', extension: 'json' })
              )
            }
          >
            Full JSON
          </Button>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          The JSON export is lossless: it carries the raw dBFS values and the calibration transform
          alongside the calibrated levels, so this measurement can be re-derived with a corrected
          calibration without re-measuring. The printable report opens in a new tab; use the
          browser&rsquo;s print dialogue to save it as PDF.
        </p>
      </Panel>

      {recording ? (
        <Panel>
          <PanelHeader
            title="Audio recording"
            action={
              <Link href="/recordings">
                <Button size="sm" variant="ghost">
                  All recordings
                </Button>
              </Link>
            }
          />
          <RecordingFile
            recording={recording}
            onRenamed={(updated) =>
              setLoaded((current) =>
                current && current.id === id ? { ...current, recording: updated } : current
              )
            }
            onDelete={() => {
              void deleteSessionRecording(session.id).then(() => {
                clearRecording();
                patchSession({ ...session, recordingId: null });
                setSaved('Audio recording deleted. The measurement results are unchanged.');
                onChanged();
              });
            }}
          />
        </Panel>
      ) : null}

      {photos.length > 0 ? (
        <Panel>
          <PanelHeader
            title={photos.length === 1 ? 'Photo of the position' : 'Photos of the position'}
            hint="Captured from the meter screen while this measurement was running. Included in the printable report."
          />
          <div className="space-y-4">
            {photos.map((photo) => (
              <PhotoFile
                key={photo.id}
                photo={photo}
                onRenamed={(updated) =>
                  setLoaded((current) =>
                    current && current.id === id
                      ? {
                          ...current,
                          photos: current.photos.map((item) =>
                            item.id === updated.id ? updated : item
                          ),
                        }
                      : current
                  )
                }
                onDelete={() => {
                  void deletePhoto(photo.id).then(() => {
                    setLoaded((current) =>
                      current && current.id === id
                        ? {
                            ...current,
                            photos: current.photos.filter((item) => item.id !== photo.id),
                          }
                        : current
                    );
                    setSaved('Photo deleted. The measurement results are unchanged.');
                  });
                }}
              />
            ))}
          </div>
        </Panel>
      ) : null}

      <Panel>
        <PanelHeader title="Danger zone" />
        <Button
          size="sm"
          variant="danger"
          onClick={() => {
            void deleteSession(session.id).then(() => {
              onChanged();
              onBack();
            });
          }}
        >
          Delete this measurement permanently
        </Button>
        <p className={cx('mt-2 text-[11px] text-faint')}>
          Deletes the results, the time series, any audio recording and any photos. This cannot be
          undone.
        </p>
      </Panel>
    </div>
  );
}

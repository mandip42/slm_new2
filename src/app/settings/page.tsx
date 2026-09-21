'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { FFT_SIZES } from '@/dsp/fft';
import { WINDOW_IDS, WINDOW_LABELS, type WindowId } from '@/dsp/window';
import { TIME_WEIGHTING_IDS, TIME_WEIGHTING_LABELS } from '@/dsp/timeWeighting';
import { WEIGHTING_IDS } from '@/dsp/weighting/reference';
import { HISTORY_WINDOWS } from '@/measurement/levelHistory';
import { formatBytes, NO_VALUE } from '@/lib/format';
import { downloadJson, exportFilename, pickTextFile } from '@/reports/download';
import { buildBackupExport } from '@/reports/json';
import {
  clearAllData,
  deleteDatabase,
  requestPersistentStorage,
  storageUsage,
  type StorageUsage,
} from '@/storage/db';
import { listProfiles, importCalibrationExport } from '@/storage/calibrationStore';
import { listSessions, loadSessionSeries } from '@/storage/sessionStore';
import { listExperiments } from '@/storage/validationStore';
import { listRecordings, deleteRecording } from '@/storage/recordingStore';
import { invalidateSettingsCache } from '@/storage/settingsStore';
import { useCalibration } from '@/state/CalibrationProvider';
import { useSettings } from '@/state/SettingsProvider';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import {
  Banner,
  Button,
  ControlRow,
  Field,
  KeyValue,
  Panel,
  PanelHeader,
  SegmentedControl,
  Select,
  Slider,
  Toggle,
} from '@/components/ui/primitives';

export default function SettingsPage() {
  const { settings, update, reset, storageError } = useSettings();
  const { refresh } = useCalibration();
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [message, setMessage] = useState<{ tone: 'good' | 'bad' | 'warn'; text: string } | null>(
    null
  );
  const [confirmWipe, setConfirmWipe] = useState(0);
  const [busy, setBusy] = useState(false);

  const refreshUsage = () => {
    void storageUsage().then(setUsage).catch(() => undefined);
  };

  useEffect(refreshUsage, []);

  const backup = async () => {
    setBusy(true);
    try {
      const [profiles, experiments, sessions] = await Promise.all([
        listProfiles(),
        listExperiments(),
        listSessions(),
      ]);
      const withSeries = await Promise.all(
        sessions.map(async (session) => ({
          session,
          series: (await loadSessionSeries(session.id).catch(() => undefined)) ?? null,
        }))
      );
      downloadJson(
        buildBackupExport({
          profiles,
          experiments,
          sessions: withSeries,
          settings: settings as unknown as Record<string, unknown>,
        }),
        exportFilename({ subject: 'sonoscope', kind: 'backup', extension: 'json' })
      );
      setMessage({
        tone: 'good',
        text: `Backup written: ${profiles.length} profiles, ${experiments.length} experiments, ${sessions.length} sessions. Audio recordings are not included.`,
      });
    } catch (error) {
      setMessage({
        tone: 'bad',
        text: error instanceof Error ? error.message : 'The backup could not be created.',
      });
    } finally {
      setBusy(false);
    }
  };

  const importCalibration = async () => {
    const file = await pickTextFile();
    if (!file) return;
    try {
      const data: unknown = JSON.parse(file.text);
      const result = await importCalibrationExport(data);
      await refresh();
      setMessage({
        tone: result.imported.length > 0 ? 'good' : 'warn',
        text: `Imported ${result.imported.length} calibration profile(s)${result.skipped.length > 0 ? `, skipped ${result.skipped.length}` : ''}.`,
      });
    } catch (error) {
      setMessage({
        tone: 'bad',
        text: error instanceof Error ? error.message : 'The file could not be imported.',
      });
    }
  };

  const deleteRecordings = async () => {
    const recordings = await listRecordings();
    for (const recording of recordings) await deleteRecording(recording.id);
    refreshUsage();
    setMessage({
      tone: 'good',
      text: `Deleted ${recordings.length} audio recording(s). Measurement results are unchanged.`,
    });
  };

  const wipeEverything = async () => {
    setBusy(true);
    try {
      await clearAllData();
      await deleteDatabase();
      invalidateSettingsCache();
      await reset();
      await refresh();
      refreshUsage();
      setConfirmWipe(0);
      setMessage({ tone: 'good', text: 'All local Sonoscope data has been deleted.' });
    } catch (error) {
      setMessage({
        tone: 'bad',
        text: error instanceof Error ? error.message : 'The data could not be deleted.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <ScreenHeader title="Settings" subtitle="Measurement defaults, display and stored data." />

      {storageError ? (
        <Banner tone="bad" title="Settings cannot be saved">
          {storageError} Changes will apply for this session but will not persist. Private browsing
          modes often block local storage.
        </Banner>
      ) : null}

      {message ? (
        <Banner tone={message.tone === 'good' ? 'good' : message.tone === 'bad' ? 'bad' : 'warn'}>
          {message.text}
        </Banner>
      ) : null}

      <Panel>
        <PanelHeader title="Measurement" />
        <div className="space-y-3">
          <Field label="Default frequency weighting">
            <ControlRow>
              <SegmentedControl
                label="Default frequency weighting"
                value={settings.weighting}
                onChange={(weighting) => update({ weighting })}
                options={WEIGHTING_IDS.map((id) => ({ value: id, label: id }))}
              />
            </ControlRow>
          </Field>
          <Field label="Default time weighting">
            <ControlRow>
              <SegmentedControl
                label="Default time weighting"
                value={settings.timeWeighting}
                onChange={(timeWeighting) => update({ timeWeighting })}
                options={TIME_WEIGHTING_IDS.map((id) => ({
                  value: id,
                  label: TIME_WEIGHTING_LABELS[id],
                }))}
              />
            </ControlRow>
          </Field>
          <Field label="Statistics source weighting" hint="Feeds the exceedance levels and distribution.">
            <ControlRow>
              <SegmentedControl
                label="Statistics weighting"
                value={settings.statisticsWeighting}
                onChange={(statisticsWeighting) => update({ statisticsWeighting })}
                options={WEIGHTING_IDS.map((id) => ({ value: id, label: id }))}
              />
            </ControlRow>
          </Field>
          <Field label="Level read-out decimals">
            <ControlRow>
              <SegmentedControl
                label="Decimals"
                value={String(settings.levelDecimals)}
                onChange={(value) =>
                  update({ levelDecimals: Number(value) as 0 | 1 | 2 })
                }
                options={[
                  { value: '0', label: '0' },
                  { value: '1', label: '0.1' },
                  { value: '2', label: '0.01' },
                ]}
              />
            </ControlRow>
          </Field>
          <div className="border-t border-line pt-1">
            <Toggle
              label="DC and infrasound blocker"
              description="10 Hz second-order high-pass on the input. Removes microphone DC offset, handling noise and wind rumble below the Z-weighting band. Recommended on."
              checked={settings.dcBlock}
              onChange={(dcBlock) => update({ dcBlock })}
            />
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Analysis" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="FFT size">
            <Select
              value={String(settings.fftSize)}
              onChange={(value) => update({ fftSize: Number(value) })}
              options={FFT_SIZES.map((size) => ({ value: String(size), label: `${size} points` }))}
              ariaLabel="FFT size"
            />
          </Field>
          <Field label="Analysis window">
            <Select
              value={settings.fftWindow}
              onChange={(value) => update({ fftWindow: value as WindowId })}
              options={WINDOW_IDS.map((id) => ({ value: id, label: WINDOW_LABELS[id] }))}
              ariaLabel="Analysis window"
            />
          </Field>
          <Field label="Band pre-weighting" hint="Applied before the filter bank as a real filter.">
            <ControlRow>
              <SegmentedControl
                label="Band pre-weighting"
                value={settings.bankWeighting}
                onChange={(bankWeighting) => update({ bankWeighting })}
                options={WEIGHTING_IDS.map((id) => ({ value: id, label: id }))}
              />
            </ControlRow>
          </Field>
          <Field label="Default band resolution">
            <ControlRow>
              <SegmentedControl
                label="Band resolution"
                value={String(settings.octaveFraction)}
                onChange={(value) => update({ octaveFraction: value === '1' ? 1 : 3 })}
                options={[
                  { value: '1', label: '1/1' },
                  { value: '3', label: '1/3' },
                ]}
              />
            </ControlRow>
          </Field>
          <Slider
            label="Spectrum smoothing"
            min={0}
            max={0.9}
            step={0.05}
            value={settings.spectrumSmoothing}
            onChange={(spectrumSmoothing) => update({ spectrumSmoothing })}
            format={(value) => (value === 0 ? 'off' : value.toFixed(2))}
          />
          <Slider
            label="Spectrogram dynamic range"
            min={30}
            max={120}
            step={10}
            value={settings.spectrogramDynamicRangeDb}
            onChange={(spectrogramDynamicRangeDb) => update({ spectrogramDynamicRangeDb })}
            format={(value) => `${value} dB`}
          />
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Display" />
        <div className="space-y-1">
          <Field label="Theme">
            <ControlRow>
              <SegmentedControl
                label="Theme"
                value={settings.theme}
                onChange={(theme) => update({ theme })}
                options={[
                  { value: 'dark', label: 'Dark' },
                  { value: 'light', label: 'Light' },
                ]}
              />
            </ControlRow>
          </Field>
          <Toggle
            label="Outdoor mode"
            description="Raises contrast and stroke weight for direct sunlight."
            checked={settings.outdoorMode}
            onChange={(outdoorMode) => update({ outdoorMode })}
          />
          <Toggle
            label="Keep the screen awake while measuring"
            description="A locked screen suspends the audio engine on Android, which silently stops the measurement."
            checked={settings.keepScreenAwake}
            onChange={(keepScreenAwake) => update({ keepScreenAwake })}
          />
          <Field label="Default history window">
            <Select
              value={String(settings.historyWindowSeconds)}
              onChange={(value) => update({ historyWindowSeconds: Number(value) })}
              options={HISTORY_WINDOWS.map((window) => ({
                value: String(window.seconds),
                label: window.label,
              }))}
              ariaLabel="Default history window"
            />
          </Field>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Audio recording"
          action={
            <Link href="/recordings">
              <Button size="sm" variant="ghost">
                Stored recordings
              </Button>
            </Link>
          }
        />
        <Toggle
          label="Allow audio recording"
          description="When enabled, a Record button appears during measurements. Recording never starts by itself."
          checked={settings.recordingEnabled}
          onChange={(recordingEnabled) => update({ recordingEnabled })}
        />
        {settings.recordingEnabled ? (
          <>
            <Slider
              label="Maximum recording length"
              min={1}
              max={60}
              step={1}
              value={settings.maxRecordingMinutes}
              onChange={(maxRecordingMinutes) => update({ maxRecordingMinutes })}
              format={(value) => `${value} min`}
            />
            <Banner tone="warn">
              24-bit mono WAV at 48 kHz uses about 8.6 MB per minute. Recordings are stored on this
              device only and can be deleted independently of the measurement results. Name them and
              download them from the stored recordings screen.
            </Banner>
          </>
        ) : null}
      </Panel>

      <Panel>
        <PanelHeader title="Stored data" />
        <KeyValue
          entries={[
            ['Estimated usage', usage ? formatBytes(usage.usageBytes) : NO_VALUE],
            ['Quota', usage ? formatBytes(usage.quotaBytes) : NO_VALUE],
            [
              'Persistent storage',
              usage?.persisted === null
                ? 'unknown'
                : usage?.persisted
                  ? 'granted'
                  : 'not granted (data may be evicted)',
            ],
            ['Sessions', usage ? String(usage.counts.sessions) : NO_VALUE],
            ['Calibration profiles', usage ? String(usage.counts.calibrationProfiles) : NO_VALUE],
            ['Validation experiments', usage ? String(usage.counts.validationExperiments) : NO_VALUE],
            ['Audio recordings', usage ? String(usage.counts.recordings) : NO_VALUE],
          ]}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => void backup()}>
            Export full backup
          </Button>
          <Button size="sm" onClick={() => void importCalibration()}>
            Import calibration
          </Button>
          <Button
            size="sm"
            onClick={() =>
              void requestPersistentStorage().then((granted) => {
                refreshUsage();
                setMessage({
                  tone: granted ? 'good' : 'warn',
                  text: granted
                    ? 'Persistent storage granted. Measurement data will not be evicted automatically.'
                    : 'The browser declined persistent storage. Data may be evicted under storage pressure, so keep backups.',
                });
              })
            }
          >
            Request persistent storage
          </Button>
          <Button size="sm" variant="ghost" onClick={refreshUsage}>
            Refresh
          </Button>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Delete data" />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => void deleteRecordings()}>
            Delete all audio recordings
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void reset()}>
            Reset settings to defaults
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={() => {
              if (confirmWipe >= 2) {
                void wipeEverything();
              } else {
                setConfirmWipe((value) => value + 1);
                setTimeout(() => setConfirmWipe(0), 6000);
              }
            }}
          >
            {confirmWipe === 0
              ? 'Delete all measurement data'
              : confirmWipe === 1
                ? 'Tap again to confirm'
                : 'Tap once more — this cannot be undone'}
          </Button>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          Deleting all data removes every session, calibration profile, validation experiment and
          recording from this device permanently. Export a backup first: calibration profiles in
          particular represent real measurement work with your reference instrument.
        </p>
      </Panel>
    </div>
  );
}

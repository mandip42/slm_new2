'use client';

import { useState } from 'react';
import { profileMatchesDevice } from '@/lib/device';
import { formatDate, formatLevel, formatSigned, NO_VALUE } from '@/lib/format';
import { downloadCsv, downloadJson, exportFilename, pickTextFile } from '@/reports/download';
import { calibrationCsv } from '@/reports/csv';
import {
  buildCalibrationExport,
  createProfile,
  duplicateProfile,
  importCalibrationExport,
} from '@/storage/calibrationStore';
import type { CalibrationProfile } from '@/storage/types';
import { useCalibration } from '@/state/CalibrationProvider';
import { useEngineContext } from '@/state/EngineProvider';
import { useSettings } from '@/state/SettingsProvider';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { InputGate } from '@/components/meter/InputGate';
import { QualityReport } from '@/components/calibration/QualityReport';
import { SinglePointWizard } from '@/components/calibration/SinglePointWizard';
import { LinearityWizard } from '@/components/calibration/LinearityWizard';
import { FrequencyWizard } from '@/components/calibration/FrequencyWizard';
import {
  Badge,
  Banner,
  Button,
  EmptyState,
  Field,
  KeyValue,
  Panel,
  PanelHeader,
  TextArea,
  TextInput,
  Toggle,
  cx,
} from '@/components/ui/primitives';

type Mode = 'overview' | 'single' | 'linearity' | 'frequency' | 'new';

export default function CalibrationPage() {
  const { settings, update } = useSettings();
  const { status } = useEngineContext();
  const {
    profiles,
    activeProfile,
    calibration,
    quality,
    upsertProfile,
    removeProfile,
    setActiveProfile,
    refresh,
  } = useCalibration();

  const [mode, setMode] = useState<Mode>('overview');
  const [newName, setNewName] = useState('');
  const [newSerial, setNewSerial] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [message, setMessage] = useState<{ tone: 'good' | 'bad' | 'warn'; text: string } | null>(
    null
  );
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const inputLive = status.state === 'running' || status.state === 'suspended';
  const sampleRate = status.sampleRate ?? 48000;

  const createAndActivate = async () => {
    const profile = createProfile({
      name: newName.trim() || suggestedName(),
      sampleRate,
      diagnostics: status.diagnostics,
      referenceSerial: newSerial,
      notes: newNotes,
    });
    const saved = await upsertProfile(profile);
    setActiveProfile(saved.id);
    setNewName('');
    setNewSerial('');
    setNewNotes('');
    setMode('overview');
    setMessage({ tone: 'good', text: `Profile "${saved.name}" created and activated.` });
  };

  const saveFromWizard = async (next: CalibrationProfile) => {
    const saved = await upsertProfile(next);
    setActiveProfile(saved.id);
    setMode('overview');
    setMessage({ tone: 'good', text: 'Calibration saved and activated.' });
  };

  const exportAll = () => {
    if (profiles.length === 0) return;
    downloadJson(
      buildCalibrationExport(profiles),
      exportFilename({ subject: 'calibration', kind: 'profiles', extension: 'json' })
    );
  };

  const exportOne = (profile: CalibrationProfile) => {
    downloadJson(
      buildCalibrationExport([profile]),
      exportFilename({ subject: profile.name, kind: 'calibration', extension: 'json' })
    );
  };

  const exportOneCsv = (profile: CalibrationProfile) => {
    downloadCsv(
      calibrationCsv(profile),
      exportFilename({ subject: profile.name, kind: 'calibration', extension: 'csv' })
    );
  };

  const importProfiles = async () => {
    const file = await pickTextFile();
    if (!file) return;
    try {
      const data: unknown = JSON.parse(file.text);
      const result = await importCalibrationExport(data);
      await refresh();
      const parts = [`Imported ${result.imported.length} profile(s).`];
      if (result.skipped.length > 0) {
        parts.push(
          `Skipped ${result.skipped.length}: ${result.skipped.map((s) => `${s.name} (${s.reason})`).join('; ')}`
        );
      }
      setMessage({
        tone: result.imported.length > 0 ? 'good' : 'warn',
        text: parts.join(' '),
      });
    } catch (error) {
      setMessage({
        tone: 'bad',
        text: error instanceof Error ? error.message : 'The file could not be imported.',
      });
    }
  };

  const duplicate = async (profile: CalibrationProfile) => {
    await duplicateProfile(profile);
    await refresh();
    setMessage({ tone: 'good', text: `Duplicated "${profile.name}".` });
  };

  if (mode === 'single' && activeProfile) {
    return (
      <div className="space-y-3">
        <ScreenHeader title="Single-point calibration" subtitle={activeProfile.name} />
        <InputGate />
        {inputLive ? (
          <SinglePointWizard
            profile={activeProfile}
            onSave={saveFromWizard}
            onCancel={() => setMode('overview')}
          />
        ) : null}
      </div>
    );
  }

  if (mode === 'linearity' && activeProfile) {
    return (
      <div className="space-y-3">
        <ScreenHeader title="Multi-level linearity" subtitle={activeProfile.name} />
        <InputGate />
        {inputLive ? (
          <LinearityWizard
            profile={activeProfile}
            onSave={saveFromWizard}
            onCancel={() => setMode('overview')}
          />
        ) : null}
      </div>
    );
  }

  if (mode === 'frequency' && activeProfile) {
    return (
      <div className="space-y-3">
        <ScreenHeader title="Frequency response" subtitle={activeProfile.name} />
        <InputGate />
        {inputLive ? (
          <FrequencyWizard
            profile={activeProfile}
            onSave={saveFromWizard}
            onCancel={() => setMode('overview')}
          />
        ) : null}
      </div>
    );
  }

  if (mode === 'new') {
    return (
      <div className="space-y-3">
        <ScreenHeader
          title="New calibration profile"
          subtitle="A profile is tied to one device, one browser and one sample rate."
        />
        <Panel className="space-y-3">
          <Field label="Profile name" required hint="Something you will recognise in six months.">
            <TextInput
              value={newName}
              onChange={setNewName}
              placeholder={suggestedName()}
              ariaLabel="Profile name"
              autoFocus
            />
          </Field>
          <Field
            label="Reference instrument serial"
            hint="Optional, but worth recording for traceability."
          >
            <TextInput value={newSerial} onChange={setNewSerial} placeholder="e.g. A1-12345" />
          </Field>
          <Field label="Notes">
            <TextArea
              value={newNotes}
              onChange={setNewNotes}
              rows={2}
              placeholder="Phone in silicone case, microphone at the bottom edge"
            />
          </Field>
          <KeyValue
            entries={[
              ['Reference instrument', 'NTi Audio XL2'],
              ['Device', status.diagnostics?.deviceLabel ?? NO_VALUE],
              ['Sample rate', `${sampleRate} Hz`],
              [
                'Device audio processing',
                status.diagnostics?.processingSuspected
                  ? 'Could not be confirmed disabled'
                  : 'Reported as disabled',
              ],
            ]}
          />
          <div className="flex gap-2">
            <Button variant="primary" disabled={!inputLive} onClick={() => void createAndActivate()}>
              Create profile
            </Button>
            <Button variant="ghost" onClick={() => setMode('overview')}>
              Cancel
            </Button>
          </div>
          {!inputLive ? (
            <Banner tone="info">
              Open the microphone first so the profile records the real sample rate and input device.
            </Banner>
          ) : null}
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ScreenHeader
        title="Calibration"
        subtitle="Calibrate and validate against your NTi Audio XL2 so Sonoscope can show sound pressure level."
      />

      {message ? (
        <Banner tone={message.tone === 'good' ? 'good' : message.tone === 'bad' ? 'bad' : 'warn'}>
          {message.text}
        </Banner>
      ) : null}

      {/*
        Calibration needs a live input: the sample rate and the input device are
        recorded in the profile, and every procedure captures a real level. Without
        this the procedure buttons would simply be disabled with no explanation.
      */}
      <InputGate />

      <Panel>
        <PanelHeader title="Current status" />
        <QualityReport report={quality} />
      </Panel>

      {activeProfile ? (
        <Panel>
          <PanelHeader
            title="Calibration procedures"
            hint="Run them in this order; each builds on the one before."
          />
          <div className="space-y-2">
            <ProcedureRow
              step="1"
              title="Single-point level calibration"
              description="One simultaneous reading fixes the offset so levels become dB SPL."
              done={activeProfile.level !== null}
              onRun={() => setMode('single')}
              disabled={!inputLive}
            />
            <ProcedureRow
              step="2"
              title="Multi-level linearity"
              description="Several levels establish a verified range and detect non-linear behaviour."
              done={activeProfile.level?.method === 'linearity-fit'}
              onRun={() => setMode('linearity')}
              disabled={!inputLive}
            />
            <ProcedureRow
              step="3"
              title="Frequency response"
              description="Per-frequency corrections for the microphone response."
              done={(activeProfile.frequency?.points.length ?? 0) >= 2}
              onRun={() => setMode('frequency')}
              disabled={!inputLive || activeProfile.level === null}
              blockedReason={
                activeProfile.level === null ? 'Needs a level calibration first' : undefined
              }
            />
          </div>
        </Panel>
      ) : null}

      {activeProfile ? (
        <Panel>
          <PanelHeader title="Applied correction" />
          <div className="space-y-1">
            <Toggle
              label="Apply frequency-response correction"
              description="Corrects octave, one-third-octave and spectrum levels. Bands outside the measured range are marked."
              checked={settings.frequencyCorrectionEnabled}
              onChange={(checked) => update({ frequencyCorrectionEnabled: checked })}
              disabled={!activeProfile.frequency}
            />
          </div>
          <KeyValue
            entries={[
              [
                'Level transform',
                calibration.isCalibrated
                  ? `SPL = ${calibration.slope.toFixed(6)} \u00d7 dBFS ${formatSigned(calibration.intercept, 3)}`
                  : 'None',
              ],
              [
                'Frequency correction',
                calibration.frequencyCorrectionEnabled && calibration.correctionCurve
                  ? `Active, ${calibration.correctionCurve.frequencies.length} points`
                  : activeProfile.frequency
                    ? 'Available but switched off'
                    : 'Not measured',
              ],
            ]}
          />
        </Panel>
      ) : null}

      <Panel>
        <PanelHeader
          title={`Profiles (${profiles.length})`}
          action={
            <Button size="sm" variant="accent" onClick={() => setMode('new')}>
              New profile
            </Button>
          }
        />
        {profiles.length === 0 ? (
          <EmptyState
            title="No calibration profiles"
            action={
              <Button variant="accent" onClick={() => setMode('new')}>
                Create the first profile
              </Button>
            }
          >
            Until a profile exists, every level in Sonoscope is a digital full-scale value (dBFS).
            Creating one and running a single-point calibration takes about a minute with the XL2.
          </EmptyState>
        ) : (
          <ul className="space-y-2">
            {profiles.map((profile) => {
              const active = profile.id === activeProfile?.id;
              const match = profileMatchesDevice(profile.device, status.sampleRate);
              return (
                <li
                  key={profile.id}
                  className={cx(
                    'rounded-lg border p-2.5',
                    active ? 'border-accent/50 bg-accent/5' : 'border-line bg-panel-sunken'
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-ink">
                          {profile.name}
                        </span>
                        {active ? <Badge tone="info">active</Badge> : null}
                        {!match.matches ? <Badge tone="warn">device mismatch</Badge> : null}
                      </div>
                      <p className="mt-0.5 text-[11px] text-faint">
                        {profile.device.model} &middot; {profile.device.browser} &middot;{' '}
                        {profile.sampleRate} Hz &middot; {formatDate(profile.createdAt)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted">
                        {profile.level
                          ? `Offset ${formatSigned(profile.level.intercept, 2)} dB, slope ${profile.level.slope.toFixed(4)}`
                          : 'No level calibration'}
                        {profile.frequency
                          ? ` \u00b7 ${profile.frequency.points.length} frequency points`
                          : ''}
                        {profile.validation
                          ? ` \u00b7 mean error ${formatLevel(profile.validation.meanErrorDb)} dB over ${profile.validation.n} comparisons`
                          : ''}
                      </p>
                      {!match.matches ? (
                        <ul className="mt-1 space-y-0.5 text-[10px] text-warn">
                          {match.reasons.map((reason) => (
                            <li key={reason}>&bull; {reason}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {!active ? (
                      <Button size="sm" variant="accent" onClick={() => setActiveProfile(profile.id)}>
                        Activate
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setActiveProfile(null)}>
                        Deactivate
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => exportOne(profile)}>
                      Export JSON
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => exportOneCsv(profile)}>
                      Export CSV
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void duplicate(profile)}>
                      Duplicate
                    </Button>
                    <Button
                      size="sm"
                      variant={confirmDelete === profile.id ? 'danger' : 'ghost'}
                      onClick={() => {
                        if (confirmDelete === profile.id) {
                          void removeProfile(profile.id);
                          setConfirmDelete(null);
                        } else {
                          setConfirmDelete(profile.id);
                          setTimeout(() => setConfirmDelete(null), 4000);
                        }
                      }}
                    >
                      {confirmDelete === profile.id ? 'Tap to confirm' : 'Delete'}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel>
        <PanelHeader
          title="Backup"
          hint="Calibration data represents real work with a reference instrument. Keep a copy off the device."
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={profiles.length === 0} onClick={exportAll}>
            Export all profiles
          </Button>
          <Button size="sm" onClick={() => void importProfiles()}>
            Import from file
          </Button>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          Imported profiles always get a new identifier, so importing can never overwrite an existing
          calibration. A profile from a different phone or browser is kept but clearly flagged,
          because a calibration is only valid for the device it was made on.
        </p>
      </Panel>

      <Banner tone="info" title="Why calibration is necessary">
        A smartphone microphone reports digital amplitude, not sound pressure. The path from one to
        the other depends on the microphone, its port geometry, the case, the audio front end and the
        browser&rsquo;s processing. Comparing against a reference instrument is the only way to
        establish it, and repeating that comparison at several levels and frequencies is the only way
        to know how far you can trust it.
      </Banner>
    </div>
  );
}

function ProcedureRow({
  step,
  title,
  description,
  done,
  onRun,
  disabled,
  blockedReason,
}: {
  step: string;
  title: string;
  description: string;
  done: boolean;
  onRun: () => void;
  disabled?: boolean;
  blockedReason?: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-line bg-panel-sunken p-2.5">
      <span
        className={cx(
          'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
          done ? 'bg-ok/20 text-ok' : 'bg-panel-raised text-faint'
        )}
      >
        {done ? '\u2713' : step}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-ink">{title}</div>
        <p className="mt-0.5 text-[11px] leading-snug text-faint">{description}</p>
        {blockedReason ? (
          <p className="mt-0.5 text-[11px] text-warn">{blockedReason}</p>
        ) : null}
      </div>
      {/*
        Three buttons all called "Run" are indistinguishable to a screen reader, so
        each one carries the procedure name in its accessible name.
      */}
      <Button
        size="sm"
        variant={done ? 'ghost' : 'accent'}
        disabled={disabled}
        onClick={onRun}
        ariaLabel={`${done ? 'Redo' : 'Run'}: ${title}`}
      >
        {done ? 'Redo' : 'Run'}
      </Button>
    </div>
  );
}

function suggestedName(): string {
  const now = new Date();
  return `Calibration ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

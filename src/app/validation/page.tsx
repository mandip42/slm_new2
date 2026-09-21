'use client';

/**
 * XL2 validation laboratory.
 *
 * This is what turns "calibrated until the numbers matched" into a characterised
 * instrument. Each experiment records its full setup and a list of paired
 * readings, and the error statistics are computed from those pairs — never
 * assumed, never rounded into something flattering.
 */

import { useMemo, useState } from 'react';
import { describeErrors } from '@/dsp/statistics';
import { TIME_WEIGHTING_LABELS, type TimeWeightingId } from '@/dsp/timeWeighting';
import { WEIGHTING_IDS, type WeightingId } from '@/dsp/weighting/reference';
import { formatDateTime, formatFrequency, formatLevel, formatNumber, formatSigned, NO_VALUE } from '@/lib/format';
import { downloadCsv, downloadJson, exportFilename } from '@/reports/download';
import { validationExperimentCsv } from '@/reports/csv';
import { buildValidationExport } from '@/reports/json';
import {
  EXPERIMENT_KINDS,
  createExperiment,
  createPoint,
  experimentErrors,
} from '@/storage/validationStore';
import type { ValidationExperiment, ValidationExperimentKind } from '@/storage/types';
import { useCalibration } from '@/state/CalibrationProvider';
import { useEngineContext } from '@/state/EngineProvider';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { InputGate } from '@/components/meter/InputGate';
import { CapturePad } from '@/components/calibration/CapturePad';
import { useLevelCapture } from '@/components/calibration/useLevelCapture';
import { AgreementChart, ResidualChart } from '@/components/charts/AgreementChart';
import {
  Badge,
  Banner,
  Button,
  ControlRow,
  EmptyState,
  Field,
  KeyValue,
  Metric,
  NumberInput,
  Panel,
  PanelHeader,
  SegmentedControl,
  Select,
  TextArea,
  TextInput,
  cx,
} from '@/components/ui/primitives';

export default function ValidationPage() {
  const { status } = useEngineContext();
  const { profiles, activeProfile, calibration, experiments, upsertExperiment, removeExperiment } =
    useCalibration();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newKind, setNewKind] = useState<ValidationExperimentKind>('broadband-level');
  const [newName, setNewName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const selected = experiments.find((e) => e.id === selectedId) ?? null;
  const inputLive = status.state === 'running' || status.state === 'suspended';

  const overall = useMemo(() => {
    const errors = experiments.flatMap(experimentErrors);
    return describeErrors(errors);
  }, [experiments]);

  const create = async () => {
    const definition = EXPERIMENT_KINDS.find((k) => k.id === newKind)!;
    const experiment = createExperiment({
      name: newName.trim() || definition.label,
      kind: newKind,
      profileId: activeProfile?.id ?? null,
    });
    const saved = await upsertExperiment(experiment);
    setSelectedId(saved.id);
    setCreating(false);
    setNewName('');
  };

  const exportAll = () => {
    downloadJson(
      buildValidationExport(experiments, profiles),
      exportFilename({ subject: 'xl2', kind: 'validation', extension: 'json' })
    );
  };

  if (selected) {
    return (
      <ExperimentDetail
        experiment={selected}
        onBack={() => setSelectedId(null)}
        onSave={upsertExperiment}
        inputLive={inputLive}
        calibrated={calibration.isCalibrated}
      />
    );
  }

  return (
    <div className="space-y-3">
      <ScreenHeader
        title="XL2 validation lab"
        subtitle="Side-by-side comparison experiments with full error statistics, so accuracy is measured rather than assumed."
      />

      {message ? <Banner tone="good">{message}</Banner> : null}

      {/* Recording a comparison needs a live input, so offer it here too. */}
      <InputGate />

      {!calibration.isCalibrated ? (
        <Banner tone="warn" title="Calibrate before validating">
          A validation compares Sonoscope&rsquo;s calibrated level against the reference. Without a
          calibration the comparison would just measure the missing offset. Set up a calibration
          first, then come back and characterise it.
        </Banner>
      ) : null}

      <Panel>
        <PanelHeader
          title="Overall agreement"
          hint="Every paired reading across every experiment."
        />
        {overall.n === 0 ? (
          <EmptyState title="No comparisons recorded yet">
            Add an experiment below and record paired readings. Three or more comparisons are needed
            before a 95 % error interval is meaningful.
          </EmptyState>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Metric label="Comparisons" value={String(overall.n)} />
              <Metric
                label="Mean error"
                value={formatSigned(overall.mean, 2)}
                unit="dB"
                tone={Math.abs(overall.mean) <= 1 ? 'good' : Math.abs(overall.mean) <= 2 ? 'warn' : 'bad'}
              />
              <Metric
                label="Std deviation"
                value={formatNumber(overall.standardDeviation, 2)}
                unit="dB"
              />
              <Metric label="RMSE" value={formatNumber(overall.rmse, 2)} unit="dB" />
              <Metric
                label="Worst error"
                value={formatNumber(overall.maxAbs, 2)}
                unit="dB"
                tone={overall.maxAbs <= 2 ? 'good' : overall.maxAbs <= 4 ? 'warn' : 'bad'}
              />
              <Metric
                label="95 % interval"
                value={
                  overall.interval95
                    ? `${formatSigned(overall.interval95.low, 1)} to ${formatSigned(overall.interval95.high, 1)}`
                    : NO_VALUE
                }
                unit="dB"
                hint={overall.interval95 ? undefined : 'needs 3+ comparisons'}
                size="sm"
              />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-faint">
              Error is Sonoscope minus the reference. The mean is bias, which a calibration can
              remove; the standard deviation is scatter, which it cannot. Both matter.
            </p>
          </>
        )}
      </Panel>

      {experiments.length > 0 ? (
        <Panel>
          <PanelHeader title="All comparisons" />
          <AgreementChart
            points={experiments.flatMap((experiment) =>
              experiment.points
                .filter((p) => Number.isFinite(p.referenceDb) && Number.isFinite(p.measuredDb))
                .map((p) => ({ referenceDb: p.referenceDb, estimateDb: p.measuredDb }))
            )}
          />
        </Panel>
      ) : null}

      <Panel>
        <PanelHeader
          title={`Experiments (${experiments.length})`}
          action={
            <Button size="sm" variant="accent" onClick={() => setCreating((v) => !v)}>
              {creating ? 'Cancel' : 'New experiment'}
            </Button>
          }
        />

        {creating ? (
          <div className="mb-3 space-y-3 rounded-lg border border-accent/40 bg-accent/5 p-3">
            <Field label="Experiment type">
              <Select
                value={newKind}
                onChange={(value) => setNewKind(value as ValidationExperimentKind)}
                options={EXPERIMENT_KINDS.map((k) => ({ value: k.id, label: k.label }))}
                ariaLabel="Experiment type"
              />
            </Field>
            <p className="text-[11px] leading-relaxed text-muted">
              {EXPERIMENT_KINDS.find((k) => k.id === newKind)?.purpose}
            </p>
            <Field label="Name" hint="Leave blank to use the standard name.">
              <TextInput value={newName} onChange={setNewName} placeholder="Optional" />
            </Field>
            <Button variant="primary" onClick={() => void create()}>
              Create experiment
            </Button>
          </div>
        ) : null}

        {experiments.length === 0 && !creating ? (
          <EmptyState title="No experiments yet">
            The six standard experiments cover broadband level agreement, frequency response, A and C
            weighting, time response and octave bands. Start with broadband level agreement.
          </EmptyState>
        ) : (
          <ul className="space-y-2">
            {experiments.map((experiment) => {
              const errors = experimentErrors(experiment);
              const stats = describeErrors(errors);
              return (
                <li
                  key={experiment.id}
                  className="rounded-lg border border-line bg-panel-sunken p-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-ink">
                        {experiment.name}
                      </div>
                      <p className="mt-0.5 text-[11px] text-faint">
                        {experiment.points.length} point
                        {experiment.points.length === 1 ? '' : 's'} &middot;{' '}
                        {formatDateTime(experiment.updatedAt)}
                      </p>
                      {stats.n > 0 ? (
                        <p className="tnum mt-0.5 text-[11px] text-muted">
                          mean {formatSigned(stats.mean, 2)} dB &middot; RMSE{' '}
                          {formatNumber(stats.rmse, 2)} dB &middot; worst{' '}
                          {formatNumber(stats.maxAbs, 2)} dB
                        </p>
                      ) : null}
                    </div>
                    <Badge tone={stats.n >= 3 ? 'good' : 'neutral'}>
                      {stats.n >= 3 ? 'analysed' : 'in progress'}
                    </Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Button size="sm" variant="accent" onClick={() => setSelectedId(experiment.id)}>
                      Open
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        downloadCsv(
                          validationExperimentCsv(experiment),
                          exportFilename({
                            subject: experiment.name,
                            kind: 'validation',
                            extension: 'csv',
                          })
                        )
                      }
                    >
                      Export CSV
                    </Button>
                    <Button
                      size="sm"
                      variant={confirmDelete === experiment.id ? 'danger' : 'ghost'}
                      onClick={() => {
                        if (confirmDelete === experiment.id) {
                          void removeExperiment(experiment.id);
                          setConfirmDelete(null);
                          setMessage(`Deleted "${experiment.name}".`);
                        } else {
                          setConfirmDelete(experiment.id);
                          setTimeout(() => setConfirmDelete(null), 4000);
                        }
                      }}
                    >
                      {confirmDelete === experiment.id ? 'Tap to confirm' : 'Delete'}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {experiments.length > 0 ? (
        <Panel>
          <PanelHeader title="Export" />
          <Button size="sm" onClick={exportAll}>
            Export all experiments and profiles (JSON)
          </Button>
        </Panel>
      ) : null}

      <Banner tone="info" title="Spatial variation is the main source of scatter">
        Two microphones at different points in a sound field do not measure the same thing. Reflections
        create a level pattern that varies by several decibels over a wavelength, so at 1 kHz a
        30 cm separation can be a 3 dB disagreement that has nothing to do with either instrument.
        Keep the microphones as close together as physically possible, keep the geometry fixed between
        the paired readings, prefer a steady source in a space with few reflections, and repeat each
        comparison. Environmental noise is the worst possible reference.
      </Banner>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ExperimentDetail({
  experiment,
  onBack,
  onSave,
  inputLive,
  calibrated,
}: {
  experiment: ValidationExperiment;
  onBack: () => void;
  onSave: (experiment: ValidationExperiment) => Promise<ValidationExperiment>;
  inputLive: boolean;
  calibrated: boolean;
}) {
  const definition = EXPERIMENT_KINDS.find((k) => k.id === experiment.kind);
  const { calibration } = useCalibration();

  const [weighting, setWeighting] = useState<WeightingId>(
    experiment.kind === 'c-weighting' ? 'C' : experiment.kind === 'frequency-response' ? 'Z' : 'A'
  );
  const [timeWeighting, setTimeWeighting] = useState<Exclude<TimeWeightingId, 'I'>>(
    experiment.kind === 'time-response' ? 'F' : 'S'
  );
  const [windowSeconds, setWindowSeconds] = useState(10);
  const [referenceText, setReferenceText] = useState('');
  const [frequencyText, setFrequencyText] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [setup, setSetup] = useState(experiment.setup);
  const [savingSetup, setSavingSetup] = useState(false);

  const capture = useLevelCapture(weighting, timeWeighting);
  const reference = Number.parseFloat(referenceText);
  const referenceValid = Number.isFinite(reference);
  const captured = capture.result;
  const measured =
    captured && Number.isFinite(captured.levelDbfs)
      ? calibration.toDisplay(captured.levelDbfs)
      : null;

  const errors = experimentErrors(experiment);
  const stats = describeErrors(errors);

  const addPoint = async () => {
    if (measured === null || !referenceValid) return;
    const point = createPoint({
      description: description.trim() || describeAuto(experiment.kind, frequencyText, reference),
      referenceDb: reference,
      measuredDb: measured,
      weighting,
      timeWeighting,
      frequencyHz: Number.isFinite(Number.parseFloat(frequencyText))
        ? Number.parseFloat(frequencyText)
        : null,
      durationSeconds: captured?.windowSeconds ?? null,
      notes: notes.trim() || (captured && !captured.stable ? `capture range ${captured.rangeDb.toFixed(1)} dB` : ''),
    });
    await onSave({ ...experiment, points: [...experiment.points, point] });
    setReferenceText('');
    setDescription('');
    setNotes('');
    capture.clear();
  };

  const removePoint = async (id: string) => {
    await onSave({ ...experiment, points: experiment.points.filter((p) => p.id !== id) });
  };

  const saveSetup = async () => {
    setSavingSetup(true);
    try {
      await onSave({ ...experiment, setup });
    } finally {
      setSavingSetup(false);
    }
  };

  const frequencyRelevant = definition?.frequencyRelevant ?? false;

  return (
    <div className="space-y-3">
      <ScreenHeader
        title={experiment.name}
        subtitle={definition?.purpose}
        action={
          <Button size="sm" variant="ghost" onClick={onBack}>
            Back
          </Button>
        }
      />

      <InputGate />

      {!calibrated ? (
        <Banner tone="warn">
          No calibration is active, so the Sonoscope column would be a dBFS value and the error
          column would be meaningless. Activate a calibration before recording points.
        </Banner>
      ) : null}

      <Panel>
        <PanelHeader
          title="Experimental setup"
          hint="Recorded with the experiment so it can be reproduced."
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Source" hint="What produced the sound.">
            <TextInput
              value={setup.source}
              onChange={(value) => setSetup({ ...setup, source: value })}
              placeholder="Pink noise, powered monitor"
            />
          </Field>
          <Field label="Distance to source">
            <NumberInput
              value={setup.distanceMetres === null ? '' : String(setup.distanceMetres)}
              onChange={(value) =>
                setSetup({
                  ...setup,
                  distanceMetres: value === '' ? null : Number.parseFloat(value),
                })
              }
              step={0.1}
              suffix="m"
              placeholder="1.0"
            />
          </Field>
          <Field label="Phone orientation">
            <TextInput
              value={setup.phoneOrientation}
              onChange={(value) => setSetup({ ...setup, phoneOrientation: value })}
              placeholder="Bottom edge toward source, screen up"
            />
          </Field>
          <Field label="Reference orientation">
            <TextInput
              value={setup.referenceOrientation}
              onChange={(value) => setSetup({ ...setup, referenceOrientation: value })}
              placeholder="Microphone axis toward source, 5 cm from phone mic"
            />
          </Field>
          <Field label="Environment">
            <TextInput
              value={setup.environment}
              onChange={(value) => setSetup({ ...setup, environment: value })}
              placeholder="Treated room, background 32 dBA"
            />
          </Field>
          <Field label="Setup notes">
            <TextArea
              value={setup.notes}
              onChange={(value) => setSetup({ ...setup, notes: value })}
              rows={2}
            />
          </Field>
        </div>
        <div className="mt-2">
          <Button size="sm" disabled={savingSetup} onClick={() => void saveSetup()}>
            {savingSetup ? 'Saving\u2026' : 'Save setup'}
          </Button>
        </div>
      </Panel>

      {inputLive ? (
        <>
          <Panel>
            <PanelHeader title="Measurement settings" />
            <ControlRow>
              <SegmentedControl
                label="Frequency weighting"
                value={weighting}
                onChange={setWeighting}
                options={WEIGHTING_IDS.map((id) => ({ value: id, label: id }))}
              />
              <SegmentedControl
                label="Time weighting"
                value={timeWeighting}
                onChange={(value) => setTimeWeighting(value)}
                options={[
                  { value: 'F', label: TIME_WEIGHTING_LABELS.F },
                  { value: 'S', label: TIME_WEIGHTING_LABELS.S },
                ]}
              />
            </ControlRow>
            <p className="mt-2 text-[11px] text-faint">
              Set the reference instrument to exactly the same weighting and time weighting. A
              mismatch here is the most common cause of an apparent disagreement.
            </p>
          </Panel>

          <CapturePad
            capture={capture}
            weighting={weighting}
            timeWeighting={timeWeighting}
            windowSeconds={windowSeconds}
            onWindowChange={setWindowSeconds}
          />

          <Panel>
            <PanelHeader title="Record a comparison" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Reference reading" required>
                <NumberInput
                  value={referenceText}
                  onChange={setReferenceText}
                  step={0.1}
                  suffix={`dB${weighting}`}
                  ariaLabel="Reference reading"
                />
              </Field>
              {frequencyRelevant ? (
                <Field label="Frequency">
                  <NumberInput
                    value={frequencyText}
                    onChange={setFrequencyText}
                    step={1}
                    suffix="Hz"
                    ariaLabel="Frequency"
                  />
                </Field>
              ) : null}
              <Field label="Description" hint="What this particular comparison was.">
                <TextInput
                  value={description}
                  onChange={setDescription}
                  placeholder="Auto-generated if left blank"
                />
              </Field>
              <Field label="Notes">
                <TextInput value={notes} onChange={setNotes} placeholder="Optional" />
              </Field>
            </div>

            {measured !== null ? (
              <div className="mt-3">
                <KeyValue
                  entries={[
                    ['Sonoscope', `${formatLevel(measured)} dB${weighting}`],
                    [
                      'Reference',
                      referenceValid ? `${formatLevel(reference)} dB${weighting}` : NO_VALUE,
                    ],
                    [
                      'Error',
                      referenceValid ? `${formatSigned(measured - reference, 2)} dB` : NO_VALUE,
                    ],
                  ]}
                />
              </div>
            ) : null}

            <div className="mt-3">
              <Button
                variant="accent"
                disabled={measured === null || !referenceValid}
                onClick={() => void addPoint()}
              >
                Record comparison
              </Button>
            </div>
          </Panel>
        </>
      ) : null}

      <Panel>
        <PanelHeader title={`Comparisons (${experiment.points.length})`} />
        {experiment.points.length === 0 ? (
          <EmptyState title="No comparisons recorded">
            Capture a level, enter the reference reading and record the pair.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="py-1 font-semibold text-faint">Description</th>
                  {frequencyRelevant ? (
                    <th className="py-1 font-semibold text-faint">Freq</th>
                  ) : null}
                  <th className="py-1 text-right font-semibold text-faint">Ref</th>
                  <th className="py-1 text-right font-semibold text-faint">App</th>
                  <th className="py-1 text-right font-semibold text-faint">Error</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody className="tnum">
                {experiment.points.map((point) => {
                  const error = point.measuredDb - point.referenceDb;
                  return (
                    <tr key={point.id} className="border-b border-line/50">
                      <td className="py-1 pr-2 text-ink">
                        {point.description}
                        <span className="block text-[10px] text-faint">
                          {point.weighting} {point.timeWeighting}
                          {point.notes ? ` \u00b7 ${point.notes}` : ''}
                        </span>
                      </td>
                      {frequencyRelevant ? (
                        <td className="py-1 text-muted">
                          {point.frequencyHz === null ? '\u2014' : formatFrequency(point.frequencyHz)}
                        </td>
                      ) : null}
                      <td className="py-1 text-right text-muted">{formatLevel(point.referenceDb)}</td>
                      <td className="py-1 text-right text-muted">{formatLevel(point.measuredDb)}</td>
                      <td
                        className={cx(
                          'py-1 text-right font-semibold',
                          Math.abs(error) > 2 ? 'text-bad' : Math.abs(error) > 1 ? 'text-warn' : 'text-ok'
                        )}
                      >
                        {formatSigned(error, 2)}
                      </td>
                      <td className="py-1 text-right">
                        <button
                          type="button"
                          onClick={() => void removePoint(point.id)}
                          className="text-faint underline"
                          aria-label="Remove this comparison"
                        >
                          remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {stats.n > 0 ? (
        <>
          <Panel>
            <PanelHeader title="Error statistics for this experiment" />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Metric label="Comparisons" value={String(stats.n)} size="sm" />
              <Metric label="Mean error" value={formatSigned(stats.mean, 2)} unit="dB" size="sm" />
              <Metric
                label="Std deviation"
                value={formatNumber(stats.standardDeviation, 2)}
                unit="dB"
                size="sm"
              />
              <Metric label="RMSE" value={formatNumber(stats.rmse, 2)} unit="dB" size="sm" />
              <Metric label="Worst" value={formatNumber(stats.maxAbs, 2)} unit="dB" size="sm" />
              <Metric
                label="95 % interval"
                value={
                  stats.interval95
                    ? `${formatSigned(stats.interval95.low, 1)} to ${formatSigned(stats.interval95.high, 1)}`
                    : NO_VALUE
                }
                unit="dB"
                size="sm"
                hint={stats.interval95 ? undefined : 'needs 3+ points'}
              />
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Agreement" />
            <AgreementChart
              points={experiment.points.map((p) => ({
                referenceDb: p.referenceDb,
                estimateDb: p.measuredDb,
              }))}
            />
          </Panel>

          <Panel>
            <PanelHeader
              title={frequencyRelevant ? 'Error against frequency' : 'Error against level'}
            />
            <ResidualChart
              points={experiment.points.map((p) => ({
                x: frequencyRelevant && p.frequencyHz !== null ? p.frequencyHz : p.referenceDb,
                errorDb: p.measuredDb - p.referenceDb,
              }))}
              xLabel={frequencyRelevant ? 'Frequency (Hz)' : 'Reference level (dB)'}
              logX={frequencyRelevant}
            />
          </Panel>
        </>
      ) : null}

      <Panel>
        <PanelHeader title="Export" />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() =>
              downloadCsv(
                validationExperimentCsv(experiment),
                exportFilename({ subject: experiment.name, kind: 'validation', extension: 'csv' })
              )
            }
          >
            Export CSV
          </Button>
        </div>
      </Panel>
    </div>
  );
}

function describeAuto(
  kind: ValidationExperimentKind,
  frequencyText: string,
  reference: number
): string {
  const frequency = Number.parseFloat(frequencyText);
  if (Number.isFinite(frequency)) {
    return `${formatFrequency(frequency)} at ${formatLevel(reference, 0)} dB`;
  }
  switch (kind) {
    case 'broadband-level':
      return `Broadband at ${formatLevel(reference, 0)} dB`;
    case 'a-weighting':
      return `LAeq at ${formatLevel(reference, 0)} dB`;
    case 'c-weighting':
      return `LCeq at ${formatLevel(reference, 0)} dB`;
    case 'time-response':
      return `Time response at ${formatLevel(reference, 0)} dB`;
    default:
      return `Comparison at ${formatLevel(reference, 0)} dB`;
  }
}

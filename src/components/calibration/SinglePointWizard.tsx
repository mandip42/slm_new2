'use client';

/**
 * Method A: single-point SPL calibration.
 *
 * The user measures the same sound field with both instruments at the same
 * moment, enters the reference reading, and the app solves
 *
 *     SPL = dBFS + (reference - captured dBFS)
 *
 * i.e. slope fixed at 1 and only the offset determined. The wizard is explicit
 * that this establishes accuracy *at that level only*, and points at the
 * multi-level procedure for anything more.
 */

import { useState } from 'react';
import { TIME_WEIGHTING_LABELS, type TimeWeightingId } from '@/dsp/timeWeighting';
import { WEIGHTING_IDS, type WeightingId } from '@/dsp/weighting/reference';
import { singlePointCalibration } from '@/calibration/fit';
import { createId } from '@/lib/id';
import { formatLevel, formatSigned, NO_VALUE } from '@/lib/format';
import { applySinglePoint } from '@/storage/calibrationStore';
import type { CalibrationProfile, LevelCalibrationPoint } from '@/storage/types';
import {
  Banner,
  Button,
  Field,
  KeyValue,
  NumberInput,
  Panel,
  PanelHeader,
  SegmentedControl,
  TextArea,
} from '@/components/ui/primitives';
import { CapturePad } from './CapturePad';
import { useLevelCapture } from './useLevelCapture';

export function SinglePointWizard({
  profile,
  onSave,
  onCancel,
}: {
  profile: CalibrationProfile;
  onSave: (profile: CalibrationProfile) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [weighting, setWeighting] = useState<WeightingId>(profile.level?.weighting ?? 'A');
  const [timeWeighting, setTimeWeighting] = useState<Exclude<TimeWeightingId, 'I'>>('S');
  const [windowSeconds, setWindowSeconds] = useState(10);
  const [referenceText, setReferenceText] = useState('');
  const [frequencyText, setFrequencyText] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const capture = useLevelCapture(weighting, timeWeighting);
  const reference = Number.parseFloat(referenceText);
  const referenceValid = Number.isFinite(reference) && reference > -20 && reference < 200;
  const captured = capture.result;

  const solved =
    captured && referenceValid
      ? singlePointCalibration(reference, captured.levelDbfs)
      : null;

  const save = async () => {
    if (!captured || !referenceValid) return;
    setSaving(true);
    setError(null);
    try {
      const point: LevelCalibrationPoint = {
        id: createId('lpt'),
        at: captured.at,
        referenceDb: reference,
        phoneDbfs: captured.levelDbfs,
        weighting,
        timeWeighting,
        frequencyHz: Number.isFinite(Number.parseFloat(frequencyText))
          ? Number.parseFloat(frequencyText)
          : null,
        notes: notes.trim(),
      };
      await onSave(applySinglePoint(profile, point));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'The calibration could not be saved.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <Panel>
        <PanelHeader
          title="Method A - single-point level calibration"
          hint={`Reference instrument: ${profile.referenceInstrument}`}
        />
        <ol className="ml-4 list-decimal space-y-1 text-[11px] leading-relaxed text-muted">
          <li>
            Place the phone microphone and the reference microphone as close together as physically
            possible without one shadowing the other, both pointing the same way.
          </li>
          <li>
            Use a steady source. A calibrator or a continuous pink-noise or tone source is ideal;
            environmental noise is not, because the two microphones will not see the same thing.
          </li>
          <li>
            Set the reference instrument to the same weighting and time weighting selected below, and
            start both measuring together.
          </li>
          <li>Capture here, then type the reference reading and save.</li>
        </ol>
      </Panel>

      <Panel>
        <PanelHeader title="Measurement settings" />
        <div className="flex flex-wrap gap-2">
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
        </div>
        <p className="mt-2 text-[11px] text-faint">
          Slow time weighting is recommended for calibration: it averages more and is easier to match
          against a reference read-out.
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
        <PanelHeader title="Reference reading" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={`${profile.referenceInstrument} level`}
            hint={`The L${weighting}${timeWeighting} value shown on the reference instrument during the capture.`}
            required
            error={
              referenceText.length > 0 && !referenceValid
                ? 'Enter a level between -20 and 200 dB.'
                : null
            }
          >
            <NumberInput
              value={referenceText}
              onChange={setReferenceText}
              placeholder="74.3"
              step={0.1}
              suffix={`dB${weighting}`}
              ariaLabel="Reference instrument level"
            />
          </Field>
          <Field
            label="Reference frequency"
            hint="Optional. Record it if you used a tone or a calibrator."
          >
            <NumberInput
              value={frequencyText}
              onChange={setFrequencyText}
              placeholder="1000"
              step={1}
              suffix="Hz"
              ariaLabel="Reference frequency"
            />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Notes" hint="Source, distance, room, anything you will want to know later.">
            <TextArea
              value={notes}
              onChange={setNotes}
              rows={2}
              placeholder="Pink noise from monitor at 1 m, treated room, phone in case"
              ariaLabel="Calibration notes"
            />
          </Field>
        </div>
      </Panel>

      {solved && captured ? (
        <Panel>
          <PanelHeader title="Result" />
          <KeyValue
            entries={[
              ['Captured phone level', `${formatLevel(captured.levelDbfs, 2)} dBFS`],
              ['Reference level', `${formatLevel(reference, 1)} dB${weighting}`],
              ['Calibration offset', `${formatSigned(solved.intercept, 2)} dB`],
              ['Transform', `SPL = dBFS ${formatSigned(solved.intercept, 2)}`],
              ['Capture stability', captured.stable ? 'stable' : `range ${captured.rangeDb.toFixed(1)} dB`],
            ]}
          />
          <Banner tone="warn" title="What this does and does not establish">
            A single point fixes the offset at {formatLevel(reference, 0)} dB
            {weighting}. It says nothing about accuracy at other levels, and nothing about frequency
            response. Run the multi-level procedure to establish a verified level range, and the
            frequency procedure to correct the microphone response.
          </Banner>
        </Panel>
      ) : null}

      {error ? <Banner tone="bad">{error}</Banner> : null}

      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={!solved || saving}
          onClick={() => void save()}
        >
          {saving ? 'Saving\u2026' : 'Save calibration'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {captured ? (
          <Button variant="ghost" onClick={capture.clear}>
            Discard capture
          </Button>
        ) : null}
      </div>

      {!captured ? (
        <p className="px-1 text-[11px] text-faint">
          Capture a level and enter the reference reading to see the result. Current capture:{' '}
          {NO_VALUE}
        </p>
      ) : null}
    </div>
  );
}

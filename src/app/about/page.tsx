'use client';

import Link from 'next/link';
import { WEIGHTING_FIT_UPPER_HZ } from '@/dsp/weighting/design';
import { STATISTICS_SAMPLE_RATE_HZ } from '@/dsp/statistics';
import { WARM_UP_SECONDS } from '@/dsp/engine';
import { BAND_USABLE_NYQUIST_FRACTION } from '@/dsp/octave';
import { CLIP_THRESHOLD, NEAR_OVERLOAD_DB } from '@/dsp/clipping';
import {
  APP_NAME,
  APP_TAGLINE,
  AUTHOR_EMAIL,
  AUTHOR_NAME,
} from '@/lib/branding';
import { useEngineContext } from '@/state/EngineProvider';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { Badge, Banner, Button, KeyValue, Panel, PanelHeader } from '@/components/ui/primitives';

export default function AboutPage() {
  const { status } = useEngineContext();

  return (
    <div className="space-y-3">
      <ScreenHeader title={`About ${APP_NAME}`} subtitle={APP_TAGLINE} />

      <Panel>
        <PanelHeader title="What it is" />
        <p className="text-xs leading-relaxed text-muted">
          Sonoscope turns a phone into a working acoustic analyser: a sound level meter with correct
          A, C and Z frequency weighting and Fast, Slow and Impulse time weighting; a real
          one-third-octave filter bank; an FFT analyser; a spectrogram; statistical levels; noise
          exposure indicators; and a calibration and validation workflow built around a reference
          instrument. Everything runs in the browser on the device.
        </p>
      </Panel>

      <Banner tone="warn" title="What it is not">
        Sonoscope is <strong>not</strong> a classified sound level meter. It has not been type
        tested or certified against IEC 61672 Class 1 or Class 2, and no such claim is made anywhere in
        this application. It implements measurement concepts and filter designs derived from the
        relevant standards, and it tells you honestly how far its filters deviate from the ideal, but a
        certified instrument is a certified instrument and this is a phone. Where a measurement has
        legal or regulatory consequences, use appropriate certified equipment.
      </Banner>

      <Panel>
        <PanelHeader title="Privacy" />
        <p className="text-xs leading-relaxed text-ink">
          <strong>Microphone audio is processed locally on this device.</strong>
        </p>
        <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted">
          <li>
            &bull; All filtering, spectrum analysis, statistics and calibration maths run in your
            browser. No audio, and no measurement data, is uploaded anywhere.
          </li>
          <li>
            &bull; Audio is only written to storage when you explicitly enable recording, and a
            recording indicator is shown whenever it is active.
          </li>
          <li>
            &bull; The camera is off until you open it on the meter screen, and a photo is only
            taken when you tap Capture. Photos are stored in the same local database as the
            measurements, are never uploaded, and are deleted with the measurement they belong to.
          </li>
          <li>
            &bull; Sessions, calibration profiles and settings are stored in your browser&rsquo;s local
            database. Clearing site data or using the delete option in settings removes them.
          </li>
          <li>
            &bull; There is no analytics, no telemetry and no account. The application makes no network
            requests after it has loaded.
          </li>
        </ul>
      </Panel>

      <Panel>
        <PanelHeader title="Measurement limitations" />
        <div className="space-y-2.5 text-xs leading-relaxed text-muted">
          <Limitation title="A phone microphone does not measure sound pressure by itself">
            It reports digital amplitude. The relationship to sound pressure depends on the
            microphone, the port geometry, the case, the audio front end and the browser. Until you
            calibrate, Sonoscope shows dBFS and labels it as such on every screen.
          </Limitation>
          <Limitation title="Limited dynamic range">
            A phone microphone has a noise floor of roughly 30 dBA and typically starts to compress or
            clip somewhere around 100 to 120 dB SPL depending on the model. Levels near either end are
            unreliable, and the front end often compresses before the converter clips, so a reading
            can already be low while no digital clipping is visible.
          </Limitation>
          <Limitation title="Frequency response varies between phones">
            Response is usually reasonable from a few hundred hertz to several kilohertz and much less
            so outside that. Very low frequencies are limited by the microphone and the port; very high
            frequencies by the microphone and by any case. The frequency-response calibration corrects
            this over the range you measure, and Sonoscope marks bands outside that range rather than
            extrapolating.
          </Limitation>
          <Limitation title="Operating system audio processing">
            Android and the browser may apply automatic gain control, noise suppression or echo
            cancellation. Sonoscope requests all three off and reports what was actually granted, but
            it cannot force them off. Automatic gain control in particular destroys level measurement.
            Check the diagnostics screen.
          </Limitation>
          <Limitation title="The digital weighting filters are not perfect">
            A and C weighting are implemented as real IIR filters whose high-frequency pole placement is
            numerically optimised for the active sample rate. The worst deviation from the exact analog
            response is under 0.4 dB up to {WEIGHTING_FIT_UPPER_HZ / 1000} kHz and grows above that, to
            roughly 4 dB at 16 kHz at 48 kHz sample rate. This is a fundamental consequence of the
            bilinear transform at these sample rates, it is measured by the automated test suite, and
            the accurate range is reported on the diagnostics screen.
          </Limitation>
          <Limitation title="Bands near the Nyquist frequency cannot be measured">
            A band is only measured when its upper edge stays below{' '}
            {(BAND_USABLE_NYQUIST_FRACTION * 100).toFixed(0)} % of the sample rate. At 48 kHz that
            excludes the 20 kHz one-third-octave band, which is shown hatched rather than as a low
            level.
          </Limitation>
          <Limitation title="A photograph documents the position, not the sound field">
            A picture of where the phone was standing is far better than a written note, and it is
            still only geometry. It does not record the reflections, the other sources running at
            the time or the orientation of the microphone port to the nearest surface, all of which
            move the measured level by decibels.
          </Limitation>
          <Limitation title="Calibration is not classification">
            Calibrating against a reference improves accuracy at the levels and frequencies you
            checked. It does not make the device a classified instrument, does not establish
            directional response, and does not establish behaviour outside the conditions you tested.
          </Limitation>
          <Limitation title="Spatial variation limits any comparison">
            Two microphones at different points in a real sound field measure different things.
            Reflections create a level pattern varying by several decibels over a wavelength. This is
            usually the dominant error in a phone-versus-reference comparison, not the phone.
          </Limitation>
          <Limitation title="The browser can stop the measurement">
            Locking the screen or backgrounding the tab suspends the audio engine on Android. When that
            happens no samples are integrated, so the elapsed time stops rather than filling with
            silence, and the status bar says so. Keeping the screen awake is enabled by default.
          </Limitation>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="How the numbers are produced" />
        <KeyValue
          entries={[
            [
              'Level reference',
              'dBFS = 20\u00b7log10(rms) of the normalised sample stream, so a full-scale sine reads -3.01 dBFS',
            ],
            ['SPL conversion', 'SPL = slope \u00d7 dBFS + intercept, from the active calibration only'],
            ['Frequency weighting', 'Real IIR filters on the sample stream, normalised to 0 dB at 1 kHz'],
            ['Time weighting', 'First-order exponential average of the squared signal (125 ms / 1 s)'],
            ['Impulse weighting', '35 ms rise with the decay limited to 2.9 dB/s'],
            ['Leq', 'Energy average; decibel values are never averaged arithmetically'],
            ['Band levels', 'Order-6 Butterworth band-pass per band at the full sample rate'],
            ['Octave bands', 'Energy sum of the three constituent one-third-octave bands'],
            ['Band definitions', 'IEC 61260 base-ten system, G = 10^(3/10)'],
            [
              'Statistics',
              `Fast time-weighted level sampled ${STATISTICS_SAMPLE_RATE_HZ} times per second into 0.1 dB bins`,
            ],
            ['Exceedance level', 'Ln = the level exceeded n % of the measurement time'],
            [
              'Warm-up',
              `${WARM_UP_SECONDS} s at the start of acquisition during which filters settle and nothing is integrated`,
            ],
            [
              'Clipping',
              `A run of 3 or more samples at or above ${CLIP_THRESHOLD} of full scale; near-overload above ${NEAR_OVERLOAD_DB} dBFS peak`,
            ],
          ]}
        />
      </Panel>

      <Panel>
        <PanelHeader title="This installation" />
        <KeyValue
          entries={[
            ['Sample rate', status.sampleRate ? `${status.sampleRate} Hz` : 'not started'],
            [
              'Weighting accurate to',
              status.weightingAccurateUpToHz
                ? `${(status.weightingAccurateUpToHz / 1000).toFixed(1)} kHz`
                : 'not started',
            ],
            [
              'A weighting worst fit error',
              status.aWeightingMaxFitErrorDb !== null
                ? `${status.aWeightingMaxFitErrorDb.toFixed(3)} dB`
                : 'not started',
            ],
          ]}
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <Link href="/diagnostics">
            <Button size="sm" variant="accent">
              Input diagnostics
            </Button>
          </Link>
          <Link href="/dev/dsp">
            <Button size="sm" variant="ghost">
              DSP developer lab
            </Button>
          </Link>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Design references" />
        <p className="text-xs leading-relaxed text-muted">
          The filter designs and measurement definitions follow the concepts described in IEC 61672-1
          (sound level meters), IEC 61260-1 (octave and fractional-octave filters) and ISO 266
          (preferred frequencies). The exposure indicators follow the criterion level, exchange rate
          and threshold conventions published by NIOSH and OSHA, and every assumption is stated on the
          exposure screen. Referring to a standard is not a claim of compliance with it.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge tone="neutral">IEC 61672-1 concepts</Badge>
          <Badge tone="neutral">IEC 61260-1 band definitions</Badge>
          <Badge tone="neutral">ISO 266 preferred frequencies</Badge>
          <Badge tone="warn">No compliance claimed</Badge>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Credits" />
        <KeyValue
          entries={[
            ['Application', APP_NAME],
            ['Built by', AUTHOR_NAME],
            [
              'Contact',
              <a
                key="contact"
                href={`mailto:${AUTHOR_EMAIL}`}
                className="underline underline-offset-2"
              >
                {AUTHOR_EMAIL}
              </a>,
            ],
            ['Licence', 'MIT'],
          ]}
        />
        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          {APP_NAME} was designed and built by {AUTHOR_NAME}. Questions, measurement comparisons and
          bug reports are welcome at {AUTHOR_EMAIL}.
        </p>
      </Panel>
    </div>
  );
}

function Limitation({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-l-2 border-line pl-3">
      <p className="text-xs font-semibold text-ink">{title}</p>
      <p className="mt-0.5">{children}</p>
    </div>
  );
}

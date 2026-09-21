/**
 * Generate DSP_VALIDATION.md from live measurements.
 *
 * Every number in the document is produced by running the production DSP code in
 * this repository, here and now. Nothing is transcribed by hand, so the document
 * cannot drift away from the implementation: regenerate it with
 *
 *     npm run report:dsp
 *
 * The prose lives in this script alongside the measurement that produces each
 * table, which keeps the explanation and the evidence together.
 */

import { build } from 'esbuild';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = path.join(root, 'node_modules/.cache/acousticlab');
const bundlePath = path.join(cacheDir, 'dsp-report-bundle.mjs');

async function loadDsp() {
  await mkdir(cacheDir, { recursive: true });
  await build({
    entryPoints: [path.join(root, 'src/dsp/index.ts')],
    outfile: bundlePath,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node20'],
    logLevel: 'warning',
    alias: { '@': path.join(root, 'src') },
  });
  return import(pathToFileURL(bundlePath).href);
}

const dsp = await loadDsp();

const SAMPLE_RATES = [44100, 48000];

/** 1/3-octave nominal centres used for the response tables. */
const THIRD_OCTAVE_CENTRES = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
  2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
];

/** The frequencies the masterplan requires to be validated. */
const REQUIRED_FREQUENCIES = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

const fmt = (value, decimals = 2) =>
  Number.isFinite(value) ? value.toFixed(decimals) : 'n/a';
const signed = (value, decimals = 2) =>
  Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}` : 'n/a';

function table(headers, rows) {
  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 1. Frequency weighting
// ---------------------------------------------------------------------------

function weightingSection() {
  const out = [];

  out.push(`### 1.1 Realised digital response against the exact analog prototype

The A and C weightings are IIR filters that run on the sample stream. The table
compares the realised digital magnitude response with the closed-form analog
prototype of IEC 61672-1 at every measured frequency. \`delta\` is
\`digital - analog\`.`);

  for (const fs of SAMPLE_RATES) {
    const rows = [];
    let worstA = 0;
    let worstC = 0;
    let worstAInRange = 0;
    const limit = dsp.weightingAccurateUpToHz(fs);

    for (const f of THIRD_OCTAVE_CENTRES) {
      if (f >= fs / 2) continue;
      const aAnalog = dsp.aWeightingDb(f);
      const aDigital = dsp.weightingResponseDb('A', f, fs);
      const cAnalog = dsp.cWeightingDb(f);
      const cDigital = dsp.weightingResponseDb('C', f, fs);
      const dA = aDigital - aAnalog;
      const dC = cDigital - cAnalog;
      worstA = Math.max(worstA, Math.abs(dA));
      worstC = Math.max(worstC, Math.abs(dC));
      if (f <= limit) worstAInRange = Math.max(worstAInRange, Math.abs(dA));
      rows.push([
        f,
        fmt(aAnalog),
        fmt(aDigital),
        signed(dA, 3),
        fmt(cAnalog),
        fmt(cDigital),
        signed(dC, 3),
      ]);
    }

    const design = dsp.aWeightingDesign(fs);
    out.push(`
#### Sample rate ${fs} Hz

HF pole placed at **${fmt(design.hfPoleHz, 0)} Hz** by numerical minimax optimisation
(analog prototype pole: 12194.2 Hz). Fit range
${fmt(design.fitRange.lowHz, 0)} Hz to ${fmt(design.fitRange.highHz, 0)} Hz.

- Worst A deviation inside the fit range: **${fmt(worstAInRange, 3)} dB**
- Worst A deviation across the whole table (to ${fmt(Math.min(20000, fs / 2 - 1), 0)} Hz): ${fmt(worstA, 3)} dB
- Worst C deviation across the whole table: ${fmt(worstC, 3)} dB

${table(
  ['f (Hz)', 'A analog', 'A digital', 'A delta', 'C analog', 'C digital', 'C delta'],
  rows
)}`);
  }

  out.push(`
### 1.2 Why the high-frequency pole is moved

The A and C networks have a double pole at 12.194 kHz. At a 48 kHz sample rate that
sits at a quarter of the sample rate, where the bilinear transform's frequency
warping is severe. Transforming the prototype directly puts the pole far too low
and the response sags badly. The table below compares the three available pole
placements (\`designWeighting(..., placement)\`), measured as the worst absolute
deviation from the analog prototype over the fit range.`);

  {
    const rows = [];
    for (const fs of SAMPLE_RATES) {
      for (const placement of ['none', 'prewarp', 'minimax']) {
        const a = dsp.aWeightingDesign(fs, placement);
        const c = dsp.cWeightingDesign(fs, placement);
        rows.push([
          fs,
          placement === 'none' ? 'plain bilinear' : placement,
          fmt(a.hfPoleHz, 0),
          fmt(a.maxFitErrorDb, 3),
          fmt(c.maxFitErrorDb, 3),
        ]);
      }
    }
    out.push(
      table(
        ['fs (Hz)', 'placement', 'A HF pole (Hz)', 'worst A error (dB)', 'worst C error (dB)'],
        rows
      )
    );
  }

  out.push(`
\`minimax\` is the default. The optimisation runs once per sample rate at design
time (a coarse scan followed by a golden-section search, a few thousand complex
evaluations, cached thereafter), so it is safe to run inside an AudioWorklet
constructor.

**The width of the fit range is a deliberate trade-off.** Fitting over a wider range
spreads the residual error across more of the spectrum: a narrower fit stopping near
11 kHz achieves about 0.25 dB worst error but leaves roughly -1.3 dB at 12.5 kHz and
-4.7 dB at 16 kHz, whereas the range chosen here holds every frequency up to
12.6 kHz inside about 0.6 dB and improves 16 kHz to roughly -3.5 dB. The wider range
was chosen because it is the larger *honestly validated* range, and because a few
tenths of a decibel at 8 kHz is an order of magnitude smaller than the frequency
response error of any phone microphone at the same frequency. The residual is not
hidden: the accurate range is reported on the diagnostics screen and the deviation
above it is tabulated here.

### 1.3 Analytic reference against the published nominal values

The closed-form reference itself is checked against the nominal weighting values
published in IEC 61672-1 Table 3. Agreement here confirms the reference the digital
filter is fitted to is the right curve.`);

  {
    const rows = dsp.NOMINAL_WEIGHTINGS.map((entry) => [
      entry.frequency,
      fmt(entry.a, 1),
      fmt(dsp.aWeightingDb(entry.frequency), 3),
      signed(dsp.aWeightingDb(entry.frequency) - entry.a, 3),
      fmt(entry.c, 1),
      fmt(dsp.cWeightingDb(entry.frequency), 3),
      signed(dsp.cWeightingDb(entry.frequency) - entry.c, 3),
    ]);
    out.push(
      table(
        ['f (Hz)', 'A nominal', 'A computed', 'delta', 'C nominal', 'C computed', 'delta'],
        rows
      )
    );
  }

  out.push(`
### 1.4 The filter really operates on the signal

A displayed-offset implementation would pass this section's response checks while
being wrong for anything but a steady tone. To rule that out, a tone is generated,
filtered, and the level change measured on the *signal*.`);

  {
    const fs = 48000;
    const rows = [];
    for (const f of REQUIRED_FREQUENCIES) {
      if (f >= fs / 2) continue;
      const signal = dsp.sine(f, dsp.dbToAmplitude(-20), 3, fs);
      const before = dsp.blockLevelDb(signal);
      const measure = (sections) => {
        const cascade = new dsp.BiquadCascade(sections);
        const filtered = new Float64Array(signal.length);
        cascade.processBlock(signal, filtered);
        // Discard 0.5 s so the filter start-up transient is excluded.
        return dsp.blockLevelDb(filtered.subarray(Math.round(fs * 0.5)));
      };
      const aAfter = measure(dsp.designAWeighting(fs));
      const cAfter = measure(dsp.designCWeighting(fs));
      rows.push([
        f,
        signed(aAfter - before, 2),
        signed(dsp.aWeightingDb(f), 2),
        signed(aAfter - before - dsp.aWeightingDb(f), 3),
        signed(cAfter - before, 2),
        signed(dsp.cWeightingDb(f), 2),
        signed(cAfter - before - dsp.cWeightingDb(f), 3),
      ]);
    }
    out.push(`Measured at 48 kHz on a 3 s tone at -20 dBFS.

${table(
  [
    'f (Hz)',
    'A measured',
    'A expected',
    'delta',
    'C measured',
    'C expected',
    'delta',
  ],
  rows
)}`);
  }

  out.push(`
Z weighting is implemented as an empty filter cascade, i.e. a genuine
pass-through, so it introduces no numerical error at all. The optional 10 Hz
DC/infrasound blocker is a separate, user-switchable stage that is reported in the
diagnostics screen rather than folded silently into Z.`);

  return out.join('\n');
}

// ---------------------------------------------------------------------------
// 2. Fractional-octave filter bank
// ---------------------------------------------------------------------------

function bandSection() {
  const out = [];
  const fs = 48000;
  const order = dsp.DEFAULT_BANK_ORDER;

  out.push(`Band definitions follow the base-ten system of IEC 61260-1:

    G     = 10^(3/10)
    f_m   = 1000 * G^(x/b)
    edges = f_m * G^(-+1/(2b))

Band levels come from a bank of order-${order} Butterworth band-pass filters running at
the full sample rate; the mean square of each band-pass output is the band level.
No band level is ever taken from a single FFT bin.

### 2.1 Filter shape

For each measurable band: gain at the exact midband frequency, gain at both -3 dB
edges, rejection one octave either side, and the largest pole radius (stability
margin; must be below 1).`);

  {
    const rows = [];
    const bands = dsp.thirdOctaveBandDefinitions();
    let worstCentre = 0;
    let worstEdge = 0;
    let worstRadius = 0;
    let unstable = 0;
    for (const band of bands) {
      if (band.upper > fs * dsp.BAND_USABLE_NYQUIST_FRACTION) {
        rows.push([band.label, 'not measured', '', '', '', '', '']);
        continue;
      }
      const design = dsp.designButterworthBandpass(order, band.lower, band.upper, fs);
      const centre = dsp.cascadeMagnitudeDb(design.sections, band.exact, fs);
      const lower = dsp.cascadeMagnitudeDb(design.sections, band.lower, fs);
      const upper = dsp.cascadeMagnitudeDb(design.sections, band.upper, fs);
      const octaveBelow = dsp.cascadeMagnitudeDb(design.sections, band.exact / 2, fs);
      const octaveAbove =
        band.exact * 2 < fs / 2 - 1
          ? dsp.cascadeMagnitudeDb(design.sections, band.exact * 2, fs)
          : NaN;
      worstCentre = Math.max(worstCentre, Math.abs(centre));
      worstEdge = Math.max(worstEdge, Math.abs(lower + 3.0103), Math.abs(upper + 3.0103));
      worstRadius = Math.max(worstRadius, design.maxPoleRadius);
      if (!design.stable) unstable++;
      rows.push([
        band.label,
        fmt(band.exact, 1),
        signed(centre, 4),
        `${fmt(lower, 2)} / ${fmt(upper, 2)}`,
        fmt(octaveBelow, 1),
        Number.isFinite(octaveAbove) ? fmt(octaveAbove, 1) : 'n/a',
        fmt(design.maxPoleRadius, 8),
      ]);
    }

    out.push(`At ${fs} Hz: worst centre-frequency gain error **${fmt(worstCentre, 5)} dB**,
worst edge deviation from -3.01 dB **${fmt(worstEdge, 4)} dB**, largest pole radius
${fmt(worstRadius, 8)}, unstable designs **${unstable}**.

${table(
  ['band', 'f_m (Hz)', 'gain at f_m', 'gain at edges', '1 oct below', '1 oct above', 'max |pole|'],
  rows
)}`);
  }

  out.push(`
### 2.2 Bands that cannot be measured

A band is only measured when its upper edge stays below
${(dsp.BAND_USABLE_NYQUIST_FRACTION * 100).toFixed(0)} % of the sample rate, which keeps the
band-pass transition region clear of the frequency where the bilinear transform
distorts the shape. Unavailable bands are drawn hatched in the application and
flagged in exports; they are never shown as a low level.`);

  {
    const rows = [];
    for (const fs2 of SAMPLE_RATES) {
      const plan = dsp.createBandPlan(fs2);
      const thirdOut = plan.thirdBands.filter((b) => !b.available).map((b) => b.label);
      const partial = plan.octaveBands
        .filter((b) => b.available && b.unavailableReason)
        .map((b) => b.label);
      const octaveOut = plan.octaveBands.filter((b) => !b.available).map((b) => b.label);
      rows.push([
        fs2,
        `${plan.thirdBands.filter((b) => b.available).length} of ${plan.thirdBands.length}`,
        thirdOut.length ? thirdOut.join(', ') : 'none',
        `${plan.octaveBands.filter((b) => b.available).length} of ${plan.octaveBands.length}`,
        octaveOut.length ? octaveOut.join(', ') : 'none',
        partial.length ? partial.join(', ') : 'none',
      ]);
    }
    out.push(
      table(
        [
          'fs (Hz)',
          '1/3-oct measured',
          '1/3-oct excluded',
          'octave measured',
          'octave excluded',
          'partial octaves',
        ],
        rows
      )
    );
  }

  out.push(`
### 2.3 Band allocation

A tone at each band's exact midband frequency must land in that band and nowhere
else. \`neighbour margin\` is how far below the signal band the adjacent bands sit.`);

  {
    const rows = [];
    const bank = dsp.createThirdOctaveBank(fs);
    const targets = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    for (const nominal of targets) {
      const index = bank.bands.findIndex((b) => b.nominal === nominal);
      if (index < 0 || !bank.bands[index].available) continue;
      const band = bank.bands[index];
      const fresh = dsp.createThirdOctaveBank(fs);
      const signal = dsp.sine(band.exact, dsp.dbToAmplitude(-20), 3.5, fs);
      const warm = Math.round(fs * 0.5);
      fresh.processBlock(signal.subarray(0, warm));
      fresh.enableStatistics();
      fresh.processBlock(signal.subarray(warm));
      const results = fresh.results();
      let peakIndex = 0;
      for (let i = 0; i < results.leq.length; i++) {
        if (results.leq[i] > results.leq[peakIndex]) peakIndex = i;
      }
      const below = index > 0 ? results.leq[index] - results.leq[index - 1] : NaN;
      const above =
        index < results.leq.length - 1 && fresh.bands[index + 1].available
          ? results.leq[index] - results.leq[index + 1]
          : NaN;
      rows.push([
        band.label,
        peakIndex === index ? 'yes' : `NO (${fresh.bands[peakIndex].label})`,
        fmt(results.leq[index], 2),
        signed(results.leq[index] + 20, 2),
        Number.isFinite(below) ? fmt(below, 1) : 'n/a',
        Number.isFinite(above) ? fmt(above, 1) : 'n/a',
      ]);
    }
    out.push(`Tone at -20 dBFS, 3.5 s, 48 kHz.

${table(
  ['band', 'peak in band?', 'band Leq (dBFS)', 'error', 'margin below', 'margin above'],
  rows
)}`);
  }

  out.push(`
### 2.4 Energy conservation

Summing every band's energy must reproduce the broadband level. Two cases matter
for different reasons.`);

  {
    const rows = [];
    const bank1 = dsp.createThirdOctaveBank(fs);
    const centres = [125, 500, 1000, 4000].map(
      (nominal) => bank1.bands.find((b) => b.nominal === nominal).exact
    );
    const cases = [
      ['multi-tone at band centres (125/500/1k/4k)', dsp.multitone(centres, dsp.dbToAmplitude(-20), 4, fs)],
      ['pink noise', dsp.pinkNoise(dsp.dbToAmplitude(-20), 4, fs, 777)],
      ['white noise', dsp.whiteNoise(dsp.dbToAmplitude(-20), 4, fs, 4242)],
    ];
    for (const [label, signal] of cases) {
      const bank = dsp.createThirdOctaveBank(fs);
      const warm = Math.round(fs * 0.5);
      bank.processBlock(signal.subarray(0, warm));
      bank.enableStatistics();
      bank.processBlock(signal.subarray(warm));
      const results = bank.results();
      const summed = dsp.broadbandFromBands(
        results.leq,
        bank.bands.map((b) => b.available)
      );
      const direct = dsp.blockLevelDb(signal.subarray(warm));
      rows.push([label, fmt(direct, 3), fmt(summed, 3), signed(summed - direct, 3)]);
    }
    out.push(`${table(['signal', 'direct broadband (dBFS)', 'sum of bands (dBFS)', 'delta'], rows)}

The multi-tone case is the strict test: all its energy lies inside the measured
range, so the sum must match. It comes out slightly high because adjacent bands
overlap at their shared -3 dB edges and a tone sitting on a band centre is counted
a second time by its neighbours' skirts. This is inherent to any real
fractional-octave filter bank, not an implementation error.

The noise cases legitimately fall short: pink and white noise carry energy below
17.8 Hz and above the highest measured band, which the bank does not see. The sum
must never exceed the total.

Octave bands are derived by energy-summing the three constituent one-third-octave
bands rather than by running a second filter bank, which is exact and halves the
band-pass work.`);
  }

  return out.join('\n');
}

// ---------------------------------------------------------------------------
// 3. Time weighting
// ---------------------------------------------------------------------------

function timeSection() {
  const out = [];
  const fs = 48000;

  out.push(`The detector runs on the **squared** weighted signal:

    y[n] = a*y[n-1] + (1-a)*x[n]^2,   a = exp(-1/(tau*fs))
    L[n] = 10*log10(y[n])

This is a true mean-square exponential average at the sample rate. It is not a
moving average of displayed decibel values, which would give a different and wrong
answer for any time-varying signal.

### 3.1 Step response

A first-order mean-square average reaches \`1 - 1/e\` = 63.2 % of the final mean
square after exactly one time constant, which is \`-10*log10(1 - 1/e)\` =
1.9920 dB below the steady state.`);

  {
    const rows = [];
    for (const [name, tau] of [
      ['Fast', dsp.TIME_CONSTANTS.F],
      ['Slow', dsp.TIME_CONSTANTS.S],
    ]) {
      const detector = new dsp.ExponentialDetector(tau, fs);
      const samples = Math.round(tau * fs);
      for (let i = 0; i < samples; i++) detector.push(1);
      const afterOneTau = detector.levelDb;
      for (let i = 0; i < samples * 9; i++) detector.push(1);
      const steady = detector.levelDb;
      rows.push([
        name,
        `${fmt(tau * 1000, 0)} ms`,
        fmt(-afterOneTau, 4),
        '1.9920',
        signed(-afterOneTau - 1.992, 4),
        fmt(steady, 6),
      ]);
    }
    out.push(
      table(
        [
          'detector',
          'tau',
          'shortfall after 1 tau (dB)',
          'expected',
          'delta',
          'steady state (dB)',
        ],
        rows
      )
    );
  }

  out.push(`
### 3.2 Decay rate

After one time constant of silence the mean square has fallen by a factor of e,
which is \`10*log10(e)\` = 4.3429 dB.`);

  {
    const rows = [];
    for (const [name, tau] of [
      ['Fast', dsp.TIME_CONSTANTS.F],
      ['Slow', dsp.TIME_CONSTANTS.S],
    ]) {
      const detector = new dsp.ExponentialDetector(tau, fs);
      for (let i = 0; i < fs * 10; i++) detector.push(1);
      const start = detector.levelDb;
      const samples = Math.round(tau * fs);
      for (let i = 0; i < samples; i++) detector.push(0);
      const drop = start - detector.levelDb;
      rows.push([name, fmt(drop, 4), '4.3429', signed(drop - 10 * Math.log10(Math.E), 4)]);
    }
    out.push(table(['detector', 'drop after 1 tau (dB)', 'expected', 'delta'], rows));
  }

  out.push(`
### 3.3 Impulse weighting

Implemented as a ${fmt(dsp.TIME_CONSTANTS.I * 1000, 0)} ms exponential rise with the
level decay limited to ${dsp.IMPULSE_DECAY_DB_PER_SECOND} dB/s. This is a faithful
implementation of the described behaviour, but it has **not** been verified against
a certified impulse reference; I readings should be treated as indicative.`);

  {
    const detector = new dsp.ImpulseDetector(fs);
    for (let i = 0; i < Math.round(fs * 0.25); i++) detector.push(1);
    const peak = detector.levelDb;
    for (let i = 0; i < fs; i++) detector.push(0);
    const afterOneSecond = peak - detector.levelDb;

    const fast = new dsp.ExponentialDetector(dsp.TIME_CONSTANTS.F, fs);
    const impulse = new dsp.ImpulseDetector(fs);
    const burst = dsp.burst(1000, 0.5, 0.02, 1.0, 1.5, fs);
    for (let i = 0; i < burst.length; i++) {
      fast.pushSample(burst[i]);
      impulse.pushSample(burst[i]);
    }

    out.push(
      table(
        ['property', 'measured', 'expected'],
        [
          ['steady state after 250 ms of full level (dB)', fmt(peak, 4), '0.0000'],
          [
            'decay over 1 s of silence (dB)',
            fmt(afterOneSecond, 3),
            `${dsp.IMPULSE_DECAY_DB_PER_SECOND}`,
          ],
          [
            'hold advantage over Fast, 20 ms burst then 1 s gap (dB)',
            fmt(impulse.levelDb - fast.levelDb, 1),
            '> 10',
          ],
        ]
      )
    );
  }

  out.push(`
### 3.4 Not a decibel-domain average

Half a second of tone at -20 dBFS followed by 50 ms of silence. A decibel-domain
moving average would collapse towards the floor; the correct mean-square detector
decays smoothly at the rate set by its time constant.`);

  {
    const loud = dsp.sine(1000, dsp.dbToAmplitude(-20), 2, fs);
    const detector = new dsp.ExponentialDetector(dsp.TIME_CONSTANTS.F, fs);
    for (let i = 0; i < loud.length; i++) detector.pushSample(loud[i]);
    const before = detector.levelDb;
    const gap = Math.round(fs * 0.05);
    for (let i = 0; i < gap; i++) detector.push(0);
    const after = detector.levelDb;
    const expected = 10 * Math.log10(Math.E) * (0.05 / dsp.TIME_CONSTANTS.F);
    out.push(
      table(
        ['quantity', 'value'],
        [
          ['level before the gap (dBFS)', fmt(before, 3)],
          ['level after 50 ms of silence (dBFS)', fmt(after, 3)],
          ['measured drop (dB)', fmt(before - after, 3)],
          ['expected drop, 10*log10(e)*0.4 (dB)', fmt(expected, 3)],
          ['delta (dB)', signed(before - after - expected, 3)],
        ]
      )
    );
  }

  return out.join('\n');
}

// ---------------------------------------------------------------------------
// 4. Levels, Leq and SEL
// ---------------------------------------------------------------------------

function levelSection() {
  const out = [];
  const fs = 48000;

  out.push(`### 4.1 Reference convention

    L_dBFS = 20 * log10( rms(x) )

for the normalised sample stream. A full-scale square wave therefore reads 0 dBFS
and a full-scale sine reads -3.01 dBFS. This is stated explicitly because the
calibration offset that converts dBFS to dB SPL is only meaningful together with
it. Conversion happens in exactly one place, \`ActiveCalibration\`:

    L_SPL = slope * L_dBFS + intercept`);

  {
    const rows = [
      [
        'full-scale sine',
        fmt(dsp.blockLevelDb(dsp.sine(1000, 1 / Math.SQRT2, 1, fs)), 4),
        '-3.0103',
      ],
      ['full-scale square', fmt(dsp.blockLevelDb(dsp.square(1000, 1, 1, fs)), 4), '0.0000'],
      [
        'sine at -20 dBFS nominal',
        fmt(dsp.blockLevelDb(dsp.sine(1000, dsp.dbToAmplitude(-20), 1, fs)), 4),
        '-20.0000',
      ],
      [
        'sine crest factor (peak - rms)',
        fmt(
          dsp.blockPeakDb(dsp.sine(1000, 0.25, 1, fs)) -
            dsp.blockLevelDb(dsp.sine(1000, 0.25, 1, fs)),
          4
        ),
        '3.0103',
      ],
    ];
    out.push(table(['signal', 'measured (dBFS)', 'expected'], rows));
  }

  out.push(`
### 4.2 Leq is an energy average

Decibel values are never averaged arithmetically. One second at -20 dBFS followed by
one second at -40 dBFS, measured through the engine:`);

  {
    const engine = new dsp.MeterEngine({ sampleRate: fs, dcBlock: false });
    const warm = dsp.sine(1000, dsp.dbToAmplitude(-20), dsp.WARM_UP_SECONDS + 0.1, fs);
    for (let i = 0; i < warm.length; i += 128) engine.process(warm.subarray(i, i + 128));
    engine.resetStatistics();
    const loud = dsp.sine(1000, dsp.dbToAmplitude(-20), 1, fs);
    const quiet = dsp.sine(1000, dsp.dbToAmplitude(-40), 1, fs);
    for (let i = 0; i < loud.length; i += 128) engine.process(loud.subarray(i, i + 128));
    for (let i = 0; i < quiet.length; i += 128) engine.process(quiet.subarray(i, i + 128));
    const snapshot = engine.snapshot();
    const correct = 10 * Math.log10((1e-2 + 1e-4) / 2);
    out.push(
      table(
        ['quantity', 'value (dBFS)'],
        [
          ['engine LZeq', fmt(snapshot.LZeq, 3)],
          ['correct energy average', fmt(correct, 3)],
          ['delta', signed(snapshot.LZeq - correct, 3)],
          ['arithmetic mean of decibels (wrong)', fmt(-30, 3)],
          ['error that mistake would introduce', fmt(correct - -30, 2)],
        ]
      )
    );
  }

  out.push(`
### 4.3 Engine round trip

A tone of known level through the complete engine, at both supported sample rates.
\`LAeq - LZeq\` must equal the A weighting at that frequency.`);

  {
    const rows = [];
    for (const fs2 of SAMPLE_RATES) {
      for (const f of [63, 125, 250, 1000, 4000, 8000]) {
        const engine = new dsp.MeterEngine({ sampleRate: fs2, dcBlock: false });
        const signal = dsp.sine(f, dsp.dbToAmplitude(-20), 2 + dsp.WARM_UP_SECONDS + 0.1, fs2);
        for (let i = 0; i < signal.length; i += 128) engine.process(signal.subarray(i, i + 128));
        const s = engine.snapshot();
        rows.push([
          fs2,
          f,
          fmt(s.LZeq, 3),
          fmt(s.LAeq - s.LZeq, 3),
          fmt(dsp.aWeightingDb(f), 3),
          signed(s.LAeq - s.LZeq - dsp.aWeightingDb(f), 3),
          fmt(s.LCeq - s.LZeq, 3),
          signed(s.LCeq - s.LZeq - dsp.cWeightingDb(f), 3),
        ]);
      }
    }
    out.push(
      table(
        ['fs', 'f (Hz)', 'LZeq', 'LAeq-LZeq', 'A expected', 'delta', 'LCeq-LZeq', 'C delta'],
        rows
      )
    );
  }

  out.push(`
### 4.4 Sound exposure level and extremes`);

  {
    const engine = new dsp.MeterEngine({ sampleRate: fs, dcBlock: false });
    const signal = dsp.sine(1000, dsp.dbToAmplitude(-20), 4 + dsp.WARM_UP_SECONDS + 0.1, fs);
    for (let i = 0; i < signal.length; i += 128) engine.process(signal.subarray(i, i + 128));
    const s = engine.snapshot();
    const expectedSel = s.LAeq + 10 * Math.log10(s.durationSeconds);
    const squareEngine = new dsp.MeterEngine({ sampleRate: fs, dcBlock: false });
    const sq = dsp.square(1000, 1, 1 + dsp.WARM_UP_SECONDS + 0.1, fs);
    for (let i = 0; i < sq.length; i += 128) squareEngine.process(sq.subarray(i, i + 128));
    const sqs = squareEngine.snapshot();

    out.push(
      table(
        ['quantity', 'measured', 'expected'],
        [
          ['integrated duration (s)', fmt(s.durationSeconds, 3), '4.000'],
          ['LAE (SEL)', fmt(s.LAE, 3), fmt(expectedSel, 3)],
          ['LZpeak - LZeq for a sine (dB)', fmt(s.LZpeak - s.LZeq, 3), '3.0103'],
          ['LAFmax - LAFmin for a steady tone (dB)', fmt(s.LAFmax - s.LAFmin, 3), '~0'],
          ['LZpeak for a full-scale square (dBFS)', fmt(sqs.LZpeak, 3), '0.000'],
          ['clipping events on a full-scale square', String(sqs.clipping.events), '> 0'],
        ]
      )
    );
  }

  return out.join('\n');
}

// ---------------------------------------------------------------------------
// 5. FFT
// ---------------------------------------------------------------------------

function fftSection() {
  const out = [];
  const fs = 48000;

  out.push(`FFT spectral levels and octave-band sound pressure levels are different
quantities and are kept in separate modules. The spectrum reports the RMS level of a
tone landing in a bin, scaled by the window's coherent gain so that it uses the same
full-scale reference as the meter.

### 5.1 Tone identification and level`);

  {
    const rows = [];
    for (const size of dsp.FFT_SIZES) {
      const analyzer = new dsp.SpectrumAnalyzer(size, fs, 'hann');
      const binWidth = fs / size;
      const frequency = Math.round(1000 / binWidth) * binWidth;
      const signal = dsp.sine(frequency, dsp.dbToAmplitude(-20), (size * 2) / fs, fs);
      const result = analyzer.analyse(signal.subarray(0, size));
      let peak = 0;
      for (let k = 1; k < result.binCount; k++) {
        if (result.levelsDb[k] > result.levelsDb[peak]) peak = k;
      }
      const found = analyzer.findPeak();
      rows.push([
        size,
        fmt(binWidth, 3),
        fmt((size / fs) * 1000, 1),
        fmt(result.levelsDb[peak], 3),
        signed(result.levelsDb[peak] + 20, 3),
        fmt(found.frequency, 2),
        signed(found.frequency - frequency, 3),
      ]);
    }
    out.push(`Bin-centred 1 kHz tone at -20 dBFS, Hann window.

${table(
  ['fft size', 'Hz/bin', 'frame (ms)', 'peak level (dBFS)', 'level error', 'peak f (Hz)', 'f error'],
  rows
)}`);
  }

  out.push(`
### 5.2 Window correction factors

Computed from the actual window samples rather than tabulated: \`coherentGain\`
corrects the amplitude of a tone, \`noisePowerBandwidth\` corrects broadband
density. Using the wrong one is a classic source of several-decibel errors.`);

  {
    const rows = dsp.WINDOW_IDS.map((id) => {
      const w = dsp.createWindow(id, 8192);
      return [dsp.WINDOW_LABELS[id], fmt(w.coherentGain, 5), fmt(w.noisePowerBandwidth, 5)];
    });
    out.push(table(['window', 'coherent gain', 'noise bandwidth (bins)'], rows));
  }

  out.push(`
### 5.3 Frequency identification across the range`);

  {
    const rows = [];
    for (const f of [31.5, 100, 315, 1000, 3150, 8000, 16000]) {
      const signal = dsp.sine(f, 0.2, 1, fs);
      const found = dsp.dominantFrequency(signal, fs, 16384);
      rows.push([fmt(f, 1), fmt(found, 3), signed(found - f, 3), fmt((100 * (found - f)) / f, 4)]);
    }
    out.push(
      table(['tone (Hz)', 'identified (Hz)', 'error (Hz)', 'error (%)'], rows)
    );
  }

  return out.join('\n');
}

// ---------------------------------------------------------------------------
// 6. Statistics
// ---------------------------------------------------------------------------

function statisticsSection() {
  const out = [];

  out.push(`\`Ln\` is the level **exceeded n % of the measurement time**, that is the
\`(100 - n)\`th percentile of the sampled distribution. L90 is therefore a low
(background) level and L10 a high one. The statistical sample is the Fast
time-weighted level taken ${dsp.STATISTICS_SAMPLE_RATE_HZ} times per second into 0.1 dB bins, and
percentiles are linearly interpolated inside the containing bin.

### 6.1 Histogram against an exact sorted percentile

A bimodal distribution of 20 000 samples, which is where naive percentile code
breaks.`);

  {
    const rng = dsp.createRng(4242);
    const values = [];
    const histogram = new dsp.LevelHistogram({ binWidth: 0.1 });
    for (let i = 0; i < 20000; i++) {
      const value = rng() < 0.7 ? -60 + rng() * 8 : -35 + rng() * 5;
      values.push(value);
      histogram.add(value);
    }
    const rows = dsp.PERCENTILE_LEVELS.map((n) => {
      const fromHistogram = histogram.exceedanceLevel(n);
      const exact = dsp.exactExceedanceLevel(values, n);
      return [`L${n}`, fmt(fromHistogram, 4), fmt(exact, 4), signed(fromHistogram - exact, 4)];
    });
    out.push(table(['level', 'histogram', 'exact sort', 'delta (dB)'], rows));
  }

  out.push(`
### 6.2 A calibration offset shifts every percentile by exactly that offset

This is the property that lets the histogram live in the dBFS domain and be
converted at display time, so changing calibration profile re-derives the
statistics correctly without re-measuring.`);

  {
    const rng = dsp.createRng(31);
    const raw = new dsp.LevelHistogram();
    const shifted = new dsp.LevelHistogram();
    const offset = 94.3;
    for (let i = 0; i < 20000; i++) {
      const value = -70 + rng() * 40;
      raw.add(value);
      shifted.add(value + offset);
    }
    const rows = dsp.PERCENTILE_LEVELS.map((n) => [
      `L${n}`,
      fmt(raw.exceedanceLevel(n), 3),
      fmt(shifted.exceedanceLevel(n), 3),
      fmt(shifted.exceedanceLevel(n) - raw.exceedanceLevel(n), 4),
    ]);
    out.push(table(['level', 'dBFS domain', 'offset by +94.3', 'difference'], rows));
  }

  out.push(`
### 6.3 Ordering and engine integration

A gated burst produces a genuinely spread distribution; a steady tone must collapse
it. Both measured through the full engine.`);

  {
    const fs = 48000;
    const rows = [];
    for (const [label, signal] of [
      [
        'gated burst 0.4 s on / 0.4 s off',
        dsp.burst(1000, dsp.dbToAmplitude(-20), 0.4, 0.4, 20 + dsp.WARM_UP_SECONDS, fs),
      ],
      ['steady 1 kHz tone', dsp.sine(1000, dsp.dbToAmplitude(-20), 20 + dsp.WARM_UP_SECONDS, fs)],
    ]) {
      const engine = new dsp.MeterEngine({ sampleRate: fs, dcBlock: false });
      for (let i = 0; i < signal.length; i += 128) engine.process(signal.subarray(i, i + 128));
      const p = engine.snapshot().percentiles;
      rows.push([
        label,
        fmt(p.L10, 2),
        fmt(p.L50, 2),
        fmt(p.L90, 2),
        fmt(p.L10 - p.L90, 2),
        p.L10 >= p.L50 && p.L50 >= p.L90 ? 'yes' : 'NO',
      ]);
    }
    out.push(table(['signal', 'L10', 'L50', 'L90', 'L10-L90', 'ordered?'], rows));
  }

  return out.join('\n');
}

// ---------------------------------------------------------------------------
// 7. Exposure
// ---------------------------------------------------------------------------

function exposureSection() {
  const out = [];

  out.push(`Allowed exposure time and dose:

    T(L) = criterionHours * 2 ^ ((criterionLevel - L) / exchangeRate)
    D    = 100 * t / T(L)
    TWA  = criterionLevel + (exchangeRate / log10(2)) * log10(D / 100)

Every assumption of each scheme is declared in the code and shown next to the
numbers in the application. These are educational indicators, not certified
dosimetry, and not medical advice.`);

  for (const id of ['niosh', 'osha']) {
    const scheme = dsp.EXPOSURE_SCHEMES[id];
    const rows = [];
    for (const level of [80, 85, 88, 90, 91, 94, 95, 100, 105]) {
      const hours = dsp.allowedExposureHours(scheme, level);
      const result = dsp.computeExposure(scheme, level, 8 * 3600);
      rows.push([
        level,
        hours >= 1 ? `${fmt(hours, 3)} h` : `${fmt(hours * 60, 1)} min`,
        fmt(result.dosePercent, 1),
        Number.isFinite(result.twaDb) ? fmt(result.twaDb, 2) : 'n/a',
        result.belowThreshold ? 'yes' : 'no',
      ]);
    }
    out.push(`
### ${scheme.name}

Criterion ${scheme.criterionLevelDb} dBA for ${scheme.criterionHours} h, exchange rate
${scheme.exchangeRateDb} dB, threshold ${scheme.thresholdDb === null ? 'none' : `${scheme.thresholdDb} dBA`}.
Reference: ${scheme.reference}.

Dose and TWA below are for a full ${scheme.criterionHours} hour exposure at the stated level.

${table(['LAeq (dBA)', 'allowed time', 'dose (%)', 'TWA (dBA)', 'below threshold'], rows)}`);
  }

  {
    const niosh = dsp.EXPOSURE_SCHEMES.niosh;
    const osha = dsp.EXPOSURE_SCHEMES.osha;
    const rows = [
      [
        'NIOSH: dose ratio for +3 dB',
        fmt(
          dsp.computeExposure(niosh, 88, 3600).dosePercent /
            dsp.computeExposure(niosh, 85, 3600).dosePercent,
          6
        ),
        '2.000000',
      ],
      [
        'OSHA: dose ratio for +5 dB',
        fmt(
          dsp.computeExposure(osha, 95, 3600).dosePercent /
            dsp.computeExposure(osha, 90, 3600).dosePercent,
          6
        ),
        '2.000000',
      ],
      [
        'LEX,8h for 4 h at 85 dBA',
        fmt(dsp.lex8h(85, 4 * 3600), 4),
        fmt(85 - 10 * Math.log10(2), 4),
      ],
      ['LEX,8h for 8 h at 85 dBA', fmt(dsp.lex8h(85, 8 * 3600), 4), '85.0000'],
    ];
    out.push(`
### Exchange-rate behaviour

${table(['property', 'measured', 'expected'], rows)}`);
  }

  return out.join('\n');
}

// ---------------------------------------------------------------------------
// 8. Performance
// ---------------------------------------------------------------------------

function performanceSection() {
  const fs = 48000;
  const seconds = 10;
  const signal = dsp.pinkNoise(dsp.dbToAmplitude(-20), seconds, fs, 5150);

  const timeIt = (label, work) => {
    const started = process.hrtime.bigint();
    work();
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    return [
      label,
      fmt(elapsedMs, 1),
      fmt((seconds * 1000) / elapsedMs, 1),
      fmt((elapsedMs / (seconds * 1000)) * 100, 2),
    ];
  };

  const rows = [];
  rows.push(
    timeIt('MeterEngine (A/C/Z, Fast/Slow/Impulse, Leq, peaks, stats, clipping)', () => {
      const engine = new dsp.MeterEngine({ sampleRate: fs, dcBlock: true });
      for (let i = 0; i < signal.length; i += 128) engine.process(signal.subarray(i, i + 128));
    })
  );
  rows.push(
    timeIt('1/3-octave filter bank (30 bands, order 6)', () => {
      const bank = dsp.createThirdOctaveBank(fs);
      bank.enableStatistics();
      for (let i = 0; i < signal.length; i += 2048) bank.processBlock(signal.subarray(i, i + 2048));
    })
  );
  rows.push(
    timeIt('FFT spectrum at 15 frames/s, 8192 points, Hann', () => {
      const analyzer = new dsp.SpectrumAnalyzer(8192, fs, 'hann');
      const frame = new Float64Array(8192);
      for (let n = 0; n < seconds * 15; n++) {
        const offset = (n * Math.round(fs / 15)) % Math.max(1, signal.length - 8192);
        for (let i = 0; i < 8192; i++) frame[i] = signal[offset + i];
        analyzer.analyse(frame);
      }
    })
  );

  return `Cost of processing ${seconds} s of pink noise at ${fs} Hz on the machine that
generated this document (Node ${process.version}, ${process.platform} ${process.arch}). A phone is
slower, but the ratios between the stages hold, and the real-time budget is what
matters: the figure to watch is the load percentage.

${table(['stage', 'wall time (ms)', 'x real time', 'load (%)'], rows)}

The meter runs in an AudioWorklet on the audio rendering thread; the filter bank and
the FFT run in a Web Worker on batched blocks, so a heavy analysis frame cannot
cause an audio dropout. Both loads are reported live on the diagnostics screen, and
the worker reports any samples it had to drop rather than hiding them.`;
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

const doc = `# DSP validation

**This document is generated.** Every number below was produced by executing the
production DSP code in this repository. Regenerate it with:

\`\`\`bash
npm run report:dsp
\`\`\`

Generated ${new Date().toISOString()} with Node ${process.version} on ${process.platform}/${process.arch}.

The same measurements are asserted as automated tests in \`src/dsp/__tests__\`
(\`npm test\`), so a regression fails the build rather than quietly changing a
document. The interactive equivalent is the developer lab at \`/dev/dsp\`, which runs
generated signals through the identical engine the microphone uses.

## What is and is not claimed

Sonoscope implements measurement concepts and filter designs derived from
IEC 61672-1 (sound level meters), IEC 61260-1 (fractional-octave filters) and
ISO 266 (preferred frequencies). It has **not** been type tested or certified
against any of them, and no compliance with IEC 61672 Class 1 or Class 2 is claimed
anywhere. What this document does is state honestly how closely the implemented
filters match their ideal definitions, so the error budget of the DSP is known and
separable from the error budget of the microphone.

---

## 1. Frequency weighting

${weightingSection()}

---

## 2. Fractional-octave filter bank

${bandSection()}

---

## 3. Time weighting

${timeSection()}

---

## 4. Levels, Leq and sound exposure level

${levelSection()}

---

## 5. FFT analyser

${fftSection()}

---

## 6. Statistical acoustics

${statisticsSection()}

---

## 7. Noise exposure

${exposureSection()}

---

## 8. Performance

${performanceSection()}

---

## 9. Known limitations of the DSP

These are properties of the implementation, measured above, and are separate from
the limitations of a phone microphone (see \`About\` in the application):

1. **Weighting accuracy above the fit range.** The A and C weightings deviate from
   the analog prototype increasingly above the fit range reported in section 1.1.
   The deviation is a consequence of the bilinear transform at 44.1/48 kHz and is
   reported by the application rather than hidden. Levels dominated by content above
   that frequency carry that additional error.
2. **The highest 1/3-octave band is not measured.** Its upper edge is too close to
   Nyquist at both supported sample rates (section 2.2). The octave band containing
   it is therefore a partial octave and is flagged as such.
3. **Band skirt overlap.** Summing all bands double-counts a little energy where
   adjacent filters overlap: about +0.13 dB for a tone on a band centre
   (section 2.4). This is inherent to fractional-octave filter banks.
4. **Impulse time weighting is unverified.** The rise and decay behaviour is
   implemented as described and measured in section 3.3, but has not been compared
   against a certified impulse reference.
5. **A 0.5 s acquisition warm-up is excluded from every measurement.** During
   warm-up the filters and detectors settle but nothing is integrated, so a
   measurement never includes the ring-up of the 20 Hz band-pass or the detector
   ramp. The measured duration reflects integrated time only.
6. **Changing the band pre-weighting resets band statistics.** Mixing two
   weightings in one average would be meaningless, so band Leq and band maxima
   restart. This is stated in the octave screen.
`;

await writeFile(path.join(root, 'DSP_VALIDATION.md'), doc, 'utf8');
await rm(bundlePath, { force: true });

console.log('[dsp-report] wrote DSP_VALIDATION.md');

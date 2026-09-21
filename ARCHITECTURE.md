# Architecture

## The shape of the problem

A sound level meter has to do three things that pull against each other:

1. Process every sample at 48 kHz through several filter cascades, without ever
   missing a block. Missing blocks means a wrong Leq, silently.
2. Run expensive periodic analysis — a 31-band filter bank and a 16384-point FFT —
   without disturbing (1).
3. Draw a fluid interface at 60 Hz without disturbing either.

Everything below follows from separating those three onto different threads and
keeping the boundaries narrow.

---

## Threading model

```
 ┌───────────────── audio rendering thread ──────────────────┐
 │  MediaStreamAudioSourceNode                               │
 │            │                                              │
 │            ▼                                              │
 │  AudioWorkletNode "acousticlab-meter"                     │
 │    • down-mix to mono                                     │
 │    • MeterEngine: A/C/Z weighting, Fast/Slow/Impulse,      │
 │      Leq, peaks, extremes, statistics, clipping           │
 │    • metric snapshot 20x/s          ─────────────────┐    │
 │    • PCM blocks of 2048 samples  ──────┐             │    │
 │            │                           │             │    │
 │            ▼                           │             │    │
 │  GainNode(0) ──▶ destination           │             │    │
 └────────────────────────────────────────┼─────────────┼────┘
                                          │             │
                     transferred          │             │ worklet.port
                     MessagePort          │             │
                                          ▼             ▼
 ┌──────── Web Worker ─────────┐   ┌───────── main thread ─────────┐
 │  analysisWorker             │   │  AcousticEngine (orchestrator)│
 │   • optional pre-weighting  │   │   • status, subscriptions      │
 │   • 1/3-octave bank (30     │   │   • WAV recorder               │
 │     bands, order 6)         │   │   • React providers            │
 │   • octaves by energy sum   │   │   • canvases, imperative draw  │
 │   • FFT + smoothing + peak  │   └────────────────────────────────┘
 │     hold                    │                ▲
 │   • frame 15x/s ────────────┼────────────────┘
 └─────────────────────────────┘
```

### Why PCM goes worklet → worker directly

A `MessagePort` is transferable. One is created on the main thread, one end is
transferred into the AudioWorklet and the other into the analysis Worker, after
which audio data flows between them without the main thread being involved. A slow
React render therefore cannot stall analysis, and a heavy FFT cannot cause an audio
dropout. Buffers are transferred, not copied.

### Why the worklet does the meter and not the bank

The meter must be continuous and is cheap: five biquads plus seven detectors per
sample. The filter bank is 90 biquads per sample — affordable, but with enough
variance that a bad frame could overrun the render quantum. Batching it in a Worker
keeps the audio thread's worst case small while still processing **every** sample:
the bank's filter state persists across blocks, so the filtering is continuous. The
batching is about which thread does the work, never about discarding samples. If the
device cannot keep up, the worker drops the oldest backlog and **reports how many
samples it dropped** rather than hiding it.

### Why the output is routed through a zero-gain node

Some browsers stop pulling a graph that has no path to the destination. A
`GainNode` with `gain = 0` keeps the graph alive with no audible output and no
feedback risk.

---

## Module layout

```
src/
  dsp/            framework-independent DSP. No React, no browser APIs.
    levels.ts             dBFS convention, energy arithmetic, EnergyAccumulator
    biquad.ts             Direct Form I cascade, bilinear transform, responses
    butterworth.ts        Butterworth band-pass designer
    weighting/            A, C, Z design + analytic reference
    timeWeighting.ts      exponential and impulse detectors
    leq.ts                Leq integration, short-Leq segments, moving Leq
    fft.ts                pre-planned radix-2 FFT, SpectrumAnalyzer
    window.ts             analysis windows with correction factors
    octave.ts             IEC 61260 band definitions, FractionalOctaveBank
    thirdOctave.ts        band plan for a sample rate
    statistics.ts         LevelHistogram, percentiles, descriptive statistics
    exposure.ts           NIOSH/OSHA-style dose calculations
    clipping.ts           clipping and near-overload detection
    signals.ts            deterministic signal generators
    engine.ts             MeterEngine: the sound level meter core
    __tests__/            314 unit tests

  audio/          acquisition and transport
    messages.ts           the three-way message protocol
    worklet/              the AudioWorklet processor (compiled separately)
    workers/              the analysis Worker
    input.ts              AudioInputSource: DeviceInput, SyntheticInput
    diagnostics.ts        what the browser actually granted
    wavRecorder.ts        24-bit WAV encoding
    acousticEngine.ts     main-thread orchestrator

  calibration/    dBFS → dB SPL, and nothing else does this
    fit.ts                single-point and least-squares calibration
    frequencyCorrection.ts log-frequency correction curve
    activeCalibration.ts  the only place a level becomes SPL
    quality.ts            calibration quality report

  measurement/
    levelHistory.ts       bounded-memory history with progressive decimation
    sessionBuilder.ts     engine state → persisted session

  storage/        IndexedDB with explicit versioned migrations
  reports/        CSV, JSON, printable HTML, download helpers
  state/          React providers and hooks
  components/     UI: ui/, layout/, meter/, charts/, calibration/, system/
  lib/            routes, formatting, device detection, ids
  app/            Next.js App Router: one directory per screen
```

The dependency direction is strictly inward: `components` → `state` → `audio` /
`calibration` / `storage` → `dsp`. `dsp` depends on nothing.

---

## Key design decisions

### One meter implementation, three hosts

`MeterEngine` runs in the AudioWorklet on live audio, in the developer DSP lab on
generated signals, and in the unit tests on signals with analytically known levels.
There is no second implementation to keep in sync, which is what makes the automated
validation meaningful: if a test passes, the code that measures your microphone is
the code that passed.

The AudioWorklet is compiled separately by `scripts/build-worklet.mjs` (esbuild)
because `audioWorklet.addModule()` loads by URL and cannot participate in the
Next.js bundle graph. Compiling it rather than hand-writing it is what allows it to
`import` the real DSP.

### dBFS everywhere, SPL in exactly one place

All DSP output is dBFS, defined as `20·log10(rms)` of the normalised sample stream
(so a full-scale sine reads −3.01 dBFS). `ActiveCalibration` is the only thing
permitted to apply `SPL = slope · dBFS + intercept`. Consequences:

- The unit label is derived from the same object that does the conversion, so an
  uncalibrated level cannot be displayed as dB SPL.
- Sessions store both calibrated and raw values, so a session measured with a
  calibration that later proves wrong can be re-derived instead of discarded.
- The statistical histogram lives in the dBFS domain. Because the transform is
  affine, applying calibration afterwards shifts every percentile by exactly the
  offset — verified in `DSP_VALIDATION.md` §6.2.

### All weightings computed simultaneously

A, C and Z, each with Fast and Slow (plus Impulse on A), run at the same time. The
user can switch weighting mid-measurement with no loss of continuity, and a stopped
session contains every metric rather than only the one that happened to be selected.

### A 0.5 s acquisition warm-up that integrates nothing

The 20 Hz band-pass sections ring for up to ~70 ms and the exponential detectors
ramp from silence. During warm-up the filters and detectors run so their state
settles, but no energy, extreme or statistical sample is recorded. When warm-up ends,
the Slow and Impulse detectors are primed from the already-settled Fast detector so
they do not spend seconds climbing. The measured duration counts integrated time
only.

### Octave bands derived, not measured twice

An octave band is the energy sum of its three constituent one-third-octave bands.
This is exact, and it halves the band-pass work compared with running a second bank.

### Statistics live next to the detector that fills them

The level histogram is inside the AudioWorklet, beside the detector feeding it, and
is fetched on request. Displayed percentiles and the exported distribution therefore
come from the same 2000-bin histogram and cannot disagree. The alternative — a
parallel histogram on the main thread — would eventually drift.

### Bounded memory for unbounded measurements

`LevelHistory` has a fixed 16384-sample capacity. When it fills, adjacent pairs are
merged and the interval doubles. Merging is done correctly per trace: instantaneous
traces are **energy averaged**, the running Leq keeps its later cumulative value, and
a separate max/min envelope preserves the extremes, so decimation never loses a peak.
A measurement can run for hours in constant memory.

### Canvas rendering, not React rendering

Every visualisation draws imperatively into a canvas from a data subscription, with
one `requestAnimationFrame` per canvas driven by a dirty flag. React never re-renders
during scrolling. Numeric read-outs use `useMetrics`, which throttles to 10 Hz — fast
enough to feel live, half the render work of the 20 Hz metric rate.

The spectrogram keeps its image in an offscreen canvas and scrolls with a one-pixel
self-blit, adding one column per frame. There is no retained array of frames.

### Honesty as an architectural constraint

The masterplan's rule — never show a value that did not come from a real measurement
— shows up in the types:

- Unavailable values are `NaN` and render as an em dash, never `0`.
- Bands whose upper edge approaches Nyquist are `available: false` with a reason
  string, and are drawn hatched.
- `InputDiagnostics` records per-flag `{ requested, actual, supported }`, so
  "we asked for AGC off" and "AGC is off" are different states, and "the browser did
  not say" is a third.
- `buildQualityReport` returns `value: string | null`; null renders as
  "Not available" with an explanation rather than a plausible number.
- Exposure dose is omitted entirely when uncalibrated, because a dose against an
  absolute criterion level cannot be computed from a digital level.

---

## Data flow for one measurement

1. `DeviceInput.connect` opens `getUserMedia` with measurement constraints, then
   inspects the resulting track and builds `InputDiagnostics`.
2. `AcousticEngine.start` creates the AudioContext, loads the worklet, wires the
   graph, spawns the analysis worker and hands it the transferred port.
3. The worklet posts metric snapshots at 20 Hz; the worker posts analysis frames at
   15 Hz.
4. `MeasurementProvider.start` calls `resetStatistics` on both, which zeroes the
   integrated data without disturbing filter state — so the live level stays correct
   across a START.
5. Metric snapshots feed `LevelHistory`. Every 5 s the session is autosaved with
   `incomplete: true`.
6. `stop` requests the histogram and the clipping event list, builds a
   `SessionRecord` plus a `SessionSeries`, writes both, and clears the
   active-session marker.
7. On the next launch, any session still marked incomplete is offered for recovery.

---

## Storage

IndexedDB, schema version 2, seven stores: `settings`, `calibrationProfiles`,
`sessions`, `sessionSeries`, `validationExperiments`, `recordings`, `photos`.
Migrations are an ordered list where each entry moves the schema from version n−1 to
n; adding a store means appending a migration, never editing an old one — version 2
is exactly that, the `photos` store indexed by `sessionId` and `createdAt`.

Binary data (WAV recordings, JPEG photos) is stored as `Blob`s keyed by their own id
and referenced from the session, not embedded in it, so the session list stays cheap
to read and audio or photos can be deleted without touching the measured numbers.
Deleting a session cascades to both.

Sessions are split: a light record for the list, and a heavy typed-array series
fetched only when a session is opened. `Float32Array` survives structured clone, so a
one-hour measurement costs tens of kilobytes per trace instead of megabytes of JSON.

---

## PWA

`scripts/build-sw.mjs` generates `public/sw.js` from a template, injecting a cache
version and the precache list. The precache list is read from `src/lib/routes.ts` by
transpiling that module with esbuild and evaluating it, so adding a screen cannot
leave it unavailable offline.

Caching: precache every route document plus the manifest, icons and the compiled
worklet; cache-first for content-hashed `/_next/static/`; network-first with cache
fallback for navigations and RSC payloads; stale-while-revalidate for everything else
same-origin. Cross-origin requests are never intercepted.

Updates wait. A new worker is not activated while a measurement is running, because
activation reloads the page. The reload only happens when an update replaced a worker
that was already in control — never on first registration, which would otherwise
interrupt the user seconds after arriving.

---

## Extending to an external microphone

`AudioInputSource` is the seam:

```ts
interface AudioInputSource {
  connect(context: AudioContext): Promise<AudioNode>;
  close(): Promise<void>;
  diagnostics(contextSampleRate: number): InputDiagnostics;
}
```

`DeviceInput` already takes a `deviceId`, and the diagnostics screen lists every
enumerated input and classifies external ones. A USB-C measurement microphone or
audio interface appears there and can be selected with no DSP change: the pipeline
only ever sees an `AudioNode`. `SyntheticInput` implements the same interface and is
what lets the developer lab and the end-to-end tests drive the real pipeline with a
generated signal.

What a dedicated measurement microphone would additionally want, and where it would
go: a per-device sensitivity in volts per pascal (a second field on the calibration
profile, consumed by `ActiveCalibration`), and per-channel calibration if a stereo
interface is used (`DeviceInput` would stop down-mixing and the worklet would carry a
channel index).

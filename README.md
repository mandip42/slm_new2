# AcousticLab

A calibrated smartphone acoustic measurement tool. AcousticLab turns an Android
phone into a working acoustic analyser: a sound level meter with real A, C and Z
frequency weighting and Fast, Slow and Impulse time weighting; a genuine
one-third-octave filter bank; an FFT analyser; a scrolling spectrogram; statistical
levels; noise exposure indicators; and a calibration and validation workflow built
around a reference instrument.

It runs entirely in the browser as an installable PWA. **Microphone audio is
processed locally on your device and is never uploaded.**

---

## What it is, and what it is not

AcousticLab implements measurement concepts and filter designs derived from
IEC 61672-1 (sound level meters), IEC 61260-1 (fractional-octave filters) and
ISO 266 (preferred frequencies).

It is **not** a classified sound level meter. It has not been type tested or
certified against IEC 61672 Class 1 or Class 2, and no such claim is made anywhere
in the application. What it does instead is tell you honestly how far its filters
deviate from their ideal definitions ([DSP_VALIDATION.md](DSP_VALIDATION.md)), what
the browser actually granted for the audio stream, and how well it agrees with your
reference instrument. Where a measurement has legal or regulatory consequences, use
appropriate certified equipment.

A phone microphone does not measure sound pressure by itself. Until you calibrate,
every level is labelled **dBFS** (digital full scale) rather than dB SPL, on every
screen, without exception.

---

## Features

**Sound level meter**
- A, C and Z frequency weighting as real IIR filters on the sample stream
- Fast (125 ms), Slow (1 s) and Impulse (35 ms rise, 2.9 dB/s decay) time weighting
- All weightings computed simultaneously, so switching never interrupts a measurement
- LAeq, LCeq, LZeq, LAE/SEL, LAFmax/min, LASmax/min, LAImax, LCFmax, LZFmax/min,
  LApeak, LCpeak, LZpeak, moving 1 s Leq
- Leq is always an energy average; decibel values are never averaged arithmetically

**Analysis**
- 1/1 and 1/3 octave bands from an order-6 Butterworth filter bank at the full
  sample rate, integrating energy across each band's full width
- FFT analyser: 2048–16384 points, six windows, log/linear frequency, peak hold,
  smoothing, draggable cursor
- Scrolling spectrogram with a perceptually uniform colormap
- Level history with selectable traces, windows from 10 s to the full session,
  cursor and a min/max envelope
- Exceedance levels L1–L99 and the level distribution with a cumulative curve

**Measurement sessions**
- Start / pause / resume / stop, with paused time excluded from Leq and duration
- Autosaved every 5 seconds and recoverable after an interruption
- Optional 24-bit WAV recording, never implicit, deletable independently of results
- Printable HTML report, CSV exports (summary, time series, octave, 1/3 octave,
  distribution) and a lossless JSON export that also carries the raw dBFS values

**Calibration and validation against a reference instrument**
- Single-point level calibration
- Multi-level linearity fit with slope, intercept, R², RMSE, residuals and a
  non-linearity warning
- Frequency-response correction interpolated in log-frequency, never extrapolated
- Calibration quality report and status: UNCALIBRATED → LEVEL CALIBRATED →
  FREQUENCY CALIBRATED → VALIDATED
- XL2 validation laboratory: six standard experiments with mean error, standard
  deviation, RMSE, worst error and a 95 % interval
- Profiles are exportable and importable as JSON

**Honesty features** (the ones that make the numbers trustworthy)
- Input diagnostics showing what the browser actually granted, including whether
  automatic gain control could be confirmed disabled
- Clipping and near-overload detection, recorded in the session and flagged in exports
- A green/amber/red validity indicator whose every state comes from a known condition
- Bands that cannot be measured at the active sample rate are drawn hatched, never
  shown as a low level
- A developer DSP lab at `/dev/dsp` that runs generated signals through the identical
  engine the microphone uses, and compares against analytically known values

---

## Requirements

- Node.js 20.9 or newer
- A Chromium-based browser for measurement (Chrome or Edge on Android is the target).
  AudioWorklet and `getUserMedia` are both required.
- HTTPS, or `localhost`. Browsers do not grant microphone access otherwise.
- An NTi Audio XL2 or similar reference instrument, to calibrate.

---

## Getting started

```bash
git clone <your-repository-url>
cd acousticlab
npm install
npm run dev
```

Open <http://localhost:3000>, tap **Open microphone**, and grant permission. Levels
appear immediately as dBFS.

`npm run dev` runs `prepare:static` first, which generates the PWA icons, compiles
the AudioWorklet and builds the service worker. Running `next dev` directly will
leave those missing.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server on port 3000 |
| `npm run build` | Production build (generates icons, worklet and service worker first) |
| `npm start` | Serve the production build |
| `npm test` | DSP unit tests (314 tests) |
| `npm run test:watch` | Unit tests in watch mode |
| `npm run test:e2e` | Playwright end-to-end tests (builds first) |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript, no emit |
| `npm run verify` | lint + typecheck + unit tests + build |
| `npm run report:dsp` | Regenerate `DSP_VALIDATION.md` from live measurements |
| `npm run build:worklet` | Compile the AudioWorklet only |
| `npm run gen:assets` | Regenerate the PWA icons only |

---

## Testing

**Unit tests** (`npm test`) validate the DSP against signals whose properties are
known analytically: RMS and decibel conversion, A/C/Z weighting frequency response
against the exact analog prototypes from 31.5 Hz to 16 kHz, time-weighting step and
decay behaviour, energy averaging and SEL, FFT peak identification, band allocation
and energy conservation in the filter bank, percentile calculation against an exact
sort, and the exposure schemes. A DSP regression fails the build.

**End-to-end tests** (`npm run test:e2e`) run against a production build with
Chrome's fake audio capture device: every route loads without console errors, the
PWA manifest and service worker are correct, a measurement runs and saves and
exports, a single-point calibration converts the read-out from dBFS to dB SPL, and
the developer DSP lab agrees with theory.

**DSP validation report** (`npm run report:dsp`) regenerates
[DSP_VALIDATION.md](DSP_VALIDATION.md) by executing the production DSP. Every number
in that document is measured, not transcribed.

---

## Installing on Android

1. Deploy over HTTPS (see [DEPLOYMENT.md](DEPLOYMENT.md)) or use a tunnel to your
   development machine. `localhost` also works if you run the dev server on the phone.
2. Open the site in Chrome on Android.
3. Menu → **Add to Home screen** → **Install**.
4. Launch from the home screen. It opens standalone, without browser chrome.
5. Grant microphone permission on first use.

Once installed and loaded, measurement works with no network connection. The service
worker precaches every screen, the compiled AudioWorklet and the icons.

For measurement quality: disable any system-level audio effects, remove thick cases
that cover the microphone port, and check the diagnostics screen to confirm what the
browser granted.

---

## Documentation

| Document | Contents |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Threading model, module layout, data flow, design decisions |
| [DSP_VALIDATION.md](DSP_VALIDATION.md) | Generated measurement report for every DSP stage |
| [CALIBRATION_GUIDE.md](CALIBRATION_GUIDE.md) | Practical calibration against an NTi XL2 |
| [XL2_VALIDATION_GUIDE.md](XL2_VALIDATION_GUIDE.md) | Reproducible experimental protocol |
| [DEPLOYMENT.md](DEPLOYMENT.md) | GitHub, Vercel, HTTPS and PWA installation |

---

## Limitations

Read these before trusting a number. The application repeats them in
**About → Measurement limitations**.

- **A phone microphone reports digital amplitude, not sound pressure.** The
  relationship depends on the microphone, port geometry, case, audio front end and
  browser. Calibration establishes it for the levels and frequencies you checked, and
  nothing else.
- **Limited dynamic range.** Typically a noise floor around 30 dBA and compression or
  clipping somewhere around 100–120 dB SPL depending on the model. The front end
  often compresses before the converter clips, so a reading can be low while no
  digital clipping is visible.
- **Frequency response varies between phones,** and is worst at the extremes. The
  frequency-response calibration corrects it over the range you measure; outside that
  range AcousticLab holds the correction flat and marks the region as uncalibrated.
- **Operating system audio processing.** AcousticLab requests automatic gain control,
  noise suppression and echo cancellation off, but cannot force them off. Automatic
  gain control in particular destroys level measurement. Check diagnostics.
- **The digital weighting filters are not exact.** See `DSP_VALIDATION.md` §1 for the
  measured deviation and the frequency above which accuracy degrades.
- **The highest 1/3-octave band is not measured** at 44.1 or 48 kHz, because its
  upper edge is too close to Nyquist.
- **Calibration is not classification.** It improves accuracy; it does not make the
  device a certified instrument, and says nothing about directional response.
- **Spatial variation limits any comparison.** Two microphones at different points in
  a real sound field measure different things; this is usually the dominant error in a
  phone-versus-reference comparison, not the phone.
- **The browser can stop the measurement.** A screen lock or backgrounded tab
  suspends the audio engine on Android. AcousticLab detects this, stops the clock
  rather than integrating silence, and says so.
- **Impulse time weighting is unverified** against a certified impulse reference.

---

## Privacy

- All filtering, spectrum analysis, statistics and calibration maths run in your
  browser. No audio and no measurement data is uploaded anywhere.
- Audio is written to storage only when you explicitly enable recording, and a
  recording indicator is shown while it is active.
- Sessions, calibration profiles and settings are stored in your browser's IndexedDB.
  Settings → Delete all measurement data removes them.
- No analytics, no telemetry, no account. After loading, the application makes no
  network requests.

---

## License

MIT. See [LICENSE](LICENSE).

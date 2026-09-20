# ROLE

You are the principal software architect, senior DSP/acoustics engineer, Android/web-audio engineer, UI/UX designer, QA engineer, and DevOps engineer responsible for building a production-quality application called **AcousticLab**.

You have full ownership of the implementation.

Do not stop at planning, pseudocode, TODOs, mockups, or partially implemented features.

Build, test, debug, document, and package the complete application.

When a reasonable engineering decision can be made without asking the user, make it yourself.

The final result must run locally, be deployable to Vercel through GitHub, install as a PWA on Android, and perform real-time acoustic measurements using the Android device microphone.

---

# 1. PRODUCT VISION

Build a professional mobile acoustic measurement application that transforms an Android phone into a sophisticated pocket acoustic analyzer.

The application is called:

**AcousticLab**

Primary platform:

Android Chrome PWA

Architecture:

GitHub
→ Next.js
→ Vercel
→ HTTPS PWA
→ Android microphone
→ Web Audio API / AudioWorklet
→ real-time DSP
→ acoustic metrics and visualization

The application must perform DSP locally on the device.

DO NOT upload microphone audio to a server.

The app should feel like professional acoustic instrumentation rather than a novelty "dB meter."

Visual inspiration may come from professional instruments from NTi Audio, Brüel & Kjær/HBK, Svantek, RION, Norsonic, and modern scientific instrumentation, but do not copy proprietary interfaces or branding.

---

# 2. IMPORTANT MEASUREMENT PRINCIPLE

A smartphone microphone does NOT inherently measure calibrated dB SPL.

It initially provides digital amplitude.

Therefore distinguish internally and visually between:

dBFS

and

dB SPL.

Absolute SPL measurements may only be presented as calibrated SPL after a calibration has been performed or a validated calibration profile is active.

The user owns an **NTi Audio XL2 Sound Level Meter**, which will serve as the reference instrument.

Design an excellent calibration and validation workflow around the XL2.

Do NOT falsely claim IEC 61672 Class 1 or Class 2 compliance.

The application may implement measurement concepts and filters inspired by relevant standards, but it must describe itself as a calibrated smartphone acoustic measurement tool unless formal compliance has actually been demonstrated.

---

# 3. TECHNOLOGY STACK

Prefer:

Next.js latest stable
React
TypeScript
Tailwind CSS
Web Audio API
AudioWorklet
Web Workers where beneficial
IndexedDB for local measurement storage
PWA manifest
Service worker
Recharts, Plotly.js, uPlot, or another performant visualization library after evaluating performance
Vitest/Jest for DSP unit tests
Playwright for end-to-end testing

Use a modular architecture.

Avoid unnecessary dependencies.

Everything necessary for normal operation should work on-device after the PWA has loaded.

The application should remain usable offline after installation.

---

# 4. MICROPHONE ACQUISITION

Use:

navigator.mediaDevices.getUserMedia()

Request a measurement-oriented audio stream.

Attempt to disable:

echoCancellation
noiseSuppression
autoGainControl

Prefer:

mono input
48 kHz sampling

Do NOT assume the browser honors requested constraints.

After opening the microphone, inspect actual MediaTrackSettings and capabilities.

Create an Input Diagnostics screen showing:

device
sample rate
channel count
echo cancellation state
noise suppression state
automatic gain control state
browser
OS/user agent
AudioContext sample rate
stream status

If unwanted processing cannot be disabled, display:

"Measurement accuracy may be affected by device audio processing."

Do not silently pretend the stream is measurement-grade.

---

# 5. REAL-TIME AUDIO ARCHITECTURE

Use AudioWorklet for real-time acquisition and core processing where appropriate.

Avoid running high-rate audio processing directly in the React rendering loop.

Conceptual architecture:

Microphone
↓
MediaStreamAudioSourceNode
↓
AudioWorklet
↓
PCM blocks
↓
DSP engine
↓
low-rate metric updates
↓
React state
↓
UI

Design buffering carefully.

Avoid unnecessary memory allocation inside the real-time processing path.

Prevent UI rendering from interfering with acquisition.

---

# 6. CORE SOUND LEVEL METER

Implement:

Z-weighted SPL
A-weighted SPL
C-weighted SPL

Implement:

Fast time weighting
Slow time weighting
Impulse weighting where technically appropriate

Expose metrics such as:

LAF
LAS
LCF
LCS
LZF
LZS

Implement measurement-session statistics including:

LAeq
LCeq
LZeq

LAFmax
LAFmin

LASmax
LASmin

LZmax
LZmin

LCpeak
LZpeak

LAE / SEL

measurement duration

running energy average

Do not calculate Leq by arithmetically averaging decibel values.

Perform all energy-domain calculations correctly.

---

# 7. FREQUENCY WEIGHTING

Implement mathematically correct:

A weighting
C weighting
Z weighting

Prefer stable digital IIR implementations derived appropriately for the active sample rate.

Do NOT implement A weighting as a cosmetic correction applied only to the displayed number.

Filtering must operate correctly on the signal or mathematically equivalent energy representation.

Support at minimum common Android sample rates:

44100 Hz
48000 Hz

Ideally design coefficients dynamically or provide verified coefficient sets.

Create automated frequency-response tests for each weighting filter.

Validate expected attenuation at representative frequencies including:

31.5
63
125
250
500
1000
2000
4000
8000
16000 Hz

within reasonable numerical tolerance.

---

# 8. TIME WEIGHTING

Implement exponential time weighting correctly.

Fast:
τ ≈ 125 ms

Slow:
τ ≈ 1 s

Implement impulse weighting carefully if included and document the implementation.

Do not simply average displayed dB values over 125 ms or 1 second.

---

# 9. OCTAVE-BAND ANALYZER

Implement real-time:

1/1 octave

and

1/3 octave

analysis.

Support appropriate standardized center frequencies where meaningful for the microphone/sample rate.

Example octave centers:

31.5
63
125
250
500
1k
2k
4k
8k
16k

Example 1/3-octave centers should follow preferred nominal frequencies.

Use a technically defensible filter-bank implementation or another method demonstrated to produce equivalent band-energy measurements.

Do not simply take one FFT bin at each center frequency.

Calculate band energy across the actual octave/third-octave bandwidth.

Allow:

Z-weighted bands
A-weighted bands where appropriate

Show:

current level
Leq per band
maximum per band

Provide linear and auto-scaled graph modes.

---

# 10. FFT ANALYZER

Create a real-time spectrum analyzer.

Features:

configurable FFT size
window selection
Hann default
frequency axis
log-frequency option
linear-frequency option
dB amplitude axis
peak hold
cursor
frequency/value readout
smoothing control

Reasonable FFT sizes:

2048
4096
8192
16384

Do not confuse FFT spectral amplitude with SPL octave-band energy.

Clearly separate those measurement concepts in code.

---

# 11. SPECTROGRAM

Create a performant scrolling spectrogram.

Controls:

frequency range
dynamic range
time span
pause
clear
cursor inspection

Use an appropriate perceptual colormap.

Optimize rendering for mobile hardware.

Do not cause React to rerender an entire spectrogram at audio-frame rates.

Use Canvas/WebGL where appropriate.

---

# 12. LEVEL HISTORY

Create a real-time SPL history plot.

Selectable traces:

LAeq
LAF
LAS
LCF
LZF

Selectable windows:

10 seconds
30 seconds
1 minute
5 minutes
15 minutes
1 hour
full session

Provide:

zoom
pan
cursor
min/max indicators

---

# 13. STATISTICAL ACOUSTICS

During measurement sessions calculate percentile/exceedance levels:

L1
L5
L10
L50
L90
L95
L99

At minimum prominently expose:

L10
L50
L90

Make the statistical methodology explicit and technically correct.

Provide an optional level-distribution histogram.

---

# 14. NOISE EXPOSURE

Create an Exposure screen.

Support educational/occupational indicators including:

NIOSH-style exposure
OSHA-style exposure

Where implemented, explicitly document:

criterion level
exchange rate
threshold assumptions
measurement duration

Show:

current LAeq
elapsed time
estimated dose
remaining allowable exposure
projected 8-hour exposure

Do not present medical advice.

---

# 15. XL2 REFERENCE CALIBRATION

This is a critical feature.

Create:

Settings
→ Calibration
→ Reference Instrument Calibration

Reference instrument:

NTi Audio XL2

Support two major workflows.

## METHOD A — SINGLE-POINT SPL CALIBRATION

Allow simultaneous measurement with:

phone
+
XL2

User enters:

XL2 measured level
weighting
frequency/reference signal if known

Example:

XL2 = 74.3 dBA
Phone raw = -46.8 dBFS

The app calculates and stores the appropriate SPL calibration relationship.

Store:

date/time
device model
browser
sample rate
reference instrument
reference level
raw level
calibration offset
notes

Provide a clear calibration wizard.

---

# 16. MULTI-LEVEL LINEARITY VALIDATION

Provide an advanced calibration experiment.

User simultaneously measures phone and XL2 at multiple levels.

Suggested points:

45
55
65
75
85
95 dB SPL

Allow manual entry of paired measurements.

Fit:

PhoneRaw → XL2 SPL

Evaluate:

offset
slope
R²
residual error
RMSE
maximum error

Plot:

phone estimate vs XL2
ideal y=x line
residual error vs SPL

If significant nonlinear behavior exists, warn the user rather than blindly applying a constant offset.

---

# 17. FREQUENCY-RESPONSE CALIBRATION

Create an advanced frequency calibration mode.

User may expose the phone and XL2 to the same stable source and record measurements at frequencies such as:

31.5
63
125
250
500
1000
2000
4000
8000
16000 Hz

Allow additional frequencies.

For each frequency store:

frequency
XL2 level
phone measured level
difference

Calculate:

Correction(f) = XL2(f) - Phone(f)

Create a correction curve.

Interpolate corrections appropriately in log-frequency space.

Allow:

raw response
corrected response

to be viewed simultaneously.

Do not extrapolate aggressively beyond measured calibration frequencies.

Clearly mark uncalibrated regions.

---

# 18. DEVICE CALIBRATION PROFILES

Store profiles locally.

Example:

Samsung Galaxy
Built-in microphone
48 kHz
Calibrated against NTi XL2
2026-XX-XX

Each profile contains:

global SPL calibration
frequency correction
validated SPL range
validated frequency range
sample rate
device/browser metadata
reference instrument
calibration date
validation statistics

Allow:

create
duplicate
rename
export
import
delete
activate

profiles.

Export calibration as JSON.

---

# 19. CALIBRATION QUALITY SCORE

Create a useful validation summary.

For example:

CALIBRATION STATUS

Reference:
NTi XL2

Overall level:
Validated

Frequency correction:
Validated 63 Hz–8 kHz

Mean error:
0.7 dB

Maximum observed error:
1.9 dB

Calibration:
12 days old

Do not fabricate these values.

Only calculate them from actual collected validation data.

Give calibration status categories such as:

UNCALIBRATED
LEVEL CALIBRATED
FREQUENCY CALIBRATED
VALIDATED

---

# 20. SIDE-BY-SIDE XL2 VALIDATION MODE

Create a dedicated:

"XL2 Validation"

experiment.

The user can perform simultaneous phone/XL2 tests and manually enter XL2 readings.

For every test capture:

timestamp
signal/source description
XL2 reading
AcousticLab reading
difference
weighting
time weighting
frequency if applicable

Calculate:

mean error
standard deviation
RMSE
maximum absolute error
95% error interval where statistically appropriate

Generate charts showing measurement agreement.

This feature is important because it allows the application to be characterized scientifically instead of merely "calibrated until the numbers match."

---

# 21. SESSION RECORDING

Create measurement sessions.

START

should create a session containing:

start time
end time
duration
calibration profile
device information
sample rate
measurement settings
time-series metrics
Leq
max/min
peak
percentiles
octave results
exposure results where enabled

Provide:

pause
resume
stop

Make accidental session loss difficult.

---

# 22. AUDIO RECORDING

Provide optional WAV recording.

This must be explicitly enabled.

Never record audio merely because an SPL measurement is running.

Display an obvious recording indicator.

Store recordings locally when feasible.

Allow recordings to be deleted independently from measurement results.

---

# 23. SESSION REPORT

After stopping:

MEASUREMENT SUMMARY

Duration
LAeq
LCeq
LAFmax
LASmax
LCpeak
L10
L50
L90

Include:

SPL history
octave spectrum
measurement metadata
calibration information

Allow export as:

CSV
JSON

If reliable client-side PDF generation can be implemented without compromising the architecture, also provide a professional PDF report.

Otherwise prioritize CSV/JSON and a printable HTML report.

---

# 24. DATA EXPORT

CSV exports should use clear scientific columns.

Example:

timestamp_ms
elapsed_s
LAF_dBA
LAS_dBA
LCF_dBC
LZF_dBZ
LAeq_dBA
LCeq_dBC

Octave exports should contain:

timestamp
center_frequency_hz
band_level_db
band_leq_db

Calibration data should be independently exportable.

---

# 25. DASHBOARD UI

Design primarily for portrait Android.

Main meter:

large numerical SPL value

Example:

67.4
dBA

Secondary metrics:

LAeq
LAFmax
LCpeak

Below:

live level-history graph

Then:

compact octave spectrum

Bottom navigation:

Meter
Spectrum
Octave
History
More

Provide an obvious:

START / STOP

measurement control.

---

# 26. VISUAL DESIGN

Create a polished scientific-instrument aesthetic.

Requirements:

dark mode optimized
optional light mode
excellent outdoor readability
large numeric typography
high contrast
minimal clutter
responsive portrait layout
landscape support
touch-friendly controls

Do not create a generic SaaS dashboard.

This should look like laboratory instrumentation adapted to a modern phone.

---

# 27. STATUS BAR

Always provide useful measurement state.

Example:

MIC ✓
48 kHz
CAL ✓
A
FAST
REC ●

Tapping the status region should expose detailed acquisition/calibration information.

---

# 28. PWA

Make AcousticLab fully installable.

Implement:

manifest
icons
service worker
offline shell
standalone display mode
theme metadata

Once loaded/installed, core acoustic measurement functionality should not depend on an internet connection.

Handle app updates gracefully.

---

# 29. PRIVACY

Audio processing is local.

State prominently:

"Microphone audio is processed locally on this device."

No microphone audio should be uploaded.

Do not add analytics that capture measurement data without explicit consent.

---

# 30. STORAGE

Use IndexedDB or another suitable browser-local storage mechanism.

Store:

sessions
settings
calibration profiles
validation experiments

Provide:

storage usage
delete individual session
delete all measurement data
export data
import data

Design schemas with explicit versioning/migrations.

---

# 31. DSP TEST SUITE

This is mandatory.

Create synthetic-signal tests.

Generate signals internally for testing:

1 kHz sine
100 Hz sine
31.5 Hz sine
pink noise
white noise
impulse
multi-tone signals

Verify:

RMS
dB conversion
A weighting
C weighting
time weighting
Leq
SEL
FFT frequency identification
octave-band allocation
third-octave allocation
percentile calculations

Example:

A 1 kHz sine should receive approximately 0 dB A-weighting correction.

A 100 Hz sine should show the expected A-weight attenuation within specified numerical tolerance.

Tests must fail if DSP implementation is incorrect.

---

# 32. DSP DEVELOPMENT LAB

Create a hidden/developer route such as:

/dev/dsp

It should permit generated signals to be passed through the same DSP engine used by the microphone.

Controls:

signal type
frequency
amplitude
duration
sample rate

Display:

RMS
weighted levels
FFT
octave spectrum

This allows deterministic validation without requiring microphone input.

Do not ship developer controls prominently in the normal user workflow.

---

# 33. PERFORMANCE

Target stable real-time operation on modern Android devices.

Monitor:

audio dropouts
processing time
buffer backlog
UI frame rate

Avoid:

high-frequency React state changes
excessive allocations
unbounded arrays
memory leaks

Downsample visualization updates while preserving full-rate DSP.

---

# 34. ERROR HANDLING

Handle:

microphone denied
microphone unavailable
unsupported AudioWorklet
unexpected sample rate
browser suspending AudioContext
screen lock
tab backgrounding
device rotation
low storage
corrupt calibration profile
IndexedDB failure
PWA update
audio device change

Provide understandable user-facing errors.

---

# 35. MEASUREMENT LIMITATIONS

Create:

About
→ Measurement Limitations

Explain:

phone microphones have limited dynamic range

frequency response varies between phones

OEM audio processing may affect results

very low frequencies may be unreliable

very high frequencies may be unreliable

high SPL may clip the microphone/preamp

calibration improves accuracy but does not automatically confer IEC instrument classification

environmental measurements requiring regulatory compliance should use appropriate certified instrumentation

---

# 36. CLIPPING DETECTION

Detect digital clipping and probable microphone saturation.

Display a clear:

CLIPPING

warning.

Record clipping events in the session.

Measurements affected by clipping should be identified in exports/reports.

---

# 37. CONFIDENCE / VALIDITY INDICATOR

Create a measurement validity indicator based on actual known conditions.

For example:

GREEN
calibrated and within validated range

YELLOW
outside calibrated frequency/range or device processing uncertain

RED
clipping / invalid input / calibration mismatch

Never invent numerical accuracy.

---

# 38. FUTURE EXTERNAL MICROPHONE SUPPORT

Architect input handling so a future USB measurement microphone can be selected.

Do not hard-code the DSP engine specifically to the internal microphone.

Create an abstraction similar to:

AudioInput
→ DeviceInput
→ DSPPipeline

This should allow future support for USB-C microphones/interfaces without rewriting the DSP layer.

---

# 39. CODE ARCHITECTURE

Use a clean structure similar to:

src/

app/
components/
audio/
dsp/
calibration/
storage/
reports/
hooks/
workers/
types/
utils/

DSP should be framework-independent where practical.

Example modules:

dsp/rms.ts
dsp/leq.ts
dsp/weighting/aWeighting.ts
dsp/weighting/cWeighting.ts
dsp/timeWeighting.ts
dsp/fft.ts
dsp/octave.ts
dsp/thirdOctave.ts
dsp/statistics.ts
dsp/exposure.ts

Do not put the DSP implementation inside React components.

---

# 40. DOCUMENTATION

Create:

README.md
ARCHITECTURE.md
DSP_VALIDATION.md
CALIBRATION_GUIDE.md
XL2_VALIDATION_GUIDE.md
DEPLOYMENT.md

README must explain:

what AcousticLab does
installation
development
testing
deployment
PWA installation
limitations

CALIBRATION_GUIDE should give practical instructions for calibrating against an NTi XL2.

XL2_VALIDATION_GUIDE should provide a repeatable experimental protocol.

---

# 41. XL2 EXPERIMENTAL VALIDATION PROTOCOL

Create a practical protocol that the owner can perform after the software is built.

At minimum include:

## Experiment 1

Broadband level agreement

Simultaneously position XL2 microphone and phone.

Compare approximately:

45
55
65
75
85
95 dBA

where practical and safe.

## Experiment 2

Frequency response

Use stable tones or suitable test signals around:

63
125
250
500
1k
2k
4k
8k

Compare XL2 and AcousticLab.

## Experiment 3

A weighting

Compare LAeq.

## Experiment 4

C weighting

Compare LCeq.

## Experiment 5

Time response

Use changing/intermittent noise and compare Fast/Slow behavior.

## Experiment 6

Octave bands

Compare octave-band readings between XL2 and AcousticLab where the XL2 configuration supports the required analysis.

For each experiment document:

setup
source
distance
phone orientation
XL2 orientation
duration
settings
results
error

Make the protocol reproducible.

---

# 42. IMPORTANT CALIBRATION SCIENCE

Do not assume that positioning the phone and XL2 at different points in a sound field produces an exact reference.

For controlled calibration/validation recommend:

stable source
minimal reflections where practical
close microphone spacing relative to wavelength while avoiding physical interference
fixed geometry
adequate stabilization
multiple repeated measurements

Explain spatial variation and uncertainty.

Do not use environmental noise as the preferred method for frequency-response calibration.

---

# 43. AUTOMATED QUALITY GATES

Before considering the project complete:

run linting

run TypeScript checks

run unit tests

run DSP validation tests

run production build

run Playwright tests where possible

fix failures

repeat until clean

Do not disable tests merely to make CI green.

---

# 44. GITHUB

Prepare the project for GitHub.

Include:

.gitignore
README
license placeholder/appropriate open-source license if selected
GitHub Actions CI

CI should run:

install
lint
typecheck
tests
build

Never commit secrets.

---

# 45. VERCEL

Make the repository directly deployable to Vercel.

Do not require a backend unless genuinely necessary.

The core application should be static/client-side where practical.

Document:

GitHub connection
Vercel deployment
HTTPS microphone permission
PWA installation on Android

No paid services should be required for the core app.

---

# 46. AUTONOMOUS EXECUTION RULES

You are authorized to:

create directories
create files
install reasonable npm packages
refactor code
run builds
run tests
debug errors
change implementation when testing demonstrates a better approach
write documentation
configure PWA
configure CI

Do NOT repeatedly ask the user questions about normal implementation choices.

Choose sensible defaults.

If a library fails, diagnose it and use a better solution.

If an approach is technically incorrect for acoustic measurement, replace it rather than implementing it merely because the specification mentioned it.

Scientific correctness takes priority over convenience.

---

# 47. DO NOT FAKE FEATURES

Never create a UI control that pretends to perform a measurement that has not actually been implemented.

No fake:

SPL
Leq
octave data
calibration
accuracy
percentiles
exposure
validation

Every displayed acoustic value must originate from a real implemented calculation.

---

# 48. COMPLETION CRITERIA

The project is complete only when I can:

clone repository

npm install

npm run dev

open the application

grant microphone permission

see live audio input

measure raw level

apply calibration

measure calibrated SPL

switch A/C/Z weighting

switch Fast/Slow

see LAeq

see maximum/peak values

see FFT

see octave spectrum

see 1/3-octave spectrum

see SPL history

see spectrogram

start/stop measurement sessions

see L10/L50/L90

save a session

reload and recover it

export data

create an XL2 calibration profile

perform XL2 validation tests

install the application as a PWA

use core functions offline

run all DSP tests successfully

build production successfully

deploy to Vercel successfully.

---

# 49. IMPLEMENTATION ORDER

Work autonomously in this sequence:

Phase 1
Repository and architecture

Phase 2
Audio acquisition

Phase 3
DSP core

Phase 4
Synthetic DSP test harness

Phase 5
SLM interface

Phase 6
FFT

Phase 7
octave/third-octave analysis

Phase 8
history and spectrogram

Phase 9
statistics/exposure

Phase 10
XL2 calibration

Phase 11
frequency-response correction

Phase 12
XL2 validation laboratory

Phase 13
session persistence/export

Phase 14
PWA/offline

Phase 15
mobile UI optimization

Phase 16
automated tests

Phase 17
documentation

Phase 18
production build

Phase 19
GitHub CI

Phase 20
Vercel deployment readiness

After every major phase:

build
test
fix regressions

Continue automatically.

---

# 50. FINAL DELIVERABLE

When finished, provide a concise completion report containing:

1. what was implemented
2. architecture
3. repository structure
4. DSP algorithms used
5. tests performed
6. known browser/device limitations
7. exact local-run commands
8. exact GitHub steps
9. exact Vercel deployment steps
10. exact Android PWA installation steps
11. first XL2 calibration procedure
12. XL2 validation procedure
13. remaining limitations
14. recommended future native-Android improvements

Do not stop after producing this report unless the actual application has already been implemented and tested.

Begin implementation now.

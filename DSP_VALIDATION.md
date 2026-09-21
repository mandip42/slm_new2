# DSP validation

**This document is generated.** Every number below was produced by executing the
production DSP code in this repository. Regenerate it with:

```bash
npm run report:dsp
```

Generated 2026-09-20T23:57:07.309Z with Node v22.17.0 on win32/x64.

The same measurements are asserted as automated tests in `src/dsp/__tests__`
(`npm test`), so a regression fails the build rather than quietly changing a
document. The interactive equivalent is the developer lab at `/dev/dsp`, which runs
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

### 1.1 Realised digital response against the exact analog prototype

The A and C weightings are IIR filters that run on the sample stream. The table
compares the realised digital magnitude response with the closed-form analog
prototype of IEC 61672-1 at every measured frequency. `delta` is
`digital - analog`.

#### Sample rate 44100 Hz

HF pole placed at **15874 Hz** by numerical minimax optimisation
(analog prototype pole: 12194.2 Hz). Fit range
20 Hz to 12589 Hz.

- Worst A deviation inside the fit range: **0.669 dB**
- Worst A deviation across the whole table (to 20000 Hz): 20.081 dB
- Worst C deviation across the whole table: 20.076 dB

| f (Hz) | A analog | A digital | A delta | C analog | C digital | C delta |
| --- | --- | --- | --- | --- | --- | --- |
| 20 | -50.39 | -50.42 | -0.029 | -6.22 | -6.24 | -0.024 |
| 25 | -44.82 | -44.85 | -0.029 | -4.44 | -4.46 | -0.024 |
| 31.5 | -39.52 | -39.55 | -0.029 | -3.03 | -3.05 | -0.024 |
| 40 | -34.54 | -34.56 | -0.029 | -1.98 | -2.01 | -0.024 |
| 50 | -30.27 | -30.30 | -0.029 | -1.30 | -1.32 | -0.024 |
| 63 | -26.22 | -26.25 | -0.029 | -0.82 | -0.84 | -0.024 |
| 80 | -22.40 | -22.42 | -0.029 | -0.50 | -0.52 | -0.024 |
| 100 | -19.14 | -19.17 | -0.029 | -0.30 | -0.32 | -0.023 |
| 125 | -16.19 | -16.22 | -0.028 | -0.17 | -0.20 | -0.023 |
| 160 | -13.24 | -13.27 | -0.028 | -0.08 | -0.11 | -0.023 |
| 200 | -10.85 | -10.87 | -0.027 | -0.03 | -0.05 | -0.023 |
| 250 | -8.67 | -8.70 | -0.027 | -0.00 | -0.02 | -0.022 |
| 315 | -6.64 | -6.67 | -0.025 | 0.02 | -0.00 | -0.021 |
| 400 | -4.77 | -4.80 | -0.023 | 0.03 | 0.01 | -0.020 |
| 500 | -3.25 | -3.27 | -0.020 | 0.03 | 0.01 | -0.018 |
| 630 | -1.91 | -1.92 | -0.016 | 0.03 | 0.02 | -0.014 |
| 800 | -0.79 | -0.80 | -0.009 | 0.02 | 0.01 | -0.008 |
| 1000 | 0.00 | 0.00 | +0.000 | 0.00 | -0.00 | -0.000 |
| 1250 | 0.58 | 0.59 | +0.014 | -0.03 | -0.02 | +0.013 |
| 1600 | 0.99 | 1.03 | +0.037 | -0.09 | -0.05 | +0.036 |
| 2000 | 1.20 | 1.27 | +0.070 | -0.17 | -0.10 | +0.068 |
| 2500 | 1.27 | 1.39 | +0.119 | -0.30 | -0.18 | +0.117 |
| 3150 | 1.20 | 1.39 | +0.193 | -0.50 | -0.31 | +0.191 |
| 4000 | 0.96 | 1.27 | +0.302 | -0.83 | -0.53 | +0.300 |
| 5000 | 0.55 | 0.99 | +0.436 | -1.29 | -0.85 | +0.434 |
| 6300 | -0.12 | 0.47 | +0.586 | -1.99 | -1.41 | +0.584 |
| 8000 | -1.15 | -0.48 | +0.669 | -3.05 | -2.38 | +0.668 |
| 10000 | -2.49 | -2.04 | +0.455 | -4.41 | -3.95 | +0.454 |
| 12500 | -4.25 | -4.86 | -0.609 | -6.18 | -6.78 | -0.608 |
| 16000 | -6.71 | -11.47 | -4.765 | -8.63 | -13.40 | -4.762 |
| 20000 | -9.35 | -29.43 | -20.081 | -11.28 | -31.35 | -20.076 |

#### Sample rate 48000 Hz

HF pole placed at **15103 Hz** by numerical minimax optimisation
(analog prototype pole: 12194.2 Hz). Fit range
20 Hz to 12589 Hz.

- Worst A deviation inside the fit range: **0.542 dB**
- Worst A deviation across the whole table (to 20000 Hz): 12.347 dB
- Worst C deviation across the whole table: 12.343 dB

| f (Hz) | A analog | A digital | A delta | C analog | C digital | C delta |
| --- | --- | --- | --- | --- | --- | --- |
| 20 | -50.39 | -50.42 | -0.025 | -6.22 | -6.24 | -0.020 |
| 25 | -44.82 | -44.84 | -0.025 | -4.44 | -4.46 | -0.020 |
| 31.5 | -39.52 | -39.55 | -0.025 | -3.03 | -3.05 | -0.020 |
| 40 | -34.54 | -34.56 | -0.025 | -1.98 | -2.00 | -0.020 |
| 50 | -30.27 | -30.30 | -0.025 | -1.30 | -1.32 | -0.020 |
| 63 | -26.22 | -26.24 | -0.024 | -0.82 | -0.84 | -0.020 |
| 80 | -22.40 | -22.42 | -0.024 | -0.50 | -0.52 | -0.020 |
| 100 | -19.14 | -19.17 | -0.024 | -0.30 | -0.32 | -0.020 |
| 125 | -16.19 | -16.21 | -0.024 | -0.17 | -0.19 | -0.020 |
| 160 | -13.24 | -13.27 | -0.024 | -0.08 | -0.10 | -0.020 |
| 200 | -10.85 | -10.87 | -0.023 | -0.03 | -0.05 | -0.019 |
| 250 | -8.67 | -8.70 | -0.023 | -0.00 | -0.02 | -0.019 |
| 315 | -6.64 | -6.66 | -0.021 | 0.02 | 0.00 | -0.018 |
| 400 | -4.77 | -4.79 | -0.020 | 0.03 | 0.01 | -0.017 |
| 500 | -3.25 | -3.26 | -0.017 | 0.03 | 0.02 | -0.015 |
| 630 | -1.91 | -1.92 | -0.014 | 0.03 | 0.02 | -0.012 |
| 800 | -0.79 | -0.80 | -0.008 | 0.02 | 0.01 | -0.007 |
| 1000 | 0.00 | -0.00 | -0.000 | 0.00 | -0.00 | -0.000 |
| 1250 | 0.58 | 0.59 | +0.012 | -0.03 | -0.02 | +0.011 |
| 1600 | 0.99 | 1.02 | +0.032 | -0.09 | -0.06 | +0.031 |
| 2000 | 1.20 | 1.26 | +0.059 | -0.17 | -0.11 | +0.058 |
| 2500 | 1.27 | 1.37 | +0.100 | -0.30 | -0.20 | +0.099 |
| 3150 | 1.20 | 1.36 | +0.163 | -0.50 | -0.34 | +0.161 |
| 4000 | 0.96 | 1.22 | +0.254 | -0.83 | -0.57 | +0.252 |
| 5000 | 0.55 | 0.92 | +0.364 | -1.29 | -0.93 | +0.362 |
| 6300 | -0.12 | 0.37 | +0.484 | -1.99 | -1.51 | +0.482 |
| 8000 | -1.15 | -0.61 | +0.542 | -3.05 | -2.51 | +0.541 |
| 10000 | -2.49 | -2.14 | +0.353 | -4.41 | -4.05 | +0.353 |
| 12500 | -4.25 | -4.75 | -0.496 | -6.18 | -6.67 | -0.495 |
| 16000 | -6.71 | -10.22 | -3.515 | -8.63 | -12.15 | -3.512 |
| 20000 | -9.35 | -21.69 | -12.347 | -11.28 | -23.62 | -12.343 |

### 1.2 Why the high-frequency pole is moved

The A and C networks have a double pole at 12.194 kHz. At a 48 kHz sample rate that
sits at a quarter of the sample rate, where the bilinear transform's frequency
warping is severe. Transforming the prototype directly puts the pole far too low
and the response sags badly. The table below compares the three available pole
placements (`designWeighting(..., placement)`), measured as the worst absolute
deviation from the analog prototype over the fit range.
| fs (Hz) | placement | A HF pole (Hz) | worst A error (dB) | worst C error (dB) |
| --- | --- | --- | --- | --- |
| 44100 | plain bilinear | 12194 | 3.459 | 3.461 |
| 44100 | prewarp | 16595 | 0.845 | 0.843 |
| 44100 | minimax | 15874 | 0.669 | 0.668 |
| 48000 | plain bilinear | 12194 | 2.738 | 2.740 |
| 48000 | prewarp | 15672 | 0.697 | 0.695 |
| 48000 | minimax | 15103 | 0.542 | 0.541 |

`minimax` is the default. The optimisation runs once per sample rate at design
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
filter is fitted to is the right curve.
| f (Hz) | A nominal | A computed | delta | C nominal | C computed | delta |
| --- | --- | --- | --- | --- | --- | --- |
| 31.5 | -39.4 | -39.525 | -0.125 | -3.0 | -3.030 | -0.030 |
| 63 | -26.2 | -26.220 | -0.020 | -0.8 | -0.821 | -0.021 |
| 125 | -16.1 | -16.188 | -0.088 | -0.2 | -0.172 | +0.028 |
| 250 | -8.6 | -8.674 | -0.074 | 0.0 | -0.001 | -0.001 |
| 500 | -3.2 | -3.248 | -0.048 | 0.0 | 0.033 | +0.033 |
| 1000 | 0.0 | 0.000 | +0.000 | 0.0 | 0.000 | +0.000 |
| 2000 | 1.2 | 1.201 | +0.001 | -0.2 | -0.170 | +0.030 |
| 4000 | 1.0 | 0.963 | -0.037 | -0.8 | -0.826 | -0.026 |
| 8000 | -1.1 | -1.147 | -0.047 | -3.0 | -3.047 | -0.047 |
| 16000 | -6.6 | -6.706 | -0.106 | -8.5 | -8.635 | -0.135 |

### 1.4 The filter really operates on the signal

A displayed-offset implementation would pass this section's response checks while
being wrong for anything but a steady tone. To rule that out, a tone is generated,
filtered, and the level change measured on the *signal*.
Measured at 48 kHz on a 3 s tone at -20 dBFS.

| f (Hz) | A measured | A expected | delta | C measured | C expected | delta |
| --- | --- | --- | --- | --- | --- | --- |
| 31.5 | -39.56 | -39.52 | -0.033 | -3.06 | -3.03 | -0.027 |
| 63 | -26.24 | -26.22 | -0.024 | -0.84 | -0.82 | -0.020 |
| 125 | -16.21 | -16.19 | -0.024 | -0.19 | -0.17 | -0.020 |
| 250 | -8.70 | -8.67 | -0.023 | -0.02 | -0.00 | -0.019 |
| 500 | -3.26 | -3.25 | -0.017 | +0.02 | +0.03 | -0.015 |
| 1000 | -0.00 | +0.00 | -0.000 | -0.00 | +0.00 | -0.000 |
| 2000 | +1.26 | +1.20 | +0.059 | -0.11 | -0.17 | +0.058 |
| 4000 | +1.22 | +0.96 | +0.254 | -0.57 | -0.83 | +0.252 |
| 8000 | -0.61 | -1.15 | +0.542 | -2.51 | -3.05 | +0.541 |
| 16000 | -10.22 | -6.71 | -3.515 | -12.15 | -8.63 | -3.512 |

Z weighting is implemented as an empty filter cascade, i.e. a genuine
pass-through, so it introduces no numerical error at all. The optional 10 Hz
DC/infrasound blocker is a separate, user-switchable stage that is reported in the
diagnostics screen rather than folded silently into Z.

---

## 2. Fractional-octave filter bank

Band definitions follow the base-ten system of IEC 61260-1:

    G     = 10^(3/10)
    f_m   = 1000 * G^(x/b)
    edges = f_m * G^(-+1/(2b))

Band levels come from a bank of order-6 Butterworth band-pass filters running at
the full sample rate; the mean square of each band-pass output is the band level.
No band level is ever taken from a single FFT bin.

### 2.1 Filter shape

For each measurable band: gain at the exact midband frequency, gain at both -3 dB
edges, rejection one octave either side, and the largest pole radius (stability
margin; must be below 1).
At 48000 Hz: worst centre-frequency gain error **0.00000 dB**,
worst edge deviation from -3.01 dB **0.0000 dB**, largest pole radius
0.99986434, unstable designs **0**.

| band | f_m (Hz) | gain at f_m | gain at edges | 1 oct below | 1 oct above | max |pole| |
| --- | --- | --- | --- | --- | --- | --- |
| 20 | 20.0 | -0.0000 | -3.01 / -3.01 | -48.8 | -48.8 | 0.99986434 |
| 25 | 25.1 | +0.0000 | -3.01 / -3.01 | -48.8 | -48.8 | 0.99982921 |
| 31.5 | 31.6 | +0.0000 | -3.01 / -3.01 | -48.8 | -48.8 | 0.99978500 |
| 40 | 39.8 | -0.0000 | -3.01 / -3.01 | -48.8 | -48.8 | 0.99972933 |
| 50 | 50.1 | +0.0000 | -3.01 / -3.01 | -48.8 | -48.8 | 0.99965926 |
| 63 | 63.1 | +0.0000 | -3.01 / -3.01 | -48.8 | -48.8 | 0.99957106 |
| 80 | 79.4 | -0.0000 | -3.01 / -3.01 | -48.8 | -48.8 | 0.99946002 |
| 100 | 100.0 | +0.0000 | -3.01 / -3.01 | -48.8 | -48.8 | 0.99932025 |
| 125 | 125.9 | -0.0000 | -3.01 / -3.01 | -48.8 | -48.8 | 0.99914432 |
| 160 | 158.5 | +0.0000 | -3.01 / -3.01 | -48.8 | -48.8 | 0.99892288 |
| 200 | 199.5 | +0.0000 | -3.01 / -3.01 | -48.8 | -48.8 | 0.99864416 |
| 250 | 251.2 | -0.0000 | -3.01 / -3.01 | -48.8 | -48.8 | 0.99829338 |
| 315 | 316.2 | +0.0000 | -3.01 / -3.01 | -48.8 | -48.8 | 0.99785193 |
| 400 | 398.1 | +0.0000 | -3.01 / -3.01 | -48.8 | -48.8 | 0.99729640 |
| 500 | 501.2 | +0.0000 | -3.01 / -3.01 | -48.8 | -48.8 | 0.99659739 |
| 630 | 631.0 | -0.0000 | -3.01 / -3.01 | -48.8 | -48.8 | 0.99571791 |
| 800 | 794.3 | -0.0000 | -3.01 / -3.01 | -48.8 | -48.8 | 0.99461147 |
| 1k | 1000.0 | -0.0000 | -3.01 / -3.01 | -48.7 | -48.9 | 0.99321961 |
| 1.3k | 1258.9 | -0.0000 | -3.01 / -3.01 | -48.7 | -48.9 | 0.99146876 |
| 1.6k | 1584.9 | -0.0000 | -3.01 / -3.01 | -48.7 | -49.1 | 0.98926623 |
| 2k | 1995.3 | -0.0000 | -3.01 / -3.01 | -48.7 | -49.2 | 0.98649492 |
| 2.5k | 2511.9 | +0.0000 | -3.01 / -3.01 | -48.6 | -49.5 | 0.98300614 |
| 3.1k | 3162.3 | +0.0000 | -3.01 / -3.01 | -48.5 | -49.9 | 0.97860962 |
| 4k | 3981.1 | +0.0000 | -3.01 / -3.01 | -48.3 | -50.6 | 0.97305832 |
| 5k | 5011.9 | +0.0000 | -3.01 / -3.01 | -48.1 | -51.8 | 0.96602390 |
| 6.3k | 6309.6 | -0.0000 | -3.01 / -3.01 | -47.7 | -54.0 | 0.95705265 |
| 8k | 7943.3 | -0.0000 | -3.01 / -3.01 | -47.0 | -58.4 | 0.94547651 |
| 10k | 10000.0 | -0.0000 | -3.01 / -3.01 | -45.9 | -70.1 | 0.93020387 |
| 12.5k | 12589.3 | -0.0000 | -3.01 / -3.01 | -44.2 | n/a | 0.91166490 |
| 16k | 15848.9 | +0.0000 | -3.01 / -3.01 | -41.1 | n/a | 0.90233644 |
| 20k | not measured |  |  |  |  |  |

### 2.2 Bands that cannot be measured

A band is only measured when its upper edge stays below
45 % of the sample rate, which keeps the
band-pass transition region clear of the frequency where the bilinear transform
distorts the shape. Unavailable bands are drawn hatched in the application and
flagged in exports; they are never shown as a low level.
| fs (Hz) | 1/3-oct measured | 1/3-oct excluded | octave measured | octave excluded | partial octaves |
| --- | --- | --- | --- | --- | --- |
| 44100 | 30 of 31 | 20k | 10 of 10 | none | 16k |
| 48000 | 30 of 31 | 20k | 10 of 10 | none | 16k |

### 2.3 Band allocation

A tone at each band's exact midband frequency must land in that band and nowhere
else. `neighbour margin` is how far below the signal band the adjacent bands sit.
Tone at -20 dBFS, 3.5 s, 48 kHz.

| band | peak in band? | band Leq (dBFS) | error | margin below | margin above |
| --- | --- | --- | --- | --- | --- |
| 31.5 | yes | -20.00 | -0.00 | 18.3 | 18.3 |
| 63 | yes | -20.00 | +0.00 | 18.3 | 18.3 |
| 125 | yes | -20.00 | -0.00 | 18.3 | 18.3 |
| 250 | yes | -20.00 | -0.00 | 18.3 | 18.3 |
| 500 | yes | -20.00 | -0.00 | 18.3 | 18.3 |
| 1k | yes | -20.00 | +0.00 | 18.3 | 18.3 |
| 2k | yes | -20.00 | +0.00 | 18.3 | 18.2 |
| 4k | yes | -20.00 | -0.00 | 18.5 | 18.0 |
| 8k | yes | -20.00 | +0.00 | 19.0 | 17.2 |
| 16k | yes | -20.00 | -0.00 | 22.1 | n/a |

### 2.4 Energy conservation

Summing every band's energy must reproduce the broadband level. Two cases matter
for different reasons.
| signal | direct broadband (dBFS) | sum of bands (dBFS) | delta |
| --- | --- | --- | --- |
| multi-tone at band centres (125/500/1k/4k) | -20.000 | -19.871 | +0.129 |
| pink noise | -20.019 | -21.033 | -1.014 |
| white noise | -19.997 | -21.124 | -1.127 |

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
band-pass work.

---

## 3. Time weighting

The detector runs on the **squared** weighted signal:

    y[n] = a*y[n-1] + (1-a)*x[n]^2,   a = exp(-1/(tau*fs))
    L[n] = 10*log10(y[n])

This is a true mean-square exponential average at the sample rate. It is not a
moving average of displayed decibel values, which would give a different and wrong
answer for any time-varying signal.

### 3.1 Step response

A first-order mean-square average reaches `1 - 1/e` = 63.2 % of the final mean
square after exactly one time constant, which is `-10*log10(1 - 1/e)` =
1.9920 dB below the steady state.
| detector | tau | shortfall after 1 tau (dB) | expected | delta | steady state (dB) |
| --- | --- | --- | --- | --- | --- |
| Fast | 125 ms | 1.9920 | 1.9920 | +0.0000 | -0.000197 |
| Slow | 1000 ms | 1.9920 | 1.9920 | +0.0000 | -0.000197 |

### 3.2 Decay rate

After one time constant of silence the mean square has fallen by a factor of e,
which is `10*log10(e)` = 4.3429 dB.
| detector | drop after 1 tau (dB) | expected | delta |
| --- | --- | --- | --- |
| Fast | 4.3429 | 4.3429 | -0.0000 |
| Slow | 4.3429 | 4.3429 | -0.0000 |

### 3.3 Impulse weighting

Implemented as a 35 ms exponential rise with the
level decay limited to 2.9 dB/s. This is a faithful
implementation of the described behaviour, but it has **not** been verified against
a certified impulse reference; I readings should be treated as indicative.
| property | measured | expected |
| --- | --- | --- |
| steady state after 250 ms of full level (dB) | -0.0034 | 0.0000 |
| decay over 1 s of silence (dB) | 2.900 | 2.9 |
| hold advantage over Fast, 20 ms burst then 1 s gap (dB) | 19.3 | > 10 |

### 3.4 Not a decibel-domain average

Half a second of tone at -20 dBFS followed by 50 ms of silence. A decibel-domain
moving average would collapse towards the floor; the correct mean-square detector
decays smoothly at the rate set by its time constant.
| quantity | value |
| --- | --- |
| level before the gap (dBFS) | -20.000 |
| level after 50 ms of silence (dBFS) | -21.737 |
| measured drop (dB) | 1.737 |
| expected drop, 10*log10(e)*0.4 (dB) | 1.737 |
| delta (dB) | -0.000 |

---

## 4. Levels, Leq and sound exposure level

### 4.1 Reference convention

    L_dBFS = 20 * log10( rms(x) )

for the normalised sample stream. A full-scale square wave therefore reads 0 dBFS
and a full-scale sine reads -3.01 dBFS. This is stated explicitly because the
calibration offset that converts dBFS to dB SPL is only meaningful together with
it. Conversion happens in exactly one place, `ActiveCalibration`:

    L_SPL = slope * L_dBFS + intercept
| signal | measured (dBFS) | expected |
| --- | --- | --- |
| full-scale sine | -3.0103 | -3.0103 |
| full-scale square | 0.0000 | 0.0000 |
| sine at -20 dBFS nominal | -20.0000 | -20.0000 |
| sine crest factor (peak - rms) | 3.0103 | 3.0103 |

### 4.2 Leq is an energy average

Decibel values are never averaged arithmetically. One second at -20 dBFS followed by
one second at -40 dBFS, measured through the engine:
| quantity | value (dBFS) |
| --- | --- |
| engine LZeq | -22.967 |
| correct energy average | -22.967 |
| delta | +0.000 |
| arithmetic mean of decibels (wrong) | -30.000 |
| error that mistake would introduce | 7.03 |

### 4.3 Engine round trip

A tone of known level through the complete engine, at both supported sample rates.
`LAeq - LZeq` must equal the A weighting at that frequency.
| fs | f (Hz) | LZeq | LAeq-LZeq | A expected | delta | LCeq-LZeq | C delta |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 44100 | 63 | -19.996 | -26.249 | -26.220 | -0.029 | -0.845 | -0.025 |
| 44100 | 125 | -20.000 | -16.213 | -16.188 | -0.026 | -0.197 | -0.025 |
| 44100 | 250 | -20.000 | -8.701 | -8.674 | -0.027 | -0.023 | -0.022 |
| 44100 | 1000 | -20.000 | -0.000 | 0.000 | -0.000 | 0.000 | +0.000 |
| 44100 | 4000 | -20.000 | 1.266 | 0.963 | +0.302 | -0.526 | +0.300 |
| 44100 | 8000 | -20.000 | -0.478 | -1.147 | +0.669 | -2.379 | +0.668 |
| 48000 | 63 | -19.996 | -26.244 | -26.220 | -0.024 | -0.840 | -0.019 |
| 48000 | 125 | -19.999 | -16.211 | -16.188 | -0.023 | -0.193 | -0.021 |
| 48000 | 250 | -20.001 | -8.695 | -8.674 | -0.021 | -0.020 | -0.019 |
| 48000 | 1000 | -20.000 | -0.000 | 0.000 | -0.000 | 0.000 | +0.000 |
| 48000 | 4000 | -20.000 | 1.217 | 0.963 | +0.254 | -0.574 | +0.252 |
| 48000 | 8000 | -20.000 | -0.606 | -1.147 | +0.542 | -2.507 | +0.541 |

### 4.4 Sound exposure level and extremes
| quantity | measured | expected |
| --- | --- | --- |
| integrated duration (s) | 4.099 | 4.000 |
| LAE (SEL) | -13.874 | -13.874 |
| LZpeak - LZeq for a sine (dB) | 3.010 | 3.0103 |
| LAFmax - LAFmin for a steady tone (dB) | 0.085 | ~0 |
| LZpeak for a full-scale square (dBFS) | 0.000 | 0.000 |
| clipping events on a full-scale square | 1 | > 0 |

---

## 5. FFT analyser

FFT spectral levels and octave-band sound pressure levels are different
quantities and are kept in separate modules. The spectrum reports the RMS level of a
tone landing in a bin, scaled by the window's coherent gain so that it uses the same
full-scale reference as the meter.

### 5.1 Tone identification and level
Bin-centred 1 kHz tone at -20 dBFS, Hann window.

| fft size | Hz/bin | frame (ms) | peak level (dBFS) | level error | peak f (Hz) | f error |
| --- | --- | --- | --- | --- | --- | --- |
| 2048 | 23.438 | 42.7 | -20.000 | +0.000 | 1007.81 | +0.000 |
| 4096 | 11.719 | 85.3 | -20.000 | +0.000 | 996.09 | +0.000 |
| 8192 | 5.859 | 170.7 | -20.000 | +0.000 | 1001.95 | +0.000 |
| 16384 | 2.930 | 341.3 | -20.000 | +0.000 | 999.02 | +0.000 |

### 5.2 Window correction factors

Computed from the actual window samples rather than tabulated: `coherentGain`
corrects the amplitude of a tone, `noisePowerBandwidth` corrects broadband
density. Using the wrong one is a classic source of several-decibel errors.
| window | coherent gain | noise bandwidth (bins) |
| --- | --- | --- |
| Hann | 0.49994 | 1.50018 |
| Hamming | 0.53994 | 1.36295 |
| Blackman | 0.41995 | 1.72697 |
| Blackman-Harris | 0.35871 | 2.00460 |
| Flat-top | 0.21555 | 3.77071 |
| Rectangular | 1.00000 | 1.00000 |

### 5.3 Frequency identification across the range
| tone (Hz) | identified (Hz) | error (Hz) | error (%) |
| --- | --- | --- | --- |
| 31.5 | 31.455 | -0.045 | -0.1441 |
| 100.0 | 100.030 | +0.030 | 0.0298 |
| 315.0 | 314.991 | -0.009 | -0.0030 |
| 1000.0 | 1000.045 | +0.045 | 0.0045 |
| 3150.0 | 3150.041 | +0.041 | 0.0013 |
| 8000.0 | 7999.955 | -0.045 | -0.0006 |
| 16000.0 | 16000.045 | +0.045 | 0.0003 |

---

## 6. Statistical acoustics

`Ln` is the level **exceeded n % of the measurement time**, that is the
`(100 - n)`th percentile of the sampled distribution. L90 is therefore a low
(background) level and L10 a high one. The statistical sample is the Fast
time-weighted level taken 20 times per second into 0.1 dB bins, and
percentiles are linearly interpolated inside the containing bin.

### 6.1 Histogram against an exact sorted percentile

A bimodal distribution of 20 000 samples, which is where naive percentile code
breaks.
| level | histogram | exact sort | delta (dB) |
| --- | --- | --- | --- |
| L1 | -30.1766 | -30.1762 | -0.0003 |
| L5 | -30.8557 | -30.8586 | +0.0028 |
| L10 | -31.7134 | -31.7137 | +0.0003 |
| L50 | -54.2619 | -54.2587 | -0.0032 |
| L90 | -58.8461 | -58.8498 | +0.0037 |
| L95 | -59.4227 | -59.4202 | -0.0025 |
| L99 | -59.8873 | -59.8887 | +0.0014 |

### 6.2 A calibration offset shifts every percentile by exactly that offset

This is the property that lets the histogram live in the dBFS domain and be
converted at display time, so changing calibration profile re-derives the
statistics correctly without re-measuring.
| level | dBFS domain | offset by +94.3 | difference |
| --- | --- | --- | --- |
| L1 | -30.424 | 63.876 | 94.3000 |
| L5 | -32.023 | 62.277 | 94.3000 |
| L10 | -34.136 | 60.164 | 94.3000 |
| L50 | -50.225 | 44.075 | 94.3000 |
| L90 | -65.951 | 28.349 | 94.3000 |
| L95 | -67.972 | 26.328 | 94.3000 |
| L99 | -69.634 | 24.666 | 94.3000 |

### 6.3 Ordering and engine integration

A gated burst produces a genuinely spread distribution; a steady tone must collapse
it. Both measured through the full engine.
| signal | L10 | L50 | L90 | L10-L90 | ordered? |
| --- | --- | --- | --- | --- | --- |
| gated burst 0.4 s on / 0.4 s off | -20.28 | -22.50 | -32.34 | 12.06 | yes |
| steady 1 kHz tone | -19.91 | -19.95 | -19.99 | 0.08 | yes |

---

## 7. Noise exposure

Allowed exposure time and dose:

    T(L) = criterionHours * 2 ^ ((criterionLevel - L) / exchangeRate)
    D    = 100 * t / T(L)
    TWA  = criterionLevel + (exchangeRate / log10(2)) * log10(D / 100)

Every assumption of each scheme is declared in the code and shown next to the
numbers in the application. These are educational indicators, not certified
dosimetry, and not medical advice.

### NIOSH-style

Criterion 85 dBA for 8 h, exchange rate
3 dB, threshold none.
Reference: NIOSH Criteria for a Recommended Standard: Occupational Noise Exposure (1998).

Dose and TWA below are for a full 8 hour exposure at the stated level.

| LAeq (dBA) | allowed time | dose (%) | TWA (dBA) | below threshold |
| --- | --- | --- | --- | --- |
| 80 | 25.398 h | 31.5 | 80.00 | no |
| 85 | 8.000 h | 100.0 | 85.00 | no |
| 88 | 4.000 h | 200.0 | 88.00 | no |
| 90 | 2.520 h | 317.5 | 90.00 | no |
| 91 | 2.000 h | 400.0 | 91.00 | no |
| 94 | 1.000 h | 800.0 | 94.00 | no |
| 95 | 47.6 min | 1007.9 | 95.00 | no |
| 100 | 15.0 min | 3200.0 | 100.00 | no |
| 105 | 4.7 min | 10159.4 | 105.00 | no |

### OSHA-style

Criterion 90 dBA for 8 h, exchange rate
5 dB, threshold 80 dBA.
Reference: OSHA 29 CFR 1910.95 occupational noise exposure.

Dose and TWA below are for a full 8 hour exposure at the stated level.

| LAeq (dBA) | allowed time | dose (%) | TWA (dBA) | below threshold |
| --- | --- | --- | --- | --- |
| 80 | 32.000 h | 25.0 | 80.00 | no |
| 85 | 16.000 h | 50.0 | 85.00 | no |
| 88 | 10.556 h | 75.8 | 88.00 | no |
| 90 | 8.000 h | 100.0 | 90.00 | no |
| 91 | 6.964 h | 114.9 | 91.00 | no |
| 94 | 4.595 h | 174.1 | 94.00 | no |
| 95 | 4.000 h | 200.0 | 95.00 | no |
| 100 | 2.000 h | 400.0 | 100.00 | no |
| 105 | 1.000 h | 800.0 | 105.00 | no |

### Exchange-rate behaviour

| property | measured | expected |
| --- | --- | --- |
| NIOSH: dose ratio for +3 dB | 2.000000 | 2.000000 |
| OSHA: dose ratio for +5 dB | 2.000000 | 2.000000 |
| LEX,8h for 4 h at 85 dBA | 81.9897 | 81.9897 |
| LEX,8h for 8 h at 85 dBA | 85.0000 | 85.0000 |

---

## 8. Performance

Cost of processing 10 s of pink noise at 48000 Hz on the machine that
generated this document (Node v22.17.0, win32 x64). A phone is
slower, but the ratios between the stages hold, and the real-time budget is what
matters: the figure to watch is the load percentage.

| stage | wall time (ms) | x real time | load (%) |
| --- | --- | --- | --- |
| MeterEngine (A/C/Z, Fast/Slow/Impulse, Leq, peaks, stats, clipping) | 39.1 | 255.7 | 0.39 |
| 1/3-octave filter bank (30 bands, order 6) | 230.1 | 43.5 | 2.30 |
| FFT spectrum at 15 frames/s, 8192 points, Hann | 70.1 | 142.6 | 0.70 |

The meter runs in an AudioWorklet on the audio rendering thread; the filter bank and
the FFT run in a Web Worker on batched blocks, so a heavy analysis frame cannot
cause an audio dropout. Both loads are reported live on the diagnostics screen, and
the worker reports any samples it had to drop rather than hiding them.

---

## 9. Known limitations of the DSP

These are properties of the implementation, measured above, and are separate from
the limitations of a phone microphone (see `About` in the application):

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

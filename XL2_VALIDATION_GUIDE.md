# XL2 validation protocol

A reproducible experimental protocol for characterising Sonoscope against an
NTi Audio XL2. Calibration makes the numbers agree; validation tells you *how well*
they agree, and that is the difference between a calibrated phone and a characterised
instrument.

Record every experiment in **More → XL2 validation lab**. The lab stores the full
setup alongside the readings and computes mean error, standard deviation, RMSE, worst
absolute error and a 95 % interval from your data.

Run these **after** completing [CALIBRATION_GUIDE.md](CALIBRATION_GUIDE.md). A
validation against an uncalibrated app just measures the missing offset.

---

## The thing that will dominate your results

Two microphones at different points in a real sound field do not measure the same
thing. Reflections create an interference pattern whose level varies by several
decibels over a wavelength:

| Frequency | Wavelength | Half wavelength |
| --- | --- | --- |
| 100 Hz | 3.4 m | 1.7 m |
| 1 kHz | 34 cm | 17 cm |
| 4 kHz | 8.6 cm | 4.3 cm |
| 8 kHz | 4.3 cm | 2.1 cm |

At 4 kHz, moving one microphone by 4 cm can move its reading by several decibels for
reasons that have nothing to do with either instrument. In most rooms this is the
largest error in the whole exercise — larger than the phone.

Therefore:

- Put the two microphone inlets as close together as physically possible without one
  shadowing the other. Aim for 2–5 cm, side by side, both facing the source.
- Support both mechanically. Never hold either by hand during a reading.
- Do not move anything between the paired readings.
- Choose a space with few reflections. Outdoors away from walls, or a treated room. A
  bathroom is the worst case.
- Keep the source distance well above the microphone separation: 1–2 m from a
  loudspeaker with 3 cm separation is a sensible ratio.
- Repeat each comparison at least three times and keep all three. The scatter is
  data, not noise to be averaged away by hand.

Record background noise before you start. If the background is within 10 dB of your
measurement level, it is contributing; within 3 dB, it dominates.

---

## Recording setup metadata

The lab has fields for source, distance, phone orientation, reference orientation,
environment and notes. Fill them in. A month later, a set of readings with no setup
record cannot be interpreted or repeated.

A complete setup record looks like:

- **Source**: Pink noise, Genelec 8030 at 1.0 m, 78 dBA nominal
- **Distance**: 1.0 m
- **Phone orientation**: Bottom edge toward source, screen up, no case, mic inlet at
  reference mic height
- **Reference orientation**: XL2 microphone axis toward source, 3 cm to the left of
  the phone mic inlet, same height
- **Environment**: Treated listening room, background 31 dBA, no HVAC
- **Notes**: Phone on foam block, XL2 on tripod, both undisturbed for the whole set

---

## Experiment 1 — Broadband level agreement

**Purpose:** does the calibration hold across the level range?

**Lab experiment type:** `Experiment 1 - Broadband level agreement`

**Setup:** pink noise from a loudspeaker. Both instruments A-weighted, Slow.

**Procedure**

1. Set the source so the XL2 reads approximately 45 dBA.
2. Let both stabilise for at least 10 seconds.
3. Capture in Sonoscope (10 s window), read the XL2, record the comparison.
4. Repeat three times without changing anything.
5. Raise the level by roughly 10 dB and repeat, through 55, 65, 75, 85 and 95 dBA as
   far as is practical and safe.

> **Hearing protection.** 95 dBA is loud. NIOSH allows about 47 minutes per day at
> that level. Use hearing protection, keep exposures short, and do not run the high
> levels any longer than the measurement needs.

**Expected outcome**

| Figure | Good | Investigate |
| --- | --- | --- |
| Mean error | within ±1 dB | beyond ±2 dB |
| Standard deviation | < 1 dB | > 1.5 dB |
| Worst absolute error | < 2 dB | > 3 dB |

**Interpretation**

- A **constant** error at all levels means the offset is slightly off. Redo the
  single-point calibration.
- Error that **grows with level** means the phone is compressing near the top. Note
  the level where it starts; that is the real upper limit of the device, and the
  multi-level calibration's verified range should not extend past it.
- Error that **grows as level falls** means you are approaching the noise floor. Note
  the lower limit the same way.
- Large **scatter** at a fixed level means the sound field or the geometry, not the
  phone. Fix the setup before drawing conclusions.

---

## Experiment 2 — Frequency response

**Purpose:** how well does the frequency correction work, and where does it stop
working?

**Lab experiment type:** `Experiment 2 - Frequency response`

**Setup:** one-third-octave band-limited noise or a steady tone, at 70–85 dB. Both
instruments **Z** weighted. This is critical: comparing with A weighting on either
instrument measures the weighting curves rather than the microphone response.

**Procedure**

For each of 63, 125, 250, 500, 1000, 2000, 4000 and 8000 Hz:

1. Set the source, let it stabilise.
2. Capture, read the XL2, record with the frequency entered.
3. Do not move anything between the two readings.

Extend to 31.5 Hz and 16 kHz if your source can produce a clean level there.

**Expected outcome with the correction applied**

| Range | Good | Investigate |
| --- | --- | --- |
| 125 Hz – 4 kHz | within ±1.5 dB | beyond ±3 dB |
| 63 Hz and 8 kHz | within ±3 dB | beyond ±5 dB |
| 31.5 Hz and 16 kHz | within ±5 dB | beyond ±8 dB |

Without the correction the mid band should still be reasonable; the extremes will not
be.

**Interpretation**

- Residual error at a frequency you calibrated at means the source or geometry
  changed between calibration and validation.
- Error between calibrated frequencies means the log-frequency interpolation is
  missing real structure in the response. Add a calibration point there.
- Error above your highest calibrated frequency is expected: the correction is held
  flat and the region is marked uncalibrated. Note also that the digital A/C
  weighting filters have their own deviation up there — see `DSP_VALIDATION.md` §1 —
  so use Z weighting to separate the microphone's error from the filter's.

---

## Experiment 3 — A weighting

**Purpose:** does the A weighting agree on a real broadband signal?

**Lab experiment type:** `Experiment 3 - A weighting`

**Setup:** pink noise at a fixed comfortable level, both instruments **A** weighted,
Slow.

**Procedure**

1. Record three comparisons of LAeq on pink noise.
2. Switch the source to white noise and record three more. White noise has far more
   high-frequency energy, so it stresses the part of the weighting curve where the
   digital filter deviates most.
3. If available, repeat with speech-shaped noise.

**Expected outcome:** mean error within ±1 dB for pink noise. White noise may show a
slightly larger error because more of its energy sits above 8 kHz where both the
microphone and the weighting filter are least accurate.

**Cross-check without the reference:** on the same signal, compare Sonoscope's LAeq
against its own LZeq. The difference is the A-weighted attenuation of that signal's
spectrum, and it should be consistent between the two instruments even if the
absolute levels differ.

---

## Experiment 4 — C weighting

**Purpose:** does the C weighting agree, particularly at low frequency?

**Lab experiment type:** `Experiment 4 - C weighting`

**Setup:** both instruments **C** weighted, Slow.

**Procedure**

1. Three comparisons of LCeq on pink noise.
2. Three comparisons on a low-frequency-heavy source (bass-heavy music, or pink noise
   low-pass filtered at 250 Hz). C weighting is nearly flat where A is steeply
   attenuating, so this is where the two weightings genuinely differ.
3. Record `LCeq − LAeq` for each signal on both instruments. That difference is a
   useful spectral descriptor and should agree between instruments even when absolute
   levels do not.

**Expected outcome:** mean error within ±1 dB on pink noise. Larger error on the
low-frequency source is expected and informative — it tells you how far the phone's
bass response can be trusted after correction.

---

## Experiment 5 — Time response

**Purpose:** do the Fast and Slow detectors behave the same way as the reference on
changing signals?

**Lab experiment type:** `Experiment 5 - Time response`

**Setup:** a gated source. A 1 kHz tone or pink noise switched on and off.

**Procedure**

1. **Steady state.** Continuous source. LAF and LAS should read the same on both
   instruments. Record one comparison for each.
2. **Slow modulation.** 2 s on, 2 s off. Record the maximum LAF and the maximum LAS
   on both. LAFmax should be close to the steady-state level; LASmax should be
   slightly lower because 2 s is only two Slow time constants.
3. **Fast modulation.** 200 ms on, 800 ms off. Record LAFmax and LASmax. Now the
   difference should be large: Fast nearly reaches the steady level, Slow falls well
   short.
4. **Single burst.** One 20 ms burst. Record LAFmax, LASmax and LAImax. Expect
   `LAImax > LAFmax > LASmax`, because Impulse holds and Slow barely responds.
5. **Decay.** Cut a continuous source and watch the fall. Fast should drop about
   4.3 dB in the first 125 ms, Slow about 4.3 dB in the first second.

**Expected outcome:** the *relationships* should hold exactly; absolute agreement
within ±2 dB on maxima is good, since a maximum is a single instant and the two
instruments will not sample it identically.

**Note:** Sonoscope's Impulse weighting has not been verified against a certified
impulse reference. Treat step 4's I readings as indicative and record whatever
disagreement you find.

---

## Experiment 6 — Octave bands

**Purpose:** do the band levels agree?

**Lab experiment type:** `Experiment 6 - Octave bands`

Requires the XL2 to be configured for octave or one-third-octave analysis.

**Setup:** pink noise at a fixed level. Both instruments Z-weighted bands.

**Procedure**

1. Set Sonoscope to 1/1 octave and Z band pre-weighting.
2. Start a measurement and let it integrate for at least 30 seconds so band Leq is
   stable.
3. For each octave band from 63 Hz to 8 kHz, record the pair, entering the band
   centre frequency.
4. Repeat for 1/3 octave if the XL2 is configured for it.

**Expected outcome with the frequency correction applied:** within ±2 dB from 125 Hz
to 4 kHz, within ±3 dB at 63 Hz and 8 kHz.

**Cross-checks that do not need the reference at all:**

- Sum Sonoscope's band Leq values in the energy domain and compare against its own
  broadband LZeq. The octave screen shows this directly under **Broadband from
  bands**. They should agree within a few tenths of a decibel, less whatever energy
  falls outside the measured bands.
- Pink noise should give an approximately flat 1/3-octave spectrum; white noise should
  rise about 1 dB per band. If either is wrong, the problem is in the analysis, not
  the microphone.

---

## Recording, analysing and reporting

The validation lab computes, per experiment and across all experiments:

| Figure | What it means |
| --- | --- |
| Mean error | Bias. A calibration can remove this. |
| Standard deviation | Scatter. A calibration cannot remove this. |
| RMSE | Combined bias and scatter — the single best summary |
| Worst absolute error | The worst case you actually observed |
| 95 % interval | mean ± 1.96 σ, shown once there are at least 3 comparisons |

Error is always **Sonoscope minus reference**, so positive means the phone reads
high.

Two plots are drawn: **agreement** (phone against reference with the ideal y = x line
and a ±1 dB band) and **error against level or frequency**, where a trend rather than
scatter indicates a systematic problem.

**Distinguishing bias from scatter matters.** A mean error of +2 dB with a standard
deviation of 0.3 dB is a calibration that needs adjusting — easy to fix. A mean error
of 0 dB with a standard deviation of 3 dB is a measurement setup that is not
controlled, or a device that is not repeatable, and no calibration will help.

Export everything: **Export all experiments and profiles (JSON)** in the lab, or CSV
per experiment. The CSV carries the full setup in its header comments, so a file found
later is still interpretable.

---

## A realistic expectation

With a careful calibration and a controlled setup, a modern phone running Sonoscope
can typically achieve, over 125 Hz – 4 kHz and 50–90 dB SPL:

- mean error within ±1 dB
- standard deviation under 1 dB
- worst case within 2–3 dB

That is genuinely useful for relative measurements, for surveys, for finding problems
and for teaching. It is not a Class 1 instrument, it should not be used where one is
required, and the figures above are what *your* validation should establish for
*your* device rather than something to assume.

Record what you measure. That is the entire point of the exercise.

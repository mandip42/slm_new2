# Calibration guide

How to calibrate Sonoscope against an NTi Audio XL2, and how to know when you have
done it well enough to trust the result.

---

## What calibration can and cannot do

A phone microphone reports digital amplitude. The path from that to sound pressure
depends on the microphone element, the port geometry, the case, the analog front end
and whatever the browser does to the stream. Calibration measures that path once, at
the levels and frequencies you actually check.

It establishes:

- an offset, so levels can be shown in dB SPL instead of dBFS
- optionally a slope, so the offset stays right across a range of levels
- optionally a per-frequency correction, so band and spectrum levels account for the
  microphone's response

It does **not** establish:

- accuracy at levels or frequencies you did not check
- directional response
- behaviour with a different case, a different browser, or a different phone
- compliance with any measurement standard

Calibration improves accuracy. It does not turn the device into a certified
instrument.

---

## Before you start

**Check the diagnostics screen first.** Open **More → Input diagnostics** and confirm:

| Item | What you want |
| --- | --- |
| Automatic gain control | `disabled` |
| Noise suppression | `disabled` |
| Echo cancellation | `disabled` |
| Channels | 1 |
| Graph sample rate | 48000 Hz (44100 is fine too) |
| Device sample rate | the same as the graph, or "not reported" |

If automatic gain control shows `ACTIVE`, stop. AGC changes the gain in response to
the signal, which makes level measurement meaningless, and no calibration can undo
it. Try a different browser (Chrome and Edge on Android generally honour the request),
and check for system-level audio enhancements in the phone's sound settings.

If a flag shows `not reported`, the browser will not tell you. Proceed, but treat the
result as less certain, and note that the profile records this.

**Physical setup:**

- Remove any case that covers the microphone port. Find the port — usually a pinhole
  on the bottom edge — and keep your fingers off it.
- Note the phone's orientation and keep it identical throughout. A phone is not
  omnidirectional; rotating it by 90° can change the reading by a decibel or more at
  higher frequencies.
- Position the phone microphone and the XL2 microphone as close together as
  physically possible without one shadowing the other. A few centimetres apart, both
  pointing the same way, is a reasonable compromise.
- Support both. Holding either one by hand introduces handling noise and moves the
  geometry between readings.

**Source:** use something steady. In order of preference:

1. An acoustic calibrator on the XL2 for its own reference, then a stable broadband
   source for the comparison.
2. Continuous pink noise from a loudspeaker, in a room with few reflections.
3. A continuous 1 kHz tone.

Do **not** use environmental noise — traffic, an office, a plant room. The two
microphones will not measure the same thing, and the disagreement you record will be
mostly the sound field, not the phone.

---

## Step 1 — Create a profile

**More → Calibration → New profile**

Name it something you will recognise later, because a profile is only valid for one
device, one browser and one sample rate. `Pixel 7 Chrome no case` beats
`Calibration 1`.

Record the XL2's serial number if you have more than one reference. The profile
automatically captures the device model, browser, sample rate, input device label,
and whether device audio processing could be confirmed disabled.

If you later open the profile on a different phone or browser, Sonoscope flags it
as a device mismatch and tells you exactly what differs. It does not stop you using
it, because sometimes that is deliberate, but the numbers should not be trusted.

---

## Step 2 — Single-point level calibration

**Calibration → Single-point level calibration → Run**

This fixes the offset. It takes about a minute.

1. Set the XL2 to the same weighting and time weighting shown in the wizard. **Slow**
   is recommended: it averages more, which makes the two instruments easier to match.
2. Start the source and let it stabilise.
3. Start the XL2 measuring, and at the same moment tap **Capture** in Sonoscope.
4. Sonoscope averages over the capture window — 10 seconds by default — in the
   energy domain, exactly the way Leq is computed. It is not taking a single
   instantaneous reading.
5. Read the XL2's level and type it in.
6. Check the stability badge. If the capture says `range 2.4 dB` rather than
   `stable`, the source was not steady or something moved. Recapture; a calibration
   built on an unstable capture carries that uncertainty forever.
7. Save.

Levels across the whole application immediately become dB SPL, and the status bar
shows `CAL ✓`.

**Choosing a level:** somewhere in the middle of the range you care about, typically
65–85 dB. Well above the phone's noise floor (~30 dBA) and well below where its front
end starts compressing.

### What you have established

Accuracy at that one level, at whatever frequency content the source had. Nothing
more. The quality report will say so:

> Overall level: Single point, offset +94.32 dB
> No verified level range: a single point cannot establish one.

---

## Step 3 — Multi-level linearity

**Calibration → Multi-level linearity → Run**

This is what turns an offset into a characterised instrument. It answers two
questions a single point cannot: is the response linear, and over what range have you
actually verified it?

Aim for 45, 55, 65, 75, 85 and 95 dB, as far as is practical and safe. Change the
level by changing the source output or the distance — never by moving only one of the
two microphones.

For each point: capture, type the XL2 reading, tap **Add point**.

Sonoscope fits `SPL = slope · dBFS + intercept` by ordinary least squares and
reports:

| Figure | What it tells you | What to want |
| --- | --- | --- |
| Slope | Whether a dB change at the reference is a dB change on the phone | within 0.05 of 1.0 |
| Intercept | The offset | any value |
| R² | How much of the variation the straight line explains | > 0.999 |
| RMSE | Typical residual | < 0.5 dB |
| Worst residual | The single worst point | < 1 dB |
| Verified range | The span you actually measured | as wide as practical |

Two plots are drawn: **agreement** (phone estimate against reference, with the ideal
y = x line and a ±1 dB band) and **residual against level**, which is where
non-linearity actually shows up as a slope or a curve rather than scatter.

### If the slope is not 1

Sonoscope warns you and applies the fitted slope rather than a constant offset. A
slope of 1.05 means 1 dB of error over a 20 dB span, which is why a constant offset
would be wrong away from the calibration level.

Before accepting a non-unity slope, rule out the mundane causes: automatic gain
control that is actually enabled (check diagnostics again), the phone clipping at the
top of the range, the noise floor lifting the bottom of the range, or the source not
being steady during one of the captures. A genuinely non-linear microphone is
possible but less likely than any of those.

### If one point is an outlier

A residual over 2 dB usually means a mistyped reference reading, a microphone that
moved, or a source that drifted during that capture. Remove the point and redo it.

---

## Step 4 — Frequency-response correction

**Calibration → Frequency response → Run**

Requires a level calibration first, and the wizard refuses to start without one: the
correction is the difference between the reference reading and Sonoscope's
*calibrated* level. Without the offset, every correction point would absorb the
missing offset and the whole curve would be wrong.

For each frequency:

1. Set the source to that frequency at a comfortable level (70–85 dB).
2. Set the XL2 to **Z** (flat) weighting. Both instruments must be flat, or you are
   comparing weighting curves rather than microphone response.
3. Capture, type the XL2 level, add the point.
4. Do not move anything between the two readings.

Suggested frequencies: 31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000 Hz. The
wizard ticks them off as you go. Working from 63 Hz to 8 kHz gives a useful correction
for most phones; the extremes are where phones are worst and where a loudspeaker is
least likely to give you a clean level.

Sonoscope computes `Correction(f) = Reference(f) − Sonoscope(f)` and interpolates
**linearly in log-frequency** between measured points. Outside the measured range it
holds the correction flat at the nearest measured value and marks the region as
uncalibrated — it never extrapolates a trend, because extrapolating a rising or
falling response past the last measurement is how correction curves invent data.

### Judging the curve

| Figure | Meaning | Concern threshold |
| --- | --- | --- |
| Points | How many frequencies measured | fewer than 6 is thin |
| Validated range | Lowest to highest measured | narrower is weaker |
| Largest gap | Biggest spacing between points, in octaves | > 1.2 octaves |
| Largest correction | The biggest single correction | > 12 dB is suspicious |

A correction over 12 dB in the mid band usually means a shadowed microphone, an
unsteady source, or the XL2 left on A weighting. Check before trusting it.

### Using the correction

Settings → the **Apply frequency-response correction** toggle on the calibration
screen. When active it corrects octave, one-third-octave and spectrum levels, and
bands outside the calibrated range are drawn in violet and labelled.

The octave screen also offers a **frequency-corrected broadband level**, computed by
correcting each band and re-summing the energy. That is the defensible way to apply a
frequency correction to a broadband number: a single correction value cannot be right
for a broadband signal, because the right value depends on where the energy is.

---

## Step 5 — Validate

Calibrating until the numbers match tells you the numbers match. It does not tell you
how far off they are the next time. For that, run the experiments in
[XL2_VALIDATION_GUIDE.md](XL2_VALIDATION_GUIDE.md) and record them in the validation
lab.

Once at least three independent comparisons exist, the calibration status becomes
**VALIDATED** and the quality report shows a measured mean error, standard deviation,
RMSE, worst error and a 95 % interval — figures derived from your own data, not from
assumption.

---

## Reading the quality report

**Calibration → Current status**

```
CALIBRATION STATUS        VALIDATED
Reference                 NTi Audio XL2
Overall level             6-point fit, offset +94.28 dB, slope 1.0031
                          Verified from 47 to 93 dB
Linearity                 slope 1.0031, R² 0.99962
                          RMSE 0.31 dB, worst residual 0.58 dB over 6 points
Frequency correction      Validated 63 Hz to 8 kHz
                          9 points, mean correction 2.4 dB, largest 6.1 dB
Mean error                +0.2 dB
                          From 14 validation measurements, standard deviation 0.71 dB
Maximum observed error    1.6 dB
                          95 % of errors between -1.2 and +1.6 dB
Calibration age           12 days old
```

Every figure is computed from stored data. Where a figure cannot be computed it says
so instead of showing a plausible number.

The four statuses are cumulative:

| Status | Meaning |
| --- | --- |
| `UNCALIBRATED` | No level calibration. Levels are dBFS. |
| `LEVEL CALIBRATED` | Levels are dB SPL. Frequency response uncorrected. |
| `FREQUENCY CALIBRATED` | Level and frequency response both calibrated. |
| `VALIDATED` | Plus independent comparison measurements recorded. |

---

## Maintenance

- **Re-check every 90 days.** After that Sonoscope flags the calibration as stale
  in the quality report and in the validity indicator. A single-point check against
  the XL2 is enough to confirm nothing has drifted.
- **Re-calibrate after** a case change, a browser update that alters the audio
  pipeline, an OS update, or any repair involving the microphone.
- **Export your profiles.** Calibration → Backup → Export all profiles. A profile
  represents real work with a reference instrument; losing the phone should not mean
  losing it. Imported profiles always get a new identifier, so an import can never
  overwrite an existing calibration.
- **One profile per configuration.** Keep separate profiles for "with case" and
  "without case" rather than recalibrating one profile back and forth, and let the
  active-profile selector do the switching.

---

## Troubleshooting

**The calibrated level is wildly wrong (tens of decibels).**
Check the sample rate has not changed since calibration — the profile records it and
flags a mismatch. Check you have the intended profile active.

**The reading drifts upward or downward over a minute with a steady source.**
Automatic gain control. Check diagnostics.

**Readings jump by several decibels when you move the phone slightly.**
That is the sound field, not the phone. You are in a reflective space; move closer to
the source, use a more absorptive room, or accept the uncertainty and record it.

**The capture stability badge never says `stable`.**
The source is not steady, something is moving, or the level is close to the phone's
noise floor. Increase the level, fix the geometry, or use a longer capture window.

**Low frequencies read far too low.**
Expected. Phone microphones and their ports roll off in the bass, and the 10 Hz
DC/infrasound blocker removes everything below the Z-weighting band. The frequency
correction can compensate over the range you measure.

**High frequencies disagree badly.**
Above roughly 10 kHz you are fighting three things at once: the phone's response, the
case, and the digital weighting filter's own deviation (see `DSP_VALIDATION.md` §1).
Positioning matters far more at these frequencies because the wavelength is short.

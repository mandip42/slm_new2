/**
 * Printable HTML measurement report.
 *
 * A self-contained HTML document with inline styles and inline SVG charts. It
 * opens in a new tab and prints (or "saves as PDF" through the browser's own
 * print dialogue) with no extra dependency and no server round trip, which is
 * why this is preferred over pulling in a client-side PDF library.
 */

import { LEVEL_FLOOR_DB } from '@/dsp/levels';
import {
  formatDateTime,
  formatDuration,
  formatFrequency,
  formatLevel,
  isMeasurable,
  NO_VALUE,
} from '@/lib/format';
import type { SessionRecord, SessionSeries } from '@/storage/types';

const CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 28px 32px 48px;
  font: 13px/1.5 "Segoe UI", system-ui, -apple-system, sans-serif;
  color: #16202b; background: #fff;
}
h1 { font-size: 22px; margin: 0 0 2px; letter-spacing: -0.01em; }
h2 { font-size: 14px; margin: 26px 0 8px; text-transform: uppercase; letter-spacing: 0.08em; color: #4a5b6d; border-bottom: 1px solid #d8e0e8; padding-bottom: 4px; }
.sub { color: #5b6b7c; font-size: 12px; margin: 0 0 4px; }
.banner { border-left: 3px solid #b45309; background: #fffbeb; color: #7c2d12; padding: 8px 12px; margin: 12px 0; font-size: 12px; }
.banner.info { border-left-color: #0369a1; background: #f0f9ff; color: #0c4a6e; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
.metric { border: 1px solid #dde4ec; border-radius: 6px; padding: 8px 10px; }
.metric .k { font-size: 10px; text-transform: uppercase; letter-spacing: 0.07em; color: #6b7b8c; }
.metric .v { font-size: 20px; font-variant-numeric: tabular-nums; font-weight: 600; }
.metric .u { font-size: 11px; color: #6b7b8c; margin-left: 3px; font-weight: 400; }
table { border-collapse: collapse; width: 100%; font-size: 12px; }
th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid #e6ecf2; }
th { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7b8c; }
td.n { text-align: right; font-variant-numeric: tabular-nums; }
.kv { display: grid; grid-template-columns: minmax(160px, auto) 1fr; gap: 2px 16px; font-size: 12px; }
.kv dt { color: #6b7b8c; }
.kv dd { margin: 0; }
figure { margin: 8px 0 0; }
figcaption { font-size: 11px; color: #6b7b8c; margin-top: 4px; }
.foot { margin-top: 32px; padding-top: 10px; border-top: 1px solid #d8e0e8; font-size: 11px; color: #6b7b8c; }
@media print {
  body { padding: 0; font-size: 11px; }
  h2 { margin-top: 16px; }
  .noprint { display: none; }
}
.noprint button { font: inherit; padding: 6px 14px; border: 1px solid #94a3b8; background: #f1f5f9; border-radius: 5px; cursor: pointer; }
`;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function metric(label: string, value: string, unit: string): string {
  return `<div class="metric"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}<span class="u">${escapeHtml(unit)}</span></div></div>`;
}

/** Inline SVG line chart of the level history. */
function historyChart(
  series: SessionSeries | null,
  unit: string,
  width = 720,
  height = 200
): string {
  if (!series || series.elapsed.length < 2) {
    return '<p class="sub">No time series was recorded for this measurement.</p>';
  }

  const padding = { left: 44, right: 10, top: 10, bottom: 24 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < series.LAF.length; i++) {
    const v = series.LAF[i];
    if (!isMeasurable(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return '<p class="sub">The recorded time series contains no measurable levels.</p>';
  }
  const span = Math.max(10, max - min);
  const yMin = Math.floor((min - span * 0.1) / 5) * 5;
  const yMax = Math.ceil((max + span * 0.1) / 5) * 5;
  const duration = series.elapsed[series.elapsed.length - 1] || 1;

  const x = (t: number) => padding.left + (t / duration) * plotW;
  const y = (v: number) => padding.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const path = (data: Float32Array): string => {
    let d = '';
    let open = false;
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (!isMeasurable(v)) {
        open = false;
        continue;
      }
      const px = x(series.elapsed[i]).toFixed(1);
      const py = y(v).toFixed(1);
      d += `${open ? 'L' : 'M'}${px} ${py}`;
      open = true;
    }
    return d;
  };

  const gridLines: string[] = [];
  const step = (yMax - yMin) / 4;
  for (let i = 0; i <= 4; i++) {
    const value = yMin + step * i;
    const py = y(value).toFixed(1);
    gridLines.push(
      `<line x1="${padding.left}" y1="${py}" x2="${width - padding.right}" y2="${py}" stroke="#e6ecf2"/>` +
        `<text x="${padding.left - 6}" y="${py}" text-anchor="end" dominant-baseline="middle" font-size="9" fill="#6b7b8c">${value.toFixed(0)}</text>`
    );
  }

  const timeTicks: string[] = [];
  for (let i = 0; i <= 4; i++) {
    const t = (duration / 4) * i;
    const px = x(t).toFixed(1);
    timeTicks.push(
      `<text x="${px}" y="${height - 8}" text-anchor="middle" font-size="9" fill="#6b7b8c">${formatDuration(t)}</text>`
    );
  }

  return `<figure><svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Level history">
  <rect x="${padding.left}" y="${padding.top}" width="${plotW}" height="${plotH}" fill="#fafcfe" stroke="#dde4ec"/>
  ${gridLines.join('')}
  <path d="${path(series.LAF)}" fill="none" stroke="#0284c7" stroke-width="1"/>
  <path d="${path(series.LAeq)}" fill="none" stroke="#b45309" stroke-width="1.4"/>
  ${timeTicks.join('')}
</svg><figcaption>LAF (blue) and running LAeq (amber), ${escapeHtml(unit)}. Gaps indicate periods with no measurable level.</figcaption></figure>`;
}

/** Inline SVG bar chart of band levels. */
function bandChart(
  session: SessionRecord,
  which: 'octave' | 'thirdOctave',
  width = 720,
  height = 200
): string {
  const bands = which === 'octave' ? session.octave : session.thirdOctave;
  if (!bands || bands.bands.length === 0) return '';

  const padding = { left: 44, right: 10, top: 10, bottom: 30 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const values = bands.leq.filter((v) => isMeasurable(v));
  if (values.length === 0) return '';
  const max = Math.ceil(Math.max(...values) / 5) * 5 + 5;
  const min = Math.floor(Math.min(...values) / 5) * 5 - 5;
  const range = Math.max(10, max - min);

  const slot = plotW / bands.bands.length;
  const barWidth = slot * 0.72;

  const bars: string[] = [];
  const labels: string[] = [];
  bands.bands.forEach((band, i) => {
    const value = bands.leq[i];
    const cx = padding.left + slot * (i + 0.5);
    if (isMeasurable(value)) {
      const h = ((value - min) / range) * plotH;
      bars.push(
        `<rect x="${(cx - barWidth / 2).toFixed(1)}" y="${(padding.top + plotH - h).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" fill="${band.available ? '#0284c7' : '#cbd5e1'}"/>`
      );
    }
    const showLabel = which === 'octave' || i % 3 === 0;
    if (showLabel) {
      labels.push(
        `<text x="${cx.toFixed(1)}" y="${height - 16}" text-anchor="middle" font-size="8" fill="#6b7b8c">${escapeHtml(band.label)}</text>`
      );
    }
  });

  const gridLines: string[] = [];
  for (let i = 0; i <= 4; i++) {
    const value = min + (range / 4) * i;
    const py = (padding.top + plotH - ((value - min) / range) * plotH).toFixed(1);
    gridLines.push(
      `<line x1="${padding.left}" y1="${py}" x2="${width - padding.right}" y2="${py}" stroke="#e6ecf2"/>` +
        `<text x="${padding.left - 6}" y="${py}" text-anchor="end" dominant-baseline="middle" font-size="9" fill="#6b7b8c">${value.toFixed(0)}</text>`
    );
  }

  const title = which === 'octave' ? 'Octave band Leq' : 'One-third-octave band Leq';
  return `<figure><svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${title}">
  <rect x="${padding.left}" y="${padding.top}" width="${plotW}" height="${plotH}" fill="#fafcfe" stroke="#dde4ec"/>
  ${gridLines.join('')}
  ${bars.join('')}
  ${labels.join('')}
  <text x="${width / 2}" y="${height - 3}" text-anchor="middle" font-size="9" fill="#6b7b8c">Nominal band centre frequency (Hz)</text>
</svg><figcaption>${title}, ${escapeHtml(bands.calibrated ? 'dB SPL' : 'dBFS')}, ${escapeHtml(bands.weighting)}-weighted band signal. Grey bars are bands that could not be measured at this sample rate.</figcaption></figure>`;
}

function summarySection(session: SessionRecord): string {
  const s = session.summary;
  const unit = s.calibrated ? 'dB' : 'dBFS';
  const items = [
    metric('Duration', formatDuration(s.durationSeconds), ''),
    metric('LAeq', formatLevel(s.LAeq), unit),
    metric('LCeq', formatLevel(s.LCeq), unit),
    metric('LZeq', formatLevel(s.LZeq), unit),
    metric('LAFmax', formatLevel(s.LAFmax), unit),
    metric('LASmax', formatLevel(s.LASmax), unit),
    metric('LAFmin', formatLevel(s.LAFmin), unit),
    metric('LCpeak', formatLevel(s.LCpeak), unit),
    metric('LZpeak', formatLevel(s.LZpeak), unit),
    metric('LAE (SEL)', formatLevel(s.LAE), unit),
  ];
  if (s.percentiles) {
    items.push(metric('L10', formatLevel(s.percentiles.L10), unit));
    items.push(metric('L50', formatLevel(s.percentiles.L50), unit));
    items.push(metric('L90', formatLevel(s.percentiles.L90), unit));
  }
  return `<div class="grid">${items.join('')}</div>`;
}

function percentileTable(session: SessionRecord): string {
  const p = session.summary.percentiles;
  if (!p) {
    return '<p class="sub">Statistical levels were not available for this measurement (it was shorter than one second).</p>';
  }
  const unit = session.summary.unit;
  const rows = Object.entries(p)
    .map(
      ([key, value]) =>
        `<tr><td>${escapeHtml(key)}</td><td class="n">${formatLevel(value)}</td><td>${escapeHtml(unit)}</td><td>${escapeHtml(exceedanceDescription(key))}</td></tr>`
    )
    .join('');
  return `<table><thead><tr><th>Level</th><th class="n">Value</th><th>Unit</th><th>Meaning</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function exceedanceDescription(key: string): string {
  const n = Number(key.replace('L', ''));
  if (!Number.isFinite(n)) return '';
  return `Exceeded ${n} % of the measurement time`;
}

function metadataSection(session: SessionRecord): string {
  const c = session.calibration;
  const entries: Array<[string, string]> = [
    ['Session', session.name],
    ['Session id', session.id],
    ['Started', formatDateTime(session.startedAt)],
    ['Ended', session.endedAt ? formatDateTime(session.endedAt) : NO_VALUE],
    ['Duration', formatDuration(session.durationSeconds)],
    ['Sample rate', `${session.sampleRate} Hz`],
    ['Device', `${session.device.model} / ${session.device.browser}`],
    ['Input', session.device.deviceLabel],
    ['Screen', session.device.screen],
    ['Frequency weighting shown', session.settings.weighting],
    ['Time weighting shown', session.settings.timeWeighting],
    ['Statistics source', `${session.settings.statisticsWeighting}-weighted, Fast, 20 samples/s`],
    ['Band pre-weighting', session.settings.bankWeighting],
    ['DC/infrasound blocker', session.settings.dcBlock ? 'On (10 Hz high-pass)' : 'Off'],
    ['Calibration status', c.status],
    ['Calibration profile', c.profileName ?? 'None'],
    ['Reference instrument', c.referenceInstrument ?? NO_VALUE],
    ['Calibrated on', c.calibratedAt ? formatDateTime(c.calibratedAt) : NO_VALUE],
    ['Calibration transform', `SPL = ${c.slope.toFixed(6)} x dBFS + ${c.intercept.toFixed(3)}`],
    [
      'Verified level range',
      c.levelValidatedRange
        ? `${c.levelValidatedRange.minDb.toFixed(0)} to ${c.levelValidatedRange.maxDb.toFixed(0)} dB`
        : 'Not established',
    ],
    [
      'Frequency correction',
      c.frequencyCorrectionApplied && c.frequencyValidatedRange
        ? `Applied, validated ${formatFrequency(c.frequencyValidatedRange.lowHz)} to ${formatFrequency(c.frequencyValidatedRange.highHz)}`
        : 'Not applied',
    ],
    [
      'Device audio processing',
      session.device.processingSuspected
        ? 'Could not be confirmed disabled'
        : 'Reported as disabled',
    ],
    ['Clipping events', String(session.clipping.events)],
    ['Peak input level', `${formatLevel(session.clipping.peakDbfs)} dBFS`],
  ];
  if (session.pauses.length > 0) {
    entries.push(['Pauses', `${session.pauses.length} (time is excluded from the results)`]);
  }
  if (session.notes.trim()) entries.push(['Notes', session.notes]);

  return `<dl class="kv">${entries
    .map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`)
    .join('')}</dl>`;
}

function exposureSection(session: SessionRecord): string {
  const e = session.exposure;
  if (!e) return '';
  const entries: Array<[string, string]> = [
    ['Scheme', e.scheme === 'niosh' ? 'NIOSH-style' : 'OSHA-style'],
    ['Criterion level', `${e.criterionLevelDb.toFixed(0)} dBA`],
    ['Exchange rate', `${e.exchangeRateDb.toFixed(0)} dB`],
    ['Threshold', e.thresholdDb === null ? 'None applied' : `${e.thresholdDb.toFixed(0)} dBA`],
    ['Dose', `${e.dosePercent.toFixed(1)} %`],
    ['Time-weighted average', `${formatLevel(e.twaDb)} dBA`],
    ['Projected 8 h level', `${formatLevel(e.projected8hDb)} dBA`],
    ['Projected full-shift dose', `${e.projectedDosePercent.toFixed(1)} %`],
  ];
  return `<h2>Noise exposure</h2>
<div class="banner info">These are educational indicators computed from the measured LAeq under the stated assumptions. They are not a certified dosimetry result and not medical advice.</div>
<dl class="kv">${entries.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>`;
}

function warningBanners(session: SessionRecord): string {
  const banners: string[] = [];
  if (!session.summary.calibrated) {
    banners.push(
      'This measurement is NOT calibrated. All levels are digital full-scale values (dBFS) and are not sound pressure levels.'
    );
  }
  if (session.incomplete) {
    banners.push(
      'This session was recovered after the application was interrupted. It may be shorter than intended and the final moments before the interruption may be missing.'
    );
  }
  if (session.clippingAffected) {
    banners.push(
      `Clipping was detected during this measurement (${session.clipping.events} event(s), ${session.clipping.clippedSamples} samples). Levels during those periods are underestimated.`
    );
  }
  if (session.device.processingSuspected) {
    banners.push(
      'Device audio processing (automatic gain control, noise suppression or echo cancellation) could not be confirmed disabled. Measurement accuracy may be affected.'
    );
  }
  if (session.calibration.frequencyCorrectionApplied === false && session.summary.calibrated) {
    banners.push(
      'No frequency-response correction was applied, so band and spectrum levels are uncorrected for the microphone response.'
    );
  }
  return banners.map((text) => `<div class="banner">${escapeHtml(text)}</div>`).join('');
}

export interface HtmlReportOptions {
  session: SessionRecord;
  series: SessionSeries | null;
}

export function buildHtmlReport({ session, series }: HtmlReportOptions): string {
  const unit = session.summary.unit;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AcousticLab report - ${escapeHtml(session.name)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="noprint" style="float:right"><button onclick="window.print()">Print or save as PDF</button></div>
<h1>Measurement summary</h1>
<p class="sub">${escapeHtml(session.name)} &middot; ${escapeHtml(formatDateTime(session.startedAt))} &middot; ${escapeHtml(formatDuration(session.durationSeconds))}</p>
<p class="sub">AcousticLab &mdash; calibrated smartphone acoustic measurement tool. Not an IEC 61672 classified sound level meter.</p>
${warningBanners(session)}

<h2>Results (${escapeHtml(unit)})</h2>
${summarySection(session)}

<h2>Level history</h2>
${historyChart(series, unit)}

${session.octave ? '<h2>Octave spectrum</h2>' + bandChart(session, 'octave') : ''}
${session.thirdOctave ? '<h2>One-third-octave spectrum</h2>' + bandChart(session, 'thirdOctave') : ''}

<h2>Statistical levels</h2>
${percentileTable(session)}

${exposureSection(session)}

<h2>Measurement metadata</h2>
${metadataSection(session)}

<div class="foot">
Generated by AcousticLab on ${escapeHtml(formatDateTime(Date.now()))}.
Levels below ${LEVEL_FLOOR_DB} dB are reported as unmeasurable.
Leq values are energy averages; decibel values are never averaged arithmetically.
Exceedance level Ln is the level exceeded n % of the measurement time.
</div>
</body>
</html>`;
}

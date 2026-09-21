/**
 * Burn a measurement read-out into a captured image.
 *
 * A photograph of a machine is useful. A photograph of a machine with the level
 * that was being measured at that instant printed on it is evidence, and it stays
 * readable after it has been pasted into a report, cropped or printed, which a
 * caption in a separate file does not.
 *
 * The stamp carries the unit exactly as the screen shows it, and the uncalibrated
 * warning with it. A bare number burned into a picture is precisely the kind of
 * thing that gets quoted later as though it were a calibrated sound pressure
 * level, so the qualifier travels with it or the stamp is not worth having.
 */

export interface MeasurementStamp {
  /** Main line, e.g. `72.4 dBA`. */
  primary: string;
  /** Supporting lines, e.g. the detector, Leq, the time. */
  secondary: readonly string[];
  /** Shown in amber when the reading is not a calibrated sound pressure level. */
  warning?: string | null;
}

/** Colours are fixed rather than themed: the file leaves the app. */
const BAR = 'rgba(6, 10, 14, 0.66)';
const PRIMARY = '#ffffff';
const SECONDARY = '#d7dee6';
const WARNING = '#fbbf24';

/**
 * Draw the stamp across the bottom of the image.
 *
 * Every size is a fraction of the image height, so a 480-line preview and a
 * 2160-line capture carry a stamp of the same visual weight.
 */
export function drawMeasurementStamp(
  context: CanvasRenderingContext2D,
  size: { width: number; height: number },
  stamp: MeasurementStamp
): void {
  const { width, height } = size;
  const unit = height / 100;
  const pad = unit * 2.2;
  const primarySize = unit * 7.2;
  const secondarySize = unit * 3.4;
  const warningSize = unit * 3.4;
  const gap = unit * 1.2;

  const secondaryLine = stamp.secondary.filter(Boolean).join('  \u00b7  ');
  const lines: Array<{ text: string; size: number; colour: string; weight: string }> = [
    { text: stamp.primary, size: primarySize, colour: PRIMARY, weight: '700' },
  ];
  if (secondaryLine) {
    lines.push({ text: secondaryLine, size: secondarySize, colour: SECONDARY, weight: '400' });
  }
  if (stamp.warning) {
    lines.push({ text: stamp.warning, size: warningSize, colour: WARNING, weight: '700' });
  }

  const blockHeight =
    pad * 2 + lines.reduce((total, line) => total + line.size, 0) + gap * (lines.length - 1);
  const top = Math.max(0, height - blockHeight);

  context.save();
  context.fillStyle = BAR;
  context.fillRect(0, top, width, height - top);

  context.textAlign = 'left';
  context.textBaseline = 'top';
  let y = top + pad;
  for (const line of lines) {
    context.font = `${line.weight} ${line.size}px "Segoe UI", system-ui, -apple-system, sans-serif`;
    context.fillStyle = line.colour;
    context.fillText(line.text, pad, y, width - pad * 2);
    y += line.size + gap;
  }
  context.restore();
}

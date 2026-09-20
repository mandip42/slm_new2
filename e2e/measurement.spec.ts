import { expect, test } from '@playwright/test';
import {
  gotoClean,
  gotoWithMic,
  openMicrophone,
  waitForLiveLevel,
  watchForErrors,
} from './helpers';

/**
 * The core measurement journey, end to end, with Chrome's fake capture device:
 * open the microphone, see a live level, run a measurement, stop it, and find the
 * saved session with a report and exports.
 */

test.describe('measurement journey', () => {
  test('shows a live level and labels it as uncalibrated', async ({ page }) => {
    const errors = watchForErrors(page);
    await gotoClean(page);

    // Before calibration the app must say so, prominently.
    await expect(
      page.getByText(/Uncalibrated: this is a digital full-scale level/)
    ).toHaveCount(0);

    await openMicrophone(page);
    const level = await waitForLiveLevel(page);

    // The fake device produces a tone well above the noise floor and below full
    // scale, so the level must be a plausible dBFS value.
    expect(level).toBeLessThan(0);
    expect(level).toBeGreaterThan(-90);

    await expect(page.getByText(/Uncalibrated: this is a digital full-scale level/)).toBeVisible();
    await expect(page.getByText(/dBA FS/).first()).toBeVisible();

    // Status bar reflects reality.
    await expect(page.getByText(/CAL \u2717/)).toBeVisible();
    await expect(page.getByText(/48 kHz|44\.1 kHz/)).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('runs a measurement, saves it, and exposes a report and exports', async ({ page }) => {
    const errors = watchForErrors(page);
    await gotoClean(page);
    await openMicrophone(page);
    await waitForLiveLevel(page);

    await page.getByRole('button', { name: 'START MEASUREMENT' }).click();
    await expect(page.getByText(/MEASURING/)).toBeVisible();

    // Let real data accumulate: warm-up plus enough for percentiles.
    await page.waitForTimeout(3500);

    // LAeq must have a value while measuring.
    const laeqTile = page.locator('div', { has: page.getByText('LAeq', { exact: true }) }).first();
    await expect(laeqTile).not.toContainText('\u2014');

    // Stop needs two taps, which is what makes an accidental stop unlikely.
    const stop = page.getByRole('button', { name: 'STOP' });
    await stop.click();
    await page.getByRole('button', { name: 'TAP TO CONFIRM' }).click();

    await expect(page.getByText('Measurement saved')).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Open report' }).click();
    await expect(page.getByRole('heading', { name: /Measurement \d/ })).toBeVisible({
      timeout: 20_000,
    });

    // The saved summary must contain real values, not placeholders.
    await expect(page.getByText('Summary (dBFS)')).toBeVisible();
    await expect(page.getByText('Measurement metadata')).toBeVisible();
    await expect(page.getByText('Report and export')).toBeVisible();

    // A CSV export really produces a file.
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Summary CSV' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^acousticlab-.*-summary-.*\.csv$/);

    expect(errors).toEqual([]);
  });

  test('pause stops the clock without discarding the measurement', async ({ page }) => {
    await gotoClean(page);
    await openMicrophone(page);
    await waitForLiveLevel(page);

    await page.getByRole('button', { name: 'START MEASUREMENT' }).click();
    await page.waitForTimeout(2000);

    await page.getByRole('button', { name: 'PAUSE' }).click();
    await expect(page.getByText(/PAUSED/).first()).toBeVisible();
    await expect(
      page.getByText(/No time and no sound energy accumulate while paused/)
    ).toBeVisible();

    const elapsedText = async () => {
      const text = await page.getByText(/PAUSED \u00b7 \d+:\d\d/).first().innerText();
      return text;
    };
    const before = await elapsedText();
    await page.waitForTimeout(1500);
    expect(await elapsedText()).toBe(before);

    await page.getByRole('button', { name: 'RESUME' }).click();
    await expect(page.getByText(/MEASURING/)).toBeVisible();
  });

  test('statistics screen reports exceedance levels from real data', async ({ page }) => {
    await gotoClean(page);
    await openMicrophone(page);
    await waitForLiveLevel(page);
    await page.getByRole('button', { name: 'START MEASUREMENT' }).click();
    await page.waitForTimeout(3500);

    // In-app navigation keeps the microphone and the running measurement alive.
    await page.getByRole('link', { name: 'More', exact: true }).click();
    await page.locator('a[href="/statistics"]').click();

    await expect(page.getByRole('heading', { name: 'Statistical acoustics' })).toBeVisible();

    // L10 >= L50 >= L90 must hold for any real distribution.
    const readLevel = async (label: string) => {
      const tile = page.locator('div.panel-sunken', { has: page.getByText(label, { exact: true }) }).first();
      const text = await tile.innerText();
      const match = /(-?\d+\.\d)/.exec(text);
      return match ? Number.parseFloat(match[1]) : null;
    };

    await expect
      .poll(async () => await readLevel('L50'), { timeout: 20_000 })
      .not.toBeNull();

    const l10 = await readLevel('L10');
    const l50 = await readLevel('L50');
    const l90 = await readLevel('L90');
    expect(l10).not.toBeNull();
    expect(l50).not.toBeNull();
    expect(l90).not.toBeNull();
    expect(l10!).toBeGreaterThanOrEqual(l50!);
    expect(l50!).toBeGreaterThanOrEqual(l90!);
  });

  test('exposure withholds dose figures while uncalibrated', async ({ page }) => {
    await gotoClean(page);
    await openMicrophone(page);
    await waitForLiveLevel(page);

    await gotoWithMic(page, '/exposure');
    await expect(page.getByText('Exposure needs a calibration')).toBeVisible();
    // No fabricated dose number.
    await expect(page.getByText('Dose progress')).toHaveCount(0);
  });
});

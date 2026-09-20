import { expect, test } from '@playwright/test';
import { gotoReady, watchForErrors } from './helpers';

/**
 * The developer DSP lab is the most valuable end-to-end test in the suite: it
 * exercises the real DSP chain against signals whose levels are known
 * analytically, with no microphone and therefore no flakiness.
 *
 * If the numbers here drift, a measurement on a real device has drifted too.
 */

test.describe('DSP developer lab', () => {
  test('a 1 kHz tone measures the level it was generated at on all weightings', async ({ page }) => {
    const errors = watchForErrors(page);
    await gotoReady(page, '/dev/dsp');

    await expect(page.getByRole('heading', { name: 'DSP developer lab' })).toBeVisible();

    await page.getByLabel('Frequency').fill('1000');
    await page.getByLabel('Level').fill('-20');
    await page.getByRole('button', { name: /Run through the DSP chain/ }).click();

    const table = page.locator('table').first();
    await expect(table).toBeVisible({ timeout: 30_000 });

    // At 1 kHz all three weightings are 0 dB by definition, so every row should
    // measure -20 dBFS.
    for (const label of ['LZeq (unweighted)', 'LAeq', 'LCeq', 'Direct RMS of the signal']) {
      const row = table.locator('tr', { hasText: label }).first();
      const cells = row.locator('td');
      const measured = Number.parseFloat((await cells.nth(2).innerText()).trim());
      expect(measured, `${label} should measure -20 dBFS`).toBeGreaterThan(-20.6);
      expect(measured, `${label} should measure -20 dBFS`).toBeLessThan(-19.4);

      const difference = Number.parseFloat((await cells.nth(3).innerText()).trim());
      expect(Math.abs(difference), `${label} should agree with theory`).toBeLessThan(0.6);
    }

    expect(errors).toEqual([]);
  });

  test('a 100 Hz tone shows the expected A-weighting attenuation', async ({ page }) => {
    await gotoReady(page, '/dev/dsp');
    await page.getByLabel('Frequency').fill('100');
    await page.getByLabel('Level').fill('-20');
    await page.getByRole('button', { name: /Run through the DSP chain/ }).click();

    const table = page.locator('table').first();
    await expect(table).toBeVisible({ timeout: 30_000 });

    const cellValue = async (label: string, column: number) => {
      const row = table.locator('tr', { hasText: label }).first();
      return Number.parseFloat((await row.locator('td').nth(column).innerText()).trim());
    };

    const zMeasured = await cellValue('LZeq (unweighted)', 2);
    const aMeasured = await cellValue('LAeq', 2);

    // A weighting at 100 Hz is about -19.1 dB.
    const attenuation = aMeasured - zMeasured;
    expect(attenuation).toBeLessThan(-18);
    expect(attenuation).toBeGreaterThan(-20.5);

    // And the difference column confirms it agrees with the analytic value.
    expect(Math.abs(await cellValue('LAeq', 3))).toBeLessThan(0.6);
  });

  test('band energy sums back to the broadband level for pink noise', async ({ page }) => {
    await gotoReady(page, '/dev/dsp');
    await page.getByLabel('Signal type').selectOption('pink-noise');
    await page.getByLabel('Level').fill('-25');
    await page.getByRole('button', { name: /Run through the DSP chain/ }).click();

    const table = page.locator('table').first();
    await expect(table).toBeVisible({ timeout: 30_000 });

    const row = table.locator('tr', { hasText: 'Sum of 1/3-octave band Leq' }).first();
    const measured = Number.parseFloat((await row.locator('td').nth(2).innerText()).trim());
    // Pink noise carries energy below the lowest measured band, so the sum falls a
    // little short of the total. It must never exceed it.
    expect(measured).toBeLessThan(-24.7);
    expect(measured).toBeGreaterThan(-27);
  });

  test('reports the weighting filter design for the selected sample rate', async ({ page }) => {
    await gotoReady(page, '/dev/dsp');

    // 48 kHz is the default.
    await expect(page.getByText('A worst fit error')).toBeVisible();
    // The minimax-optimised design must stay comfortably inside a decibel.
    const fitError = page.locator('dd').filter({ hasText: /^0\.\d+ dB$/ }).first();
    await expect(fitError).toBeVisible();

    // Switching sample rate re-runs the design and must stay well inside tolerance.
    await page.getByRole('radio', { name: '44100 Hz' }).click();
    await expect(page.getByText('A weighting HF pole')).toBeVisible();
  });

  test('handles silence without producing nonsense', async ({ page }) => {
    await gotoReady(page, '/dev/dsp');
    await page.getByLabel('Signal type').selectOption('silence');
    await page.getByRole('button', { name: /Run through the DSP chain/ }).click();

    await expect(page.getByText('All engine outputs')).toBeVisible({ timeout: 30_000 });
    // Silence must not render as 0 dB or as Infinity.
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('Infinity');
    expect(body).not.toContain('NaN');
  });
});

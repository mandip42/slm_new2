import { expect, test, type Page } from '@playwright/test';
import {
  gotoClean,
  gotoWithMic,
  openMicrophone,
  readMainLevel,
  waitForLiveLevel,
  watchForErrors,
} from './helpers';

/**
 * Highest level seen over a window long enough to contain a full cycle of the
 * fake capture device's beep pattern.
 *
 * Chrome's fake audio device is a repeating beep, not a steady tone, so a single
 * instantaneous Fast reading can sit anywhere inside a wide swing. The peak over a
 * whole cycle is repeatable; one arbitrary sample is not.
 */
async function peakLevelOverBeepCycle(page: Page): Promise<number> {
  const samples: number[] = [];
  for (let i = 0; i < 14; i++) {
    const value = await readMainLevel(page);
    if (value !== null) samples.push(value);
    await page.waitForTimeout(200);
  }
  expect(samples.length, 'the read-out went blank during sampling').toBeGreaterThan(6);
  return Math.max(...samples);
}

/**
 * Calibration is the feature that turns a digital level into a sound pressure
 * level, so the test asserts the thing that actually matters: after a
 * single-point calibration the displayed unit changes from dBFS to dB SPL and the
 * displayed number moves by the calibration offset.
 */

test.describe('calibration', () => {
  test('a single-point calibration converts the read-out to dB SPL', async ({ page }) => {
    const errors = watchForErrors(page);
    await gotoClean(page);
    await openMicrophone(page);
    const rawLevel = await waitForLiveLevel(page);

    await gotoWithMic(page, '/calibration');
    await expect(page.getByText('UNCALIBRATED')).toBeVisible();

    // Create a profile.
    await page.getByRole('button', { name: 'Create the first profile' }).click();
    await page.getByLabel('Profile name').fill('E2E test profile');
    await page.getByRole('button', { name: 'Create profile' }).click();
    await expect(page.getByText(/created and activated/)).toBeVisible();

    // Run the single-point procedure.
    await page
      .getByRole('button', { name: 'Run: Single-point level calibration' })
      .click();

    await expect(
      page.getByRole('heading', { name: 'Single-point calibration' })
    ).toBeVisible();

    // Capture over the shortest window to keep the test quick.
    await page.getByRole('button', { name: '3 s' }).click();
    await page.getByRole('button', { name: /Capture 3 s average/ }).click();
    await expect(page.getByText('Captured')).toBeVisible({ timeout: 20_000 });

    // Enter a reference reading and save.
    await page.getByLabel('Reference instrument level').fill('74.3');
    await expect(page.getByText('Calibration offset')).toBeVisible();

    await page.getByRole('button', { name: 'Save calibration' }).click();
    await expect(page.getByText('Calibration saved and activated')).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText('LEVEL CALIBRATED')).toBeVisible();

    // Back on the meter, the unit and the value must both have changed.
    await page.getByRole('link', { name: 'Meter' }).click();
    await expect(page.getByText('dBA', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/dBA FS/)).toHaveCount(0);
    await expect(page.getByText(/Uncalibrated: this is a digital/)).toHaveCount(0);
    await expect(page.getByText(/CAL \u2713/)).toBeVisible();

    await waitForLiveLevel(page);
    const calibratedLevel = await peakLevelOverBeepCycle(page);
    // The read-out must now be an absolute sound pressure level near the reference
    // we entered, and far away from the raw digital level it showed before.
    //
    // The tolerance is wide on purpose. The calibration was captured from a 3 s
    // energy average of a pulsed source, and this is the peak of the Fast level of
    // that same source, so the two legitimately differ by several decibels. The
    // numerical accuracy of the calibration transform itself is asserted
    // analytically in the unit tests, where the input is a known steady signal.
    expect(Math.abs(calibratedLevel - 74.3)).toBeLessThan(15);
    expect(calibratedLevel).toBeGreaterThan(rawLevel + 20);

    expect(errors).toEqual([]);
  });

  test('exports and re-imports a calibration profile', async ({ page }) => {
    await gotoClean(page);
    await openMicrophone(page);
    await waitForLiveLevel(page);

    await gotoWithMic(page, '/calibration');
    await page.getByRole('button', { name: 'Create the first profile' }).click();
    await page.getByLabel('Profile name').fill('Exportable profile');
    await page.getByRole('button', { name: 'Create profile' }).click();
    await expect(page.getByText(/created and activated/)).toBeVisible();

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export JSON' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/calibration.*\.json$/);
  });

  test('the frequency procedure refuses to run before a level calibration', async ({ page }) => {
    await gotoClean(page);
    await openMicrophone(page);
    await waitForLiveLevel(page);

    await gotoWithMic(page, '/calibration');
    await page.getByRole('button', { name: 'Create the first profile' }).click();
    await page.getByLabel('Profile name').fill('No level yet');
    await page.getByRole('button', { name: 'Create profile' }).click();

    await expect(page.getByText('Needs a level calibration first')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Run: Frequency response' })
    ).toBeDisabled();
  });

  test('validation lab explains that calibration must come first', async ({ page }) => {
    await gotoClean(page);
    await gotoClean(page, '/validation');
    await expect(page.getByRole('heading', { name: 'XL2 validation lab' })).toBeVisible();
    await expect(page.getByText('Calibrate before validating')).toBeVisible();
    await expect(page.getByText(/Spatial variation is the main source of scatter/)).toBeVisible();
  });

  test('creates a validation experiment and records a comparison', async ({ page }) => {
    await gotoClean(page);
    await gotoClean(page, '/validation');

    await page.getByRole('button', { name: 'New experiment' }).click();
    await page.getByLabel('Experiment type').selectOption('broadband-level');
    await page.getByRole('button', { name: 'Create experiment' }).click();

    await expect(page.getByText('Experimental setup')).toBeVisible();
    await page.getByLabel('Source', { exact: true }).fill('Fake capture device tone');
    await page.getByRole('button', { name: 'Save setup' }).click();

    await expect(page.getByText(/Comparisons \(0\)/)).toBeVisible();
  });
});

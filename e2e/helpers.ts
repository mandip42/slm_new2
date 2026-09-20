import { expect, type Page } from '@playwright/test';

/**
 * Shared end-to-end helpers.
 *
 * Tests run against a production build with Chrome's fake audio capture device,
 * which produces a continuous tone rather than silence. That is enough to drive
 * the whole measurement chain: worklet, filter bank, FFT, statistics and storage.
 */

/** Collect console errors and page exceptions for assertion at the end of a test. */
export function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    // Chrome logs a benign warning when a fake device ignores constraints.
    if (/favicon|ResizeObserver loop/i.test(text)) return;
    errors.push(text);
  });
  page.on('pageerror', (error) => {
    errors.push(`pageerror: ${error.message}`);
  });
  return errors;
}

/**
 * Navigate and wait until React has hydrated.
 *
 * Every screen is prerendered, so a control can be visible and clickable before
 * its handler exists. Clicking in that window does nothing and produces a
 * baffling failure much later, so all navigation goes through here.
 */
export async function gotoReady(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForSelector('html[data-hydrated="true"]', { timeout: 30_000 });
}

/** Start from a clean local database so tests never depend on each other. */
export async function gotoClean(page: Page, path = '/'): Promise<void> {
  await gotoReady(page, path);
  await page.evaluate(async () => {
    const databases = (await indexedDB.databases?.()) ?? [];
    await Promise.all(
      databases
        .filter((database) => database.name === 'acousticlab')
        .map(
          (database) =>
            new Promise<void>((resolve) => {
              const request = indexedDB.deleteDatabase(database.name!);
              request.onsuccess = () => resolve();
              request.onerror = () => resolve();
              request.onblocked = () => resolve();
            })
        )
    );
  });
  await page.reload();
  await page.waitForSelector('html[data-hydrated="true"]', { timeout: 30_000 });
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
}

/** Open the microphone and wait until metrics are actually flowing. */
export async function openMicrophone(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: 'Open microphone' });
  await expect(button).toBeVisible();
  await button.click();
  // The status bar only shows MIC with a tick once samples have been processed.
  await expect(page.getByText(/MIC \u2713/)).toBeVisible({ timeout: 20_000 });
}

/**
 * Navigate to a screen with a live microphone.
 *
 * A full page load tears down the AudioContext and releases the microphone, so
 * any screen reached with `page.goto` starts with no input. Screens gate their
 * measurement content on a live input, so the microphone has to be reopened after
 * navigating. In the app itself this does not arise: navigation between screens is
 * client side and the input keeps running.
 */
export async function gotoWithMic(page: Page, path: string): Promise<void> {
  await gotoReady(page, path);
  await openMicrophone(page);
}

/** The large level read-out, parsed as a number. Null when it shows an em dash. */
export async function readMainLevel(page: Page): Promise<number | null> {
  const text = await page.locator('[aria-live="off"]').first().innerText();
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? value : null;
}

/** Wait until the main level read-out shows a real number. */
export async function waitForLiveLevel(page: Page): Promise<number> {
  await expect
    .poll(async () => await readMainLevel(page), {
      timeout: 20_000,
      message: 'the main level read-out never showed a measurable value',
    })
    .not.toBeNull();
  const level = await readMainLevel(page);
  return level as number;
}

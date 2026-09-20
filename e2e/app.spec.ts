import { expect, test } from '@playwright/test';
import {
  gotoClean,
  gotoReady,
  gotoWithMic,
  openMicrophone,
  waitForLiveLevel,
  watchForErrors,
} from './helpers';

/** Every route AcousticLab exposes, and what must be on it. */
const ROUTES: Array<{ path: string; heading: RegExp; needsMic?: boolean }> = [
  { path: '/', heading: /START MEASUREMENT|Open the microphone to measure/ },
  { path: '/spectrum', heading: /FFT spectrum/ },
  { path: '/octave', heading: /Octave analyser/ },
  { path: '/history', heading: /Level history/ },
  { path: '/spectrogram', heading: /Spectrogram/ },
  { path: '/statistics', heading: /Statistical acoustics/ },
  { path: '/exposure', heading: /Noise exposure/ },
  { path: '/sessions', heading: /Sessions/ },
  { path: '/calibration', heading: /Calibration/ },
  { path: '/validation', heading: /XL2 validation lab/ },
  { path: '/diagnostics', heading: /Input diagnostics/ },
  { path: '/settings', heading: /Settings/ },
  { path: '/about', heading: /About AcousticLab/ },
  { path: '/more', heading: /All screens/ },
  { path: '/dev/dsp', heading: /DSP developer lab/ },
];

test.describe('application shell', () => {
  for (const route of ROUTES) {
    test(`${route.path} loads without errors`, async ({ page }) => {
      const errors = watchForErrors(page);
      await gotoReady(page, route.path);
      await expect(page.getByText(route.heading).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
      expect(errors, `console errors on ${route.path}`).toEqual([]);
    });
  }

  test('bottom navigation reaches every primary screen', async ({ page }) => {
    await gotoClean(page);
    for (const [label, heading] of [
      ['Spectrum', /FFT spectrum/],
      ['Octave', /Octave analyser/],
      ['History', /Level history/],
      ['More', /All screens/],
      ['Meter', /START MEASUREMENT|Open the microphone/],
    ] as Array<[string, RegExp]>) {
      await page.getByRole('link', { name: label, exact: true }).click();
      await expect(page.getByText(heading).first()).toBeVisible();
    }
  });

  test('states the privacy position without being asked', async ({ page }) => {
    await gotoClean(page);
    await expect(
      page.getByText(/Microphone audio is processed locally on this device/).first()
    ).toBeVisible();
  });

  test('never claims IEC compliance and says what it is not', async ({ page }) => {
    await gotoReady(page, '/about');
    const body = await page.locator('body').innerText();
    expect(body).toMatch(/not a classified sound level meter/i);
    expect(body).toMatch(/has not been type tested or certified/i);
    expect(body).not.toMatch(/Class 1 compliant/i);
    expect(body).not.toMatch(/IEC 61672 compliant/i);
  });

  test('status bar expands to full acquisition detail', async ({ page }) => {
    await gotoClean(page);
    await page
      .getByRole('button', { name: /Acquisition and calibration status/ })
      .click();
    await expect(page.getByText('Acquisition', { exact: true })).toBeVisible();
    await expect(page.getByText('Graph sample rate')).toBeVisible();
    await expect(page.getByText('Auto gain control')).toBeVisible();
  });

  test('serves an installable manifest and the compiled worklet', async ({ request }) => {
    const manifest = await request.get('/manifest.webmanifest');
    expect(manifest.ok()).toBe(true);
    const parsed = (await manifest.json()) as {
      name: string;
      display: string;
      icons: Array<{ sizes: string; purpose?: string }>;
      start_url: string;
    };
    expect(parsed.name).toContain('AcousticLab');
    expect(parsed.display).toBe('standalone');
    expect(parsed.start_url).toBe('/');
    expect(parsed.icons.some((icon) => icon.sizes === '512x512')).toBe(true);
    expect(parsed.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);

    const worklet = await request.get('/worklets/meter-processor.js');
    expect(worklet.ok()).toBe(true);
    expect(await worklet.text()).toContain('acousticlab-meter');

    const icon = await request.get('/icons/icon-512.png');
    expect(icon.ok()).toBe(true);
    expect(icon.headers()['content-type']).toContain('image/png');
  });

  test('registers a service worker that precaches every route', async ({ page, request }) => {
    const sw = await request.get('/sw.js');
    expect(sw.ok()).toBe(true);
    const source = await sw.text();
    for (const path of ROUTES.map((route) => route.path)) {
      expect(source, `service worker should precache ${path}`).toContain(`"${path}"`);
    }
    expect(source).toContain('/worklets/meter-processor.js');

    await gotoReady(page, '/');
    const registered = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const registration = await navigator.serviceWorker.getRegistration('/');
      return Boolean(registration);
    });
    expect(registered).toBe(true);
  });

  test('renders the analysis canvases once the microphone is live', async ({ page }) => {
    await gotoClean(page);
    await openMicrophone(page);
    await waitForLiveLevel(page);

    for (const [path, label] of [
      ['/spectrum', 'FFT spectrum'],
      ['/octave', 'Octave band levels'],
      ['/spectrogram', 'Spectrogram'],
    ] as Array<[string, string]>) {
      await gotoWithMic(page, path);
      const canvas = page.getByRole('img', { name: label });
      await expect(canvas).toBeVisible({ timeout: 20_000 });
      const box = await canvas.boundingBox();
      expect(box!.width).toBeGreaterThan(50);
      expect(box!.height).toBeGreaterThan(50);
    }
  });

  test('octave screen reports which bands cannot be measured', async ({ page }) => {
    await gotoClean(page);
    await gotoWithMic(page, '/octave');
    await expect(page.getByText('Bands outside the measurable range')).toBeVisible({
      timeout: 20_000,
    });
  });

  test('settings persist across a reload', async ({ page }) => {
    await gotoClean(page);
    await gotoReady(page, '/settings');

    await page.getByRole('radio', { name: 'C', exact: true }).first().click();
    await page.waitForTimeout(400);
    await page.reload();

    await expect(page.getByRole('radio', { name: 'C', exact: true }).first()).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  test('diagnostics reports what the browser actually granted', async ({ page }) => {
    await gotoClean(page);
    await gotoWithMic(page, '/diagnostics');

    await expect(page.getByRole('heading', { name: 'Audio input' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Real-time performance' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'DSP configuration' })).toBeVisible();
    // The flags must report a definite state, not be left blank.
    const body = await page.locator('body').innerText();
    // Badge text is upper-cased by CSS, so match case-insensitively.
    expect(body).toMatch(/(ACTIVE|DISABLED|NOT REPORTED)/i);
    expect(body).toMatch(/Weighting accurate to/);
  });
});

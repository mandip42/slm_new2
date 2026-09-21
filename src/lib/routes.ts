/**
 * Single source of truth for the application's routes.
 *
 * Used by the bottom navigation, the "More" screen and — via
 * scripts/build-sw.mjs — by the service worker precache list, so an added screen
 * cannot silently become unavailable offline.
 */

export type RouteGroup = 'primary' | 'analysis' | 'measurement' | 'calibration' | 'system' | 'developer';

export interface AppRoute {
  href: string;
  /** Full name, used in headers and the More screen. */
  label: string;
  /** Short name for the bottom navigation. */
  short: string;
  group: RouteGroup;
  description: string;
  /** Excluded from the More screen listing. */
  hidden?: boolean;
}

export const APP_ROUTES: readonly AppRoute[] = [
  {
    href: '/',
    label: 'Sound level meter',
    short: 'Meter',
    group: 'primary',
    description: 'Live broadband level, session statistics and measurement control.',
  },
  {
    href: '/spectrum',
    label: 'FFT spectrum',
    short: 'Spectrum',
    group: 'analysis',
    description: 'Real-time FFT analyser with window selection, peak hold and a cursor read-out.',
  },
  {
    href: '/octave',
    label: 'Octave analyser',
    short: 'Octave',
    group: 'analysis',
    description: '1/1 and 1/3 octave band levels from a Butterworth filter bank.',
  },
  {
    href: '/history',
    label: 'Level history',
    short: 'History',
    group: 'analysis',
    description: 'Scrolling level history with selectable traces, time windows and a cursor.',
  },
  {
    href: '/spectrogram',
    label: 'Spectrogram',
    short: 'Spectro',
    group: 'analysis',
    description: 'Scrolling time-frequency display.',
  },
  {
    href: '/statistics',
    label: 'Statistics',
    short: 'Stats',
    group: 'measurement',
    description: 'Exceedance levels L1 to L99 and the level distribution.',
  },
  {
    href: '/exposure',
    label: 'Noise exposure',
    short: 'Exposure',
    group: 'measurement',
    description: 'NIOSH-style and OSHA-style dose indicators with every assumption stated.',
  },
  {
    href: '/sessions',
    label: 'Sessions',
    short: 'Sessions',
    group: 'measurement',
    description: 'Saved measurements, reports and CSV/JSON export.',
  },
  {
    href: '/calibration',
    label: 'Calibration',
    short: 'Calibration',
    group: 'calibration',
    description: 'Calibrate and validate against an NTi Audio XL2 reference instrument.',
  },
  {
    href: '/validation',
    label: 'XL2 validation lab',
    short: 'Validation',
    group: 'calibration',
    description: 'Side-by-side comparison experiments with full error statistics.',
  },
  {
    href: '/diagnostics',
    label: 'Input diagnostics',
    short: 'Diagnostics',
    group: 'system',
    description: 'What the browser actually delivered, plus real-time performance.',
  },
  {
    href: '/settings',
    label: 'Settings',
    short: 'Settings',
    group: 'system',
    description: 'Measurement defaults, display options and stored data management.',
  },
  {
    href: '/about',
    label: 'About and limitations',
    short: 'About',
    group: 'system',
    description: 'What Sonoscope is, what it is not, and how it handles your data.',
  },
  {
    href: '/more',
    label: 'All screens',
    short: 'More',
    group: 'primary',
    description: 'Everything Sonoscope can do.',
    hidden: true,
  },
  {
    href: '/dev/dsp',
    label: 'DSP developer lab',
    short: 'DSP lab',
    group: 'developer',
    description:
      'Run generated signals through the production DSP chain for deterministic validation.',
  },
];

/** The five entries shown in the bottom navigation bar. */
export const BOTTOM_NAV_HREFS = ['/', '/spectrum', '/octave', '/history', '/more'] as const;

/** Routes the service worker precaches so every screen works offline. */
export const PRECACHE_ROUTES: readonly string[] = APP_ROUTES.map((r) => r.href);

export function routeByHref(href: string): AppRoute | undefined {
  return APP_ROUTES.find((r) => r.href === href);
}

export function routesByGroup(group: RouteGroup): AppRoute[] {
  return APP_ROUTES.filter((r) => r.group === group && !r.hidden);
}

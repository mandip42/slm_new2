import type { MetadataRoute } from 'next';
import { APP_NAME, APP_SHORT_NAME } from '@/lib/branding';

/**
 * PWA manifest.
 *
 * `display: standalone` and a portrait-primary orientation give the instrument
 * feel on Android; landscape still works, the preference just decides how the
 * app opens. Shortcuts jump straight to the screens people use most.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: `${APP_NAME} - acoustic and NVH measurement`,
    short_name: APP_SHORT_NAME,
    description:
      'Turn your phone into a calibrated acoustic analyser: sound level meter, FFT and octave analysis, statistics, noise exposure and reference-instrument calibration. All audio is processed locally on your device.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#05080c',
    theme_color: '#05080c',
    categories: ['utilities', 'productivity', 'education'],
    dir: 'ltr',
    lang: 'en',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
    shortcuts: [
      {
        name: 'Sound level meter',
        short_name: 'Meter',
        url: '/',
        description: 'Measure broadband sound level',
      },
      {
        name: 'Octave analyser',
        short_name: 'Octave',
        url: '/octave',
        description: 'Octave and one-third-octave band levels',
      },
      {
        name: 'Calibration',
        short_name: 'Calibrate',
        url: '/calibration',
        description: 'Calibrate against a reference instrument',
      },
      {
        name: 'Sessions',
        short_name: 'Sessions',
        url: '/sessions',
        description: 'Saved measurements and reports',
      },
    ],
  };
}

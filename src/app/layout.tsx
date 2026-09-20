import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppProviders } from '@/state/AppProviders';
import { AppShell } from '@/components/layout/AppShell';

export const metadata: Metadata = {
  title: {
    default: 'AcousticLab',
    template: '%s | AcousticLab',
  },
  description:
    'A calibrated smartphone acoustic measurement tool: sound level meter, FFT and octave analysis, statistics and reference-instrument calibration. All processing happens on your device.',
  applicationName: 'AcousticLab',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'AcousticLab',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: [
      { url: '/icons/icon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
  formatDetection: { telephone: false },
  other: {
    // Microphone audio never leaves the device; stated in the document itself.
    'privacy-policy': 'Microphone audio is processed locally on this device and is never uploaded.',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Zoom stays available for accessibility; the layout is designed so it is not
  // needed.
  maximumScale: 5,
  themeColor: '#05080c',
  colorScheme: 'dark light',
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-panel-raised focus:px-3 focus:py-2 focus:text-sm focus:text-ink"
        >
          Skip to content
        </a>
        <AppProviders>
          <AppShell>
            <div id="main-content">{children}</div>
          </AppShell>
        </AppProviders>
      </body>
    </html>
  );
}

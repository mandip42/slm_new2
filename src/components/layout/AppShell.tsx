'use client';

import { useEffect, type ReactNode } from 'react';
import { StatusBar } from './StatusBar';
import { BottomNav } from './BottomNav';
import { ServiceWorkerManager } from '@/components/system/ServiceWorkerManager';
import { EngineErrorBanner } from '@/components/system/EngineErrorBanner';
import { RecoveryPrompt } from '@/components/system/RecoveryPrompt';

/**
 * Application chrome.
 *
 * Layout is portrait-first with a fixed status bar at the top and navigation at
 * the bottom. The content column is capped so the app stays usable in landscape
 * and on a tablet without the read-outs stretching across the whole screen.
 */
export function AppShell({ children }: { children: ReactNode }) {
  /**
   * Mark the document as hydrated.
   *
   * Every screen is prerendered as static HTML, so controls are visible and
   * clickable before React has attached its handlers — a click in that window is
   * silently lost. This attribute is the definite signal that interaction will
   * actually do something; the end-to-end tests wait for it, and it is useful
   * when diagnosing a report of "the button did nothing".
   */
  useEffect(() => {
    document.documentElement.dataset.hydrated = 'true';
    return () => {
      delete document.documentElement.dataset.hydrated;
    };
  }, []);

  return (
    <div className="flex min-h-dvh flex-col bg-shell">
      <StatusBar />
      <main className="mx-auto w-full max-w-3xl flex-1 px-3 pt-3 pb-20">
        <EngineErrorBanner />
        <RecoveryPrompt />
        {children}
      </main>
      <BottomNav />
      <ServiceWorkerManager />
    </div>
  );
}

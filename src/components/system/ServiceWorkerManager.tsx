'use client';

/**
 * Service worker registration and update handling.
 *
 * Updates are never applied silently in the middle of a measurement: a new
 * version waits and the user is offered a reload. That matters because
 * activating a new service worker reloads the page, and reloading during a
 * measurement would interrupt it.
 */

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/primitives';
import { useMeasurement } from '@/state/MeasurementProvider';

export function ServiceWorkerManager() {
  const { state } = useMeasurement();
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [offlineReady, setOfflineReady] = useState(false);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    // A service worker on localhost over http is allowed; elsewhere it needs HTTPS.
    if (!window.isSecureContext) return;

    let cancelled = false;

    /**
     * Whether a service worker was already in control when this page loaded.
     *
     * This decides whether a later `controllerchange` means "an update replaced
     * the old worker" (reload to pick it up) or merely "the very first worker has
     * taken control" (do nothing). Reloading on the first activation would throw
     * away whatever the user was doing seconds after they arrived — including an
     * in-progress measurement.
     */
    const hadControllerOnLoad = Boolean(navigator.serviceWorker.controller);

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        if (cancelled) return;

        if (registration.waiting && navigator.serviceWorker.controller) {
          setWaiting(registration.waiting);
        }
        if (registration.active && !registration.waiting) {
          setOfflineReady(true);
        }

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed') {
              if (navigator.serviceWorker.controller) {
                // An update is ready but an older version is still in control.
                setWaiting(installing);
              } else {
                setOfflineReady(true);
              }
            }
          });
        });
      } catch {
        // Registration failure only costs offline support; the app still runs.
      }
    };

    void register();

    // Reload only when an update replaced a worker that was already in control.
    let reloading = false;
    const onControllerChange = () => {
      if (!hadControllerOnLoad || reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  // Hide the offline-ready confirmation after a few seconds.
  useEffect(() => {
    if (!offlineReady) return;
    const timer = setTimeout(() => setOfflineReady(false), 4000);
    return () => clearTimeout(timer);
  }, [offlineReady]);

  const measuring = state === 'measuring' || state === 'paused';

  if (waiting) {
    return (
      <div
        role="status"
        className="fixed inset-x-3 bottom-20 z-40 rounded-lg border border-accent/50 bg-panel-raised p-3 shadow-lg"
        style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <p className="text-xs leading-relaxed text-ink">
          <span className="font-semibold">A new version of Sonoscope is ready.</span>{' '}
          {measuring
            ? 'A measurement is in progress, so the update is being held back. Stop the measurement to apply it.'
            : 'Reloading takes a couple of seconds.'}
        </p>
        <div className="mt-2 flex gap-2">
          <Button
            size="sm"
            variant="accent"
            disabled={measuring}
            onClick={() => {
              waiting.postMessage({ type: 'SKIP_WAITING' });
            }}
          >
            Update now
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setWaiting(null)}>
            Later
          </Button>
        </div>
      </div>
    );
  }

  if (offlineReady) {
    return (
      <div
        role="status"
        className="fixed inset-x-3 bottom-20 z-40 rounded-lg border border-ok/40 bg-ok/10 px-3 py-2 text-xs text-ok"
        style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        Sonoscope is cached and ready to work offline.
      </div>
    );
  }

  return null;
}

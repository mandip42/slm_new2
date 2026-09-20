'use client';

import { useSyncExternalStore } from 'react';

/**
 * False during server rendering and the first client render, true afterwards.
 *
 * Every screen is prerendered to static HTML, so anything read from `navigator`,
 * `window` or the clock during render differs between the server output and the
 * client and produces a hydration mismatch. Gating such values on this hook makes
 * the first client render match the server exactly, then fills in the real values.
 *
 * Implemented with useSyncExternalStore rather than a state-setting effect: it
 * has an explicit server snapshot, which is precisely the distinction needed, and
 * it does not trigger a second render pass through an effect.
 */

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export function useIsHydrated(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}

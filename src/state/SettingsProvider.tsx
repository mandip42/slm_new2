'use client';

/**
 * Settings context.
 *
 * Settings are loaded once from IndexedDB and then kept in React state. Writes
 * are optimistic: the UI updates immediately and the persistence happens in the
 * background, because a settings write must never make a control feel laggy.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  resetSettings,
  saveSettings,
  type AppSettings,
} from '@/storage/settingsStore';

interface SettingsContextValue {
  settings: AppSettings;
  /** False until the stored settings have been read. */
  ready: boolean;
  /** Non-null when settings could not be persisted (private browsing, quota). */
  storageError: string | null;
  update: (patch: Partial<AppSettings>) => void;
  reset: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadSettings()
      .then((loaded) => {
        if (!cancelled) setSettings(loaded);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setStorageError(
          error instanceof Error
            ? error.message
            : 'Settings could not be loaded from local storage.'
        );
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback((patch: Partial<AppSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
    saveSettings(patch).catch((error: unknown) => {
      setStorageError(
        error instanceof Error ? error.message : 'Settings could not be saved locally.'
      );
    });
  }, []);

  const reset = useCallback(async () => {
    const next = await resetSettings();
    setSettings(next);
  }, []);

  // Theme and outdoor mode are applied to <html> so the CSS variables in
  // globals.css can switch the whole palette at once.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.classList.toggle('theme-light', settings.theme === 'light');
    root.classList.toggle('outdoor', settings.outdoorMode);
    const themeColor = settings.theme === 'light' ? '#f4f7fa' : '#05080c';
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', themeColor);
  }, [settings.theme, settings.outdoorMode]);

  const value = useMemo<SettingsContextValue>(
    () => ({ settings, ready, storageError, update, reset }),
    [settings, ready, storageError, update, reset]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useSettings must be used inside SettingsProvider');
  return context;
}

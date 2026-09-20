'use client';

import type { ReactNode } from 'react';
import { SettingsProvider } from './SettingsProvider';
import { CalibrationProvider } from './CalibrationProvider';
import { EngineProvider } from './EngineProvider';
import { MeasurementProvider } from './MeasurementProvider';

/**
 * Provider order matters:
 *   Settings      -> everything reads it
 *   Calibration   -> needs settings (active profile id, correction toggle)
 *   Engine        -> needs settings (analysis configuration)
 *   Measurement   -> needs engine and calibration
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <CalibrationProvider>
        <EngineProvider>
          <MeasurementProvider>{children}</MeasurementProvider>
        </EngineProvider>
      </CalibrationProvider>
    </SettingsProvider>
  );
}

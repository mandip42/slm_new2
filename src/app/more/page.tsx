'use client';

import Link from 'next/link';
import { APP_ROUTES, type RouteGroup } from '@/lib/routes';
import { useCalibration } from '@/state/CalibrationProvider';
import { useEngineContext } from '@/state/EngineProvider';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { Badge, Panel, PanelHeader, cx } from '@/components/ui/primitives';

const GROUP_TITLES: Record<RouteGroup, string> = {
  primary: 'Measurement',
  analysis: 'Analysis',
  measurement: 'Results',
  calibration: 'Calibration and validation',
  system: 'System',
  developer: 'Developer',
};

const GROUP_ORDER: RouteGroup[] = [
  'analysis',
  'measurement',
  'calibration',
  'system',
  'developer',
];

export default function MorePage() {
  const { calibration, quality } = useCalibration();
  const { status } = useEngineContext();

  return (
    <div className="space-y-3">
      <ScreenHeader title="All screens" subtitle="Everything Sonoscope can do." />

      <div className="flex flex-wrap gap-2">
        <Badge tone={status.state === 'running' ? 'good' : 'warn'}>
          input {status.state}
        </Badge>
        <Badge tone={calibration.isCalibrated ? 'good' : 'warn'}>{quality.status}</Badge>
        {status.sampleRate ? <Badge tone="neutral">{status.sampleRate} Hz</Badge> : null}
      </div>

      {GROUP_ORDER.map((group) => {
        const routes = APP_ROUTES.filter((route) => route.group === group && !route.hidden);
        if (routes.length === 0) return null;
        return (
          <Panel key={group}>
            <PanelHeader title={GROUP_TITLES[group]} />
            <ul className="divide-y divide-line">
              {routes.map((route) => (
                <li key={route.href}>
                  <Link
                    href={route.href}
                    className={cx(
                      'flex touch items-center justify-between gap-3 py-2.5 transition-colors',
                      'hover:text-accent'
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ink">{route.label}</span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-faint">
                        {route.description}
                      </span>
                    </span>
                    <span className="shrink-0 text-faint">&rsaquo;</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        );
      })}

      <p className="px-1 text-[11px] leading-relaxed text-faint">
        Microphone audio is processed locally on this device and is never uploaded. Sonoscope is a
        calibrated smartphone measurement tool, not an IEC 61672 classified sound level meter.
      </p>
    </div>
  );
}

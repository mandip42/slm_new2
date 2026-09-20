'use client';

import type { ReactNode } from 'react';

/**
 * Screen title block.
 *
 * Compact by design: on a phone in portrait the meter needs the vertical space
 * far more than a heading does.
 */
export function ScreenHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-base leading-tight font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle ? (
          <p className="mt-0.5 text-[11px] leading-snug text-faint">{subtitle}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

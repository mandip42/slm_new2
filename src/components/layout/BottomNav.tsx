'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BOTTOM_NAV_HREFS, routeByHref } from '@/lib/routes';
import { cx } from '@/components/ui/primitives';

/**
 * Bottom navigation.
 *
 * Five destinations, thumb-reachable, with a safe-area inset so it clears the
 * Android gesture bar. Icons are inline SVG so nothing has to load before the
 * navigation is usable offline.
 */

const ICONS: Record<string, React.ReactNode> = {
  '/': (
    <>
      <rect x="3" y="13" width="3" height="7" rx="1" />
      <rect x="8" y="9" width="3" height="11" rx="1" />
      <rect x="13" y="4" width="3" height="16" rx="1" />
      <rect x="18" y="11" width="3" height="9" rx="1" />
    </>
  ),
  '/spectrum': (
    <path
      d="M2 18c2-0.5 3-8 5-8s2.5 6 4 6 2-10 4-10 2.5 9 4 9 2-2 3-2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  ),
  '/octave': (
    <>
      <rect x="2.5" y="14" width="3.2" height="6" rx="0.8" />
      <rect x="7" y="10" width="3.2" height="10" rx="0.8" />
      <rect x="11.5" y="6" width="3.2" height="14" rx="0.8" />
      <rect x="16" y="12" width="3.2" height="8" rx="0.8" />
    </>
  ),
  '/history': (
    <path
      d="M2 16l4-5 3 3 4-8 3 6 3-3 3 4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  '/more': (
    <>
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </>
  ),
};

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main navigation"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-shell/97 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <ul className="mx-auto flex max-w-3xl">
        {BOTTOM_NAV_HREFS.map((href) => {
          const route = routeByHref(href);
          if (!route) return null;
          const active =
            href === '/'
              ? pathname === '/'
              : href === '/more'
                ? pathname === '/more' || isSecondaryRoute(pathname)
                : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-1.5 transition-colors',
                  active ? 'text-accent' : 'text-faint hover:text-muted'
                )}
              >
                <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
                  {ICONS[href]}
                </svg>
                <span className="text-[10px] leading-none font-semibold tracking-wide">
                  {route.short}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Any route that is reached through the More screen. */
function isSecondaryRoute(pathname: string): boolean {
  return BOTTOM_NAV_HREFS.every(
    (href) => href === '/' || (pathname !== href && !pathname.startsWith(`${href}/`))
  )
    ? pathname !== '/'
    : false;
}

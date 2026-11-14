/**
 * Predict IQ - Public demo mode helpers.
 *
 * The public demo is a separate top-level route (/demo) with no Supabase
 * session and no authenticated workspace. These pure helpers are the single
 * place that decides "are we in the demo?" and translate demo paths into tabs,
 * so the router, the demo workbench and the tests cannot drift apart.
 */

import type { NavTab } from '../components/Sidebar';

/** Public demo root. Direct navigation and refresh must work here. */
export const DEMO_ROOT_PATH = '/demo';

/**
 * Dashboard sections exposed to demo visitors. Read-only data sections only:
 * the 3D twin, feedback capture and system diagnostics are authenticated
 * product surfaces and stay out of the public demo.
 */
export const DEMO_TAB_IDS: NavTab[] = [
  'dashboard',
  'machines',
  'machine-details',
  'predictions',
  'maintenance',
  'alerts',
  'sensor-data',
];

/**
 * Authenticated-only surfaces kept out of the public demo:
 * - 3d-view / monitoring: driven by the simulation + hardware providers, which
 *   read and write authenticated simulation configuration;
 * - feedback: a technician data-capture form (write-only);
 * - settings: per-deployment diagnostics and API configuration.
 */
export const DEMO_HIDDEN_TABS: NavTab[] = [
  '3d-view',
  'monitoring',
  'feedback',
  'settings',
];

function normalisePath(pathname: string): string {
  const clean = (pathname || '/').split('?')[0].split('#')[0];
  if (clean.length > 1 && clean.endsWith('/')) return clean.slice(0, -1);
  return clean.toLowerCase();
}

/** True for /demo and any /demo/<section> path. */
export function isPublicDemoPath(pathname: string): boolean {
  const path = normalisePath(pathname);
  return path === DEMO_ROOT_PATH || path.startsWith(`${DEMO_ROOT_PATH}/`);
}

/** Resolve the active demo section from the URL (defaults to the dashboard). */
export function resolveDemoTab(pathname: string): NavTab {
  const path = normalisePath(pathname);
  if (path === DEMO_ROOT_PATH) return 'dashboard';
  const candidate = path.slice(DEMO_ROOT_PATH.length + 1);
  return (DEMO_TAB_IDS as string[]).includes(candidate)
    ? (candidate as NavTab)
    : 'dashboard';
}

/** Canonical browser path for a demo section. */
export function demoTabPath(tab: NavTab): string {
  return tab === 'dashboard' ? DEMO_ROOT_PATH : `${DEMO_ROOT_PATH}/${tab}`;
}

/**
 * Raised whenever a write is attempted through the demo data service. The demo
 * UI hides write controls, and the backend has no write routes for the demo;
 * this is the third layer, so a missed button can never mutate a record.
 */
export class DemoReadOnlyError extends Error {
  public readonly code = 'DEMO_READ_ONLY';

  public constructor(action: string) {
    super(
      `The public demo is read-only: "${action}" is not available without signing in.`
    );
    this.name = 'DemoReadOnlyError';
  }
}

export function isDemoReadOnlyError(err: unknown): err is DemoReadOnlyError {
  return (
    err instanceof DemoReadOnlyError ||
    (typeof err === 'object' &&
      err !== null &&
      (err as { code?: string }).code === 'DEMO_READ_ONLY')
  );
}

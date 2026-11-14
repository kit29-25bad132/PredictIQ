/**
 * Predict IQ - Public demo frontend verification suite.
 *
 * Runs with `npx tsx src/tests/publicDemo.test.ts` (same harness style as
 * authSystem.test.ts). No DOM and no network: route helpers are pure, the demo
 * API service is exercised against a mocked fetch, and the top-level wiring
 * (/demo dispatch before AuthProvider, landing-page buttons, read-only props)
 * is asserted from source.
 *
 * What this does NOT prove: visual rendering and browser behaviour. Those are
 * covered by the manual local testing guide in docs/PUBLIC-DEMO.md.
 */

import fs from 'node:fs';
import path from 'node:path';
import api, { ApiError } from '../services/api';
import demoApi from '../services/demoApi';
import {
  DEMO_HIDDEN_TABS,
  DEMO_ROOT_PATH,
  DEMO_TAB_IDS,
  DemoReadOnlyError,
  demoTabPath,
  isDemoReadOnlyError,
  isPublicDemoPath,
  resolveDemoTab,
} from '../lib/demoMode';

let passedCount = 0;
let totalCount = 0;

function assert(condition: boolean, testName: string) {
  totalCount++;
  if (condition) {
    console.log(`  [PASS] Test ${totalCount}: ${testName}`);
    passedCount++;
  } else {
    console.error(`  [FAIL] Test ${totalCount}: ${testName}`);
    throw new Error(`Test assertion failed for: ${testName}`);
  }
}

const repoRoot = path.resolve(process.cwd(), '..');
const read = (relative: string) =>
  fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

interface RecordedRequest {
  url: string;
  headers: Record<string, string>;
  credentials?: RequestInit['credentials'];
}

function withMockedFetch(
  responder: (request: RecordedRequest, callIndex: number) => { status: number; body: any },
  run: (recorded: RecordedRequest[]) => Promise<void>
) {
  const recorded: RecordedRequest[] = [];
  const originalFetch = (globalThis as any).fetch;
  (globalThis as any).fetch = async (url: string, options: RequestInit = {}) => {
    const entry: RecordedRequest = {
      url: String(url),
      headers: { ...((options.headers as Record<string, string>) || {}) },
      credentials: options.credentials,
    };
    recorded.push(entry);
    const result = responder(entry, recorded.length - 1);
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      statusText: 'Mocked',
      json: async () => result.body,
    };
  };
  return run(recorded).finally(() => {
    (globalThis as any).fetch = originalFetch;
  });
}

console.log('================================================================');
console.log('PREDICT IQ - PUBLIC DEMO VERIFICATION SUITE');
console.log('================================================================\n');

// ============================================================================
// 1. Route helpers
// ============================================================================
console.log('-- Public demo routing --');
{
  assert(DEMO_ROOT_PATH === '/demo', 'The public demo root is /demo.');
  assert(isPublicDemoPath('/demo'), 'Direct /demo navigation is a public demo route.');
  assert(isPublicDemoPath('/demo/'), 'Trailing-slash /demo refresh stays in the demo.');
  assert(isPublicDemoPath('/demo/alerts'), 'Demo sections stay public.');
  assert(isPublicDemoPath('/DEMO/Predictions'), 'Demo routing is case-insensitive.');
  assert(
    isPublicDemoPath('/demo/predictions?range=24h'),
    'Query strings do not break demo route detection.'
  );
  assert(!isPublicDemoPath('/'), 'The landing page is not the demo route.');
  assert(!isPublicDemoPath('/dashboard'), 'Authenticated dashboard routes are not the demo.');
  assert(!isPublicDemoPath('/demolition'), 'Prefix lookalikes are not the demo route.');

  assert(resolveDemoTab('/demo') === 'dashboard', 'The demo root opens the dashboard.');
  assert(
    resolveDemoTab('/demo/maintenance') === 'maintenance',
    'Deep links resolve the requested demo section.'
  );
  assert(
    resolveDemoTab('/demo/unknown') === 'dashboard',
    'Unknown demo paths fall back to the dashboard.'
  );
  assert(
    resolveDemoTab('/demo/feedback') === 'dashboard',
    'Authenticated-only sections are not addressable in the demo.'
  );
  assert(
    demoTabPath('dashboard') === '/demo' && demoTabPath('alerts') === '/demo/alerts',
    'Demo tab paths are canonical.'
  );

  assert(!DEMO_TAB_IDS.includes('feedback'), 'Feedback capture is not part of the public demo.');
  assert(!DEMO_TAB_IDS.includes('settings'), 'Deployment settings are not part of the public demo.');
  for (const hidden of ['3d-view', 'monitoring', 'feedback', 'settings'] as const) {
    assert(DEMO_HIDDEN_TABS.includes(hidden), `Demo hides the ${hidden} section.`);
  }
}

// ============================================================================
// 2. Read-only guard
// ============================================================================
console.log('\n-- Read-only guard --');
{
  let thrown: unknown = null;
  try {
    demoApi.rejectWrite('acknowledge alert');
  } catch (err) {
    thrown = err;
  }
  assert(thrown instanceof DemoReadOnlyError, 'Demo write attempts raise DemoReadOnlyError.');
  assert(isDemoReadOnlyError(thrown), 'The read-only error is recognised by helpers.');
  assert(
    (thrown as Error).message.includes('read-only'),
    'The read-only error tells the visitor the demo cannot mutate records.'
  );

  const writeMethods = [
    'acknowledgeAlert',
    'resolveAlert',
    'createMaintenanceRecord',
    'addFeedback',
    'sendSensorData',
    'registerMachine',
    'registerDevice',
    'saveSimulationConfig',
    'resetSimulationConfig',
  ];
  assert(
    writeMethods.every((name) => typeof (demoApi as any)[name] !== 'function'),
    'The demo data service exposes no write methods at all.'
  );
}

// ============================================================================
// 3. Credential-free reads against the public demo API
// ============================================================================
console.log('\n-- Demo API transport --');
{
  // Even if the app has an auth token provider configured, the demo service
  // must never attach it.
  api.setAuthTokenProvider(() => 'user-access-token');
  api.setOrganizationId('11111111-1111-4111-8111-111111111111');

  await withMockedFetch(
    () => ({
      status: 200,
      body: { mode: 'PUBLIC_DEMO', dataset: { notice: 'simulated' }, stats: {}, generated_at: '' },
    }),
    async (recorded) => {
      await demoApi.getOverview();
      assert(
        recorded[0].url === '/api/public/demo/overview',
        'Overview is read from /api/public/demo/overview.'
      );
    }
  );

  await withMockedFetch(
    () => ({ status: 200, body: { items: [], total: 0, limit: 200, offset: 0 } }),
    async (recorded) => {
      await demoApi.getMachines();
      assert(
        recorded[0].url === '/api/public/demo/machines?limit=200',
        'Machine listing uses the demo endpoint with explicit pagination.'
      );
    }
  );

  await withMockedFetch(
    (request) => {
      assert(
        request.url.startsWith('/api/public/demo/'),
        'Every demo read stays under /api/public/demo.'
      );
      return { status: 200, body: { items: [], total: 0, limit: 50, offset: 0 } };
    },
    async (recorded) => {
      await demoApi.getMachines();
      await demoApi.getAlerts('DM-001', 'active');
      await demoApi.getPredictions('DM-002');
      await demoApi.getMaintenance('DM-003');
      await demoApi.getSensorData('DM-004', 500);

      const credentialsLeak = recorded.some(
        (r) =>
          'Authorization' in r.headers ||
          'X-Organization-Id' in r.headers ||
          'X-API-Key' in r.headers ||
          r.credentials === 'include'
      );
      assert(
        !credentialsLeak,
        'Demo reads attach no Supabase token, organization header, cookie or device key.'
      );
      assert(
        recorded.some((r) => r.url.includes('status_filter=ACTIVE')),
        'Alert status filters are normalised and forwarded.'
      );
      assert(
        recorded.some((r) => r.url.includes('machine_id=DM-002')),
        'Per-machine prediction filters are forwarded.'
      );
      assert(
        recorded.some((r) => r.url.includes('machine_id=DM-004&limit=200')),
        'Reading page size is capped at the API maximum (200).'
      );
    }
  );

  api.setAuthTokenProvider(null);
  api.setOrganizationId(null);
}

// ============================================================================
// 4. Error states surface real failures
// ============================================================================
console.log('\n-- Demo API error handling --');
{
  await withMockedFetch(
    () => ({ status: 404, body: { detail: 'Demo machine not found.' } }),
    async () => {
      let error: unknown = null;
      try {
        await demoApi.getMachineDetails('NOPE-1');
      } catch (err) {
        error = err;
      }
      assert(
        error instanceof ApiError && error.status === 404,
        'A missing demo machine surfaces a real 404 (not empty data).'
      );
      assert(
        (error as Error).message === 'Demo machine not found.',
        'The API detail is preserved for the demo error state.'
      );
    }
  );

  const originalFetch = (globalThis as any).fetch;
  (globalThis as any).fetch = async () => {
    throw new TypeError('network down');
  };
  let networkError: unknown = null;
  try {
    await demoApi.getMachines();
  } catch (err) {
    networkError = err;
  } finally {
    (globalThis as any).fetch = originalFetch;
  }
  assert(
    networkError instanceof Error &&
      (networkError as Error).message.includes('Could not reach the PredictIQ demo API'),
    'Network failures are reported, never swallowed into empty dashboards.'
  );
}

// ============================================================================
// 5. Application wiring (source-level, no DOM)
// ============================================================================
console.log('\n-- Application wiring --');
{
  const appSource = read('src/App.tsx');
  const homeSource = read('src/pages/HomePage.tsx');
  const demoDashboard = read('src/components/DemoDashboard.tsx');

  assert(
    appSource.includes('isPublicDemoPath(window.location.pathname)'),
    'App dispatches on the /demo path before rendering the authenticated app.'
  );
  assert(
    appSource.indexOf('<DemoDashboard />') < appSource.indexOf('<AuthProvider>'),
    'The demo route renders before (and without) AuthProvider — no fake Supabase session.'
  );
  assert(
    !demoDashboard.includes('<AuthProvider') &&
      !demoDashboard.includes('initializeWorkspace('),
    'The demo workbench never mounts AuthProvider or initializes a workspace.'
  );
  assert(
    demoDashboard.includes('dataService={demoApi}'),
    'Demo pages receive the dedicated demo data service.'
  );
  assert(
    demoDashboard.includes('<AlarmProvider backendSync={false}>'),
    'The demo alarm provider does not call authenticated alert endpoints.'
  );

  for (const id of [
    'btn-nav-explore-demo',
    'btn-hero-explore-demo',
    'btn-mobile-explore-demo',
    'btn-footer-explore-demo',
  ]) {
    assert(homeSource.includes(`id="${id}"`), `Landing page exposes the ${id} call to action.`);
  }
  assert(
    homeSource.includes('id="btn-nav-signin"') && homeSource.includes('id="btn-mobile-signin"'),
    'Existing Sign In entry points are preserved.'
  );
  assert(
    !homeSource.includes('onNavigate(\'demo\')'),
    'Explore Demo performs a real navigation to /demo instead of the in-app router.'
  );
  assert(
    appSource.includes("window.location.assign('/demo')"),
    'Explore Demo navigates to /demo without initializing the authenticated workspace.'
  );

  const pagesUsingDemo = [
    'src/pages/DashboardPage.tsx',
    'src/pages/MachineDetailsPage.tsx',
    'src/pages/PredictionsPage.tsx',
    'src/pages/MaintenancePage.tsx',
    'src/pages/AlertsPage.tsx',
    'src/pages/SensorDataPage.tsx',
  ];
  assert(
    pagesUsingDemo.every((file) => read(file).includes('dataService = api')),
    'Adapted pages default to the authenticated API when no demo service is passed.'
  );

  // Landing page must not authenticate visitors; demo target is a plain path.
  assert(
    repoRoot.length > 0 && !homeSource.includes('supabase'),
    'The landing page never creates an authentication session itself.'
  );
}

// ============================================================================
// Summary
// ============================================================================
console.log('\n================================================================');
console.log(`ALL ${passedCount}/${totalCount} PUBLIC DEMO TESTS PASSED SUCCESSFULLY!`);
console.log('================================================================');

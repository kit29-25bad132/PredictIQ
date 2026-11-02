/**
 * Phase 5 finalization - invisible personal workspace initialization.
 *
 * Runs under `npx tsx src/tests/workspaceInitialization.test.ts` (same harness
 * style as authSystem.test.ts). No network, no DOM, no credentials: the API
 * call is a fake promise.
 */

import { WorkspaceInitializer, WORKSPACE_ERROR_MESSAGE, workspaceStorageKey } from '../lib/workspaceInit';
import * as AuthScreens from '../components/auth/AuthScreens';
import type { OrganizationSummary } from '../services/api';

let passed = 0;
let total = 0;

function assert(condition: boolean, name: string) {
  total += 1;
  if (!condition) throw new Error(`FAIL: ${name}`);
  passed += 1;
  console.log(`  [PASS] ${name}`);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class MemoryStorage {
  public readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

const ws = (id: string, name = 'My Workspace'): OrganizationSummary => ({
  id,
  name,
  slug: `ws-${id}`,
  role: 'owner',
  status: 'active',
});

interface Harness {
  initializer: WorkspaceInitializer;
  storage: MemoryStorage;
  selected: Array<string | null>;
  fetchedWith: Array<string | null>;
  setUser(userId: string | null): void;
  setFetch(fn: (saved: string | null) => Promise<OrganizationSummary>): void;
}

function makeHarness(initialUser: string | null, initialFetch?: (saved: string | null) => Promise<OrganizationSummary>): Harness {
  let userId = initialUser;
  let fetchFn = initialFetch ?? (async () => ws('ws-default'));
  const storage = new MemoryStorage();
  const selected: Array<string | null> = [];
  const fetchedWith: Array<string | null> = [];

  const initializer = new WorkspaceInitializer({
    getUserId: () => userId,
    fetchWorkspace: (saved) => {
      fetchedWith.push(saved);
      return fetchFn(saved);
    },
    selectWorkspace: (id) => selected.push(id),
    storage,
  });

  return {
    initializer,
    storage,
    selected,
    fetchedWith,
    setUser(next) {
      userId = next;
    },
    setFetch(fn) {
      fetchFn = fn;
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// 1. Successful login initializes the workspace automatically.
{
  const h = makeHarness('u-1', async () => ws('ws-1'));
  await h.initializer.sync();
  assert(h.initializer.getState().status === 'ready', 'Login initializes the workspace automatically.');
  assert(h.initializer.getState().workspace?.id === 'ws-1', 'Workspace id is applied to the session.');
  assert(h.selected.at(-1) === 'ws-1', 'Tenant selector is set from the backend response.');
}

// 2. Registration reaches the dashboard only after authentication + initialization.
{
  const h = makeHarness(null);
  await h.initializer.sync();
  assert(h.initializer.getState().status === 'idle', 'Signed-out registration flow stays idle.');

  h.setUser('u-2');
  h.setFetch(async () => ws('ws-2'));
  await h.initializer.sync();
  assert(h.initializer.getState().status === 'ready', 'After sign-up + sign-in the workspace is ready.');
}

// 3. OAuth callback triggers the same initialization.
{
  const h = makeHarness(null);
  h.setUser('u-oauth');
  h.setFetch(async () => ws('ws-oauth'));
  await h.initializer.sync();
  assert(h.initializer.getState().workspace?.id === 'ws-oauth', 'OAuth callback initializes the workspace.');
}

// 4. Existing authenticated session restores the saved workspace id.
{
  const h = makeHarness('u-3', async (saved) => ws(saved ?? 'ws-fallback'));
  h.storage.setItem(workspaceStorageKey('u-3'), 'ws-saved');
  await h.initializer.sync();
  assert(h.fetchedWith[0] === 'ws-saved', 'Restored session sends the stored selection.');
  assert(h.initializer.getState().workspace?.id === 'ws-saved', 'Saved workspace is reused after refresh.');
}

// 5. The organization setup / creation experience is gone from the screens module.
{
  assert(!('OrganizationPendingScreen' in AuthScreens), 'No organization setup screen is exported.');
  assert(!('OrganizationCreateForm' in AuthScreens), 'No organization creation form is exported.');
  assert(typeof AuthScreens.WorkspaceInitializingScreen === 'function', 'A neutral initialization loader is shown instead.');
  assert(typeof AuthScreens.WorkspaceSetupErrorScreen === 'function', 'A retryable failure screen is available.');
  assert(WORKSPACE_ERROR_MESSAGE.toLowerCase().indexOf('organization') === -1, 'Error copy never mentions organizations.');
}

// 6. The dashboard is not marked ready before initialization resolves.
{
  const pending = deferred<OrganizationSummary>();
  const h = makeHarness('u-4', () => pending.promise);
  const run = h.initializer.sync();
  await flush();
  assert(h.initializer.getState().status === 'loading', 'Workspace stays loading while the backend responds.');
  assert(h.initializer.getState().workspace === null, 'No workspace is exposed before initialization succeeds.');
  assert(!h.selected.includes('ws-4'), 'Tenant selector is not set before initialization succeeds.');
  pending.resolve(ws('ws-4'));
  await run;
  assert(h.initializer.getState().status === 'ready', 'Workspace becomes ready only after the response.');
}

// 7. Provisioning failure shows a retryable error and retry recovers.
{
  const h = makeHarness('u-5', async () => {
    throw new Error('network down');
  });
  await h.initializer.sync();
  assert(h.initializer.getState().status === 'error', 'Failure surfaces as an error state.');
  assert(h.initializer.getState().error === WORKSPACE_ERROR_MESSAGE, 'Failure copy is user-facing and retryable.');

  h.setFetch(async () => ws('ws-5'));
  await h.initializer.retry();
  assert(h.initializer.getState().status === 'ready', 'Retry initializes the workspace.');
  assert(h.initializer.getState().workspace?.id === 'ws-5', 'Retry applies the workspace.');
}

// 8. Logout clears workspace state and the stored selection.
{
  const h = makeHarness('u-6', async () => ws('ws-6'));
  await h.initializer.sync();
  h.setUser(null);
  await h.initializer.sync();
  assert(h.initializer.getState().status === 'idle', 'Logout resets workspace status.');
  assert(h.initializer.getState().workspace === null, 'Logout clears the workspace.');
  assert(h.selected.at(-1) === null, 'Logout clears the tenant selector.');
  assert(h.storage.getItem(workspaceStorageKey('u-6')) === null, 'Logout removes the stored selection.');
}

// 9. Switching authenticated users never reuses the previous workspace.
{
  const h = makeHarness('u-7', async () => ws('ws-7'));
  await h.initializer.sync();

  h.setUser('u-8');
  const secondUser = deferred<OrganizationSummary>();
  h.setFetch(() => secondUser.promise);
  const switched = h.initializer.sync();
  await flush();
  assert(h.initializer.getState().workspace === null, 'Previous workspace is dropped while the new user loads.');
  secondUser.resolve(ws('ws-8'));
  await switched;
  assert(h.initializer.getState().workspace?.id === 'ws-8', 'New user gets their own workspace.');
  assert(h.selected.at(-1) === 'ws-8', 'Tenant selector follows the new user.');
}

// 10. Stale responses from a previous user are ignored.
{
  const first = deferred<OrganizationSummary>();
  const second = deferred<OrganizationSummary>();
  const h = makeHarness('u-9', () => first.promise);

  const runFirst = h.initializer.sync();
  h.setUser('u-10');
  h.setFetch(() => second.promise);
  const runSecond = h.initializer.sync();

  second.resolve(ws('ws-10'));
  await runSecond;

  first.resolve(ws('ws-9'));
  await runFirst;

  assert(h.initializer.getState().workspace?.id === 'ws-10', 'Stale workspace response cannot overwrite the current user.');
  assert(h.selected.at(-1) === 'ws-10', 'Stale response does not change the tenant selector.');
}

// 11. Duplicate auth events do not issue duplicate initialization requests.
{
  let calls = 0;
  const pending = deferred<OrganizationSummary>();
  const h = makeHarness('u-11', () => {
    calls += 1;
    return pending.promise;
  });

  const first = h.initializer.sync();
  const second = h.initializer.sync();
  const third = h.initializer.sync();
  await flush();
  assert(calls === 1, 'Repeated sync calls share one in-flight request.');
  pending.resolve(ws('ws-11'));
  await Promise.all([first, second, third]);
  assert(h.initializer.getState().workspace?.id === 'ws-11', 'Shared request applies the workspace once.');
}

console.log(`ALL ${passed}/${total} WORKSPACE INITIALIZATION TESTS PASSED`);

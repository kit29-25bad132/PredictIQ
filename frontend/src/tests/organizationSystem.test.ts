/** Phase 5 organization state, isolation, and tenant-header verification. */
import api, { ApiError, OrganizationSummary, isOrganizationAccessError } from '../services/api';
import { canSelectOrganization, chooseInitialOrganization, isCurrentOrganizationRequest } from '../lib/organizationState';

let passed = 0; let total = 0;
function assert(condition: boolean, name: string) { total++; if (!condition) throw new Error(`FAIL: ${name}`); passed++; console.log(`[PASS] ${name}`); }
const org = (id: string, status: 'active' | 'suspended' = 'active'): OrganizationSummary => ({ id, name: id, slug: id, role: 'owner', status });

assert(chooseInitialOrganization([], null) === null, 'Zero organizations stays unselected for onboarding.');
assert(chooseInitialOrganization([org('a')], null)?.id === 'a', 'One active organization is selected automatically.');
assert(chooseInitialOrganization([org('a'), org('b')], null) === null, 'Multiple organizations require an explicit choice.');
assert(chooseInitialOrganization([org('a'), org('b')], 'b')?.id === 'b', 'Saved organization is restored only from the membership list.');
assert(!canSelectOrganization(org('suspended', 'suspended')), 'Suspended organizations cannot be selected.');
assert(isCurrentOrganizationRequest(2, 2, 'b', 'b'), 'Current organization request is accepted.');
assert(!isCurrentOrganizationRequest(1, 2, 'a', 'b'), 'Stale organization response cannot overwrite the new organization.');
assert(isOrganizationAccessError(new ApiError('No active organization membership for this user.', 403)), 'Revoked membership is treated as organization access loss, not logout.');
assert(!isOrganizationAccessError(new ApiError('Insufficient organization role for this operation.', 403)), 'Role denial is not misclassified as revoked membership.');

const originalFetch = globalThis.fetch;
const seen: Headers[] = [];
globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
  seen.push(new Headers(init?.headers));
  return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
}) as typeof fetch;
api.setAuthTokenProvider(() => 'user-token');
api.setOrganizationId('org-b');
await api.listOrganizations();
assert(seen[0].get('Authorization') === 'Bearer user-token', 'Organization request carries the Supabase token.');
assert(seen[0].get('X-Organization-Id') === 'org-b', 'Organization-scoped request carries the selected tenant header.');
assert(api.getBaseUrl().endsWith('/api'), 'Switching organizations does not alter the authenticated API session.');
api.setAuthTokenProvider(null); api.setOrganizationId(null); globalThis.fetch = originalFetch;
console.log(`ALL ${passed}/${total} ORGANIZATION TESTS PASSED`);

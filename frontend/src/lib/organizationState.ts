import type { OrganizationSummary } from '../services/api';

export function chooseInitialOrganization(
  organizations: OrganizationSummary[], savedId: string | null,
): OrganizationSummary | null {
  const active = organizations.filter((org) => org.status === 'active');
  return active.find((org) => org.id === savedId) || (active.length === 1 ? active[0] : null);
}

export function canSelectOrganization(org: OrganizationSummary | undefined): boolean {
  return org?.status === 'active';
}

export function isCurrentOrganizationRequest(
  requestGeneration: number,
  currentGeneration: number,
  requestOrganizationId: string,
  currentOrganizationId: string | null,
): boolean {
  return requestGeneration === currentGeneration && requestOrganizationId === currentOrganizationId;
}

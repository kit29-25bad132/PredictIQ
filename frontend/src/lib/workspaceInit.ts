/**
 * Predict IQ - Personal workspace initialization controller.
 *
 * Framework-free core of the invisible onboarding flow. `AuthContext` binds it
 * to React; tests drive it with fakes (no network, no DOM).
 *
 * Rules encoded here:
 * - authentication and workspace initialization are one flow: the app is only
 *   'ready' after the backend confirms a workspace
 * - at most one initialization request per authenticated user at a time
 * - responses from a previous user/session are ignored (generation guard)
 * - logout clears the workspace, the tenant header and the stored selection
 * - the stored selection is per user, so one account can never inherit another's
 */

import type { OrganizationSummary } from '../services/api';

export type WorkspaceStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface WorkspaceState {
  status: WorkspaceStatus;
  workspace: OrganizationSummary | null;
  options: OrganizationSummary[];
  error: string | null;
}

export const WORKSPACE_STORAGE_PREFIX = 'predictiq-workspace:';

/** Per-user storage key: a selection can never be read by another account. */
export function workspaceStorageKey(userId: string): string {
  return `${WORKSPACE_STORAGE_PREFIX}${userId}`;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface WorkspaceInitializerDeps {
  /** Current authenticated user id, or null when signed out. */
  getUserId(): string | null;
  /** Calls the backend workspace endpoint (JWT attached by the API client). */
  fetchWorkspace(savedWorkspaceId: string | null): Promise<OrganizationSummary>;
  /** Sets/clears the tenant selector used by subsequent API requests. */
  selectWorkspace(id: string | null): void;
  /** Lists active memberships after the backend requests an explicit choice. */
  listWorkspaces?: () => Promise<OrganizationSummary[]>;
  storage: StorageLike;
}

const IDLE_STATE: WorkspaceState = { status: 'idle', workspace: null, options: [], error: null };

/** Neutral, retryable copy: no organization/tenant/provisioning internals. */
export const WORKSPACE_ERROR_MESSAGE =
  "We couldn't finish setting up your workbench. Please retry.";

export class WorkspaceInitializer {
  private state: WorkspaceState = { ...IDLE_STATE };
  private readonly listeners = new Set<(state: WorkspaceState) => void>();
  private generation = 0;
  private inFlight: { userId: string; generation: number } | null = null;
  /** User that owns the currently applied workspace (null while none). */
  private ownerId: string | null = null;

  public constructor(private readonly deps: WorkspaceInitializerDeps) {}

  public getState(): WorkspaceState {
    return this.state;
  }

  public subscribe(listener: (state: WorkspaceState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Reconcile with the current auth state. Safe to call on every auth event /
   * render: repeats for the same user while a request is in flight are ignored.
   */
  public sync(): Promise<void> {
    const userId = this.deps.getUserId();
    if (!userId) {
      this.reset();
      return Promise.resolve();
    }
    if (this.inFlight?.userId === userId) return Promise.resolve();
    return this.run(userId);
  }

  /** User-initiated retry after a failed initialization. */
  public retry(): Promise<void> {
    const userId = this.deps.getUserId();
    if (!userId) {
      this.reset();
      return Promise.resolve();
    }
    return this.run(userId);
  }

  /** Clear active state (logout / dead session), but retain the per-user choice.
   * The saved ID is never authorization: the backend revalidates it at every
   * restored session before it becomes the organization request header. */
  public reset(): void {
    const userId = this.ownerId ?? this.inFlight?.userId ?? null;
    this.generation += 1;
    this.inFlight = null;
    this.ownerId = null;
    this.deps.selectWorkspace(null);
    this.setState({ ...IDLE_STATE });
  }

  private async run(userId: string): Promise<void> {
    const generation = ++this.generation;
    this.inFlight = { userId, generation };

    // A different authenticated user must never inherit the previous tenant.
    if (this.ownerId !== userId) {
      this.ownerId = null;
      this.deps.selectWorkspace(null);
    }
    this.setState({ status: 'loading', workspace: null, options: [], error: null });

    try {
      const saved = this.deps.storage.getItem(workspaceStorageKey(userId));
      const workspace = await this.deps.fetchWorkspace(saved);
      if (!this.isCurrent(userId, generation)) return;
      if (!workspace || !workspace.id) {
        throw new Error('Workspace response was incomplete.');
      }
      this.ownerId = userId;
      this.deps.selectWorkspace(workspace.id);
      this.deps.storage.setItem(workspaceStorageKey(userId), workspace.id);
      this.setState({ status: 'ready', workspace, options: [], error: null });
    } catch (error) {
      // Stale failures (previous user / superseded request) must not surface.
      if (!this.isCurrent(userId, generation)) return;
      const status = (error as { status?: unknown } | null)?.status;
      const message = (error as { message?: unknown } | null)?.message;
      const needsChoice = status === 400 && typeof message === 'string' && message.includes('Multiple workspaces');
      if (needsChoice && this.deps.listWorkspaces) {
        try {
          const options = (await this.deps.listWorkspaces()).filter((org) => org.status === 'active');
          if (!this.isCurrent(userId, generation)) return;
          this.ownerId = null;
          this.deps.selectWorkspace(null);
          this.setState({ status: 'error', workspace: null, options, error: 'Select a workspace to continue.' });
          return;
        } catch {
          // Fall through to the neutral retryable error below.
        }
      }
      this.ownerId = null;
      this.deps.selectWorkspace(null);
      this.setState({ status: 'error', workspace: null, options: [], error: WORKSPACE_ERROR_MESSAGE });
    } finally {
      if (this.inFlight?.generation === generation) this.inFlight = null;
    }
  }

  /** Persist a requested workspace, then re-run the normal server-verified flow. */
  public chooseWorkspace(organizationId: string): Promise<void> {
    const userId = this.deps.getUserId();
    if (!userId) {
      this.reset();
      return Promise.resolve();
    }
    this.deps.storage.setItem(workspaceStorageKey(userId), organizationId);
    return this.run(userId);
  }

  private isCurrent(userId: string, generation: number): boolean {
    return generation === this.generation && this.deps.getUserId() === userId;
  }

  private setState(next: WorkspaceState): void {
    this.state = next;
    this.listeners.forEach((listener) => {
      try {
        listener(next);
      } catch (err) {
        console.warn('[Workspace] listener error:', err);
      }
    });
  }
}

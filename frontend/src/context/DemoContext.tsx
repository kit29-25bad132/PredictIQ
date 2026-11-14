/**
 * Predict IQ - Public demo data context.
 *
 * Owns the demo fleet snapshot loaded from the public demo API. Deliberately
 * separate from AuthContext: mounting this provider never creates a Supabase
 * session, never initializes an authenticated workspace, and never calls the
 * authenticated API.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { FleetStats, Machine } from '../types';
import demoApi, { DemoOverview } from '../services/demoApi';

type DemoStatus = 'loading' | 'ready' | 'error';

interface DemoContextValue {
  status: DemoStatus;
  isLoading: boolean;
  error: string | null;
  overview: DemoOverview | null;
  machines: Machine[];
  stats: FleetStats;
  activeAlerts: number;
  backendOnline: boolean;
  refresh: () => void;
}

export const EMPTY_DEMO_STATS: FleetStats = {
  total_machines: 0,
  total_devices: 0,
  connected_devices: 0,
  total_sensor_readings: 0,
  total_maintenance_records: 0,
  active_alerts: 0,
  data_collection_status: 'WAITING',
};

const DemoContext = createContext<DemoContextValue | null>(null);

interface Snapshot {
  status: DemoStatus;
  overview: DemoOverview | null;
  machines: Machine[];
  error: string | null;
}

const INITIAL_SNAPSHOT: Snapshot = {
  status: 'loading',
  overview: null,
  machines: [],
  error: null,
};

export const DemoProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [snapshot, setSnapshot] = useState<Snapshot>(INITIAL_SNAPSHOT);

  const load = useCallback(async () => {
    setSnapshot((current) => ({
      ...current,
      status: current.overview ? current.status : 'loading',
      error: null,
    }));
    try {
      const [overview, machines] = await Promise.all([
        demoApi.getOverview(),
        demoApi.getMachines(),
      ]);
      setSnapshot({ status: 'ready', overview, machines, error: null });
    } catch (err: any) {
      // Never mask a failure as empty data: the UI renders a real error state.
      setSnapshot({
        status: 'error',
        overview: null,
        machines: [],
        error:
          err?.message ||
          'The public demo dataset could not be loaded. Please try again.',
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const value = useMemo<DemoContextValue>(() => {
    const stats = snapshot.overview?.stats ?? EMPTY_DEMO_STATS;
    return {
      status: snapshot.status,
      isLoading: snapshot.status === 'loading',
      error: snapshot.error,
      overview: snapshot.overview,
      machines: snapshot.machines,
      stats,
      activeAlerts: stats.active_alerts,
      backendOnline: snapshot.status === 'ready',
      refresh: () => {
        void load();
      },
    };
  }, [snapshot, load]);

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
};

export function useDemo(): DemoContextValue {
  const context = useContext(DemoContext);
  if (!context) {
    throw new Error('useDemo must be used inside <DemoProvider>');
  }
  return context;
}

export default DemoContext;

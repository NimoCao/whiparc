'use client';

import { useEffect, useState } from 'react';
import type { PipelineRun, Project, RunRow } from './types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

interface UseAggregatedRunsResult {
  runs: RunRow[];
  isLoading: boolean;
  error: string | null;
}

// Shared by the Runs page and the dashboard overview — both need the same
// aggregation: GET /api/projects, then GET /api/projects/{id}/runs per
// project, merged and sorted client-side. See product-memory 08.1's
// "Client-Side Fan-Out Aggregation" note for why this pattern (not a
// server-side aggregate endpoint) is the deliberate choice at current scale.
export function useAggregatedRuns(token: string | null | undefined): UseAggregatedRunsResult {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const projRes = await fetch(`${API_URL}/api/projects`, { headers: { Authorization: `Bearer ${token}` } });
        if (!projRes.ok) throw new Error(`Request failed with status ${projRes.status}`);
        const projects: Project[] = await projRes.json();

        const perProject = await Promise.all(
          projects.map(async (p) => {
            try {
              const res = await fetch(`${API_URL}/api/projects/${p.id}/runs`, { headers: { Authorization: `Bearer ${token}` } });
              if (!res.ok) return [] as RunRow[];
              const projectRuns: PipelineRun[] = await res.json();
              return projectRuns.map((r) => ({ ...r, projectId: p.id, projectName: p.name }));
            } catch {
              return [] as RunRow[];
            }
          })
        );
        if (cancelled) return;
        const merged = perProject.flat().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setRuns(merged);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Failed to load runs.';
          setError(msg.includes('fetch') ? 'Cannot connect to the backend server. Please try again shortly.' : msg);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return { runs, isLoading, error };
}

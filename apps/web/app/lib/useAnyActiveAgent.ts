'use client';

import { useEffect, useState } from 'react';
import type { Project } from './types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

// Fans out GET /api/projects/{id}/agents/latest (same pattern as
// useAggregatedRuns) to answer "does this user have a local Sandbox Agent
// connected to any project right now" — used by the dashboard onboarding
// checklist's "Start the sandbox" step (product-memory 08.5 item A6). A
// 404 (no agent ever paired for that project, or the SANDBOX_AGENT_BETA
// flag is off entirely) is treated as "not connected," matching the
// badge-hiding convention this endpoint already establishes elsewhere.
export function useAnyActiveAgent(token: string | null | undefined, projects: Project[]): { hasActiveAgent: boolean; isLoading: boolean } {
  const [hasActiveAgent, setHasActiveAgent] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const results = await Promise.all(
          projects.map(async (p) => {
            try {
              const res = await fetch(`${API_URL}/api/projects/${p.id}/agents/latest`, { headers: { Authorization: `Bearer ${token}` } });
              if (!res.ok) return false;
              const data = await res.json();
              return data.status === 'ACTIVE';
            } catch {
              return false;
            }
          })
        );
        if (!cancelled) setHasActiveAgent(results.some(Boolean));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, projects]);

  return { hasActiveAgent, isLoading };
}

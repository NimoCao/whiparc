'use client';

import { useEffect, useState } from 'react';
import type { ActivityEvent } from './types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

interface UseActivityResult {
  events: ActivityEvent[];
  isLoading: boolean;
  error: string | null;
}

// GET /api/activity (product-memory 08.5 item A5) — already scoped
// server-side to the projects the calling user can see, so this is a
// single request, not a fan-out like useAggregatedRuns.
export function useActivity(token: string | null | undefined, limit = 10): UseActivityResult {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`${API_URL}/api/activity?limit=${limit}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
        const data: ActivityEvent[] = await res.json();
        if (!cancelled) {
          setEvents(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load activity.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, limit]);

  return { events, isLoading, error };
}

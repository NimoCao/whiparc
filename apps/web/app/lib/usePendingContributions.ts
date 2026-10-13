'use client';

import { useState } from 'react';
import { useAbortableEffect, isAbortError } from './useAbortableEffect';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export interface PendingContribution {
  id: string;
  template_id: string;
  template_title: string;
  contributor_name?: string;
  note: string;
  created_at: string;
}

// Suggested template changes waiting for the signed-in user's review (GET
// /api/contributions/pending): their own templates, plus official ones for a
// curator. This inbox is the only notification a template's author gets.
export function usePendingContributions(token: string | null | undefined): PendingContribution[] {
  const [items, setItems] = useState<PendingContribution[]>([]);
  useAbortableEffect(
    (signal) => {
      if (!token) return;
      (async () => {
        try {
          const res = await fetch(`${API_URL}/api/contributions/pending`, { headers: { Authorization: `Bearer ${token}` }, signal });
          if (!res.ok) return;
          const data: { contributions: PendingContribution[] } = await res.json();
          setItems(data.contributions);
        } catch (err) {
          if (!isAbortError(err)) setItems([]);
        }
      })();
    },
    [token]
  );
  return items;
}

'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '../store/useAuthStore';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

// Whether plan limits are live on this deployment (apps/api/entitlements.go's
// planEnforcementEnabled — true only when billing is configured). A
// self-hosted install has no way to upgrade, so Pro locks and upgrade
// prompts would be noise for rules that aren't applied there. Fetched once
// per page load and shared by every component that asks.
let cached: boolean | null = null;
let inflight: Promise<boolean> | null = null;

function fetchEnforcement(): Promise<boolean> {
  if (cached !== null) return Promise.resolve(cached);
  if (!inflight) {
    inflight = fetch(`${API_URL}/api/config`)
      .then((r) => (r.ok ? r.json() : { plan_enforcement: false }))
      .then((d: { plan_enforcement?: boolean }) => (cached = Boolean(d.plan_enforcement)))
      .catch(() => (cached = false))
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function usePlanEnforcement(): boolean {
  const [enforced, setEnforced] = useState<boolean>(cached ?? false);
  useEffect(() => {
    let live = true;
    void fetchEnforcement().then((v) => live && setEnforced(v));
    return () => {
      live = false;
    };
  }, []);
  return enforced;
}

export function isPaidPlan(plan: string | undefined | null): boolean {
  return plan === 'PRO' || plan === 'ENTERPRISE';
}

// user.plan is the best plan across every team the person belongs to (see
// bestPlanForUser in apps/api/projects.go) — the same rule the server uses to
// decide whether a Pro template can be forked, so the UI lock and the 402
// agree.
export function useProTemplateAccess(): { enforced: boolean; canUsePro: boolean } {
  const enforced = usePlanEnforcement();
  const plan = useAuthStore((s) => s.user?.plan);
  return { enforced, canUsePro: !enforced || isPaidPlan(plan) };
}

interface ProjectEntitlements {
  plan_enforcement: boolean;
  custom_nodes_allowed: boolean;
}

// What the project's *owning team's* plan allows (GET /api/projects/{id}/
// entitlements) — null until loaded. Custom-node gating keys off the
// project's team, not the signed-in user's best plan, so the UI asks the
// server instead of guessing from user.plan.
export function useProjectEntitlements(projectId: string | null | undefined): ProjectEntitlements | null {
  const token = useAuthStore((s) => s.token);
  const [data, setData] = useState<ProjectEntitlements | null>(null);
  useEffect(() => {
    if (!token || !projectId) return;
    let live = true;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/projects/${projectId}/entitlements`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const d: ProjectEntitlements = await res.json();
        if (live) setData(d);
      } catch {
        // leave null — callers fall back; the write endpoints enforce regardless
      }
    })();
    return () => {
      live = false;
    };
  }, [token, projectId]);
  return data;
}

'use client';

import React, { useEffect, useState, type CSSProperties } from 'react';
import { Icon } from '@iconify/react';
import { BlueprintCorners } from './ui/BlueprintCorners';
import type { Project } from '../lib/types';

interface TriggerRunModalProps {
  isOpen: boolean;
  onClose: () => void;
  token: string;
  onTriggered: (runId: string) => void;
}

const fieldLabelStyle: CSSProperties = {
  display: 'block',
  margin: '0 0 6px',
  fontSize: 10,
  letterSpacing: '.1em',
  textTransform: 'uppercase',
  color: 'var(--ink2)',
};

const fieldInputStyle: CSSProperties = {
  width: '100%',
  height: 36,
  padding: '0 10px',
  border: '1px solid var(--line)',
  background: 'var(--elevated)',
  color: 'var(--ink)',
  fontSize: 13,
  fontFamily: 'var(--font-body-marketing, inherit)',
  outline: 'none',
};

const primaryButtonStyle: CSSProperties = {
  position: 'relative',
  height: 36,
  padding: '0 18px',
  background: 'var(--accent)',
  color: 'var(--on-accent)',
  border: 0,
  fontSize: 13,
  fontWeight: 600,
  fontFamily: 'var(--font-display, inherit)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
};

const secondaryButtonStyle: CSSProperties = {
  height: 36,
  padding: '0 16px',
  background: 'transparent',
  color: 'var(--ink)',
  border: '1px solid var(--line)',
  fontSize: 13,
  fontWeight: 600,
  fontFamily: 'var(--font-display, inherit)',
  cursor: 'pointer',
};

// Product-memory 08.5 item C2. Triggers a deploy against a project's
// already-saved canvas (POST /api/projects/{id}/deploy with no canvas/files
// in the body — handleDeploy falls back to the stored canvas_states row and
// compiles it server-side, exactly the same fallback the endpoint already
// had for any other caller that omits them). Deliberately does not offer a
// "compile from the current in-browser canvas" option, since this page has
// no canvas open — that flow is what the workspace's own Deploy button is
// for. Lands the caller on /runs/{id} (C3) so triggering and watching are
// one motion.
export function TriggerRunModal({ isOpen, onClose, token, onTriggered }: TriggerRunModalProps) {
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !token) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoadingProjects(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/projects`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
        const data: Project[] = await res.json();
        if (cancelled) return;
        // A deploy needs EDITOR+ (matches handleDeploy's own
        // RequireProjectRole("EDITOR") gate) — a VIEWER-only project would
        // just fail server-side with a 403, so filter it out up front.
        const deployable = data.filter((p) => p.user_role === 'EDITOR' || p.user_role === 'ADMIN');
        setProjects(deployable);
        setSelectedProjectId((prev) => prev || deployable[0]?.id || '');
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load projects.');
      } finally {
        if (!cancelled) setIsLoadingProjects(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, token, API_URL]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId) {
      setError('Choose a project to deploy.');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/api/projects/${selectedProjectId}/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        // handleDeploy rejects with a plain-text reason (missing SSH
        // credential, unpaired local agent, free-tier gate, ...) — surface
        // it verbatim instead of a bare status code.
        const detail = (await res.text().catch(() => '')).trim();
        throw new Error(detail || `Failed to trigger run. HTTP status: ${res.status}`);
      }
      const data = await res.json();
      onTriggered(data.runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger run.');
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(2px)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div className="wp-blueprint" style={{ position: 'relative', width: 440, maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--panel)' }}>
        <BlueprintCorners />

        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ margin: 0, fontFamily: 'var(--font-display, inherit)', fontWeight: 600, fontSize: 17, color: 'var(--ink)' }}>Trigger run</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--ink2)' }}>Deploys a project&apos;s currently saved canvas.</p>
          </div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 0, color: 'var(--ink2)', cursor: 'pointer', padding: 4, flexShrink: 0 }}>
            <Icon icon="lucide:x" width={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ flexGrow: 1, overflowY: 'auto', padding: 22, display: 'grid', gap: 16 }}>
          <div>
            <label style={fieldLabelStyle}>Project</label>
            {isLoadingProjects ? (
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink3)' }}>Loading projects…</p>
            ) : projects.length === 0 ? (
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink3)' }}>No projects you can deploy to. You need Editor access or higher on at least one project.</p>
            ) : (
              <select value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)} style={{ ...fieldInputStyle, cursor: 'pointer' }}>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {error && (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)', background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid var(--danger)', padding: '8px 10px' }}>{error}</p>
          )}

          <div style={{ paddingTop: 12, borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button type="button" onClick={onClose} style={secondaryButtonStyle}>
              Cancel
            </button>
            <button type="submit" disabled={isSubmitting || projects.length === 0} className="wp-blueprint" style={{ ...primaryButtonStyle, opacity: isSubmitting || projects.length === 0 ? 0.6 : 1 }}>
              <BlueprintCorners />
              {isSubmitting && <Icon icon="lucide:loader-2" className="animate-spin" width={13} />}
              <Icon icon="lucide:play" width={12} />
              Deploy
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

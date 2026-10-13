'use client';

import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import type { Node, Edge } from '@xyflow/react';
import { TemplateCanvasPreview } from './TemplateCanvasPreview';
import { useAuthStore } from '../store/useAuthStore';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

interface Contribution {
  id: string;
  contributor_name?: string;
  note: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  created_at: string;
  nodes_json?: string;
  edges_json?: string;
  viewport_json?: string;
}

function parseCanvas(c: Contribution): { nodes: Node[]; edges: Edge[]; viewport?: { x: number; y: number; zoom: number } } {
  try {
    const nodes = JSON.parse(c.nodes_json || '[]');
    const edges = JSON.parse(c.edges_json || '[]');
    return { nodes: Array.isArray(nodes) ? nodes : [], edges: Array.isArray(edges) ? edges : [], viewport: c.viewport_json ? JSON.parse(c.viewport_json) : undefined };
  } catch {
    return { nodes: [], edges: [] };
  }
}

// Reviewer view of the suggested changes on a template (GET
// /api/templates/{id}/contributions). Rendered only for the template's author
// or a curator; the endpoint answers 403 for anyone else, in which case this
// renders nothing, so callers can mount it speculatively. `onAccepted` lets
// the parent refetch the template, since accepting replaces its canvas.
export function TemplateContributionsPanel({ templateId, onAccepted }: { templateId: string; onAccepted: () => void }) {
  const token = useAuthStore((s) => s.token);
  const [items, setItems] = useState<Contribution[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!token) return;
    let live = true;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/templates/${templateId}/contributions?status=PENDING`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) {
          // 403 for everyone who isn't a reviewer: the panel just stays hidden.
          if (live) setItems(null);
          return;
        }
        const data: { contributions: Contribution[] } = await res.json();
        if (live) setItems(data.contributions);
      } catch {
        if (live) setItems(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [templateId, token, refreshKey]);

  const preview = useMemo(() => {
    const open = items?.find((c) => c.id === openId);
    return open ? parseCanvas(open) : null;
  }, [items, openId]);

  if (!items || items.length === 0) return null;

  const review = async (id: string, action: 'accept' | 'reject') => {
    setError(null);
    setBusyId(id);
    try {
      const res = await fetch(`${API_URL}/api/templates/${templateId}/contributions/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: '{}',
      });
      if (!res.ok) throw new Error((await res.text().catch(() => '')).trim() || `Request failed with status ${res.status}`);
      setOpenId(null);
      setRefreshKey((k) => k + 1);
      if (action === 'accept') onAccepted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not review this contribution.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>
        <Icon icon="lucide:git-pull-request" width={14} style={{ color: 'var(--accent-ink)' }} />
        Suggested changes ({items.length})
      </h2>
      {error && <p role="alert" style={{ margin: 0, fontSize: 11.5, color: 'var(--danger)' }}>{error}</p>}
      {items.map((c) => (
        <div key={c.id} style={{ border: '1px solid var(--line)', background: 'var(--panel)', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>{c.contributor_name || 'A contributor'}</span>
            <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{new Date(c.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          </div>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--ink2)', whiteSpace: 'pre-wrap' }}>{c.note}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => setOpenId(openId === c.id ? null : c.id)} style={{ height: 30, padding: '0 12px', fontSize: 12.5, border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink)', cursor: 'pointer' }}>
              {openId === c.id ? 'Hide preview' : 'Preview canvas'}
            </button>
            <button type="button" disabled={busyId === c.id} onClick={() => review(c.id, 'accept')} style={{ height: 30, padding: '0 12px', fontSize: 12.5, fontWeight: 600, background: 'var(--accent)', color: 'var(--on-accent)', border: 0, cursor: busyId === c.id ? 'not-allowed' : 'pointer', opacity: busyId === c.id ? 0.6 : 1 }}>
              Accept
            </button>
            <button type="button" disabled={busyId === c.id} onClick={() => review(c.id, 'reject')} style={{ height: 30, padding: '0 12px', fontSize: 12.5, border: '1px solid var(--danger)', background: 'transparent', color: 'var(--danger)', cursor: busyId === c.id ? 'not-allowed' : 'pointer', opacity: busyId === c.id ? 0.6 : 1 }}>
              Reject
            </button>
          </div>
          {openId === c.id && preview && (
            <div style={{ height: 260, border: '1px solid var(--line)', background: 'var(--ground)', overflow: 'hidden' }}>
              <TemplateCanvasPreview nodes={preview.nodes} edges={preview.edges} viewport={preview.viewport} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

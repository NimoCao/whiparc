'use client';

import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@iconify/react';
import type { Node, Edge } from '@xyflow/react';
import { TemplateCanvasPreview } from './TemplateCanvasPreview';
import { BlueprintCorners } from './ui/BlueprintCorners';
import { useAuthStore } from '../store/useAuthStore';
import type { Template } from '../lib/types';
import './ui/blueprint.css';
import '../templates/templates.css';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

interface TemplateDetailContentProps {
  id: string;
  // 'page': the standalone /templates/{id} route — full-height hero sizing.
  // 'modal': rendered inside TemplateModal (the intercepting-route popup
  // opened from the /templates grid) — slightly more compact.
  variant: 'page' | 'modal';
}

// Shared by the standalone /templates/[id] page and the intercepting-route
// modal (app/@modal/(.)templates/[id]) so the fetch/fork logic and the
// actual detail markup exist in exactly one place — see product-memory 10.1
// for why both a real page and a popup need to render the same content.
export function TemplateDetailContent({ id, variant }: TemplateDetailContentProps) {
  const { user, hasHydrated } = useAuthStore();

  const [template, setTemplate] = useState<Template | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isForking, setIsForking] = useState(false);
  const [forkError, setForkError] = useState<string | null>(null);
  const [showContributeComingSoon, setShowContributeComingSoon] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/templates/${id}`);
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
        const data: Template = await res.json();
        if (!cancelled) setTemplate(data);
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Failed to load this template.';
          setLoadError(msg.includes('fetch') ? 'Cannot connect to the backend server. Please try again shortly.' : msg);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const parsedCanvas = useMemo(() => {
    if (!template) return { nodes: [] as Node[], edges: [] as Edge[], viewport: undefined };
    try {
      const nodes = JSON.parse(template.nodes_json || '[]');
      const edges = JSON.parse(template.edges_json || '[]');
      const viewport = template.viewport_json ? JSON.parse(template.viewport_json) : undefined;
      return {
        nodes: Array.isArray(nodes) ? (nodes as Node[]) : [],
        edges: Array.isArray(edges) ? (edges as Edge[]) : [],
        viewport,
      };
    } catch {
      return { nodes: [] as Node[], edges: [] as Edge[], viewport: undefined };
    }
  }, [template]);

  const handleGetStarted = async () => {
    if (!hasHydrated || isForking) return;
    if (!user) {
      // A hard navigation, not router.push(): when this component is
      // rendered inside the intercepting-route popup (variant="modal"),
      // Next.js's @modal parallel slot does not reset on a client-side
      // push to a route outside the intercepted /templates/* family — the
      // URL changes and /login renders underneath, but the modal's own
      // fixed-position overlay stays mounted on top of it, hiding it
      // entirely. A full navigation forces both the main and @modal slots
      // to resolve fresh for the new URL, which reliably clears the modal.
      // See product-memory 10.1 / 07.2 for the full writeup.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- intentional hard navigation, see comment above
      window.location.href = `/login?redirect=/templates/${id}`;
      return;
    }
    setForkError(null);
    setIsForking(true);
    try {
      const token = useAuthStore.getState().token;
      const res = await fetch(`${API_URL}/api/templates/${id}/use`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
      const data: { project_id: string } = await res.json();
      // Same reasoning as above — hard navigation so the popup can't get
      // stuck on top of the workspace after a signed-in fork.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- intentional hard navigation, see comment above
      window.location.href = `/workspace?project=${data.project_id}`;
    } catch (err) {
      setIsForking(false);
      const msg = err instanceof Error ? err.message : 'Failed to start a new project from this template.';
      setForkError(msg.includes('fetch') ? 'Cannot connect to the backend server. Please try again shortly.' : msg);
    }
  };

  const previewHeight = variant === 'modal' ? 300 : 400;

  if (isLoading) {
    return (
      <div style={{ padding: '80px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--ink3)' }}>
        <Icon icon="lucide:loader-2" className="animate-spin" width={26} style={{ color: 'var(--accent)' }} />
        <p style={{ margin: 0, fontSize: 12 }}>Loading template...</p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div style={{ padding: '80px 24px', border: '1px dashed var(--line)', background: 'var(--ground)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
        <Icon icon="lucide:file-question" width={30} style={{ color: 'var(--ink3)', marginBottom: 10 }} />
        <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>Template not found</h3>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--ink3)', maxWidth: 280, lineHeight: 1.5 }}>
          This template may have been unpublished or the link is incorrect.
        </p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={{ padding: '80px 24px', border: '1px dashed var(--danger)', background: 'color-mix(in srgb, var(--danger) 6%, transparent)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
        <Icon icon="lucide:alert-circle" width={26} style={{ color: 'var(--danger)', marginBottom: 8 }} />
        <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)' }}>{loadError}</p>
      </div>
    );
  }

  if (!template) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, borderBottom: '1px solid var(--line)', paddingBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontFamily: 'var(--font-mono-marketing)', fontSize: 10, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--accent-ink)', border: '1px solid var(--accent-ink)', padding: '3px 10px' }}>
            {template.category}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink3)' }}>
            <Icon icon="lucide:download" width={12} />
            <span style={{ fontSize: 11.5, fontWeight: 500 }}>{template.install_count} uses</span>
          </div>
        </div>

        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(26px,3vw,34px)', color: 'var(--ink)' }}>{template.title}</h1>

        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--ink2)', maxWidth: '38em' }}>{template.description || 'No description provided.'}</p>

        {template.tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 2 }}>
            {template.tags.map((tag) => (
              <span key={tag} style={{ fontSize: 11, color: 'var(--ink2)', border: '1px solid var(--line)', padding: '4px 10px' }}>
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>
            <Icon icon="lucide:git-branch" width={14} style={{ color: 'var(--accent-ink)' }} />
            Canvas Preview
          </h2>
          <span style={{ fontSize: 10.5, color: 'var(--ink3)' }}>Scroll to zoom · Drag to pan · Read-only</span>
        </div>
        <div style={{ height: previewHeight, width: '100%', border: '1px solid var(--line)', background: 'var(--ground)', overflow: 'hidden' }}>
          <TemplateCanvasPreview nodes={parsedCanvas.nodes} edges={parsedCanvas.edges} viewport={parsedCanvas.viewport} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12 }} className="wp-templates-stat-grid">
        <div style={{ border: '1px solid var(--line)', background: 'var(--panel)', padding: 14 }}>
          <p style={{ margin: 0, fontFamily: 'var(--font-mono-marketing)', fontSize: 9.5, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink3)' }}>Resources</p>
          <p style={{ margin: '5px 0 0', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, color: 'var(--ink)' }}>{parsedCanvas.nodes.length}</p>
        </div>
        <div style={{ border: '1px solid var(--line)', background: 'var(--panel)', padding: 14 }}>
          <p style={{ margin: 0, fontFamily: 'var(--font-mono-marketing)', fontSize: 9.5, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink3)' }}>Connections</p>
          <p style={{ margin: '5px 0 0', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, color: 'var(--ink)' }}>{parsedCanvas.edges.length}</p>
        </div>
        <div style={{ border: '1px solid var(--line)', background: 'var(--panel)', padding: 14 }}>
          <p style={{ margin: 0, fontFamily: 'var(--font-mono-marketing)', fontSize: 9.5, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink3)' }}>Author</p>
          <p style={{ margin: '5px 0 0', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }} className="truncate">
            {template.author_name || 'Whiparc Official'}
          </p>
        </div>
        <div style={{ border: '1px solid var(--line)', background: 'var(--panel)', padding: 14 }}>
          <p style={{ margin: 0, fontFamily: 'var(--font-mono-marketing)', fontSize: 9.5, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink3)' }}>Published</p>
          <p style={{ margin: '5px 0 0', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
            {new Date(template.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
      </div>

      <div className="wp-blueprint" style={{ position: 'relative', border: '1px solid var(--line)', background: 'var(--panel)', padding: 28, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 14 }}>
        <BlueprintCorners />
        <Icon icon="lucide:rocket" width={26} style={{ color: 'var(--accent-ink)' }} />
        <div>
          <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16, color: 'var(--ink)' }}>Ready to build on this template?</h3>
          <p style={{ margin: '5px 0 0', fontSize: 13, color: 'var(--ink2)', maxWidth: 380 }}>
            {hasHydrated && user
              ? 'Fork this canvas into a new project in your own workspace.'
              : 'Sign in to fork this canvas into a new project in your own workspace.'}
          </p>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <button
            type="button"
            onClick={handleGetStarted}
            disabled={isForking}
            className="wp-templates-submit"
            style={{ height: 38, padding: '0 22px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 600, fontFamily: 'var(--font-display)', background: 'var(--accent)', color: 'var(--on-accent)', border: 0, cursor: isForking ? 'not-allowed' : 'pointer', opacity: isForking ? 0.6 : 1 }}
          >
            {isForking ? (
              <>
                <Icon icon="lucide:loader-2" className="animate-spin" width={14} />
                <span>Setting up your project…</span>
              </>
            ) : (
              <>
                <span>Get Started</span>
                <Icon icon="lucide:arrow-right" width={14} />
              </>
            )}
          </button>

          {/* Lets a developer fine-tune this template's nodes/config and
              submit changes back — planned as its own future phase after
              Publish (Phase 5) ships, not built yet. Shown now (matching
              the product wireframe) as an honest "coming soon" rather than
              hidden, same treatment "Get Started" got before Phase 3
              existed. See product-memory 10.1's roadmap for the plan. */}
          <button
            type="button"
            onClick={() => setShowContributeComingSoon(true)}
            className="wp-templates-navlink"
            style={{ height: 38, padding: '0 22px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 600, fontFamily: 'var(--font-display)', border: '1px solid var(--line)', color: 'var(--ink)', background: 'transparent', cursor: 'pointer' }}
          >
            <Icon icon="lucide:git-pull-request" width={14} />
            <span>Contribute</span>
          </button>
        </div>

        {forkError && (
          <p style={{ margin: 0, fontSize: 11.5, color: 'var(--danger)', background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid var(--danger)', padding: '6px 10px' }}>{forkError}</p>
        )}
        {showContributeComingSoon && (
          <p style={{ margin: 0, fontSize: 11.5, color: 'var(--amber)', background: 'color-mix(in srgb, var(--amber) 10%, transparent)', border: '1px solid var(--amber)', padding: '6px 10px' }}>
            Contributing changes back to a template is launching in a future phase — this template will be open for
            community fine-tuning soon.
          </p>
        )}
      </div>
    </div>
  );
}

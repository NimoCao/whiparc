'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { Icon } from '@iconify/react';
import { BlueprintCorners } from './ui/BlueprintCorners';
import { useAuthStore } from '../store/useAuthStore';
import type { Project } from '../lib/types';
import './ui/blueprint.css';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
const MAX_NOTE = 1000;

interface ContributeTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  templateId: string;
  templateTitle: string;
}

const labelStyle: CSSProperties = { display: 'block', margin: '0 0 6px', fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink2)' };
const fieldStyle: CSSProperties = { width: '100%', padding: '8px 10px', fontSize: 13, background: 'var(--ground)', color: 'var(--ink)', border: '1px solid var(--line)', outline: 'none', fontFamily: 'inherit' };

// "Contribute" on a template: submit a snapshot of one of your own projects as
// a suggested change, which the template's author then accepts or rejects (POST
// /api/templates/{id}/contributions). The expected path is: make an editable
// copy of the template, change it on the canvas, come back here and submit.
export function ContributeTemplateModal({ isOpen, onClose, templateId, templateTitle }: ContributeTemplateModalProps) {
  const token = useAuthStore((s) => s.token);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [projectId, setProjectId] = useState('');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!isOpen || !token) return;
    let live = true;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/projects`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
        const all: Project[] = await res.json();
        // Snapshotting a project's canvas needs ADMIN on it, same bar as publishing.
        const mine = all.filter((p) => p.user_role === 'ADMIN' && !p.archived_at);
        if (!live) return;
        setProjects(mine);
        setProjectId((cur) => cur || mine[0]?.id || '');
      } catch {
        if (live) setError('Could not load your projects. Please try again.');
      } finally {
        if (live) setIsLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [isOpen, token]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleCopy = async () => {
    setError(null);
    setIsCopying(true);
    try {
      const res = await fetch(`${API_URL}/api/templates/${templateId}/use`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error((await res.text().catch(() => '')).trim() || `Request failed with status ${res.status}`);
      const data: { project_id: string } = await res.json();
      // Hard navigation, same reason as TemplateDetailContent's fork: the
      // @modal slot would otherwise stay mounted over the workspace.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- intentional hard navigation
      window.location.href = `/workspace?project=${data.project_id}`;
    } catch (err) {
      setIsCopying(false);
      setError(err instanceof Error ? err.message : 'Could not create a copy of this template.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId) {
      setError('Pick the project that holds your changes.');
      return;
    }
    if (!note.trim()) {
      setError('Describe what you changed so the author can review it.');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/api/templates/${templateId}/contributions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ project_id: projectId, note: note.trim() }),
      });
      if (!res.ok) throw new Error((await res.text().catch(() => '')).trim() || `Request failed with status ${res.status}`);
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit your contribution.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(2px)', zIndex: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="contribute-title"
        onClick={(e) => e.stopPropagation()}
        className="wp-blueprint"
        style={{ position: 'relative', width: 460, maxWidth: '100%', maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--panel)', textAlign: 'left' }}
      >
        <BlueprintCorners />
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h3 id="contribute-title" style={{ margin: 0, fontFamily: 'var(--font-display, inherit)', fontWeight: 600, fontSize: 17, color: 'var(--ink)' }}>Contribute to this template</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--ink2)' }}>Suggest changes to &ldquo;{templateTitle}&rdquo;. The author reviews them before anything changes.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 0, color: 'var(--ink2)', cursor: 'pointer', padding: 4, flexShrink: 0 }}>
            <Icon icon="lucide:x" width={16} />
          </button>
        </div>

        {submitted ? (
          <div style={{ padding: 28, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
            <Icon icon="lucide:check-circle-2" width={28} style={{ color: 'var(--accent-ink)' }} />
            <p style={{ margin: 0, fontFamily: 'var(--font-display, inherit)', fontWeight: 600, fontSize: 15, color: 'var(--ink)' }}>Contribution submitted</p>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink2)', maxWidth: 320, lineHeight: 1.5 }}>Your submission is saved and waiting for the template&apos;s author. They see it in a review list on the template page and on their dashboard; they are not emailed. If they accept it, the template&apos;s canvas is updated with your changes.</p>
            <button type="button" onClick={onClose} style={{ marginTop: 6, height: 34, padding: '0 20px', fontSize: 13.5, fontWeight: 600, background: 'var(--accent)', color: 'var(--on-accent)', border: 0, cursor: 'pointer' }}>Done</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ overflowY: 'auto', padding: 22, display: 'grid', gap: 16 }}>
            <div style={{ border: '1px solid var(--line)', padding: '10px 12px', fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.5 }}>
              <strong style={{ color: 'var(--ink)' }}>How it works.</strong> Make an editable copy, change nodes or settings on the canvas, then come back and submit that project here.
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  onClick={handleCopy}
                  disabled={isCopying}
                  style={{ height: 30, padding: '0 12px', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink)', cursor: isCopying ? 'not-allowed' : 'pointer', opacity: isCopying ? 0.6 : 1 }}
                >
                  <Icon icon={isCopying ? 'lucide:loader-2' : 'lucide:copy'} className={isCopying ? 'animate-spin' : undefined} width={13} />
                  Make an editable copy
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="contribute-project" style={labelStyle}>Project with your changes</label>
              {isLoading ? (
                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink3)' }}>Loading projects…</p>
              ) : projects.length === 0 ? (
                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink3)' }}>You have no projects you administer yet. Make an editable copy first.</p>
              ) : (
                <select id="contribute-project" value={projectId} onChange={(e) => setProjectId(e.target.value)} style={{ ...fieldStyle, cursor: 'pointer' }}>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label htmlFor="contribute-note" style={labelStyle}>What did you change, and why?</label>
              <textarea
                id="contribute-note"
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE))}
                rows={4}
                placeholder="e.g. Added a security group and restricted SSH to port 22."
                style={{ ...fieldStyle, resize: 'vertical' }}
              />
              <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--ink3)', textAlign: 'right' }}>{note.length}/{MAX_NOTE}</p>
            </div>

            {error && (
              <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--danger)', background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid var(--danger)', padding: '6px 10px' }}>{error}</p>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" onClick={onClose} style={{ height: 34, padding: '0 16px', fontSize: 13, border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink)', cursor: 'pointer' }}>Cancel</button>
              <button
                type="submit"
                disabled={isSubmitting || projects.length === 0}
                style={{ height: 34, padding: '0 18px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 600, background: 'var(--accent)', color: 'var(--on-accent)', border: 0, cursor: isSubmitting || projects.length === 0 ? 'not-allowed' : 'pointer', opacity: isSubmitting || projects.length === 0 ? 0.6 : 1 }}
              >
                {isSubmitting && <Icon icon="lucide:loader-2" className="animate-spin" width={14} />}
                Submit contribution
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

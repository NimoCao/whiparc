'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { Icon } from '@iconify/react';
import { BlueprintCorners } from './ui/BlueprintCorners';
import { useAuthStore } from '../store/useAuthStore';
import type { Project } from '../lib/types';
import './ui/blueprint.css';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

const labelStyle: CSSProperties = { display: 'block', margin: '0 0 6px', fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink2)' };
const fieldStyle: CSSProperties = { width: '100%', padding: '8px 10px', fontSize: 13, background: 'var(--ground)', color: 'var(--ink)', border: '1px solid var(--line)', outline: 'none', fontFamily: 'inherit' };

const CATEGORIES = ['AWS', 'Kubernetes', 'Ansible', 'Networking', 'CI/CD', 'General'];

interface PublishTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project;
}

// "Publish as Template" — Phase 5's entry point from the dashboard. Snapshots
// the project's current canvas into a new public /templates listing (POST
// /api/projects/{id}/templates). Uses the blueprint design-system chrome (same
// as ContributeTemplateModal), not the legacy Tailwind modal style.
//
// UX choices deliberately follow the ui-ux-pro-max skill's guidance for this
// kind of publish flow (see product-memory 10.1 "Phase 5"): the consequence
// is stated in plain text before the form rather than a second "are you
// sure" dialog stacked on top of this one; every field has a real <label>
// (not a placeholder standing in for one); the title field validates inline
// on submit with an error tied to the field, not just a toast; and success
// gets its own visible confirmation state with a link to the live template,
// rather than the modal just quietly closing.
export function PublishTemplateModal({ isOpen, onClose, project }: PublishTemplateModalProps) {
  const { token } = useAuthStore();

  const [title, setTitle] = useState(project.name || '');
  const [description, setDescription] = useState(project.description || '');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [publishedId, setPublishedId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const addTag = () => {
    const t = tagDraft.trim().toLowerCase();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagDraft('');
  };

  const removeTag = (tag: string) => setTags(tags.filter((t) => t !== tag));

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag();
    } else if (e.key === 'Backspace' && tagDraft === '' && tags.length > 0) {
      setTags(tags.slice(0, -1));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setTitleError('Give your template a title before publishing.');
      return;
    }
    setTitleError(null);
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/api/projects/${project.id}/templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: trimmedTitle, description: description.trim(), category, tags }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `Request failed with status ${res.status}`);
      }
      const data: { id: string } = await res.json();
      setPublishedId(data.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to publish this template.';
      setSubmitError(msg.includes('fetch') ? 'Cannot connect to the backend server. Please try again shortly.' : msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(2px)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-template-title"
        onClick={(e) => e.stopPropagation()}
        className="wp-blueprint"
        style={{ position: 'relative', width: 520, maxWidth: '100%', maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--panel)', textAlign: 'left' }}
      >
        <BlueprintCorners />
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h3 id="publish-template-title" style={{ margin: 0, fontFamily: 'var(--font-display, inherit)', fontWeight: 600, fontSize: 17, color: 'var(--ink)' }}>Publish as Template</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--ink2)' }}>Share a snapshot of this project&apos;s canvas with the community.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 0, color: 'var(--ink2)', cursor: 'pointer', padding: 4, flexShrink: 0 }}>
            <Icon icon="lucide:x" width={16} />
          </button>
        </div>

        {publishedId ? (
          <div style={{ padding: 28, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
            <Icon icon="lucide:check-circle-2" width={28} style={{ color: 'var(--accent-ink)' }} />
            <p style={{ margin: 0, fontFamily: 'var(--font-display, inherit)', fontWeight: 600, fontSize: 15, color: 'var(--ink)' }}>Your template is live</p>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink2)', maxWidth: 340, lineHeight: 1.5 }}>
              &quot;{title.trim()}&quot; is now visible to everyone in the public Template Catalog.
            </p>
            <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
              <button type="button" onClick={onClose} style={{ height: 34, padding: '0 18px', fontSize: 13, border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink)', cursor: 'pointer' }}>Done</button>
              <Link href={`/templates/${publishedId}`} style={{ height: 34, padding: '0 18px', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 600, background: 'var(--accent)', color: 'var(--on-accent)', textDecoration: 'none' }}>
                View Template
                <Icon icon="lucide:arrow-right" width={14} />
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ overflowY: 'auto', padding: 22, display: 'grid', gap: 16 }}>
            <div style={{ border: '1px solid var(--line)', padding: '10px 12px', fontSize: 12.5, color: 'var(--ink2)', lineHeight: 1.5, display: 'flex', gap: 8 }}>
              <Icon icon="lucide:info" width={14} style={{ flexShrink: 0, marginTop: 2, color: 'var(--accent-ink)' }} />
              <span>
                This publishes a snapshot of this project&apos;s current canvas to the public Template Catalog. Editing the project afterward won&apos;t change the published template.
              </span>
            </div>

            <div>
              <label htmlFor="template-title" style={labelStyle}>Title</label>
              <input
                id="template-title"
                type="text"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (titleError) setTitleError(null);
                }}
                aria-invalid={!!titleError}
                aria-describedby={titleError ? 'template-title-error' : undefined}
                style={{ ...fieldStyle, borderColor: titleError ? 'var(--danger)' : 'var(--line)' }}
                placeholder="e.g. Three-Tier Web App (EC2 + RDS)"
              />
              {titleError && (
                <p id="template-title-error" style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--danger)' }}>{titleError}</p>
              )}
            </div>

            <div>
              <label htmlFor="template-description" style={labelStyle}>Description</label>
              <textarea
                id="template-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                style={{ ...fieldStyle, resize: 'vertical' }}
                placeholder="What does this template set up, and who is it for?"
              />
            </div>

            <div>
              <label htmlFor="template-category" style={labelStyle}>Category</label>
              <select id="template-category" value={category} onChange={(e) => setCategory(e.target.value)} style={{ ...fieldStyle, cursor: 'pointer' }}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="template-tags" style={labelStyle}>Tags</label>
              <div style={{ ...fieldStyle, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: '6px 8px' }}>
                {tags.map((tag) => (
                  <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--ink2)', border: '1px solid var(--line)', padding: '2px 8px' }}>
                    {tag}
                    <button type="button" onClick={() => removeTag(tag)} aria-label={`Remove tag ${tag}`} style={{ background: 'none', border: 0, padding: 0, color: 'var(--ink3)', cursor: 'pointer', display: 'flex' }}>
                      <Icon icon="lucide:x" width={10} />
                    </button>
                  </span>
                ))}
                <input
                  id="template-tags"
                  type="text"
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={handleTagKeyDown}
                  onBlur={addTag}
                  style={{ flex: 1, minWidth: 100, background: 'transparent', border: 0, outline: 'none', color: 'var(--ink)', fontSize: 13, fontFamily: 'inherit', padding: '2px 2px' }}
                  placeholder={tags.length === 0 ? 'aws, ec2, beginner...' : 'Add another...'}
                />
              </div>
              <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--ink3)' }}>Press Enter or comma to add a tag.</p>
            </div>

            {submitError && (
              <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--danger)', background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid var(--danger)', padding: '6px 10px' }}>{submitError}</p>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
              <button type="button" onClick={onClose} style={{ height: 34, padding: '0 16px', fontSize: 13, border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink)', cursor: 'pointer' }}>Cancel</button>
              <button
                type="submit"
                disabled={isSubmitting}
                style={{ height: 34, padding: '0 18px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 600, background: 'var(--accent)', color: 'var(--on-accent)', border: 0, cursor: isSubmitting ? 'not-allowed' : 'pointer', opacity: isSubmitting ? 0.6 : 1 }}
              >
                {isSubmitting && <Icon icon="lucide:loader-2" className="animate-spin" width={14} />}
                Publish Template
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

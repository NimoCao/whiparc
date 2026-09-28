'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Icon } from '@iconify/react';
import { useAuthStore } from '../store/useAuthStore';
import type { Project } from '../lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

const CATEGORIES = ['AWS', 'Kubernetes', 'Ansible', 'Networking', 'CI/CD', 'General'];

interface PublishTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project;
}

// "Publish as Template" — Phase 5's entry point from the dashboard. Snapshots
// the project's current canvas into a new public /templates listing (POST
// /api/projects/{id}/templates). Follows ProjectSettingsModal's exact modal
// chrome/form-field styling for visual consistency within the dashboard.
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-secondary border border-border rounded-2xl shadow-2xl w-[560px] max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-card/30">
          <div>
            <h3 className="text-lg font-heading font-bold text-white">Publish as Template</h3>
            <p className="text-xs text-slate-400">Share a snapshot of this project&apos;s canvas with the community.</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-secondary transition-all cursor-pointer"
          >
            <Icon icon="lucide:x" className="text-lg" />
          </button>
        </div>

        <div className="flex-grow overflow-y-auto p-6 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-800">
          {publishedId ? (
            <div className="flex flex-col items-center text-center gap-4 py-6">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
                <Icon icon="lucide:check" className="text-2xl text-emerald-400" />
              </div>
              <div>
                <h4 className="text-base font-bold text-white">Your template is live</h4>
                <p className="text-sm text-slate-400 mt-1 max-w-sm">
                  &quot;{title.trim()}&quot; is now visible to everyone in the public Template Catalog.
                </p>
              </div>
              <div className="flex items-center gap-3 mt-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm bg-secondary text-slate-200 hover:bg-input rounded-lg transition-all cursor-pointer font-semibold border border-border"
                >
                  Done
                </button>
                <Link
                  href={`/templates/${publishedId}`}
                  className="px-4 py-2 text-sm bg-primary text-primary-foreground hover:opacity-95 rounded-lg transition-all cursor-pointer font-semibold flex items-center gap-1.5"
                >
                  View Template
                  <Icon icon="lucide:arrow-right" className="text-sm" />
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="p-3 bg-primary/10 border border-primary/20 text-primary rounded-lg text-xs leading-relaxed flex items-start gap-2">
                <Icon icon="lucide:info" className="text-base shrink-0 mt-0.5" />
                <span>
                  This publishes a snapshot of this project&apos;s current canvas to the public Template Catalog. Editing
                  the project afterward won&apos;t change the published template — you can unpublish it anytime from your
                  templates.
                </span>
              </div>

              <div>
                <label htmlFor="template-title" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                  Title
                </label>
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
                  className={`w-full px-3 py-2 bg-background/40 border rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all ${
                    titleError ? 'border-red-500/60' : 'border-border focus:border-primary'
                  }`}
                  placeholder="e.g. Three-Tier Web App (EC2 + RDS)"
                />
                {titleError && (
                  <p id="template-title-error" className="mt-1.5 text-xs text-red-400">
                    {titleError}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="template-description" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                  Description
                </label>
                <textarea
                  id="template-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 bg-background/40 border border-border rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/40 transition-all resize-none"
                  placeholder="What does this template set up, and who is it for?"
                />
              </div>

              <div>
                <label htmlFor="template-category" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                  Category
                </label>
                <select
                  id="template-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3 py-2 bg-background/40 border border-border rounded-lg text-white focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/40 transition-all cursor-pointer"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="template-tags" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                  Tags
                </label>
                <div className="w-full px-2 py-2 bg-background/40 border border-border rounded-lg focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/40 transition-all flex flex-wrap items-center gap-1.5">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-300 bg-card border border-border/80 rounded-md px-2 py-1"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        aria-label={`Remove tag ${tag}`}
                        className="text-slate-500 hover:text-white cursor-pointer"
                      >
                        <Icon icon="lucide:x" className="text-[10px]" />
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
                    className="flex-1 min-w-[100px] bg-transparent text-sm text-white placeholder:text-slate-500 outline-none px-1 py-0.5"
                    placeholder={tags.length === 0 ? 'aws, ec2, beginner...' : 'Add another...'}
                  />
                </div>
                <p className="mt-1.5 text-[11px] text-slate-500">Press Enter or comma to add a tag.</p>
              </div>

              {submitError && (
                <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{submitError}</p>
              )}

              <div className="pt-4 flex justify-end gap-3 border-t border-border">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm bg-secondary text-slate-200 hover:bg-input rounded-lg transition-all cursor-pointer font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-sm bg-primary text-primary-foreground hover:opacity-95 rounded-lg transition-all cursor-pointer font-semibold flex items-center gap-1.5 disabled:opacity-55"
                >
                  {isSubmitting && <Icon icon="lucide:loader-2" className="animate-spin text-sm" />}
                  Publish Template
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

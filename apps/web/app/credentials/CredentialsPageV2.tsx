'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { Icon } from '@iconify/react';
import { useAuthStore } from '../store/useAuthStore';
import ProfileMenu from '../components/ProfileMenu';
import { BlueprintCorners } from '../components/ui/BlueprintCorners';
import { THEME_PALETTES, type Theme } from '../components/ui/theme-palette';
import { spaceGroteskFont, barlowFont, jetBrainsMonoFont } from '../fonts';
import { GridIcon, FolderIcon, LayoutIcon, ActivityIcon, LockIcon, UsersIcon, BookIcon } from '../dashboard/NavIcons';
import { BrandLogo } from '../components/brand/BrandLogo';
import type { Project } from '../lib/types';
import '../components/ui/blueprint.css';
import './credentials.css';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

const NAV_ITEMS: { key: string; label: string; href: string; icon: React.ReactNode }[] = [
  { key: 'overview', label: 'Overview', href: '/dashboard', icon: <GridIcon /> },
  { key: 'projects', label: 'Projects', href: '/projects', icon: <FolderIcon /> },
  { key: 'templates', label: 'Templates', href: '/templates', icon: <LayoutIcon /> },
  { key: 'runs', label: 'Runs', href: '/runs', icon: <ActivityIcon /> },
  { key: 'credentials', label: 'Credentials', href: '/credentials', icon: <LockIcon /> },
  { key: 'team', label: 'Team', href: '/team', icon: <UsersIcon /> },
  { key: 'docs', label: 'Docs', href: '/docs', icon: <BookIcon /> },
];

// Mirrors apps/api/projects.go's CredentialItem exactly. Real, project-
// scoped rows — a credential is not a shared object across projects by
// schema, unlike the mockup's "used by N projects" framing.
interface CredentialItem {
  id: string;
  project_id: string;
  provider: 'AWS' | 'GCP' | 'SSH' | 'GITHUB';
  name: string;
  key_fingerprint: string;
  created_at: string;
}
interface CredRow extends CredentialItem {
  projectName: string;
}

type CategoryFilter = 'all' | 'cloud' | 'ssh' | 'token';
const CATEGORY_OF: Record<CredentialItem['provider'], CategoryFilter> = { AWS: 'cloud', GCP: 'cloud', SSH: 'ssh', GITHUB: 'token' };
const ICON_OF: Record<CredentialItem['provider'], string> = { AWS: 'lucide:cloud', GCP: 'lucide:cloud', SSH: 'lucide:terminal', GITHUB: 'lucide:key' };
const FILTER_LABELS: { id: CategoryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'cloud', label: 'Cloud keys' },
  { id: 'ssh', label: 'SSH targets' },
  { id: 'token', label: 'API tokens' },
];

function timeAgo(iso: string): string {
  const then = new Date(iso.replace(' ', 'T')).getTime();
  if (Number.isNaN(then)) return '';
  const days = Math.floor((Date.now() - then) / (24 * 60 * 60 * 1000));
  if (days < 1) return 'today';
  return days === 1 ? '1d ago' : `${days}d ago`;
}

export default function CredentialsPageV2() {
  const { user, token, hasHydrated } = useAuthStore();
  const isLoggedIn = hasHydrated && !!user;

  const [theme, setTheme] = useState<Theme>('dark');
  const [projects, setProjects] = useState<Project[]>([]);
  const [creds, setCreds] = useState<CredRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [showRotateNote, setShowRotateNote] = useState(false);

  const loadAll = async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const projRes = await fetch(`${API_URL}/api/projects`, { headers: { Authorization: `Bearer ${token}` } });
      if (!projRes.ok) throw new Error(`Request failed with status ${projRes.status}`);
      const projs: Project[] = await projRes.json();
      setProjects(projs);

      const perProject = await Promise.all(
        projs.map(async (p) => {
          try {
            const res = await fetch(`${API_URL}/api/projects/${p.id}/credentials`, { headers: { Authorization: `Bearer ${token}` } });
            if (!res.ok) return [] as CredRow[];
            const items: CredentialItem[] = await res.json();
            return items.map((c) => ({ ...c, projectName: p.name }));
          } catch {
            return [] as CredRow[];
          }
        })
      );
      setCreds(perProject.flat().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
      setLoadError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load credentials.';
      setLoadError(msg.includes('fetch') ? 'Cannot connect to the backend server. Please try again shortly.' : msg);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      await loadAll();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleRevoke = async (cred: CredRow) => {
    if (!token) return;
    if (!window.confirm(`Revoke "${cred.name}"? Anything using it will stop working immediately.`)) return;
    try {
      const res = await fetch(`${API_URL}/api/projects/${cred.project_id}/credentials/${cred.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
      setCreds((prev) => prev.filter((c) => c.id !== cred.id));
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed to revoke credential.');
    }
  };

  const visibleCreds = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return creds.filter((c) => {
      const matchesCategory = categoryFilter === 'all' || CATEGORY_OF[c.provider] === categoryFilter;
      const matchesQuery = !q || c.name.toLowerCase().includes(q) || c.projectName.toLowerCase().includes(q);
      return matchesCategory && matchesQuery;
    });
  }, [creds, searchQuery, categoryFilter]);

  const palette = THEME_PALETTES[theme];
  const rootVars = useMemo(
    () =>
      ({
        ...palette,
        background: palette['--ground'],
        color: palette['--ink'],
      }) as CSSProperties,
    [palette]
  );

  return (
    <div
      className={`${spaceGroteskFont.variable} ${barlowFont.variable} ${jetBrainsMonoFont.variable}`}
      style={{ ...rootVars, display: 'flex', alignItems: 'stretch', minHeight: '100vh', fontSize: 15, lineHeight: 1.55, transition: 'background .3s ease, color .3s ease', fontFamily: 'var(--font-body-marketing), system-ui, sans-serif' }}
    >
      <aside style={{ width: 216, flex: 'none', borderRight: '1px solid var(--line)', background: 'var(--panel)', display: 'flex', flexDirection: 'column', position: 'sticky', top: 0, alignSelf: 'flex-start', height: '100vh' }}>
        <div style={{ height: 56, flex: 'none', display: 'flex', alignItems: 'center', gap: 9, padding: '0 16px', borderBottom: '1px solid var(--line)' }}>
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <BrandLogo size={24} />
          </Link>
        </div>
        <nav style={{ padding: '14px 10px', display: 'grid', gap: 2 }}>
          {NAV_ITEMS.map((item) => {
            const active = item.key === 'credentials';
            const style: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', fontSize: 14.5, color: active ? 'var(--on-accent)' : 'var(--ink2)', background: active ? 'var(--accent)' : 'transparent' };
            return (
              <Link key={item.key} href={item.href} className={active ? undefined : 'wp-credentials-navlink'} style={style}>
                {item.icon}
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div style={{ marginTop: 'auto', padding: 12, borderTop: '1px solid var(--line)' }}>
          {isLoggedIn ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span style={{ width: 26, height: 26, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--accent-hover)', color: 'var(--on-accent)', fontFamily: 'var(--font-display)', fontSize: 12 }}>
                {user.name.slice(0, 2).toUpperCase()}
              </span>
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--ink)' }}>{user.name}</p>
                <p style={{ margin: 0, fontSize: 11, color: 'var(--ink2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.plan || 'Member'}</p>
              </div>
            </div>
          ) : (
            <Link href="/login" className="wp-credentials-navlink" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 34, fontSize: 13, fontWeight: 600, border: '1px solid var(--line)', color: 'var(--ink)' }}>
              Sign In
            </Link>
          )}
        </div>
      </aside>

      <main style={{ flex: 1, minWidth: 0 }}>
        <header style={{ height: 56, display: 'flex', alignItems: 'center', gap: 14, padding: '0 clamp(16px,2.5vw,28px)', borderBottom: '1px solid var(--line)', background: 'var(--ground)', position: 'sticky', top: 0, zIndex: 20 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>Credentials</span>
          <div style={{ flex: 1, maxWidth: 340, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', height: 32, border: '1px solid var(--line)' }}>
            <Icon icon="lucide:search" width={14} style={{ color: 'var(--ink3)', flexShrink: 0 }} />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search credentials"
              className="wp-credentials-input"
              style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent', fontSize: 13.5, color: 'var(--ink)', fontFamily: 'var(--font-body-marketing), sans-serif' }}
            />
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
              title="Toggle theme"
              className="wp-credentials-iconbtn"
              style={{ width: 32, height: 32, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink2)', cursor: 'pointer' }}
            >
              <Icon icon={theme === 'light' ? 'lucide:moon' : 'lucide:sun'} width={15} />
            </button>
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              disabled={projects.length === 0}
              className="wp-blueprint wp-credentials-submit"
              style={{ position: 'relative', height: 32, padding: '0 14px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, background: 'var(--accent)', color: 'var(--on-accent)', border: 0, cursor: projects.length === 0 ? 'not-allowed' : 'pointer', opacity: projects.length === 0 ? 0.5 : 1 }}
            >
              <Icon icon="lucide:plus" width={13} />
              New credential
            </button>
            {isLoggedIn && <ProfileMenu blueprint />}
          </div>
        </header>

        <div style={{ padding: 'clamp(20px,3vw,32px) clamp(16px,2.5vw,28px) 48px', display: 'grid', gap: 'clamp(20px,2.5vw,28px)' }}>
          <div>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(26px,3vw,34px)', lineHeight: 1.1, color: 'var(--ink)' }}>Credentials</h1>
            <p style={{ margin: '5px 0 0', fontSize: 14.5, color: 'var(--ink2)' }}>Cloud keys, SSH targets, and API tokens — encrypted at rest, scoped to the project that uses them.</p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {FILTER_LABELS.map((f) => {
              const active = categoryFilter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setCategoryFilter(f.id)}
                  style={{ height: 30, padding: '0 13px', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13, cursor: 'pointer', border: `1px solid ${active ? 'var(--accent)' : 'var(--line)'}`, background: active ? 'var(--accent)' : 'transparent', color: active ? 'var(--on-accent)' : 'var(--ink2)' }}
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          {isLoading ? (
            <div style={{ padding: '60px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: 'var(--ink3)' }}>
              <Icon icon="lucide:loader-2" className="animate-spin" width={24} style={{ color: 'var(--accent)' }} />
              <p style={{ margin: 0, fontSize: 12 }}>Loading credentials...</p>
            </div>
          ) : loadError ? (
            <div style={{ padding: '60px 24px', border: '1px dashed var(--danger)', background: 'color-mix(in srgb, var(--danger) 6%, transparent)', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
              <Icon icon="lucide:alert-circle" width={24} style={{ color: 'var(--danger)', marginBottom: 8 }} />
              <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)' }}>{loadError}</p>
            </div>
          ) : visibleCreds.length === 0 ? (
            <div style={{ padding: '40px 24px', border: '1px dashed var(--line)', textAlign: 'center', color: 'var(--ink3)' }}>
              <p style={{ margin: 0, fontSize: 13 }}>No credentials yet.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 14 }}>
              {visibleCreds.map((c) => (
                <div key={c.id} className="wp-blueprint" style={{ position: 'relative', background: 'var(--panel)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <BlueprintCorners />
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                      <span style={{ width: 28, height: 28, flexShrink: 0, border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-ink)' }}>
                        <Icon icon={ICON_OF[c.provider]} width={15} />
                      </span>
                      <div>
                        <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16, color: 'var(--ink)' }}>{c.name}</p>
                        <p style={{ margin: '2px 0 0', fontFamily: 'var(--font-mono-marketing)', fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink3)' }}>{c.provider}</p>
                      </div>
                    </div>
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--ink2)' }}>
                    Used by <Link href={`/workspace?project=${c.project_id}`} className="wp-credentials-navlink" style={{ color: 'var(--accent-ink)' }}>{c.projectName}</Link>
                  </p>
                  <div style={{ marginTop: 'auto', paddingTop: 10, borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontFamily: 'var(--font-mono-marketing)', fontSize: 11, color: 'var(--ink3)' }}>created {timeAgo(c.created_at)}</span>
                    <div style={{ display: 'flex', gap: 12 }}>
                      <button type="button" onClick={() => setShowRotateNote(true)} className="wp-credentials-navlink" style={{ fontSize: 12.5, color: 'var(--accent-ink)', background: 'none', border: 0, cursor: 'pointer' }}>
                        Rotate
                      </button>
                      <button type="button" onClick={() => handleRevoke(c)} style={{ fontSize: 12.5, color: 'var(--danger)', background: 'none', border: 0, cursor: 'pointer' }}>
                        Revoke
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {showRotateNote && (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--amber)', background: 'color-mix(in srgb, var(--amber) 10%, transparent)', border: '1px solid var(--amber)', padding: '6px 10px', width: 'fit-content' }}>
              Rotating a credential in place is launching in a future phase — revoke and create a new one for now.
            </p>
          )}
        </div>
      </main>

      {isCreateOpen && (
        <NewCredentialModal
          token={token}
          projects={projects}
          onClose={() => setIsCreateOpen(false)}
          onCreated={() => {
            setIsCreateOpen(false);
            loadAll();
          }}
        />
      )}
    </div>
  );
}

function NewCredentialModal({
  token,
  projects,
  onClose,
  onCreated,
}: {
  token: string | null;
  projects: Project[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [provider, setProvider] = useState<'AWS' | 'GCP' | 'SSH' | 'GITHUB'>('AWS');
  const [name, setName] = useState('');
  const [rawData, setRawData] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!token || !projectId || !name || !rawData) {
      setError('Fill in every field.');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/projects/${projectId}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, provider, raw_data: rawData }),
      });
      if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create credential.');
    } finally {
      setIsSaving(false);
    }
  };

  const fieldLabelStyle: CSSProperties = { display: 'block', margin: '0 0 6px', fontSize: 11, color: 'var(--ink3)' };
  const fieldStyle: CSSProperties = { width: '100%', height: 36, padding: '0 10px', border: '1px solid var(--line)', background: 'var(--elevated)', color: 'var(--ink)', fontSize: 13 };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.7)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div className="wp-blueprint" style={{ position: 'relative', width: 'min(420px, 92vw)', background: 'var(--panel)', padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }} onClick={(e) => e.stopPropagation()}>
        <BlueprintCorners />
        <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, color: 'var(--ink)' }}>New credential</p>

        <div>
          <label style={fieldLabelStyle}>Project</label>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={{ ...fieldStyle, cursor: 'pointer' }}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={fieldLabelStyle}>Type</label>
          <select value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)} style={{ ...fieldStyle, cursor: 'pointer' }}>
            <option value="AWS">AWS access key</option>
            <option value="GCP">GCP service account</option>
            <option value="SSH">SSH key</option>
            <option value="GITHUB">GitHub token</option>
          </select>
        </div>
        <div>
          <label style={fieldLabelStyle}>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. aws-prod" style={fieldStyle} />
        </div>
        <div>
          <label style={fieldLabelStyle}>Secret value</label>
          <textarea value={rawData} onChange={(e) => setRawData(e.target.value)} rows={3} placeholder="Pasted secret is encrypted at rest before storage" style={{ ...fieldStyle, height: 'auto', padding: 10, fontFamily: 'var(--font-mono-marketing), monospace', fontSize: 12, resize: 'vertical' }} />
        </div>

        {error && <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)' }}>{error}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
          <button type="button" onClick={onClose} style={{ height: 34, padding: '0 14px', fontSize: 13, border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink)', cursor: 'pointer' }}>
            Cancel
          </button>
          <button type="button" onClick={handleSubmit} disabled={isSaving} style={{ height: 34, padding: '0 16px', fontSize: 13, fontWeight: 600, background: 'var(--accent)', color: 'var(--on-accent)', border: 0, cursor: isSaving ? 'not-allowed' : 'pointer', opacity: isSaving ? 0.6 : 1 }}>
            {isSaving ? 'Saving…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

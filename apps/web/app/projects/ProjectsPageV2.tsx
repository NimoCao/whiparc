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
import './projects.css';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

type RunStatusFilter = 'all' | 'ok' | 'failed' | 'none';

const NAV_ITEMS: { key: string; label: string; href: string; icon: React.ReactNode }[] = [
  { key: 'overview', label: 'Overview', href: '/dashboard', icon: <GridIcon /> },
  { key: 'projects', label: 'Projects', href: '/projects', icon: <FolderIcon /> },
  { key: 'templates', label: 'Templates', href: '/templates', icon: <LayoutIcon /> },
  { key: 'runs', label: 'Runs', href: '/runs', icon: <ActivityIcon /> },
  { key: 'credentials', label: 'Credentials', href: '/credentials', icon: <LockIcon /> },
  { key: 'team', label: 'Team', href: '/team', icon: <UsersIcon /> },
  { key: 'docs', label: 'Docs', href: '/docs', icon: <BookIcon /> },
];

// A project's latest-run status, computed from the real (existing, just
// previously unused for this purpose) GET /api/projects/{id}/runs endpoint
// — not a fabricated "environment" field (the real Project row has none).
interface RunSummary {
  state: 'ok' | 'failed' | 'none';
  when: string;
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

const STATUS_DOT: Record<RunSummary['state'], string> = {
  ok: 'var(--accent-ink)',
  failed: 'var(--danger)',
  none: 'var(--ink3)',
};
const FILTER_LABELS: { id: RunStatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'ok', label: 'Deployed' },
  { id: 'failed', label: 'Failed' },
  { id: 'none', label: 'Draft' },
];

export default function ProjectsPageV2() {
  const { user, token, hasHydrated } = useAuthStore();
  const isLoggedIn = hasHydrated && !!user;

  const [theme, setTheme] = useState<Theme>('dark');
  const [projects, setProjects] = useState<Project[]>([]);
  const [runSummaries, setRunSummaries] = useState<Record<string, RunSummary>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<RunStatusFilter>('all');
  const [showImportNote, setShowImportNote] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`${API_URL}/api/projects`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
        const data: Project[] = await res.json();
        if (cancelled) return;
        setProjects(data);

        // Real, per-project run history — the endpoint already exists and
        // is already used by the workspace; this is the first page to
        // fan it out across every project to compute a real "latest run"
        // status per card instead of a fabricated environment tag.
        const summaries: Record<string, RunSummary> = {};
        await Promise.all(
          data.map(async (p) => {
            try {
              const runsRes = await fetch(`${API_URL}/api/projects/${p.id}/runs`, { headers: { Authorization: `Bearer ${token}` } });
              if (!runsRes.ok) return;
              const runs: { status: string; updatedAt: string }[] = await runsRes.json();
              if (runs.length === 0) {
                summaries[p.id] = { state: 'none', when: '' };
                return;
              }
              const latest = runs[0];
              const state = latest.status === 'SUCCESS' ? 'ok' : latest.status === 'FAILED' ? 'failed' : 'none';
              summaries[p.id] = { state, when: timeAgo(latest.updatedAt) };
            } catch {
              // leave this project's summary unset — its card shows no dot rather than a wrong one
            }
          })
        );
        if (!cancelled) setRunSummaries(summaries);
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Failed to load projects.';
          setLoadError(msg.includes('fetch') ? 'Cannot connect to the backend server. Please try again shortly.' : msg);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const visibleProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return projects.filter((p) => {
      const summary = runSummaries[p.id];
      const matchesStatus = statusFilter === 'all' || (summary?.state ?? 'none') === statusFilter;
      const matchesQuery = !q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q);
      return matchesStatus && matchesQuery;
    });
  }, [projects, runSummaries, searchQuery, statusFilter]);

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
      {/* SIDEBAR */}
      <aside style={{ width: 216, flex: 'none', borderRight: '1px solid var(--line)', background: 'var(--panel)', display: 'flex', flexDirection: 'column', position: 'sticky', top: 0, alignSelf: 'flex-start', height: '100vh' }}>
        <div style={{ height: 56, flex: 'none', display: 'flex', alignItems: 'center', gap: 9, padding: '0 16px', borderBottom: '1px solid var(--line)' }}>
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <BrandLogo size={24} />
          </Link>
        </div>

        <nav style={{ padding: '14px 10px', display: 'grid', gap: 2 }}>
          {NAV_ITEMS.map((item) => {
            const active = item.key === 'projects';
            const style: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', fontSize: 14.5, color: active ? 'var(--on-accent)' : 'var(--ink2)', background: active ? 'var(--accent)' : 'transparent' };
            return (
              <Link key={item.key} href={item.href} className={active ? undefined : 'wp-projects-navlink'} style={style}>
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
            <Link href="/login" className="wp-projects-navlink" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 34, fontSize: 13, fontWeight: 600, border: '1px solid var(--line)', color: 'var(--ink)' }}>
              Sign In
            </Link>
          )}
        </div>
      </aside>

      {/* MAIN */}
      <main style={{ flex: 1, minWidth: 0 }}>
        <header style={{ height: 56, display: 'flex', alignItems: 'center', gap: 14, padding: '0 clamp(16px,2.5vw,28px)', borderBottom: '1px solid var(--line)', background: 'var(--ground)', position: 'sticky', top: 0, zIndex: 20 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>Projects</span>
          <div style={{ flex: 1, maxWidth: 340, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', height: 32, border: '1px solid var(--line)' }}>
            <Icon icon="lucide:search" width={14} style={{ color: 'var(--ink3)', flexShrink: 0 }} />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search projects"
              className="wp-projects-input"
              style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent', fontSize: 13.5, color: 'var(--ink)', fontFamily: 'var(--font-body-marketing), sans-serif' }}
            />
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
              title="Toggle theme"
              className="wp-projects-iconbtn"
              style={{ width: 32, height: 32, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink2)', cursor: 'pointer' }}
            >
              <Icon icon={theme === 'light' ? 'lucide:moon' : 'lucide:sun'} width={15} />
            </button>
            <button
              type="button"
              onClick={() => setShowImportNote(true)}
              className="wp-projects-navlink"
              style={{ height: 32, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, border: '1px solid var(--line)', color: 'var(--ink)', background: 'transparent', cursor: 'pointer' }}
            >
              <Icon icon="lucide:upload" width={13} />
              Import .tf
            </button>
            <Link
              href={isLoggedIn ? '/dashboard?create=1' : '/login'}
              className="wp-blueprint wp-projects-submit"
              style={{ position: 'relative', height: 32, padding: '0 14px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, background: 'var(--accent)', color: 'var(--on-accent)' }}
            >
              <Icon icon="lucide:plus" width={13} />
              New project
            </Link>
            {isLoggedIn && <ProfileMenu blueprint />}
          </div>
        </header>

        <div style={{ padding: 'clamp(20px,3vw,32px) clamp(16px,2.5vw,28px) 48px', display: 'grid', gap: 'clamp(20px,2.5vw,28px)' }}>
          <div>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(26px,3vw,34px)', lineHeight: 1.1, color: 'var(--ink)' }}>Projects</h1>
            <p style={{ margin: '5px 0 0', fontSize: 14.5, color: 'var(--ink2)' }}>Every graph your team owns.</p>
            {showImportNote && (
              <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--amber)', background: 'color-mix(in srgb, var(--amber) 10%, transparent)', border: '1px solid var(--amber)', padding: '6px 10px', width: 'fit-content' }}>
                Importing existing Terraform is launching in a future phase.
              </p>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {FILTER_LABELS.map((f) => {
              const active = statusFilter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setStatusFilter(f.id)}
                  style={{
                    height: 30,
                    padding: '0 13px',
                    fontFamily: 'var(--font-display)',
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: 'pointer',
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--line)'}`,
                    background: active ? 'var(--accent)' : 'transparent',
                    color: active ? 'var(--on-accent)' : 'var(--ink2)',
                  }}
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          {isLoading ? (
            <div style={{ padding: '60px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: 'var(--ink3)' }}>
              <Icon icon="lucide:loader-2" className="animate-spin" width={24} style={{ color: 'var(--accent)' }} />
              <p style={{ margin: 0, fontSize: 12 }}>Loading projects...</p>
            </div>
          ) : loadError ? (
            <div style={{ padding: '60px 24px', border: '1px dashed var(--danger)', background: 'color-mix(in srgb, var(--danger) 6%, transparent)', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
              <Icon icon="lucide:alert-circle" width={24} style={{ color: 'var(--danger)', marginBottom: 8 }} />
              <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)' }}>{loadError}</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 14 }}>
              {visibleProjects.map((p) => {
                const summary = runSummaries[p.id];
                return (
                  <Link
                    key={p.id}
                    href={`/workspace?project=${p.id}`}
                    className="wp-blueprint wp-projects-card"
                    style={{ position: 'relative', display: 'block', background: 'var(--panel)', padding: 16, color: 'var(--ink)' }}
                  >
                    <BlueprintCorners />
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18 }}>{p.name}</p>
                      <span style={{ fontFamily: 'var(--font-mono-marketing)', fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', padding: '2px 7px', color: 'var(--ink2)', background: 'var(--chip)' }}>{p.visibility.toLowerCase()}</span>
                    </div>
                    <p style={{ margin: '8px 0 0', fontFamily: 'var(--font-mono-marketing)', fontSize: 11, color: 'var(--ink2)' }}>{p.description || 'No description'}</p>
                    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12.5, color: 'var(--ink2)' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 6, height: 6, background: STATUS_DOT[summary?.state ?? 'none'] }} />
                        {summary?.state === 'ok' ? `last run ok · ${summary.when}` : summary?.state === 'failed' ? `apply failed · ${summary.when}` : 'no runs yet'}
                      </span>
                      <span>{p.user_role}</span>
                    </div>
                  </Link>
                );
              })}
              <Link
                href={isLoggedIn ? '/dashboard?create=1' : '/login'}
                className="wp-projects-navlink"
                style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, border: '1px dashed var(--line)', padding: 16, color: 'var(--ink2)', minHeight: 118 }}
              >
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 17 }}>+ New project</span>
                <span style={{ fontSize: 12.5 }}>Blank canvas, a template, or import existing HCL.</span>
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

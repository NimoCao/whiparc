'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { Icon } from '@iconify/react';
import { useAuthStore } from '../store/useAuthStore';
import ProfileMenu from '../components/ProfileMenu';
import { BlueprintCorners } from '../components/ui/BlueprintCorners';
import { THEME_PALETTES, type Theme } from '../components/ui/theme-palette';
import { spaceGroteskFont, barlowFont, jetBrainsMonoFont } from '../fonts';
import { GridIcon, FolderIcon, LayoutIcon, ActivityIcon, LockIcon, UsersIcon, BookIcon } from '../dashboard/NavIcons';
import { BrandLogo } from '../components/brand/BrandLogo';
import type { PipelineRun, RunRow } from '../lib/types';
import { useAggregatedRuns } from '../lib/useAggregatedRuns';
import '../components/ui/blueprint.css';
import './runs.css';

const NAV_ITEMS: { key: string; label: string; href: string; icon: React.ReactNode }[] = [
  { key: 'overview', label: 'Overview', href: '/dashboard', icon: <GridIcon /> },
  { key: 'projects', label: 'Projects', href: '/projects', icon: <FolderIcon /> },
  { key: 'templates', label: 'Templates', href: '/templates', icon: <LayoutIcon /> },
  { key: 'runs', label: 'Runs', href: '/runs', icon: <ActivityIcon /> },
  { key: 'credentials', label: 'Credentials', href: '/credentials', icon: <LockIcon /> },
  { key: 'team', label: 'Team', href: '/team', icon: <UsersIcon /> },
  { key: 'docs', label: 'Docs', href: '/docs', icon: <BookIcon /> },
];

type StatusFilter = 'all' | 'SUCCESS' | 'FAILED' | 'RUNNING';

const DOT: Record<PipelineRun['status'], string> = {
  SUCCESS: 'var(--accent-ink)',
  FAILED: 'var(--danger)',
  RUNNING: 'var(--amber)',
  PENDING: 'var(--ink3)',
};
const FILTER_LABELS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'SUCCESS', label: 'Success' },
  { id: 'FAILED', label: 'Failed' },
  { id: 'RUNNING', label: 'Running' },
];

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}
function formatDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

export default function RunsPageV2() {
  const { user, token, hasHydrated } = useAuthStore();
  const isLoggedIn = hasHydrated && !!user;

  const [theme, setTheme] = useState<Theme>('dark');
  const { runs, isLoading, error: loadError } = useAggregatedRuns(token);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [logsRun, setLogsRun] = useState<RunRow | null>(null);
  const [showTriggerNote, setShowTriggerNote] = useState(false);

  // Captured once (not read fresh inside the memo below, which must stay a
  // pure function of its dependency array) — good enough for a stats panel
  // that only needs to be accurate as of when the run list last changed.
  const [now] = useState(() => Date.now());

  const stats = useMemo(() => {
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const last7d = runs.filter((r) => new Date(r.createdAt).getTime() >= sevenDaysAgo);
    const finished = last7d.filter((r) => r.status === 'SUCCESS' || r.status === 'FAILED');
    const successRate = finished.length === 0 ? null : Math.round((finished.filter((r) => r.status === 'SUCCESS').length / finished.length) * 100);
    const durations = finished
      .map((r) => new Date(r.updatedAt).getTime() - new Date(r.createdAt).getTime())
      .filter((ms) => Number.isFinite(ms) && ms > 0);
    const avgMs = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const failedToday = runs.filter((r) => r.status === 'FAILED' && new Date(r.createdAt).getTime() >= todayStart.getTime()).length;
    return {
      count7d: last7d.length,
      successRate,
      avgDuration: avgMs === null ? '—' : avgMs < 60000 ? `${Math.round(avgMs / 1000)}s` : `${Math.floor(avgMs / 60000)}m ${Math.round((avgMs % 60000) / 1000)}s`,
      failedToday,
    };
  }, [runs, now]);

  const visibleRuns = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return runs.filter((r) => {
      const matchesStatus = statusFilter === 'all' || r.status === statusFilter;
      const matchesQuery = !q || r.id.toLowerCase().includes(q) || r.projectName.toLowerCase().includes(q);
      return matchesStatus && matchesQuery;
    });
  }, [runs, searchQuery, statusFilter]);

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
            const active = item.key === 'runs';
            const style: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', fontSize: 14.5, color: active ? 'var(--on-accent)' : 'var(--ink2)', background: active ? 'var(--accent)' : 'transparent' };
            return (
              <Link key={item.key} href={item.href} className={active ? undefined : 'wp-runs-navlink'} style={style}>
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
            <Link href="/login" className="wp-runs-navlink" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 34, fontSize: 13, fontWeight: 600, border: '1px solid var(--line)', color: 'var(--ink)' }}>
              Sign In
            </Link>
          )}
        </div>
      </aside>

      <main style={{ flex: 1, minWidth: 0 }}>
        <header style={{ height: 56, display: 'flex', alignItems: 'center', gap: 14, padding: '0 clamp(16px,2.5vw,28px)', borderBottom: '1px solid var(--line)', background: 'var(--ground)', position: 'sticky', top: 0, zIndex: 20 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>Runs</span>
          <div style={{ flex: 1, maxWidth: 340, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', height: 32, border: '1px solid var(--line)' }}>
            <Icon icon="lucide:search" width={14} style={{ color: 'var(--ink3)', flexShrink: 0 }} />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by run id or project"
              className="wp-runs-input"
              style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent', fontSize: 13.5, color: 'var(--ink)', fontFamily: 'var(--font-body-marketing), sans-serif' }}
            />
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
              title="Toggle theme"
              className="wp-runs-iconbtn"
              style={{ width: 32, height: 32, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink2)', cursor: 'pointer' }}
            >
              <Icon icon={theme === 'light' ? 'lucide:moon' : 'lucide:sun'} width={15} />
            </button>
            <button
              type="button"
              onClick={() => setShowTriggerNote(true)}
              className="wp-blueprint wp-runs-submit"
              style={{ position: 'relative', height: 32, padding: '0 14px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, background: 'var(--accent)', color: 'var(--on-accent)', border: 0, cursor: 'pointer' }}
            >
              <Icon icon="lucide:play" width={12} />
              Trigger run
            </button>
            {isLoggedIn && <ProfileMenu blueprint />}
          </div>
        </header>

        <div style={{ padding: 'clamp(20px,3vw,32px) clamp(16px,2.5vw,28px) 48px', display: 'grid', gap: 'clamp(20px,2.5vw,28px)' }}>
          <div>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(26px,3vw,34px)', lineHeight: 1.1, color: 'var(--ink)' }}>Runs</h1>
            <p style={{ margin: '5px 0 0', fontSize: 14.5, color: 'var(--ink2)' }}>Every plan, apply, and destroy across your projects.</p>
            {showTriggerNote && (
              <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--amber)', background: 'color-mix(in srgb, var(--amber) 10%, transparent)', border: '1px solid var(--amber)', padding: '6px 10px', width: 'fit-content' }}>
                Triggering a run needs a specific project&apos;s canvas — open a project&apos;s workspace and deploy from there for now.
              </p>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 14 }}>
            <div style={{ border: '1px solid var(--line)', padding: '14px 16px' }}>
              <p style={{ margin: 0, fontFamily: 'var(--font-mono-marketing)', fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink3)' }}>Runs, last 7 days</p>
              <p style={{ margin: '6px 0 0', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, lineHeight: 1, color: 'var(--ink)' }}>{stats.count7d}</p>
            </div>
            <div style={{ border: '1px solid var(--line)', padding: '14px 16px' }}>
              <p style={{ margin: 0, fontFamily: 'var(--font-mono-marketing)', fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink3)' }}>Success rate</p>
              <p style={{ margin: '6px 0 0', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, lineHeight: 1, color: 'var(--ink)' }}>{stats.successRate === null ? '—' : `${stats.successRate}%`}</p>
            </div>
            <div style={{ border: '1px solid var(--line)', padding: '14px 16px' }}>
              <p style={{ margin: 0, fontFamily: 'var(--font-mono-marketing)', fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink3)' }}>Avg duration</p>
              <p style={{ margin: '6px 0 0', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, lineHeight: 1, color: 'var(--ink)' }}>{stats.avgDuration}</p>
            </div>
            <div style={{ border: '1px solid var(--line)', padding: '14px 16px' }}>
              <p style={{ margin: 0, fontFamily: 'var(--font-mono-marketing)', fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink3)' }}>Failed today</p>
              <p style={{ margin: '6px 0 0', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, lineHeight: 1, color: 'var(--danger)' }}>{stats.failedToday}</p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {FILTER_LABELS.map((f) => {
              const active = statusFilter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setStatusFilter(f.id)}
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
              <p style={{ margin: 0, fontSize: 12 }}>Loading runs...</p>
            </div>
          ) : loadError ? (
            <div style={{ padding: '60px 24px', border: '1px dashed var(--danger)', background: 'color-mix(in srgb, var(--danger) 6%, transparent)', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
              <Icon icon="lucide:alert-circle" width={24} style={{ color: 'var(--danger)', marginBottom: 8 }} />
              <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)' }}>{loadError}</p>
            </div>
          ) : visibleRuns.length === 0 ? (
            <div style={{ padding: '40px 24px', border: '1px dashed var(--line)', textAlign: 'center', color: 'var(--ink3)' }}>
              <p style={{ margin: 0, fontSize: 13 }}>No runs match your filters yet.</p>
            </div>
          ) : (
            <div style={{ border: '1px solid var(--line)', overflowX: 'auto' }}>
              <table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr>
                    {['Run', 'Project', 'Type', 'Target', 'Duration', 'When', 'Status', ''].map((h) => (
                      <th key={h} style={{ textAlign: 'left', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink3)', padding: '9px 12px', borderBottom: '1px solid var(--line)' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRuns.map((run) => (
                    <tr key={run.id} className="wp-runs-row">
                      <td style={{ padding: '9px 12px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--font-mono-marketing)', fontSize: 12, color: 'var(--ink)' }}>{run.id.slice(0, 10)}</td>
                      <td style={{ padding: '9px 12px', borderBottom: '1px solid var(--line)', color: 'var(--ink)' }}>{run.projectName}</td>
                      <td style={{ padding: '9px 12px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--font-mono-marketing)', fontSize: 12, color: 'var(--ink3)' }}>{run.runType?.toLowerCase() ?? '—'}</td>
                      <td style={{ padding: '9px 12px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--font-mono-marketing)', fontSize: 12, color: 'var(--ink3)' }}>{run.target ?? '—'}</td>
                      <td style={{ padding: '9px 12px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--font-mono-marketing)', fontSize: 12, color: 'var(--ink2)' }}>{formatDuration(run.createdAt, run.updatedAt)}</td>
                      <td style={{ padding: '9px 12px', borderBottom: '1px solid var(--line)', color: 'var(--ink2)' }}>{timeAgo(run.createdAt)}</td>
                      <td style={{ padding: '9px 12px', borderBottom: '1px solid var(--line)' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ink)' }}>
                          <span style={{ width: 6, height: 6, background: DOT[run.status] }} />
                          {run.status.toLowerCase()}
                        </span>
                      </td>
                      <td style={{ padding: '9px 12px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>
                        <button type="button" onClick={() => setLogsRun(run)} className="wp-runs-navlink" style={{ fontSize: 12.5, color: 'var(--accent-ink)', background: 'none', border: 0, cursor: 'pointer' }}>
                          View logs
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Real log viewer — GET /api/runs/{id} already returns the actual
          stored `logs` string; this reuses it instead of linking nowhere. */}
      {logsRun && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.7)', backdropFilter: 'blur(4px)' }} onClick={() => setLogsRun(null)}>
          <div
            className="wp-blueprint"
            style={{ position: 'relative', width: 'min(720px, 92vw)', maxHeight: '80vh', display: 'flex', flexDirection: 'column', background: 'var(--panel)', padding: 20 }}
            onClick={(e) => e.stopPropagation()}
          >
            <BlueprintCorners />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: 'var(--ink)' }}>
                  {logsRun.projectName} · {logsRun.id.slice(0, 10)}
                </p>
                {logsRun.triggeredBy && (
                  <p style={{ margin: '2px 0 0', fontSize: 11.5, color: 'var(--ink3)' }}>
                    Triggered by {logsRun.triggeredBy.name}
                  </p>
                )}
              </div>
              <button type="button" onClick={() => setLogsRun(null)} className="wp-runs-iconbtn" style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink2)', cursor: 'pointer' }}>
                <Icon icon="lucide:x" width={14} />
              </button>
            </div>
            <pre style={{ margin: 0, flex: 1, overflow: 'auto', background: '#101114', border: '1px solid #2A2C33', padding: 14, fontFamily: 'var(--font-mono-marketing), monospace', fontSize: 12, lineHeight: 1.6, color: '#CBD5E1', whiteSpace: 'pre-wrap' }}>
              {logsRun.logs || '(no logs recorded for this run)'}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}


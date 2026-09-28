'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { Icon } from '@iconify/react';
import { useAuthStore } from '../store/useAuthStore';
import ProfileMenu from '../components/ProfileMenu';
import { THEME_PALETTES, type Theme } from '../components/ui/theme-palette';
import { spaceGroteskFont, barlowFont, jetBrainsMonoFont } from '../fonts';
import { GridIcon, FolderIcon, LayoutIcon, ActivityIcon, LockIcon, UsersIcon, BookIcon } from '../dashboard/NavIcons';
import { BrandLogo } from '../components/brand/BrandLogo';
import type { Project } from '../lib/types';
import '../components/ui/blueprint.css';
import './team.css';

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

// Mirrors apps/api/projects.go's ProjectMemberInfo. There is no team-wide
// member-roster endpoint (team_members has no name/email join anywhere) —
// this page computes one for real by fanning GET /api/projects/{id}/members
// out across every project the signed-in user can see, then deduping by
// user and taking their HIGHEST project role. That computed role is a
// synthesized aggregate, not a literal team_members.role (that column is
// a separate, coarser OWNER/ADMIN/MEMBER enum — see the product-memory
// TODO added alongside this page for why the two don't cleanly unify yet).
interface ProjectMemberInfo {
  user_id: string;
  user_name: string;
  email: string;
  role: 'ADMIN' | 'EDITOR' | 'VIEWER';
  joined_at: string;
}
interface RosterRow {
  userId: string;
  name: string;
  email: string;
  role: ProjectMemberInfo['role'];
  projectCount: number;
}

interface Team {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  created_at: string;
}

const ROLE_RANK: Record<ProjectMemberInfo['role'], number> = { ADMIN: 3, EDITOR: 2, VIEWER: 1 };
const ROLE_STYLE: Record<ProjectMemberInfo['role'], { bg: string; fg: string; border: string }> = {
  ADMIN: { bg: 'var(--accent)', fg: 'var(--on-accent)', border: 'none' },
  EDITOR: { bg: 'var(--chip)', fg: 'var(--ink2)', border: 'none' },
  VIEWER: { bg: 'transparent', fg: 'var(--ink2)', border: '1px solid var(--line)' },
};
const AVATAR_BGS = ['var(--accent-hover)', 'var(--amber)', 'var(--success)'];

function initialsOf(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export default function TeamPageV2() {
  const { user, token, hasHydrated } = useAuthStore();
  const isLoggedIn = hasHydrated && !!user;

  const [theme, setTheme] = useState<Theme>('dark');
  const [team, setTeam] = useState<Team | null>(null);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showComingSoon, setShowComingSoon] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const [teamsRes, projRes] = await Promise.all([
          fetch(`${API_URL}/api/teams`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${API_URL}/api/projects`, { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        if (!projRes.ok) throw new Error(`Request failed with status ${projRes.status}`);
        const teams: Team[] = teamsRes.ok ? await teamsRes.json() : [];
        const projects: Project[] = await projRes.json();
        if (cancelled) return;
        setTeam(teams[0] ?? null);

        const perProject = await Promise.all(
          projects.map(async (p) => {
            try {
              const res = await fetch(`${API_URL}/api/projects/${p.id}/members`, { headers: { Authorization: `Bearer ${token}` } });
              if (!res.ok) return [] as ProjectMemberInfo[];
              return (await res.json()) as ProjectMemberInfo[];
            } catch {
              return [] as ProjectMemberInfo[];
            }
          })
        );
        if (cancelled) return;

        const byUser = new Map<string, RosterRow>();
        for (const members of perProject) {
          for (const m of members) {
            const existing = byUser.get(m.user_id);
            if (!existing) {
              byUser.set(m.user_id, { userId: m.user_id, name: m.user_name, email: m.email, role: m.role, projectCount: 1 });
            } else {
              existing.projectCount += 1;
              if (ROLE_RANK[m.role] > ROLE_RANK[existing.role]) existing.role = m.role;
            }
          }
        }
        setRoster(Array.from(byUser.values()).sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role] || a.name.localeCompare(b.name)));
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Failed to load team.';
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

  const visibleRoster = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter((m) => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q));
  }, [roster, searchQuery]);

  const adminCount = roster.filter((m) => m.role === 'ADMIN').length;

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
            const active = item.key === 'team';
            const style: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', fontSize: 14.5, color: active ? 'var(--on-accent)' : 'var(--ink2)', background: active ? 'var(--accent)' : 'transparent' };
            return (
              <Link key={item.key} href={item.href} className={active ? undefined : 'wp-team-navlink'} style={style}>
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
            <Link href="/login" className="wp-team-navlink" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 34, fontSize: 13, fontWeight: 600, border: '1px solid var(--line)', color: 'var(--ink)' }}>
              Sign In
            </Link>
          )}
        </div>
      </aside>

      <main style={{ flex: 1, minWidth: 0 }}>
        <header style={{ height: 56, display: 'flex', alignItems: 'center', gap: 14, padding: '0 clamp(16px,2.5vw,28px)', borderBottom: '1px solid var(--line)', background: 'var(--ground)', position: 'sticky', top: 0, zIndex: 20 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>Team</span>
          <div style={{ flex: 1, maxWidth: 340, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', height: 32, border: '1px solid var(--line)' }}>
            <Icon icon="lucide:search" width={14} style={{ color: 'var(--ink3)', flexShrink: 0 }} />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search members"
              className="wp-team-input"
              style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent', fontSize: 13.5, color: 'var(--ink)', fontFamily: 'var(--font-body-marketing), sans-serif' }}
            />
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
              title="Toggle theme"
              className="wp-team-iconbtn"
              style={{ width: 32, height: 32, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink2)', cursor: 'pointer' }}
            >
              <Icon icon={theme === 'light' ? 'lucide:moon' : 'lucide:sun'} width={15} />
            </button>
            <button
              type="button"
              onClick={() => setShowComingSoon('invite')}
              className="wp-blueprint wp-team-submit"
              style={{ position: 'relative', height: 32, padding: '0 14px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, background: 'var(--accent)', color: 'var(--on-accent)', border: 0, cursor: 'pointer' }}
            >
              <Icon icon="lucide:user-plus" width={13} />
              Invite member
            </button>
            {isLoggedIn && <ProfileMenu blueprint />}
          </div>
        </header>

        <div style={{ padding: 'clamp(20px,3vw,32px) clamp(16px,2.5vw,28px) 48px', display: 'grid', gap: 'clamp(20px,2.5vw,28px)' }}>
          <div>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(26px,3vw,34px)', lineHeight: 1.1, color: 'var(--ink)' }}>Team</h1>
            <p style={{ margin: '5px 0 0', fontSize: 14.5, color: 'var(--ink2)' }}>Everyone with access to {team?.name || 'your team'}, and what they can touch.</p>
            {showComingSoon === 'invite' && (
              <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--amber)', background: 'color-mix(in srgb, var(--amber) 10%, transparent)', border: '1px solid var(--amber)', padding: '6px 10px', width: 'fit-content' }}>
                Inviting new members by email is launching in a future phase — add someone to a project directly from Project Settings for now.
              </p>
            )}
          </div>

          {isLoading ? (
            <div style={{ padding: '60px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: 'var(--ink3)' }}>
              <Icon icon="lucide:loader-2" className="animate-spin" width={24} style={{ color: 'var(--accent)' }} />
              <p style={{ margin: 0, fontSize: 12 }}>Loading team...</p>
            </div>
          ) : loadError ? (
            <div style={{ padding: '60px 24px', border: '1px dashed var(--danger)', background: 'color-mix(in srgb, var(--danger) 6%, transparent)', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
              <Icon icon="lucide:alert-circle" width={24} style={{ color: 'var(--danger)', marginBottom: 8 }} />
              <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)' }}>{loadError}</p>
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 14 }}>
                <div style={{ border: '1px solid var(--line)', padding: '14px 16px' }}>
                  <p style={{ margin: 0, fontFamily: 'var(--font-mono-marketing)', fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink3)' }}>Members</p>
                  <p style={{ margin: '6px 0 0', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, lineHeight: 1, color: 'var(--ink)' }}>{roster.length}</p>
                </div>
                <div style={{ border: '1px solid var(--line)', padding: '14px 16px' }}>
                  <p style={{ margin: 0, fontFamily: 'var(--font-mono-marketing)', fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink3)' }}>Admins</p>
                  <p style={{ margin: '6px 0 0', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, lineHeight: 1, color: 'var(--ink)' }}>{adminCount}</p>
                </div>
                <div style={{ border: '1px solid var(--line)', padding: '14px 16px' }}>
                  <p style={{ margin: 0, fontFamily: 'var(--font-mono-marketing)', fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink3)' }}>Pending invites</p>
                  <p style={{ margin: '6px 0 0', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, lineHeight: 1, color: 'var(--ink)' }}>0</p>
                </div>
              </div>

              <section>
                <div style={{ border: '1px solid var(--line)', overflowX: 'auto' }}>
                  <table style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse', fontSize: 14 }}>
                    <thead>
                      <tr>
                        {['Member', 'Role', 'Access', ''].map((h) => (
                          <th key={h} style={{ textAlign: 'left', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink3)', padding: '9px 12px', borderBottom: '1px solid var(--line)' }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRoster.map((m, i) => (
                        <tr key={m.userId} className="wp-team-row">
                          <td style={{ padding: '9px 12px', borderBottom: '1px solid var(--line)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                              <span style={{ width: 26, height: 26, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: AVATAR_BGS[i % AVATAR_BGS.length], color: 'var(--on-accent)', fontFamily: 'var(--font-display)', fontSize: 11 }}>
                                {initialsOf(m.name)}
                              </span>
                              <div style={{ minWidth: 0 }}>
                                <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ink)' }}>{m.name}</p>
                                <p style={{ margin: 0, fontSize: 11.5, color: 'var(--ink3)' }}>{m.email}</p>
                              </div>
                            </div>
                          </td>
                          <td style={{ padding: '9px 12px', borderBottom: '1px solid var(--line)' }}>
                            <span style={{ fontFamily: 'var(--font-mono-marketing)', fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', padding: '2px 7px', background: ROLE_STYLE[m.role].bg, color: ROLE_STYLE[m.role].fg, border: ROLE_STYLE[m.role].border }}>
                              {m.role}
                            </span>
                          </td>
                          <td style={{ padding: '9px 12px', borderBottom: '1px solid var(--line)', color: 'var(--ink2)' }}>
                            {m.projectCount} project{m.projectCount === 1 ? '' : 's'}
                          </td>
                          <td style={{ padding: '9px 12px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>
                            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                              <button type="button" onClick={() => setShowComingSoon('role')} className="wp-team-navlink" style={{ fontSize: 12.5, color: 'var(--accent-ink)', background: 'none', border: 0, cursor: 'pointer' }}>
                                Change role
                              </button>
                              <button type="button" onClick={() => setShowComingSoon('remove')} style={{ fontSize: 12.5, color: 'var(--danger)', background: 'none', border: 0, cursor: 'pointer' }}>
                                Remove
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {(showComingSoon === 'role' || showComingSoon === 'remove') && (
                  <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--amber)', background: 'color-mix(in srgb, var(--amber) 10%, transparent)', border: '1px solid var(--amber)', padding: '6px 10px', width: 'fit-content' }}>
                    Team-wide role changes are launching in a future phase — a person&apos;s role is per-project today, managed from that project&apos;s Settings.
                  </p>
                )}
              </section>

              <section>
                <h2 style={{ margin: '0 0 12px', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, color: 'var(--ink)' }}>Pending invites</h2>
                <div style={{ border: '1px dashed var(--line)', padding: '16px 14px', textAlign: 'center', color: 'var(--ink3)' }}>
                  <p style={{ margin: 0, fontSize: 13 }}>No pending invites — email invites are launching in a future phase.</p>
                </div>
              </section>

              <section style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>
                <p style={{ margin: '0 0 12px', fontFamily: 'var(--font-mono-marketing)', fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink3)' }}>Roles</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14 }}>
                  <div style={{ border: '1px solid var(--line)', padding: '14px 16px' }}>
                    <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: 'var(--ink)' }}>Admin</p>
                    <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--ink2)' }}>Full access on the project — settings, credentials, and members.</p>
                  </div>
                  <div style={{ border: '1px solid var(--line)', padding: '14px 16px' }}>
                    <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: 'var(--ink)' }}>Editor</p>
                    <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--ink2)' }}>Create, edit, and deploy. No settings or member access.</p>
                  </div>
                  <div style={{ border: '1px solid var(--line)', padding: '14px 16px' }}>
                    <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: 'var(--ink)' }}>Viewer</p>
                    <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--ink2)' }}>Read-only — can browse graphs, runs, and logs.</p>
                  </div>
                </div>
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

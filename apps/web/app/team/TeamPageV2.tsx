'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { Icon } from '@iconify/react';
import { initializePaddle, type Paddle } from '@paddle/paddle-js';
import { useAuthStore } from '../store/useAuthStore';
import ProfileMenu from '../components/ProfileMenu';
import { THEME_PALETTES, type Theme } from '../components/ui/theme-palette';
import { spaceGroteskFont, barlowFont, jetBrainsMonoFont } from '../fonts';
import { GridIcon, FolderIcon, LayoutIcon, ActivityIcon, LockIcon, UsersIcon, ShieldIcon, BookIcon } from '../dashboard/NavIcons';
import { BrandLogo } from '../components/brand/BrandLogo';
import { BlueprintCorners } from '../components/ui/BlueprintCorners';
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
  { key: 'account', label: 'Account', href: '/account', icon: <ShieldIcon /> },
  { key: 'docs', label: 'Docs', href: '/docs', icon: <BookIcon /> },
];

// Mirrors apps/api/teams.go's TeamMemberInfo — a real team-roster endpoint
// (GET /api/teams/{id}/members) as of product-memory 08.5 item E2. This is
// the literal team_members.role (OWNER/ADMIN/MEMBER), a coarser, separate
// enum from project_members.role (ADMIN/EDITOR/VIEWER) — see the decision
// recorded alongside 08.5 for why the two aren't unified into one enum.
interface TeamMemberInfo {
  user_id: string;
  user_name: string;
  email: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  joined_at: string;
}
interface InvitationInfo {
  id: string;
  email: string;
  role: 'ADMIN' | 'MEMBER';
  status: string;
  invited_by_name: string;
  expires_at: string;
  created_at: string;
}

interface Team {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  created_at: string;
}

// Mirrors apps/api/billing.go's TeamBillingInfo (GET /api/teams/{id}/billing)
// — product-memory 08.5 item G1.
interface TeamBillingInfo {
  team_id: string;
  plan: 'FREE' | 'PRO' | 'ENTERPRISE';
  billing_provider?: string;
  subscription_status?: string;
  seats?: number;
  member_count: number;
  current_period_end?: string;
  has_subscription: boolean;
  price_id_pro?: string;
}

const PLAN_LABEL: Record<TeamBillingInfo['plan'], string> = { FREE: 'Free', PRO: 'Pro', ENTERPRISE: 'Enterprise' };

const ROLE_RANK: Record<TeamMemberInfo['role'], number> = { OWNER: 3, ADMIN: 2, MEMBER: 1 };
const ROLE_STYLE: Record<TeamMemberInfo['role'], { bg: string; fg: string; border: string }> = {
  OWNER: { bg: 'var(--accent)', fg: 'var(--on-accent)', border: 'none' },
  ADMIN: { bg: 'var(--chip)', fg: 'var(--ink2)', border: 'none' },
  MEMBER: { bg: 'transparent', fg: 'var(--ink2)', border: '1px solid var(--line)' },
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

function timeAgo(iso: string): string {
  const then = new Date(iso.replace(' ', 'T')).getTime();
  if (Number.isNaN(then)) return '';
  const days = Math.floor((Date.now() - then) / (24 * 60 * 60 * 1000));
  if (days < 1) return 'today';
  return days === 1 ? '1d ago' : `${days}d ago`;
}

export default function TeamPageV2() {
  const { user, token, hasHydrated } = useAuthStore();
  const isLoggedIn = hasHydrated && !!user;

  const [theme, setTheme] = useState<Theme>('dark');
  const [team, setTeam] = useState<Team | null>(null);
  const [roster, setRoster] = useState<TeamMemberInfo[]>([]);
  const [invites, setInvites] = useState<InvitationInfo[]>([]);
  const [billing, setBilling] = useState<TeamBillingInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [paddle, setPaddle] = useState<Paddle | null>(null);
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);

  const loadAll = async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const teamsRes = await fetch(`${API_URL}/api/teams`, { headers: { Authorization: `Bearer ${token}` } });
      if (!teamsRes.ok) throw new Error(`Request failed with status ${teamsRes.status}`);
      const teams: Team[] = await teamsRes.json();
      const activeTeam = teams[0] ?? null;
      setTeam(activeTeam);
      if (!activeTeam) {
        setRoster([]);
        setInvites([]);
        setBilling(null);
        setLoadError(null);
        return;
      }

      const membersRes = await fetch(`${API_URL}/api/teams/${activeTeam.id}/members`, { headers: { Authorization: `Bearer ${token}` } });
      if (!membersRes.ok) throw new Error(`Request failed with status ${membersRes.status}`);
      const members: TeamMemberInfo[] = await membersRes.json();
      setRoster(members.sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role] || a.user_name.localeCompare(b.user_name)));

      // Pending invites is ADMIN/OWNER-only server-side — a MEMBER's request
      // 403s, which just means "nothing to show here" for them rather than
      // a real load error.
      try {
        const invitesRes = await fetch(`${API_URL}/api/teams/${activeTeam.id}/invites`, { headers: { Authorization: `Bearer ${token}` } });
        setInvites(invitesRes.ok ? await invitesRes.json() : []);
      } catch {
        setInvites([]);
      }

      try {
        const billingRes = await fetch(`${API_URL}/api/teams/${activeTeam.id}/billing`, { headers: { Authorization: `Bearer ${token}` } });
        setBilling(billingRes.ok ? await billingRes.json() : null);
      } catch {
        setBilling(null);
      }
      setLoadError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load team.';
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

  // Checkout happens entirely client-side via Paddle.js (no backend "create
  // checkout" endpoint — see apps/api/billing.go's BillingProvider doc
  // comment); the webhook is what actually provisions the plan once payment
  // completes, never this redirect/event. clientToken missing just means
  // billing isn't configured for this environment — the Upgrade button below
  // stays disabled rather than throwing at init time.
  useEffect(() => {
    const clientToken = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
    if (!clientToken || paddle?.Initialized) return;
    initializePaddle({
      token: clientToken,
      environment: (process.env.NEXT_PUBLIC_PADDLE_ENV as 'sandbox' | 'production') || 'sandbox',
      eventCallback: (event) => {
        if (event.name === 'checkout.completed') {
          setCheckoutPending(true);
          // The webhook (the source of truth) lands within a second or two
          // of this event in practice, but isn't guaranteed synchronous with
          // it — one short delayed refetch covers the common case without
          // polling indefinitely. A slower webhook just means the plan
          // badge updates on the next natural page load instead.
          setTimeout(() => {
            setCheckoutPending(false);
            void loadAll();
          }, 2500);
        }
      },
    }).then((p) => p && setPaddle(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUpgrade = () => {
    if (!paddle || !team || !user || !billing?.price_id_pro) return;
    setBillingError(null);
    paddle.Checkout.open({
      items: [{ priceId: billing.price_id_pro, quantity: Math.max(1, billing.member_count) }],
      customer: { email: user.email },
      customData: { team_id: team.id },
      settings: { successUrl: `${window.location.origin}/team` },
    });
  };

  const handleManageBilling = async () => {
    if (!token || !team) return;
    setBillingError(null);
    setPortalLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/teams/${team.id}/billing/portal`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error((await res.text().catch(() => '')).trim() || `Request failed with status ${res.status}`);
      const data: { url: string } = await res.json();
      window.location.href = data.url;
    } catch (err) {
      setBillingError(err instanceof Error ? err.message : 'Failed to open the billing portal.');
      setPortalLoading(false);
    }
  };

  const myRole = useMemo(() => roster.find((m) => m.user_id === user?.id)?.role, [roster, user]);
  const canManage = myRole === 'OWNER' || myRole === 'ADMIN';

  const handleRoleChange = async (member: TeamMemberInfo, role: 'ADMIN' | 'MEMBER') => {
    if (!token || !team) return;
    setActionError(null);
    try {
      const res = await fetch(`${API_URL}/api/teams/${team.id}/members/${member.user_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) throw new Error((await res.text().catch(() => '')).trim() || `Request failed with status ${res.status}`);
      setRoster((prev) => prev.map((m) => (m.user_id === member.user_id ? { ...m, role } : m)));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update role.');
    }
  };

  const handleRemove = async (member: TeamMemberInfo) => {
    if (!token || !team) return;
    if (!window.confirm(`Remove ${member.user_name} from ${team.name}?`)) return;
    setActionError(null);
    try {
      const res = await fetch(`${API_URL}/api/teams/${team.id}/members/${member.user_id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error((await res.text().catch(() => '')).trim() || `Request failed with status ${res.status}`);
      setRoster((prev) => prev.filter((m) => m.user_id !== member.user_id));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to remove member.');
    }
  };

  const handleRevokeInvite = async (invite: InvitationInfo) => {
    if (!token || !team) return;
    setActionError(null);
    try {
      const res = await fetch(`${API_URL}/api/teams/${team.id}/invites/${invite.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
      setInvites((prev) => prev.filter((i) => i.id !== invite.id));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to revoke invite.');
    }
  };

  const visibleRoster = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter((m) => m.user_name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q));
  }, [roster, searchQuery]);

  const adminCount = roster.filter((m) => m.role === 'OWNER' || m.role === 'ADMIN').length;

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
              onClick={() => setIsInviteOpen(true)}
              disabled={!canManage}
              title={canManage ? undefined : 'Only team owners and admins can invite members'}
              className="wp-blueprint wp-team-submit"
              style={{ position: 'relative', height: 32, padding: '0 14px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, background: 'var(--accent)', color: 'var(--on-accent)', border: 0, cursor: canManage ? 'pointer' : 'not-allowed', opacity: canManage ? 1 : 0.5 }}
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
            {actionError && (
              <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--danger)', background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid var(--danger)', padding: '6px 10px', width: 'fit-content' }}>
                {actionError}
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
                  <p style={{ margin: 0, fontFamily: 'var(--font-mono-marketing)', fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink3)' }}>Owners &amp; admins</p>
                  <p style={{ margin: '6px 0 0', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, lineHeight: 1, color: 'var(--ink)' }}>{adminCount}</p>
                </div>
                <div style={{ border: '1px solid var(--line)', padding: '14px 16px' }}>
                  <p style={{ margin: 0, fontFamily: 'var(--font-mono-marketing)', fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink3)' }}>Pending invites</p>
                  <p style={{ margin: '6px 0 0', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 26, lineHeight: 1, color: 'var(--ink)' }}>{invites.length}</p>
                </div>
              </div>

              <section>
                <h2 style={{ margin: '0 0 12px', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, color: 'var(--ink)' }}>Billing</h2>
                <div style={{ border: '1px solid var(--line)', padding: '16px 18px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono-marketing)',
                        fontSize: 11,
                        letterSpacing: '.06em',
                        textTransform: 'uppercase',
                        padding: '4px 10px',
                        background: billing?.plan === 'FREE' || !billing ? 'var(--chip)' : 'var(--accent)',
                        color: billing?.plan === 'FREE' || !billing ? 'var(--ink2)' : 'var(--on-accent)',
                      }}
                    >
                      {billing ? PLAN_LABEL[billing.plan] : 'Free'}
                    </span>
                    <div>
                      <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ink)' }}>
                        {billing?.plan === 'PRO'
                          ? `$19 / seat / month · ${billing.member_count} member${billing.member_count === 1 ? '' : 's'}`
                          : 'Hosted sandbox, extra seats, and priority support'}
                      </p>
                      <p style={{ margin: '3px 0 0', fontSize: 11.5, color: 'var(--ink3)' }}>
                        {billing?.subscription_status === 'past_due'
                          ? 'Payment failed — update your card to keep Pro access.'
                          : billing?.current_period_end
                            ? `Renews ${new Date(billing.current_period_end).toLocaleDateString()}`
                            : canManage
                              ? 'Upgrade to unlock the hosted sandbox for every project this team owns.'
                              : "Only the team's owner or admins can change billing."}
                      </p>
                    </div>
                  </div>
                  {canManage && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {checkoutPending && <span style={{ fontSize: 12, color: 'var(--ink3)' }}>Confirming payment...</span>}
                      {billing?.has_subscription ? (
                        <button
                          type="button"
                          onClick={handleManageBilling}
                          disabled={portalLoading}
                          className="wp-team-iconbtn"
                          style={{ height: 34, padding: '0 14px', fontSize: 13, border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink)', cursor: portalLoading ? 'default' : 'pointer', opacity: portalLoading ? 0.6 : 1 }}
                        >
                          {portalLoading ? 'Opening...' : 'Manage billing'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handleUpgrade}
                          disabled={!paddle || !billing?.price_id_pro}
                          title={!billing?.price_id_pro ? 'Billing is not configured for this environment yet' : undefined}
                          className="wp-blueprint wp-team-submit"
                          style={{ position: 'relative', height: 34, padding: '0 16px', fontSize: 13, background: 'var(--accent)', color: 'var(--on-accent)', border: 0, cursor: !paddle || !billing?.price_id_pro ? 'not-allowed' : 'pointer', opacity: !paddle || !billing?.price_id_pro ? 0.5 : 1 }}
                        >
                          Upgrade to Pro
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {billingError && (
                  <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--danger)', background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid var(--danger)', padding: '6px 10px', width: 'fit-content' }}>
                    {billingError}
                  </p>
                )}
              </section>

              <section>
                <div style={{ border: '1px solid var(--line)', overflowX: 'auto' }}>
                  <table style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse', fontSize: 14 }}>
                    <thead>
                      <tr>
                        {['Member', 'Role', 'Joined', ''].map((h) => (
                          <th key={h} style={{ textAlign: 'left', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink3)', padding: '9px 12px', borderBottom: '1px solid var(--line)' }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRoster.map((m, i) => {
                        const isOwner = m.role === 'OWNER';
                        return (
                          <tr key={m.user_id} className="wp-team-row">
                            <td style={{ padding: '9px 12px', borderBottom: '1px solid var(--line)' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                                <span style={{ width: 26, height: 26, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: AVATAR_BGS[i % AVATAR_BGS.length], color: 'var(--on-accent)', fontFamily: 'var(--font-display)', fontSize: 11 }}>
                                  {initialsOf(m.user_name)}
                                </span>
                                <div style={{ minWidth: 0 }}>
                                  <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ink)' }}>
                                    {m.user_name}
                                    {m.user_id === user?.id && <span style={{ color: 'var(--ink3)' }}> (you)</span>}
                                  </p>
                                  <p style={{ margin: 0, fontSize: 11.5, color: 'var(--ink3)' }}>{m.email}</p>
                                </div>
                              </div>
                            </td>
                            <td style={{ padding: '9px 12px', borderBottom: '1px solid var(--line)' }}>
                              {canManage && !isOwner ? (
                                <select
                                  value={m.role}
                                  onChange={(e) => handleRoleChange(m, e.target.value as 'ADMIN' | 'MEMBER')}
                                  style={{ fontFamily: 'var(--font-mono-marketing)', fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', padding: '2px 7px', background: ROLE_STYLE[m.role].bg, color: ROLE_STYLE[m.role].fg, border: ROLE_STYLE[m.role].border || '1px solid var(--line)', cursor: 'pointer' }}
                                >
                                  <option value="ADMIN">ADMIN</option>
                                  <option value="MEMBER">MEMBER</option>
                                </select>
                              ) : (
                                <span style={{ fontFamily: 'var(--font-mono-marketing)', fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', padding: '2px 7px', background: ROLE_STYLE[m.role].bg, color: ROLE_STYLE[m.role].fg, border: ROLE_STYLE[m.role].border }}>
                                  {m.role}
                                </span>
                              )}
                            </td>
                            <td style={{ padding: '9px 12px', borderBottom: '1px solid var(--line)', color: 'var(--ink2)' }}>{timeAgo(m.joined_at)}</td>
                            <td style={{ padding: '9px 12px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>
                              {canManage && !isOwner && (
                                <button type="button" onClick={() => handleRemove(m)} style={{ fontSize: 12.5, color: 'var(--danger)', background: 'none', border: 0, cursor: 'pointer' }}>
                                  Remove
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              {canManage && (
                <section>
                  <h2 style={{ margin: '0 0 12px', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, color: 'var(--ink)' }}>Pending invites</h2>
                  {invites.length === 0 ? (
                    <div style={{ border: '1px dashed var(--line)', padding: '16px 14px', textAlign: 'center', color: 'var(--ink3)' }}>
                      <p style={{ margin: 0, fontSize: 13 }}>No pending invites.</p>
                    </div>
                  ) : (
                    <div style={{ border: '1px solid var(--line)', display: 'grid' }}>
                      {invites.map((inv) => (
                        <div key={inv.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
                          <div style={{ minWidth: 0 }}>
                            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ink)' }}>{inv.email}</p>
                            <p style={{ margin: 0, fontSize: 11.5, color: 'var(--ink3)' }}>
                              Invited as {inv.role} by {inv.invited_by_name} · expires {new Date(inv.expires_at).toLocaleDateString()}
                            </p>
                          </div>
                          <button type="button" onClick={() => handleRevokeInvite(inv)} style={{ fontSize: 12.5, color: 'var(--danger)', background: 'none', border: 0, cursor: 'pointer', flexShrink: 0 }}>
                            Revoke
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}

              <section style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>
                <p style={{ margin: '0 0 12px', fontFamily: 'var(--font-mono-marketing)', fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink3)' }}>Roles</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14 }}>
                  <div style={{ border: '1px solid var(--line)', padding: '14px 16px' }}>
                    <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: 'var(--ink)' }}>Owner</p>
                    <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--ink2)' }}>The team&apos;s creator. Full access everywhere; can&apos;t be changed or removed here.</p>
                  </div>
                  <div style={{ border: '1px solid var(--line)', padding: '14px 16px' }}>
                    <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: 'var(--ink)' }}>Admin</p>
                    <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--ink2)' }}>Acts as Admin on every project owned by this team, and can manage members and invites.</p>
                  </div>
                  <div style={{ border: '1px solid var(--line)', padding: '14px 16px' }}>
                    <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: 'var(--ink)' }}>Member</p>
                    <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--ink2)' }}>On the team roster, but needs to be added to a project individually to work in it.</p>
                  </div>
                </div>
              </section>
            </>
          )}
        </div>
      </main>

      {isInviteOpen && team && (
        <InviteMemberModal
          token={token}
          team={team}
          onClose={() => setIsInviteOpen(false)}
          onInvited={() => {
            setIsInviteOpen(false);
            loadAll();
          }}
        />
      )}
    </div>
  );
}

function InviteMemberModal({
  token,
  team,
  onClose,
  onInvited,
}: {
  token: string | null;
  team: Team;
  onClose: () => void;
  onInvited: () => void;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'MEMBER'>('MEMBER');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!token || !email.trim()) {
      setError('Enter an email address.');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/teams/${team.id}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email: email.trim(), role }),
      });
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).trim();
        throw new Error(detail || `Request failed with status ${res.status}`);
      }
      onInvited();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invite.');
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
        <div>
          <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, color: 'var(--ink)' }}>Invite to {team.name}</p>
          <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--ink2)' }}>Sends an email with a link to join. Expires in 7 days.</p>
        </div>

        <div>
          <label style={fieldLabelStyle}>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@example.com" style={fieldStyle} />
        </div>
        <div>
          <label style={fieldLabelStyle}>Role</label>
          <select value={role} onChange={(e) => setRole(e.target.value as typeof role)} style={{ ...fieldStyle, cursor: 'pointer' }}>
            <option value="MEMBER">Member</option>
            <option value="ADMIN">Admin</option>
          </select>
        </div>

        {error && <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)' }}>{error}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
          <button type="button" onClick={onClose} style={{ height: 34, padding: '0 14px', fontSize: 13, border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink)', cursor: 'pointer' }}>
            Cancel
          </button>
          <button type="button" onClick={handleSubmit} disabled={isSaving} style={{ height: 34, padding: '0 16px', fontSize: 13, fontWeight: 600, background: 'var(--accent)', color: 'var(--on-accent)', border: 0, cursor: isSaving ? 'not-allowed' : 'pointer', opacity: isSaving ? 0.6 : 1 }}>
            {isSaving ? 'Sending…' : 'Send invite'}
          </button>
        </div>
      </div>
    </div>
  );
}

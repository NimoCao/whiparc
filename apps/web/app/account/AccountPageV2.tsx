'use client';

import React, { Suspense, useEffect, useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Icon } from '@iconify/react';
import { useAuthStore } from '../store/useAuthStore';
import ProfileMenu from '../components/ProfileMenu';
import { BlueprintCorners } from '../components/ui/BlueprintCorners';
import { THEME_PALETTES, type Theme } from '../components/ui/theme-palette';
import { spaceGroteskFont, barlowFont, jetBrainsMonoFont } from '../fonts';
import { BrandLogo } from '../components/brand/BrandLogo';
import { buildOAuthLoginUrl } from '../lib/oauthRedirect';
import '../components/ui/blueprint.css';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

function sanitizeAvatarUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return '';
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.toString();
  } catch {
    // Invalid URL; fall through to empty string.
  }
  return '';
}

const cardStyle: CSSProperties = { position: 'relative', background: 'var(--panel)', padding: '20px 22px' };
const h2Style: CSSProperties = { margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16, color: 'var(--ink)' };
const bodyStyle: CSSProperties = { margin: '6px 0 0', fontSize: 13, lineHeight: 1.55, color: 'var(--ink2)' };

interface Identity {
  provider: 'google' | 'github';
  email: string;
  linkedAt: string;
}

const PROVIDER_LABEL: Record<Identity['provider'], { label: string; icon: string }> = {
  google: { label: 'Google', icon: 'flat-color-icons:google' },
  github: { label: 'GitHub', icon: 'mdi:github' },
};

const LINK_ERROR_MESSAGES: Record<string, string> = {
  already_linked: 'That account is already linked to a different Whiparc user.',
  provider_linked: "You already have a different account linked for that provider — unlink it first.",
  link_failed: 'Something went wrong while linking that provider. Please try again.',
};

function AccountContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, token, hasHydrated, logout } = useAuthStore();

  const [theme, setTheme] = useState<Theme>('dark');
  const [hasPassword, setHasPassword] = useState(true);
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<Identity['provider'] | null>(null);
  const [unlinking, setUnlinking] = useState<Identity['provider'] | null>(null);
  const [requestingPassword, setRequestingPassword] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [profileName, setProfileName] = useState('');
  const [profileAvatarUrl, setProfileAvatarUrl] = useState('');
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    if (hasHydrated && !user) router.replace('/login?redirect=/account');
  }, [hasHydrated, user, router]);

  // Re-syncs the editable draft whenever the underlying user record changes
  // (initial load, a fetchMe() refresh filling in avatar_url after mount, or
  // a successful save) — this only ever fires on those real transitions,
  // never on a timer, so it doesn't fight with the user mid-edit.
  useEffect(() => {
    if (!user) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing the edit draft to a real user-record change (load, refresh, save), not a timer
    setProfileName(user.name);
    setProfileAvatarUrl(user.avatar_url);
    setAvatarLoadFailed(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.name, user?.avatar_url]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = profileName.trim();
    if (!trimmedName) {
      setActionError('Name cannot be empty.');
      return;
    }
    setSavingProfile(true);
    setActionError(null);
    const result = await useAuthStore.getState().updateProfile({ name: trimmedName, avatar_url: profileAvatarUrl.trim() });
    setSavingProfile(false);
    if (result.success) {
      setNotice({ kind: 'success', text: 'Profile updated.' });
    } else {
      setActionError(result.error || 'Failed to update profile.');
    }
  };

  const loadIdentities = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/identities`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Failed to load connected identities');
      const data: { hasPassword: boolean; identities: Identity[] } = await res.json();
      setHasPassword(data.hasPassword);
      setIdentities(data.identities);
    } catch {
      setActionError('Could not load your connected identities. Try reloading the page.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, same convention as DashboardV2.fetchData/CredentialManagerModal.fetchCredentials
    void loadIdentities();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    const linked = searchParams.get('linked');
    const linkError = searchParams.get('linkError');
    if (linked) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to a one-time redirect query param, not derived render state
      setNotice({ kind: 'success', text: `${PROVIDER_LABEL[linked as Identity['provider']]?.label ?? linked} connected.` });
      void loadIdentities();
    } else if (linkError) {
      setNotice({ kind: 'error', text: LINK_ERROR_MESSAGES[linkError] ?? 'Something went wrong while linking that provider.' });
    } else {
      return;
    }
    router.replace('/account');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleConnect = async (provider: Identity['provider']) => {
    if (!token) return;
    setConnecting(provider);
    setActionError(null);
    try {
      const res = await fetch(`${API_URL}/api/auth/link-ticket`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to start linking that provider');
      const data: { ticket: string } = await res.json();
      // eslint-disable-next-line react-hooks/immutability -- intentional hard navigation to start the OAuth provider round-trip
      window.location.href = buildOAuthLoginUrl(provider, undefined, data.ticket);
    } catch {
      setConnecting(null);
      setActionError('Could not start connecting that provider. Please try again.');
    }
  };

  const handleUnlink = async (provider: Identity['provider']) => {
    if (!token) return;
    setUnlinking(provider);
    setActionError(null);
    try {
      const res = await fetch(`${API_URL}/api/auth/identities/${provider}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Failed to unlink that provider');
      }
      setIdentities((prev) => prev.filter((i) => i.provider !== provider));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to unlink that provider');
    } finally {
      setUnlinking(null);
    }
  };

  const handleRequestPasswordReset = async () => {
    if (!token) return;
    setRequestingPassword(true);
    setActionError(null);
    try {
      const res = await fetch(`${API_URL}/api/auth/password/request-reset`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to send the link. Please try again.');
      setNotice({ kind: 'success', text: 'Check your email for a link to continue.' });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to send the link. Please try again.');
    } finally {
      setRequestingPassword(false);
    }
  };

  const identityByProvider = useMemo(() => {
    const map = new Map<Identity['provider'], Identity>();
    for (const i of identities) map.set(i.provider, i);
    return map;
  }, [identities]);

  const canUnlink = (provider: Identity['provider']) => hasPassword || identities.length > 1 || !identityByProvider.has(provider);

  const palette = THEME_PALETTES[theme];
  const rootVars = useMemo(
    () => ({ ...palette, background: palette['--ground'], color: palette['--ink'] }) as CSSProperties,
    [palette]
  );

  if (!hasHydrated || !user) {
    return <div style={{ minHeight: '100vh', background: '#0b0c0f' }} />;
  }

  return (
    <div
      className={`${spaceGroteskFont.variable} ${barlowFont.variable} ${jetBrainsMonoFont.variable}`}
      style={{ ...rootVars, minHeight: '100vh', fontFamily: 'var(--font-body-marketing), system-ui, sans-serif', transition: 'background .3s ease, color .3s ease' }}
    >
      <header style={{ height: 56, display: 'flex', alignItems: 'center', gap: 16, padding: '0 clamp(16px,3vw,28px)', borderBottom: '1px solid var(--line)', position: 'sticky', top: 0, background: 'var(--ground)', zIndex: 20 }}>
        <Link href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: 9, flex: 'none' }}>
          <BrandLogo size={24} style={{ color: 'var(--ink)' }} />
          <span style={{ fontFamily: 'var(--font-mono-marketing)', fontSize: 10, color: 'var(--ink3)', borderLeft: '1px solid var(--line)', paddingLeft: 10, marginLeft: 2 }}>account</span>
        </Link>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
            title="Toggle theme"
            className="wp-docs-iconbtn"
            style={{ width: 30, height: 30, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink2)', cursor: 'pointer' }}
          >
            <Icon icon={theme === 'light' ? 'lucide:moon' : 'lucide:sun'} width={14} />
          </button>
          <Link
            href="/dashboard"
            style={{ height: 30, padding: '0 13px', display: 'flex', alignItems: 'center', fontSize: 13, fontWeight: 500, background: 'var(--accent)', color: 'var(--on-accent)', border: 0 }}
          >
            Dashboard
          </Link>
          <ProfileMenu blueprint />
        </div>
      </header>

      <div style={{ maxWidth: 640, margin: '0 auto', padding: '32px clamp(16px,3vw,28px) 64px', display: 'grid', gap: 20 }}>
        <div>
          <p style={{ margin: 0, fontFamily: 'var(--font-mono-marketing)', fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--accent-ink)' }}>Account</p>
          <h1 style={{ margin: '6px 0 0', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(24px,3vw,30px)', color: 'var(--ink)' }}>Security & Connected Identities</h1>
        </div>

        {notice && (
          <div
            style={{
              padding: '10px 14px',
              fontSize: 13,
              border: `1px solid ${notice.kind === 'success' ? 'var(--success)' : 'var(--danger)'}`,
              color: notice.kind === 'success' ? 'var(--success)' : 'var(--danger)',
            }}
          >
            {notice.text}
          </div>
        )}
        {actionError && (
          <div style={{ padding: '10px 14px', fontSize: 13, border: '1px solid var(--danger)', color: 'var(--danger)' }}>{actionError}</div>
        )}

        <div className="wp-blueprint" style={cardStyle}>
          <BlueprintCorners />
          <h2 style={h2Style}>Profile</h2>
          <p style={bodyStyle}>{user.email} — your sign-in email can&apos;t be changed here.</p>

          <form onSubmit={handleSaveProfile} style={{ marginTop: 16, display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            <div
              style={{
                width: 56,
                height: 56,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
                fontWeight: 700,
                textTransform: 'uppercase',
                fontFamily: 'var(--font-display, inherit)',
                background: 'var(--accent)',
                color: 'var(--on-accent)',
                overflow: 'hidden',
              }}
            >
              {profileAvatarUrl && !avatarLoadFailed ? (
                // eslint-disable-next-line @next/next/no-img-element -- an arbitrary externally-pasted URL, not an optimizable local/remote asset Next's Image loader is configured for
                <img
                  src={sanitizeAvatarUrl(profileAvatarUrl)}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={() => setAvatarLoadFailed(true)}
                />
              ) : (
                (profileName || user.name).slice(0, 2)
              )}
            </div>

            <div style={{ flex: 1, display: 'grid', gap: 12 }}>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontFamily: 'var(--font-mono-marketing)', fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink2)' }}>Name</span>
                <input
                  type="text"
                  required
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  placeholder="Priya Raghavan"
                  style={{ height: 36, padding: '0 10px', border: '1px solid var(--line)', background: 'var(--elevated)', color: 'var(--ink)', fontSize: 13.5, fontFamily: 'var(--font-body-marketing), sans-serif', outline: 'none' }}
                />
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontFamily: 'var(--font-mono-marketing)', fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink2)' }}>Avatar URL</span>
                <input
                  type="url"
                  value={profileAvatarUrl}
                  onChange={(e) => {
                    setProfileAvatarUrl(sanitizeAvatarUrl(e.target.value));
                    setAvatarLoadFailed(false);
                  }}
                  placeholder="https://example.com/photo.jpg"
                  style={{ height: 36, padding: '0 10px', border: '1px solid var(--line)', background: 'var(--elevated)', color: 'var(--ink)', fontSize: 13.5, fontFamily: 'var(--font-body-marketing), sans-serif', outline: 'none' }}
                />
              </label>

              <button
                type="submit"
                disabled={savingProfile}
                className="wp-blueprint"
                style={{ position: 'relative', height: 34, padding: '0 14px', fontSize: 12.5, fontWeight: 500, background: 'var(--accent)', color: 'var(--on-accent)', border: 0, cursor: savingProfile ? 'default' : 'pointer', opacity: savingProfile ? 0.7 : 1, justifySelf: 'start' }}
              >
                <BlueprintCorners />
                {savingProfile ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        </div>

        <div className="wp-blueprint" style={cardStyle}>
          <BlueprintCorners />
          <h2 style={h2Style}>Connected identities</h2>
          <p style={bodyStyle}>Link Google or GitHub so you can sign in either way, or disconnect one you no longer use.</p>

          <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
            {loading ? (
              <p style={{ fontSize: 13, color: 'var(--ink3)' }}>Loading…</p>
            ) : (
              (['google', 'github'] as const).map((provider) => {
                const identity = identityByProvider.get(provider);
                const meta = PROVIDER_LABEL[provider];
                return (
                  <div key={provider} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid var(--line)', padding: '10px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Icon icon={meta.icon} width={18} />
                      <div>
                        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ink)' }}>{meta.label}</p>
                        <p style={{ margin: '2px 0 0', fontSize: 11.5, color: 'var(--ink3)' }}>{identity ? `Connected as ${identity.email}` : 'Not connected'}</p>
                      </div>
                    </div>
                    {identity ? (
                      <button
                        type="button"
                        onClick={() => handleUnlink(provider)}
                        disabled={unlinking === provider || !canUnlink(provider)}
                        title={!canUnlink(provider) ? "Can't remove your last sign-in method" : undefined}
                        style={{ height: 30, padding: '0 12px', fontSize: 12.5, border: '1px solid var(--line)', background: 'transparent', color: canUnlink(provider) ? 'var(--danger)' : 'var(--ink3)', cursor: canUnlink(provider) ? 'pointer' : 'not-allowed' }}
                      >
                        {unlinking === provider ? 'Unlinking…' : 'Unlink'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleConnect(provider)}
                        disabled={connecting === provider}
                        style={{ height: 30, padding: '0 12px', fontSize: 12.5, border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink)', cursor: 'pointer' }}
                      >
                        {connecting === provider ? 'Connecting…' : 'Connect'}
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="wp-blueprint" style={cardStyle}>
          <BlueprintCorners />
          <h2 style={h2Style}>Password</h2>
          <p style={bodyStyle}>
            {hasPassword
              ? "We'll email you a link to set a new password."
              : 'Your account currently signs in via Google or GitHub only. Set a password to also sign in that way.'}
          </p>
          <button
            type="button"
            onClick={handleRequestPasswordReset}
            disabled={requestingPassword}
            className="wp-blueprint"
            style={{ position: 'relative', marginTop: 14, height: 36, padding: '0 16px', fontSize: 13, fontWeight: 500, background: 'var(--accent)', color: 'var(--on-accent)', border: 0, cursor: 'pointer' }}
          >
            <BlueprintCorners />
            {requestingPassword ? 'Sending…' : hasPassword ? 'Change password' : 'Set a password'}
          </button>
        </div>

        <div className="wp-blueprint" style={cardStyle}>
          <BlueprintCorners />
          <h2 style={{ ...h2Style, color: 'var(--danger)' }}>Sign out</h2>
          <p style={bodyStyle}>Sign out of Whiparc on this device.</p>
          <button
            type="button"
            onClick={() => {
              logout();
              router.push('/');
            }}
            style={{ marginTop: 14, height: 36, padding: '0 16px', fontSize: 13, fontWeight: 500, background: 'transparent', color: 'var(--danger)', border: '1px solid var(--danger)', cursor: 'pointer' }}
          >
            Logout
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AccountPageV2() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: '#0b0c0f' }} />}>
      <AccountContent />
    </Suspense>
  );
}

'use client';

import React, { useEffect, useState, useMemo, Suspense, type CSSProperties } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@iconify/react';
import { useAuthStore } from '../store/useAuthStore';
import { spaceGroteskFont, barlowFont, jetBrainsMonoFont } from '../fonts';
import { BlueprintCorners } from '../components/ui/BlueprintCorners';
import { THEME_PALETTES, type Theme } from '../components/ui/theme-palette';
import { BrandLogo } from '../components/brand/BrandLogo';
import '../components/ui/blueprint.css';
import '../login/login.css';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

const labelStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-marketing)',
  fontSize: 10,
  letterSpacing: '.1em',
  textTransform: 'uppercase',
  color: 'var(--ink2)',
};

const inputStyle: CSSProperties = {
  height: 42,
  padding: '0 13px',
  border: '1px solid var(--line)',
  background: 'var(--elevated)',
  color: 'var(--ink)',
  fontSize: 14,
  fontFamily: 'var(--font-body-marketing), sans-serif',
  outline: 'none',
};

function PageShell({ theme, onToggleTheme, children }: { theme: Theme; onToggleTheme: () => void; children: React.ReactNode }) {
  const palette = THEME_PALETTES[theme];
  const rootVars = useMemo(
    () => ({ ...palette, background: palette['--ground'], color: palette['--ink'] }) as CSSProperties,
    [palette]
  );

  return (
    <div
      className={`${spaceGroteskFont.variable} ${barlowFont.variable} ${jetBrainsMonoFont.variable}`}
      style={{
        ...rootVars,
        minHeight: '100vh',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: 'background .3s ease, color .3s ease',
        fontFamily: 'var(--font-body-marketing), system-ui, sans-serif',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: '-10% -2% 0',
          backgroundImage: 'linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px)',
          backgroundSize: '74px 74px',
          opacity: 0.5,
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: 620,
          height: 620,
          left: '50%',
          top: '40%',
          transform: 'translate(-50%,-50%)',
          background: 'radial-gradient(circle,var(--accent) 0%,transparent 70%)',
          opacity: 0.14,
          pointerEvents: 'none',
        }}
      />

      <header style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px clamp(20px,4vw,40px)' }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <BrandLogo size={26} style={{ color: 'var(--ink)' }} />
        </Link>
        <button
          type="button"
          onClick={onToggleTheme}
          title="Toggle theme"
          className="wp-login-theme-btn"
          style={{ width: 32, height: 32, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink2)', cursor: 'pointer' }}
        >
          <Icon icon={theme === 'light' ? 'lucide:moon' : 'lucide:sun'} width={15} />
        </button>
      </header>

      <main style={{ position: 'relative', zIndex: 1, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px 20px 64px' }}>
        <div className="wp-blueprint" style={{ position: 'relative', width: '100%', maxWidth: 416, background: 'var(--panel)', padding: 'clamp(28px,4vw,36px) clamp(24px,4vw,32px)' }}>
          <BlueprintCorners />
          {children}
        </div>
      </main>
    </div>
  );
}

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const { setSessionFromToken } = useAuthStore();

  const [theme, setTheme] = useState<Theme>('dark');
  const [checking, setChecking] = useState(true);
  const [valid, setValid] = useState(false);
  const [hasPassword, setHasPassword] = useState(true);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- no token to check, same idle-state pattern as verify-email's status effect
      setChecking(false);
      return;
    }
    let cancelled = false;
    fetch(`${API_URL}/api/auth/reset/check/${encodeURIComponent(token)}`)
      .then((res) => (res.ok ? res.json() : { valid: false }))
      .then((data: { valid: boolean; hasPassword?: boolean }) => {
        if (cancelled) return;
        setValid(data.valid);
        setHasPassword(data.hasPassword ?? true);
        setChecking(false);
      })
      .catch(() => {
        if (!cancelled) {
          setValid(false);
          setChecking(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Mirrors the API's password policy (apps/api/password_policy.go), which
    // is the authority — this just avoids a round trip for the obvious case.
    if (Array.from(password).length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || 'Failed to reset password.');
      }
      const data: { token: string } = await res.json();
      setSessionFromToken(data.token);
      router.push('/dashboard');
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof Error ? err.message : 'Failed to reset password.');
    }
  };

  const heading = hasPassword ? 'Reset your password' : 'Set a password';
  const toggleTheme = () => setTheme((t) => (t === 'light' ? 'dark' : 'light'));

  if (checking) {
    return (
      <PageShell theme={theme} onToggleTheme={toggleTheme}>
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <Icon icon="lucide:loader-2" className="animate-spin" width={28} style={{ color: 'var(--accent-ink)' }} />
          <p style={{ margin: '14px 0 0', fontSize: 13.5, color: 'var(--ink2)' }}>Checking your link...</p>
        </div>
      </PageShell>
    );
  }

  if (!token || !valid) {
    return (
      <PageShell theme={theme} onToggleTheme={toggleTheme}>
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.01em', color: 'var(--ink)' }}>Link invalid or expired</h1>
          <p style={{ margin: '8px 0 0', fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink2)' }}>This password link is no longer valid. Request a new one below.</p>
        </div>
        <Link
          href="/forgot-password"
          className="wp-blueprint wp-login-submit"
          style={{
            position: 'relative',
            marginTop: 22,
            height: 44,
            background: 'var(--accent)',
            color: 'var(--on-accent)',
            border: 0,
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            fontSize: 14.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <BlueprintCorners />
          Request a new link
        </Link>
      </PageShell>
    );
  }

  return (
    <PageShell theme={theme} onToggleTheme={toggleTheme}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.01em', color: 'var(--ink)' }}>{heading}</h1>
        <p style={{ margin: '8px 0 0', fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink2)' }}>
          {hasPassword ? 'Choose a new password for your account.' : 'Your account currently signs in via Google or GitHub only — set a password to also sign in that way.'}
        </p>
      </div>

      {error && (
        <div style={{ marginTop: 20, display: 'flex', gap: 10, padding: '11px 13px', border: '1px solid var(--danger)', background: 'color-mix(in srgb, var(--danger) 14%, transparent)' }}>
          <Icon icon="lucide:alert-circle" width={15} style={{ flexShrink: 0, marginTop: 1, color: 'var(--danger)' }} />
          <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink)' }}>{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ marginTop: 22, display: 'grid', gap: 14 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={labelStyle}>New password</span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            minLength={8}
            autoComplete="new-password"
            className="wp-login-input"
            style={inputStyle}
          />
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={labelStyle}>Confirm password</span>
          <input
            type="password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
            className="wp-login-input"
            style={inputStyle}
          />
        </label>

        <button
          type="submit"
          disabled={submitting}
          className="wp-blueprint wp-login-submit"
          style={{
            position: 'relative',
            marginTop: 6,
            height: 44,
            background: 'var(--accent)',
            color: 'var(--on-accent)',
            border: 0,
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            fontSize: 14.5,
            cursor: submitting ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: submitting ? 0.7 : 1,
          }}
        >
          <BlueprintCorners />
          {submitting ? <Icon icon="lucide:loader-2" className="animate-spin" width={16} /> : hasPassword ? 'Reset password' : 'Set password'}
        </button>
      </form>
    </PageShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: '#0b0c0f' }} />}>
      <ResetPasswordContent />
    </Suspense>
  );
}

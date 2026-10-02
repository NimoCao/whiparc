'use client';

import React, { useState, useMemo, type CSSProperties } from 'react';
import Link from 'next/link';
import { Icon } from '@iconify/react';
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

export default function ForgotPasswordPage() {
  const [theme, setTheme] = useState<Theme>('dark');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmed = email.trim();
    if (!trimmed) {
      setError('Please enter your email address.');
      return;
    }

    setStatus('loading');
    try {
      const res = await fetch(`${API_URL}/api/auth/forgot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      });
      // The backend always responds 200 here regardless of whether the
      // email matched an account, so this branch is really just a network
      // failure, not a "no account found" case.
      if (!res.ok) throw new Error('Something went wrong. Please try again.');
      setStatus('sent');
    } catch (err) {
      setStatus('idle');
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    }
  };

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
          onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
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

          {status === 'sent' ? (
            <>
              <div style={{ textAlign: 'center' }}>
                <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.01em', color: 'var(--ink)' }}>Check your email</h1>
                <p style={{ margin: '8px 0 0', fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink2)' }}>
                  If an account exists for <strong style={{ color: 'var(--ink)' }}>{email.trim()}</strong>, we&apos;ve sent a link to reset or set your password. It expires in 1 hour.
                </p>
              </div>

              <p style={{ textAlign: 'center', margin: '22px 0 0', fontSize: 13, color: 'var(--ink2)' }}>
                <Link href="/login" className="wp-login-switch" style={{ color: 'var(--accent-ink)', fontWeight: 600 }}>
                  Back to sign in
                </Link>
              </p>
            </>
          ) : (
            <>
              <div style={{ textAlign: 'center' }}>
                <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.01em', color: 'var(--ink)' }}>Forgot your password?</h1>
                <p style={{ margin: '8px 0 0', fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink2)' }}>
                  Enter your email and we&apos;ll send you a link to reset it.
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
                  <span style={labelStyle}>Email address</span>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="wp-login-input"
                    style={inputStyle}
                  />
                </label>

                <button
                  type="submit"
                  disabled={status === 'loading'}
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
                    cursor: status === 'loading' ? 'default' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: status === 'loading' ? 0.7 : 1,
                  }}
                >
                  <BlueprintCorners />
                  {status === 'loading' ? <Icon icon="lucide:loader-2" className="animate-spin" width={16} /> : 'Send reset link'}
                </button>
              </form>

              <p style={{ textAlign: 'center', margin: '22px 0 0', fontSize: 13, color: 'var(--ink2)' }}>
                <Link href="/login" className="wp-login-switch" style={{ color: 'var(--accent-ink)', fontWeight: 600 }}>
                  Back to sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

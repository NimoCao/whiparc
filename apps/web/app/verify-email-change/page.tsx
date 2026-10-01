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

function VerifyEmailChangeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token');
  const { confirmEmailChange } = useAuthStore();

  const [theme, setTheme] = useState<Theme>('dark');
  const [status, setStatus] = useState<'confirming' | 'success' | 'error'>('confirming');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- no token to check, same idle-state pattern as verify-email's status effect
      setStatus('error');
      setErrorMessage('This link is missing a token.');
      return;
    }

    let isMounted = true;
    (async () => {
      const result = await confirmEmailChange(token);
      if (!isMounted) return;
      if (result.success) {
        setNewEmail(result.email ?? null);
        setStatus('success');
      } else {
        setStatus('error');
        setErrorMessage(result.error || 'This link is invalid or has expired.');
      }
    })();
    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const toggleTheme = () => setTheme((t) => (t === 'light' ? 'dark' : 'light'));

  return (
    <PageShell theme={theme} onToggleTheme={toggleTheme}>
      {status === 'confirming' && (
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <Icon icon="lucide:loader-2" className="animate-spin" width={28} style={{ color: 'var(--accent-ink)' }} />
          <p style={{ margin: '14px 0 0', fontSize: 13.5, color: 'var(--ink2)' }}>Confirming your new email...</p>
        </div>
      )}

      {status === 'success' && (
        <>
          <div style={{ textAlign: 'center' }}>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.01em', color: 'var(--ink)' }}>Email updated!</h1>
            <p style={{ margin: '8px 0 0', fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink2)' }}>
              {newEmail ? (
                <>Your account now signs in with <strong style={{ color: 'var(--ink)' }}>{newEmail}</strong>.</>
              ) : (
                'Your account email has been updated.'
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => router.push('/account')}
            className="wp-blueprint wp-login-submit"
            style={{
              position: 'relative',
              marginTop: 22,
              height: 44,
              width: '100%',
              background: 'var(--accent)',
              color: 'var(--on-accent)',
              border: 0,
              fontFamily: 'var(--font-display)',
              fontWeight: 600,
              fontSize: 14.5,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <BlueprintCorners />
            Back to Account
            <Icon icon="lucide:arrow-right" width={15} />
          </button>
        </>
      )}

      {status === 'error' && (
        <>
          <div style={{ textAlign: 'center' }}>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.01em', color: 'var(--ink)' }}>Confirmation failed</h1>
          </div>
          <div style={{ marginTop: 20, display: 'flex', gap: 10, padding: '11px 13px', border: '1px solid var(--danger)', background: 'color-mix(in srgb, var(--danger) 14%, transparent)' }}>
            <Icon icon="lucide:alert-circle" width={15} style={{ flexShrink: 0, marginTop: 1, color: 'var(--danger)' }} />
            <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink)' }}>{errorMessage}</p>
          </div>
          <Link
            href="/account"
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
            Back to Account
          </Link>
        </>
      )}
    </PageShell>
  );
}

export default function VerifyEmailChangePage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: '#0b0c0f' }} />}>
      <VerifyEmailChangeContent />
    </Suspense>
  );
}

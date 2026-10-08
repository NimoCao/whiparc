'use client';

import React, { useState, useEffect, useMemo, type CSSProperties } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@iconify/react';
import { useAuthStore } from '../store/useAuthStore';
import { spaceGroteskFont, barlowFont, jetBrainsMonoFont } from '../fonts';
import { BlueprintCorners } from '../components/ui/BlueprintCorners';
import { THEME_PALETTES, type Theme } from '../components/ui/theme-palette';
import { BrandLogo } from '../components/brand/BrandLogo';
import { buildOAuthLoginUrl, resolvePostAuthPath } from '../lib/oauthRedirect';
import '../components/ui/blueprint.css';
import './login.css';

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

export function LoginPageV2() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, signup, isLoading, error, clearError } = useAuthStore();

  const [theme, setTheme] = useState<Theme>('dark');
  const [email, setEmail] = useState(() => searchParams.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  // The sign-in/sign-up mode toggle below navigates via a plain router.push
  // of a hardcoded '/login' or '/login?mode=signup' — without this, that
  // silently drops a `redirect` param (e.g. from the /templates "Get
  // Started" flow) the moment someone switches modes on this page.
  const withRedirect = (path: string) => {
    const redirect = searchParams.get('redirect');
    if (!redirect) return path;
    return `${path}${path.includes('?') ? '&' : '?'}redirect=${encodeURIComponent(redirect)}`;
  };

  // Both are plain functions of the URL, so they are derived on render rather
  // than mirrored into state by an effect.
  const isSignUp = searchParams.get('mode') === 'signup';
  // Informational (non-error) notice passed via redirect, e.g. after a signup
  // attempt on an already-registered email bounces here.
  const notice =
    searchParams.get('notice') === 'exists'
      ? 'You already have an account with this email — sign in below.'
      : null;

  // Navigating between login/signup (or arriving with a new email/notice) is a
  // fresh start for the form: drop the previous attempt's error and let any
  // flow that already knows the address (an invite link, the already-registered
  // bounce above) prefill it. Adjusted during render, keyed on the query string
  // — https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const paramsKey = searchParams.toString();
  const [seenParamsKey, setSeenParamsKey] = useState(paramsKey);
  if (paramsKey !== seenParamsKey) {
    setSeenParamsKey(paramsKey);
    setFormError(null);
    const prefillEmail = searchParams.get('email');
    if (prefillEmail) setEmail(prefillEmail);
  }

  useEffect(() => {
    clearError();
  }, [searchParams, clearError]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const emailTrimmed = email.trim();
    const nameTrimmed = name.trim();

    if (!emailTrimmed || !password) {
      setFormError('Please fill in all fields.');
      return;
    }
    if (isSignUp && !nameTrimmed) {
      setFormError('Please enter your full name.');
      return;
    }
    // Mirrors the API's password policy (apps/api/password_policy.go), which
    // is the authority — this just avoids a round trip for the obvious case.
    if (isSignUp && Array.from(password).length < 8) {
      setFormError('Password must be at least 8 characters.');
      return;
    }

    let success = false;
    if (isSignUp) {
      success = await signup(nameTrimmed, emailTrimmed, password);
      if (!success && useAuthStore.getState().signupEmailExists) {
        // Already registered — send them to sign in with a friendly notice
        // instead of showing an error on the signup form.
        router.push(withRedirect(`/login?mode=login&notice=exists&email=${encodeURIComponent(emailTrimmed)}`));
        return;
      }
    } else {
      success = await login(emailTrimmed, password);
    }

    if (success) await continueAfterAuth();
  };

  // Resumes whatever the user was trying to do before being sent here —
  // shared with the OAuth callback page so this continuation (including the
  // /templates/{id} fork special case) works the same way regardless of
  // which sign-in path was used.
  const continueAfterAuth = async () => {
    const redirect = searchParams.get('redirect');
    const token = useAuthStore.getState().token ?? '';
    router.push(await resolvePostAuthPath(redirect, token));
  };

  const toggleMode = () => router.push(withRedirect(isSignUp ? '/login' : '/login?mode=signup'));

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

  const notification = error || formError;

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

          <div style={{ textAlign: 'center' }}>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.01em', color: 'var(--ink)' }}>
              {isSignUp ? 'Create your account' : 'Welcome back'}
            </h1>
            <p style={{ margin: '8px 0 0', fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink2)' }}>
              {isSignUp ? 'Join teams shipping infrastructure as diagrams.' : 'Sign in to your workspace.'}
            </p>
          </div>

          {notice && !notification && (
            <div style={{ marginTop: 20, display: 'flex', gap: 10, padding: '11px 13px', border: '1px solid var(--accent)', background: 'color-mix(in srgb, var(--accent) 14%, transparent)' }}>
              <Icon icon="lucide:info" width={15} style={{ flexShrink: 0, marginTop: 1, color: 'var(--accent-ink)' }} />
              <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink)' }}>{notice}</p>
            </div>
          )}

          {notification && (
            <div style={{ marginTop: 20, display: 'flex', gap: 10, padding: '11px 13px', border: '1px solid var(--danger)', background: 'color-mix(in srgb, var(--danger) 14%, transparent)' }}>
              <Icon icon="lucide:alert-circle" width={15} style={{ flexShrink: 0, marginTop: 1, color: 'var(--danger)' }} />
              <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink)' }}>{notification}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ marginTop: 22, display: 'grid', gap: 14 }}>
            {isSignUp && (
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={labelStyle}>Full name</span>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Richard Henricks"
                  className="wp-login-input"
                  style={inputStyle}
                />
              </label>
            )}
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
            <label style={{ display: 'grid', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <span style={labelStyle}>Password</span>
                {!isSignUp && (
                  <Link href="/forgot-password" className="wp-login-forgot" style={{ fontSize: 11.5, color: 'var(--accent-ink)' }}>
                    Forgot?
                  </Link>
                )}
              </div>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isSignUp ? 'At least 8 characters' : '••••••••'}
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                className="wp-login-input"
                style={inputStyle}
              />
            </label>

            <button
              type="submit"
              disabled={isLoading}
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
                cursor: isLoading ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: isLoading ? 0.7 : 1,
              }}
            >
              <BlueprintCorners />
              {isLoading ? <Icon icon="lucide:loader-2" className="animate-spin" width={16} /> : isSignUp ? 'Create account' : 'Sign in'}
            </button>
          </form>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '22px 0' }}>
            <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
            <span style={{ fontFamily: 'var(--font-mono-marketing)', fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink3)' }}>or</span>
            <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <a
              href={buildOAuthLoginUrl('github', searchParams.get('redirect'))}
              className="wp-login-oauth"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 42, border: '1px solid var(--line)', color: 'var(--ink)', fontSize: 13.5 }}
            >
              <Icon icon="mdi:github" width={16} />
              GitHub
            </a>
            <a
              href={buildOAuthLoginUrl('google', searchParams.get('redirect'))}
              className="wp-login-oauth"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 42, border: '1px solid var(--line)', color: 'var(--ink)', fontSize: 13.5 }}
            >
              <Icon icon="flat-color-icons:google" width={16} />
              Google
            </a>
          </div>

          <p style={{ textAlign: 'center', margin: '22px 0 0', fontSize: 13, color: 'var(--ink2)' }}>
            {isSignUp ? 'Already have an account?' : 'New to whiparc?'}{' '}
            <button
              type="button"
              onClick={toggleMode}
              className="wp-login-switch"
              style={{ color: 'var(--accent-ink)', fontWeight: 600, cursor: 'pointer', background: 'none', border: 0, font: 'inherit', padding: 0 }}
            >
              {isSignUp ? 'Sign in' : 'Create account'}
            </button>
          </p>
        </div>
      </main>
    </div>
  );
}

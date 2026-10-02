'use client';

import React, { useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { Icon } from '@iconify/react';
import { spaceGroteskFont, barlowFont, jetBrainsMonoFont } from '../../fonts';
import { BlueprintCorners } from './BlueprintCorners';
import { THEME_PALETTES, type Theme } from './theme-palette';
import { BrandLogo } from '../brand/BrandLogo';
import './blueprint.css';
import '../../login/login.css';

// Shared chrome for the standalone token-landing pages (verify-email,
// invites/accept, and any future "click the link in your email" page): the
// same grid-line background, accent glow, brand header, and blueprint card
// /login uses, so these pages stop looking like a different product.
export function AuthPageShell({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark');
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
          {children}
        </div>
      </main>
    </div>
  );
}

export function AuthSpinner({ label }: { label: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '20px 0' }}>
      <Icon icon="lucide:loader-2" className="animate-spin" width={28} style={{ color: 'var(--accent-ink)' }} />
      <p style={{ margin: '14px 0 0', fontSize: 13.5, color: 'var(--ink2)' }}>{label}</p>
    </div>
  );
}

export function AuthHeading({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, letterSpacing: '-.01em', color: 'var(--ink)' }}>{title}</h1>
      {children && <p style={{ margin: '8px 0 0', fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink2)' }}>{children}</p>}
    </div>
  );
}

export function AuthNotice({ tone, children }: { tone: 'error' | 'success'; children: React.ReactNode }) {
  const color = tone === 'error' ? 'var(--danger)' : 'var(--success)';
  return (
    <div style={{ marginTop: 20, display: 'flex', gap: 10, padding: '11px 13px', border: `1px solid ${color}`, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
      <Icon icon={tone === 'error' ? 'lucide:alert-circle' : 'lucide:check-circle-2'} width={15} style={{ flexShrink: 0, marginTop: 1, color }} />
      <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink)' }}>{children}</p>
    </div>
  );
}

const primaryStyle: CSSProperties = {
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
};

export function AuthPrimaryButton({
  children,
  href,
  onClick,
  disabled,
  arrow,
}: {
  children: React.ReactNode;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  arrow?: boolean;
}) {
  const inner = (
    <>
      <BlueprintCorners />
      {children}
      {arrow && <Icon icon="lucide:arrow-right" width={15} />}
    </>
  );
  if (href) {
    return (
      <Link href={href} className="wp-blueprint wp-login-submit" style={primaryStyle}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="wp-blueprint wp-login-submit" style={{ ...primaryStyle, opacity: disabled ? 0.6 : 1, cursor: disabled ? 'default' : 'pointer' }}>
      {inner}
    </button>
  );
}

const secondaryStyle: CSSProperties = {
  marginTop: 12,
  height: 40,
  width: '100%',
  background: 'transparent',
  color: 'var(--ink)',
  border: '1px solid var(--line)',
  fontSize: 13.5,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

export function AuthSecondaryButton({ children, href, onClick }: { children: React.ReactNode; href?: string; onClick?: () => void }) {
  if (href) {
    return (
      <Link href={href} style={secondaryStyle}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} style={secondaryStyle}>
      {children}
    </button>
  );
}

export function AuthTextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} style={{ display: 'block', textAlign: 'center', marginTop: 16, fontSize: 12.5, color: 'var(--ink3)' }}>
      {children}
    </Link>
  );
}

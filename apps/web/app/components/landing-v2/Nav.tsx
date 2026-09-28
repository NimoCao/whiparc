import Link from 'next/link';
import { Icon } from '@iconify/react';
import type { ThemeMode } from './palette';
import { useMarketingCta } from './useMarketingCta';
import { BrandLogo } from '../brand/BrandLogo';

const NAV_LINKS = [
  { label: 'How it works', href: '#how' },
  { label: 'Limits', href: '#rough' },
  { label: 'Templates', href: '/templates' },
  { label: 'Pricing', href: '#pricing' },
];

const SEGMENTS: { key: ThemeMode; label: string }[] = [
  { key: 'scroll', label: 'AUTO' },
  { key: 'dark', label: 'DARK' },
  { key: 'light', label: 'LIGHT' },
];

export function Nav({ mode, setMode }: { mode: ThemeMode; setMode: (m: ThemeMode) => void }) {
  const { startHref } = useMarketingCta();

  return (
    <div
      data-nav
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 60,
        background: 'rgba(16,17,20,.82)',
        backdropFilter: 'blur(14px)',
        borderBottom: '1px solid #2A2C33',
        color: '#FFFFFF',
      }}
    >
      <div
        style={{
          maxWidth: 1240,
          margin: '0 auto',
          padding: '0 clamp(16px,4vw,44px)',
          height: 66,
          display: 'flex',
          alignItems: 'center',
          gap: 'clamp(14px,2.5vw,34px)',
        }}
      >
        <a href="#top" style={{ display: 'flex', alignItems: 'center', gap: 9, flexShrink: 0, whiteSpace: 'nowrap' }}>
          <BrandLogo size={28} />
        </a>

        <div
          data-navlinks
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'clamp(12px,1.8vw,26px)',
            fontFamily: 'var(--font-mono-marketing)',
            fontSize: 11,
            letterSpacing: '.1em',
            textTransform: 'uppercase',
            marginLeft: 'auto',
            overflow: 'hidden',
          }}
        >
          {NAV_LINKS.map((link) =>
            link.href.startsWith('/') ? (
              <Link key={link.href} href={link.href} style={{ whiteSpace: 'nowrap', opacity: 0.72 }}>
                {link.label}
              </Link>
            ) : (
              <a key={link.href} href={link.href} style={{ whiteSpace: 'nowrap', opacity: 0.72 }}>
                {link.label}
              </a>
            )
          )}
        </div>

        <div
          data-seg
          style={{
            display: 'flex',
            alignItems: 'center',
            border: '1px solid var(--line)',
            flexShrink: 0,
            fontFamily: 'var(--font-mono-marketing)',
            fontSize: 9,
            letterSpacing: '.12em',
          }}
        >
          {SEGMENTS.map((seg, i) => (
            <button
              key={seg.key}
              data-seg-btn={seg.key}
              onClick={() => setMode(seg.key)}
              aria-pressed={mode === seg.key}
              style={{
                appearance: 'none',
                background: 'transparent',
                border: 0,
                borderLeft: i > 0 ? '1px solid currentColor' : undefined,
                color: 'inherit',
                font: 'inherit',
                padding: '6px 8px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {seg.label}
            </button>
          ))}
        </div>

        <a
          data-gh
          href="https://github.com/whiparc/whiparc"
          target="_blank"
          rel="noopener"
          title="Star whiparc on GitHub"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            flexShrink: 0,
            border: '1px solid var(--line)',
            color: 'var(--ink)',
            padding: '8px 12px',
            whiteSpace: 'nowrap',
          }}
        >
          <Icon icon="simple-icons:github" width={15} />
          <Icon icon="lucide:star" width={12} style={{ opacity: 0.7 }} />
        </a>

        <Link
          href={startHref}
          data-cta
          style={{
            flexShrink: 0,
            background: '#FF6A3D',
            color: '#101114',
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            fontSize: 13,
            padding: '9px 16px',
            whiteSpace: 'nowrap',
          }}
        >
          Start free
        </Link>
      </div>
    </div>
  );
}

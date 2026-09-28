import Link from 'next/link';
import { Icon } from '@iconify/react';
import { Seam } from './Seam';
import { useMarketingCta } from './useMarketingCta';
import { BrandLogo } from '../brand/BrandLogo';

export function Footer() {
  const { startHref } = useMarketingCta();

  return (
    <section
      data-band="light"
      style={{ position: 'relative', minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', boxSizing: 'border-box', background: 'var(--ground)', color: 'var(--ink)', padding: 'clamp(48px,6vw,84px) clamp(16px,4vw,44px) clamp(32px,4vw,52px)' }}
    >
      <Seam pair="dark:light" />
      <div style={{ maxWidth: 1240, margin: '0 auto' }}>
        <div data-reveal style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, borderBottom: '1px solid var(--line)', paddingBottom: 'clamp(28px,3.4vw,44px)' }}>
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 600,
              fontSize: 'clamp(26px,3.6vw,46px)',
              lineHeight: 1.02,
              letterSpacing: '-.03em',
              margin: 0,
              maxWidth: '22em',
              color: 'var(--ink)',
            }}
          >
            Draw your stack. See the code it makes. Decide then.
          </h2>
          <Link
            href={startHref}
            style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'var(--accent)', color: 'var(--on-accent)', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, padding: '14px 24px', whiteSpace: 'nowrap' }}
          >
            <span>Open the canvas</span>
            <Icon icon="lucide:arrow-right" width={16} />
          </Link>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '18px 40px', justifyContent: 'space-between', paddingTop: 22, fontFamily: 'var(--font-mono-marketing)', fontSize: 11, letterSpacing: '.08em', color: 'var(--ink2)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px', alignItems: 'center' }}>
            <BrandLogo size={20} style={{ color: 'var(--ink)' }} />
            <span style={{ whiteSpace: 'nowrap' }}>open source infrastructure compiler</span>
            <span style={{ whiteSpace: 'nowrap', opacity: 0.8 }}>© 2026 whiparc</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }}>
            <Link href="/docs" style={{ whiteSpace: 'nowrap' }}>
              Docs
            </Link>
            <Link href="/templates" style={{ whiteSpace: 'nowrap' }}>
              Templates
            </Link>
            <a href="#rough" style={{ whiteSpace: 'nowrap' }}>
              Limits
            </a>
            <a href="#pricing" style={{ whiteSpace: 'nowrap' }}>
              Pricing
            </a>
            <a href="https://github.com/whiparc/whiparc" target="_blank" rel="noopener" style={{ whiteSpace: 'nowrap' }}>
              GitHub
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

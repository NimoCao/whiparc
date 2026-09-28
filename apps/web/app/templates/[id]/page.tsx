'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@iconify/react';
import { TemplateDetailContent } from '../../components/TemplateDetailContent';
import { THEME_PALETTES, type Theme } from '../../components/ui/theme-palette';
import { spaceGroteskFont, barlowFont, jetBrainsMonoFont } from '../../fonts';
import '../../components/ui/blueprint.css';
import '../templates.css';

// Standalone, directly-navigable /templates/{id} page — a minimal single
// header bar (back-chevron + breadcrumb), matching export-code's standalone
// page rather than the catalog's full dashboard shell, since this is a
// deep-link/hard-refresh landing spot, not a primary nav destination.
// Rendered on a hard navigation / shared link / search-engine crawl.
// Clicking a card from /templates instead intercepts to the popup version
// at app/@modal/(.)templates/[id]/page.tsx, which renders the exact same
// TemplateDetailContent inside TemplateModal. See product-memory 10.1.
export default function TemplateDetailPage() {
  const params = useParams<{ id: string }>();
  const [theme, setTheme] = useState<Theme>('dark');

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
      style={{ ...rootVars, minHeight: '100vh', fontFamily: 'var(--font-body-marketing), system-ui, sans-serif', transition: 'background .3s ease, color .3s ease' }}
    >
      <header style={{ height: 56, display: 'flex', alignItems: 'center', gap: 14, padding: '0 clamp(16px,3vw,28px)', borderBottom: '1px solid var(--line)', position: 'sticky', top: 0, background: 'var(--ground)', zIndex: 20 }}>
        <Link href="/templates" className="wp-templates-iconbtn" style={{ display: 'flex', alignItems: 'center', color: 'var(--ink2)' }} title="Back to Templates">
          <Icon icon="lucide:arrow-left" width={15} />
        </Link>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>Templates</span>
        <button
          type="button"
          onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
          title="Toggle theme"
          className="wp-templates-iconbtn"
          style={{ marginLeft: 'auto', width: 30, height: 30, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink2)', cursor: 'pointer' }}
        >
          <Icon icon={theme === 'light' ? 'lucide:moon' : 'lucide:sun'} width={14} />
        </button>
      </header>

      <main style={{ maxWidth: 900, margin: '0 auto', padding: 'clamp(24px,4vw,40px) clamp(16px,3vw,28px) 64px' }}>
        <TemplateDetailContent id={params.id} variant="page" />
      </main>
    </div>
  );
}

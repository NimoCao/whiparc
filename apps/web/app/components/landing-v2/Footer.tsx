import Link from 'next/link';
import { Icon } from '@iconify/react';
import { Seam } from './Seam';
import { useMarketingCta } from './useMarketingCta';
import { BrandLogo } from '../brand/BrandLogo';
import { NewsletterForm } from './NewsletterForm';

const REPO = 'https://github.com/whiparc/whiparc';

type FooterLink = { label: string; href: string };

const PRODUCT_LINKS: FooterLink[] = [
  { label: 'Docs', href: '/docs' },
  { label: 'Templates', href: '/templates' },
  { label: 'Limits', href: '#rough' },
  { label: 'Pricing', href: '#pricing' },
];

const PROJECT_LINKS: FooterLink[] = [
  { label: 'GitHub', href: REPO },
  { label: 'Contributing', href: `${REPO}/blob/main/CONTRIBUTING.md` },
  { label: 'Security', href: `${REPO}/blob/main/SECURITY.md` },
  { label: 'License', href: `${REPO}/blob/main/LICENSE` },
  { label: 'Contact', href: '/contact' },
];

// Personal accounts of the founder, kept separate from the project's own links
// so they are never mistaken for official Whiparc channels.
const FOUNDER_LINKS: FooterLink[] = [
  { label: 'X / Twitter', href: 'https://x.com/bishal_722' },
  { label: 'GitHub', href: 'https://github.com/bishalprasad321' },
  { label: 'LinkedIn', href: 'https://linkedin.com/in/bishal-prasad' },
];

function FootLink({ link }: { link: FooterLink }) {
  if (link.href.startsWith('/')) {
    return (
      <Link href={link.href} className="wp-foot-link">
        {link.label}
      </Link>
    );
  }
  if (link.href.startsWith('#')) {
    return (
      <a href={link.href} className="wp-foot-link">
        {link.label}
      </a>
    );
  }
  return (
    <a href={link.href} target="_blank" rel="noopener noreferrer" className="wp-foot-link">
      {link.label}
      <span className="wp-sr-only"> (opens in a new tab)</span>
    </a>
  );
}

function FootColumn({ title, links }: { title: string; links: FooterLink[] }) {
  return (
    <nav aria-label={title} className="wp-foot-col">
      <h3 className="wp-foot-kicker">{title}</h3>
      <ul className="wp-foot-list">
        {links.map((link) => (
          <li key={link.label}>
            <FootLink link={link} />
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function Footer() {
  const { startHref } = useMarketingCta();

  return (
    <section
      data-band="light"
      // Top padding must clear the Seam's 90px overlap into this section, plus
      // breathing room: the footer is tall enough that it no longer has spare
      // height to centre into (as the other sections do), so without this the
      // heading sits directly on the seam's wipe edge.
      style={{ position: 'relative', minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', boxSizing: 'border-box', background: 'var(--ground)', color: 'var(--ink)', padding: 'clamp(120px,10vw,160px) clamp(16px,4vw,44px) clamp(32px,4vw,52px)' }}
    >
      <Seam pair="dark:light" />
      <footer style={{ maxWidth: 1240, width: '100%', margin: '0 auto' }}>
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

        <div data-reveal className="wp-foot-grid">
          <div className="wp-foot-brand">
            <BrandLogo size={24} style={{ color: 'var(--ink)' }} />
            <p className="wp-foot-tagline">open source infrastructure compiler</p>

            <div className="wp-foot-founder">
              <h3 className="wp-foot-kicker">Built by</h3>
              <p className="wp-foot-name">Bishal Prasad</p>
              <p className="wp-foot-role">Founder</p>
              <ul className="wp-foot-inline" aria-label="Bishal Prasad on the web">
                {FOUNDER_LINKS.map((link) => (
                  <li key={link.label}>
                    <FootLink link={link} />
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <FootColumn title="Product" links={PRODUCT_LINKS} />
          <FootColumn title="Project" links={PROJECT_LINKS} />

          <div className="wp-foot-news">
            <h3 className="wp-foot-kicker">Stay in the loop</h3>
            <NewsletterForm />
          </div>
        </div>

        <div className="wp-foot-bottom">
          <span>© 2026 whiparc</span>
          <a href="#top" className="wp-foot-link">
            Back to top
          </a>
        </div>
      </footer>
    </section>
  );
}

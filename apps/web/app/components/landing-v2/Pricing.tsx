import Link from 'next/link';
import { Icon } from '@iconify/react';
import { BlueprintCorners } from '../ui/BlueprintCorners';
import { Seam } from './Seam';
import { useMarketingCta } from './useMarketingCta';

const SELF_HOSTED_FEATURES = [
  'Unlimited projects, canvases and members',
  'Full Terraform + Ansible emitter',
  'CLI, sandbox agent and code export',
  'Community support in GitHub issues',
];

const HOSTED_FEATURES = [
  'Everything in self-hosted',
  'Managed sandbox agents, no VM to babysit',
  'Nightly state backups and restore',
  'Email support, one business day',
];

export function Pricing() {
  const { startHref } = useMarketingCta();

  return (
    <section
      id="pricing"
      data-band="dark"
      style={{ position: 'relative', minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', boxSizing: 'border-box', background: 'var(--ground)', color: 'var(--ink)', padding: 'clamp(60px,8vw,120px) clamp(16px,4vw,44px)' }}
    >
      <Seam pair="light:dark" />
      <div style={{ maxWidth: 1240, margin: '0 auto' }}>
        <div data-reveal style={{ maxWidth: '44em' }}>
          <div style={{ fontFamily: 'var(--font-mono-marketing)', fontSize: 11, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink2)' }}>
            Pricing
          </div>
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 600,
              fontSize: 'clamp(30px,4.6vw,62px)',
              lineHeight: 1,
              letterSpacing: '-.03em',
              margin: '12px 0 0',
              color: 'var(--ink)',
            }}
          >
            Free is not a trial.
          </h2>
          <p style={{ margin: '16px 0 0', fontSize: 'clamp(15px,1.2vw,17px)', lineHeight: 1.6, color: 'var(--ink2)' }}>
            Self-hosting is the whole product, permanently, with no seat cap and no feature held back. The hosted plan
            exists because some teams don&apos;t want to run another service — that&apos;s the only difference.
          </p>
        </div>

        <div data-reveal style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,300px),1fr))', gap: 'clamp(16px,2vw,26px)', marginTop: 'clamp(28px,4vw,48px)' }}>
          <div className="wp-blueprint" style={{ position: 'relative', padding: 'clamp(20px,2.6vw,30px)', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <BlueprintCorners />
            <div>
              <div style={{ fontFamily: 'var(--font-mono-marketing)', fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--ink2)' }}>
                Self-hosted
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(34px,4vw,48px)', lineHeight: 1, letterSpacing: '-.03em', color: 'var(--ink)', marginTop: 10 }}>
                Free
              </div>
              <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: 1.6, color: 'var(--ink2)' }}>
                One Docker command. Your machines, your credentials, your data — we never see any of it.
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14, color: 'var(--ink)' }}>
              {SELF_HOSTED_FEATURES.map((f) => (
                <div key={f} style={{ display: 'grid', gridTemplateColumns: '16px minmax(0,1fr)', gap: 9, alignItems: 'start' }}>
                  <Icon icon="lucide:check" width={15} style={{ marginTop: 3, color: 'var(--accent-ink)' }} />
                  <span>{f}</span>
                </div>
              ))}
            </div>
            <Link
              href="/docs"
              style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, border: '1px solid var(--line)', color: 'var(--ink)', fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 15, padding: '13px 20px', whiteSpace: 'nowrap' }}
            >
              <Icon icon="lucide:terminal" width={15} />
              <span>Read the install guide</span>
            </Link>
          </div>

          <div className="wp-blueprint" style={{ position: 'relative', padding: 'clamp(20px,2.6vw,30px)', display: 'flex', flexDirection: 'column', gap: 14, background: 'var(--chip)' }}>
            <BlueprintCorners />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--font-mono-marketing)', fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--amber)' }}>
                <span style={{ whiteSpace: 'nowrap' }}>Hosted · we run it</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginTop: 10 }}>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(34px,4vw,48px)', lineHeight: 1, letterSpacing: '-.03em', color: 'var(--ink)' }}>
                  $19
                </span>
                <span style={{ fontFamily: 'var(--font-mono-marketing)', fontSize: 12, color: 'var(--ink2)', paddingBottom: 6, whiteSpace: 'nowrap' }}>/ user / month</span>
              </div>
              <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: 1.6, color: 'var(--ink2)' }}>
                Same product, on our infrastructure, with managed agents and backups. Cancel and export everything as
                plain files.
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14, color: 'var(--ink)' }}>
              {HOSTED_FEATURES.map((f) => (
                <div key={f} style={{ display: 'grid', gridTemplateColumns: '16px minmax(0,1fr)', gap: 9, alignItems: 'start' }}>
                  <Icon icon="lucide:check" width={15} style={{ marginTop: 3, color: 'var(--amber)' }} />
                  <span>{f}</span>
                </div>
              ))}
            </div>
            <Link
              href={startHref}
              style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, background: 'var(--accent)', color: 'var(--on-accent)', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, padding: '13px 20px', whiteSpace: 'nowrap' }}
            >
              <span>Start free</span>
              <Icon icon="lucide:arrow-right" width={16} />
            </Link>
          </div>
        </div>
        <p data-reveal style={{ margin: 'clamp(20px,2.6vw,30px) 0 0', maxWidth: '52em', fontSize: 13, lineHeight: 1.6, color: 'var(--ink2)', fontFamily: 'var(--font-mono-marketing)' }}>
          No credit card to start · no usage metering on the editor · cloud bills stay between you and your provider
        </p>
      </div>
    </section>
  );
}

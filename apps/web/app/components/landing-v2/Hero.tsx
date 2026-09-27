import { Icon } from '@iconify/react';
import { BlueprintCorners } from '../ui/BlueprintCorners';
import { useMarketingCta } from './useMarketingCta';
import Link from 'next/link';

const HERO_NODES = [
  { id: '0', left: '6%', top: '16%', width: '46%', kicker: 'aws_vpc', label: 'main', tint: 'rgba(255,106,61,.07)', border: 'var(--line)' },
  { id: '1', left: '6%', top: '50%', width: '48%', kicker: 'aws_instance', label: 'app · t3.small', tint: 'var(--panel)', border: 'var(--line)' },
  { id: '2', right: '6%', top: '22%', width: '40%', kicker: 'ansible', label: 'nginx + certs', tint: 'var(--panel)', border: 'var(--line)' },
] as const;

export function Hero() {
  const { startHref } = useMarketingCta();

  return (
    <section
      id="top"
      data-band="dark"
      style={{
        position: 'relative',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        background: 'var(--ground)',
        color: 'var(--ink)',
        padding: 'clamp(52px,7vw,104px) clamp(16px,4vw,44px) clamp(64px,8vw,120px)',
        overflow: 'hidden',
      }}
    >
      <div
        data-parallax="0.05"
        style={{
          position: 'absolute',
          inset: '-10% -2% 0',
          backgroundImage:
            'linear-gradient(rgba(148,163,184,.085) 1px,transparent 1px),linear-gradient(90deg,rgba(148,163,184,.085) 1px,transparent 1px)',
          backgroundSize: '74px 74px',
          pointerEvents: 'none',
        }}
      />
      <div style={{ position: 'relative', maxWidth: 1240, margin: '0 auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'clamp(32px,5vw,72px)' }}>
        <div style={{ flex: '1 1 420px', minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontFamily: 'var(--font-mono-marketing)',
              fontSize: 11,
              letterSpacing: '.18em',
              textTransform: 'uppercase',
              color: 'var(--accent-ink)',
              animation: 'wpFade .6s ease both',
            }}
          >
            <span style={{ width: 6, height: 6, background: 'var(--amber)', display: 'inline-block', flexShrink: 0 }} />
            <span style={{ whiteSpace: 'nowrap' }}>Open source · infra compiler</span>
          </div>

          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 600,
              fontSize: 'clamp(38px,6.4vw,84px)',
              lineHeight: 0.98,
              letterSpacing: '-.035em',
              margin: 'clamp(16px,2vw,26px) 0 0',
              color: 'var(--ink)',
              textWrap: 'balance',
            }}
          >
            <span style={{ display: 'block', overflow: 'hidden' }}>
              <span style={{ display: 'block', animation: 'wpUp .9s cubic-bezier(.16,.84,.3,1) both' }}>Draw it once.</span>
            </span>
            <span style={{ display: 'block', overflow: 'hidden' }}>
              <span style={{ display: 'block', animation: 'wpUp .9s cubic-bezier(.16,.84,.3,1) .12s both', color: 'var(--accent-ink)' }}>
                Ship the infra.
              </span>
            </span>
          </h1>

          <p
            style={{
              margin: 'clamp(18px,2.4vw,28px) 0 0',
              maxWidth: '36em',
              fontSize: 'clamp(15px,1.25vw,18px)',
              lineHeight: 1.62,
              color: 'var(--ink2)',
              animation: 'wpUp .9s cubic-bezier(.16,.84,.3,1) .24s both',
            }}
          >
            The diagram <em style={{ fontStyle: 'normal', color: 'var(--ink)', borderBottom: '1px solid var(--accent-ink)' }}>is</em>{' '}
            the source now — wire resources on a canvas, and whiparc emits Terraform and Ansible you can read, review in a
            PR, and run.
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 'clamp(24px,3vw,36px)', animation: 'wpUp .9s cubic-bezier(.16,.84,.3,1) .34s both' }}>
            <Link
              href={startHref}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                background: 'var(--accent)',
                color: 'var(--on-accent)',
                fontFamily: 'var(--font-display)',
                fontWeight: 600,
                fontSize: 15,
                padding: '14px 24px',
                whiteSpace: 'nowrap',
              }}
            >
              <span>Start free</span>
              <Icon icon="lucide:arrow-right" width={16} />
            </Link>
            <a
              href="#how"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                border: '1px solid var(--line)',
                color: 'var(--ink)',
                fontFamily: 'var(--font-display)',
                fontWeight: 500,
                fontSize: 15,
                padding: '14px 24px',
                whiteSpace: 'nowrap',
              }}
            >
              <span>See it compile</span>
              <Icon icon="lucide:chevron-down" width={16} />
            </a>
          </div>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px 22px',
              marginTop: 'clamp(22px,2.6vw,32px)',
              fontFamily: 'var(--font-mono-marketing)',
              fontSize: 11,
              letterSpacing: '.06em',
              color: 'var(--ink2)',
              animation: 'wpFade 1s ease .5s both',
            }}
          >
            <span style={{ whiteSpace: 'nowrap' }}>Self-host in one command</span>
            <span style={{ whiteSpace: 'nowrap' }}>No sales call</span>
            <span style={{ whiteSpace: 'nowrap' }}>Generated code is yours</span>
          </div>
        </div>

        <div style={{ flex: '1 1 380px', minWidth: 0 }}>
          <div className="wp-blueprint" data-parallax="-0.045" style={{ position: 'relative', background: 'var(--panel)', padding: 0 }}>
            <BlueprintCorners />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                borderBottom: '1px solid var(--line)',
                padding: '10px 14px',
                fontFamily: 'var(--font-mono-marketing)',
                fontSize: 10,
                letterSpacing: '.14em',
                textTransform: 'uppercase',
                color: 'var(--ink2)',
              }}
            >
              <span style={{ whiteSpace: 'nowrap' }}>canvas · three-tier-web</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', color: 'var(--amber)' }}>
                <span style={{ width: 5, height: 5, background: 'currentColor', display: 'inline-block' }} />
                unsaved
              </span>
            </div>
            <div
              style={{
                position: 'relative',
                height: 'clamp(300px,34vw,400px)',
                backgroundImage:
                  'linear-gradient(rgba(148,163,184,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(148,163,184,.07) 1px,transparent 1px)',
                backgroundSize: '26px 26px',
              }}
            >
              <svg data-graph="hero" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}>
                <defs>
                  <marker id="wpTipH" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto" markerUnits="userSpaceOnUse">
                    <path d="M0.5 1.2L9 5L0.5 8.8" fill="none" stroke="#FF6A3D" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
                  </marker>
                  <marker id="wpTipHA" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto" markerUnits="userSpaceOnUse">
                    <path d="M0.5 1.2L9 5L0.5 8.8" fill="none" stroke="#F59E0B" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
                  </marker>
                </defs>
                <path data-wire="0" data-from="0" data-to="1" data-route="down" data-delay="500" fill="none" stroke="#FF6A3D" strokeWidth={1.3} markerEnd="url(#wpTipH)" />
                <path data-wire="1" data-from="1" data-to="2" data-route="right" data-delay="700" fill="none" stroke="#FF6A3D" strokeWidth={1.3} markerEnd="url(#wpTipH)" />
                <path data-wire="2" data-from="2" data-to="3" data-route="down" data-delay="900" fill="none" stroke="#F59E0B" strokeWidth={1.3} markerEnd="url(#wpTipHA)" />
              </svg>
              {HERO_NODES.map((n, i) => (
                <div
                  key={n.id}
                  data-gnode={n.id}
                  style={{
                    position: 'absolute',
                    left: 'left' in n ? n.left : undefined,
                    right: 'right' in n ? n.right : undefined,
                    top: n.top,
                    width: n.width,
                    background: n.tint,
                    border: `1px solid ${n.border}`,
                    padding: '8px 10px',
                    animation: `wpFade .7s ease ${0.35 + i * 0.2}s both`,
                  }}
                >
                  <div style={{ fontFamily: 'var(--font-mono-marketing)', fontSize: 9, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--accent-ink)' }}>
                    {n.kicker}
                  </div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 500, color: 'var(--ink)', marginTop: 2 }}>{n.label}</div>
                </div>
              ))}
              <div
                data-gnode="3"
                style={{
                  position: 'absolute',
                  right: '6%',
                  top: '62%',
                  width: '40%',
                  border: '1px solid var(--amber)',
                  padding: '8px 10px',
                  animation: 'wpFade .7s ease .95s both',
                }}
              >
                <div style={{ fontFamily: 'var(--font-mono-marketing)', fontSize: 9, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--amber)' }}>
                  output
                </div>
                <div style={{ fontFamily: 'var(--font-mono-marketing)', fontSize: 12, color: 'var(--ink)', marginTop: 2 }}>public_ip</div>
              </div>
            </div>
            <div
              data-parallax="-0.1"
              style={{
                position: 'absolute',
                right: -6,
                bottom: -30,
                width: 'min(74%,320px)',
                background: '#17181C',
                border: '1px solid var(--line)',
                boxShadow: '0 22px 50px rgba(0,0,0,.55)',
                padding: '10px 12px',
                animation: 'wpUp .9s cubic-bezier(.16,.84,.3,1) 1.05s both',
              }}
            >
              <div style={{ fontFamily: 'var(--font-mono-marketing)', fontSize: 9, letterSpacing: '.14em', textTransform: 'uppercase', color: '#7B7E88', marginBottom: 6 }}>
                main.tf · emitted
              </div>
              <div style={{ fontFamily: 'var(--font-mono-marketing)', fontSize: 11, lineHeight: 1.72, color: '#CBD5E1', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                <div>
                  <span style={{ color: '#FF8A63' }}>resource</span> <span style={{ color: '#F59E0B' }}>&quot;aws_instance&quot;</span>{' '}
                  <span style={{ color: '#F59E0B' }}>&quot;app&quot;</span> {'{'}
                </div>
                <div>
                  &nbsp;&nbsp;instance_type = <span style={{ color: '#34D399' }}>&quot;t3.small&quot;</span>
                </div>
                <div>&nbsp;&nbsp;subnet_id&nbsp;&nbsp;&nbsp;&nbsp; = aws_subnet.app.id</div>
                <div>
                  {'}'}
                  <span style={{ animation: 'wpBlink 1.1s steps(1) infinite', color: '#FF8A63' }}>▌</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

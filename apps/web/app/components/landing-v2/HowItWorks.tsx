import type { ReactNode } from 'react';
import { BlueprintCorners } from '../ui/BlueprintCorners';
import BlueprintNodeCard from '../canvas/BlueprintNodeCard';
import { Seam } from './Seam';

const STEPS = [
  { n: '01', title: 'Graph', body: "Drop resources, wire dependencies. The canvas is typed — it refuses edges that wouldn't plan." },
  { n: '02', title: 'Compile', body: 'Every edit re-emits HCL and YAML. Ordinary files — diff them, review them, hand-edit them.' },
  { n: '03', title: 'Run', body: 'Plan and apply from a sandbox agent with your credentials, streaming the real log.' },
];

// Stage 0's canvas. Each node renders through the same BlueprintNodeCard the
// workspace editor uses, so the landing page shows the product's real node
// design. `at` is the scroll progress (0-1, within the stage's own third of the
// track) at which the node switches on; the connector into it draws after.
const STAGE_NODES = [
  { id: '0', at: 0, tech: 'Terraform', icon: 'lucide:box', kicker: 'aws_vpc', label: 'main · 10.0.0.0/16', pos: { left: '5%', top: '20%' } },
  { id: '1', at: 0.12, tech: 'Terraform', icon: 'lucide:server', kicker: 'aws_instance', label: 'app · t3.small', pos: { left: '5%', top: '52%' } },
  { id: '2', at: 0.4, tech: 'Ansible', icon: 'lucide:settings-2', kicker: 'ansible_role', label: 'nginx + certs', pos: { right: '5%', top: '24%' } },
  { id: '3', at: 0.64, tech: 'Target', icon: 'lucide:globe', kicker: 'output', label: 'public_ip', pos: { right: '5%', top: '62%' } },
] as const;

// Connector color follows the node it points at (as in the workspace): the
// instance is Terraform, the role is Ansible, the output is a target.
const STAGE_EDGES = [
  { id: '1', from: '0', to: '1', route: 'down', at: 0.24, color: 'var(--accent-ink)' },
  { id: '2', from: '1', to: '2', route: 'right', at: 0.5, color: 'var(--amber)' },
  { id: '3', from: '2', to: '3', route: 'down', at: 0.72, color: 'var(--target-ink)' },
] as const;

const TF_LINES: ReactNode[] = [
  <>
    <span style={{ color: '#FF8A63' }}>resource</span> <span style={{ color: '#F59E0B' }}>&quot;aws_vpc&quot;</span> <span style={{ color: '#F59E0B' }}>&quot;main&quot;</span> {'{'}
  </>,
  <>
    &nbsp;&nbsp;cidr_block&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; = <span style={{ color: '#34D399' }}>&quot;10.0.0.0/16&quot;</span>
  </>,
  <>
    &nbsp;&nbsp;enable_dns_hostnames = <span style={{ color: '#FF8A63' }}>true</span>
  </>,
  <>{'}'}</>,
  <> </>,
  <>
    <span style={{ color: '#FF8A63' }}>resource</span> <span style={{ color: '#F59E0B' }}>&quot;aws_instance&quot;</span> <span style={{ color: '#F59E0B' }}>&quot;app&quot;</span> {'{'}
  </>,
  <>&nbsp;&nbsp;ami&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; = var.ami_id</>,
  <>
    &nbsp;&nbsp;instance_type = <span style={{ color: '#34D399' }}>&quot;t3.small&quot;</span>
  </>,
  <>&nbsp;&nbsp;subnet_id&nbsp;&nbsp;&nbsp;&nbsp; = aws_subnet.app.id</>,
  <>
    &nbsp;&nbsp;tags&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; = {'{ Name = '}
    <span style={{ color: '#34D399' }}>&quot;app&quot;</span> {'}'}
  </>,
  <>{'}'}</>,
];

const LOG_LINES: ReactNode[] = [
  <>
    <span style={{ color: '#FF8A63' }}>$</span> whiparc apply --project three-tier-web
  </>,
  <>
    <span style={{ color: '#7B7E88' }}>→</span> terraform init&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <span style={{ color: '#34D399' }}>ok</span>
  </>,
  <>
    <span style={{ color: '#7B7E88' }}>→</span> terraform plan&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 4 to add, 0 to change
  </>,
  <>
    <span style={{ color: '#7B7E88' }}>→</span> terraform apply&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; applying…
  </>,
  <>
    <span style={{ color: '#7B7E88' }}>&nbsp;&nbsp;</span>aws_vpc.main&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;created&nbsp; 2.1s
  </>,
  <>
    <span style={{ color: '#7B7E88' }}>&nbsp;&nbsp;</span>aws_subnet.app&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;created&nbsp; 1.4s
  </>,
  <>
    <span style={{ color: '#7B7E88' }}>&nbsp;&nbsp;</span>aws_instance.app&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;created 31.7s
  </>,
  <>
    <span style={{ color: '#7B7E88' }}>→</span> ansible-playbook&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 1 host, 6 tasks
  </>,
  <>
    <span style={{ color: '#34D399' }}>✓</span> apply complete&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <span style={{ color: '#F59E0B' }}>public_ip 52.14.8.201</span>
  </>,
];

const monoCode: React.CSSProperties = {
  fontFamily: 'var(--font-mono-marketing)',
  fontSize: 'clamp(11px,1vw,13.5px)',
  lineHeight: 1.85,
  color: '#CBD5E1',
};

export function HowItWorks() {
  return (
    <section
      id="how"
      data-band="light"
      style={{ position: 'relative', background: 'var(--ground)', color: 'var(--ink)', padding: '0 0 clamp(40px,5vw,72px)' }}
    >
      <Seam pair="dark:light" />
      <div
        style={{
          maxWidth: 1240,
          margin: '0 auto',
          padding: 'clamp(56px,7vw,104px) clamp(16px,4vw,44px) clamp(28px,4vw,52px)',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          boxSizing: 'border-box',
        }}
      >
        <div data-reveal style={{ maxWidth: '44em' }}>
          <div style={{ fontFamily: 'var(--font-mono-marketing)', fontSize: 11, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink2)' }}>
            How it works
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
            Graph in. Code out. Run it.
          </h2>
          <p style={{ margin: '16px 0 0', fontSize: 'clamp(15px,1.2vw,17px)', lineHeight: 1.6, color: 'var(--ink2)' }}>
            Keep scrolling — the three states below are the entire product. Nothing here is a mock of a feature we haven&apos;t
            built.
          </p>
        </div>
      </div>

      <div data-stage-section className="wp-stage-track">
        <div
          style={{
            position: 'sticky',
            top: 0,
            height: '100vh',
            minHeight: 520,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: 'clamp(14px,2.2vh,26px)',
            padding: '80px clamp(16px,4vw,44px) 26px',
          }}
        >
          <div style={{ maxWidth: 1240, margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', gap: 'clamp(14px,2.2vh,26px)', flex: '1 1 auto', minHeight: 0 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 1, background: 'var(--line)', border: '1px solid var(--line)', flexShrink: 0 }}>
              {STEPS.map((step, i) => (
                <div key={step.n} data-step={i} style={{ background: 'var(--ground)', padding: '12px 14px' }}>
                  <div style={{ fontFamily: 'var(--font-mono-marketing)', fontSize: 10, letterSpacing: '.16em', color: 'var(--ink2)' }}>{step.n}</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(15px,1.4vw,19px)', color: 'var(--ink)', marginTop: 2 }}>
                    {step.title}
                  </div>
                  <p style={{ margin: '4px 0 0', fontSize: 13, lineHeight: 1.5, color: 'var(--ink2)' }}>{step.body}</p>
                </div>
              ))}
            </div>

            <div style={{ height: 2, background: 'var(--line)', flexShrink: 0, position: 'relative' }}>
              <div data-progress style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '0%', background: 'var(--accent)' }} />
            </div>

            <div style={{ position: 'relative', flex: '1 1 auto', minHeight: 0 }}>
              <div data-stage="0" className="wp-blueprint" style={{ position: 'absolute', inset: 0, background: 'var(--panel)', opacity: 1 }}>
                <BlueprintCorners />
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    backgroundImage: 'linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px)',
                    backgroundSize: '28px 28px',
                  }}
                />
                {/* Connectors: square-cornered orthogonal runs. MarketingEngine
                    routes each path and positions its chevron (data-tip); the
                    tip is a separate element, not an SVG marker, so it can
                    appear only once the line has finished drawing. */}
                <svg data-graph="stage" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}>
                  {STAGE_EDGES.map((e) => (
                    <g key={e.id}>
                      <path
                        data-edge={e.id}
                        data-from={e.from}
                        data-to={e.to}
                        data-route={e.route}
                        data-at={e.at}
                        fill="none"
                        stroke={e.color}
                        strokeWidth={1.5}
                        strokeLinecap="butt"
                        strokeLinejoin="miter"
                      />
                      <path
                        data-tip={e.id}
                        d="M-8.5 -3.8L0 0L-8.5 3.8"
                        fill="none"
                        stroke={e.color}
                        strokeWidth={1.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </g>
                  ))}
                </svg>
                <div
                  style={{
                    position: 'absolute',
                    left: 14,
                    top: 12,
                    fontFamily: 'var(--font-mono-marketing)',
                    fontSize: 10,
                    letterSpacing: '.16em',
                    textTransform: 'uppercase',
                    color: 'var(--ink2)',
                  }}
                >
                  canvas
                </div>
                {STAGE_NODES.map((n) => (
                  <div
                    key={n.id}
                    data-node={n.id}
                    data-gnode={n.id}
                    data-at={n.at}
                    style={{ position: 'absolute', ...n.pos, width: '38%', maxWidth: 260 }}
                  >
                    <BlueprintNodeCard
                      width="100%"
                      tech={n.tech}
                      icon={n.icon}
                      categoryLabel={n.kicker}
                      label={n.label}
                      tag={{ text: 'Validated', color: 'var(--success)' }}
                    />
                  </div>
                ))}
              </div>

              <div data-stage="1" style={{ position: 'absolute', inset: 0, background: '#17181C', border: '1px solid #2A2C33', opacity: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 0, borderBottom: '1px solid #2A2C33', flexShrink: 0, overflow: 'hidden' }}>
                  <span style={{ fontFamily: 'var(--font-mono-marketing)', fontSize: 11, padding: '10px 14px', color: '#FFFFFF', borderRight: '1px solid #2A2C33', background: 'rgba(255,106,61,.12)', whiteSpace: 'nowrap' }}>
                    main.tf
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono-marketing)', fontSize: 11, padding: '10px 14px', color: '#7B7E88', borderRight: '1px solid #2A2C33', whiteSpace: 'nowrap' }}>
                    variables.tf
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono-marketing)', fontSize: 11, padding: '10px 14px', color: '#7B7E88', whiteSpace: 'nowrap' }}>playbook.yml</span>
                  <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono-marketing)', fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: '#7B7E88', padding: '10px 14px', whiteSpace: 'nowrap' }}>
                    emitted 12ms ago
                  </span>
                </div>
                <div style={{ flex: '1 1 auto', minHeight: 0, overflow: 'hidden', padding: '14px clamp(12px,2vw,22px)', ...monoCode }}>
                  {TF_LINES.map((line, i) => (
                    <div key={i} data-code-line style={{ whiteSpace: 'pre' }}>
                      {line}
                    </div>
                  ))}
                </div>
              </div>

              <div data-stage="2" style={{ position: 'absolute', inset: 0, background: '#101114', border: '1px solid #2A2C33', opacity: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid #2A2C33', padding: '10px 14px', flexShrink: 0 }}>
                  <span style={{ fontFamily: 'var(--font-mono-marketing)', fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: '#7B7E88', whiteSpace: 'nowrap' }}>
                    sandbox agent · eu-west-1
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono-marketing)', fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: '#34D399', whiteSpace: 'nowrap' }}>
                    <span style={{ width: 5, height: 5, background: 'currentColor', display: 'inline-block' }} />
                    live
                  </span>
                </div>
                <div style={{ flex: '1 1 auto', minHeight: 0, overflow: 'hidden', padding: '14px clamp(12px,2vw,22px)', ...monoCode, lineHeight: 1.95 }}>
                  {LOG_LINES.map((line, i) => (
                    <div key={i} data-log-line style={{ whiteSpace: 'pre' }}>
                      {line}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

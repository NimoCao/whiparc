import { BlueprintCorners } from '../ui/BlueprintCorners';
import { Seam } from './Seam';

const LIMIT_TABS = ['01 · Providers', '02 · Existing infra', '03 · Teams', '04 · Agent'];

const LIMIT_ROWS = ['Providers', 'Existing infra', 'Teams', 'Agent'];

const LIMIT_CARDS = [
  {
    tag: 'Blocking if Azure-first',
    tagColor: 'var(--amber)',
    label: '01 · Providers',
    title: "AWS is deep. GCP and Azure aren't.",
    body: "Roughly forty AWS resources are modelled properly — the ones you'd actually wire in a three-tier stack. GCP and Azure cover compute, network and storage, and that's the honest end of the list.",
    footnote: "If you're Azure-first, this isn't your tool yet. We'd rather you knew now.",
  },
  {
    tag: 'No workaround yet',
    tagColor: 'var(--amber)',
    label: '02 · Existing infra',
    title: 'No state import yet.',
    body: "You can't point whiparc at a live account and get a canvas back. Everything starts from a blank canvas or a template, which makes it a tool for new stacks and rebuilds rather than for documenting what you already run.",
    footnote: 'Import is the next big piece of work, not a maybe on a roadmap slide.',
  },
  {
    tag: 'Deliberate, for now',
    tagColor: 'var(--accent-ink)',
    label: '03 · Teams',
    title: 'Review happens in Git, not here.',
    body: "Projects, members and access requests work. In-canvas comments and per-environment approvals don't exist — we'd rather the emitted code go through the review flow your team already trusts.",
    footnote: 'If your approvals have to live in the tool, this will feel thin.',
  },
  {
    tag: 'Being fixed',
    tagColor: 'var(--amber)',
    label: '04 · Agent',
    title: 'The Windows agent drops connections.',
    body: 'Linux and macOS agents are steady through long applies. On Windows, a thirty-minute apply sometimes loses the log stream and you have to re-attach to see the tail — the apply itself keeps running.',
    footnote: 'Reconnect logic is in progress. Until then, the CLI tail is the reliable path.',
  },
];

export function Limits() {
  return (
    <section id="rough" data-band="dark" style={{ position: 'relative', boxSizing: 'border-box', background: 'var(--ground)', color: 'var(--ink)', padding: 0 }}>
      <Seam pair="light:dark" />
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', boxSizing: 'border-box', padding: 'clamp(60px,8vw,110px) clamp(16px,4vw,44px) clamp(30px,4vw,50px)' }}>
        <div style={{ maxWidth: 1240, margin: '0 auto', width: '100%' }}>
          <div data-reveal style={{ maxWidth: '44em' }}>
            <div style={{ fontFamily: 'var(--font-mono-marketing)', fontSize: 11, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--amber)' }}>
              Where it&apos;s still rough
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
              The four things people ask about first.
            </h2>
            <p style={{ margin: '16px 0 0', fontSize: 'clamp(15px,1.2vw,17px)', lineHeight: 1.6, color: 'var(--ink2)' }}>
              You&apos;d find these out in twenty minutes anyway. Better you read them here and decide before you invest an
              afternoon. Keep scrolling — they come one at a time.
            </p>
          </div>
          <div data-reveal style={{ display: 'flex', flexWrap: 'wrap', gap: 1, background: 'var(--line)', border: '1px solid var(--line)', marginTop: 'clamp(26px,3.4vw,44px)' }}>
            {LIMIT_TABS.map((tab) => (
              <div
                key={tab}
                style={{
                  flex: '1 1 180px',
                  background: 'var(--ground)',
                  padding: '14px 16px',
                  fontFamily: 'var(--font-mono-marketing)',
                  fontSize: 11,
                  letterSpacing: '.14em',
                  textTransform: 'uppercase',
                  color: 'var(--ink2)',
                  whiteSpace: 'nowrap',
                }}
              >
                {tab}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div data-limit-track className="wp-limit-track">
        <div style={{ position: 'sticky', top: 0, height: '100vh', minHeight: 520, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '84px clamp(16px,4vw,44px) 32px' }}>
          <div style={{ maxWidth: 1240, margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', gap: 'clamp(14px,2.2vh,24px)', flex: '1 1 auto', minHeight: 0 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexShrink: 0 }}>
              <div style={{ fontFamily: 'var(--font-mono-marketing)', fontSize: 11, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--amber)', whiteSpace: 'nowrap' }}>
                Known limits · read before you commit an afternoon
              </div>
              <div data-limit-count style={{ fontFamily: 'var(--font-mono-marketing)', fontSize: 11, letterSpacing: '.16em', color: 'var(--ink2)', whiteSpace: 'nowrap' }}>
                01 / 04
              </div>
            </div>
            <div style={{ height: 2, background: 'var(--line)', position: 'relative', flexShrink: 0 }}>
              <div data-limit-bar style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '0%', background: 'var(--amber)' }} />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'clamp(16px,2.4vw,32px)', flex: '1 1 auto', minHeight: 0 }}>
              <div style={{ flex: '1 1 230px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1, background: 'var(--line)', border: '1px solid var(--line)', alignSelf: 'flex-start' }}>
                {LIMIT_ROWS.map((row, i) => (
                  <div
                    key={row}
                    data-limit-row={i}
                    style={{
                      background: 'var(--ground)',
                      padding: '13px 15px',
                      display: 'grid',
                      gridTemplateColumns: 'auto minmax(0,1fr)',
                      gap: 11,
                      alignItems: 'baseline',
                      borderLeft: '2px solid transparent',
                    }}
                  >
                    <span style={{ fontFamily: 'var(--font-mono-marketing)', fontSize: 10, letterSpacing: '.14em', color: 'var(--ink2)' }}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 15, color: 'var(--ink)' }}>{row}</span>
                  </div>
                ))}
              </div>

              <div style={{ flex: '3 1 380px', minWidth: 0, position: 'relative', minHeight: 'clamp(290px,40vh,440px)' }}>
                {LIMIT_CARDS.map((card, i) => (
                  <div
                    key={card.label}
                    data-limit-card={i}
                    className="wp-blueprint"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      boxSizing: 'border-box',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      gap: 'clamp(12px,1.8vh,20px)',
                      padding: 'clamp(20px,3vw,40px)',
                      opacity: i === 0 ? 1 : 0,
                    }}
                  >
                    <BlueprintCorners />
                    <div data-limit-part style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                      <span
                        style={{
                          fontFamily: 'var(--font-mono-marketing)',
                          fontSize: 10,
                          letterSpacing: '.16em',
                          textTransform: 'uppercase',
                          color: card.tagColor,
                          border: `1px solid ${card.tagColor}`,
                          padding: '4px 8px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {card.tag}
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono-marketing)', fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--ink2)', whiteSpace: 'nowrap' }}>
                        {card.label}
                      </span>
                    </div>
                    <div
                      data-limit-part
                      style={{
                        fontFamily: 'var(--font-display)',
                        fontWeight: 600,
                        fontSize: 'clamp(24px,3.4vw,44px)',
                        lineHeight: 1.04,
                        letterSpacing: '-.03em',
                        color: 'var(--ink)',
                      }}
                    >
                      {card.title}
                    </div>
                    <p data-limit-part style={{ margin: 0, maxWidth: '40em', fontSize: 'clamp(14px,1.15vw,17px)', lineHeight: 1.6, color: 'var(--ink2)' }}>
                      {card.body}
                    </p>
                    <div
                      data-limit-part
                      style={{
                        borderTop: '1px solid var(--line)',
                        paddingTop: 'clamp(10px,1.4vh,14px)',
                        fontFamily: 'var(--font-mono-marketing)',
                        fontSize: 12,
                        lineHeight: 1.6,
                        color: 'var(--ink2)',
                      }}
                    >
                      {card.footnote}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', boxSizing: 'border-box', padding: 'clamp(40px,6vw,90px) clamp(16px,4vw,44px) clamp(60px,8vw,110px)' }}>
        <div style={{ maxWidth: 1240, margin: '0 auto', width: '100%' }}>
          <div data-reveal className="wp-blueprint" style={{ position: 'relative', padding: 'clamp(20px,3vw,38px)', maxWidth: '64em' }}>
            <BlueprintCorners />
            <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'clamp(17px,1.9vw,26px)', lineHeight: 1.45, letterSpacing: '-.015em', color: 'var(--ink)' }}>
              So much gets built and just sits on localhost — the deployment step is where most people stall. We&apos;re two
              people who spent years deep in other teams&apos; Ansible playbooks and Terraform modules, and whiparc is the
              tool we wanted then: a single canvas to learn how the cloud actually fits together, and to ship for real,
              with real files and no layer in between that you can&apos;t read.
            </p>
            <div style={{ marginTop: 14, fontFamily: 'var(--font-mono-marketing)', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink2)' }}>
              — whiparc maintainers
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

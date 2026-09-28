'use client';

import type { CSSProperties } from 'react';
import { spaceGroteskFont, barlowFont, jetBrainsMonoFont } from '../../fonts';
import { useMarketingEngine } from './useMarketingEngine';
import { Nav } from './Nav';
import { Hero } from './Hero';
import { HowItWorks } from './HowItWorks';
import { Limits } from './Limits';
import { Templates } from './Templates';
import { Pricing } from './Pricing';
import { Footer } from './Footer';
import '../ui/blueprint.css';
import './marketing-v2.css';

const rootStyle: CSSProperties = {
  ['--ground' as string]: '#101114',
  ['--panel' as string]: '#17181C',
  ['--line' as string]: '#2A2C33',
  ['--ink' as string]: '#F5F5F6',
  ['--ink2' as string]: '#A3A6AF',
  ['--accent-ink' as string]: '#FF8A63',
  ['--accent' as string]: '#FF6A3D',
  ['--on-accent' as string]: '#101114',
  ['--amber' as string]: '#F59E0B',
  ['--success' as string]: '#10B981',
  ['--chip' as string]: 'rgba(255,255,255,.04)',
  ['--ink3' as string]: '#7B7E88',
  ['--k8s-ink' as string]: '#7DD3FC',
  ['--target-ink' as string]: '#5EEAD4',
  background: '#101114',
  color: '#F5F5F6',
};

export default function MarketingPageV2() {
  const { rootRef, mode, setMode } = useMarketingEngine();

  return (
    <div
      ref={rootRef}
      data-whiparc-root
      className={`wp-root ${spaceGroteskFont.variable} ${barlowFont.variable} ${jetBrainsMonoFont.variable}`}
      style={{ ...rootStyle, fontFamily: 'var(--font-body-marketing), system-ui, sans-serif' }}
    >
      <Nav mode={mode} setMode={setMode} />
      <Hero />
      <HowItWorks />
      <Limits />
      <Templates />
      <Pricing />
      <Footer />
    </div>
  );
}

import type { CSSProperties } from 'react';
import { barlowCondensedFont } from '../../fonts';

// Brand geometry lifted from the official logo kit (assets/icon-cutout-*.svg).
// The mark is drawn inline instead of loaded through <img> so the dark half
// can follow `currentColor` — one component serves the dark theme, the light
// theme and the marketing page's scroll-driven dark/light bands, where a
// pair of static light/dark SVG files would need JS to swap between them.
// The orange half is the brand colour and never changes with the theme.
export const BRAND_ORANGE = '#FF6A3D';

const INK_PATH =
  'M176.859 512L247.201 334.569L211.185 234.667L266.436 199.285L278.305 169.626L247.201 86.8943L162.072 304.39L81.036 0L0 36.9431L123.275 512H176.859Z';
const ARC_PATH =
  'M287.309 201.366L225.509 240.911L317.909 512H373.803L512 43.187L430.964 8.3252L410.091 97.8211H435.466L378.577 262.764H365.89L351.974 314.797L330.692 262.764H264.799L287.309 201.366Z';

export function BrandMark({ size = 24, style }: { size?: number; style?: CSSProperties }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', flexShrink: 0, ...style }}
    >
      <path fillRule="evenodd" clipRule="evenodd" d={INK_PATH} fill="currentColor" />
      <path fillRule="evenodd" clipRule="evenodd" d={ARC_PATH} fill={BRAND_ORANGE} />
    </svg>
  );
}

// Mark + live-text wordmark. "whip" inherits the surrounding text colour and
// "arc" is brand orange, matching the two tspans in the official horizontal logo.
export function BrandLogo({
  size = 24,
  textSize,
  wordmark = true,
  style,
}: {
  size?: number;
  textSize?: number;
  wordmark?: boolean;
  style?: CSSProperties;
}) {
  return (
    <span
      className={barlowCondensedFont.variable}
      style={{ display: 'inline-flex', alignItems: 'center', gap: Math.round(size * 0.36), lineHeight: 1, ...style }}
    >
      <BrandMark size={size} />
      {wordmark && (
        <span
          style={{
            fontFamily: 'var(--font-brand), "Arial Narrow", sans-serif',
            fontWeight: 700,
            fontSize: textSize ?? Math.round(size * 0.85),
            letterSpacing: '-.02em',
            whiteSpace: 'nowrap',
          }}
        >
          whip<span style={{ color: BRAND_ORANGE }}>arc</span>
        </span>
      )}
    </span>
  );
}

import { Geist, Space_Grotesk, Barlow, Barlow_Condensed, JetBrains_Mono } from 'next/font/google';

// Display font for the landing page hero headline only — the rest of the
// app keeps the Inter/JetBrains Mono stack defined in globals.css.
// Geist is Vercel's professional grotesk, standard across modern SaaS
// design systems (ships as an official Figma community file).
export const heroDisplayFont = Geist({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  display: 'swap',
});

// Marketing page v2 ("Draw it once. Ship the Terraform.") type system —
// self-hosted via next/font instead of the design's runtime Google Fonts
// <link>, so there's no render-blocking request and no CLS on first paint.
export const spaceGroteskFont = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
  display: 'swap',
});

export const barlowFont = Barlow({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-body-marketing',
  display: 'swap',
});

export const jetBrainsMonoFont = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-mono-marketing',
  display: 'swap',
});

// Whiparc wordmark only (see components/brand/BrandLogo.tsx) — the supplied
// logo artwork sets "whiparc" in Barlow Condensed Bold, so the live-text
// lockup loads that exact face rather than approximating it with the
// marketing display font.
export const barlowCondensedFont = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['700'],
  variable: '--font-brand',
  display: 'swap',
});

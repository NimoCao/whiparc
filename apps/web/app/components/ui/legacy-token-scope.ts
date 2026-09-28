import type { CSSProperties } from 'react';

// Some pieces of the app (InspectorPanel and other workspace views,
// ProjectSettingsModal, CredentialManagerModal) still render through the
// app's original shadcn/Tailwind semantic tokens (bg-card, border-border,
// text-foreground, ...), which are fixed dark-only values in globals.css —
// not the blueprint design system's theme-aware --panel/--ink/--line
// tokens the redesigned chrome around them uses. Rather than rewrite every
// className in those (often large, business-logic-heavy) components, wrap
// their root in `wp-legacy-token-scope` with this style — every existing
// bg-card/border-border/text-foreground/etc class picks up the correct
// theme-aware color for free, since CSS custom properties re-resolve
// through the cascade at each element.
//
// This has to override the `--color-*` tokens (the ones Tailwind v4's
// `@theme` block actually generates utilities from), not the `--background`
// / `--border` / etc tokens those are aliased to in globals.css — Tailwind's
// build step inlines `--color-border: var(--border)` down to a literal hex
// value, so redeclaring `--border` on a descendant has no effect; the
// utility classes only ever read `--color-border`.
//
// Pair with the `.wp-legacy-token-scope` CSS rules (square corners, mono
// uppercase labels) wherever this scope's stylesheet is loaded — see
// workspace.css for the workspace's copy, or add an equivalent import for
// a page that doesn't already have one.
export const LEGACY_TOKEN_SCOPE_STYLE = {
  '--color-background': 'var(--panel)',
  '--color-foreground': 'var(--ink)',
  '--color-card': 'var(--panel)',
  '--color-card-foreground': 'var(--ink)',
  '--color-muted': 'var(--elevated)',
  '--color-muted-foreground': 'var(--ink2)',
  '--color-border': 'var(--line)',
  '--color-input': 'var(--elevated)',
  '--color-primary': 'var(--accent)',
  '--color-primary-foreground': 'var(--on-accent)',
  '--color-secondary': 'var(--elevated)',
  '--color-secondary-foreground': 'var(--ink)',
  '--color-destructive': 'var(--danger)',
  '--color-ring': 'var(--accent-ink)',
  '--radius-lg': '0px',
} as unknown as CSSProperties;

export const LEGACY_TOKEN_SCOPE_CLASS = 'wp-legacy-token-scope';

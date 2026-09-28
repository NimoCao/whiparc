export type Theme = 'dark' | 'light';

// Shared dark/light token set for the Industry-design-system pages (login,
// dashboard, and others as they're ported) — each page owns its own local
// theme state (no cross-page persistence), but they all repaint against
// these same values so switching between them doesn't feel like a
// different product.
export const THEME_PALETTES: Record<Theme, Record<string, string>> = {
  dark: {
    '--ground': '#101114',
    '--panel': '#17181C',
    '--elevated': '#1E1F24',
    '--line': '#2A2C33',
    '--ink': '#F5F5F6',
    '--ink2': '#A3A6AF',
    '--ink3': '#7B7E88',
    '--accent-ink': '#FF8A63',
    '--accent': '#FF6A3D',
    '--accent-hover': '#FF8055',
    '--on-accent': '#101114',
    '--amber': '#F59E0B',
    '--success': '#10B981',
    '--danger': '#F43F5E',
    '--chip': 'rgba(255,255,255,.04)',
    '--k8s-ink': '#7DD3FC',
    '--target-ink': '#5EEAD4',
  },
  light: {
    '--ground': '#F5F5F6',
    '--panel': '#FFFFFF',
    '--elevated': '#FFFFFF',
    '--line': '#E1E2E6',
    '--ink': '#101114',
    '--ink2': '#5A5D66',
    '--ink3': '#6B6E78',
    '--accent-ink': '#C2410C',
    '--accent': '#FF6A3D',
    '--accent-hover': '#F0562A',
    '--on-accent': '#101114',
    '--amber': '#B45309',
    '--success': '#047857',
    '--danger': '#BE123C',
    '--chip': 'rgba(16,17,20,.04)',
    '--k8s-ink': '#0369A1',
    '--target-ink': '#0F766E',
  },
};

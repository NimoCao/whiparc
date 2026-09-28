export type ThemeMode = 'scroll' | 'dark' | 'light';
export type Band = 'dark' | 'light';

export const PALETTES: Record<Band, Record<string, string>> = {
  dark: {
    '--ground': '#101114',
    '--panel': '#17181C',
    '--line': '#2A2C33',
    '--ink': '#F5F5F6',
    '--ink2': '#A3A6AF',
    '--accent-ink': '#FF8A63',
    '--accent': '#FF6A3D',
    '--on-accent': '#101114',
    '--amber': '#F59E0B',
    '--success': '#10B981',
    '--chip': 'rgba(255,255,255,.04)',
    '--ink3': '#7B7E88',
    '--k8s-ink': '#7DD3FC',
    '--target-ink': '#5EEAD4',
  },
  light: {
    '--ground': '#F5F5F6',
    '--panel': '#FFFFFF',
    '--line': '#E1E2E6',
    '--ink': '#101114',
    '--ink2': '#5A5D66',
    '--accent-ink': '#C2410C',
    '--accent': '#FF6A3D',
    '--on-accent': '#101114',
    '--amber': '#B45309',
    '--success': '#047857',
    '--chip': 'rgba(16,17,20,.04)',
    '--ink3': '#6B6E78',
    '--k8s-ink': '#0369A1',
    '--target-ink': '#0F766E',
  },
};

export const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

// Symmetric ease-in/ease-out for scroll-scrubbed (not duration-based)
// animation — slow at both ends of the 0-1 range, fast through the middle.
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

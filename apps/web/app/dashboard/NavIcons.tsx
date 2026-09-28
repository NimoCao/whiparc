// Sidebar nav glyphs — kept as raw inline SVGs (not @iconify) to match the
// design's exact stroke paths pixel-for-pixel.

const common = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 } as const;

export function GridIcon() {
  return (
    <svg {...common}>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  );
}

export function FolderIcon() {
  return (
    <svg {...common}>
      <path d="M3 7h6l2 2h10v10H3z" />
    </svg>
  );
}

export function LayoutIcon() {
  return (
    <svg {...common}>
      <rect x="3" y="3" width="18" height="18" />
      <path d="M3 9h18M9 21V9" />
    </svg>
  );
}

export function ActivityIcon() {
  return (
    <svg {...common}>
      <path d="M3 12h4l3 7 4-14 3 7h4" />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg {...common}>
      <rect x="4" y="10" width="16" height="11" />
      <path d="M8 10V7a4 4 0 018 0v3" />
    </svg>
  );
}

export function UsersIcon() {
  return (
    <svg {...common}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5.5a3 3 0 010 5.7M18 20c0-2.4-1-4.5-2.5-5.6" />
    </svg>
  );
}

export function BookIcon() {
  return (
    <svg {...common}>
      <path d="M4 4h7v16H4zM13 4h7v16h-7z" />
    </svg>
  );
}

'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@iconify/react';
import { BlueprintCorners } from './ui/BlueprintCorners';
import type { Project, Template } from '../lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

interface NavEntry {
  key: string;
  label: string;
  href: string;
}

interface CommandPaletteProps {
  onClose: () => void;
  projects: Project[];
  navItems: NavEntry[];
}

interface PaletteItem {
  id: string;
  group: 'Navigate' | 'Projects' | 'Templates';
  label: string;
  sublabel?: string;
  href: string;
  icon: string;
}

// Client-side only for now (indexes nav destinations + whatever's already
// loaded/fetched), per product-memory 08.5 item A8. A server-side
// GET /api/search?q= is explicitly deferred there until it's actually
// needed — this covers the same ground at current project/template counts.
export function CommandPalette({ onClose, projects, navItems }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Palette is only ever mounted while open (see DashboardV2), so a fresh
  // mount already starts query/activeIndex at their initial values — no
  // reset-on-open effect needed. This effect is left with only the one
  // genuine external-system side effect: focusing the input.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  // Templates are public and small in number — fetched once per session
  // (kept in state, not re-fetched on every open) rather than wiring
  // through a shared cache for a palette that's opened occasionally.
  useEffect(() => {
    if (templates.length > 0) return;
    let cancelled = false;
    fetch(`${API_URL}/api/templates?limit=100`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.templates) setTemplates(data.templates);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [templates.length]);

  const items = useMemo<PaletteItem[]>(() => {
    const navResults: PaletteItem[] = navItems.map((n) => ({
      id: `nav-${n.key}`,
      group: 'Navigate',
      label: n.label,
      href: n.href,
      icon: 'lucide:arrow-right',
    }));
    const projectResults: PaletteItem[] = projects
      .filter((p) => p.user_role)
      .map((p) => ({
        id: `project-${p.id}`,
        group: 'Projects',
        label: p.name,
        sublabel: p.description || undefined,
        href: `/workspace?project=${p.id}`,
        icon: 'lucide:folder',
      }));
    const templateResults: PaletteItem[] = templates.map((t) => ({
      id: `template-${t.id}`,
      group: 'Templates',
      label: t.title,
      sublabel: t.category || undefined,
      href: `/templates/${t.id}`,
      icon: 'lucide:layout-template',
    }));
    const all: PaletteItem[] = [...navResults, ...projectResults, ...templateResults];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((it) => it.label.toLowerCase().includes(q) || it.sublabel?.toLowerCase().includes(q));
  }, [navItems, projects, templates, query]);

  // Reset the highlighted row whenever the query changes, computed during
  // render rather than in an effect (react-hooks/set-state-in-effect) —
  // this is the "adjusting state when a prop changes" pattern from
  // https://react.dev/learn/you-might-not-need-an-effect.
  const [prevQuery, setPrevQuery] = useState(query);
  if (query !== prevQuery) {
    setPrevQuery(query);
    setActiveIndex(0);
  }

  const activate = (item: PaletteItem) => {
    onClose();
    router.push(item.href);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, items.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (items[activeIndex]) activate(items[activeIndex]);
    }
  };

  let lastGroup = '';

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '12vh', background: 'rgba(0,0,0,.7)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="wp-blueprint"
        style={{ position: 'relative', width: '100%', maxWidth: 560, maxHeight: '60vh', display: 'flex', flexDirection: 'column', background: 'var(--panel)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <BlueprintCorners />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <Icon icon="lucide:search" width={16} style={{ color: 'var(--ink3)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Jump to a project, template, or page…"
            style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent', fontSize: 15, color: 'var(--ink)', fontFamily: 'var(--font-body-marketing), sans-serif' }}
          />
          <span style={{ fontFamily: 'var(--font-mono-marketing)', fontSize: 10.5, color: 'var(--ink3)', border: '1px solid var(--line)', padding: '2px 6px', flexShrink: 0 }}>ESC</span>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
          {items.length === 0 ? (
            <p style={{ margin: 0, padding: '20px 16px', fontSize: 13.5, color: 'var(--ink2)' }}>No matches.</p>
          ) : (
            items.map((item, i) => {
              const showGroupHeader = item.group !== lastGroup;
              lastGroup = item.group;
              return (
                <div key={item.id}>
                  {showGroupHeader && (
                    <p style={{ margin: 0, padding: '8px 16px 4px', fontFamily: 'var(--font-mono-marketing)', fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink3)' }}>
                      {item.group}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => activate(item)}
                    onMouseEnter={() => setActiveIndex(i)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      width: '100%',
                      padding: '9px 16px',
                      border: 0,
                      background: i === activeIndex ? 'var(--accent)' : 'transparent',
                      color: i === activeIndex ? 'var(--on-accent)' : 'var(--ink)',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontSize: 14,
                    }}
                  >
                    <Icon icon={item.icon} width={15} style={{ flexShrink: 0, opacity: 0.8 }} />
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
                    {item.sublabel && (
                      <span style={{ fontSize: 12, color: i === activeIndex ? 'rgba(255,255,255,.75)' : 'var(--ink2)', flexShrink: 0, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.sublabel}
                      </span>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

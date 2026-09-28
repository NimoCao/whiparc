'use client';

import React, { useState, useRef, useEffect, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Icon } from '@iconify/react';
import { clsx } from 'clsx';
import { useAuthStore } from '../store/useAuthStore';

interface ProfileMenuProps {
  variant?: 'default' | 'compact';
  /** Blueprint design-system look (hairline borders, square corners, mono
      labels, theme-aware --panel/--line/--ink colors) instead of the
      shadcn rounded/dark-only style used elsewhere in the app — for pages
      that are part of that redesign, currently just the workspace header. */
  blueprint?: boolean;
}

const blueprintMenuItemStyle: CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '7px 9px',
  fontSize: 12.5,
  color: 'var(--ink)',
  background: 'none',
  border: 0,
  cursor: 'pointer',
};

export default function ProfileMenu({ variant = 'default', blueprint = false }: ProfileMenuProps) {
  const router = useRouter();
  const { user, hasHydrated, logout } = useAuthStore();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  const handleLogout = () => {
    setOpen(false);
    logout();
    router.push('/');
  };

  // Avoid a flash of logged-out UI while the persisted store rehydrates
  if (!hasHydrated) {
    return <div className="h-8 w-8" />;
  }

  if (!user) {
    return (
      <Link
        href="/login"
        className={clsx(
          "text-sm font-medium transition-colors",
          blueprint
            ? undefined
            : variant === 'compact'
              ? "px-3 py-1.5 rounded-lg border border-border bg-card text-foreground hover:bg-secondary"
              : "px-4 py-2 text-muted-foreground hover:text-foreground"
        )}
        style={blueprint ? { padding: '5px 12px', border: '1px solid var(--line)', color: 'var(--ink)' } : undefined}
      >
        Sign In
      </Link>
    );
  }

  if (blueprint) {
    return (
      <div className="relative" ref={containerRef}>
        <button
          onClick={() => setOpen((v) => !v)}
          className="wp-ws-iconbtn"
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 8px 3px 3px', border: '1px solid var(--line)', background: 'transparent', cursor: 'pointer' }}
          title={user.name}
        >
          <div
            style={{
              height: 24,
              width: 24,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10,
              fontWeight: 700,
              textTransform: 'uppercase',
              fontFamily: 'var(--font-display, inherit)',
              background: 'var(--accent)',
              color: 'var(--on-accent)',
            }}
          >
            {user.name.slice(0, 2)}
          </div>
          <Icon
            icon="lucide:chevron-down"
            width={11}
            className={clsx("transition-transform hidden sm:block", open && "rotate-180")}
            style={{ color: 'var(--ink2)' }}
          />
        </button>

        {open && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setOpen(false)} />
            <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, width: 210, background: 'var(--panel)', border: '1px solid var(--line)', zIndex: 50, padding: 4 }}>
              <div style={{ padding: '9px 9px 10px', borderBottom: '1px solid var(--line)', marginBottom: 4 }}>
                <p style={{ margin: 0, fontFamily: 'var(--font-display, inherit)', fontWeight: 600, fontSize: 13, color: 'var(--ink)' }} className="truncate">
                  {user.name}
                </p>
                <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--ink2)' }} className="truncate">
                  {user.email}
                </p>
              </div>

              <Link href="/" onClick={() => setOpen(false)} className="wp-ws-navlink" style={blueprintMenuItemStyle}>
                <Icon icon="lucide:home" width={12} style={{ color: 'var(--ink3)' }} />
                Home
              </Link>
              <Link href="/dashboard" onClick={() => setOpen(false)} className="wp-ws-navlink" style={blueprintMenuItemStyle}>
                <Icon icon="lucide:layout-dashboard" width={12} style={{ color: 'var(--ink3)' }} />
                Dashboard
              </Link>

              <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />

              <button onClick={handleLogout} className="wp-ws-navlink" style={{ ...blueprintMenuItemStyle, color: 'var(--danger)' }}>
                <Icon icon="lucide:log-out" width={12} />
                Logout
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-2 py-1.5 rounded-xl border border-border bg-card/60 hover:bg-card transition-colors cursor-pointer"
        title={user.name}
      >
        <div className="h-7 w-7 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold uppercase border border-primary/20 flex-shrink-0">
          {user.name.slice(0, 2)}
        </div>
        <Icon icon="lucide:chevron-down" className={clsx("text-xs text-muted-foreground transition-transform hidden sm:block", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-card border border-border rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="px-3.5 py-3 border-b border-border">
            <p className="text-sm font-semibold text-foreground truncate">{user.name}</p>
            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
          </div>
          <div className="p-1">
            <Link
              href="/"
              onClick={() => setOpen(false)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg text-foreground hover:bg-muted transition-colors"
            >
              <Icon icon="lucide:home" className="text-base text-muted-foreground" />
              Home
            </Link>
            <Link
              href="/dashboard"
              onClick={() => setOpen(false)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg text-foreground hover:bg-muted transition-colors"
            >
              <Icon icon="lucide:layout-dashboard" className="text-base text-muted-foreground" />
              Dashboard
            </Link>
          </div>
          <div className="p-1 border-t border-border">
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
            >
              <Icon icon="lucide:log-out" className="text-base" />
              Logout
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

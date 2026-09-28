'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@iconify/react';
import { motion } from 'framer-motion';
import { THEME_PALETTES } from './ui/theme-palette';
import { spaceGroteskFont, barlowFont, jetBrainsMonoFont } from '../fonts';
import './ui/blueprint.css';
import '../templates/templates.css';

// The Canva-style popup shell for the intercepting route at
// app/@modal/(.)templates/[id]/page.tsx. Closes on Escape, on an outside
// (backdrop) click, and via the close button — all three call router.back()
// so the URL correctly reverts to /templates rather than navigating away.
// See product-memory 10.1 for why this is an intercepting route (URL-backed
// popup, not plain client-side modal state) and its one accepted gap: no
// exit animation on close, since animating a route-driven unmount here would
// need AnimatePresence wired at the root layout around the parallel slot —
// left as a follow-up rather than expanding this pass's scope.
//
// Always renders in dark theme (no local toggle here — the intercepted
// popup has no header of its own to put one in, and the standalone page at
// templates/[id]/page.tsx already carries its own toggle for the non-modal
// case) — matches the mockup's default and keeps the popup's own chrome
// simple.
export function TemplateModal({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const close = () => router.back();
  const palette = THEME_PALETTES.dark;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto px-4 py-10 sm:py-16"
      style={{ background: 'rgba(0,0,0,.7)', backdropFilter: 'blur(4px)' }}
      onClick={close}
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className={`relative w-full max-w-4xl ${spaceGroteskFont.variable} ${barlowFont.variable} ${jetBrainsMonoFont.variable}`}
        style={{ ...(palette as React.CSSProperties), border: '1px solid var(--line)', background: 'var(--panel)', padding: 'clamp(20px,3vw,40px)', fontFamily: 'var(--font-body-marketing), system-ui, sans-serif' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="wp-templates-iconbtn"
          style={{ position: 'absolute', top: 16, right: 16, zIndex: 10, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)', background: 'var(--ground)', color: 'var(--ink2)', cursor: 'pointer' }}
        >
          <Icon icon="lucide:x" width={16} />
        </button>
        {children}
      </motion.div>
    </div>
  );
}

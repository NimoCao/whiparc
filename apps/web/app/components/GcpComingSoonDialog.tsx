'use client';

import { useEffect } from 'react';
import { Icon } from '@iconify/react';
import { BlueprintCorners } from './ui/BlueprintCorners';
import './ui/blueprint.css';

interface GcpComingSoonDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

// Shown when a GCP Target lands on the canvas. The GCP compile + deploy path
// has not been tested end to end yet, so the node can be placed and
// configured but users are told up front not to expect a working GCP deploy.
export function GcpComingSoonDialog({ isOpen, onClose }: GcpComingSoonDialogProps) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(2px)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="gcp-coming-soon-title"
        onClick={(e) => e.stopPropagation()}
        className="wp-blueprint"
        style={{ position: 'relative', width: 400, maxWidth: '100%', background: 'var(--panel)', padding: '26px 26px 22px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 12 }}
      >
        <BlueprintCorners />
        <Icon icon="lucide:cloud" width={28} style={{ color: 'var(--accent-ink)' }} />
        <h3 id="gcp-coming-soon-title" style={{ margin: 0, fontFamily: 'var(--font-display, inherit)', fontWeight: 600, fontSize: 18, color: 'var(--ink)' }}>
          GCP cloud support coming soon..
        </h3>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--ink2)' }}>
          Deploying to Google Cloud is still being tested end to end. You can place the GCP Target on your canvas, but use the AWS Target for deploys that work today.
        </p>
        <button
          type="button"
          autoFocus
          onClick={onClose}
          style={{ marginTop: 6, height: 34, padding: '0 22px', fontSize: 13.5, fontWeight: 600, background: 'var(--accent)', color: 'var(--on-accent)', border: 0, cursor: 'pointer' }}
        >
          Got it
        </button>
      </div>
    </div>
  );
}

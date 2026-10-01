'use client';

import React, { useEffect, useState } from 'react';
import { Icon } from '@iconify/react';
import { BlueprintCorners } from './ui/BlueprintCorners';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

interface Snapshot {
  id: string;
  version: number;
  commitMessage: string;
  createdByName: string;
  createdAt: string;
}

interface SnapshotHistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  token: string | null;
  /** Called with the reverted-to nodes/edges JSON after a successful revert
      so the caller can load them into the live canvas — this component only
      talks to the API, it never touches React Flow state directly. */
  onReverted: () => void;
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function SnapshotHistoryDrawer({ isOpen, onClose, projectId, token, onReverted }: SnapshotHistoryDrawerProps) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [reverting, setReverting] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !token) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-open, same convention as DashboardV2.fetchData/CredentialManagerModal.fetchCredentials
    setLoading(true);
    setError(null);
    fetch(`${API_URL}/api/projects/${projectId}/snapshots`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Failed to load history'))))
      .then((data: Snapshot[]) => {
        if (!cancelled) setSnapshots(data);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load deploy history.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, projectId, token]);

  const handleRevert = async (snapshotId: string) => {
    if (!token) return;
    setReverting(snapshotId);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/projects/${projectId}/snapshots/${snapshotId}/revert`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to revert to that checkpoint.');
      setConfirmingId(null);
      onReverted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revert to that checkpoint.');
    } finally {
      setReverting(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(2px)', zIndex: 50, display: 'flex', justifyContent: 'flex-end' }} onClick={onClose}>
      <div
        className="wp-blueprint"
        style={{ position: 'relative', width: 'min(420px, 92vw)', height: '100%', background: 'var(--panel)', padding: 20, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <BlueprintCorners />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display, inherit)', fontWeight: 600, fontSize: 16, color: 'var(--ink)' }}>Deploy history</h2>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 0, color: 'var(--ink2)', cursor: 'pointer', display: 'flex' }}>
            <Icon icon="lucide:x" width={16} />
          </button>
        </div>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink3)' }}>
          A checkpoint of the canvas is saved after every successful deploy or destroy. Reverting restores the canvas to that point — it doesn&apos;t redeploy anything by itself.
        </p>

        {error && (
          <div style={{ padding: '8px 12px', fontSize: 12.5, border: '1px solid var(--danger)', color: 'var(--danger)' }}>{error}</div>
        )}

        {loading ? (
          <p style={{ fontSize: 13, color: 'var(--ink3)' }}>Loading…</p>
        ) : snapshots.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--ink3)' }}>No deploy checkpoints yet — deploy or destroy this project once to see history here.</p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {snapshots.map((s) => (
              <div key={s.id} style={{ border: '1px solid var(--line)', padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>{s.commitMessage || `Checkpoint v${s.version}`}</p>
                  <span style={{ fontSize: 11, color: 'var(--ink3)', whiteSpace: 'nowrap' }}>{timeAgo(s.createdAt)}</span>
                </div>
                <p style={{ margin: '4px 0 0', fontSize: 11.5, color: 'var(--ink3)' }}>{s.createdByName}</p>

                {confirmingId === s.id ? (
                  <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => handleRevert(s.id)}
                      disabled={reverting === s.id}
                      style={{ flex: 1, height: 28, fontSize: 12, background: 'var(--danger)', color: '#fff', border: 0, cursor: 'pointer' }}
                    >
                      {reverting === s.id ? 'Reverting…' : 'Replace current canvas'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingId(null)}
                      style={{ flex: 1, height: 28, fontSize: 12, background: 'transparent', color: 'var(--ink2)', border: '1px solid var(--line)', cursor: 'pointer' }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingId(s.id)}
                    style={{ marginTop: 8, height: 28, padding: '0 10px', fontSize: 12, background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer' }}
                  >
                    Revert to this
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@iconify/react';
import { useAuthStore } from '../../store/useAuthStore';
import { THEME_PALETTES, type Theme } from '../../components/ui/theme-palette';
import { spaceGroteskFont, barlowFont, jetBrainsMonoFont } from '../../fonts';
import type { PipelineRun } from '../../lib/types';
import '../../components/ui/blueprint.css';
import '../runs.css';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

const DOT: Record<PipelineRun['status'], string> = {
  SUCCESS: 'var(--accent-ink)',
  FAILED: 'var(--danger)',
  RUNNING: 'var(--amber)',
  PENDING: 'var(--ink3)',
};

function formatDuration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

const isLive = (status: PipelineRun['status']) => status === 'PENDING' || status === 'RUNNING';

// Standalone, directly-navigable /runs/{id} deep link — product-memory 08.5
// item C3. Fetches the run once via GET /api/runs/{id} and, only while the
// run is still PENDING/RUNNING, connects the same /api/ws/runs/{id} stream
// the workspace console uses for a real live tail, instead of the runs
// table's static-snapshot log modal. Both endpoints are now project-scoped
// (see the access-control note alongside main.go's handleGetRunByID) — this
// page is the first real caller of either, so that gap would otherwise have
// shipped wide open the moment this page linked to it.
export default function RunDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user, token, hasHydrated } = useAuthStore();
  const [theme, setTheme] = useState<Theme>('dark');
  const [run, setRun] = useState<PipelineRun | null>(null);
  const [logs, setLogs] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);
  const logRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    if (hasHydrated && !user) router.replace('/login');
  }, [hasHydrated, user, router]);

  const loadRun = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/runs/${params.id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 404) throw new Error('Run not found, or you do not have access to its project.');
      if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
      const data: PipelineRun = await res.json();
      setRun(data);
      setLogs(data.logs || '');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load run.');
    } finally {
      setIsLoading(false);
    }
  }, [token, params.id]);

  useEffect(() => {
    // Fetching on mount/param change is the intended synchronization with the run API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadRun();
  }, [loadRun]);

  // Connects once per run, only while it's still in a live state. Status
  // updates arrive as "status_change" WS frames and are applied to `run` via
  // a functional update below — that write does not re-run this effect
  // (run?.id is unchanged), so the connection is held open for the run's
  // full lifetime rather than being torn down and reopened on every frame.
  useEffect(() => {
    if (!run || !token || !isLive(run.status)) return;

    // The tracker this connects to always replays its full accumulated log
    // as one frame on connect (see handleWebSocket in apps/api/main.go) —
    // resetting here avoids double-appending the slice already captured by
    // the GET above.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLogs('');

    // Guards against a message from THIS effect run's socket landing after
    // cleanup has already fired — closing a WebSocket doesn't synchronously
    // discard a message already in flight, and React (StrictMode in dev, or
    // a genuine rapid remount) can mount/cleanup/remount this effect before
    // that message arrives. Without this, the old socket's late "log" frame
    // (a full replay of the tracker's accumulated log — see handleWebSocket)
    // appends on top of the new socket's own full replay, visibly
    // duplicating the entire log. Caught via live QA against a real running
    // deploy, not a hypothetical.
    let cancelled = false;

    const apiHost = process.env.NEXT_PUBLIC_API_URL ? process.env.NEXT_PUBLIC_API_URL.replace(/^http/, 'ws') : 'ws://localhost:8080';
    const ws = new WebSocket(`${apiHost}/api/ws/runs/${params.id}?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      if (cancelled) return;
      try {
        const wsData = JSON.parse(event.data);
        if (wsData.type === 'status_change') {
          setRun((prev) => (prev ? { ...prev, status: wsData.status } : prev));
        } else if (wsData.type === 'log') {
          setLogs((prev) => prev + wsData.message);
        }
      } catch {
        // ignore malformed frames
      }
    };

    return () => {
      cancelled = true;
      ws.close();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id, token, params.id]);

  // Close the socket as soon as the run reaches a terminal state, rather
  // than waiting on it to error out from the server-side tracker cleanup.
  useEffect(() => {
    if (run && !isLive(run.status) && wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    // Deliberately keyed on run?.status alone, not the whole `run` object —
    // this only needs to react to a status transition, not every field
    // change (e.g. the status_change handler above also updates the same
    // object, which would otherwise re-fire this on every message).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.status]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const palette = THEME_PALETTES[theme];
  const rootVars = useMemo(
    () =>
      ({
        ...palette,
        background: palette['--ground'],
        color: palette['--ink'],
      }) as CSSProperties,
    [palette]
  );

  return (
    <div
      className={`${spaceGroteskFont.variable} ${barlowFont.variable} ${jetBrainsMonoFont.variable}`}
      style={{ ...rootVars, minHeight: '100vh', fontFamily: 'var(--font-body-marketing), system-ui, sans-serif', transition: 'background .3s ease, color .3s ease' }}
    >
      <header style={{ height: 56, display: 'flex', alignItems: 'center', gap: 14, padding: '0 clamp(16px,3vw,28px)', borderBottom: '1px solid var(--line)', position: 'sticky', top: 0, background: 'var(--ground)', zIndex: 20 }}>
        <Link href="/runs" className="wp-runs-iconbtn" style={{ display: 'flex', alignItems: 'center', color: 'var(--ink2)' }} title="Back to Runs">
          <Icon icon="lucide:arrow-left" width={15} />
        </Link>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>Runs</span>
        {run && (
          <span style={{ fontFamily: 'var(--font-mono-marketing)', fontSize: 12.5, color: 'var(--ink3)' }}>/ {run.id.slice(0, 10)}</span>
        )}
        <button
          type="button"
          onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
          title="Toggle theme"
          className="wp-runs-iconbtn"
          style={{ marginLeft: 'auto', width: 30, height: 30, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink2)', cursor: 'pointer' }}
        >
          <Icon icon={theme === 'light' ? 'lucide:moon' : 'lucide:sun'} width={14} />
        </button>
      </header>

      <main style={{ maxWidth: 900, margin: '0 auto', padding: 'clamp(24px,4vw,40px) clamp(16px,3vw,28px) 64px', display: 'grid', gap: 20 }}>
        {isLoading ? (
          <div style={{ padding: '60px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: 'var(--ink3)' }}>
            <Icon icon="lucide:loader-2" className="animate-spin" width={24} style={{ color: 'var(--accent)' }} />
            <p style={{ margin: 0, fontSize: 12 }}>Loading run...</p>
          </div>
        ) : error ? (
          <div style={{ padding: '60px 24px', border: '1px dashed var(--danger)', background: 'color-mix(in srgb, var(--danger) 6%, transparent)', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
            <Icon icon="lucide:alert-circle" width={24} style={{ color: 'var(--danger)', marginBottom: 8 }} />
            <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)' }}>{error}</p>
          </div>
        ) : run ? (
          <>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'clamp(22px,3vw,28px)', lineHeight: 1.1, color: 'var(--ink)' }}>
                  Run {run.id.slice(0, 10)}
                </h1>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ink)' }}>
                  <span style={{ width: 7, height: 7, borderRadius: isLive(run.status) ? '50%' : 0, background: DOT[run.status] }} className={isLive(run.status) ? 'wp-runs-live-dot' : undefined} />
                  {run.status.toLowerCase()}
                </span>
              </div>
              {run.triggeredBy && (
                <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--ink2)' }}>Triggered by {run.triggeredBy.name}</p>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 14 }}>
              <div style={{ border: '1px solid var(--line)', padding: '12px 14px' }}>
                <p style={{ margin: 0, fontFamily: 'var(--font-mono-marketing)', fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink3)' }}>Type</p>
                <p style={{ margin: '5px 0 0', fontSize: 14, color: 'var(--ink)' }}>{run.runType?.toLowerCase() ?? '—'}</p>
              </div>
              <div style={{ border: '1px solid var(--line)', padding: '12px 14px' }}>
                <p style={{ margin: 0, fontFamily: 'var(--font-mono-marketing)', fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink3)' }}>Target</p>
                <p style={{ margin: '5px 0 0', fontSize: 14, color: 'var(--ink)' }}>{run.target ?? '—'}</p>
              </div>
              <div style={{ border: '1px solid var(--line)', padding: '12px 14px' }}>
                <p style={{ margin: 0, fontFamily: 'var(--font-mono-marketing)', fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink3)' }}>Duration</p>
                <p style={{ margin: '5px 0 0', fontSize: 14, color: 'var(--ink)' }}>{formatDuration(run.createdAt, run.updatedAt)}</p>
              </div>
              <div style={{ border: '1px solid var(--line)', padding: '12px 14px' }}>
                <p style={{ margin: 0, fontFamily: 'var(--font-mono-marketing)', fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink3)' }}>Started</p>
                <p style={{ margin: '5px 0 0', fontSize: 14, color: 'var(--ink)' }}>{formatTimestamp(run.createdAt)}</p>
              </div>
              {run.projectId && (
                <div style={{ border: '1px solid var(--line)', padding: '12px 14px' }}>
                  <p style={{ margin: 0, fontFamily: 'var(--font-mono-marketing)', fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink3)' }}>Project</p>
                  <Link href={`/workspace?projectId=${run.projectId}`} className="wp-runs-navlink" style={{ display: 'block', margin: '5px 0 0', fontSize: 14, color: 'var(--accent-ink)' }}>
                    Open workspace
                  </Link>
                </div>
              )}
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <p style={{ margin: 0, fontFamily: 'var(--font-mono-marketing)', fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink3)' }}>
                  {isLive(run.status) ? 'Live log' : 'Log'}
                </p>
                {isLive(run.status) && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--amber)' }}>
                    <span className="wp-runs-live-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--amber)' }} />
                    streaming
                  </span>
                )}
              </div>
              <pre
                ref={logRef}
                style={{ margin: 0, maxHeight: '55vh', overflow: 'auto', background: '#101114', border: '1px solid #2A2C33', padding: 14, fontFamily: 'var(--font-mono-marketing), monospace', fontSize: 12, lineHeight: 1.6, color: '#CBD5E1', whiteSpace: 'pre-wrap' }}
              >
                {logs || '(no logs recorded for this run yet)'}
              </pre>
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}

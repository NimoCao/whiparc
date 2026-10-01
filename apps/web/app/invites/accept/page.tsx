'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@iconify/react';
import { useAuthStore } from '../../store/useAuthStore';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

// Product-memory 08.5 item E1. Standalone page (same pattern as
// /verify-email) for POST /api/invites/{token}/accept — the link an invite
// email points to. Requires the recipient to already be signed in as the
// exact email the invite was sent to; an unauthenticated visitor is bounced
// to /login with ?redirect back here (LoginPageV2 already honors that param).
function AcceptInviteContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token');
  const { user, hasHydrated, token: authToken } = useAuthStore();

  const [status, setStatus] = useState<'idle' | 'accepting' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!hasHydrated || !token) return;
    if (!user || !authToken) return; // rendered branch below handles the sign-in prompt

    let cancelled = false;
    (async () => {
      setStatus('accepting');
      try {
        const res = await fetch(`${API_URL}/api/invites/${encodeURIComponent(token)}/accept`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (cancelled) return;
        if (!res.ok) {
          const detail = (await res.text().catch(() => '')).trim();
          throw new Error(detail || `Request failed with status ${res.status}`);
        }
        setStatus('success');
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          setMessage(err instanceof Error ? err.message : 'Failed to accept invite.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasHydrated, token, user, authToken]);

  const containerStyle: React.CSSProperties = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: '#0d1117', color: '#c9d1d9' };
  const cardStyle: React.CSSProperties = { width: '100%', maxWidth: 440, background: '#161b22', border: '1px solid #30363d', borderRadius: 12, padding: 32, textAlign: 'center' };

  if (!token) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <Icon icon="lucide:mail-question" width={40} style={{ color: '#8b949e', marginBottom: 12 }} />
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 8px' }}>Missing invite link</h1>
          <p style={{ fontSize: 13, color: '#8b949e', margin: 0 }}>This page needs a token from an invite email.</p>
        </div>
      </div>
    );
  }

  if (!hasHydrated) {
    return (
      <div style={containerStyle}>
        <Icon icon="lucide:loader-2" className="animate-spin" width={28} style={{ color: '#58a6ff' }} />
      </div>
    );
  }

  if (!user || !authToken) {
    const redirect = `/invites/accept?token=${encodeURIComponent(token)}`;
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <Icon icon="lucide:log-in" width={40} style={{ color: '#58a6ff', marginBottom: 12 }} />
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 8px' }}>Sign in to accept</h1>
          <p style={{ fontSize: 13, color: '#8b949e', margin: '0 0 20px' }}>Sign in with the email this invite was sent to, then you&apos;ll come right back here.</p>
          <Link
            href={`/login?redirect=${encodeURIComponent(redirect)}`}
            style={{ display: 'inline-block', padding: '10px 20px', background: '#238636', color: '#fff', borderRadius: 6, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        {status === 'accepting' || status === 'idle' ? (
          <>
            <Icon icon="lucide:loader-2" className="animate-spin" width={36} style={{ color: '#58a6ff', marginBottom: 12 }} />
            <h1 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 8px' }}>Accepting invite…</h1>
          </>
        ) : status === 'success' ? (
          <>
            <Icon icon="lucide:check-circle-2" width={40} style={{ color: '#3fb950', marginBottom: 12 }} />
            <h1 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 8px' }}>You&apos;re in</h1>
            <p style={{ fontSize: 13, color: '#8b949e', margin: '0 0 20px' }}>You&apos;ve joined the team.</p>
            <button
              type="button"
              onClick={() => router.push('/team')}
              style={{ padding: '10px 20px', background: '#238636', color: '#fff', border: 0, borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
            >
              Go to Team
            </button>
          </>
        ) : (
          <>
            <Icon icon="lucide:alert-triangle" width={40} style={{ color: '#f85149', marginBottom: 12 }} />
            <h1 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 8px' }}>Couldn&apos;t accept invite</h1>
            <p style={{ fontSize: 13, color: '#f85149', background: 'rgba(248,81,73,.1)', border: '1px solid rgba(248,81,73,.3)', borderRadius: 6, padding: '10px 12px', margin: 0 }}>{message}</p>
          </>
        )}
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense
      fallback={
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0d1117' }}>
          <Icon icon="lucide:loader-2" className="animate-spin" width={28} style={{ color: '#58a6ff' }} />
        </div>
      }
    >
      <AcceptInviteContent />
    </Suspense>
  );
}

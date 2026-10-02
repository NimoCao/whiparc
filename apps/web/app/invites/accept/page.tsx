'use client';

import React, { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '../../store/useAuthStore';
import {
  AuthPageShell,
  AuthSpinner,
  AuthHeading,
  AuthNotice,
  AuthPrimaryButton,
  AuthSecondaryButton,
  AuthTextLink,
} from '../../components/ui/AuthPageShell';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

// Mirrors apps/api/teams.go's handleInvitePreview (GET /api/invites/{token}/preview).
interface InvitePreview {
  team_name: string;
  invited_by_name: string;
  email: string;
  role: string;
  status: string;
  expired: boolean;
}

// Product-memory 08.5 item E1. The page an invite email points to.
//
// Three situations, all driven by the invite's own preview (public — the
// recipient may not have an account yet):
//   - signed out: say what's on offer and send them to create an account or
//     sign in, with the invited email prefilled and ?redirect back here;
//   - signed in as a different email than the invite: say so, and offer to
//     sign out (this page then falls into the signed-out case) instead of
//     firing an accept that can only 403;
//   - signed in as the invited email: accept, exactly once.
function AcceptInviteContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token');
  const { user, hasHydrated, token: authToken, logout, setSessionFromToken } = useAuthStore();

  const [preview, setPreview] = useState<InvitePreview | 'loading' | 'notfound'>('loading');
  const [status, setStatus] = useState<'idle' | 'accepting' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [joinedTeamId, setJoinedTeamId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/invites/${encodeURIComponent(token)}/preview`);
        if (cancelled) return;
        setPreview(res.ok ? await res.json() : 'notfound');
      } catch {
        if (!cancelled) setPreview('notfound');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const invite = typeof preview === 'object' ? preview : null;
  const emailMatches = !!(invite && user && invite.email.toLowerCase() === user.email.toLowerCase());

  // One accept request per token. The POST isn't abortable in any useful
  // sense (the server has already acted by the time a cleanup could run), so
  // a re-run of this effect — React StrictMode in dev, or `user` being
  // replaced by the fetchMe() that follows every sign-in — used to fire a
  // second POST whose "no longer valid" reply overwrote the first one's
  // success on screen.
  const acceptedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!token || !authToken || !emailMatches || acceptedFor.current === token) return;
    acceptedFor.current = token;

    (async () => {
      setStatus('accepting');
      try {
        const res = await fetch(`${API_URL}/api/invites/${encodeURIComponent(token)}/accept`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!res.ok) {
          const detail = (await res.text().catch(() => '')).trim();
          throw new Error(detail || `Request failed with status ${res.status}`);
        }
        const data: { team_id: string; token?: string } = await res.json();
        // Accepting can flip email_verified (the invite proves the mailbox),
        // which rides in the JWT — swap to the freshly signed one.
        if (data.token) setSessionFromToken(data.token);
        // Land the person on the team they just joined: the dashboard's team
        // switcher and /team both read this key.
        try {
          localStorage.setItem('whiparc-current-team', data.team_id);
        } catch {
          // storage unavailable — they'll just land on their default team
        }
        setJoinedTeamId(data.team_id);
        setStatus('success');
      } catch (err) {
        setStatus('error');
        setMessage(err instanceof Error ? err.message : 'Failed to accept invite.');
      }
    })();
  }, [token, authToken, emailMatches, setSessionFromToken]);

  if (!token) {
    return (
      <AuthPageShell>
        <AuthHeading title="Missing invite link">This page needs the link from an invite email.</AuthHeading>
        <AuthPrimaryButton href="/dashboard">Go to Dashboard</AuthPrimaryButton>
      </AuthPageShell>
    );
  }

  if (!hasHydrated || preview === 'loading') {
    return (
      <AuthPageShell>
        <AuthSpinner label="Loading invite..." />
      </AuthPageShell>
    );
  }

  if (preview === 'notfound' || !invite) {
    return (
      <AuthPageShell>
        <AuthHeading title="Invite not found" />
        <AuthNotice tone="error">This invite link isn&apos;t valid. Ask the team admin to send a new one.</AuthNotice>
        <AuthPrimaryButton href="/dashboard">Go to Dashboard</AuthPrimaryButton>
      </AuthPageShell>
    );
  }

  const redirect = `/invites/accept?token=${encodeURIComponent(token)}`;
  const authQuery = `email=${encodeURIComponent(invite.email)}&redirect=${encodeURIComponent(redirect)}`;
  const offer = (
    <AuthHeading title={`Join ${invite.team_name}`}>
      {invite.invited_by_name} invited <strong style={{ color: 'var(--ink)' }}>{invite.email}</strong> to join as {invite.role.toLowerCase()}.
    </AuthHeading>
  );

  // Not signed in.
  if (!user || !authToken) {
    if (invite.status !== 'PENDING' || invite.expired) {
      return (
        <AuthPageShell>
          <AuthHeading title="Invite unavailable" />
          <AuthNotice tone="error">
            {invite.status === 'ACCEPTED'
              ? 'This invite has already been used. Sign in to find the team.'
              : 'This invite has expired. Ask the team admin to send a new one.'}
          </AuthNotice>
          <AuthPrimaryButton href={`/login?${authQuery}`}>Sign in</AuthPrimaryButton>
        </AuthPageShell>
      );
    }
    return (
      <AuthPageShell>
        {offer}
        <AuthPrimaryButton href={`/login?mode=signup&${authQuery}`} arrow>
          Create account
        </AuthPrimaryButton>
        <AuthSecondaryButton href={`/login?${authQuery}`}>I already have an account</AuthSecondaryButton>
      </AuthPageShell>
    );
  }

  // Signed in as someone else.
  if (!emailMatches) {
    return (
      <AuthPageShell>
        {offer}
        <AuthNotice tone="error">
          You&apos;re signed in as <strong>{user.email}</strong>, but this invite is for a different address.
        </AuthNotice>
        <AuthPrimaryButton onClick={() => logout()}>Sign out and continue</AuthPrimaryButton>
        <AuthTextLink href="/dashboard">Back to Dashboard</AuthTextLink>
      </AuthPageShell>
    );
  }

  // Signed in as the invitee.
  if (status === 'success') {
    return (
      <AuthPageShell>
        <AuthHeading title={`You've joined ${invite.team_name}`}>Your email is verified and you now have access to the team.</AuthHeading>
        <AuthPrimaryButton onClick={() => router.push(joinedTeamId ? '/team' : '/dashboard')} arrow>
          Go to Team
        </AuthPrimaryButton>
        <AuthTextLink href="/dashboard">Go to Dashboard</AuthTextLink>
      </AuthPageShell>
    );
  }

  if (status === 'error') {
    return (
      <AuthPageShell>
        <AuthHeading title="Couldn't accept invite" />
        <AuthNotice tone="error">{message}</AuthNotice>
        <AuthPrimaryButton href="/dashboard">Go to Dashboard</AuthPrimaryButton>
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell>
      <AuthSpinner label="Joining the team..." />
    </AuthPageShell>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: '#0b0c0f' }} />}>
      <AcceptInviteContent />
    </Suspense>
  );
}

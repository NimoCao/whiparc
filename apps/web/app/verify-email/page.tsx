'use client';

import React, { useEffect, useRef, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '../store/useAuthStore';
import {
  AuthPageShell,
  AuthSpinner,
  AuthHeading,
  AuthNotice,
  AuthPrimaryButton,
  AuthTextLink,
} from '../components/ui/AuthPageShell';

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token');
  const { verifyEmail, resendVerification, user } = useAuthStore();

  const [status, setStatus] = useState<'verifying' | 'success' | 'error' | 'idle'>(token ? 'verifying' : 'idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resendStatus, setResendStatus] = useState<string | null>(null);
  const [isResending, setIsResending] = useState(false);
  const [alreadyVerified, setAlreadyVerified] = useState(false);

  // One verification request per token. The link is single-use, so a second
  // request (React StrictMode re-running this effect in dev, or the store
  // identity changing) would fail with "already used" and overwrite the
  // success the first one already produced.
  const startedForToken = useRef<string | null>(null);

  useEffect(() => {
    if (!token || startedForToken.current === token) return;
    startedForToken.current = token;

    (async () => {
      const result = await verifyEmail(token);
      if (result.success) {
        setStatus('success');
      } else if (useAuthStore.getState().user?.email_verified) {
        // The link is single-use and already spent, but the signed-in account
        // is verified — typically verified another way in the meantime
        // (accepting a team invite verifies the invited address). Telling
        // them "failed" and offering a resend would just be confusing.
        setAlreadyVerified(true);
        setStatus('success');
      } else {
        setStatus('error');
        setErrorMessage(result.error || 'Verification failed. The link may have expired or is invalid.');
      }
    })();
  }, [token, verifyEmail]);

  const handleResend = async () => {
    setIsResending(true);
    setResendStatus(null);
    const result = await resendVerification();
    setIsResending(false);
    if (result.success) {
      setResendStatus('A new verification email has been sent. Check your inbox or server logs.');
    } else if ((result.error || '').toLowerCase().includes('already verified')) {
      // Not a failure from the person's point of view — the goal state
      // (verified) is already true, so say that instead of "Verification Failed".
      setAlreadyVerified(true);
      setStatus('success');
    } else {
      setErrorMessage(result.error || 'Failed to resend verification email.');
    }
  };

  return (
    <AuthPageShell>
      {status === 'verifying' && <AuthSpinner label="Verifying your email..." />}

      {status === 'success' && (
        <>
          <AuthHeading title={alreadyVerified ? 'Already verified' : 'Email verified'}>
            {alreadyVerified
              ? 'This email is already verified — there is nothing more to do.'
              : 'Your account is verified. You now have full access to Whiparc.'}
          </AuthHeading>
          <AuthPrimaryButton onClick={() => router.push('/dashboard')} arrow>
            Continue to Dashboard
          </AuthPrimaryButton>
        </>
      )}

      {status === 'error' && (
        <>
          <AuthHeading title="Verification failed" />
          <AuthNotice tone="error">{errorMessage}</AuthNotice>
          {resendStatus && <AuthNotice tone="success">{resendStatus}</AuthNotice>}
          {user ? (
            <AuthPrimaryButton onClick={handleResend} disabled={isResending}>
              {isResending ? 'Sending link...' : 'Resend verification email'}
            </AuthPrimaryButton>
          ) : (
            <AuthPrimaryButton href="/login">Sign in to resend the link</AuthPrimaryButton>
          )}
          <AuthTextLink href="/dashboard">Back to Dashboard</AuthTextLink>
        </>
      )}

      {status === 'idle' && (
        <>
          <AuthHeading title="Verify your email">
            Check your inbox (or the API logs in local development) for the verification link.
          </AuthHeading>
          <AuthPrimaryButton href="/dashboard">Go to Dashboard</AuthPrimaryButton>
        </>
      )}
    </AuthPageShell>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: '#0b0c0f' }} />}>
      <VerifyEmailContent />
    </Suspense>
  );
}

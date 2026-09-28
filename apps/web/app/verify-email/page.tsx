'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@iconify/react';
import { useAuthStore } from '../store/useAuthStore';

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token');
  const { verifyEmail, resendVerification, user } = useAuthStore();

  const [status, setStatus] = useState<'verifying' | 'success' | 'error' | 'idle'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resendStatus, setResendStatus] = useState<string | null>(null);
  const [isResending, setIsResending] = useState(false);

  useEffect(() => {
    if (!token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus('idle');
      return;
    }

    let isMounted = true;
    const runVerification = async () => {
      setStatus('verifying');
      const result = await verifyEmail(token);
      if (!isMounted) return;

      if (result.success) {
        setStatus('success');
      } else {
        setStatus('error');
        setErrorMessage(result.error || 'Verification failed. The link may have expired or is invalid.');
      }
    };

    runVerification();
    return () => {
      isMounted = false;
    };
  }, [token, verifyEmail]);

  const handleResend = async () => {
    setIsResending(true);
    setResendStatus(null);
    const result = await resendVerification();
    setIsResending(false);
    if (result.success) {
      setResendStatus('A new verification email has been sent! Check your inbox or server logs.');
    } else {
      setErrorMessage(result.error || 'Failed to resend verification email.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl p-8 shadow-2xl text-center">
        {status === 'verifying' && (
          <div className="py-8 space-y-4">
            <Icon icon="lucide:loader-2" className="w-12 h-12 text-primary animate-spin mx-auto" />
            <h2 className="text-xl font-semibold">Verifying your email...</h2>
            <p className="text-sm text-slate-400">Please wait while we confirm your email token.</p>
          </div>
        )}

        {status === 'success' && (
          <div className="py-6 space-y-4">
            <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-full flex items-center justify-center mx-auto">
              <Icon icon="lucide:check-circle-2" className="w-10 h-10" />
            </div>
            <h2 className="text-2xl font-bold text-white">Email Verified!</h2>
            <p className="text-sm text-slate-400">
              Your account has been successfully verified. You now have full access to Whiparc platform features.
            </p>
            <div className="pt-4">
              <button
                onClick={() => router.push('/dashboard')}
                className="w-full py-2.5 px-4 bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-lg transition-colors flex items-center justify-center gap-2 shadow-lg shadow-primary/20"
              >
                Continue to Dashboard
                <Icon icon="lucide:arrow-right" className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="py-6 space-y-4">
            <div className="w-16 h-16 bg-rose-500/10 border border-rose-500/30 text-rose-400 rounded-full flex items-center justify-center mx-auto">
              <Icon icon="lucide:alert-triangle" className="w-10 h-10" />
            </div>
            <h2 className="text-2xl font-bold text-white">Verification Failed</h2>
            <p className="text-sm text-rose-300/90 bg-rose-950/30 border border-rose-800/40 p-3 rounded-lg">
              {errorMessage}
            </p>

            {resendStatus && (
              <p className="text-sm text-emerald-400 bg-emerald-950/30 border border-emerald-800/40 p-3 rounded-lg">
                {resendStatus}
              </p>
            )}

            <div className="pt-4 space-y-2">
              {user ? (
                <button
                  onClick={handleResend}
                  disabled={isResending}
                  className="w-full py-2.5 px-4 bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isResending ? (
                    <>
                      <Icon icon="lucide:loader-2" className="w-4 h-4 animate-spin" />
                      Sending Link...
                    </>
                  ) : (
                    'Resend Verification Email'
                  )}
                </button>
              ) : (
                <Link
                  href="/login"
                  className="block w-full py-2.5 px-4 bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-lg transition-colors"
                >
                  Sign In to Resend Link
                </Link>
              )}

              <Link
                href="/dashboard"
                className="block text-xs text-slate-400 hover:text-slate-200 transition-colors pt-2"
              >
                Back to Dashboard
              </Link>
            </div>
          </div>
        )}

        {status === 'idle' && (
          <div className="py-6 space-y-4">
            <div className="w-16 h-16 bg-primary/10 border border-primary/30 text-primary rounded-full flex items-center justify-center mx-auto">
              <Icon icon="lucide:mail" className="w-10 h-10" />
            </div>
            <h2 className="text-2xl font-bold text-white">Verify Your Email</h2>
            <p className="text-sm text-slate-400">
              Please check your inbox (or backend logs in local development) for the verification link.
            </p>
            <div className="pt-4">
              <Link
                href="/dashboard"
                className="inline-block py-2.5 px-6 bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-lg transition-colors"
              >
                Go to Dashboard
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
          <Icon icon="lucide:loader-2" className="w-8 h-8 animate-spin text-primary" />
        </div>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}

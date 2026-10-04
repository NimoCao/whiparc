'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@iconify/react';
import { useAuthStore } from '../../store/useAuthStore';
import { resolvePostAuthPath } from '../../lib/oauthRedirect';

// Receives the JWT the backend's OAuth callback (apps/api/oauth.go) hands off
// after a successful Google/GitHub sign-in. The token arrives in the URL
// *fragment* (#token=...), not a query param — fragments are never sent to
// any server or written to access logs, unlike query params (see the "JWT
// hand-off" challenge documented in apps/api/oauth.go). window.location.hash
// is only readable client-side, hence this whole page is client-only.
export default function OAuthCallbackPage() {
  const router = useRouter();
  const { setSessionFromToken } = useAuthStore();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
    const params = new URLSearchParams(hash);
    const token = params.get('token');
    const redirect = params.get('redirect');

    if (!token || !setSessionFromToken(token)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the error is the outcome of a side effect (reading window.location.hash and writing the session into the store), which only exists after mount, so it cannot be derived on render
      setError('Sign-in failed. Please try again.');
      return;
    }

    let cancelled = false;
    resolvePostAuthPath(redirect, token).then((path) => {
      if (!cancelled) router.replace(path);
    });
    return () => {
      cancelled = true;
    };
  }, [router, setSessionFromToken]);

  return (
    <div className="min-h-screen w-full bg-background flex items-center justify-center text-slate-400">
      {error ? (
        <div className="flex flex-col items-center gap-3 text-center px-6">
          <Icon icon="lucide:alert-circle" className="text-3xl text-red-400" />
          <p className="text-sm font-medium">{error}</p>
          <button
            onClick={() => router.replace('/login')}
            className="text-primary hover:underline text-sm font-semibold cursor-pointer"
          >
            Back to sign in
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <Icon icon="lucide:loader-2" className="animate-spin text-3xl text-primary" />
          <p className="text-sm font-medium tracking-wide">Completing sign-in...</p>
        </div>
      )}
    </div>
  );
}

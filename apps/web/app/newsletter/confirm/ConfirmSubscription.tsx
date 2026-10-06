'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AuthPageShell, AuthSpinner, AuthHeading, AuthNotice, AuthPrimaryButton, AuthTextLink } from '../../components/ui/AuthPageShell';
import { postCapture } from '../../lib/capture';

type Status = 'confirming' | 'confirmed' | 'error';

function ConfirmContent() {
  const token = useSearchParams().get('token');
  const [status, setStatus] = useState<Status>(token ? 'confirming' : 'error');
  const [error, setError] = useState<string | null>(token ? null : 'This confirmation link is missing its token. Open the link from your email again.');
  const [already, setAlready] = useState(false);

  // The email link is opened with a GET, but confirming is a POST made from
  // here, so a mail scanner that prefetches the link cannot subscribe anyone.
  // One request per token: React StrictMode runs this effect twice in dev.
  const startedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!token || startedFor.current === token) return;
    startedFor.current = token;

    (async () => {
      const result = await postCapture('/api/newsletter/confirm', { token });
      if (result.ok) {
        setAlready(result.data.already === true);
        setStatus('confirmed');
      } else {
        setError(result.message);
        setStatus('error');
      }
    })();
  }, [token]);

  return (
    <AuthPageShell>
      {status === 'confirming' && <AuthSpinner label="Confirming your subscription..." />}

      {status === 'confirmed' && (
        <>
          <AuthHeading title={already ? 'Already confirmed' : "You're subscribed"}>
            {already
              ? 'This address is already confirmed. There is nothing more to do.'
              : 'Thanks for confirming. You will get occasional Whiparc product updates, and every email has an unsubscribe link.'}
          </AuthHeading>
          <AuthPrimaryButton href="/" arrow>
            Back to whiparc
          </AuthPrimaryButton>
        </>
      )}

      {status === 'error' && (
        <>
          <AuthHeading title="Couldn't confirm" />
          <div role="alert">
            <AuthNotice tone="error">{error}</AuthNotice>
          </div>
          <AuthPrimaryButton href="/#top">Subscribe again from the footer</AuthPrimaryButton>
          <AuthTextLink href="/">Back to whiparc</AuthTextLink>
        </>
      )}
    </AuthPageShell>
  );
}

export default function ConfirmSubscription() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: '#101114' }} />}>
      <ConfirmContent />
    </Suspense>
  );
}

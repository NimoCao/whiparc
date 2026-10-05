'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AuthPageShell, AuthHeading, AuthNotice, AuthPrimaryButton, AuthTextLink } from '../../components/ui/AuthPageShell';
import { postCapture } from '../../lib/capture';

type Status = 'ready' | 'working' | 'done';

function UnsubscribeContent() {
  const token = useSearchParams().get('token');
  const [status, setStatus] = useState<Status>('ready');
  const [error, setError] = useState<string | null>(token ? null : 'This unsubscribe link is missing its token. Use the link from the bottom of the email.');

  // Deliberately a button, not an effect on load: a mail client or scanner
  // that merely opens the link must not be able to unsubscribe someone.
  const handleUnsubscribe = async () => {
    if (!token || status === 'working') return;
    setStatus('working');
    setError(null);
    const result = await postCapture('/api/newsletter/unsubscribe', { token });
    if (result.ok) {
      setStatus('done');
    } else {
      setError(result.message);
      setStatus('ready');
    }
  };

  return (
    <AuthPageShell>
      {status === 'done' ? (
        <>
          <AuthHeading title="You're unsubscribed">
            You won&apos;t get any more Whiparc updates at this address. If that was a mistake, you can subscribe again from the footer of the home page.
          </AuthHeading>
          <AuthPrimaryButton href="/" arrow>
            Back to whiparc
          </AuthPrimaryButton>
        </>
      ) : (
        <>
          <AuthHeading title="Unsubscribe">Stop receiving Whiparc product updates at this address?</AuthHeading>
          {error && (
            <div role="alert">
              <AuthNotice tone="error">{error}</AuthNotice>
            </div>
          )}
          {token && (
            <AuthPrimaryButton onClick={handleUnsubscribe} disabled={status === 'working'}>
              {status === 'working' ? 'Unsubscribing...' : 'Unsubscribe'}
            </AuthPrimaryButton>
          )}
          <AuthTextLink href="/">No, take me back</AuthTextLink>
        </>
      )}
    </AuthPageShell>
  );
}

export default function Unsubscribe() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: '#101114' }} />}>
      <UnsubscribeContent />
    </Suspense>
  );
}

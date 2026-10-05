'use client';

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Icon } from '@iconify/react';
import { BlueprintCorners } from '../components/ui/BlueprintCorners';
import { AuthPageShell, AuthHeading, AuthNotice, AuthPrimaryButton, AuthTextLink } from '../components/ui/AuthPageShell';
import { postCapture } from '../lib/capture';

const labelStyle: CSSProperties = {
  fontFamily: 'var(--font-mono-marketing)',
  fontSize: 10,
  letterSpacing: '.1em',
  textTransform: 'uppercase',
  color: 'var(--ink2)',
};

const fieldStyle: CSSProperties = {
  padding: '0 13px',
  border: '1px solid var(--line)',
  background: 'var(--elevated)',
  color: 'var(--ink)',
  fontSize: 14,
  fontFamily: 'var(--font-body-marketing), sans-serif',
  outline: 'none',
  borderRadius: 0,
  width: '100%',
  boxSizing: 'border-box',
};

export default function ContactForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (status === 'loading') return;
    setError(null);

    const website = String(new FormData(e.currentTarget).get('website') ?? '');
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus('loading');
    const result = await postCapture(
      '/api/contact',
      { name: name.trim(), email: email.trim(), message: message.trim(), website },
      controller.signal
    );
    if (controller.signal.aborted) return;

    if (result.ok) {
      setStatus('sent');
    } else {
      setStatus('idle');
      setError(result.message);
    }
  };

  if (status === 'sent') {
    return (
      <AuthPageShell>
        <AuthHeading title="Message sent">
          Thanks, {name.trim() || 'friend'}. We&apos;ll reply to <strong style={{ color: 'var(--ink)' }}>{email.trim()}</strong> as soon as we can.
        </AuthHeading>
        <AuthPrimaryButton href="/" arrow>
          Back to whiparc
        </AuthPrimaryButton>
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell>
      <AuthHeading title="Contact us">Questions, feedback or ideas? Send a message and we&apos;ll reply by email.</AuthHeading>

      {error && (
        <div role="alert">
          <AuthNotice tone="error">{error}</AuthNotice>
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ marginTop: 22, display: 'grid', gap: 14 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={labelStyle}>Name</span>
          <input
            type="text"
            name="name"
            required
            maxLength={100}
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="wp-login-input"
            style={{ ...fieldStyle, height: 42 }}
          />
        </label>

        <label style={{ display: 'grid', gap: 6 }}>
          <span style={labelStyle}>Email address</span>
          <input
            type="email"
            name="email"
            required
            maxLength={254}
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="wp-login-input"
            style={{ ...fieldStyle, height: 42 }}
          />
        </label>

        <label style={{ display: 'grid', gap: 6 }}>
          <span style={labelStyle}>Message</span>
          <textarea
            name="message"
            required
            minLength={10}
            maxLength={4000}
            rows={6}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="wp-login-input"
            style={{ ...fieldStyle, padding: '11px 13px', lineHeight: 1.5, resize: 'vertical', minHeight: 120 }}
          />
        </label>

        {/* Honeypot: invisible to people and assistive tech, tempting to bots. */}
        <div aria-hidden="true" style={{ position: 'absolute', left: -9999, width: 1, height: 1, overflow: 'hidden' }}>
          <label>
            Leave this field empty
            <input type="text" name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>

        <button
          type="submit"
          disabled={status === 'loading'}
          aria-busy={status === 'loading'}
          className="wp-blueprint wp-login-submit"
          style={{
            position: 'relative',
            marginTop: 6,
            height: 44,
            background: 'var(--accent)',
            color: 'var(--on-accent)',
            border: 0,
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            fontSize: 14.5,
            cursor: status === 'loading' ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: status === 'loading' ? 0.7 : 1,
          }}
        >
          <BlueprintCorners />
          {status === 'loading' ? <Icon icon="lucide:loader-2" className="animate-spin" width={16} /> : 'Send message'}
        </button>
      </form>

      <AuthTextLink href="/">Back to whiparc</AuthTextLink>
    </AuthPageShell>
  );
}

'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { postCapture } from '../../lib/capture';

type Status = 'idle' | 'loading' | 'sent' | 'error';

// Footer "Stay in the loop" signup. Double opt-in: a successful response means
// a confirmation email was (or, for a known address, would have been) sent,
// not that anyone is subscribed yet, so the copy says "confirm" rather than
// "subscribed". The API gives the same answer whether or not the address is
// already on the list, so this form cannot reveal that either.
export function NewsletterForm() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (status === 'loading') return;

    const form = new FormData(e.currentTarget);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus('loading');
    setMessage('');
    const result = await postCapture(
      '/api/newsletter/subscribe',
      { email: email.trim(), website: String(form.get('website') ?? ''), source: 'footer' },
      controller.signal
    );
    if (controller.signal.aborted) return;

    if (result.ok) {
      setStatus('sent');
      setMessage('Almost done. Check your inbox and confirm your email to finish subscribing.');
    } else {
      setStatus('error');
      setMessage(result.message);
    }
  };

  if (status === 'sent') {
    return (
      <div role="status" className="wp-foot-note wp-foot-note-ok">
        <p style={{ margin: 0 }}>{message}</p>
        <button
          type="button"
          className="wp-foot-textbtn"
          onClick={() => {
            setStatus('idle');
            setEmail('');
            setMessage('');
          }}
        >
          Use a different address
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} aria-describedby="wp-foot-news-help">
      <div className="wp-foot-field">
        <label htmlFor="wp-foot-email" className="wp-sr-only">
          Email address
        </label>
        <input
          id="wp-foot-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          maxLength={254}
          placeholder="Enter your email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={status === 'error'}
          className="wp-foot-input"
        />
        <button type="submit" disabled={status === 'loading'} className="wp-foot-submit">
          {status === 'loading' ? 'Sending' : 'Subscribe'}
        </button>
      </div>
      {/* Honeypot: invisible to people and assistive tech, tempting to bots. */}
      <div className="wp-hp" aria-hidden="true">
        <label>
          Leave this field empty
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <p id="wp-foot-news-help" className="wp-foot-help">
        Occasional product updates. We email you only after you confirm, and every message has an unsubscribe link.
      </p>
      {status === 'error' && message && (
        <p role="alert" className="wp-foot-note wp-foot-note-err">
          {message}
        </p>
      )}
    </form>
  );
}

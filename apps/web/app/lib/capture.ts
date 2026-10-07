// Client for the public email-capture endpoints (newsletter signup, contact
// form; see apps/api/email_capture.go). Every call resolves to a result
// object instead of throwing, so the three forms that use it can render
// success and failure the same way.

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export type CaptureResult =
  | { ok: true; message: string; data: Record<string, unknown> }
  | { ok: false; message: string; status: number | null };

const GENERIC_ERROR = 'Something went wrong. Please try again.';
const NETWORK_ERROR = "Couldn't reach the server. Check your connection and try again.";

export async function postCapture(path: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<CaptureResult> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    // An aborted request means the component is gone; callers check
    // signal.aborted before touching state, so the message is never shown.
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, message: '', status: null };
    }
    return { ok: false, message: NETWORK_ERROR, status: null };
  }

  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = await res.json();
    if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>;
  } catch {
    // Non-JSON body (a proxy error page, for instance); fall through to the generic message.
  }

  if (res.ok) {
    return { ok: true, message: typeof data.message === 'string' ? data.message : '', data };
  }
  const serverMessage = typeof data.error === 'string' ? data.error : '';
  return {
    ok: false,
    message: serverMessage || (res.status === 429 ? 'Too many requests. Please try again in a little while.' : GENERIC_ERROR),
    status: res.status,
  };
}

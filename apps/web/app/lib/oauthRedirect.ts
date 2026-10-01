// Shared between LoginPageV2 (the OAuth buttons) and /oauth/callback (the
// redirect handoff) so the "resume whatever the user was trying to do"
// continuation logic — including the /templates/{id} fork special case —
// isn't duplicated between a password login and an OAuth login
// (product-memory 08.5 item G5).

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

// Mirrors apps/api/oauth.go's isSafeRedirectPath: same-origin path only, no
// scheme, no protocol-relative "//". The backend re-validates this too —
// this is just so the frontend never sends an unsafe value in the first
// place.
export function isSafeRedirectPath(path: string | null | undefined): path is string {
  if (!path || path[0] !== '/') return false;
  if (path.length > 1 && (path[1] === '/' || path[1] === '\\')) return false;
  if (path.includes('://')) return false;
  return true;
}

export function buildOAuthLoginUrl(provider: 'github' | 'google', redirect?: string | null, linkTicket?: string): string {
  const params = new URLSearchParams();
  if (isSafeRedirectPath(redirect)) params.set('redirect', redirect);
  if (linkTicket) params.set('link_ticket', linkTicket);
  const query = params.toString();
  return `${API_URL}/api/auth/${provider}/login${query ? `?${query}` : ''}`;
}

// Resolves where to land after a successful sign-in (password or OAuth).
// `redirect=/templates/{id}` needs a real POST to complete the fork
// continuation (mirrors LoginPageV2's original continueAfterAuth); anything
// else is just a plain destination. Never throws — worst case falls back to
// the dashboard so a broken continuation never strands the user on a blank
// page.
export async function resolvePostAuthPath(redirect: string | null | undefined, token: string): Promise<string> {
  if (!isSafeRedirectPath(redirect)) return '/dashboard';

  const templateMatch = redirect.match(/^\/templates\/([\w-]+)$/);
  if (templateMatch) {
    const templateId = templateMatch[1];
    try {
      const res = await fetch(`${API_URL}/api/templates/${templateId}/use`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data: { project_id: string } = await res.json();
        return `/workspace?project=${data.project_id}`;
      }
    } catch {
      // fall through — land back on the template page rather than lose the
      // user's place if the fork call itself failed
    }
    return redirect;
  }

  return redirect || '/dashboard';
}

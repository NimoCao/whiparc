import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
  id: string;
  name: string;
  email: string;
  plan: string;
  email_verified: boolean;
  onboarding_dismissed: boolean;
}

interface AuthState {
  token: string | null;
  user: User | null;
  isLoading: boolean;
  error: string | null;
  // Set instead of `error` when signup fails because the email is already
  // registered (HTTP 409). Kept separate from `error` so the login page can
  // route the user to sign-in with a friendly notice instead of rendering
  // the raw backend message in the error banner.
  signupEmailExists: boolean;
  hasHydrated: boolean;
  setHasHydrated: (v: boolean) => void;
  login: (email: string, password: string) => Promise<boolean>;
  signup: (name: string, email: string, password: string) => Promise<boolean>;
  verifyEmail: (token: string) => Promise<{ success: boolean; message?: string; error?: string }>;
  resendVerification: () => Promise<{ success: boolean; message?: string; error?: string }>;
  fetchMe: () => Promise<User | null>;
  dismissOnboarding: () => Promise<void>;
  setSessionFromToken: (token: string) => boolean;
  logout: () => void;
  clearError: () => void;
  upgradePlan: (newPlan: string) => Promise<boolean>;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

const networkErrorMessage = (err: unknown, fallback: string) => {
  const msg = err instanceof Error ? err.message || fallback : fallback;
  if (msg === 'Failed to fetch' || msg.includes('fetch failed') || msg.includes('NetworkError')) {
    return 'Cannot connect to the backend server. Please verify the API service is running and try again.';
  }
  return msg;
};

// Decodes the (already-server-verified) JWT's claims payload client-side so
// we can populate `user` without an extra round trip. This does NOT verify
// the signature — every subsequent API call still goes through the backend's
// AuthMiddleware/VerifyToken, so a tampered token just fails there instead.
function decodeTokenClaims(token: string): User | null {
  try {
    const payload = token.split('.')[1];
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('')
    );
    const claims = JSON.parse(json);
    return {
      id: claims.id,
      email: claims.email,
      name: claims.name,
      plan: claims.plan,
      email_verified: claims.email_verified ?? false,
      // Not carried in the JWT — refreshed by the fetchMe() call setSessionFromToken triggers below.
      onboarding_dismissed: false,
    };
  } catch {
    return null;
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      isLoading: false,
      error: null,
      signupEmailExists: false,
      hasHydrated: false,

      setHasHydrated: (v) => set({ hasHydrated: v }),
      clearError: () => set({ error: null, signupEmailExists: false }),

      login: async (email, password) => {
        set({ isLoading: true, error: null });
        try {
          const res = await fetch(`${API_URL}/api/auth/login`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email, password }),
          });

          if (!res.ok) {
            const errText = await res.text();
            throw new Error(errText || 'Invalid credentials');
          }

          const data = await res.json();
          set({ token: data.token, user: data.user, isLoading: false });
          // The login response's `user` predates onboarding_dismissed for a
          // returning user on a new device/browser (that field only ever
          // gets refreshed via fetchMe, normally triggered by rehydration on
          // the *next* page load) — refresh it now so a user who already
          // dismissed the checklist elsewhere doesn't see it flash back for
          // one session. Fire-and-forget: never blocks the login flow.
          void get().fetchMe();
          return true;
        } catch (err: unknown) {
          set({ error: networkErrorMessage(err, 'Login failed'), isLoading: false });
          return false;
        }
      },

      signup: async (name, email, password) => {
        set({ isLoading: true, error: null, signupEmailExists: false });
        try {
          const res = await fetch(`${API_URL}/api/auth/signup`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ name, email, password }),
          });

          if (!res.ok) {
            // Existing account — surface this as a distinct state instead of
            // a generic error, so the UI can send the user to sign in with a
            // friendly notice rather than showing a raw error banner.
            if (res.status === 409) {
              set({ isLoading: false, signupEmailExists: true });
              return false;
            }
            const errText = await res.text();
            throw new Error(errText || 'Signup failed');
          }

          // Auto login after signup
          set({ isLoading: false });
          return get().login(email, password);
        } catch (err: unknown) {
          set({ error: networkErrorMessage(err, 'Signup failed'), isLoading: false });
          return false;
        }
      },

      verifyEmail: async (token) => {
        set({ isLoading: true, error: null });
        try {
          const res = await fetch(`${API_URL}/api/auth/verify-email`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ token }),
          });

          if (!res.ok) {
            const errText = await res.text();
            throw new Error(errText || 'Verification failed');
          }

          const data = await res.json();
          if (data.token && data.user) {
            set({ token: data.token, user: data.user, isLoading: false });
          } else {
            set({ isLoading: false });
          }
          return { success: true, message: data.message || 'Email verified successfully' };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Verification failed';
          set({ isLoading: false, error: msg });
          return { success: false, error: msg };
        }
      },

      resendVerification: async () => {
        const token = get().token;
        if (!token) {
          return { success: false, error: 'Please sign in first to request a verification link.' };
        }
        try {
          const res = await fetch(`${API_URL}/api/auth/resend-verification`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
          });

          if (!res.ok) {
            const errText = await res.text();
            throw new Error(errText || 'Failed to resend verification email');
          }

          const data = await res.json();
          return { success: true, message: data.message || 'Verification link sent' };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Failed to resend verification link';
          return { success: false, error: msg };
        }
      },

      fetchMe: async () => {
        const token = get().token;
        if (!token) return null;
        try {
          const res = await fetch(`${API_URL}/api/auth/me`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });
          if (!res.ok) {
            if (res.status === 401) {
              get().logout();
            }
            return null;
          }
          const data = await res.json();
          const fetchedUser: User = {
            id: data.id || data.user?.id,
            email: data.email || data.user?.email,
            name: data.name || data.user?.name,
            plan: data.plan || data.user?.plan || 'FREE',
            email_verified: Boolean(data.email_verified ?? data.user?.email_verified),
            onboarding_dismissed: Boolean(data.onboarding_dismissed ?? data.user?.onboarding_dismissed),
          };
          set({ user: fetchedUser });
          return fetchedUser;
        } catch (err: unknown) {
          console.error('Failed to fetch user profile:', err);
          return null;
        }
      },

      dismissOnboarding: async () => {
        const token = get().token;
        const user = get().user;
        if (!token || !user) return;
        // Optimistic — this is a one-way, low-stakes preference; a failed
        // PATCH just means the checklist reappears on next reload, not a
        // state a user could get stuck in.
        set({ user: { ...user, onboarding_dismissed: true } });
        try {
          await fetch(`${API_URL}/api/auth/onboarding`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${token}` },
          });
        } catch (err: unknown) {
          console.error('Failed to persist onboarding dismissal:', err);
        }
      },

      setSessionFromToken: (token) => {
        const user = decodeTokenClaims(token);
        if (!user) return false;
        set({ token, user, error: null });
        // onboarding_dismissed isn't in the JWT (see decodeTokenClaims) — same
        // fire-and-forget refresh as login() below.
        void get().fetchMe();
        return true;
      },

      logout: () => {
        set({ token: null, user: null, error: null });
      },

      upgradePlan: async (newPlan) => {
        const token = get().token;
        if (!token) return false;
        try {
          const res = await fetch(`${API_URL}/api/auth/upgrade`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ plan: newPlan }),
          });

          if (!res.ok) {
            throw new Error('Failed to upgrade plan');
          }

          const data = await res.json();
          set({ token: data.token, user: data.user });
          return true;
        } catch (err: unknown) {
          console.error("Upgrade error", err);
          return false;
        }
      },
    }),
    {
      name: 'whiparc-auth',
      partialize: (state) => ({ token: state.token, user: state.user }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
        if (state?.token) {
          state.fetchMe();
        }
      },
    }
  )
);

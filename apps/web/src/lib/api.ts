/**
 * Thin client over the REAL backend auth surface (mounted at /auth):
 *   GET  /auth/providers                 list configured OAuth providers
 *   GET  /auth/:provider/start           begin an OAuth sign-in (browser redirect)
 *   GET  /auth/me                        current principal (requires auth)
 *   POST /auth/token, /auth/token/refresh, /auth/logout
 *   POST /auth/verify-email              { token }
 *   POST /auth/request-password-reset    { email }
 *   POST /auth/reset-password            { token, password }
 * No mocks: in dev these proxy to the running backend (see vite.config.ts).
 */
const TOKEN_KEY = 'np.web.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(t: string | null) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ''}`);
  }
  return (await res.json()) as T;
}

export interface ProviderInfo {
  id: string;
  name?: string;
}

export const auth = {
  providers: () => req<{ providers: ProviderInfo[] } | ProviderInfo[]>('/auth/providers'),
  startUrl: (provider: string) => `/auth/${encodeURIComponent(provider)}/start`,
  me: () => req<unknown>('/auth/me'),
  logout: () => req<unknown>('/auth/logout', { method: 'POST' }),
  verifyEmail: (token: string) =>
    req<unknown>('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) }),
  requestPasswordReset: (email: string) =>
    req<unknown>('/auth/request-password-reset', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (token: string, password: string) =>
    req<unknown>('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) }),
};

export interface AuthResult {
  user: { id: string; email: string; displayName: string | null };
  tokens: { accessToken: string; refreshToken?: string };
}

export const emailAuth = {
  register: async (email: string, password: string): Promise<AuthResult> => {
    const r = await req<AuthResult>('/auth/email/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setToken(r.tokens.accessToken);
    return r;
  },
  login: async (email: string, password: string): Promise<AuthResult> => {
    const r = await req<AuthResult>('/auth/email/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setToken(r.tokens.accessToken);
    return r;
  },
};

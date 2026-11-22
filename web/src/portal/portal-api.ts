/** API helper for the customer portal — its own token, separate from staff sign-in. */
const KEY = 'zenaa.portal.token';

export function getPortalToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
export function setPortalToken(t: string | null) {
  try {
    if (t) localStorage.setItem(KEY, t);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

let onSignedOut: (() => void) | null = null;
export const onPortalSignedOut = (fn: () => void) => (onSignedOut = fn);

export async function papi<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getPortalToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('Cannot reach the server. Check your internet connection.');
  }
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && token && !path.endsWith('/login') && !path.endsWith('/activate')) {
      setPortalToken(null);
      onSignedOut?.();
    }
    throw new Error(data?.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const pget = <T = any>(p: string) => papi<T>('GET', p);
export const ppost = <T = any>(p: string, b?: unknown) => papi<T>('POST', p, b ?? {});
export const ppatch = <T = any>(p: string, b: unknown) => papi<T>('PATCH', p, b);
export const pdel = <T = any>(p: string) => papi<T>('DELETE', p);

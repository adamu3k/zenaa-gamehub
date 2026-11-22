const TOKEN_KEY = 'zenaa.token';

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

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

/**
 * Staff PIN prompt. When the server answers 428 pin_required (a manager must approve, or Settings ask for a PIN),
 * the app shows the PIN pad and repeats the request with { pin }. Registered by <PinPromptHost/>.
 */
type PinPrompt = (message: string, error?: string) => Promise<string | null>;
let pinPrompt: PinPrompt | null = null;
export const setPinPrompt = (fn: PinPrompt | null) => (pinPrompt = fn);

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    return await rawApi<T>(method, path, body);
  } catch (e) {
    if (!(e instanceof ApiError) || e.code !== 'pin_required' || !pinPrompt || (body !== undefined && typeof body !== 'object')) throw e;
    let message = e.message;
    let error: string | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      const pin = await pinPrompt(message, error);
      if (!pin) throw new ApiError(428, 'Cancelled — no PIN entered', 'pin_cancelled');
      try {
        return await rawApi<T>(method, path, { ...((body as object) ?? {}), pin });
      } catch (e2) {
        if (e2 instanceof ApiError && (e2.code === 'pin_wrong' || (e2.status === 403 && e2.code === 'forbidden'))) {
          error = e2.message;
          continue;
        }
        throw e2;
      }
    }
    throw new ApiError(403, 'Too many wrong PINs', 'pin_wrong');
  }
}

async function rawApi<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, 'Cannot reach the ZENAA server. Check the network connection.');
  }
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && path !== '/api/auth/login') onUnauthorized?.();
    throw new ApiError(res.status, data?.message ?? `Request failed (${res.status})`, data?.error);
  }
  return data as T;
}

export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b?: unknown) => api<T>('POST', p, b ?? {});
export const patch = <T = any>(p: string, b: unknown) => api<T>('PATCH', p, b);
export const put = <T = any>(p: string, b: unknown) => api<T>('PUT', p, b);
export const del = <T = any>(p: string) => api<T>('DELETE', p);

import type { DeployRecord, EnvVar, LogLine, ServiceInfo } from '@flightdeck/protocol';

const API_URL = (import.meta.env.VITE_FD_API_URL as string | undefined) ?? 'http://localhost:4000';
const DASHBOARD_TOKEN = import.meta.env.VITE_FD_DASHBOARD_TOKEN as string | undefined;

const TOKEN_KEY = 'fd_token';

/** Identity and permissions of the current caller (GET /api/me). */
export interface Me {
  identityEnabled: boolean;
  /** True when OIDC browser login is configured, so the UI can offer a sign-in redirect. */
  loginFlow: boolean;
  subject?: string;
  name?: string;
  roles: string[];
  permissions: Array<'view' | 'act' | 'reveal'>;
  /** True when durable log search (Loki) is configured, so the UI can offer a search box. */
  logSearch: boolean;
}

/** One line returned by the durable log search endpoint, newest-last. */
export interface SearchLine {
  ts: number;
  stream: string;
  line: string;
}

/** Full detail for one service (GET /api/services/:id). */
export interface ServiceDetail {
  service: ServiceInfo;
  logs: LogLine[];
  deploy?: DeployRecord;
  env?: EnvVar[];
}

/** An HTTP error that carries the response status so callers can detect 401. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * Runtime dashboard token, stored per browser. Falls back to the build-time
 * VITE_FD_DASHBOARD_TOKEN when the user has not signed in at runtime. Reads and
 * writes are guarded because localStorage throws in private mode.
 */
export function getToken(): string {
  try {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (stored) return stored;
  } catch {
    // localStorage unavailable (private mode); fall through to the build-time token.
  }
  return DASHBOARD_TOKEN ?? '';
}

export function setToken(t: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, t);
  } catch {
    // Ignore: without storage the token simply does not persist.
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Ignore: nothing to clear if storage is unavailable.
  }
}

function authHeaders(): HeadersInit {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Full-page URL that starts the OIDC browser login. The control plane redirects
 * to the identity provider and sets an HttpOnly session cookie on return.
 */
export function loginUrl(): string {
  return `${API_URL}/auth/login`;
}

/** Full-page URL that clears the server session cookie. */
export function logoutUrl(): string {
  return `${API_URL}/auth/logout`;
}

export async function fetchServices(): Promise<ServiceInfo[]> {
  const res = await fetch(`${API_URL}/api/services`, {
    headers: authHeaders(),
    credentials: 'include',
  });
  if (!res.ok) {
    throw new ApiError(res.status, `services request failed: ${res.status}`);
  }
  const data = (await res.json()) as { services: ServiceInfo[] };
  return data.services;
}

export async function fetchMe(): Promise<Me> {
  const res = await fetch(`${API_URL}/api/me`, {
    headers: authHeaders(),
    credentials: 'include',
  });
  if (!res.ok) {
    throw new ApiError(res.status, `me request failed: ${res.status}`);
  }
  return (await res.json()) as Me;
}

export async function fetchServiceDetail(id: string): Promise<ServiceDetail> {
  const res = await fetch(`${API_URL}/api/services/${encodeURIComponent(id)}`, {
    headers: authHeaders(),
    credentials: 'include',
  });
  if (!res.ok) {
    throw new ApiError(res.status, `service detail request failed: ${res.status}`);
  }
  return (await res.json()) as ServiceDetail;
}

/**
 * Durable log search for a service (GET /api/services/:id/logs/search). The
 * substring filter `q` is sent only when non-empty; from/to default to the last
 * hour server-side. Returns [] when durable search is not configured (404).
 */
export async function searchLogs(id: string, q: string): Promise<SearchLine[]> {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  const query = params.toString();
  const url = `${API_URL}/api/services/${encodeURIComponent(id)}/logs/search${
    query ? `?${query}` : ''
  }`;
  const res = await fetch(url, {
    headers: authHeaders(),
    credentials: 'include',
  });
  if (res.status === 404) return [];
  if (!res.ok) {
    throw new ApiError(res.status, `log search request failed: ${res.status}`);
  }
  const data = (await res.json()) as { lines: SearchLine[] };
  return data.lines;
}

/**
 * WebSocket URL of the control plane's browser stream endpoint. Browsers
 * cannot set headers on a WebSocket, so the token (when configured) goes in
 * the query string. Note this bakes the token into the client bundle; it
 * gates casual and cross-origin access, not a determined local user.
 */
export function streamUrl(): string {
  const base = `${API_URL.replace(/^http/, 'ws')}/stream`;
  const token = getToken();
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

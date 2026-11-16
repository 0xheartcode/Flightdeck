import type {
  DeployRecord,
  EnvVar,
  LogLine,
  NetworkAttachment,
  PortMapping,
  RouteHint,
  ServiceInfo,
} from '@flightdeck/protocol';

export type { NetworkAttachment, PortMapping, RouteHint };

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
  /**
   * Server-wide action switch (FD_ENABLE_ACTIONS). When false, no one can
   * restart/redeploy/set-env regardless of role; the UI shows a global banner
   * and disables every action control. Older control planes omit it, so it is
   * optional and treated as enabled when absent.
   */
  actionsEnabled?: boolean;
  /**
   * True when the Transmitter backend is available, so the UI uses the real
   * client instead of the mock preview. Absent on older control planes.
   */
  transmitter?: boolean;
  /** True when local username/password accounts are enabled (self-managed auth). */
  localUsers?: boolean;
  /** True when the managed agent-token store is enabled. */
  agentTokens?: boolean;
}

/** A local user role, mapping to the view/act/reveal permission model. */
export type Role = 'viewer' | 'operator' | 'admin';

/** A local user account (GET /api/users). Never carries a password. */
export interface User {
  id: string;
  username: string;
  roles: Role[];
  disabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
}

/** A managed agent credential (GET /api/agent-tokens). Never carries the secret. */
export interface AgentToken {
  id: string;
  name: string;
  /** Last 4 chars of the plaintext, for recognition. */
  hint: string;
  createdAt: number;
  lastSeenAt: number | null;
  revokedAt: number | null;
}

/** One line returned by the durable log search endpoint, newest-last. */
export interface SearchLine {
  ts: number;
  stream: string;
  line: string;
}

/** One entry from the operator audit trail (GET /api/audit), newest-first. */
export interface AuditEntry {
  ts: number;
  action: 'restart' | 'redeploy' | 'set_env';
  /** The service the action targeted. */
  serviceId: string;
  /** Who triggered it (client address/identifier or subject). */
  actor: string;
  ok: boolean;
  error?: string;
}

/** One service's reachability, in the exposure view (GET /api/exposure). */
export interface ExposedService {
  id: string;
  name: string;
  state: ServiceInfo['state'];
  ports: PortMapping[];
  networks: NetworkAttachment[];
  routes: RouteHint[];
}

/** One host in the exposure view: its public IP and what it exposes. */
export interface HostExposure {
  host: string;
  agentId?: string;
  publicIp?: string;
  lanIps?: string[];
  services: ExposedService[];
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
 * Authenticated fetch against the control plane. Applies the base URL, the
 * bearer token and credentialed cookies, parses JSON, and throws ApiError on a
 * non-2xx response. Returns undefined for 204/empty bodies.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...authHeaders(),
      ...init.headers,
    },
    credentials: 'include',
  });
  if (!res.ok) {
    throw new ApiError(res.status, `${init.method ?? 'GET'} ${path} failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
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

export async function fetchExposure(): Promise<HostExposure[]> {
  const res = await fetch(`${API_URL}/api/exposure`, {
    headers: authHeaders(),
    credentials: 'include',
  });
  if (!res.ok) {
    throw new ApiError(res.status, `exposure request failed: ${res.status}`);
  }
  const data = (await res.json()) as { hosts: HostExposure[] };
  return data.hosts;
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
 * Cross-service deploy timeline (GET /api/deploys). Optionally filtered to one
 * repo. Newest-first, as the control plane returns them.
 */
export async function fetchDeploys(repo?: string, limit?: number): Promise<DeployRecord[]> {
  const params = new URLSearchParams();
  if (repo) params.set('repo', repo);
  if (limit) params.set('limit', String(limit));
  const query = params.toString();
  const res = await fetch(`${API_URL}/api/deploys${query ? `?${query}` : ''}`, {
    headers: authHeaders(),
    credentials: 'include',
  });
  if (!res.ok) {
    throw new ApiError(res.status, `deploys request failed: ${res.status}`);
  }
  const data = (await res.json()) as { deploys: DeployRecord[] };
  return data.deploys;
}

/** Operator audit trail (GET /api/audit), newest-first. Read-only. */
export async function fetchAudit(limit?: number): Promise<AuditEntry[]> {
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  const query = params.toString();
  const res = await fetch(`${API_URL}/api/audit${query ? `?${query}` : ''}`, {
    headers: authHeaders(),
    credentials: 'include',
  });
  if (!res.ok) {
    throw new ApiError(res.status, `audit request failed: ${res.status}`);
  }
  const data = (await res.json()) as { audit: AuditEntry[] };
  return data.audit;
}

/** Which sign-in methods the control plane offers (GET /auth/methods, public). */
export interface AuthMethods {
  identityEnabled: boolean;
  loginFlow: boolean;
  localUsers: boolean;
}

/** Discover available sign-in methods before a session exists. */
export async function fetchAuthMethods(): Promise<AuthMethods> {
  const res = await fetch(`${API_URL}/auth/methods`, { credentials: 'include' });
  if (!res.ok) throw new ApiError(res.status, `auth methods request failed: ${res.status}`);
  return (await res.json()) as AuthMethods;
}

// --- Local users (self-managed accounts) ---

/** Log in with a local username/password; the server sets an HttpOnly session cookie. */
export async function localLogin(username: string, password: string): Promise<{ user: User }> {
  return apiFetch<{ user: User }>('/auth/local/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

/** Clear the local session cookie. */
export async function localLogout(): Promise<void> {
  await apiFetch<void>('/auth/local/logout', { method: 'POST' });
}

export async function listUsers(): Promise<User[]> {
  return (await apiFetch<{ users: User[] }>('/api/users')).users;
}

export async function createUser(input: {
  username: string;
  password: string;
  roles: Role[];
}): Promise<User> {
  return (
    await apiFetch<{ user: User }>('/api/users', { method: 'POST', body: JSON.stringify(input) })
  ).user;
}

export async function updateUser(
  id: string,
  patch: { roles?: Role[]; disabled?: boolean },
): Promise<User> {
  return (
    await apiFetch<{ user: User }>(`/api/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
  ).user;
}

export async function setUserPassword(id: string, password: string): Promise<void> {
  await apiFetch<void>(`/api/users/${encodeURIComponent(id)}/password`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

export async function deleteUser(id: string): Promise<void> {
  await apiFetch<void>(`/api/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// --- Managed agent tokens ---

export async function listAgentTokens(): Promise<AgentToken[]> {
  return (await apiFetch<{ tokens: AgentToken[] }>('/api/agent-tokens')).tokens;
}

/** Issue a token; the plaintext `secret` is returned exactly once. */
export async function createAgentToken(
  name: string,
): Promise<{ token: AgentToken; secret: string }> {
  return apiFetch<{ token: AgentToken; secret: string }>('/api/agent-tokens', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function rotateAgentToken(id: string): Promise<{ token: AgentToken; secret: string }> {
  return apiFetch<{ token: AgentToken; secret: string }>(
    `/api/agent-tokens/${encodeURIComponent(id)}/rotate`,
    { method: 'POST' },
  );
}

export async function revokeAgentToken(id: string): Promise<void> {
  await apiFetch<void>(`/api/agent-tokens/${encodeURIComponent(id)}/revoke`, { method: 'POST' });
}

export async function deleteAgentToken(id: string): Promise<void> {
  await apiFetch<void>(`/api/agent-tokens/${encodeURIComponent(id)}`, { method: 'DELETE' });
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

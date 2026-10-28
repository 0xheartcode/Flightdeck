import type { ServiceInfo } from '@flightdeck/protocol';

const API_URL = (import.meta.env.VITE_FD_API_URL as string | undefined) ?? 'http://localhost:4000';
const DASHBOARD_TOKEN = import.meta.env.VITE_FD_DASHBOARD_TOKEN as string | undefined;

function authHeaders(): HeadersInit {
  return DASHBOARD_TOKEN ? { Authorization: `Bearer ${DASHBOARD_TOKEN}` } : {};
}

export async function fetchServices(): Promise<ServiceInfo[]> {
  const res = await fetch(`${API_URL}/api/services`, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`services request failed: ${res.status}`);
  }
  const data = (await res.json()) as { services: ServiceInfo[] };
  return data.services;
}

/**
 * WebSocket URL of the control plane's browser stream endpoint. Browsers
 * cannot set headers on a WebSocket, so the token (when configured) goes in
 * the query string. Note this bakes the token into the client bundle; it
 * gates casual and cross-origin access, not a determined local user.
 */
export function streamUrl(): string {
  const base = `${API_URL.replace(/^http/, 'ws')}/stream`;
  return DASHBOARD_TOKEN ? `${base}?token=${encodeURIComponent(DASHBOARD_TOKEN)}` : base;
}

import type { ServiceInfo } from '@flightdeck/protocol';

const API_URL = (import.meta.env.VITE_FD_API_URL as string | undefined) ?? 'http://localhost:4000';

export async function fetchServices(): Promise<ServiceInfo[]> {
  const res = await fetch(`${API_URL}/api/services`);
  if (!res.ok) {
    throw new Error(`services request failed: ${res.status}`);
  }
  const data = (await res.json()) as { services: ServiceInfo[] };
  return data.services;
}

/** WebSocket URL of the control plane's browser stream endpoint. */
export function streamUrl(): string {
  return `${API_URL.replace(/^http/, 'ws')}/stream`;
}

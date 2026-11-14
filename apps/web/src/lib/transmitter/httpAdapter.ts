import { apiFetch } from '@/api';
import type {
  Channel,
  ChannelInput,
  Delivery,
  RouteInput,
  RouteRule,
  Signal,
  Source,
  SourceInput,
  SourceSecret,
  TransmitterClient,
} from './types';

const BASE = '/api/transmitter';
const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

/**
 * The real Transmitter client, talking to the control-plane API
 * (docs/design/TRANSMITTER-API.md). It is a thin pass-through: the server owns
 * all security (write-only credentials, hashed tokens, SSRF, auditing), so this
 * only shapes requests and unwraps responses.
 */
export class HttpTransmitter implements TransmitterClient {
  async listSignals(): Promise<Signal[]> {
    return (await apiFetch<{ signals: Signal[] }>(`${BASE}/signals`)).signals;
  }
  markRead(id: string): Promise<void> {
    return apiFetch(`${BASE}/signals/${encodeURIComponent(id)}/read`, { method: 'POST' });
  }
  markAllRead(): Promise<void> {
    return apiFetch(`${BASE}/signals/read-all`, { method: 'POST' });
  }

  async listChannels(): Promise<Channel[]> {
    return (await apiFetch<{ channels: Channel[] }>(`${BASE}/channels`)).channels;
  }
  async createChannel(input: ChannelInput): Promise<Channel> {
    return (
      await apiFetch<{ channel: Channel }>(`${BASE}/channels`, { method: 'POST', ...json(input) })
    ).channel;
  }
  async updateChannel(id: string, input: ChannelInput): Promise<Channel> {
    return (
      await apiFetch<{ channel: Channel }>(`${BASE}/channels/${encodeURIComponent(id)}`, {
        method: 'PUT',
        ...json(input),
      })
    ).channel;
  }
  deleteChannel(id: string): Promise<void> {
    return apiFetch(`${BASE}/channels/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
  testChannel(id: string): Promise<Delivery> {
    return apiFetch<Delivery>(`${BASE}/channels/${encodeURIComponent(id)}/test`, {
      method: 'POST',
    });
  }

  async listRoutes(): Promise<RouteRule[]> {
    return (await apiFetch<{ routes: RouteRule[] }>(`${BASE}/routes`)).routes;
  }
  async createRoute(input: RouteInput): Promise<RouteRule> {
    return (
      await apiFetch<{ route: RouteRule }>(`${BASE}/routes`, { method: 'POST', ...json(input) })
    ).route;
  }
  async updateRoute(id: string, input: RouteInput): Promise<RouteRule> {
    return (
      await apiFetch<{ route: RouteRule }>(`${BASE}/routes/${encodeURIComponent(id)}`, {
        method: 'PUT',
        ...json(input),
      })
    ).route;
  }
  deleteRoute(id: string): Promise<void> {
    return apiFetch(`${BASE}/routes/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async listSources(): Promise<Source[]> {
    return (await apiFetch<{ sources: Source[] }>(`${BASE}/sources`)).sources;
  }
  createSource(input: SourceInput): Promise<SourceSecret> {
    return apiFetch<SourceSecret>(`${BASE}/sources`, { method: 'POST', ...json(input) });
  }
  rotateToken(id: string): Promise<SourceSecret> {
    return apiFetch<SourceSecret>(`${BASE}/sources/${encodeURIComponent(id)}/rotate`, {
      method: 'POST',
    });
  }
  revokeSource(id: string): Promise<void> {
    return apiFetch(`${BASE}/sources/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async listDeliveries(): Promise<Delivery[]> {
    return (await apiFetch<{ deliveries: Delivery[] }>(`${BASE}/deliveries`)).deliveries;
  }

  getMute(): Promise<{ until: number | null }> {
    return apiFetch<{ until: number | null }>(`${BASE}/mute`);
  }
  setMute(minutes: number): Promise<{ until: number | null }> {
    return apiFetch<{ until: number | null }>(`${BASE}/mute`, {
      method: 'POST',
      ...json({ minutes }),
    });
  }
  clearMute(): Promise<void> {
    return apiFetch(`${BASE}/mute`, { method: 'DELETE' });
  }
}

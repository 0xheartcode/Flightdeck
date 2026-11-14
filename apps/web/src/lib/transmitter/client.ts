import { MockTransmitter } from './mockAdapter';
import type { TransmitterClient } from './types';

/**
 * Resolve the Transmitter client. No real backend exists yet, so this returns
 * the in-memory mock. The mock is clearly separated and the UI shows a "preview"
 * banner whenever it is active, so mock data is never mistaken for real data in
 * production. When the backend lands, add an HTTP adapter implementing
 * TransmitterClient (per docs/design/TRANSMITTER-API.md) and select it here when
 * VITE_FD_TRANSMITTER_URL is configured.
 */
const BACKEND_URL = import.meta.env.VITE_FD_TRANSMITTER_URL as string | undefined;

export const transmitterIsMock = !BACKEND_URL;

let singleton: TransmitterClient | null = null;

export function getTransmitter(): TransmitterClient {
  if (!singleton) {
    // Only the mock is implemented today; BACKEND_URL is reserved for the real
    // HTTP adapter and currently still falls back to the mock.
    singleton = new MockTransmitter();
  }
  return singleton;
}

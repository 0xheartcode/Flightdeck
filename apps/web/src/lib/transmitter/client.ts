import { HttpTransmitter } from './httpAdapter';
import { MockTransmitter } from './mockAdapter';
import type { TransmitterClient } from './types';

/**
 * Resolve the Transmitter client. When the control plane reports a Transmitter
 * backend (`me.transmitter`), use the real HTTP client; otherwise fall back to
 * the in-memory mock and show a "preview" banner so mock data is never mistaken
 * for real data. The mock is also what tests import directly.
 */
let httpSingleton: TransmitterClient | null = null;
let mockSingleton: TransmitterClient | null = null;

export function getTransmitter(backendAvailable: boolean): TransmitterClient {
  if (backendAvailable) {
    httpSingleton ??= new HttpTransmitter();
    return httpSingleton;
  }
  mockSingleton ??= new MockTransmitter();
  return mockSingleton;
}

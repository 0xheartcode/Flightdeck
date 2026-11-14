import type { Channel, Signal } from './types.js';
import { assertOutboundAllowed } from './ssrf.js';

/**
 * Outbound senders. A sender performs one delivery and throws on failure; the
 * dispatcher handles retries, backoff and recording. The webhook family
 * (Discord, Slack, generic, custom) posts to a user-supplied URL and is
 * SSRF-guarded. Telegram posts to the fixed Telegram API host. Email (SMTP) is
 * not implemented in this build and returns a clear error.
 *
 * `credential` is the write-only secret the store keeps for the channel; it is
 * passed here only at send time and never logged.
 */
export type SendFn = (
  channel: Channel,
  credential: string | undefined,
  signal: Signal,
) => Promise<void>;

const DEFAULT_TIMEOUT_MS = 8000;

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
  guard = true,
): Promise<void> {
  if (guard) await assertOutboundAllowed(url);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      redirect: 'error',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } finally {
    clearTimeout(t);
  }
}

function text(signal: Signal): string {
  const tag = signal.severity.toUpperCase();
  return signal.body ? `[${tag}] ${signal.title}\n${signal.body}` : `[${tag}] ${signal.title}`;
}

export const realSend: SendFn = async (channel, credential, signal) => {
  switch (channel.kind) {
    case 'telegram': {
      if (!credential) throw new Error('no bot token');
      const chatId = channel.config.chatId;
      if (!chatId) throw new Error('no chatId');
      // Fixed, trusted host — no SSRF guard needed.
      await postJson(
        `https://api.telegram.org/bot${credential}/sendMessage`,
        { chat_id: chatId, text: text(signal) },
        {},
        false,
      );
      return;
    }
    case 'discord': {
      const url = channel.config.url;
      if (!url) throw new Error('no webhook URL');
      await postJson(url, { content: text(signal) });
      return;
    }
    case 'slack': {
      const url = channel.config.url;
      if (!url) throw new Error('no webhook URL');
      await postJson(url, { text: text(signal) });
      return;
    }
    case 'webhook':
    case 'custom': {
      const url = channel.config.url;
      if (!url) throw new Error('no endpoint URL');
      const headers: Record<string, string> = {};
      // A custom connector may carry an auth header name + the write-only secret.
      if (channel.kind === 'custom' && channel.config.authHeader && credential) {
        headers[channel.config.authHeader] = credential;
      }
      await postJson(
        url,
        { severity: signal.severity, title: signal.title, body: signal.body, ts: signal.ts },
        headers,
      );
      return;
    }
    case 'email':
      throw new Error('SMTP sender is not implemented in this build');
    default:
      throw new Error(`unknown channel kind: ${channel.kind as string}`);
  }
};

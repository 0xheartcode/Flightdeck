export interface Config {
  port: number;
  agentToken: string;
  logBufferSize: number;
}

export function loadConfig(): Config {
  const port = Number(process.env.FD_CONTROL_PLANE_PORT ?? 4000);
  const agentToken = process.env.FD_AGENT_TOKEN ?? '';
  const logBufferSize = Number(process.env.FD_LOG_BUFFER_SIZE ?? 2000);

  if (!agentToken) {
    console.warn('[config] FD_AGENT_TOKEN is empty; all agent connections will be rejected.');
  }

  return { port, agentToken, logBufferSize };
}

import { useState } from 'react';
import { Drawer, Icon } from '@/components/ui';

function CodeBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {
        /* clipboard blocked; the code is visible to copy manually */
      },
    );
  };
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg border border-line bg-codebg p-3 pr-10 font-mono text-xs leading-relaxed text-codefg">
        {code}
      </pre>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label}`}
        className="absolute top-2 right-2 inline-flex h-7 w-7 items-center justify-center rounded-md text-faint transition-colors hover:bg-row hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
      >
        <Icon name={copied ? 'check' : 'copy'} size={14} />
      </button>
    </div>
  );
}

const RUN_SNIPPET = `docker run -d --name flightdeck-agent \\
  -v /var/run/docker.sock:/var/run/docker.sock:ro \\
  -e FD_CONTROL_PLANE_URL="wss://<your-control-plane>/agent" \\
  -e FD_AGENT_TOKEN="<agent-token>" \\
  ghcr.io/0xheartcode/flightdeck-agent:latest`;

const LABEL_SNIPPET = `# docker-compose.yml
services:
  web:
    labels:
      flightdeck.service: "web"
      flightdeck.repo: "acme/web"
      flightdeck.environment: "production"`;

export function ConnectAgentDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Drawer open={open} onClose={onClose} title="Connect an agent" width={520}>
      <div className="flex flex-col gap-5 text-sm text-muted">
        <p>
          The Flightdeck agent runs one static binary per host. It watches the container runtime and
          streams status and logs to this control plane over a single outbound WebSocket.
        </p>

        <section className="flex flex-col gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sunken text-xs">
              1
            </span>
            Run the agent on your host
          </h3>
          <p>
            Set the control-plane URL and the agent token your operator issued (keep the token
            secret; it is never shown here).
          </p>
          <CodeBlock code={RUN_SNIPPET} label="agent run command" />
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sunken text-xs">
              2
            </span>
            Label the services you want to see
          </h3>
          <p>
            Flightdeck tracks containers that carry the{' '}
            <code className="font-mono">flightdeck.*</code> labels. The repo and environment labels
            drive deploy correlation.
          </p>
          <CodeBlock code={LABEL_SNIPPET} label="service labels" />
        </section>

        <p className="flex items-start gap-2 rounded-lg border border-line bg-raised p-3 text-xs">
          <Icon name="shield-check" size={16} className="mt-0.5 shrink-0 text-ok" />
          <span>
            The agent needs read access to the container socket. Treat the agent token like a
            credential: anyone holding it can stream your logs.
          </span>
        </p>
      </div>
    </Drawer>
  );
}

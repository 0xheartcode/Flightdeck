import type { ServiceInfo } from '@flightdeck/protocol';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { HostExposure, PortMapping } from '@/api';
import { ServiceExposure, indexExposure, portLabel, publicPortLabels } from './Exposure';

const pub: PortMapping = {
  containerPort: 8080,
  protocol: 'tcp',
  hostPort: 8080,
  hostIp: '0.0.0.0',
  public: true,
};
const local: PortMapping = {
  containerPort: 5432,
  protocol: 'tcp',
  hostPort: 5432,
  hostIp: '127.0.0.1',
  public: false,
};

function service(overrides: Partial<ServiceInfo> = {}): ServiceInfo {
  return {
    id: 'api',
    name: 'api',
    image: 'img',
    containerId: 'cid',
    state: 'running',
    host: 'server-a',
    createdAt: 0,
    ...overrides,
  };
}

describe('exposure helpers', () => {
  it('labels published, localhost and exposed-only ports', () => {
    expect(portLabel(pub)).toBe(':8080 → 8080/tcp');
    expect(portLabel(local)).toBe('127.0.0.1:5432 → 5432/tcp');
    expect(portLabel({ containerPort: 9000, protocol: 'tcp', public: false })).toBe(
      '9000/tcp (exposed)',
    );
  });

  it('summarises only the public host ports', () => {
    expect(publicPortLabels([pub, local])).toEqual([':8080']);
    expect(publicPortLabels(undefined)).toEqual([]);
  });

  it('indexes exposure by host and by service id', () => {
    const hosts: HostExposure[] = [
      {
        host: 'server-a',
        publicIp: '203.0.113.7',
        services: [
          { id: 'api', name: 'api', state: 'running', ports: [pub], networks: [], routes: [] },
        ],
      },
    ];
    const { byHost, byServiceId } = indexExposure(hosts);
    expect(byHost.get('server-a')?.publicIp).toBe('203.0.113.7');
    expect(byServiceId.get('api')?.ports[0]?.public).toBe(true);
  });
});

describe('ServiceExposure', () => {
  it('shows domains, a public/localhost pill per port, and network IPs', () => {
    render(
      <ServiceExposure
        service={service({
          ports: [pub, local],
          networks: [{ network: 'bridge', ipAddress: '172.17.0.2' }],
          routes: [{ domain: 'api.example.com', source: 'traefik-label', tls: true }],
        })}
      />,
    );
    expect(screen.getByText('api.example.com')).toBeTruthy();
    expect(screen.getByText('TLS')).toBeTruthy();
    expect(screen.getByText('Public')).toBeTruthy();
    expect(screen.getByText('Localhost')).toBeTruthy();
    expect(screen.getByText('172.17.0.2')).toBeTruthy();
  });

  it('renders an empty state when nothing is exposed', () => {
    render(<ServiceExposure service={service()} />);
    expect(screen.getByText('No exposure data')).toBeTruthy();
  });
});

# Security Policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately. Open a
[GitHub security advisory](https://github.com/0xheartcode/flightdeck-cd/security/advisories/new)
for this repository, or contact the maintainer directly. Do not open a public
issue for a security report.

Please include what you found, how to reproduce it, and the impact you expect.

## Scope notes

The agent holds access to the container runtime socket on each host. See
[docs/security.md](docs/security.md) for the threat model and the recommended
hardening (rootless Podman, a strong `FD_AGENT_TOKEN`, TLS in production).

## Supported versions

This project is pre-1.0. Only the latest release receives fixes.

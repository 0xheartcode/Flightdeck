# CLAUDE.md

Working rules for this repository. Read before making changes.

## What this is

Flightdeck-CD: a self-hosted deployment control plane for containers. A Rust
agent streams container logs and status to a TypeScript control plane, which a
React UI renders. See README.md and docs/architecture.md.

## Tech stack

- **agent/**: Rust (edition 2024), tokio, bollard (Docker-compatible API),
  tokio-tungstenite. One static binary per host.
- **apps/control-plane/**: TypeScript, Node 24, Hono, ws, zod.
- **apps/web/**: React 19, Vite, Tailwind 4, TanStack Query.
- **packages/protocol/**: shared wire contract (zod + inferred types). The
  agent mirrors these shapes in `agent/src/protocol.rs`. Keep both in sync.
- Monorepo: pnpm workspaces + Turborepo. Rust is a sibling cargo workspace.

## The one gate

```bash
just check
```

This runs the TypeScript gate (`pnpm check`: format, lint, typecheck, test,
build) and the Rust gate (`cargo fmt --check`, `cargo clippy -D warnings`,
`cargo test`). CI runs exactly this. **Commit only when the gate is green.**

Auto-fix formatting across both stacks with `just fmt`.

## Conventions

- **Package manager**: pnpm via corepack. Node 24. No `.nvmrc`.
- **TypeScript**: strict, `noUncheckedIndexedAccess`. Relative imports in the
  control plane use `.js` extensions (NodeNext). The web app uses the `@/*`
  alias.
- **Lint**: ESLint flat config. Correctness rules are errors; stylistic and
  debt rules (including `no-console`) are warnings so `eslint .` stays at zero
  errors.
- **Prettier**: single quotes, semicolons, width 100, trailing commas.
- **TypeScript version** is capped at 6.0.x: `typescript-eslint` peers
  `<6.1.0`, so TS 7 would break the lint gate. Revisit when typescript-eslint
  ships TS 7 support.
- **Commits**: Conventional Commits with scopes, e.g. `feat(agent): ...`,
  `fix(control-plane): ...`. Imperative subject under 72 chars.
- **Git**: branch as `feat/`, `fix/`, `chore/`, `refactor/`. Stage files
  explicitly; never `git commit -a`. English/US only in code, UI, and comments.
- Comments explain *why*, not provenance.

## Ask first

Do not deploy, publish, or run destructive operations without explicit
authorization. The agent holds socket access to the container runtime; treat
anything that grants or widens that access as security-sensitive.

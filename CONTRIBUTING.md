# Contributing

## Setup

Prerequisites: Node 24+, pnpm via corepack, Rust stable, and a Docker or
Podman socket. Check with `just doctor`.

```bash
corepack enable
pnpm install
```

## The gate

Run the full quality gate before every commit. CI runs exactly this:

```bash
just check
```

It runs the TypeScript gate (`pnpm check`: format, lint, typecheck, test,
build) and the Rust gate (`cargo fmt --check`, `cargo clippy -D warnings`,
`cargo test`). Auto-fix formatting with `just fmt`. **Commit only when the
gate is green.**

## Branches and commits

- Branch names: `feat/<topic>`, `fix/<topic>`, `chore/<topic>`,
  `refactor/<topic>`.
- Commit messages: Conventional Commits with scopes, e.g.
  `feat(agent): stream container stats`. Imperative, subject under 72 chars.
- Stage files explicitly. Do not use `git commit -a`.
- English/US only in code, UI, and comments.

## Changing the protocol

`packages/protocol` is the source of truth. If you change a message shape,
update the matching serde struct in `agent/src/protocol.rs` in the same change,
and bump the protocol version if the change is not backward compatible.

## Tests

- TypeScript: Vitest, co-located `*.test.ts`.
- Rust: `cargo test`, `*_test` style beside source or in `tests/`.

New behavior needs a test. See `docs/architecture.md` for the design.

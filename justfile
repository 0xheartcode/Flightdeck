# Flightdeck-CD task runner.
# `just` with no args lists recipes.

set shell := ["bash", "-uc"]

default:
    @just --list

# ---------------------------------------------------------------------------
# The one gate. CI runs exactly this. Commit only when it is green.
# ---------------------------------------------------------------------------
check: check-ts check-rust
    @echo "✅  gate green"

# TypeScript workspace gate (format, lint, types, tests, build).
check-ts:
    @echo "── typescript ─────────────────────────────────────────────"
    pnpm check

# Rust agent gate (format, clippy, tests).
check-rust:
    @echo "── rust agent ─────────────────────────────────────────────"
    cargo fmt --all -- --check
    cargo clippy --all-targets --all-features -- -D warnings
    cargo test --all

# ---------------------------------------------------------------------------
# Development
# ---------------------------------------------------------------------------

# Install JS deps (corepack provides pnpm).
install:
    corepack enable
    pnpm install --frozen-lockfile

# Run control plane + web UI together (Turbo).
dev:
    pnpm dev

# Build and run the Rust agent against the local Docker/Podman socket.
agent *ARGS:
    cargo run -p flightdeck-agent -- {{ARGS}}

# Auto-fix formatting across both stacks.
fmt:
    pnpm format
    cargo fmt --all

# ---------------------------------------------------------------------------
# Docker demo (control plane + web + a sample labelled service)
# ---------------------------------------------------------------------------

demo:
    docker compose -f docker/compose.yaml up --build

demo-down:
    docker compose -f docker/compose.yaml down -v

# ---------------------------------------------------------------------------
# Prerequisite checker
# ---------------------------------------------------------------------------
doctor:
    #!/usr/bin/env bash
    set -uo pipefail
    ok() { printf "  \033[32m✔\033[0m %s\n" "$1"; }
    bad() { printf "  \033[31m✘\033[0m %s\n" "$1"; }
    warn() { printf "  \033[33m⚠\033[0m %s\n" "$1"; }
    echo "Flightdeck-CD doctor"
    command -v node >/dev/null && ok "node $(node -v)" || bad "node (need >= 24)"
    command -v pnpm >/dev/null && ok "pnpm $(pnpm -v)" || warn "pnpm (run: corepack enable)"
    command -v cargo >/dev/null && ok "cargo $(cargo --version | cut -d' ' -f2)" || bad "cargo (install rustup)"
    command -v docker >/dev/null && ok "docker $(docker --version | cut -d' ' -f3 | tr -d ,)" || warn "docker or podman socket"
    command -v podman >/dev/null && ok "podman $(podman --version | cut -d' ' -f3)" || warn "podman (optional; rootless default)"

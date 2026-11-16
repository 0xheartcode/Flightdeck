FROM node:24-alpine

WORKDIR /app
# Zero runtime dependencies: just the server, the page, and a default config.
COPY server.mjs index.html monitors.json ./

ENV FDW_STATUS_PORT=8090
EXPOSE 8090

# Node's own HTTP client, no healthcheck tooling needed.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:8090/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]

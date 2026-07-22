# CAIRN — zero-dependency Node service. No npm install step, no build: the whole
# app is Node built-ins, so the image is just the runtime + source. Runs as a
# non-root user, ships a healthcheck, and stays inside the customer's perimeter.
FROM node:20-slim

# Create an unprivileged user to run the service (never root).
RUN useradd --system --create-home --uid 10001 cairn
WORKDIR /app

# Source only — there are no dependencies to install.
COPY --chown=cairn:cairn . .

# Writable state (receipt ledger, surveillance snapshots, alerts) lives here.
RUN mkdir -p /app/.cairn && chown -R cairn:cairn /app/.cairn
VOLUME ["/app/.cairn"]

USER cairn
ENV PORT=4600 WATCH=off
EXPOSE 4600

# Liveness probe hits the ungated /api/health endpoint.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4600)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]

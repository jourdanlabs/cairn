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
# /data is the Fly volume mount; the entrypoint chowns it then drops to cairn.
RUN mkdir -p /app/.cairn /data && chown -R cairn:cairn /app/.cairn /data
VOLUME ["/app/.cairn", "/data"]

COPY --chown=root:root docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Start as root so the entrypoint can chown a freshly attached volume, then drop.
USER root
ENV PORT=4600 WATCH=off
EXPOSE 4600

# Liveness probe hits the ungated /api/health endpoint.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4600)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.mjs"]

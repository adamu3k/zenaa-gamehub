# ── Build web UI ──
FROM node:22-bookworm-slim AS web
WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ── Build server ──
FROM node:22-bookworm-slim AS server
WORKDIR /build/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY server/ ./
RUN npm run build && npm prune --omit=dev

# ── Runtime ──
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    WEB_DIST=/app/web \
    MIGRATIONS_DIR=/app/server/drizzle \
    PORT=8080
WORKDIR /app/server
COPY --from=server /build/server/node_modules ./node_modules
COPY --from=server /build/server/dist ./dist
COPY --from=server /build/server/drizzle ./drizzle
COPY --from=server /build/server/package.json ./
COPY --from=web /build/web/dist /app/web
COPY docs/*.md /app/docs/
COPY README.md /app/docs/00-README.md
# PS4/PS5 timer payloads (built by agents/console/build.ps1); ZENAA writes the station token into them on send.
COPY server/console /app/console
ENV CONSOLE_DIR=/app/console
COPY server/console /app/console
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]

# ── build stage ──────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /build

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
COPY apps/web apps/web

RUN npm run build -w @wizard/web \
 && npm run build -w @wizard/server

# runtime deps only (fastify, socket.io & friends for the server bundle)
RUN npm ci --omit=dev -w @wizard/server --no-audit --no-fund

# ── runtime stage ────────────────────────────────────────────────────
FROM node:22-alpine
ENV NODE_ENV=production PORT=8080 WEB_DIST=/app/web
WORKDIR /app

COPY --from=build /build/node_modules node_modules
COPY --from=build /build/apps/server/dist/index.js server/index.js
COPY --from=build /build/apps/web/dist web

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

CMD ["node", "server/index.js"]

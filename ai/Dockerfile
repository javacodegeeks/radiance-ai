# ── Builder ──────────────────────────────────────────────────────────────────
# Debian-based (not alpine): mongodb's optional native deps (kerberos/snappy/zstd)
# and @qdrant/js-client-rest are more reliably glibc-compatible than musl.
FROM node:20-slim AS builder
WORKDIR /app

COPY package.json ./
RUN npm install --legacy-peer-deps

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop devDependencies from the already-resolved node_modules instead of a
# second `npm install` in the runtime stage — same resolution carries over,
# no second registry round-trip (there's no lockfile pinning versions, so a
# second independent install could otherwise resolve slightly differently).
RUN npm prune --omit=dev --legacy-peer-deps

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
COPY --from=builder /app/node_modules ./node_modules

# tsconfig's rootDir "." mirrors src/ under dist/src — flatten it here so the
# image layout stays dist/server.js without touching the shared tsconfig.
COPY --from=builder /app/dist/src ./dist

USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3001)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/server.js"]

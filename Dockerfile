# Multi-stage build for a self-hosted deploy (see README "Choosing a host").
#
# Deliberately NOT using Next's `output: "standalone"` minimal-bundle mode:
# this app runs `scripts/migrate.ts` and `scripts/restore.ts` via `tsx`
# against real TypeScript source at container startup (not just `next
# start`), so the runtime image needs the full `node_modules` (including
# devDependencies like `tsx`) and the `src/` tree, not just Next's traced
# server bundle. That makes this image larger than a typical Next.js
# Docker setup, but far less fragile — nothing here depends on Next's
# dependency-tracing correctly following a native-module (better-sqlite3)
# import path.
#
# Debian slim (not Alpine): better-sqlite3 is a native addon, and prebuilt
# binaries / native compilation are both more reliably available against
# glibc (Debian) than musl (Alpine).

FROM node:20-bookworm-slim AS deps
WORKDIR /app
# build-essential + python3: fallback for better-sqlite3 to compile from
# source if no prebuilt binary matches this exact image's Node/OS/arch.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
# Belt-and-suspenders: force better-sqlite3's native addon to compile from
# source against this exact image's Node/glibc/CPU, rather than trust a
# downloaded prebuilt binary that might not match Railway's build machine.
RUN npm rebuild better-sqlite3 --build-from-source

FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY package.json package-lock.json next.config.ts tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY drizzle ./drizzle
COPY drizzle.config.ts ./

EXPOSE 3000
# Migrate-then-start on every container start, not just first deploy — safe
# to run repeatedly (see scripts/migrate.ts's header comment), and this way
# a schema change that shipped in this image is applied automatically
# instead of needing a manual step after every deploy.
CMD ["sh", "-c", "npm run db:migrate && next start -p 3000"]

FROM node:20-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json rayzen.config.json ./
COPY packages/types/package.json ./packages/types/
COPY apps/api/package.json ./apps/api/
COPY apps/api-v2/package.json ./apps/api-v2/
COPY apps/web/package.json ./apps/web/
COPY apps/agent/package.json ./apps/agent/

RUN pnpm install --frozen-lockfile

COPY packages/types ./packages/types
COPY apps/api ./apps/api
COPY apps/api-v2 ./apps/api-v2

# Gerar Prisma Client V1 (necessário para V1BridgeService)
RUN pnpm --filter api db:generate
# Gerar Prisma Client V2
RUN pnpm --filter api-v2 db:generate
# Build V2
RUN pnpm --filter api-v2 build

FROM node:20-slim AS runner

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json rayzen.config.json ./
COPY packages/types/package.json ./packages/types/
COPY apps/api/package.json ./apps/api/
COPY apps/api-v2/package.json ./apps/api-v2/
COPY apps/web/package.json ./apps/web/
COPY apps/agent/package.json ./apps/agent/

RUN pnpm install --frozen-lockfile

COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder /app/apps/api-v2/dist ./apps/api-v2/dist
COPY --from=builder /app/apps/api-v2/prisma ./apps/api-v2/prisma
COPY --from=builder /app/apps/api-v2/generated ./apps/api-v2/generated

RUN pnpm --filter api db:generate
RUN pnpm --filter api-v2 db:generate

ENV NODE_ENV=production

EXPOSE 3002

CMD ["sh", "-c", "cd apps/api-v2 && npx prisma migrate deploy --schema prisma/schema.prisma; cd /app && node apps/api-v2/dist/main"]

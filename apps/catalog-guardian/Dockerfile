# Build deliberadamente standalone (npm, não pnpm workspace) — o Catalog
# Guardian precisa ser extraível e deployável na infra do cliente sozinho,
# sem o restante do monorepo Rayzen. Ver BLUEPRINT.md § Posicionamento.

FROM node:20-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src

RUN npx prisma generate --schema prisma/schema.prisma
RUN npx nest build

FROM node:20-slim AS runner

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/generated ./generated

RUN npx prisma generate --schema prisma/schema.prisma

ENV NODE_ENV=production
EXPOSE 4001

CMD ["sh", "-c", "npx prisma migrate deploy --schema prisma/schema.prisma; node dist/main"]

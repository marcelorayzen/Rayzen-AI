ARG API_URL=http://localhost:3101
ARG API_WS_URL=

FROM node:20-slim AS builder

RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

# O Chrome do Puppeteer e da api (PDF), nao deste servico. Sem isto, todo build frio baixa um
# Chrome inteiro no `pnpm install` — e em 16/11/2026 esse download travou a rede por 30+ min
# sem timeout, prendendo o deploy inteiro. A api e a api-v2 ja tinham a mesma linha.
ENV PUPPETEER_SKIP_DOWNLOAD=true

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/types/package.json ./packages/types/
COPY apps/api/package.json ./apps/api/
COPY apps/agent/package.json ./apps/agent/

RUN pnpm install --frozen-lockfile

COPY apps/web ./apps/web
COPY packages ./packages

ARG API_URL
ARG API_WS_URL
ARG NEXT_PUBLIC_HUB_H3=false
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_API_URL=${API_URL}
ENV NEXT_PUBLIC_API_WS_URL=${API_WS_URL}
ENV NEXT_PUBLIC_HUB_H3=${NEXT_PUBLIC_HUB_H3}

RUN pnpm --filter web build

FROM node:20-slim AS runner

RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

# O Chrome do Puppeteer e da api (PDF), nao deste servico. Sem isto, todo build frio baixa um
# Chrome inteiro no `pnpm install` — e em 16/11/2026 esse download travou a rede por 30+ min
# sem timeout, prendendo o deploy inteiro. A api e a api-v2 ja tinham a mesma linha.
ENV PUPPETEER_SKIP_DOWNLOAD=true

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/types/package.json ./packages/types/
COPY apps/api/package.json ./apps/api/
COPY apps/agent/package.json ./apps/agent/

RUN pnpm install --frozen-lockfile

COPY --from=builder /app/apps/web/.next ./apps/web/.next
COPY --from=builder /app/apps/web/public ./apps/web/public

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

EXPOSE 3000

CMD ["pnpm", "--filter", "web", "start"]

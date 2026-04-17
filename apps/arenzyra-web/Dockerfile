# syntax=docker/dockerfile:1

FROM node:20-bookworm AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

FROM base AS deps
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/arenzyra-web/package.json apps/arenzyra-web/package.json
COPY packages/arenzyra-types/package.json packages/arenzyra-types/package.json

RUN pnpm install --frozen-lockfile --filter arenzyra-web...

FROM base AS builder
WORKDIR /repo

COPY --from=deps /repo/ ./
COPY apps/arenzyra-web/ apps/arenzyra-web/
COPY packages/arenzyra-types/ packages/arenzyra-types/

ARG NEXT_PUBLIC_API_URL=http://localhost:3000
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

RUN pnpm --filter arenzyra-web build
RUN pnpm --filter arenzyra-web deploy --prod --legacy /opt/arenzyra-web

FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3005
ENV HOSTNAME=0.0.0.0

ARG NEXT_PUBLIC_API_URL=http://localhost:3000
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

COPY --from=builder /opt/arenzyra-web/ ./
COPY --from=builder /repo/apps/arenzyra-web/.next-build ./.next-build

EXPOSE 3005

CMD ["node", "scripts/start-prod.cjs", "-H", "0.0.0.0", "-p", "3005"]

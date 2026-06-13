# syntax=docker/dockerfile:1

FROM node:20-bookworm AS deps
WORKDIR /repo

COPY package.json package-lock.json ./
COPY apps/discord-bot/package.json apps/discord-bot/package.json

RUN npm ci --workspace apps/discord-bot --include=dev

FROM deps AS builder
WORKDIR /repo

COPY apps/discord-bot/ apps/discord-bot/

RUN npm --prefix apps/discord-bot run build

FROM node:20-bookworm-slim AS runner
WORKDIR /repo

ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/discord-bot/package.json apps/discord-bot/package.json

RUN npm ci --workspace apps/discord-bot --omit=dev

COPY --from=builder /repo/apps/discord-bot/dist apps/discord-bot/dist
COPY --from=builder /repo/apps/discord-bot/assets apps/discord-bot/assets

WORKDIR /repo/apps/discord-bot

CMD ["node", "dist/bot.js"]

# syntax=docker/dockerfile:1

FROM node:22.23.2-bookworm@sha256:7725a5c2c83eed1d36258c66efae14b1ceccd021db9ed1d9559d3335ed3d68ed AS deps
WORKDIR /repo

COPY package.json package-lock.json ./
COPY apps/discord-bot/package.json apps/discord-bot/package.json

RUN npm ci --workspace apps/discord-bot --include=dev

FROM deps AS builder
WORKDIR /repo

COPY apps/discord-bot/ apps/discord-bot/

ARG ARENZYRA_RELEASE_ID=
ARG ARENZYRA_SOURCE_DIGEST=
ARG ARENZYRA_GIT_COMMIT=
ARG ARENZYRA_BUILD_AT=
ARG ARENZYRA_BUILD_SOURCE=publish

RUN npm --prefix apps/discord-bot run build
RUN node -e "const fs=require('fs');const release={releaseId:process.env.ARENZYRA_RELEASE_ID||null,sourceDigest:process.env.ARENZYRA_SOURCE_DIGEST||null,gitCommit:process.env.ARENZYRA_GIT_COMMIT||null,builtAt:process.env.ARENZYRA_BUILD_AT||null,source:process.env.ARENZYRA_BUILD_SOURCE||'publish'};fs.writeFileSync('apps/discord-bot/.arenzyra-release.json',JSON.stringify(release,null,2)+'\\n');"

FROM node:22.23.2-bookworm-slim@sha256:f32b81066cde10a75dbac96646099533316d94bac4150c55da1636e1f0ffdc46 AS runner
WORKDIR /repo

ENV NODE_ENV=production

ARG ARENZYRA_RELEASE_ID=
ARG ARENZYRA_SOURCE_DIGEST=
ARG ARENZYRA_GIT_COMMIT=
ARG ARENZYRA_BUILD_AT=
ARG ARENZYRA_BUILD_SOURCE=publish
LABEL org.opencontainers.image.revision=${ARENZYRA_GIT_COMMIT}
LABEL org.opencontainers.image.version=${ARENZYRA_RELEASE_ID}
LABEL org.opencontainers.image.created=${ARENZYRA_BUILD_AT}
LABEL com.arenzyra.source-digest=${ARENZYRA_SOURCE_DIGEST}
LABEL com.arenzyra.release-source=${ARENZYRA_BUILD_SOURCE}
ENV ARENZYRA_RELEASE_ID=${ARENZYRA_RELEASE_ID}
ENV ARENZYRA_SOURCE_DIGEST=${ARENZYRA_SOURCE_DIGEST}
ENV ARENZYRA_GIT_COMMIT=${ARENZYRA_GIT_COMMIT}
ENV ARENZYRA_BUILD_AT=${ARENZYRA_BUILD_AT}
ENV ARENZYRA_BUILD_SOURCE=${ARENZYRA_BUILD_SOURCE}

COPY package.json package-lock.json ./
COPY apps/discord-bot/package.json apps/discord-bot/package.json

RUN npm ci --workspace apps/discord-bot --omit=dev

COPY --from=builder /repo/apps/discord-bot/dist apps/discord-bot/dist
COPY --from=builder /repo/apps/discord-bot/assets apps/discord-bot/assets
COPY --from=builder /repo/apps/discord-bot/.arenzyra-release.json apps/discord-bot/.arenzyra-release.json

RUN mkdir -p /var/lib/arenzyra-discord-bot \
  && chown -R node:node /var/lib/arenzyra-discord-bot /repo/apps/discord-bot

ENV ARENZYRA_DISCORD_STATE_DIR=/var/lib/arenzyra-discord-bot
WORKDIR /repo/apps/discord-bot
USER node

CMD ["node", "dist/bot.js"]

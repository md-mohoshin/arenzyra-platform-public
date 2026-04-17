# Arenzyra Platform Public

Multi-tenant esports production and tournament management platform.

This public snapshot is sanitized for portfolio, visa, and technical review purposes. Runtime secrets, local environment files, uploaded media, build artifacts, logs, and generated dependencies are intentionally excluded.

## Structure

- `apps/api` - NestJS API, match control, telemetry, observer, widgets, production workflow, and tournament services.
- `apps/arenzyra-web` - Next.js web dashboard and public widget routes.
- `apps/desktop` - Electron observer launcher and local production tooling.
- `infra` - Docker Compose deployment templates using external environment variables.
- `scripts` - Maintenance and asset-generation utilities.

## Local Setup

Copy the example environment files to private `.env` files and fill in your own values before running locally. Do not commit real `.env` files.

```bash
pnpm install
```

Refer to individual app package scripts for development and build commands.

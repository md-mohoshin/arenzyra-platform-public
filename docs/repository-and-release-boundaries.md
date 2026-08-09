# Arenzyra Repository and Release Boundaries

## Current topology

The development workspace contains three independent Git repositories:

1. the root repository for desktop, Discord, launcher, media, infrastructure,
   shared packages, scripts, and documentation;
2. `apps/api` for the NestJS/Prisma API;
3. `apps/arenzyra-web` for the Next.js web application.

The root repository ignores the two embedded repositories. Therefore a root
commit alone is not a complete Arenzyra source revision.

## Release identity

A release is identified by all of the following, not by only one Git SHA:

- root commit;
- API commit;
- web commit;
- dirty/clean state for each component;
- deterministic digest of every file copied into the production build contexts;
- build timestamp, builder/source label, image/artifact digest, and release ID.

Production releases must be clean by default. An unavailable embedded revision,
unknown dirty state, or uncommitted source blocks the normal production path.
Any emergency override must be explicit, time-limited, audited, display the
source digest, and preserve an immutable source archive; it is not the normal
workflow.

## Supported development rules

- Run Git commands with the intended repository as the working directory.
- Never assume root `git status` reports API or web changes.
- Do not delete, reset, stash, or overwrite an embedded repository from a root
  cleanup script.
- Do not commit real `.env` files, OAuth/service credentials, uploads, database
  dumps, recordings, logs, generated builds, installers, or local application
  data.
- Required packaging assets must be committed or produced by a deterministic,
  tested generator. A local untracked asset is not a release input.
- A source backup must include current uncommitted first-party files plus Git
  history for all three repositories, while excluding secrets and generated or
  user-data trees.

## Clean-checkout gate

An isolated checkout must be able to:

1. resolve all three repository revisions;
2. install each supported package manager from a frozen lockfile;
3. generate the Prisma client and validate migrations;
4. lint/type-check and run critical tests;
5. build API, web, Discord bot, desktop, launcher, and media service as required;
6. verify runtime source-drift proxies and desktop release contents;
7. validate production Compose/configuration without using real secrets;
8. produce release metadata whose source digest is stable across two builds;
9. confirm that no secret, local data, or excluded artifact entered the build
   context.

## Repository consolidation decision

The long-term choice is either:

- one true monorepo with API/web history imported and one lock/workspace policy;
  or
- formally separate repositories referenced by immutable submodules or a
  release manifest, each with a protected remote and CI.

Do not convert the current mixed workspace in place while it contains
uncommitted work. First establish reviewed commits and off-machine backups for
all three repositories, then perform the conversion in an isolated clone and
verify history, builds, release digests, and rollback.

## Package-manager policy

Until consolidation is completed, package-manager ownership must be explicit:

- API uses its own `package-lock.json` and `npm ci`;
- root/Discord components using the root npm workspace use the root
  `package-lock.json` and `npm ci`;
- web/shared pnpm workspace uses the root `pnpm-lock.yaml` with the pinned pnpm
  version and `--frozen-lockfile`.

The workspace lists are intentionally explicit. Root npm must not include the
embedded API or web repositories, and the pnpm workspace must not include the
embedded API or root-owned npm apps. API Prisma generation is an explicit
`npm run api:prisma:generate` action; a root install must never mutate the
independently owned API repository as a side effect.

Legacy `overlay-server`, `match-state-service`, and `shadow_api` are excluded
from the supported root workspace as well. They are local-development recovery
artifacts, have isolated dependency state, and cannot be enabled by a packaged
or production launcher. They are not production release inputs.

The root `packageManager` field pins pnpm because the web image invokes
Corepack from the repository root. It does not transfer Discord/root npm lock
ownership to pnpm: npm-owned commands must remain explicit `npm ci` workspace
commands, while pnpm-owned commands must use `pnpm --filter` and the frozen
pnpm lock. Supported tooling is Node 22.23.2 through Node 24, npm 10/11, and
exactly pnpm 10.26.1 as declared in the root `engines` field.

No install command may silently rewrite another repository's lockfile. CI
should fail when a manifest changes without its owning lockfile.

## Backup versus version control

Git history is not a data backup, and a database backup is not a source release.
A recoverable Arenzyra operation requires all three:

- protected off-machine source history and release artifacts;
- encrypted off-host PostgreSQL plus upload/storage backups;
- a documented, successfully tested restore procedure tying data schema to a
  compatible application release.

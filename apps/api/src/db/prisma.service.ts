/* eslint-disable @typescript-eslint/no-unsafe-call */
import 'dotenv/config';
import {
  INestApplication,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { Prisma, PrismaClient, Role } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool, type PoolConfig } from 'pg';
import { OrgScopeService } from '../common/org/org-scope.service';
import { ForbiddenException } from '@nestjs/common';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly pool: Pool;
  private readonly orgScopedModels = new Set<string>([
    'Tournament',
    'Session',
    'SessionRegistration',
    'TournamentRegistration',
    'TournamentInvite',
    'Stage',
    'Group',
    'Match',
    'Team',
    'Player',
    'Widget',
    'WidgetInstance',
    'MediaAsset',
    'AuditLog',
    'OrganizationBranding',
    'SessionBranding',
    'OrganizationFeature',
    'License',
    'ObserverLauncherSession',
  ]);

  constructor(@Optional() private readonly orgScope?: OrgScopeService) {
    const connectionString = process.env.DATABASE_URL ?? '';
    if (!connectionString) {
      throw new Error(
        '[PrismaService] DATABASE_URL is not set. Please configure the connection string before starting the API.',
      );
    }
    // Log once for debugging connection issues (safe for local dev; redact password).
    const redacted = (() => {
      try {
        const u = new URL(connectionString);
        if (u.password) u.password = '******';
        return u.toString();
      } catch {
        return connectionString.replace(/:[^:@/]+@/, ':******@');
      }
    })();

    console.log(`[PrismaService] using DATABASE_URL=${redacted}`);
    const poolConfig: PoolConfig = { connectionString };
    const pool: Pool = new Pool(poolConfig);
    const adapter = new PrismaPg(pool) as Prisma.PrismaClientOptions['adapter'];
    super({ adapter });
    this.pool = pool;

    this.applyOrgScopeExtension();
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
  }

  enableShutdownHooks(app: INestApplication) {
    const shutdown = () => {
      void app.close();
    };

    process.once('beforeExit', shutdown);
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  }

  /**
   * Attach org scoping using Prisma Client extensions (middleware was removed in Prisma 6.14+).
   * Extension is applied immediately so it runs before $connect().
   */
  private applyOrgScopeExtension() {
    const extension = Prisma.defineExtension({
      name: 'org-scope',
      query: {
        $allModels: {
          async $allOperations(
            this: PrismaService,
            {
              model,
              operation,
              args,
              query,
            }: {
              model: string;
              operation: string;
              args: unknown;
              query: (args: unknown) => Promise<unknown>;
            },
          ): Promise<unknown> {
            const orgId = this.orgScope?.getOrgId();
            const actorId = this.orgScope?.getActorId();
            const actorRole = this.orgScope?.getRole();
            if (!orgId || !model || !this.orgScopedModels.has(model)) {
              return query(args);
            }

            const getDelegate = () =>
              (this as unknown as Record<string, unknown>)[
                model.charAt(0).toLowerCase() + model.slice(1)
              ] as Record<string, unknown> | undefined;

            const isWriteOp = [
              'create',
              'createMany',
              'upsert',
              'update',
              'updateMany',
              'delete',
              'deleteMany',
            ].includes(operation);

            if (isWriteOp && !orgId && actorRole === Role.SUPER_ADMIN) {
              throw new ForbiddenException(
                'organizationId is required for write',
              );
            }

            const ensureOrg = (where: Record<string, unknown>) => {
              if (
                'organizationId' in where &&
                where.organizationId !== undefined &&
                where.organizationId !== null
              ) {
                const requestedOrgId = (() => {
                  const id = where.organizationId;
                  if (typeof id === 'string' || typeof id === 'number') {
                    return String(id);
                  }
                  if (id === null || id === undefined) {
                    return 'null';
                  }
                  return JSON.stringify(id);
                })();
                if (where.organizationId !== orgId) {
                  // Audit forbidden cross-org attempt
                  console.warn(
                    `[OrgScope] forbidden cross-org access actor=${actorId ?? 'unknown'} role=${actorRole ?? 'unknown'} requested=${requestedOrgId} ctx=${String(orgId)} ts=${new Date().toISOString()}`,
                  );
                  throw new ForbiddenException(
                    'Cross-organization access forbidden',
                  );
                }
                return where;
              }
              return { ...(where ?? {}), organizationId: orgId };
            };

            const attachWhere = () => {
              const rawWhere = isRecord((args as { where?: unknown }).where)
                ? (args as { where?: Record<string, unknown> }).where
                : {};
              (args as { where?: Record<string, unknown> }).where = ensureOrg(
                rawWhere ?? {},
              );
            };

            switch (operation) {
              case 'findUnique': {
                // Re-route to findFirst so we can inject org filter safely.
                const delegate = getDelegate();
                const findFirst = (delegate as { findFirst?: unknown })
                  ?.findFirst;
                if (typeof findFirst === 'function') {
                  return findFirst(args);
                }
                return query(args);
              }
              case 'findMany':
              case 'findFirst':
              case 'update':
              case 'updateMany':
              case 'delete':
              case 'deleteMany':
              case 'upsert':
              case 'aggregate':
              case 'count':
                attachWhere();
                break;
              default:
                break;
            }

            if (
              [
                'create',
                'createMany',
                'upsert',
                'update',
                'updateMany',
              ].includes(operation)
            ) {
              const data = isRecord((args as { data?: unknown }).data)
                ? (args as { data?: Record<string, unknown> }).data
                : undefined;
              if (data && data.organizationId === undefined) {
                data.organizationId = orgId;
              }
              (args as { data?: Record<string, unknown> }).data = data;
            }

            return query(args);
          },
        },
      },
    });

    // Apply extension in place so the service instance carries the scoped proxies.
    const extended = this.$extends(extension);
    Object.assign(this, extended);
  }
}

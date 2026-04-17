import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import { effectiveOrganizationId } from '../../common/org/org.util';
import type { AuthUser } from '../../common/auth/auth.types';
import { FEATURE_REGISTRY } from './organization-feature.constants';

export type OrgFeatureMap = Record<
  string,
  { enabled: boolean; config?: Prisma.JsonValue | null }
>;

@Injectable()
export class OrganizationFeatureService {
  constructor(private readonly prisma: PrismaService) {}

  registry() {
    return FEATURE_REGISTRY;
  }

  defaultMap(): OrgFeatureMap {
    const map: OrgFeatureMap = {};
    for (const feature of FEATURE_REGISTRY) {
      map[feature.key] = { enabled: feature.defaultEnabled, config: null };
    }
    return map;
  }

  async seedDefaults(orgId: string) {
    const defaults = this.defaultMap();
    const rows = Object.entries(defaults).map(([key, value]) => ({
      organizationId: orgId,
      featureKey: key,
      isEnabled: value.enabled,
      config: value.config ?? Prisma.JsonNull,
    }));
    await this.prisma.organizationFeature.createMany({
      data: rows,
      skipDuplicates: true,
    });
  }

  async getOrgFeatures(params: {
    actor?: AuthUser | null;
    organizationId?: string | null;
    cache?: Map<string, OrgFeatureMap>;
  }): Promise<OrgFeatureMap> {
    const cacheKey =
      params.organizationId ??
      (params.actor ? effectiveOrganizationId(params.actor) : null) ??
      'default';
    if (params.cache?.has(cacheKey)) return params.cache.get(cacheKey)!;
    const orgId =
      (params.actor ? effectiveOrganizationId(params.actor) : null) ??
      params.organizationId;
    const base = this.defaultMap();
    if (!orgId) {
      params.cache?.set(cacheKey, base);
      return base;
    }
    const rows = await this.prisma.organizationFeature.findMany({
      where: { organizationId: orgId },
    });
    for (const row of rows) {
      base[row.featureKey] = {
        enabled: row.isEnabled,
        config: row.config ?? null,
      };
    }
    params.cache?.set(cacheKey, base);
    return base;
  }

  async upsertFeatures(
    orgId: string,
    updates: Array<{
      key: string;
      enabled: boolean;
      config?: Prisma.JsonValue;
    }>,
  ) {
    for (const update of updates) {
      await this.prisma.organizationFeature.upsert({
        where: {
          organizationId_featureKey: {
            organizationId: orgId,
            featureKey: update.key,
          },
        },
        update: {
          isEnabled: update.enabled,
          config: update.config ?? Prisma.JsonNull,
        },
        create: {
          organizationId: orgId,
          featureKey: update.key,
          isEnabled: update.enabled,
          config: update.config ?? Prisma.JsonNull,
        },
      });
    }
  }
}

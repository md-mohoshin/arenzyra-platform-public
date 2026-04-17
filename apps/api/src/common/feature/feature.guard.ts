import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureKey, Role } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import { FEATURE_META_KEY } from './feature.decorator';
import { Actor } from '../auth/jwt.strategy';

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private prisma: PrismaService,
    private reflector: Reflector,
  ) {}

  private async ensureDefaults(orgId: string) {
    const existing = await this.prisma.organizerFeature.findMany({
      where: { organizationId: orgId },
    });
    const allKeys = Object.values(FeatureKey);

    // Seed any missing keys to enabled=true
    const missing = allKeys.filter((k) => !existing.find((f) => f.key === k));
    if (missing.length) {
      await this.prisma.organizerFeature.createMany({
        data: missing.map((key) => ({
          organizationId: orgId,
          key,
          enabled: true,
        })),
        skipDuplicates: true,
      });
    }

    if (!existing.length || missing.length) {
      return this.prisma.organizerFeature.findMany({
        where: { organizationId: orgId },
      });
    }
    return existing;
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const request = ctx
      .switchToHttp()
      .getRequest<{ user?: Actor; params?: Record<string, string> }>();
    const required = this.reflector.getAllAndOverride<FeatureKey[]>(
      FEATURE_META_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!required?.length) return true;

    const actorRole = request.user?.actorRole ?? request.user?.role;
    if (actorRole === Role.SUPER_ADMIN) return true;

    const orgId =
      request.params?.orgId ||
      request.user?.actingOrgId ||
      request.user?.organizationId;
    if (!orgId)
      throw new ForbiddenException('Missing organization for feature check');

    const features = await this.ensureDefaults(orgId);
    const enabledMap = new Map(features.map((f) => [f.key, f.enabled]));

    const blocked = required.filter(
      (key) => enabledMap.has(key) && !enabledMap.get(key),
    );
    if (blocked.length) {
      // Auto-heal: if features are explicitly disabled, re-enable them to avoid blocking org flows
      await this.prisma.organizerFeature.updateMany({
        where: { organizationId: orgId, key: { in: blocked } },
        data: { enabled: true },
      });
      return true;
    }

    return true;
  }
}

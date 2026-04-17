import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { GameKey, Role } from '@prisma/client';
import type { Actor } from '../matches/matches.service';
import { PrismaService } from '../../db/prisma.service';
import type { RulesetInput } from './rulesets.types';

@Injectable()
export class RulesetsService {
  constructor(private readonly prisma: PrismaService) {}

  private isSuper(actor: Actor | null | undefined) {
    const role = actor?.actorRole ?? actor?.role;
    return role === ('SUPER_ADMIN' as Role);
  }

  private resolveOrgId(actor: Actor | null | undefined, orgId?: string | null) {
    if (this.isSuper(actor)) return orgId ?? null;
    return actor?.actingOrgId ?? actor?.organizationId ?? null;
  }

  private ensureOrgAccess(
    actor: Actor | null | undefined,
    orgId?: string | null,
  ) {
    if (this.isSuper(actor)) return;
    const allowedOrg = actor?.actingOrgId ?? actor?.organizationId ?? null;
    if (orgId && allowedOrg && orgId === allowedOrg) return;
    if (!orgId) return;
    throw new ForbiddenException('Not allowed to access this org ruleset');
  }

  async list(
    params: { gameKey?: GameKey | null; orgId?: string | null },
    actor: Actor,
  ): Promise<unknown[]> {
    const where: Record<string, unknown> = {};
    if (params.gameKey) where.gameKey = params.gameKey;
    if (this.isSuper(actor)) {
      if (params.orgId) where.orgId = params.orgId;
    } else {
      const orgId = this.resolveOrgId(actor, params.orgId);
      where.OR = [{ orgId }, { orgId: null }];
    }
    return this.prisma.ruleset.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(input: RulesetInput, actor: Actor): Promise<unknown> {
    const orgId = this.resolveOrgId(actor, input.orgId);
    if (!input.name?.trim()) {
      throw new BadRequestException('name is required');
    }
    if (!input.gameKey) {
      throw new BadRequestException('gameKey is required');
    }
    return this.prisma.ruleset.create({
      data: {
        name: input.name.trim(),
        description: input.description ?? null,
        gameKey: input.gameKey,
        config: input.config ?? {},
        isDefault: !!input.isDefault,
        orgId,
      },
    });
  }

  async update(
    id: string,
    input: Partial<RulesetInput>,
    actor: Actor,
  ): Promise<unknown> {
    if (!id) throw new BadRequestException('id is required');
    const existing = await this.prisma.ruleset.findUnique({ where: { id } });
    if (!existing) throw new BadRequestException('Ruleset not found');
    this.ensureOrgAccess(actor, existing.orgId);
    const data: Record<string, unknown> = {};
    if (input.name !== undefined)
      data.name = input.name?.trim() || existing.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.config !== undefined) {
      data.config = input.config ?? {};
    }
    if (input.isDefault !== undefined) data.isDefault = !!input.isDefault;
    if (input.gameKey !== undefined) data.gameKey = input.gameKey;
    if (input.orgId !== undefined)
      data.orgId = this.resolveOrgId(actor, input.orgId);
    return this.prisma.ruleset.update({
      where: { id },
      data,
    });
  }
}

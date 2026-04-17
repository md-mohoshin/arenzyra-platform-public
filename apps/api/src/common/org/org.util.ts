import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Actor } from '../auth/jwt.strategy';
import { PrismaService } from '../../db/prisma.service';

export function effectiveOrganizationId(actor?: Actor | null) {
  if (!actor) return null;
  const impersonating =
    (actor.isImpersonating ?? actor.impersonated ?? false) === true;
  if (impersonating && actor.actingOrgId) {
    return actor.actingOrgId;
  }
  return actor.organizationId ?? actor.orgId ?? actor.actingOrgId ?? null;
}

export const requireOrgMatch = (
  actor: Pick<
    Actor,
    'organizationId' | 'actingOrgId' | 'actorRole' | 'role'
  > | null,
  targetOrgId: string | null | undefined,
) => {
  const isSuperAdmin =
    (actor?.actorRole ?? actor?.role) === Role.SUPER_ADMIN ||
    actor?.role === Role.SUPER_ADMIN;
  // Super admins bypass org matching when not impersonating to avoid false 403s on legacy data.
  if (isSuperAdmin && !actor?.actingOrgId) return;
  const eff = actor ? effectiveOrganizationId(actor as Actor) : null;
  if (!targetOrgId || !eff || eff !== targetOrgId) {
    throw new ForbiddenException('Not allowed to access this organization');
  }
};

const isSuperAdmin = (actor?: Actor | null) =>
  actor?.role === Role.SUPER_ADMIN || actor?.actorRole === Role.SUPER_ADMIN;

const hasOrgId = (
  value: Record<string, unknown>,
): value is Record<string, unknown> & { organizationId: string | null } => {
  if (!Object.prototype.hasOwnProperty.call(value, 'organizationId')) {
    return false;
  }
  const orgId = (value as { organizationId?: unknown }).organizationId;
  return orgId === null || typeof orgId === 'string';
};

const assertOrgScope = (
  recordOrgId: string | null,
  opts: { organizationId?: string | null; actor?: Actor | null },
): string => {
  const targetOrg = recordOrgId;
  const requestedOrg =
    opts.organizationId ??
    (opts.actor ? effectiveOrganizationId(opts.actor) : null);
  const superAdmin = isSuperAdmin(opts.actor ?? null);

  if (!targetOrg) {
    if (superAdmin) return requestedOrg ?? '';
    throw new ForbiddenException('Organization not assigned to resource');
  }

  if (!superAdmin && requestedOrg && requestedOrg !== targetOrg) {
    throw new ForbiddenException('Cross-organization access is forbidden');
  }

  if (!superAdmin && !requestedOrg) {
    throw new ForbiddenException('organizationId is required');
  }

  return targetOrg;
};

export const requireMatchOrganization = async (
  prisma: PrismaService,
  matchId: string,
  opts: { organizationId?: string | null; actor?: Actor | null } = {},
): Promise<string> => {
  const match = await prisma.match.findFirst({
    where: { id: matchId, deletedAt: null },
    select: {
      organizationId: true,
      tournament: { select: { organizationId: true } },
    },
  });
  if (!match) {
    throw new NotFoundException('Match not found');
  }
  const orgId =
    match.organizationId ?? match.tournament?.organizationId ?? null;
  return assertOrgScope(orgId, opts);
};

export const requireTournamentOrganization = async (
  prisma: PrismaService,
  tournamentId: string,
  opts: { organizationId?: string | null; actor?: Actor | null } = {},
): Promise<string> => {
  const tournament = await prisma.tournament.findFirst({
    where: { id: tournamentId, deletedAt: null },
    select: { organizationId: true },
  });
  if (!tournament) {
    throw new NotFoundException('Tournament not found');
  }
  return assertOrgScope(tournament.organizationId ?? null, opts);
};

export const requireStageOrganization = async (
  prisma: PrismaService,
  stageId: string,
  opts: { organizationId?: string | null; actor?: Actor | null } = {},
): Promise<string> => {
  const stage = await prisma.stage.findFirst({
    where: { id: stageId, deletedAt: null },
    select: { organizationId: true },
  });
  if (!stage) {
    throw new NotFoundException('Stage not found');
  }
  return assertOrgScope(stage.organizationId ?? null, opts);
};

export const scopeOrg = <T extends Record<string, unknown>>(
  req: { orgId?: string | null },
  where: T,
): T => {
  const orgId = req.orgId ?? null;
  if (!orgId) return where;
  if (hasOrgId(where)) {
    if (where.organizationId !== orgId) {
      throw new ForbiddenException('Cross-organization access forbidden');
    }
    return where;
  }
  return { ...where, organizationId: orgId } as T;
};

export const withOrgScope = <T extends Record<string, unknown>>(
  baseWhere: T,
  req: { user?: Pick<Actor, 'organizationId'> | null; isSuperAdmin?: boolean },
): T => {
  if (req?.isSuperAdmin) return baseWhere;
  const organizationId = req?.user?.organizationId ?? null;
  if (!organizationId) {
    throw new ForbiddenException('organizationId is required');
  }
  return { ...baseWhere, organizationId } as T;
};

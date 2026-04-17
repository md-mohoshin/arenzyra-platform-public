import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import type { Actor } from '../auth/jwt.strategy';
import { effectiveOrganizationId } from './org.util';

@Injectable()
export class OrgScopeGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{
      user?: Actor;
      params?: Record<string, string>;
      orgId?: string | null;
    }>();
    const user = req.user;
    if (!user) {
      throw new ForbiddenException('Missing user context');
    }

    const actorRole = user.actorRole ?? user.role;
    const isSuperAdmin =
      actorRole === Role.SUPER_ADMIN || user.role === Role.SUPER_ADMIN;
    const params: Record<string, string> = req.params ?? {};
    let orgId = params.orgId;
    if (!orgId) throw new ForbiddenException('Missing orgId');

    const actorOrgId: string | null = effectiveOrganizationId(user);
    const actorId = user.actorId ?? user.id;

    const tournamentId = params.tournamentId;
    const tournament = tournamentId
      ? await this.prisma.tournament.findFirst({
          where: { id: tournamentId, deletedAt: null },
          select: { id: true, organizationId: true, ownerUserId: true },
        })
      : null;

    // Allow shorthand "me" to resolve to the user's organization.
    if (orgId === 'me') {
      if (actorOrgId) {
        orgId = actorOrgId;
      } else if (tournament?.organizationId) {
        orgId = tournament.organizationId;
      } else if (user.role === Role.SUPER_ADMIN) {
        const firstOrg = await this.prisma.organization.findFirst({
          where: { deletedAt: null },
        });
        if (!firstOrg)
          throw new ForbiddenException(
            'No organizations available to scope SUPER_ADMIN',
          );
        orgId = firstOrg.id;
      } else {
        throw new ForbiddenException('User is not assigned to an organization');
      }
      req.params = { ...params, orgId };
      req.orgId = orgId;
    }

    if (isSuperAdmin) return true;

    if (user.role === Role.ORGANIZER) {
      // Allow if organizer is scoped to the same org or owns the tournament
      if (
        orgId &&
        (actorOrgId === orgId ||
          (tournament?.ownerUserId && tournament.ownerUserId === actorId))
      ) {
        return true;
      }
      if (!orgId || actorOrgId !== orgId) {
        throw new ForbiddenException('No access to this organization');
      }
      return true;
    }

    if (user.role === Role.ADMIN) {
      const link = await this.prisma.adminOrganizationLink.findUnique({
        where: {
          adminId_organizationId: { adminId: user.id, organizationId: orgId },
        },
      });
      if (
        !link &&
        !(tournament?.ownerUserId && tournament.ownerUserId === actorId)
      ) {
        throw new ForbiddenException('Admin not assigned to this organization');
      }
      return true;
    }

    throw new ForbiddenException('Access denied');
  }
}

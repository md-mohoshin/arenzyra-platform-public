import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { Role, Prisma } from '@prisma/client';
import type { AuthRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { OrgScopeGuard } from '../../common/org/org-scope.guard';
import { PrismaService } from '../../db/prisma.service';

@Controller('org/:orgId/audit')
@UseGuards(JwtAuthGuard, OrgScopeGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class AuditController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list(
    @Req() req: AuthRequest,
    @Param('orgId') orgId: string,
    @Query()
    q: {
      entityType?: string;
      entityId?: string;
    },
  ): Promise<
    Prisma.AuditLogGetPayload<{
      include: { user: { select: { name: true; email: true } } };
    }>[]
  > {
    const filter =
      q?.entityType && q?.entityId
        ? { entityType: String(q.entityType), entityId: String(q.entityId) }
        : {};

    return this.prisma.auditLog.findMany({
      where: {
        organizationId: orgId,
        ...filter,
      },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { name: true, email: true } } },
    });
  }
}

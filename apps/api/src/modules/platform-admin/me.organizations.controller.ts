import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import type { AuthRequest } from '../../common/auth/auth.types';
import { Role } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';

type OrgLite = {
  id: string;
  name: string | null;
  status: string | null;
  deletedAt: Date | null;
};

@Controller('me/organizations')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class MeOrganizationsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list(@Req() req: AuthRequest): Promise<OrgLite[]> {
    const user = req.user;
    if (!user) return [];

    const role = user.role;

    if (role === Role.SUPER_ADMIN) {
      const orgs = await this.prisma.organization.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true, status: true, deletedAt: true },
        orderBy: { createdAt: 'asc' },
      });
      return orgs;
    }

    if (role === Role.ADMIN) {
      const links = await this.prisma.adminOrganizationLink.findMany({
        where: { adminId: user.id },
        include: {
          organization: {
            select: { id: true, name: true, status: true, deletedAt: true },
          },
        },
      });
      const orgs: OrgLite[] = [];
      links.forEach((l) => {
        const o = l.organization;
        if (o && !o.deletedAt) {
          orgs.push({
            id: o.id,
            name: o.name ?? null,
            status: (o.status as string) ?? null,
            deletedAt: o.deletedAt ?? null,
          });
        }
      });
      // also include the admin's own organizationId if present
      if (user.organizationId) {
        const own = await this.prisma.organization.findUnique({
          where: { id: user.organizationId },
          select: { id: true, name: true, status: true, deletedAt: true },
        });
        if (own && !orgs.some((o) => o.id === own.id) && !own.deletedAt) {
          orgs.push({
            id: own.id,
            name: own.name ?? null,
            status: (own.status as string) ?? null,
            deletedAt: own.deletedAt ?? null,
          });
        }
      }
      return orgs;
    }

    // ORGANIZER or other roles
    if (user.organizationId) {
      const org = await this.prisma.organization.findUnique({
        where: { id: user.organizationId },
        select: { id: true, name: true, status: true, deletedAt: true },
      });
      if (org && !org.deletedAt)
        return [
          {
            id: org.id,
            name: org.name ?? null,
            status: (org.status as string) ?? null,
            deletedAt: org.deletedAt ?? null,
          },
        ];
    }

    return [];
  }
}

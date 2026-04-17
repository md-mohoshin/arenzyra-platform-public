import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';

export type GlobalPlayerBody = {
  ign?: string;
  country?: string | null;
  teamId?: string | null;
};

@Injectable()
export class GlobalPlayersService {
  constructor(private prisma: PrismaService) {}

  async list() {
    return this.prisma.globalPlayer.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(body: GlobalPlayerBody) {
    const ign = body?.ign?.trim();
    if (!ign) throw new BadRequestException('ign is required');

    return this.prisma.globalPlayer.create({
      data: {
        ign,
        country: body?.country ?? null,
        teamId: body?.teamId ?? null,
      },
    });
  }

  async update(id: string, body: GlobalPlayerBody) {
    const existing = await this.prisma.globalPlayer.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Player not found');

    return this.prisma.globalPlayer.update({
      where: { id },
      data: {
        ign: body?.ign ?? undefined,
        country: body?.country ?? undefined,
        teamId: body?.teamId ?? undefined,
      },
    });
  }

  async softDelete(id: string) {
    const existing = await this.prisma.globalPlayer.findFirst({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Player not found');

    return this.prisma.globalPlayer.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}

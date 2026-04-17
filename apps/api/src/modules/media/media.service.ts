import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { MediaAssetType, Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth.types';
import { PrismaService } from '../../db/prisma.service';
import type { MediaAssetDto, UpdateMediaAssetDto } from './dto/media-asset.dto';
import { requireOrgMatch } from '../../common/org/org.util';

@Injectable()
export class MediaService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: {
    type?: MediaAssetType;
    teamId?: string;
    playerId?: string;
    organizationId?: string;
  }) {
    if (!filters.organizationId) {
      throw new ForbiddenException('organizationId is required');
    }
    return this.prisma.mediaAsset.findMany({
      where: {
        deletedAt: null,
        type: filters.type,
        teamId: filters.teamId,
        playerId: filters.playerId,
        organizationId: filters.organizationId,
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async create(dto: MediaAssetDto, actor: AuthUser) {
    const orgId =
      dto.organizationId ?? actor.organizationId ?? actor.actingOrgId ?? null;
    if (!orgId) throw new ForbiddenException('organizationId is required');
    requireOrgMatch(actor ?? null, orgId);
    return this.prisma.mediaAsset.create({
      data: {
        type: dto.type,
        url: dto.url,
        organizationId: orgId,
        teamId: dto.teamId ?? null,
        playerId: dto.playerId ?? null,
        hash: dto.hash ?? null,
        externalKey: dto.externalKey ?? null,
      } as Prisma.MediaAssetCreateInput,
    });
  }

  async update(id: string, dto: UpdateMediaAssetDto, actor: AuthUser) {
    const existing = await this.prisma.mediaAsset.findUnique({
      where: { id },
    });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException('Media asset not found');
    }
    requireOrgMatch(actor ?? null, existing.organizationId);
    return this.prisma.mediaAsset.update({
      where: { id },
      data: {
        ...(dto.url !== undefined ? { url: dto.url } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.organizationId !== undefined
          ? { organizationId: dto.organizationId }
          : {}),
        ...(dto.teamId !== undefined ? { teamId: dto.teamId } : {}),
        ...(dto.playerId !== undefined ? { playerId: dto.playerId } : {}),
        ...(dto.hash !== undefined ? { hash: dto.hash } : {}),
        ...(dto.externalKey !== undefined
          ? { externalKey: dto.externalKey }
          : {}),
      },
    });
  }

  async remove(id: string, actor: AuthUser) {
    const existing = await this.prisma.mediaAsset.findUnique({
      where: { id },
    });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException('Media asset not found');
    }
    requireOrgMatch(actor ?? null, existing.organizationId);
    return this.prisma.mediaAsset.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async syncStatus() {
    const assets = await this.prisma.mediaAsset.findMany({
      where: { deletedAt: null },
      select: { id: true, type: true, updatedAt: true },
    });
    const counts: Record<string, number> = {};
    let latest: Date | null = null;
    for (const asset of assets) {
      counts[asset.type] = (counts[asset.type] ?? 0) + 1;
      if (!latest || asset.updatedAt > latest) latest = asset.updatedAt;
    }
    return {
      counts,
      latestUpdatedAt: latest,
      total: assets.length,
    };
  }
}

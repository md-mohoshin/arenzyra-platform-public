import { Injectable } from '@nestjs/common';
import { FeatureKey } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';

@Injectable()
export class OrgFeaturesService {
  constructor(private prisma: PrismaService) {}

  async list(orgId: string) {
    const existing = await this.prisma.organizerFeature.findMany({
      where: { organizationId: orgId },
    });
    const map = new Map(existing.map((f) => [f.key, f.enabled]));
    return Object.values(FeatureKey).map((key) => ({
      key,
      enabled: map.get(key) ?? false,
    }));
  }
}

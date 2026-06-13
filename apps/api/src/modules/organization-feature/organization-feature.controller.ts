import { Body, Controller, Get, Patch, Query, Req } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { Request } from 'express';
import type { AuthUser } from '../../common/auth/auth.types';
import { Roles } from '../../common/auth/roles.decorator';
import { OrganizationFeatureService } from './organization-feature.service';
import { effectiveOrganizationId } from '../../common/org/org.util';
import { RealtimeGateway } from '../../realtime/realtime.gateway';

class FeatureUpdateDto {
  @IsString()
  key!: string;

  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  config?: unknown;
}

class UpdateFeaturesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FeatureUpdateDto)
  features!: FeatureUpdateDto[];
}

@Controller('org/features')
export class OrganizationFeatureController {
  constructor(
    private readonly svc: OrganizationFeatureService,
    private readonly realtime: RealtimeGateway,
  ) {}

  private actor(req: Request): AuthUser | null {
    return (req as Request & { user?: AuthUser }).user ?? null;
  }

  @Get()
  async list(
    @Req() req: Request,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.svc.getOrgFeatures({
      actor: this.actor(req),
      organizationId: organizationId ?? null,
    });
  }

  @Patch()
  @Roles(Role.SUPER_ADMIN)
  async update(
    @Body() dto: UpdateFeaturesDto,
    @Req() req: Request,
    @Query('organizationId') organizationId?: string,
  ) {
    const actor = this.actor(req);
    const orgId =
      organizationId ?? (actor ? effectiveOrganizationId(actor) : null);
    if (!orgId) {
      throw new Error('organizationId required');
    }
    const updates = dto.features.map((f) => ({
      key: f.key,
      enabled: f.enabled,
      config: f.config as Prisma.JsonValue | undefined,
    }));
    await this.svc.upsertFeatures(orgId, updates);
    const features = await this.svc.getOrgFeatures({
      organizationId: orgId,
      actor,
    });
    this.realtime.emitFeaturesUpdated(orgId, features);
    return features;
  }
}

import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import type { AuthUser } from '../../common/auth/auth.types';
import { WidgetVersionService } from './widget-version.service';
import { effectiveOrganizationId } from '../../common/org/org.util';

class CreateVersionDto {
  @IsString()
  version!: string;

  @IsOptional()
  configSchema?: unknown;
}

class UpdateSchemaDto {
  @IsOptional()
  configSchema?: unknown;
}

@Controller('org/widgets')
export class WidgetVersionController {
  constructor(private readonly svc: WidgetVersionService) {}

  private actor(req: Request | null): AuthUser | null {
    return (req as Request & { user?: AuthUser })?.user ?? null;
  }

  @Get(':widgetKey/versions')
  list(
    @Param('widgetKey') widgetKey: string,
    @Req() req: Request,
    @Query('organizationId') organizationId?: string,
  ) {
    const actor = this.actor(req);
    const orgId =
      organizationId ?? (actor ? (effectiveOrganizationId(actor) ?? '') : '');
    return this.svc.list(orgId, widgetKey);
  }

  @Post(':widgetKey/versions')
  create(
    @Param('widgetKey') widgetKey: string,
    @Body() dto: CreateVersionDto,
    @Req() req: Request,
    @Query('organizationId') organizationId?: string,
  ) {
    const actor = this.actor(req);
    const orgId =
      organizationId ?? (actor ? (effectiveOrganizationId(actor) ?? '') : '');
    return this.svc.createDraft({
      organizationId: orgId,
      widgetKey,
      version: dto.version,
      configSchema: dto.configSchema as Prisma.JsonValue | null | undefined,
    });
  }

  @Patch('versions/:id/promote')
  promote(@Param('id') id: string) {
    return this.svc.promote(id);
  }

  @Patch('versions/:id')
  updateSchema(
    @Param('id') id: string,
    @Body() dto: UpdateSchemaDto,
    @Req() req: Request,
    @Query('organizationId') organizationId?: string,
  ) {
    const actor = this.actor(req);
    const orgId =
      organizationId ?? (actor ? effectiveOrganizationId(actor) : null);
    return this.svc.updateConfigSchema({
      id,
      organizationId: orgId,
      configSchema: dto.configSchema as Prisma.JsonValue | null | undefined,
    });
  }

  @Patch(':widgetKey/versions/rollback')
  rollback(
    @Param('widgetKey') widgetKey: string,
    @Query('organizationId') organizationId?: string,
    @Req() req?: Request,
  ) {
    const actor = this.actor(req ?? null);
    const orgId =
      organizationId ?? (actor ? (effectiveOrganizationId(actor) ?? '') : '');
    return this.svc.rollback(orgId, widgetKey);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import type { Request } from 'express';
import { ObsTemplateKind, Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth.types';
import { VisualAssetsService } from './visual-assets.service';

class CreateObsTemplateDto {
  @IsString()
  key!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsEnum(ObsTemplateKind)
  kind?: ObsTemplateKind;

  @IsOptional()
  config?: any;

  @IsOptional()
  scenes?: Array<{ name: string; layout?: Prisma.JsonValue }>;
}

class UpdateObsTemplateDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsEnum(ObsTemplateKind)
  kind?: ObsTemplateKind;

  @IsOptional()
  config?: any;
}

class CopyTemplateDto {
  @IsString()
  targetOrgId!: string;
}

@Controller('org/obs-templates')
export class ObsTemplatesController {
  constructor(private readonly assets: VisualAssetsService) {}

  private actor(req: Request): AuthUser | null {
    return (req as Request & { user?: AuthUser }).user ?? null;
  }

  @Get()
  list(@Req() req: Request, @Query('organizationId') organizationId?: string) {
    return this.assets.listTemplates(this.actor(req), organizationId ?? null);
  }

  @Get(':id')
  get(
    @Param('id') id: string,
    @Req() req: Request,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.assets.getTemplate(id, this.actor(req), organizationId ?? null);
  }

  @Post()
  create(
    @Body() dto: CreateObsTemplateDto,
    @Req() req: Request,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.assets.createTemplate({
      actor: this.actor(req),
      organizationId: organizationId ?? null,
      data: dto,
    });
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateObsTemplateDto,
    @Req() req: Request,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.assets.updateTemplate({
      id,
      actor: this.actor(req),
      organizationId: organizationId ?? null,
      data: dto,
    });
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @Req() req: Request,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.assets.deleteTemplate(
      id,
      this.actor(req),
      organizationId ?? null,
    );
  }

  @Post(':id/copy')
  copy(
    @Param('id') id: string,
    @Body() dto: CopyTemplateDto,
    @Req() req: Request,
  ) {
    return this.assets.copyTemplate(id, dto.targetOrgId, this.actor(req));
  }
}

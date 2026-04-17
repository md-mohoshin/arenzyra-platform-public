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
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import type { AuthUser } from '../../common/auth/auth.types';
import { VisualAssetsService } from './visual-assets.service';

class CreatePresetDto {
  @IsString()
  name!: string;

  @IsOptional()
  config?: Prisma.JsonValue;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

class UpdatePresetDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  config?: Prisma.JsonValue;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

@Controller('org/widgets')
export class WidgetPresetsController {
  constructor(private readonly assets: VisualAssetsService) {}

  private actor(req: Request): AuthUser | null {
    return (req as Request & { user?: AuthUser }).user ?? null;
  }

  @Get(':widgetKey/presets')
  list(
    @Param('widgetKey') widgetKey: string,
    @Req() req: Request,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.assets.listWidgetPresets(
      widgetKey,
      this.actor(req),
      organizationId ?? null,
    );
  }

  @Post(':widgetKey/presets')
  create(
    @Param('widgetKey') widgetKey: string,
    @Body() dto: CreatePresetDto,
    @Req() req: Request,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.assets.createWidgetPreset({
      widgetKey,
      actor: this.actor(req),
      organizationId: organizationId ?? null,
      data: dto,
    });
  }

  @Patch('presets/:presetId')
  update(
    @Param('presetId') presetId: string,
    @Body() dto: UpdatePresetDto,
    @Req() req: Request,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.assets.updateWidgetPreset({
      id: presetId,
      actor: this.actor(req),
      organizationId: organizationId ?? null,
      data: dto,
    });
  }

  @Delete('presets/:presetId')
  remove(
    @Param('presetId') presetId: string,
    @Req() req: Request,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.assets.deleteWidgetPreset(
      presetId,
      this.actor(req),
      organizationId ?? null,
    );
  }
}

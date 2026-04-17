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
import { WidgetKind } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth.types';
import { VisualAssetsService } from './visual-assets.service';

class CreateWidgetDto {
  @IsString()
  key!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  category?: string | null;

  @IsOptional()
  @IsEnum(WidgetKind)
  kind?: WidgetKind;

  // Config accepted as arbitrary JSON; validation intentionally lenient.
  @IsOptional()
  config?: any;
}

class UpdateWidgetDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  category?: string | null;

  @IsOptional()
  @IsEnum(WidgetKind)
  kind?: WidgetKind;

  @IsOptional()
  config?: any;
}

class CopyWidgetDto {
  @IsString()
  targetOrgId!: string;
}

@Controller('org/widgets')
export class WidgetAssetsController {
  constructor(private readonly assets: VisualAssetsService) {}

  private actor(req: Request): AuthUser | null {
    return (req as Request & { user?: AuthUser }).user ?? null;
  }

  @Get()
  list(@Req() req: Request, @Query('organizationId') organizationId?: string) {
    return this.assets.listWidgets(this.actor(req), organizationId ?? null);
  }

  @Get(':id')
  get(
    @Param('id') id: string,
    @Req() req: Request,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.assets.getWidget(id, this.actor(req), organizationId ?? null);
  }

  @Post()
  create(
    @Body() dto: CreateWidgetDto,
    @Req() req: Request,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.assets.createWidget({
      actor: this.actor(req),
      organizationId: organizationId ?? null,
      data: dto,
    });
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateWidgetDto,
    @Req() req: Request,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.assets.updateWidget({
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
    return this.assets.deleteWidget(
      id,
      this.actor(req),
      organizationId ?? null,
    );
  }

  @Post(':id/copy')
  copy(
    @Param('id') id: string,
    @Body() dto: CopyWidgetDto,
    @Req() req: Request,
  ) {
    return this.assets.copyWidget(id, dto.targetOrgId, this.actor(req));
  }
}

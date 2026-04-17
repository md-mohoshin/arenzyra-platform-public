import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { PrismaService } from '../../db/prisma.service';
import { Public } from '../../common/auth/public.decorator';
import { WidgetsService } from './widgets.service';

@Controller('obs')
@Public()
export class ObsWidgetInstanceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly widgets: WidgetsService,
  ) {}

  @Get('widget-instance/:id')
  async getInstance(@Param('id') id: string) {
    const instance = await this.prisma.widgetInstance.findUnique({
      where: { id },
    });
    if (!instance) {
      throw new NotFoundException('Widget instance not found');
    }
    return instance;
  }

  @Post('widget-instance/ensure')
  async ensureInstance(
    @Body()
    body: {
      widgetKey?: string;
      widgetType?: string;
      organizationId: string;
      tournamentId?: string | null;
      matchId?: string | null;
      settings?: unknown;
    },
  ) {
    const widgetKey = body.widgetKey ?? body.widgetType;
    const { organizationId, tournamentId = null, matchId = null } = body;
    if (!widgetKey || !organizationId) {
      throw new BadRequestException(
        'widgetKey (or widgetType) and organizationId are required',
      );
    }

    await this.widgets.assertWidgetApproved(organizationId, widgetKey);

    return this.prisma.widgetInstance.upsert({
      where: {
        organizationId_widgetKey: {
          organizationId,
          widgetKey,
        },
      },
      update: {
        tournamentId,
        matchId,
        isActive: true,
      },
      create: {
        widgetKey,
        organizationId,
        tournamentId,
        matchId,
        isActive: true,
      },
    });
  }
}

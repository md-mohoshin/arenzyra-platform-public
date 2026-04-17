import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Post,
  Query,
} from '@nestjs/common';
import { Public } from '../../common/auth/public.decorator';
import { WidgetsService } from './widgets.service';
import { CreateWidgetInstanceDto } from './dto/create-widget-instance.dto';
import { Param } from '@nestjs/common';

@Controller('api/widgets')
export class WidgetInstanceApiController {
  constructor(private readonly widgets: WidgetsService) {}

  @Post('instances')
  @Public()
  createInstance(@Body() dto: CreateWidgetInstanceDto) {
    return this.widgets.createInstance(dto);
  }

  @Get('resolve')
  @Public()
  async resolve(@Query('key') key?: string) {
    if (!key) {
      throw new NotFoundException('Widget instance key is required');
    }
    return this.widgets.resolveInstance(key);
  }

  @Get('access')
  @Public()
  async access(
    @Query('widgetKey') widgetKey?: string,
    @Query('orgSlug') organizationSlug?: string,
    @Query('organizationId') organizationId?: string,
  ) {
    if (!widgetKey) {
      throw new NotFoundException('widgetKey is required');
    }

    return this.widgets.getWidgetAccess({
      organizationSlug: organizationSlug ?? null,
      organizationId: organizationId ?? null,
      widgetKey,
    });
  }

  @Get('access-list')
  @Public()
  async accessList(
    @Query('orgSlug') organizationSlug?: string,
    @Query('organizationId') organizationId?: string,
  ) {
    return this.widgets.listWidgetAccess({
      organizationSlug: organizationSlug ?? null,
      organizationId: organizationId ?? null,
    });
  }

  @Post('instances/:id/trigger')
  @Public()
  trigger(@Param('id') id: string, @Body() body: { action: string }) {
    return this.widgets.triggerInstance(id, body?.action);
  }
}

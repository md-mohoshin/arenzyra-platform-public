import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedRequest } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { ApplyScreenshotResultsDto } from './dto/apply-screenshot-results.dto';
import { IngestScreenshotDto } from './dto/ingest-screenshot.dto';
import { ScreenshotIngestService } from './screenshot-ingest.service';

@Controller('ingest')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER, Role.REFEREE)
export class ScreenshotIngestController {
  constructor(private readonly screenshotIngest: ScreenshotIngestService) {}

  @Post('screenshot')
  preview(@Body() dto: IngestScreenshotDto, @Req() req: AuthenticatedRequest) {
    return this.screenshotIngest.previewScreenshot(req.user, dto);
  }

  @Post('screenshot/apply')
  apply(
    @Body() dto: ApplyScreenshotResultsDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.screenshotIngest.applyScreenshotResults(req.user, dto);
  }
}

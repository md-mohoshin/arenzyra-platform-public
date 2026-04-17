import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { OrgScopeGuard } from '../../common/org/org-scope.guard';
import { OrgFeaturesService } from './org-features.service';

@Controller('org/:orgId/features')
@UseGuards(JwtAuthGuard, OrgScopeGuard)
export class OrgFeaturesController {
  constructor(private svc: OrgFeaturesService) {}

  @Get()
  list(@Param('orgId') orgId: string) {
    return this.svc.list(orgId);
  }
}

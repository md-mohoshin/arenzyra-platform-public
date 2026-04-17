import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthRequest } from '../../common/auth/auth.types';
import { SuperAdminGuard } from '../../common/auth/super-admin.guard';
import { SuperService } from './super.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrgStatusDto } from './dto/update-org-status.dto';
import { UpdateOrgKycDto } from './dto/update-org-kyc.dto';
import { UpdateOrgOwnerDto } from './dto/update-org-owner.dto';
import { CreateLicenseDto } from './dto/create-license.dto';
import { UpdateLicenseDto } from './dto/update-license.dto';

@Controller('super/organizations')
@UseGuards(SuperAdminGuard)
export class SuperOrganizationsController {
  constructor(private readonly superService: SuperService) {}

  @Post()
  async createOrganization(
    @Body() dto: CreateOrganizationDto,
    @Req() req: AuthRequest,
  ) {
    const data = await this.superService.createOrganization(dto, req.user);
    return { data };
  }

  @Get()
  listOrganizations(
    @Query('q') q: string | undefined,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Req() req: AuthRequest,
  ) {
    const parsedPage = Number.isNaN(Number(page)) ? 1 : Number(page);
    const parsedPageSize = Number.isNaN(Number(pageSize))
      ? 20
      : Number(pageSize);
    return this.superService.listOrganizations(
      req,
      q,
      parsedPage,
      parsedPageSize,
    );
  }

  @Get(':id')
  async getOrganization(@Param('id') id: string) {
    const data = await this.superService.getOrganization(id);
    return { data };
  }

  @Get(':id/licenses')
  async listLicenses(@Param('id') id: string) {
    const data = await this.superService.listOrganizationLicenses(id);
    return { data };
  }

  @Get(':id/widget-approvals')
  async listWidgetApprovals(@Param('id') id: string) {
    const data = await this.superService.listOrganizationWidgetApprovals(id);
    return { data };
  }

  @Patch(':id/widget-approvals/config')
  async updateWidgetApprovalConfig(
    @Param('id') id: string,
    @Body() dto: { enforced: boolean },
    @Req() req: AuthRequest,
  ) {
    const data = await this.superService.updateOrganizationWidgetApprovalConfig(
      id,
      dto.enforced === true,
      req.user,
    );
    return { data };
  }

  @Patch(':id/widget-approvals/:widgetKey')
  async updateWidgetApproval(
    @Param('id') id: string,
    @Param('widgetKey') widgetKey: string,
    @Body() dto: { isApproved: boolean },
    @Req() req: AuthRequest,
  ) {
    const data = await this.superService.updateOrganizationWidgetApproval(
      id,
      widgetKey,
      dto.isApproved === true,
      req.user,
    );
    return { data };
  }

  @Post(':id/licenses')
  async createLicense(
    @Param('id') id: string,
    @Body() dto: CreateLicenseDto,
    @Req() req: AuthRequest,
  ) {
    const data = await this.superService.createOrganizationLicense(
      id,
      dto,
      req.user,
    );
    return { data };
  }

  @Patch(':id/licenses/:licenseId')
  async updateLicense(
    @Param('id') id: string,
    @Param('licenseId') licenseId: string,
    @Body() dto: UpdateLicenseDto,
    @Req() req: AuthRequest,
  ) {
    const data = await this.superService.updateOrganizationLicense(
      id,
      licenseId,
      dto,
      req.user,
    );
    return { data };
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOrgStatusDto,
    @Req() req: AuthRequest,
  ) {
    const data = await this.superService.updateOrganizationStatus(
      id,
      dto,
      req.user,
    );
    return { data };
  }

  @Patch(':id/kyc')
  async updateKyc(
    @Param('id') id: string,
    @Body() dto: UpdateOrgKycDto,
    @Req() req: AuthRequest,
  ) {
    const data = await this.superService.updateOrganizationKyc(
      id,
      dto,
      req.user,
    );
    return { data };
  }

  @Patch(':id/owner')
  async updateOwner(
    @Param('id') id: string,
    @Body() dto: UpdateOrgOwnerDto,
    @Req() req: AuthRequest,
  ) {
    const data = await this.superService.updateOrganizationOwner(
      id,
      dto,
      req.user,
    );
    return { data };
  }
}

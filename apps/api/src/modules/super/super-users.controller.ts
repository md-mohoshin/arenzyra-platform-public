import { Body, Controller, Param, Patch, Req, UseGuards } from '@nestjs/common';
import type { AuthRequest } from '../../common/auth/auth.types';
import { SuperAdminGuard } from '../../common/auth/super-admin.guard';
import { SuperService } from './super.service';
import { SuperBanUserDto } from './dto/ban-user.dto';

@Controller('super/users')
@UseGuards(SuperAdminGuard)
export class SuperUsersController {
  constructor(private readonly superService: SuperService) {}

  @Patch(':id/ban')
  async banUser(
    @Param('id') userId: string,
    @Body() dto: SuperBanUserDto,
    @Req() req: AuthRequest,
  ) {
    const data = await this.superService.banUser(userId, dto, req.user);
    return { data };
  }
}

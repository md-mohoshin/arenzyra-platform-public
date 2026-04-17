import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { IsEmail, IsOptional, IsString } from 'class-validator';
import type { Request } from 'express';
import { Public } from '../common/auth/public.decorator';
import { AuthService } from './auth.service';

class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;

  @IsString()
  @IsOptional()
  organizationId?: string;
}

class RefreshDto {
  @IsString()
  @IsOptional()
  refresh_token?: string;

  @IsString()
  @IsOptional()
  refreshToken?: string;
}

class LogoutDto extends RefreshDto {}

class ApplyDto {
  @IsString()
  applicantName!: string;

  @IsString()
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private getBearer(req: Request) {
    const authorization = req.headers?.authorization ?? '';
    if (!authorization.toLowerCase().startsWith('bearer ')) return null;
    return authorization.slice(7).trim() || null;
  }

  @Post('login')
  @Public()
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const session = await this.auth.login({
      email: dto.email,
      password: dto.password,
      organizationId: dto.organizationId,
      userAgent: req.headers['user-agent'] ?? null,
      ip: req.ip ?? req.socket?.remoteAddress ?? null,
    });

    return {
      access_token: session.accessToken,
      accessToken: session.accessToken,
      refresh_token: session.refreshToken,
      refreshToken: session.refreshToken,
      user: session.user,
      organization: session.organization,
    };
  }

  @Post('refresh')
  @Public()
  async refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    const session = await this.auth.refresh({
      refreshToken: dto.refresh_token ?? dto.refreshToken ?? null,
      userAgent: req.headers['user-agent'] ?? null,
      ip: req.ip ?? req.socket?.remoteAddress ?? null,
    });

    return {
      access_token: session.accessToken,
      accessToken: session.accessToken,
      refresh_token: session.refreshToken,
      refreshToken: session.refreshToken,
      user: session.user,
      organization: session.organization,
    };
  }

  @Post('logout')
  @Public()
  async logout(@Body() dto: LogoutDto) {
    await this.auth.revoke(dto.refresh_token ?? dto.refreshToken ?? null);
    return { ok: true };
  }

  @Post('apply')
  @Public()
  async apply(@Body() dto: ApplyDto) {
    const data = await this.auth.applyForOrganization({
      name: dto.name,
      email: dto.email,
      password: dto.password,
      applicantName: dto.applicantName,
    });

    return { data };
  }

  @Get('me')
  @Public()
  async me(@Req() req: Request) {
    return this.auth.me(this.getBearer(req));
  }
}

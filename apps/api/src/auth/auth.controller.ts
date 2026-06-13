import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { IsArray, IsEmail, IsOptional, IsString } from 'class-validator';
import type { Request } from 'express';
import { Public } from '../common/auth/public.decorator';
import { AuthService } from './auth.service';

class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
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

  @IsString()
  @IsOptional()
  requestedPlan?: string;

  @IsString()
  @IsOptional()
  requestedPlanId?: string;

  @IsString()
  @IsOptional()
  requestedGameKey?: string;

  @IsArray()
  @IsOptional()
  requestedGameKeys?: string[];

  @IsString()
  @IsOptional()
  requestedAddOns?: string;

  @IsArray()
  @IsOptional()
  requestedAddOnIds?: string[];

  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @IsString()
  @IsOptional()
  country?: string;

  @IsString()
  @IsOptional()
  whatsappNumber?: string;

  @IsString()
  @IsOptional()
  discordUsername?: string;

  @IsString()
  @IsOptional()
  websiteUrl?: string;

  @IsString()
  @IsOptional()
  contactMessage?: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private getBearer(req: Request) {
    const authorization = req.headers?.authorization ?? '';
    if (!authorization.toLowerCase().startsWith('bearer ')) return null;
    return authorization.slice(7).trim() || null;
  }

  private getBotToken(req: Request) {
    const authorization = req.headers?.authorization ?? '';
    if (!authorization.toLowerCase().startsWith('bot ')) return null;
    return authorization.slice(4).trim() || null;
  }

  @Post('login')
  @Public()
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const session = await this.auth.login({
      email: dto.email,
      password: dto.password,
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
      requestedPlan: dto.requestedPlan,
      requestedPlanId: dto.requestedPlanId,
      requestedGameKey: dto.requestedGameKey,
      requestedGameKeys: dto.requestedGameKeys,
      requestedAddOns: dto.requestedAddOns,
      requestedAddOnIds: dto.requestedAddOnIds,
      paymentMethod: dto.paymentMethod,
      country: dto.country,
      whatsappNumber: dto.whatsappNumber,
      discordUsername: dto.discordUsername,
      websiteUrl: dto.websiteUrl,
      contactMessage: dto.contactMessage,
    });

    return { data };
  }

  @Get('me')
  @Public()
  async me(@Req() req: Request) {
    const botToken = this.getBotToken(req);
    if (botToken) {
      const organizationId =
        typeof req.headers?.['x-organization-id'] === 'string'
          ? req.headers['x-organization-id']
          : null;
      return this.auth.serviceSession({ token: botToken, organizationId });
    }

    return this.auth.me(this.getBearer(req));
  }
}

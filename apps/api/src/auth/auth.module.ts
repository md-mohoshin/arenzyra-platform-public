import 'dotenv/config';
import { Module, forwardRef, Global } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from '../common/auth/jwt.strategy';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard';
import { AuditModule } from '../modules/audit/audit.module';
import { env } from '../config/env.validation';

import type { JwtSignOptions } from '@nestjs/jwt';

const secret = env.JWT_SECRET;
// Access tokens are short-lived; default 15 minutes unless overridden.
const expiresIn = (process.env.JWT_EXPIRES_IN ??
  process.env.ACCESS_TOKEN_TTL_SEC ??
  '900s') as JwtSignOptions['expiresIn'];

@Global()
@Module({
  imports: [
    PassportModule,
    forwardRef(() => AuditModule),
    JwtModule.register({
      secret,
      signOptions: { expiresIn },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [JwtModule, JwtAuthGuard, AuthService],
})
export class AuthModule {}

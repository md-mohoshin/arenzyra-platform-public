import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { GameKey, OrganizerAccessMode, Role } from '@prisma/client';
import { AuthService } from '../../auth/auth.service';
import { env } from '../../config/env.validation';

export type JwtPayload = {
  sub: string;
  role?: Role | null;
  organizationId?: string | null;
  organizationName?: string | null;
  email?: string | null;
  name?: string | null;
  actorId?: string | null;
  actorRole?: Role | null;
  actingOrgId?: string | null;
  actingRole?: Role | null;
  actingOrgName?: string | null;
  organizerAccessMode?: OrganizerAccessMode | null;
  organizationAccessMode?: OrganizerAccessMode | null;
  accessMode?: OrganizerAccessMode | null;
  organizationPlanId?: string | null;
  planId?: string | null;
  enabledGames?: GameKey[] | null;
  enabledAddOns?: string[] | null;
  actingAsUserId?: string | null;
  isImpersonating?: boolean | null;
  impersonationExpiresAt?: string | number | Date | null;
  impersonated?: boolean | null;
  impersonatedBy?: string | null;
  realRole?: Role | null;
  override?: boolean | null;
  overrideReason?: string | null;
};

export type Actor = {
  id: string;
  role: Role | null;
  organizationId: string | null;
  orgId?: string | null;
  serviceToken?: boolean;
  actorId: string | null;
  actorRole: Role | null;
  actingOrgId: string | null;
  actingRole: Role | null;
  actingOrgName: string | null;
  organizerAccessMode?: OrganizerAccessMode | null;
  organizationAccessMode?: OrganizerAccessMode | null;
  accessMode?: OrganizerAccessMode | null;
  organizationPlanId?: string | null;
  planId?: string | null;
  enabledGames?: GameKey[] | null;
  enabledAddOns?: string[] | null;
  actingAsUserId: string | null;
  isImpersonating?: boolean;
  impersonated?: boolean;
  impersonatedBy?: string | null;
  impersonationExpiresAt?: string | number | Date | null;
  realRole: Role | null;
  override?: boolean;
  overrideReason?: string | null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly auth: AuthService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: env.JWT_SECRET,
    });
  }

  validate(payload: JwtPayload) {
    return this.auth.validateAccessTokenPayload(payload);
  }
}

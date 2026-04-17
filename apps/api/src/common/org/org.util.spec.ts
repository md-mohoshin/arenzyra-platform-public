import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Actor } from '../auth/jwt.strategy';
import { effectiveOrganizationId, requireOrgMatch } from './org.util';

const makeActor = (overrides: Partial<Actor>): Actor => ({
  id: 'actor-id',
  role: null,
  organizationId: null,
  orgId: null,
  actorId: null,
  actorRole: null,
  actingOrgId: null,
  actingRole: null,
  actingOrgName: null,
  actingAsUserId: null,
  isImpersonating: false,
  impersonated: false,
  impersonatedBy: null,
  impersonationExpiresAt: null,
  realRole: null,
  ...overrides,
});

describe('org util', () => {
  it('returns actingOrgId for SUPER_ADMIN impersonation', () => {
    const org = effectiveOrganizationId(
      makeActor({
        organizationId: 'org-real',
        actingOrgId: 'org-imp',
        role: Role.SUPER_ADMIN,
        isImpersonating: true,
      }),
    );
    expect(org).toBe('org-imp');
  });

  it('uses primary organization for regular actor', () => {
    const org = effectiveOrganizationId(
      makeActor({
        organizationId: 'org-a',
        actingOrgId: null,
        role: Role.ORGANIZER,
      }),
    );
    expect(org).toBe('org-a');
  });

  it('super admin requires actingOrg to switch orgs', () => {
    const org = effectiveOrganizationId(
      makeActor({
        organizationId: 'org-a',
        actingOrgId: 'org-b',
        role: Role.SUPER_ADMIN,
        isImpersonating: true,
      }),
    );
    expect(org).toBe('org-b');
  });

  it('throws 403 when organization does not match', () => {
    expect(() =>
      requireOrgMatch(
        {
          organizationId: 'org-a',
          actingOrgId: null,
          role: null,
          actorRole: null,
        },
        'org-b',
      ),
    ).toThrow(ForbiddenException);
  });

  it('throws 403 when super admin impersonates different org and target mismatches', () => {
    expect(() =>
      requireOrgMatch(
        {
          organizationId: 'org-a',
          actingOrgId: 'org-imp',
          role: Role.SUPER_ADMIN,
          actorRole: null,
        },
        'org-b',
      ),
    ).toThrow(ForbiddenException);
  });
});

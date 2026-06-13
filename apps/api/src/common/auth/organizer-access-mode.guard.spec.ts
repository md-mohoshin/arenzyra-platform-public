import type { ExecutionContext } from '@nestjs/common';
import { OrganizerAccessMode, Role } from '@prisma/client';
import { OrganizerAccessModeGuard } from './organizer-access-mode.guard';

function contextFor({
  method,
  path,
  body,
  accessMode = OrganizerAccessMode.DISCORD_ONLY,
}: {
  method: string;
  path: string;
  body?: unknown;
  accessMode?: OrganizerAccessMode;
}) {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({
        method,
        path,
        body,
        user: {
          id: 'user-1',
          role: Role.ORGANIZER,
          organizationId: 'org-1',
          actorId: null,
          actorRole: null,
          actingOrgId: null,
          actingRole: null,
          actingOrgName: null,
          actingAsUserId: null,
          realRole: null,
          accessMode,
        },
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('OrganizerAccessModeGuard', () => {
  const guard = new OrganizerAccessModeGuard();

  it('allows Discord-only organizers to read a session for the Discord editor', () => {
    expect(
      guard.canActivate(
        contextFor({ method: 'GET', path: '/sessions/session-1' }),
      ),
    ).toBe(true);
  });

  it('allows Discord-only organizers to create scrim sessions from Discord management', () => {
    expect(
      guard.canActivate(
        contextFor({
          method: 'POST',
          path: '/sessions',
          body: { type: 'SCRIM', name: 'Scrim', slotCount: 25 },
        }),
      ),
    ).toBe(true);
  });

  it('allows Discord-only organizers to clear legacy registration date windows', () => {
    expect(
      guard.canActivate(
        contextFor({
          method: 'PATCH',
          path: '/sessions/session-1',
          body: { registrationOpenAt: null, registrationCloseAt: null },
        }),
      ),
    ).toBe(true);
  });

  it('allows Discord-only organizers to edit Discord scrim session basics', () => {
    expect(
      guard.canActivate(
        contextFor({
          method: 'PATCH',
          path: '/sessions/session-1',
          body: {
            name: 'Renamed scrim',
            status: 'OPEN',
            slotCount: 25,
            maxTeams: 25,
          },
        }),
      ),
    ).toBe(true);
  });

  it('allows Discord-only organizers to archive and delete Discord sessions', () => {
    expect(
      guard.canActivate(
        contextFor({
          method: 'POST',
          path: '/sessions/session-1/archive',
        }),
      ),
    ).toBe(true);
    expect(
      guard.canActivate(
        contextFor({
          method: 'DELETE',
          path: '/sessions/session-1',
        }),
      ),
    ).toBe(true);
  });

  it('blocks wider production session updates for Discord-only organizers', () => {
    expect(() =>
      guard.canActivate(
        contextFor({
          method: 'PATCH',
          path: '/sessions/session-1',
          body: { adapterKey: 'pubgm-manual' },
        }),
      ),
    ).toThrow('This organizer account is limited to Discord management.');
  });

  it('allows Discord-only organizers to manage team bans from Discord management', () => {
    expect(
      guard.canActivate(
        contextFor({ method: 'GET', path: '/organizer/team-bans' }),
      ),
    ).toBe(true);
    expect(
      guard.canActivate(
        contextFor({ method: 'POST', path: '/organizer/team-bans' }),
      ),
    ).toBe(true);
    expect(
      guard.canActivate(
        contextFor({
          method: 'POST',
          path: '/organizer/team-bans/team-ban-1/revoke',
        }),
      ),
    ).toBe(true);
  });

  it('allows Discord-only organizers to manage organization branding for Discord widgets', () => {
    for (const method of ['GET', 'PATCH', 'PUT']) {
      expect(
        guard.canActivate(
          contextFor({
            method,
            path: '/branding/org-1',
            body:
              method === 'GET'
                ? undefined
                : { primaryColor: '#00e5ff', authoringMode: 'minimal' },
          }),
        ),
      ).toBe(true);
    }
  });

  it('allows Discord-only organizers to use the client portal billing and support routes', () => {
    const allowed = [
      { method: 'GET', path: '/organizer/client-portal' },
      { method: 'POST', path: '/organizer/client-portal/support-request' },
      { method: 'POST', path: '/organizer/client-portal/payment-proof' },
    ];

    for (const route of allowed) {
      expect(guard.canActivate(contextFor(route))).toBe(true);
    }
  });

  it('allows Discord-only organizers to use upload endpoints without full production access', () => {
    const allowedUploads = [
      '/api/media/upload',
      '/uploads/sponsor-logo',
      '/uploads/tournament-logo',
      '/uploads/tournament-banner',
      '/uploads/event-logo',
      '/uploads/event-banner',
      '/ingest/screenshot/upload',
      '/tournaments/tournament-1/logo',
      '/organizer/teams/team-1/logo',
      '/organizer/players/player-1/photo',
      '/me/teams/team-1/logo',
      '/me/teams/team-1/logo-light',
      '/me/teams/team-1/logo-dark',
      '/org/org-1/teams/team-1/logo',
      '/org/org-1/teams/team-1/logo-light',
      '/org/org-1/teams/team-1/logo-dark',
      '/org/org-1/players/player-1/photo',
    ];

    for (const path of allowedUploads) {
      expect(guard.canActivate(contextFor({ method: 'POST', path }))).toBe(
        true,
      );
    }
  });

  it('allows Discord-only organizers to use Discord bot match and result endpoints', () => {
    const allowed = [
      { method: 'GET', path: '/sessions/discord/resolve-channel' },
      { method: 'DELETE', path: '/sessions/session-1/registrations/slots' },
      {
        method: 'PATCH',
        path: '/sessions/session-1/registrations/registration-1/play-status',
      },
      { method: 'GET', path: '/sessions/session-1/standings' },
      { method: 'POST', path: '/sessions/session-1/matches' },
      {
        method: 'POST',
        path: '/sessions/session-1/matches/match-1/sync-slots',
      },
      { method: 'GET', path: '/me/matches/match-1/slots' },
      { method: 'POST', path: '/ingest/screenshot' },
      { method: 'POST', path: '/ingest/screenshot/slot-map' },
      { method: 'POST', path: '/ingest/screenshot/apply' },
      { method: 'GET', path: '/render/match/match-1/discord/match-result' },
    ];

    for (const route of allowed) {
      expect(guard.canActivate(contextFor(route))).toBe(true);
    }
  });
});

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import {
  Role,
  TournamentInviteStatus,
  TournamentRegistrationStatus,
  TournamentRosterLineupType,
  TournamentStatus,
} from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { requireEnv } from '../src/common/config/require-env';
import { PrismaService } from '../src/db/prisma.service';

const jwtSecret = requireEnv('JWT_SECRET');

describe('Tournament registration flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const seed = randomUUID().slice(0, 8);
  const organizationId = randomUUID();
  const userId = randomUUID();
  const tournamentId = randomUUID();
  const stageId = randomUUID();
  const groupId = randomUUID();
  const organizationSlug = `registration-org-${seed}`;
  const teamName = `Rosters ${seed}`;
  const contactEmail = `team-${seed}@arenzyra.com`;
  const organizerToken = jwt.sign(
    {
      sub: userId,
      role: Role.ORGANIZER,
      actorRole: Role.ORGANIZER,
      organizationId,
      email: `organizer-${seed}@arenzyra.com`,
    },
    jwtSecret,
    { expiresIn: '15m' },
  );

  const registrationPayload = {
    teamName,
    contactEmail,
    players: {
      main: [
        { name: `Main-${seed}-1` },
        { name: `Main-${seed}-2` },
        { name: `Main-${seed}-3` },
        { name: `Main-${seed}-4` },
      ],
      subs: [{ name: `Sub-${seed}-1` }],
    },
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);

    await prisma.organization.create({
      data: {
        id: organizationId,
        name: `Registration Org ${seed}`,
        slug: organizationSlug,
      },
    });

    await prisma.organizationBranding.create({
      data: {
        organizationId,
        defaultTeamLogoUrl: '/uploads/defaults/org-team.png',
        defaultPlayerPhotoUrl: '/uploads/defaults/org-player.png',
      },
    });

    await prisma.user.create({
      data: {
        id: userId,
        email: `organizer-${seed}@arenzyra.com`,
        name: 'Organizer',
        password: 'test',
        role: Role.ORGANIZER,
        organizationId,
      },
    });

    await prisma.tournament.create({
      data: {
        id: tournamentId,
        name: `Tournament ${seed}`,
        organizationId,
        ownerUserId: userId,
        game: 'PUBG_MOBILE',
        ruleset: {},
        status: TournamentStatus.DRAFT,
      },
    });

    await prisma.stage.create({
      data: {
        id: stageId,
        name: `Stage ${seed}`,
        tournamentId,
        organizationId,
        order: 1,
      },
    });

    await prisma.group.create({
      data: {
        id: groupId,
        name: `Group ${seed}`,
        stageId,
        organizationId,
        maxTeams: 25,
      },
    });

    await prisma.tournament.update({
      where: { id: tournamentId },
      data: {
        defaultRegistrationStageId: stageId,
      },
    });
  });

  afterAll(async () => {
    const registrations = await prisma.tournamentRegistration.findMany({
      where: { tournamentId },
      select: { id: true, teamId: true },
    });
    const invites = await prisma.tournamentInvite.findMany({
      where: { tournamentId },
      select: { id: true, teamId: true },
    });
    const teamIds = [...registrations, ...invites]
      .map((entry) => entry.teamId)
      .filter((teamId): teamId is string => typeof teamId === 'string');

    const tournamentTeams = await prisma.tournamentTeam.findMany({
      where: { tournamentId },
      select: { id: true },
    });
    const tournamentTeamIds = tournamentTeams.map((team) => team.id);

    if (tournamentTeamIds.length > 0) {
      await prisma.tournamentPlayer.deleteMany({
        where: { tournamentTeamId: { in: tournamentTeamIds } },
      });
      await prisma.groupTeam.deleteMany({
        where: { tournamentTeamId: { in: tournamentTeamIds } },
      });
      await prisma.stageTeam.deleteMany({
        where: { tournamentTeamId: { in: tournamentTeamIds } },
      });
    }

    await prisma.tournamentTeam.deleteMany({
      where: { tournamentId },
    });

    if (teamIds.length > 0) {
      await prisma.rosterEntry.deleteMany({
        where: { teamId: { in: teamIds } },
      });
      await prisma.player.deleteMany({
        where: { teamId: { in: teamIds } },
      });
      await prisma.globalPlayer.deleteMany({
        where: { teamId: { in: teamIds } },
      });
      await prisma.team.deleteMany({
        where: { id: { in: teamIds } },
      });
    }

    await prisma.tournamentRegistration.deleteMany({
      where: { tournamentId },
    });
    await prisma.tournamentInvite.deleteMany({
      where: { tournamentId },
    });
    await prisma.group.deleteMany({
      where: { id: groupId },
    });
    await prisma.stage.deleteMany({
      where: { id: stageId },
    });
    await prisma.organizationBranding.deleteMany({
      where: { organizationId },
    });
    await prisma.tournament.deleteMany({
      where: { id: tournamentId },
    });
    await prisma.user.deleteMany({
      where: { id: userId },
    });
    await prisma.organization.deleteMany({
      where: { id: organizationId },
    });

    await app.close();
  });

  it('keeps public registrations temporary until organizer approval, then creates team records and a tournament roster snapshot', async () => {
    const submitResponse = await request(app.getHttpServer())
      .post(`/registration/${tournamentId}`)
      .send(registrationPayload)
      .expect(201);

    expect(submitResponse.body?.message).toBe(
      'Application submitted. Waiting for approval.',
    );

    await request(app.getHttpServer())
      .post(`/registration/${tournamentId}`)
      .send(registrationPayload)
      .expect(409);

    const pendingRegistration = await prisma.tournamentRegistration.findFirst({
      where: {
        tournamentId,
        contactEmail,
      },
    });

    expect(pendingRegistration?.status).toBe(
      TournamentRegistrationStatus.PENDING,
    );
    expect(pendingRegistration?.stageId).toBe(stageId);
    expect(pendingRegistration?.groupId).toBeNull();
    expect(pendingRegistration?.teamId).toBeNull();

    const listResponse = await request(app.getHttpServer())
      .get(`/organizer/tournaments/${tournamentId}/registrations`)
      .set('authorization', `Bearer ${organizerToken}`)
      .expect(200);

    expect(Array.isArray(listResponse.body)).toBe(true);
    expect(listResponse.body[0]?.status).toBe('PENDING');

    const approveResponse = await request(app.getHttpServer())
      .post(`/organizer/registrations/${pendingRegistration?.id}/approve`)
      .set('authorization', `Bearer ${organizerToken}`)
      .expect(201);

    expect(approveResponse.body?.status).toBe('APPROVED');

    const approvedRegistration = await prisma.tournamentRegistration.findUnique(
      {
        where: { id: pendingRegistration?.id },
      },
    );
    expect(approvedRegistration?.status).toBe(
      TournamentRegistrationStatus.APPROVED,
    );
    expect(approvedRegistration?.teamId).toBeTruthy();
    expect(approvedRegistration?.reviewedById).toBe(userId);

    const team = await prisma.team.findUnique({
      where: { id: approvedRegistration?.teamId ?? '' },
    });
    expect(team?.name).toBe(teamName);
    expect(team?.logoUrl).toBe('/uploads/defaults/org-team.png');

    const players = await prisma.player.findMany({
      where: { teamId: team?.id ?? '' },
      orderBy: { ign: 'asc' },
    });
    expect(players).toHaveLength(5);
    expect(
      players.every(
        (player) => player.photoUrl === '/uploads/defaults/org-player.png',
      ),
    ).toBe(true);

    const rosterEntries = await prisma.rosterEntry.findMany({
      where: { teamId: team?.id ?? '' },
    });
    expect(rosterEntries).toHaveLength(5);

    const tournamentTeam = await prisma.tournamentTeam.findFirst({
      where: { tournamentId, teamId: team?.id ?? '' },
    });
    expect(tournamentTeam).not.toBeNull();

    const stageMembership = await prisma.stageTeam.findFirst({
      where: {
        stageId,
        tournamentTeamId: tournamentTeam?.id ?? '',
      },
    });
    expect(stageMembership).not.toBeNull();

    const groupMembership = await prisma.groupTeam.findFirst({
      where: {
        groupId,
        tournamentTeamId: tournamentTeam?.id ?? '',
        deletedAt: null,
      },
    });
    expect(groupMembership).toBeNull();

    const tournamentPlayers = await prisma.tournamentPlayer.findMany({
      where: { tournamentTeamId: tournamentTeam?.id ?? '' },
      orderBy: { createdAt: 'asc' },
    });
    expect(tournamentPlayers).toHaveLength(5);
    expect(
      tournamentPlayers.filter(
        (player) => player.lineupType === TournamentRosterLineupType.MAIN,
      ),
    ).toHaveLength(4);
    expect(
      tournamentPlayers.filter(
        (player) => player.lineupType === TournamentRosterLineupType.SUBSTITUTE,
      ),
    ).toHaveLength(1);
    expect(
      tournamentPlayers.every(
        (player) => typeof player.ignOverride === 'string',
      ),
    ).toBe(true);

    const organizerTeamsResponse = await request(app.getHttpServer())
      .get('/organizer/teams')
      .set('authorization', `Bearer ${organizerToken}`)
      .expect(200);
    const organizerTeams = Array.isArray(organizerTeamsResponse.body)
      ? organizerTeamsResponse.body
      : [];
    expect(
      organizerTeams.some((entry: { id: string }) => entry.id === team?.id),
    ).toBe(true);

    const tournamentTeamsResponse = await request(app.getHttpServer())
      .get(`/org/me/tournaments/${tournamentId}/teams`)
      .set('authorization', `Bearer ${organizerToken}`)
      .expect(200);
    const tournamentTeamsBody = Array.isArray(tournamentTeamsResponse.body)
      ? tournamentTeamsResponse.body
      : [];
    expect(
      tournamentTeamsBody.some(
        (entry: { teamId: string }) => entry.teamId === team?.id,
      ),
    ).toBe(true);

    await prisma.tournament.update({
      where: { id: tournamentId },
      data: { status: TournamentStatus.ACTIVE },
    });

    await request(app.getHttpServer())
      .post(`/organizer/teams/${team?.id}/players`)
      .set('authorization', `Bearer ${organizerToken}`)
      .send({ ign: `Late-${seed}` })
      .expect(409);

    await prisma.tournament.update({
      where: { id: tournamentId },
      data: { status: TournamentStatus.COMPLETED },
    });

    await request(app.getHttpServer())
      .post(`/organizer/teams/${team?.id}/players`)
      .set('authorization', `Bearer ${organizerToken}`)
      .send({ ign: `Late-${seed}` })
      .expect(201);

    expect(
      await prisma.player.count({
        where: {
          teamId: team?.id ?? '',
          deletedAt: null,
        },
      }),
    ).toBe(6);
    expect(
      await prisma.tournamentPlayer.count({
        where: {
          tournamentTeamId: tournamentTeam?.id ?? '',
          deletedAt: null,
        },
      }),
    ).toBe(5);

    await prisma.tournament.update({
      where: { id: tournamentId },
      data: { status: TournamentStatus.DRAFT },
    });
  });

  it('lets organizers reject a pending registration exactly once', async () => {
    const rejectEmail = `reject-${seed}@arenzyra.com`;

    await request(app.getHttpServer())
      .post(`/registration/${tournamentId}`)
      .send({
        ...registrationPayload,
        teamName: `Reject ${seed}`,
        contactEmail: rejectEmail,
      })
      .expect(201);

    const pendingRegistration = await prisma.tournamentRegistration.findFirst({
      where: {
        tournamentId,
        contactEmail: rejectEmail,
      },
    });

    const rejectResponse = await request(app.getHttpServer())
      .post(`/organizer/registrations/${pendingRegistration?.id}/reject`)
      .set('authorization', `Bearer ${organizerToken}`)
      .send({ reason: 'Roster does not meet the event requirements' })
      .expect(201);

    expect(rejectResponse.body?.status).toBe('REJECTED');
    expect(rejectResponse.body?.rejectionReason).toContain(
      'event requirements',
    );

    await request(app.getHttpServer())
      .post(`/organizer/registrations/${pendingRegistration?.id}/reject`)
      .set('authorization', `Bearer ${organizerToken}`)
      .send({ reason: 'Second rejection should fail' })
      .expect(409);
  });

  it('accepts single-use invites directly into the requested stage and group without creating a registration', async () => {
    const inviteEmail = `invite-${seed}@arenzyra.com`;
    const invitedTeamName = `Invited ${seed}`;
    const inviteRoster = {
      teamName: invitedTeamName,
      players: {
        main: [
          { name: `Invite-Main-${seed}-1` },
          { name: `Invite-Main-${seed}-2` },
          { name: `Invite-Main-${seed}-3` },
          { name: `Invite-Main-${seed}-4` },
        ],
        subs: [
          { name: `Invite-Sub-${seed}-1` },
          { name: `Invite-Sub-${seed}-2` },
        ],
      },
    };

    const createInviteResponse = await request(app.getHttpServer())
      .post(`/organizer/tournaments/${tournamentId}/invites`)
      .set('authorization', `Bearer ${organizerToken}`)
      .send({
        contactEmail: inviteEmail,
        stageId,
        groupId,
      })
      .expect(201);

    expect(createInviteResponse.body?.status).toBe('PENDING');
    expect(createInviteResponse.body?.stageId).toBe(stageId);
    expect(createInviteResponse.body?.groupId).toBe(groupId);
    expect(typeof createInviteResponse.body?.inviteToken).toBe('string');

    const listInvitesResponse = await request(app.getHttpServer())
      .get(`/organizer/tournaments/${tournamentId}/invites`)
      .set('authorization', `Bearer ${organizerToken}`)
      .expect(200);
    expect(Array.isArray(listInvitesResponse.body)).toBe(true);
    expect(
      listInvitesResponse.body.some(
        (invite: { id: string }) => invite.id === createInviteResponse.body?.id,
      ),
    ).toBe(true);

    const inviteToken = createInviteResponse.body?.inviteToken as string;

    const inviteInfoResponse = await request(app.getHttpServer())
      .get(`/registration/invite/${inviteToken}`)
      .expect(200);
    expect(inviteInfoResponse.body?.contactEmail).toBe(inviteEmail);
    expect(inviteInfoResponse.body?.status).toBe('PENDING');
    expect(inviteInfoResponse.body?.stageId).toBe(stageId);
    expect(inviteInfoResponse.body?.groupId).toBe(groupId);

    const acceptInviteResponse = await request(app.getHttpServer())
      .post(`/registration/invite/${inviteToken}`)
      .send(inviteRoster)
      .expect(201);

    expect(acceptInviteResponse.body?.status).toBe('ACCEPTED');
    expect(acceptInviteResponse.body?.teamId).toBeTruthy();
    expect(acceptInviteResponse.body?.stageId).toBe(stageId);
    expect(acceptInviteResponse.body?.groupId).toBe(groupId);

    await request(app.getHttpServer())
      .post(`/registration/invite/${inviteToken}`)
      .send(inviteRoster)
      .expect(409);

    const acceptedInvite = await prisma.tournamentInvite.findUnique({
      where: { inviteToken },
    });
    expect(acceptedInvite?.status).toBe(TournamentInviteStatus.ACCEPTED);
    expect(acceptedInvite?.acceptedAt).toBeTruthy();
    expect(acceptedInvite?.teamId).toBeTruthy();

    const acceptedInviteInfoResponse = await request(app.getHttpServer())
      .get(`/registration/invite/${inviteToken}`)
      .expect(200);
    expect(acceptedInviteInfoResponse.body?.status).toBe('ACCEPTED');
    expect(acceptedInviteInfoResponse.body?.teamId).toBe(
      acceptedInvite?.teamId,
    );

    expect(
      await prisma.tournamentRegistration.count({
        where: {
          tournamentId,
          contactEmail: inviteEmail,
        },
      }),
    ).toBe(0);

    const invitedTeam = await prisma.team.findUnique({
      where: { id: acceptedInvite?.teamId ?? '' },
    });
    expect(invitedTeam?.name).toBe(invitedTeamName);

    const invitedTournamentTeam = await prisma.tournamentTeam.findFirst({
      where: {
        tournamentId,
        teamId: invitedTeam?.id ?? '',
      },
    });
    expect(invitedTournamentTeam).not.toBeNull();

    const invitedStageMembership = await prisma.stageTeam.findFirst({
      where: {
        stageId,
        tournamentTeamId: invitedTournamentTeam?.id ?? '',
      },
    });
    expect(invitedStageMembership).not.toBeNull();

    const invitedGroupMembership = await prisma.groupTeam.findFirst({
      where: {
        groupId,
        tournamentTeamId: invitedTournamentTeam?.id ?? '',
        deletedAt: null,
      },
    });
    expect(invitedGroupMembership).not.toBeNull();

    const invitedTournamentPlayers = await prisma.tournamentPlayer.findMany({
      where: {
        tournamentTeamId: invitedTournamentTeam?.id ?? '',
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
    });
    expect(invitedTournamentPlayers).toHaveLength(6);
    expect(
      invitedTournamentPlayers.filter(
        (player) => player.lineupType === TournamentRosterLineupType.MAIN,
      ),
    ).toHaveLength(4);
    expect(
      invitedTournamentPlayers.filter(
        (player) => player.lineupType === TournamentRosterLineupType.SUBSTITUTE,
      ),
    ).toHaveLength(2);
  });
});

import {
  LobbyStatus,
  MatchTeamStatus,
  SessionRegistrationStatus,
  TeamBanScope,
  TeamMemberRole,
} from '@prisma/client';
import type { PrismaService } from '../../db/prisma.service';

type SyncSessionMatchSlotsParams = {
  sessionId: string;
  organizationId: string;
  matchId: string;
  dataMode?: string | null;
  dataSource?: string | null;
};

export type SyncSessionMatchSlotsResult = {
  matchId: string;
  teams: number;
  slots: number;
  updatedSlots: number;
  clearedSlots: number;
  resetResults: number;
};

type DesiredSlot = {
  slotNumber: number;
  teamId: string;
};

function lobbyStatusForMatch(match: {
  dataMode?: string | null;
  dataSource?: string | null;
}) {
  return (match.dataSource ?? match.dataMode ?? '').toString().toUpperCase() ===
    'MANUAL'
    ? LobbyStatus.WAITING
    : LobbyStatus.OFFLINE;
}

function slotChanged(
  existing:
    | {
        teamId: string | null;
        deletedAt?: Date | null;
        lobbyStatus?: LobbyStatus | null;
      }
    | null
    | undefined,
  teamId: string,
  lobbyStatus: LobbyStatus,
) {
  return (
    !existing ||
    existing.deletedAt !== null ||
    existing.teamId !== teamId ||
    existing.lobbyStatus !== lobbyStatus
  );
}

export async function syncMatchSlotsWithSessionRegistrations(
  prisma: PrismaService,
  params: SyncSessionMatchSlotsParams,
): Promise<SyncSessionMatchSlotsResult> {
  const registrations = await prisma.sessionRegistration.findMany({
    where: {
      sessionId: params.sessionId,
      organizationId: params.organizationId,
      deletedAt: null,
      status: {
        in: [
          SessionRegistrationStatus.CONFIRMED,
          SessionRegistrationStatus.CHECKED_IN,
        ],
      },
      slotNumber: { not: null },
    },
    select: {
      teamId: true,
      slotNumber: true,
    },
    orderBy: { slotNumber: 'asc' },
  });

  if (registrations.length === 0) {
    return {
      matchId: params.matchId,
      teams: 0,
      slots: 0,
      updatedSlots: 0,
      clearedSlots: 0,
      resetResults: 0,
    };
  }

  const bannedTeamIds = new Set(
    (
      await prisma.teamBan.findMany({
        where: {
          organizationId: params.organizationId,
          teamId: {
            in: registrations.map((registration) => registration.teamId),
          },
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          AND: [
            {
              OR: [
                { scope: TeamBanScope.TEAM },
                { scope: TeamBanScope.SESSION, sessionId: params.sessionId },
                { scope: TeamBanScope.MATCH, matchId: params.matchId },
              ],
            },
          ],
        },
        select: { teamId: true },
      })
    ).map((ban) => ban.teamId),
  );

  const registeredTeamIds = [
    ...new Set(registrations.map((registration) => registration.teamId)),
  ];
  const activeTeamMembers = registeredTeamIds.length
    ? await prisma.teamMember.findMany({
        where: {
          organizationId: params.organizationId,
          teamId: { in: registeredTeamIds },
          deletedAt: null,
          leftAt: null,
        },
        select: {
          teamId: true,
          discordUserId: true,
          role: true,
          createdAt: true,
        },
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      })
    : [];
  const managerIdsByTeamId = new Map<string, string[]>();
  for (const teamId of registeredTeamIds) {
    const members = activeTeamMembers.filter(
      (member) => member.teamId === teamId,
    );
    const leaders = members.filter(
      (member) => member.role === TeamMemberRole.LEADER,
    );
    const checkedMembers = leaders.length ? leaders : members;
    const discordUserIds = [
      ...new Set(
        checkedMembers
          .map((member) => member.discordUserId.trim())
          .filter((id) => /^\d{15,25}$/.test(id)),
      ),
    ];
    if (discordUserIds.length) {
      managerIdsByTeamId.set(teamId, discordUserIds);
    }
  }
  const managerDiscordIds = [
    ...new Set([...managerIdsByTeamId.values()].flat()),
  ];
  const bannedManagerIds = new Set(
    managerDiscordIds.length
      ? (
          await prisma.managerBan.findMany({
            where: {
              organizationId: params.organizationId,
              discordUserId: { in: managerDiscordIds },
              revokedAt: null,
              OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
              AND: [
                {
                  OR: [
                    { scope: TeamBanScope.TEAM },
                    {
                      scope: TeamBanScope.SESSION,
                      sessionId: params.sessionId,
                    },
                    { scope: TeamBanScope.MATCH, matchId: params.matchId },
                  ],
                },
              ],
            },
            select: { discordUserId: true },
          })
        ).map((ban) => ban.discordUserId)
      : [],
  );
  for (const [teamId, discordUserIds] of managerIdsByTeamId.entries()) {
    if (
      discordUserIds.some((discordUserId) =>
        bannedManagerIds.has(discordUserId),
      )
    ) {
      bannedTeamIds.add(teamId);
    }
  }

  const desiredSlots: DesiredSlot[] = registrations
    .filter(
      (
        registration,
      ): registration is typeof registration & { slotNumber: number } =>
        typeof registration.slotNumber === 'number' &&
        !bannedTeamIds.has(registration.teamId),
    )
    .map((registration) => ({
      slotNumber: registration.slotNumber,
      teamId: registration.teamId,
    }));

  const desiredTeamBySlot = new Map(
    desiredSlots.map((slot) => [slot.slotNumber, slot.teamId] as const),
  );
  const desiredSlotByTeam = new Map(
    desiredSlots.map((slot) => [slot.teamId, slot.slotNumber] as const),
  );
  const desiredSlotNumbers = Array.from(desiredTeamBySlot.keys());
  const desiredTeamIds = Array.from(desiredSlotByTeam.keys());
  const lobbyStatus = lobbyStatusForMatch(params);

  return prisma.$transaction(async (tx) => {
    const [existingSlots, existingMatchTeams] = await Promise.all([
      tx.matchSlot.findMany({
        where: {
          matchId: params.matchId,
          OR: [
            { deletedAt: null },
            { slotNumber: { in: desiredSlotNumbers } },
            { teamId: { in: desiredTeamIds } },
          ],
        },
        select: {
          id: true,
          slotNumber: true,
          teamId: true,
          lobbyStatus: true,
          deletedAt: true,
        },
      }),
      tx.matchTeam.findMany({
        where: {
          matchId: params.matchId,
          OR: [
            { deletedAt: null },
            { slot: { in: desiredSlotNumbers } },
            { teamId: { in: desiredTeamIds } },
          ],
        },
        select: {
          id: true,
          teamId: true,
          slot: true,
          deletedAt: true,
        },
      }),
    ]);

    const slotsByNumber = new Map(
      existingSlots.map((slot) => [slot.slotNumber, slot] as const),
    );
    const affectedSlotNumbers = new Set<number>();

    const staleSlotRows = existingSlots.filter((slot) => {
      const desiredTeamId = desiredTeamBySlot.get(slot.slotNumber);
      if (desiredTeamId !== undefined) {
        return slot.teamId !== desiredTeamId || slot.deletedAt !== null;
      }
      if (slot.teamId && desiredSlotByTeam.has(slot.teamId)) {
        return desiredSlotByTeam.get(slot.teamId) !== slot.slotNumber;
      }
      return slot.deletedAt === null && slot.teamId !== null;
    });

    if (staleSlotRows.length > 0) {
      staleSlotRows.forEach((slot) => affectedSlotNumbers.add(slot.slotNumber));
      await tx.matchSlot.updateMany({
        where: { id: { in: staleSlotRows.map((slot) => slot.id) } },
        data: {
          teamId: null,
          lobbyStatus: LobbyStatus.EMPTY,
          playersInLobby: 0,
        },
      });
    }

    let updatedSlots = staleSlotRows.length;
    for (const slot of desiredSlots) {
      const existing = slotsByNumber.get(slot.slotNumber);
      if (slotChanged(existing, slot.teamId, lobbyStatus)) {
        updatedSlots +=
          existing && !staleSlotRows.some((row) => row.id === existing.id)
            ? 1
            : 0;
        affectedSlotNumbers.add(slot.slotNumber);
      }
      await tx.matchSlot.upsert({
        where: {
          matchId_slotNumber: {
            matchId: params.matchId,
            slotNumber: slot.slotNumber,
          },
        },
        update: {
          teamId: slot.teamId,
          lobbyStatus,
          playersInLobby: 0,
          deletedAt: null,
        },
        create: {
          matchId: params.matchId,
          slotNumber: slot.slotNumber,
          teamId: slot.teamId,
          lobbyStatus,
          playersInLobby: 0,
        },
      });
    }

    const staleMatchTeamRows = existingMatchTeams.filter((row) => {
      const desiredTeamForSlot =
        typeof row.slot === 'number'
          ? desiredTeamBySlot.get(row.slot)
          : undefined;
      if (
        desiredTeamForSlot !== undefined &&
        desiredTeamForSlot !== row.teamId
      ) {
        return true;
      }
      if (!desiredSlotByTeam.has(row.teamId)) {
        return row.deletedAt === null;
      }
      return false;
    });

    if (staleMatchTeamRows.length > 0) {
      await tx.matchTeam.updateMany({
        where: { id: { in: staleMatchTeamRows.map((row) => row.id) } },
        data: {
          slot: null,
          deletedAt: new Date(),
        },
      });
    }

    for (const slot of desiredSlots) {
      await tx.matchTeam.upsert({
        where: {
          matchId_teamId: {
            matchId: params.matchId,
            teamId: slot.teamId,
          },
        },
        update: {
          slot: slot.slotNumber,
          status: MatchTeamStatus.ACTIVE,
          deletedAt: null,
        },
        create: {
          matchId: params.matchId,
          teamId: slot.teamId,
          slot: slot.slotNumber,
          status: MatchTeamStatus.ACTIVE,
        },
      });
    }

    let resetResults = 0;
    const affected = Array.from(affectedSlotNumbers);
    if (affected.length > 0) {
      const resultRows = await tx.matchSlotResult.findMany({
        where: {
          matchId: params.matchId,
          slotNumber: { in: affected },
        },
        select: {
          id: true,
          slotNumber: true,
          teamId: true,
          isLocked: true,
        },
      });
      for (const row of resultRows) {
        const desiredTeamId = desiredTeamBySlot.get(row.slotNumber) ?? null;
        if (row.isLocked || row.teamId === desiredTeamId) {
          continue;
        }
        await tx.matchSlotPlayerResult.deleteMany({
          where: { slotResultId: row.id },
        });
        await tx.matchSlotResult.update({
          where: { id: row.id },
          data: {
            teamId: desiredTeamId,
            wasPresentInMatch: desiredTeamId ? true : null,
            placement: null,
            eliminatedOrder: null,
            eliminatedAt: null,
            placementPoints: 0,
            totalKills: 0,
            manualTotalKills: false,
            finalPlacement: null,
            finalKills: null,
            finalizedAt: null,
            totalPoints: 0,
            points: 0,
            isAutoFilled: false,
            isLocked: false,
          },
        });
        resetResults += 1;
      }
    }

    return {
      matchId: params.matchId,
      teams: desiredTeamIds.length,
      slots: desiredSlotNumbers.length,
      updatedSlots,
      clearedSlots: staleSlotRows.length,
      resetResults,
    };
  });
}

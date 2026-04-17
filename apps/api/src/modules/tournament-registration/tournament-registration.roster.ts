import { BadRequestException } from '@nestjs/common';

export type TournamentRegistrationPlayerInput = {
  name?: string | null;
};

export type TournamentRegistrationRosterInput = {
  main?: TournamentRegistrationPlayerInput[] | null;
  subs?: TournamentRegistrationPlayerInput[] | null;
};

export type TournamentRegistrationRoster = {
  main: Array<{ name: string }>;
  subs: Array<{ name: string }>;
};

const normalizePlayerName = (value: string | null | undefined) =>
  value?.trim() ?? '';

export function normalizeTournamentRegistrationRoster(
  input: TournamentRegistrationRosterInput | null | undefined,
): TournamentRegistrationRoster {
  const mainRaw = Array.isArray(input?.main) ? input.main : null;
  const subsRaw = Array.isArray(input?.subs) ? input.subs : [];

  if (!mainRaw) {
    throw new BadRequestException('players.main is required');
  }

  if (mainRaw.length !== 4) {
    throw new BadRequestException('Exactly 4 main players are required');
  }

  if (subsRaw.length > 2) {
    throw new BadRequestException(
      'A maximum of 2 substitute players is allowed',
    );
  }

  const main = mainRaw.map((player, index) => {
    const name = normalizePlayerName(player?.name);
    if (!name) {
      throw new BadRequestException(
        `Main player ${index + 1} must have a non-empty name`,
      );
    }
    return { name };
  });

  const subs = subsRaw.map((player, index) => {
    const name = normalizePlayerName(player?.name);
    if (!name) {
      throw new BadRequestException(
        `Substitute player ${index + 1} must have a non-empty name`,
      );
    }
    return { name };
  });

  const seen = new Set<string>();
  for (const player of [...main, ...subs]) {
    const key = player.name.toLocaleLowerCase();
    if (seen.has(key)) {
      throw new BadRequestException(
        'Duplicate player names are not allowed in the same registration',
      );
    }
    seen.add(key);
  }

  return { main, subs };
}

export function parseTournamentRegistrationRoster(
  value: unknown,
): TournamentRegistrationRoster {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('Stored registration roster is invalid');
  }

  return normalizeTournamentRegistrationRoster(
    value as TournamentRegistrationRosterInput,
  );
}

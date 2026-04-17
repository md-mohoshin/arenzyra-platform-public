export function assertStructureChangeAllowed({
  tournamentStatus,
  actorRole,
  override,
}: {
  tournamentStatus?: string | null;
  actorRole: string;
  override?: boolean;
}) {
  if (actorRole === 'SUPER_ADMIN' && override === true) {
    return;
  }

  if (tournamentStatus === 'ACTIVE') {
    throw new Error('Tournament structure locked after activation.');
  }
}

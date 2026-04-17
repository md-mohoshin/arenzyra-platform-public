export type MatchContextType = 'SESSION' | 'TOURNAMENT';

type MatchContextSource = {
  sessionId?: string | null;
};

export function isSessionMatch(
  match: MatchContextSource | null | undefined,
): boolean {
  return (
    typeof match?.sessionId === 'string' && match.sessionId.trim().length > 0
  );
}

export function getMatchContext(match: MatchContextSource | null | undefined): {
  type: MatchContextType;
} {
  return {
    type: isSessionMatch(match) ? 'SESSION' : 'TOURNAMENT',
  };
}

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

export type TelemetryPromotionDiagnosticsScrubSummary = {
  rawPlayerNamesRemoved: number;
  rawPlayerIdentifiersRemoved: number;
  rosterPlayerNamesRemoved: number;
  teamsTouched: number;
};

export const sanitizeTelemetryPromotionDiagnostics = (
  value: unknown,
): unknown => {
  const diagnostics = asRecord(value);
  if (!diagnostics) {
    return value ?? null;
  }

  const rawOnlyTeams = Array.isArray(diagnostics.rawOnlyTeams)
    ? diagnostics.rawOnlyTeams
        .map((team) => {
          const teamRecord = asRecord(team);
          if (!teamRecord) {
            return null;
          }
          const sanitized = { ...teamRecord };
          delete sanitized.rawPlayerNames;
          delete sanitized.rawPlayerIdentifiers;
          delete sanitized.rosterPlayerNames;
          return sanitized;
        })
        .filter((team): team is Record<string, unknown> => team !== null)
    : [];

  return {
    ...diagnostics,
    rawOnlyTeams,
  };
};

export const summarizeTelemetryPromotionDiagnosticsScrub = (
  value: unknown,
): TelemetryPromotionDiagnosticsScrubSummary => {
  const diagnostics = asRecord(value);
  if (!diagnostics || !Array.isArray(diagnostics.rawOnlyTeams)) {
    return {
      rawPlayerNamesRemoved: 0,
      rawPlayerIdentifiersRemoved: 0,
      rosterPlayerNamesRemoved: 0,
      teamsTouched: 0,
    };
  }

  let rawPlayerNamesRemoved = 0;
  let rawPlayerIdentifiersRemoved = 0;
  let rosterPlayerNamesRemoved = 0;
  let teamsTouched = 0;

  for (const team of diagnostics.rawOnlyTeams) {
    const teamRecord = asRecord(team);
    if (!teamRecord) {
      continue;
    }

    let touched = false;
    if (Array.isArray(teamRecord.rawPlayerNames)) {
      rawPlayerNamesRemoved += teamRecord.rawPlayerNames.length;
      touched = true;
    }
    if (Array.isArray(teamRecord.rawPlayerIdentifiers)) {
      rawPlayerIdentifiersRemoved += teamRecord.rawPlayerIdentifiers.length;
      touched = true;
    }
    if (Array.isArray(teamRecord.rosterPlayerNames)) {
      rosterPlayerNamesRemoved += teamRecord.rosterPlayerNames.length;
      touched = true;
    }
    if (touched) {
      teamsTouched += 1;
    }
  }

  return {
    rawPlayerNamesRemoved,
    rawPlayerIdentifiersRemoved,
    rosterPlayerNamesRemoved,
    teamsTouched,
  };
};

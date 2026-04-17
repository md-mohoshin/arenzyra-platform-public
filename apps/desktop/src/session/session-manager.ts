import type {
  LauncherSession,
  MatchSummary,
  StageSummary,
  TournamentSummary,
} from "../types";

export type DashboardState = {
  tournaments: TournamentSummary[];
  stages: StageSummary[];
  matches: MatchSummary[];
  selectedTournamentId: string;
  selectedStageId: string;
  selectedMatchId: string;
};

export const hasAuthenticatedSession = (session: LauncherSession | null) =>
  Boolean(session?.user?.id);

export const createEmptyDashboardState = (): DashboardState => ({
  tournaments: [],
  stages: [],
  matches: [],
  selectedTournamentId: "",
  selectedStageId: "",
  selectedMatchId: "",
});

export const getNextSelectionId = <T extends { id: string }>(
  items: T[],
  currentId: string,
) => (items.some((item) => item.id === currentId) ? currentId : (items[0]?.id ?? ""));

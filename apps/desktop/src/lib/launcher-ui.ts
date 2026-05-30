import type {
  LauncherWorkflowState,
  MatchSummary,
} from "../types";

export type LauncherUiTone = "neutral" | "success" | "accent" | "danger";

const humanizeToken = (value: string | null | undefined) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .split(/[_\s-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const joinUniqueLabelParts = (
  parts: Array<string | null | undefined>,
) =>
  parts
    .map((part) => String(part || "").trim())
    .filter((part, index, all) => {
      if (!part) {
        return false;
      }
      const normalized = part.toLowerCase();
      return all.findIndex((candidate) => candidate.trim().toLowerCase() === normalized) === index;
    })
    .join(" / ");

export function formatMatchLabel(match: MatchSummary | null | undefined) {
  if (!match) {
    return "No match selected";
  }

  return (
    joinUniqueLabelParts([
      typeof match.matchNumber === "number" ? `Match ${match.matchNumber}` : null,
      match.name,
      match.group?.name,
    ]) || match.id
  );
}

export function formatSourceLabel(value: string | null | undefined) {
  const humanized = humanizeToken(value);
  return humanized || "Unavailable";
}

export function getWorkflowPresentation(state: LauncherWorkflowState): {
  label: string;
  detail: string;
  tone: LauncherUiTone;
} {
  switch (state) {
    case "MATCH_READY":
      return {
        label: "Match Ready",
        detail:
          "The launcher has match context and is ready to validate production before go-live.",
        tone: "accent",
      };
    case "MATCH_LIVE":
      return {
        label: "Match Live",
        detail:
          "The round is active and the launcher is following live backend lifecycle updates.",
        tone: "accent",
      };
    case "PRODUCTION_CHECKING":
      return {
        label: "Checking",
        detail:
          "Production validation is running to confirm connector, assets, widgets, and match state.",
        tone: "neutral",
      };
    case "PRODUCTION_READY":
      return {
        label: "Production Ready",
        detail:
          "Preflight passed. The observer desk is ready for live production.",
        tone: "success",
      };
    case "PRODUCTION_BLOCKED":
      return {
        label: "Blocked",
        detail:
          "Production checks found blocking issues. Resolve them before launching live tooling.",
        tone: "danger",
      };
    case "PRODUCTION_LIVE":
      return {
        label: "Production Live",
        detail:
          "Live production is active for the selected match.",
        tone: "success",
      };
    case "MATCH_FINISHED":
      return {
        label: "Finished",
        detail:
          "The current match is locked and the launcher is waiting for the next actionable round.",
        tone: "danger",
      };
    case "NEXT_MATCH_AVAILABLE":
      return {
        label: "Next Match Ready",
        detail:
          "The backend suggested the next round and the launcher can prepare the next context.",
        tone: "accent",
      };
    case "NEXT_MATCH_PREPARED":
      return {
        label: "Prepared",
        detail:
          "Launcher context switched to the next match. Live tools stay idle until you start the observer desk.",
        tone: "success",
      };
    case "NO_MATCH":
    default:
      return {
        label: "Select Match",
        detail:
          "Choose a tournament, stage, and match to open the observer command deck.",
        tone: "neutral",
      };
  }
}

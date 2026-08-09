const STAFF_COMMANDS = new Set([
  "apply-results",
  "arenzyra-doctor",
  "arenzyra ban manager",
  "ban-control",
  "captain-panel",
  "changename",
  "control-panel",
  "create-scrim",
  "idp",
  "live-center",
  "map-slots",
  "play-buttons",
  "preview-results",
  "production-pins",
  "production-setup",
  "result-control",
  "schedule-event",
  "session-audit",
  "staff-tasks",
  "start-scrim",
  "ticket-panel",
  "waitlist-control",
]);

const STAFF_CONTROL_ACTIONS = new Set([
  "create-scrim",
  "configure-scrim",
  "setup-channels",
  "sync-discord",
  "remove-team",
  "start-scrim",
  "post-room",
  "map-slots",
  "preview-results",
  "apply-results",
]);

const STAFF_COMPONENT_PREFIXES = [
  "destructive:",
  "clean-channel:",
  "autoclean:full:",
  "regctl:",
  "regctl-remove-",
  "regslot:",
  "waitctl:",
  "banctl:",
  "banctl-modal:",
  "cardban:",
  "cardban-modal:",
  "cardban-permanent-modal:",
  "livecenter:",
  "resultctl:",
  "resultctl-modal:",
  "resultctl-session-select",
  "resultedit:",
  "resultedit-modal:",
  "resultmanual:",
  "resultmanual-modal:",
  "resultban:",
  "resultban-modal:",
  "sessctl:",
  "result:auto:",
  "banflow:",
  "autoreggrant:",
  "stafftask:",
];

const SELF_SERVICE_COMPONENT_PREFIXES = [
  "play:",
  "playpick:",
  "captain:",
  "ticket:",
  "idpdm:reply:",
  "idpdm:modal:",
];

const SELF_SERVICE_CONTROL_ACTIONS = new Set([
  "register-team",
  "join-scrim",
  "leave-scrim",
  "list-slots",
  "standings",
]);

const SESSION_SCOPED_COMMANDS = new Set([
  "arenzyra-doctor",
  "captain-panel",
  "control-panel",
  "live-center",
  "result-control",
  "schedule-event",
  "session-audit",
  "start-scrim",
]);

export function commandRequiresStaff(commandName: string) {
  return STAFF_COMMANDS.has(String(commandName || "").trim().toLowerCase());
}

export function commandAuthorizationSessionId(
  commandName: string,
  getStringOption: (name: string) => string | null,
) {
  const normalizedCommand = String(commandName || "").trim().toLowerCase();
  if (!SESSION_SCOPED_COMMANDS.has(normalizedCommand)) {
    return null;
  }
  return getStringOption("session-id")?.trim() || null;
}

export function componentRequiresStaff(customId: string) {
  return componentAuthorizationPolicy(customId) === "staff";
}

export function componentAuthorizationPolicy(
  customId: string,
): "staff" | "self-service" | "unclassified" {
  const normalized = String(customId || "").trim();
  if (normalized.startsWith("control:") || normalized.startsWith("control-modal:")) {
    const parts = normalized.split(":");
    if (STAFF_CONTROL_ACTIONS.has(parts[1] || "")) return "staff";
    if (SELF_SERVICE_CONTROL_ACTIONS.has(parts[1] || "")) return "self-service";
    return "unclassified";
  }
  if (
    STAFF_COMPONENT_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  ) {
    return "staff";
  }
  if (
    SELF_SERVICE_COMPONENT_PREFIXES.some((prefix) =>
      normalized.startsWith(prefix),
    )
  ) {
    return "self-service";
  }
  return "unclassified";
}

export function componentAuthorizationSessionId(customId: string) {
  const normalized = String(customId || "").trim();
  if (!componentRequiresStaff(normalized)) return null;
  const parts = normalized.split(":");

  if (normalized.startsWith("autoclean:full:")) return parts[3] || null;
  if (normalized.startsWith("control:")) return parts.slice(2).join(":") || null;
  if (normalized.startsWith("control-modal:")) return parts.slice(2).join(":") || null;
  if (normalized.startsWith("regctl:rm:")) return parts[3] || null;
  if (normalized.startsWith("regctl:")) return parts[2] || null;
  if (normalized.startsWith("regslot:")) return parts[1] || null;
  if (normalized.startsWith("waitctl:")) return parts[2] || null;
  if (normalized.startsWith("banctl-modal:")) return parts[2] || null;
  if (normalized.startsWith("banctl:")) {
    return parts[1] === "confirm" || parts[1] === "cancel"
      ? null
      : parts[2] || null;
  }
  if (normalized.startsWith("cardban-modal:")) return parts[1] || null;
  if (normalized.startsWith("cardban-permanent-modal:")) return parts[1] || null;
  if (normalized.startsWith("cardban:")) return parts[2] || null;
  if (normalized.startsWith("livecenter:")) return parts[2] || null;
  if (normalized.startsWith("resultctl-modal:")) return parts.slice(2).join(":") || null;
  if (normalized.startsWith("resultctl:")) return parts.slice(2).join(":") || null;
  if (normalized.startsWith("resultedit:match:")) return parts.slice(2).join(":") || null;
  if (normalized.startsWith("resultedit:rows:") || normalized.startsWith("resultedit:page:")) {
    return parts[2] || null;
  }
  if (normalized.startsWith("resultmanual:open:")) return parts[2] || null;
  if (normalized.startsWith("resultban:select:")) return parts[2] || null;
  if (normalized.startsWith("sessctl:")) return parts.slice(2).join(":") || null;
  return null;
}

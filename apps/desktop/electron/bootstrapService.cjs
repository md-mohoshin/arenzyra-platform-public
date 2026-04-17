"use strict";

const BOOTSTRAP_STAGE_NAMES = Object.freeze([
  "APP_INIT",
  "CONFIG_LOAD",
  "SESSION_RESTORE",
  "AUTH_VALIDATION",
  "LICENSE_CHECK",
  "SEAT_ACQUIRE",
  "START_WIDGET_SERVER",
  "ASSET_VALIDATION",
  "INITIAL_HEALTH_SNAPSHOT",
  "READY_STATE",
]);

function toIsoTimestamp(value = Date.now()) {
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  return null;
}

function getErrorMessage(error, fallback = "Bootstrap stage failed.") {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  return fallback;
}

function cloneStageState(stageState = {}) {
  return {
    status: stageState.status || "pending",
    startedAt: stageState.startedAt || null,
    completedAt: stageState.completedAt || null,
    error: stageState.error || null,
    meta:
      typeof stageState.meta === "undefined" ? undefined : stageState.meta,
  };
}

function cloneBootstrapState(state = {}) {
  const stages = {};
  for (const stageName of BOOTSTRAP_STAGE_NAMES) {
    stages[stageName] = cloneStageState(state?.stages?.[stageName]);
  }

  return {
    stage: state.stage || null,
    completedStages: Array.isArray(state.completedStages)
      ? [...state.completedStages]
      : [],
    failedStages: Array.isArray(state.failedStages) ? [...state.failedStages] : [],
    ready: state.ready === true,
    startedAt: state.startedAt || null,
    completedAt: state.completedAt || null,
    stages,
  };
}

function createInitialState() {
  return cloneBootstrapState({
    stage: null,
    completedStages: [],
    failedStages: [],
    ready: false,
    startedAt: null,
    completedAt: null,
    stages: Object.fromEntries(
      BOOTSTRAP_STAGE_NAMES.map((stageName) => [
        stageName,
        {
          status: "pending",
          startedAt: null,
          completedAt: null,
          error: null,
          meta: undefined,
        },
      ]),
    ),
  });
}

function createBootstrapService(options = {}) {
  const logger =
    options?.logger &&
    typeof options.logger.info === "function" &&
    typeof options.logger.warn === "function" &&
    typeof options.logger.error === "function"
      ? options.logger
      : {
          info() {},
          warn() {},
          error() {},
        };
  const stages = Array.isArray(options?.stages) ? options.stages : [];

  let state = createInitialState();
  let bootstrapPromise = null;
  let didBootstrap = false;

  function getStatus() {
    return cloneBootstrapState(state);
  }

  async function runStage(stageDefinition) {
    const stageName = String(stageDefinition?.name || "").trim();
    if (!stageName) {
      return;
    }

    const stageState = state.stages[stageName] || {
      status: "pending",
      startedAt: null,
      completedAt: null,
      error: null,
      meta: undefined,
    };

    state.stage = stageName;
    stageState.status = "in_progress";
    stageState.startedAt = toIsoTimestamp();
    stageState.completedAt = null;
    stageState.error = null;
    stageState.meta = undefined;
    state.stages[stageName] = stageState;

    logger.info(`[Bootstrap] Starting: ${stageName}`, {
      stage: stageName,
    });

    try {
      const result =
        typeof stageDefinition?.run === "function"
          ? await stageDefinition.run({
              getStatus,
              stage: stageName,
            })
          : null;

      if (result?.failed === true) {
        const reason = getErrorMessage(result?.reason, `${stageName} failed.`);
        stageState.status = "failed";
        stageState.completedAt = toIsoTimestamp();
        stageState.error = reason;
        stageState.meta =
          typeof result?.meta === "undefined" ? undefined : result.meta;
        if (!state.failedStages.includes(stageName)) {
          state.failedStages.push(stageName);
        }
        logger.error(`[Bootstrap] Failed: ${stageName}`, {
          stage: stageName,
          reason,
          meta: stageState.meta,
        });
        return;
      }

      stageState.status = "completed";
      stageState.completedAt = toIsoTimestamp();
      stageState.error = null;
      stageState.meta =
        typeof result?.meta !== "undefined"
          ? result.meta
          : typeof result === "undefined"
            ? undefined
            : result;
      if (!state.completedStages.includes(stageName)) {
        state.completedStages.push(stageName);
      }

      logger.info(`[Bootstrap] Completed: ${stageName}`, {
        stage: stageName,
        meta: stageState.meta,
      });
    } catch (error) {
      const reason = getErrorMessage(error, `${stageName} failed.`);
      stageState.status = "failed";
      stageState.completedAt = toIsoTimestamp();
      stageState.error = reason;
      stageState.meta = undefined;
      if (!state.failedStages.includes(stageName)) {
        state.failedStages.push(stageName);
      }
      logger.error(`[Bootstrap] Failed: ${stageName}`, {
        stage: stageName,
        reason,
      });
    }
  }

  async function bootstrap() {
    if (bootstrapPromise) {
      return bootstrapPromise;
    }

    if (didBootstrap && state.ready) {
      return getStatus();
    }

    state = createInitialState();
    state.startedAt = toIsoTimestamp();

    bootstrapPromise = (async () => {
      for (const stageDefinition of stages) {
        await runStage(stageDefinition);
      }

      state.ready = true;
      state.completedAt = toIsoTimestamp();
      didBootstrap = true;
      return getStatus();
    })().finally(() => {
      bootstrapPromise = null;
    });

    return bootstrapPromise;
  }

  return {
    bootstrap,
    getStatus,
  };
}

module.exports = {
  BOOTSTRAP_STAGE_NAMES,
  createBootstrapService,
};

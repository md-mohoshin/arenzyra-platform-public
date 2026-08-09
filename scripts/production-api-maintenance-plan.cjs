#!/usr/bin/env node
"use strict";

const IDP_CONFIRMATION = "BACKFILL_IDP_CREDENTIALS";
const YOUTUBE_CONFIRMATION = "ROTATE_YOUTUBE_TOKEN_ENCRYPTION";
const SAFE_CURSOR = /^[A-Za-z0-9_-]{1,191}$/;

function parsePositiveIntegerOption(argument, prefix, maximum) {
  if (!argument.startsWith(prefix)) return null;
  const raw = argument.slice(prefix.length);
  if (!/^[1-9][0-9]*$/.test(raw) || Number(raw) > maximum) {
    throw new Error(`Invalid ${prefix.slice(0, -1)} value.`);
  }
  return argument;
}

function parseMaintenanceArguments(argv) {
  if (argv.length < 2) {
    throw new Error("A maintenance task and action are required.");
  }
  const [task, action, ...options] = argv;
  if (!new Set(["idp-credentials", "youtube-tokens"]).has(task)) {
    throw new Error("Unknown production API maintenance task.");
  }
  const allowedActions =
    task === "idp-credentials"
      ? new Set(["dry-run", "apply"])
      : new Set(["dry-run", "scan", "apply"]);
  if (!allowedActions.has(action)) {
    throw new Error("Unsupported action for the selected maintenance task.");
  }

  let confirmation = null;
  let writersStopped = false;
  let batchSize = null;
  let maxRows = null;
  let startAfter = null;
  for (const option of options) {
    if (option === "--writers-stopped") {
      if (writersStopped) throw new Error("Duplicate maintenance option.");
      writersStopped = true;
      continue;
    }
    if (option.startsWith("--confirm=")) {
      if (confirmation !== null)
        throw new Error("Duplicate maintenance option.");
      confirmation = option.slice("--confirm=".length);
      continue;
    }
    const parsedBatch = parsePositiveIntegerOption(
      option,
      "--batch-size=",
      500,
    );
    if (parsedBatch) {
      if (batchSize !== null) throw new Error("Duplicate maintenance option.");
      batchSize = parsedBatch;
      continue;
    }
    const parsedMaximum = parsePositiveIntegerOption(
      option,
      "--max-rows=",
      10_000,
    );
    if (parsedMaximum) {
      if (maxRows !== null) throw new Error("Duplicate maintenance option.");
      maxRows = parsedMaximum;
      continue;
    }
    if (option.startsWith("--start-after=")) {
      if (startAfter !== null) throw new Error("Duplicate maintenance option.");
      const cursor = option.slice("--start-after=".length);
      if (!SAFE_CURSOR.test(cursor)) {
        throw new Error("Invalid YouTube scan cursor.");
      }
      startAfter = option;
      continue;
    }
    throw new Error("Unknown production API maintenance option.");
  }

  const apply = action === "apply";
  const expectedConfirmation =
    task === "idp-credentials" ? IDP_CONFIRMATION : YOUTUBE_CONFIRMATION;
  if (apply && confirmation !== expectedConfirmation) {
    throw new Error("Apply mode requires the exact task confirmation.");
  }
  if (!apply && confirmation !== null) {
    throw new Error("Confirmation is accepted only in apply mode.");
  }

  if (task === "idp-credentials") {
    if (batchSize || maxRows || startAfter) {
      throw new Error("YouTube scan options cannot be used for the IDP task.");
    }
    if (apply && !writersStopped) {
      throw new Error("IDP apply requires --writers-stopped.");
    }
    if (!apply && writersStopped) {
      throw new Error("--writers-stopped is accepted only for IDP apply.");
    }
  } else if (writersStopped) {
    throw new Error("--writers-stopped is accepted only for IDP apply.");
  }

  const runner =
    task === "idp-credentials"
      ? "dist-maintenance/scripts/backfill-idp-credentials.js"
      : "dist-maintenance/scripts/rotate-youtube-token-encryption.js";
  const runnerArguments = [];
  if (apply) {
    runnerArguments.push("--apply", `--confirm=${expectedConfirmation}`);
  }
  for (const option of [batchSize, maxRows, startAfter]) {
    if (option) runnerArguments.push(option);
  }

  return {
    task,
    action,
    apply,
    requireStoppedApi: task === "idp-credentials" && apply,
    runner,
    runnerArguments,
  };
}

function main() {
  try {
    const plan = parseMaintenanceArguments(process.argv.slice(2));
    for (const value of [
      plan.task,
      plan.action,
      plan.requireStoppedApi ? "1" : "0",
      plan.runner,
      ...plan.runnerArguments,
    ]) {
      process.stdout.write(`${value}\n`);
    }
  } catch (error) {
    process.stderr.write(`MAINTENANCE COMMAND BLOCKED: ${error.message}\n`);
    process.exitCode = 2;
  }
}

if (require.main === module) main();

module.exports = {
  IDP_CONFIRMATION,
  YOUTUBE_CONFIRMATION,
  parseMaintenanceArguments,
};

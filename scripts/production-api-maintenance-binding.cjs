#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  assertResolvedComposeTargets,
  parseEnvText,
  validateProductionDatabaseTargetContract,
} = require("./production-database-target.cjs");

const TASK_ENVIRONMENT_KEYS = {
  "idp-credentials": [
    "NODE_ENV",
    "DATABASE_URL",
    "IDP_CREDENTIAL_ENCRYPTION_KEY",
  ],
  "youtube-tokens": [
    "NODE_ENV",
    "DATABASE_URL",
    "YOUTUBE_TOKEN_ENCRYPTION_KEY_ID",
    "YOUTUBE_TOKEN_ENCRYPTION_KEY",
    "YOUTUBE_TOKEN_ENCRYPTION_PREVIOUS_KEYS",
    "YOUTUBE_TOKEN_ENCRYPTION_LEGACY_V1_KEY",
  ],
};
const TASK_SERVICES = {
  "idp-credentials": {
    read: "api-maintenance-idp-read",
    apply: "api-maintenance-idp-apply",
  },
  "youtube-tokens": {
    read: "api-maintenance-youtube-read",
    apply: "api-maintenance-youtube-apply",
  },
};
const TASK_DATABASE_ENVIRONMENT_KEYS = {
  "idp-credentials": {
    read: "MAINTENANCE_READ_DATABASE_URL",
    apply: "IDP_MAINTENANCE_DATABASE_URL",
  },
  "youtube-tokens": {
    read: "MAINTENANCE_READ_DATABASE_URL",
    apply: "YOUTUBE_MAINTENANCE_DATABASE_URL",
  },
};
const TASK_ENTRYPOINTS = {
  "idp-credentials": [
    "node",
    "dist-maintenance/scripts/backfill-idp-credentials.js",
  ],
  "youtube-tokens": [
    "node",
    "dist-maintenance/scripts/rotate-youtube-token-encryption.js",
  ],
};
const SAFE_RELEASE_ID = /^[A-Za-z0-9._-]{1,128}$/;
const SOURCE_DIGEST = /^sha256:[a-f0-9]{64}$/;
const GIT_REVISION = /^[a-f0-9]{12}$/;
const MAINTENANCE_SERVICE_FIELDS = new Set([
  "cap_drop",
  "command",
  "entrypoint",
  "environment",
  "image",
  "logging",
  "networks",
  "profiles",
  "read_only",
  "restart",
  "security_opt",
  "tmpfs",
]);

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function assertMaintenanceServiceShape(service) {
  if (!isPlainObject(service)) {
    throw new Error("The maintenance service contract is invalid.");
  }
  const fields = Object.keys(service).sort();
  const expectedFields = [...MAINTENANCE_SERVICE_FIELDS].sort();
  if (JSON.stringify(fields) !== JSON.stringify(expectedFields)) {
    throw new Error("The maintenance service contains unreviewed fields.");
  }
  if (
    !isPlainObject(service.environment) ||
    !Array.isArray(service.entrypoint) ||
    !service.entrypoint.every((entry) => typeof entry === "string") ||
    !Array.isArray(service.command) ||
    !Array.isArray(service.profiles) ||
    !Array.isArray(service.cap_drop) ||
    !Array.isArray(service.security_opt) ||
    !Array.isArray(service.tmpfs) ||
    !isPlainObject(service.logging) ||
    JSON.stringify(Object.keys(service.logging).sort()) !==
      JSON.stringify(["driver", "options"]) ||
    service.logging.driver !== "local" ||
    !isPlainObject(service.logging.options) ||
    JSON.stringify(Object.keys(service.logging.options).sort()) !==
      JSON.stringify(["max-file", "max-size"]) ||
    service.logging.options["max-file"] !== "5" ||
    service.logging.options["max-size"] !== "20m" ||
    !isPlainObject(service.networks) ||
    JSON.stringify(Object.keys(service.networks)) !==
      JSON.stringify(["default"]) ||
    !(
      service.networks.default === null ||
      (isPlainObject(service.networks.default) &&
        Object.keys(service.networks.default).length === 0)
    )
  ) {
    throw new Error("The maintenance service field shapes are not reviewed.");
  }
}

function composeEnvironment(service) {
  if (!service || typeof service !== "object") return {};
  if (Array.isArray(service.environment)) {
    return Object.fromEntries(
      service.environment.map((entry) => {
        const value = String(entry);
        const equalsAt = value.indexOf("=");
        return equalsAt < 0
          ? [value, ""]
          : [value.slice(0, equalsAt), value.slice(equalsAt + 1)];
      }),
    );
  }
  return service.environment ?? {};
}

function maintenanceVariant(task, action) {
  if (action === "apply") return "apply";
  if (
    (task === "idp-credentials" && action === "dry-run") ||
    (task === "youtube-tokens" && ["dry-run", "scan"].includes(action))
  ) {
    return "read";
  }
  throw new Error("Unknown production maintenance task action.");
}

function assertMaintenanceBinding({
  action,
  compose,
  publishEnv,
  releaseEnv,
  task,
}) {
  const requiredKeys = TASK_ENVIRONMENT_KEYS[task];
  if (!requiredKeys) throw new Error("Unknown production maintenance task.");
  const variant = maintenanceVariant(task, action);
  const service = compose?.services?.[TASK_SERVICES[task][variant]];
  assertMaintenanceServiceShape(service);

  const databaseContract = validateProductionDatabaseTargetContract(publishEnv);
  if (databaseContract.errors.length > 0) {
    throw new Error("The reviewed production database contract is invalid.");
  }
  assertResolvedComposeTargets(compose, publishEnv);

  const releaseId = releaseEnv.ARENZYRA_RELEASE_ID ?? "";
  if (!SAFE_RELEASE_ID.test(releaseId)) {
    throw new Error("The reviewed release metadata has an invalid release ID.");
  }
  const imageReference = `arenzyra-api:${releaseId}`;
  const api = compose?.services?.api;
  if (!api || api.image !== imageReference) {
    throw new Error(
      "The resolved API image differs from the reviewed release.",
    );
  }
  const expectedBuildArguments = {
    ARENZYRA_RELEASE_ID: releaseId,
    ARENZYRA_SOURCE_DIGEST: releaseEnv.ARENZYRA_SOURCE_DIGEST ?? "",
    ARENZYRA_GIT_COMMIT: releaseEnv.ARENZYRA_GIT_COMMIT ?? "",
    ARENZYRA_BUILD_AT: releaseEnv.ARENZYRA_BUILD_AT ?? "",
    ARENZYRA_BUILD_SOURCE: releaseEnv.ARENZYRA_BUILD_SOURCE ?? "",
  };
  for (const [key, value] of Object.entries(expectedBuildArguments)) {
    if (api?.build?.args?.[key] !== value) {
      throw new Error(`The resolved API build differs from reviewed ${key}.`);
    }
  }

  if (service.image !== imageReference) {
    throw new Error(
      "The maintenance service is not bound to the reviewed image-only release.",
    );
  }
  const expectedEntrypoint = TASK_ENTRYPOINTS[task];
  if (
    JSON.stringify(service.entrypoint) !== JSON.stringify(expectedEntrypoint)
  ) {
    throw new Error("The maintenance service entrypoint is not reviewed.");
  }
  if (!Array.isArray(service.command) || service.command.length !== 0) {
    throw new Error(
      "The maintenance service command must be empty by default.",
    );
  }
  if (
    service.read_only !== true ||
    JSON.stringify(service.profiles) !== JSON.stringify(["maintenance"]) ||
    JSON.stringify(service.cap_drop) !== JSON.stringify(["ALL"]) ||
    service.cap_add != null ||
    JSON.stringify(service.security_opt) !==
      JSON.stringify(["no-new-privileges:true"]) ||
    JSON.stringify(service.tmpfs) !==
      JSON.stringify(["/tmp:rw,noexec,nosuid,size=64m"]) ||
    service.restart !== "no" ||
    (Array.isArray(service.volumes) && service.volumes.length > 0) ||
    (Array.isArray(service.ports) && service.ports.length > 0) ||
    (Array.isArray(service.devices) && service.devices.length > 0) ||
    (Array.isArray(service.configs) && service.configs.length > 0) ||
    (Array.isArray(service.secrets) && service.secrets.length > 0) ||
    service.privileged === true ||
    service.user != null ||
    service.group_add != null ||
    service.pid != null ||
    service.ipc != null ||
    service.network_mode != null ||
    service.sysctls != null
  ) {
    throw new Error("The maintenance service isolation policy is incomplete.");
  }

  const environment = composeEnvironment(service);
  if (
    JSON.stringify(Object.keys(environment).sort()) !==
    JSON.stringify([...requiredKeys].sort())
  ) {
    throw new Error(
      "The maintenance service environment is not least privilege.",
    );
  }
  for (const key of requiredKeys) {
    const reviewedKey =
      key === "DATABASE_URL"
        ? TASK_DATABASE_ENVIRONMENT_KEYS[task][variant]
        : key;
    const reviewedValue =
      key === "NODE_ENV" ? "production" : (publishEnv[reviewedKey] ?? "");
    if (
      typeof environment[key] !== "string" ||
      environment[key] !== reviewedValue
    ) {
      throw new Error(
        `The resolved API maintenance environment differs from reviewed ${key}.`,
      );
    }
  }
}

function assertImageProvenance({ imageInspect, imageReference, releaseEnv }) {
  const releaseId = releaseEnv.ARENZYRA_RELEASE_ID ?? "";
  const sourceDigest = releaseEnv.ARENZYRA_SOURCE_DIGEST ?? "";
  const revision = releaseEnv.ARENZYRA_GIT_COMMIT ?? "";
  const builtAt = releaseEnv.ARENZYRA_BUILD_AT ?? "";
  const releaseSource = releaseEnv.ARENZYRA_BUILD_SOURCE ?? "";
  const canonicalBuiltAt = Number.isFinite(Date.parse(builtAt))
    ? new Date(builtAt).toISOString()
    : "";
  const expectedRevision =
    releaseSource === "git"
      ? GIT_REVISION.test(revision)
        ? revision
        : ""
      : releaseSource === "source-digest" && SOURCE_DIGEST.test(sourceDigest)
        ? `source-${sourceDigest.slice(7, 19)}`
        : "";
  if (
    !SAFE_RELEASE_ID.test(releaseId) ||
    !SOURCE_DIGEST.test(sourceDigest) ||
    revision !== expectedRevision ||
    canonicalBuiltAt !== builtAt ||
    !new Set(["git", "source-digest"]).has(releaseSource) ||
    !releaseId.startsWith(`${releaseSource}-`) ||
    !releaseId.endsWith(`-${sourceDigest.slice(7, 19)}`) ||
    imageReference !== `arenzyra-api:${releaseId}`
  ) {
    throw new Error("Reviewed API image provenance metadata is invalid.");
  }
  if (!Array.isArray(imageInspect) || imageInspect.length !== 1) {
    throw new Error("Exactly one local API image inspection is required.");
  }
  const image = imageInspect[0];
  if (
    typeof image?.Id !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(image.Id) ||
    !Array.isArray(image.RepoTags) ||
    !image.RepoTags.includes(imageReference)
  ) {
    throw new Error("The inspected local API image tag is not reviewed.");
  }
  const imageEnvironment = image?.Config?.Env;
  const forbiddenBakedEnvironment = new Set(
    Object.values(TASK_ENVIRONMENT_KEYS)
      .flat()
      .filter((key) => key !== "NODE_ENV"),
  );
  if (
    image?.Config?.User !== "node" ||
    image?.Config?.WorkingDir !== "/app" ||
    JSON.stringify(image?.Config?.Cmd) !==
      JSON.stringify(["node", "dist/main"]) ||
    JSON.stringify(image?.Config?.Entrypoint) !==
      JSON.stringify(["docker-entrypoint.sh"]) ||
    !Array.isArray(imageEnvironment) ||
    imageEnvironment.some((entry) =>
      forbiddenBakedEnvironment.has(String(entry).split("=", 1)[0]),
    )
  ) {
    throw new Error("The inspected API image runtime policy is not reviewed.");
  }
  const labels = image?.Config?.Labels ?? {};
  const expectedLabels = {
    "org.opencontainers.image.version": releaseId,
    "org.opencontainers.image.revision": revision,
    "org.opencontainers.image.created": builtAt,
    "com.arenzyra.source-digest": sourceDigest,
    "com.arenzyra.release-source": releaseSource,
  };
  for (const [key, value] of Object.entries(expectedLabels)) {
    if (labels[key] !== value) {
      throw new Error(`The inspected API image differs from reviewed ${key}.`);
    }
  }
  return image.Id;
}

function pinMaintenanceImage({ action, compose, task, imageId }) {
  const variant = maintenanceVariant(task, action);
  const serviceName = TASK_SERVICES[task]?.[variant];
  if (!serviceName || !/^sha256:[a-f0-9]{64}$/.test(imageId ?? "")) {
    throw new Error(
      "A reviewed maintenance task and immutable image ID are required.",
    );
  }
  if (!compose?.services?.[serviceName]) {
    throw new Error("The reviewed maintenance service is missing.");
  }
  const pinned = structuredClone(compose);
  pinned.services[serviceName].image = imageId;
  delete pinned.services[serviceName].build;
  return pinned;
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main() {
  try {
    const publishFile = argumentValue("--publish-env");
    const releaseFile = argumentValue("--release-env");
    const releaseEnv = releaseFile
      ? parseEnvText(fs.readFileSync(path.resolve(releaseFile), "utf8"))
      : null;
    let input;
    try {
      input = JSON.parse(fs.readFileSync(0, "utf8"));
    } catch {
      throw new Error("Maintenance assertion JSON is invalid.");
    }
    if (process.argv.includes("--assert-image-json")) {
      const imageReference = argumentValue("--image-reference");
      if (!releaseEnv || !imageReference) {
        throw new Error("Release env and image reference are required.");
      }
      const imageId = assertImageProvenance({
        imageInspect: input,
        imageReference,
        releaseEnv,
      });
      process.stdout.write(
        process.argv.includes("--print-image-id")
          ? `${imageId}\n`
          : "PRODUCTION API IMAGE PROVENANCE VERIFIED\n",
      );
      return;
    }
    const action = argumentValue("--action");
    const task = argumentValue("--task");
    if (!publishFile || !releaseEnv || !task || !action) {
      throw new Error(
        "Publish env, release env, task, and action are required.",
      );
    }
    const binding = {
      compose: input,
      action,
      publishEnv: parseEnvText(
        fs.readFileSync(path.resolve(publishFile), "utf8"),
      ),
      releaseEnv,
      task,
    };
    assertMaintenanceBinding(binding);
    if (process.argv.includes("--pin-maintenance-image-json")) {
      const imageId = argumentValue("--image-id");
      process.stdout.write(
        `${JSON.stringify(pinMaintenanceImage({ action, compose: input, task, imageId }))}\n`,
      );
      return;
    }
    process.stdout.write("PRODUCTION API MAINTENANCE BINDING VERIFIED\n");
  } catch (error) {
    process.stderr.write(
      `PRODUCTION API MAINTENANCE BLOCKED: ${error.message}\n`,
    );
    process.exitCode = 75;
  }
}

if (require.main === module) main();

module.exports = {
  assertImageProvenance,
  assertMaintenanceBinding,
  composeEnvironment,
  pinMaintenanceImage,
};

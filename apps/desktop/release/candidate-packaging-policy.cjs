"use strict";

const path = require("node:path");

const CANDIDATE_CONFIG_NAME = "electron-builder.candidate.config.cjs";

function collectOptionValues(argv, optionName) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = String(argv[index]);
    if (argument === optionName) {
      const value = argv[index + 1];
      if (typeof value !== "string" || value.startsWith("--")) {
        values.push("");
      } else {
        values.push(value);
        index += 1;
      }
      continue;
    }
    if (argument.startsWith(`${optionName}=`)) {
      values.push(argument.slice(optionName.length + 1));
    }
  }
  return values;
}

function assertCandidatePackagingInvocation({ argv = process.argv } = {}) {
  const publishValues = collectOptionValues(argv, "--publish");
  const configValues = collectOptionValues(argv, "--config");
  if (
    publishValues.length !== 1 ||
    publishValues[0] !== "never" ||
    configValues.length !== 1 ||
    path.basename(configValues[0]) !== CANDIDATE_CONFIG_NAME
  ) {
    throw new Error(
      "Representative desktop candidate packaging requires the dedicated candidate config and exactly one --publish never option. Candidate artifacts are not release or publication inputs.",
    );
  }
  return true;
}

module.exports = {
  CANDIDATE_CONFIG_NAME,
  assertCandidatePackagingInvocation,
};

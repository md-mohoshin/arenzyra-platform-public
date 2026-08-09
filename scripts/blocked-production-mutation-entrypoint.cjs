#!/usr/bin/env node
"use strict";

const action = String(process.argv[2] || "production mutation").replace(
  /[^a-zA-Z0-9:_-]/g,
  "_",
);

process.stderr.write(
  `PRODUCTION MUTATION BLOCKED action=${action}: raw npm/check-out script entrypoints cannot establish source trust. ` +
    "Use the exact reviewed-commit outer launcher in infra/PUBLISH.md. No production action was attempted.\n",
);
process.exitCode = 75;

"use strict";

const MAX_BYTES = 8 * 1024 * 1024;
const chunks = [];
let bytes = 0;

process.stdin.on("data", (chunk) => {
  bytes += chunk.length;
  if (bytes > MAX_BYTES) {
    process.exitCode = 1;
    process.stdin.destroy();
    return;
  }
  chunks.push(chunk);
});

process.stdin.on("end", () => {
  if (process.exitCode) return;
  try {
    const document = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (
      !Array.isArray(document) ||
      document.length !== 1 ||
      !document[0] ||
      typeof document[0] !== "object" ||
      !document[0].Plan
    ) {
      throw new Error("invalid plan envelope");
    }

    let selected = null;
    const visit = (node) => {
      if (!node || typeof node !== "object" || Array.isArray(node)) {
        throw new Error("invalid plan node");
      }
      const plans = node.Plans;
      if (plans !== undefined && !Array.isArray(plans)) {
        throw new Error("invalid child plans");
      }
      if (
        node["Node Type"] === "Append" &&
        Array.isArray(plans) &&
        plans.length > 0 &&
        plans.length <= 200 &&
        (!selected || plans.length > selected.length)
      ) {
        selected = plans;
      }
      for (const child of plans || []) visit(child);
    };
    visit(document[0].Plan);
    if (!selected) throw new Error("append plan unavailable");

    const violating = [];
    let total = 0;
    selected.forEach((child, index) => {
      const rows = child["Actual Rows"];
      const loops = child["Actual Loops"];
      if (
        !Number.isSafeInteger(rows) ||
        rows < 0 ||
        !Number.isSafeInteger(loops) ||
        loops < 0
      ) {
        throw new Error("invalid execution count");
      }
      const count = rows * loops;
      if (!Number.isSafeInteger(count)) throw new Error("unsafe execution count");
      total += count;
      if (!Number.isSafeInteger(total)) throw new Error("unsafe total count");
      if (count > 0) violating.push(`${index + 1}:${count}`);
    });

    process.stdout.write(
      `branches=${selected.length} violating=${violating.join(",") || "none"} total=${total}`,
    );
  } catch {
    process.exitCode = 1;
  }
});

process.stdin.resume();

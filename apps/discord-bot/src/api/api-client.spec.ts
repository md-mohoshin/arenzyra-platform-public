import assert from "node:assert/strict";
import test from "node:test";
import { ArenzyraApiClient, toFriendlyApiError } from "./api-client";

function captureRequestConfigs() {
  const configs: any[] = [];
  const client = new ArenzyraApiClient({} as any);
  (client as any).request = async (config: any) => {
    configs.push(config);
    return { data: [] };
  };
  return { client, configs };
}

test("result workflow match lookup uses the extended timeout only when requested", async () => {
  const { client, configs } = captureRequestConfigs();

  await client.listSessionMatches("session-1");
  await client.listSessionMatches("session-1", { resultWorkflow: true });

  assert.equal(configs[0].timeout, undefined);
  assert.equal(configs[1].timeout, 120_000);
});

test("screenshot result apply uses the extended result workflow timeout", async () => {
  const { client, configs } = captureRequestConfigs();

  await client.applyScreenshotResults({ matchId: "match-1", results: [] });

  assert.equal(configs[0].timeout, 120_000);
});

test("ban and final result writes use the extended result workflow timeout", async () => {
  const { client, configs } = captureRequestConfigs();

  await client.applyNoShowAutoBansForMatch("match-1");
  await client.prepareConditionalBanFinalSnapshot("session-1", {} as any);
  await client.sealConditionalBanFinalSnapshot("session-1", {} as any);
  await client.finalizeConditionalBanEnrollments("session-1", {} as any);
  await client.resetSessionResults("session-1");

  assert.deepEqual(
    configs.map((config) => config.timeout),
    [120_000, 120_000, 120_000, 120_000, 120_000],
  );
});

test("Axios timeout wording is not exposed to Discord users", () => {
  assert.equal(
    toFriendlyApiError(new Error("timeout of 10000ms exceeded")),
    "Arenzyra took too long to finish this request. Check whether the action completed before trying again.",
  );
});

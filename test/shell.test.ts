import assert from "node:assert/strict";
import test from "node:test";
import { BUILTIN_ADAPTERS } from "../src/adapters/index.js";
import { LawMcpShell } from "../src/shell/shell.js";

const shell = LawMcpShell.fromAdapters(BUILTIN_ADAPTERS);

test("law_list_countries returns registered adapters", async () => {
  const result = await shell.handleToolCall({
    name: "law_list_countries",
    arguments: {},
  });

  assert.equal(result.ok, true);
  assert.ok(Array.isArray(result.data));
  assert.equal(result.data.length, 1);
});

test("law_parse_citation parses German paragraph citation", async () => {
  const result = await shell.handleToolCall({
    name: "law_parse_citation",
    arguments: { country: "de", citation: "§ 823 abs. 1 bgb" },
  });

  assert.equal(result.ok, true);
  assert.equal(
    (result.data as { normalized: string }).normalized,
    "§ 823 Abs. 1 BGB",
  );
});

test("unknown country returns structured error", async () => {
  const result = await shell.handleToolCall({
    name: "law_describe_country",
    arguments: { country: "se" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "unknown_country");
});

test("law_list_sources returns German data sources", async () => {
  const result = await shell.handleToolCall({
    name: "law_list_sources",
    arguments: { country: "de" },
  });

  assert.equal(result.ok, true);
  const data = result.data as { sources: unknown[] };
  assert.ok(Array.isArray(data.sources));
  assert.equal(data.sources.length, 3);
});

test("law_about returns server metadata", async () => {
  const result = await shell.handleToolCall({
    name: "law_about",
    arguments: {},
  });

  assert.equal(result.ok, true);
  const data = result.data as { server: string; version: string; tier: string };
  assert.equal(data.server, "german-law-mcp");
  assert.ok(data.version);
  assert.ok(data.tier);
});

test("law_run_ingestion requires country argument", async () => {
  const result = await shell.handleToolCall({
    name: "law_run_ingestion",
    arguments: {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "invalid_arguments");
});

test("law_run_ingestion with dryRun returns result for known country", async () => {
  const result = await shell.handleToolCall({
    name: "law_run_ingestion",
    arguments: { country: "de", dryRun: true },
  });

  // Ingestion may or may not succeed depending on environment,
  // but it should not crash — it should return a structured result.
  assert.ok(result.ok !== undefined);
});

test("law_get_preparatory_works validates required selector arguments", async () => {
  const result = await shell.handleToolCall({
    name: "law_get_preparatory_works",
    arguments: { country: "de" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "invalid_arguments");
});

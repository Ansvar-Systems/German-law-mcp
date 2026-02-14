import assert from "node:assert/strict";
import test from "node:test";
import { BUILTIN_ADAPTERS } from "../src/adapters/index.js";
import { LawMcpShell } from "../src/shell/shell.js";

const shell = LawMcpShell.fromAdapters(BUILTIN_ADAPTERS);

test("law.list_countries returns registered adapters", async () => {
  const result = await shell.handleToolCall({
    name: "law.list_countries",
    arguments: {},
  });

  assert.equal(result.ok, true);
  assert.ok(Array.isArray(result.data));
  assert.equal(result.data.length, 1);
});

test("law.parse_citation parses German paragraph citation", async () => {
  const result = await shell.handleToolCall({
    name: "law.parse_citation",
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
    name: "law.describe_country",
    arguments: { country: "se" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "unknown_country");
});

test("law.get_preparatory_works validates required selector arguments", async () => {
  const result = await shell.handleToolCall({
    name: "law.get_preparatory_works",
    arguments: { country: "de" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "invalid_arguments");
});

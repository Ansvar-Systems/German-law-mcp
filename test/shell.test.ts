import assert from "node:assert/strict";
import test from "node:test";
import { BUILTIN_ADAPTERS } from "../src/adapters/index.js";
import { LawMcpShell } from "../src/shell/shell.js";

const shell = LawMcpShell.fromAdapters(BUILTIN_ADAPTERS);

test("parse_citation parses German paragraph citation", async () => {
  const result = await shell.handleToolCall({
    name: "parse_citation",
    arguments: { citation: "§ 823 abs. 1 bgb" },
  });

  assert.equal(result.ok, true);
  assert.equal(
    (result.data as { normalized: string }).normalized,
    "§ 823 Abs. 1 BGB",
  );
});

test("list_sources returns German data sources", async () => {
  const result = await shell.handleToolCall({
    name: "list_sources",
    arguments: {},
  });

  assert.equal(result.ok, true);
  const data = result.data as { sources: unknown[] };
  assert.ok(Array.isArray(data.sources));
  assert.equal(data.sources.length, 3);
});

test("about returns server metadata", async () => {
  const result = await shell.handleToolCall({
    name: "about",
    arguments: {},
  });

  assert.equal(result.ok, true);
  const data = result.data as { server: string; version: string; tier: string };
  assert.equal(data.server, "german-law-mcp");
  assert.ok(data.version);
  assert.ok(data.tier);
});

test("get_preparatory_works validates required selector arguments", async () => {
  const result = await shell.handleToolCall({
    name: "get_preparatory_works",
    arguments: {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "invalid_arguments");
});

import assert from "node:assert/strict";
import test from "node:test";
import { BUILTIN_ADAPTERS } from "../src/adapters/index.js";
import { LawMcpShell } from "../src/shell/shell.js";

const shell = LawMcpShell.fromAdapters(BUILTIN_ADAPTERS);

test("de adapter serves about metadata", async () => {
  const result = await shell.handleToolCall({
    name: "about",
    arguments: {},
  });

  assert.equal(result.ok, true);
  assert.equal(
    (result.data as { jurisdiction: string }).jurisdiction,
    "DE",
  );
});

test("de citation validation supports paragraph and article formats", async () => {
  const paragraphResult = await shell.handleToolCall({
    name: "validate_citation",
    arguments: { citation: "§ 242 Abs. 1 StGB" },
  });
  assert.equal(paragraphResult.ok, true);
  assert.equal((paragraphResult.data as { valid: boolean }).valid, true);

  const articleResult = await shell.handleToolCall({
    name: "validate_citation",
    arguments: { citation: "Art. 1 Abs. 1 GG" },
  });
  assert.equal(articleResult.ok, true);
  assert.equal((articleResult.data as { valid: boolean }).valid, true);
});

test("de citation parser normalizes common German variants", async () => {
  const articleKeywordResult = await shell.handleToolCall({
    name: "parse_citation",
    arguments: { citation: "Artikel 1 Absatz 1 GG" },
  });

  assert.equal(articleKeywordResult.ok, true);
  assert.equal(
    (articleKeywordResult.data as { normalized: string }).normalized,
    "Art. 1 Abs. 1 GG",
  );

  const numberResult = await shell.handleToolCall({
    name: "parse_citation",
    arguments: { citation: "§ 823 Abs 1 Nr 2 BGB" },
  });

  assert.equal(numberResult.ok, true);
  assert.equal(
    (numberResult.data as { normalized: string }).normalized,
    "§ 823 Abs. 1 Nr. 2 BGB",
  );
});

test("de citation validation rejects unsupported formats", async () => {
  const result = await shell.handleToolCall({
    name: "validate_citation",
    arguments: { citation: "BVerfG 1 BvR 123/45" },
  });

  assert.equal(result.ok, true);
  assert.equal((result.data as { valid: boolean }).valid, false);
});

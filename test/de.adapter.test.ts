import assert from "node:assert/strict";
import test from "node:test";
import { BUILTIN_ADAPTERS } from "../src/adapters/index.js";
import { LawMcpShell } from "../src/shell/shell.js";

const shell = LawMcpShell.fromAdapters(BUILTIN_ADAPTERS);

test("de adapter is discoverable", async () => {
  const result = await shell.handleToolCall({
    name: "law.describe_country",
    arguments: { country: "de" },
  });

  assert.equal(result.ok, true);
  assert.equal(
    (result.data as { country: { code: string } }).country.code,
    "de",
  );
  assert.equal(
    (result.data as { tools: Record<string, boolean> }).tools["law.search_case_law"],
    true,
  );
  assert.equal(
    (result.data as { tools: Record<string, boolean> }).tools["law.get_preparatory_works"],
    true,
  );
});

test("de citation validation supports paragraph and article formats", async () => {
  const paragraphResult = await shell.handleToolCall({
    name: "law.validate_citation",
    arguments: { country: "de", citation: "§ 242 Abs. 1 StGB" },
  });
  assert.equal(paragraphResult.ok, true);
  assert.equal((paragraphResult.data as { valid: boolean }).valid, true);

  const articleResult = await shell.handleToolCall({
    name: "law.validate_citation",
    arguments: { country: "de", citation: "Art. 1 Abs. 1 GG" },
  });
  assert.equal(articleResult.ok, true);
  assert.equal((articleResult.data as { valid: boolean }).valid, true);
});

test("de citation parser normalizes common German variants", async () => {
  const articleKeywordResult = await shell.handleToolCall({
    name: "law.parse_citation",
    arguments: { country: "de", citation: "Artikel 1 Absatz 1 GG" },
  });

  assert.equal(articleKeywordResult.ok, true);
  assert.equal(
    (articleKeywordResult.data as { normalized: string }).normalized,
    "Art. 1 Abs. 1 GG",
  );

  const numberResult = await shell.handleToolCall({
    name: "law.parse_citation",
    arguments: { country: "de", citation: "§ 823 Abs 1 Nr 2 BGB" },
  });

  assert.equal(numberResult.ok, true);
  assert.equal(
    (numberResult.data as { normalized: string }).normalized,
    "§ 823 Abs. 1 Nr. 2 BGB",
  );
});

test("de citation validation rejects unsupported formats", async () => {
  const result = await shell.handleToolCall({
    name: "law.validate_citation",
    arguments: { country: "de", citation: "BVerfG 1 BvR 123/45" },
  });

  assert.equal(result.ok, true);
  assert.equal((result.data as { valid: boolean }).valid, false);
});

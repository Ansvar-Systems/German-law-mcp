import assert from "node:assert/strict";
import test from "node:test";
import {
  createRegexCitationHandlers,
  searchDocumentsInMemory,
} from "../src/shell/adapter-kit.js";
import type { LawDocument } from "../src/shell/types.js";

const SAMPLE_DOCUMENTS: LawDocument[] = [
  {
    id: "a-1",
    country: "xx",
    kind: "statute",
    title: "Sample Education Act",
    citation: "XX-2024-1",
    textSnippet: "Education rules and rights.",
  },
  {
    id: "a-2",
    country: "xx",
    kind: "case",
    title: "Court interpretation",
    citation: "XX-2024-2",
    textSnippet: "Case law details.",
  },
];

test("searchDocumentsInMemory matches title/citation/snippet and clamps limit", () => {
  const result = searchDocumentsInMemory(SAMPLE_DOCUMENTS, {
    query: "xx-2024",
    limit: 1,
  });

  assert.equal(result.total, 1);
  assert.equal(result.documents[0]?.id, "a-1");
});

test("createRegexCitationHandlers parses and validates expected format", async () => {
  const handlers = createRegexCitationHandlers({
    pattern: /^XX-(?<year>\d{4})-(?<number>\d+)$/i,
    reason: "Bad format",
    normalize: ({ year, number }) => `XX-${year}-${number}`,
  });

  const parsed = await handlers.parseCitation("XX-2024-15");
  assert.equal(parsed?.normalized, "XX-2024-15");

  const valid = await handlers.validateCitation("XX-2024-15");
  assert.equal(valid.valid, true);

  const invalid = await handlers.validateCitation("invalid");
  assert.equal(invalid.valid, false);
  assert.equal(invalid.reason, "Bad format");
});

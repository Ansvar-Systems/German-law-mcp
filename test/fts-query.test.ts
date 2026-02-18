import test from "node:test";
import assert from "node:assert/strict";
import { buildFtsQueryVariants } from "../src/utils/fts-query.js";

test("plain query returns prefix AND form", () => {
  const result = buildFtsQueryVariants("Datenschutz Gesetz");
  assert.equal(result.primary, "Datenschutz* Gesetz*");
  assert.equal(result.fallback, "Datenschutz* OR Gesetz*");
});

test("single token returns prefix without fallback", () => {
  const result = buildFtsQueryVariants("Kündigungsschutz");
  assert.equal(result.primary, "Kündigungsschutz*");
  assert.equal(result.fallback, undefined);
});

test("empty query returns empty primary", () => {
  const result = buildFtsQueryVariants("");
  assert.equal(result.primary, "");
});

test("double quotes are stripped to prevent FTS5 parse errors", () => {
  const result = buildFtsQueryVariants('"unmatched quote');
  assert.ok(!result.primary.includes('"'), "should not contain raw double quotes");
});

test("parentheses are escaped in explicit FTS syntax", () => {
  const result = buildFtsQueryVariants("test(value)");
  assert.ok(result.primary.includes('"("'), "opening paren should be quoted");
  assert.ok(result.primary.includes('")"'), "closing paren should be quoted");
});

test("query with only special characters returns escaped form", () => {
  const result = buildFtsQueryVariants("()^:");
  // Each special char gets wrapped in double quotes: "(" ")" "^" ":"
  assert.ok(result.primary.includes('"("'), "( should be quoted");
  assert.ok(result.primary.includes('")"'), ") should be quoted");
  assert.ok(result.primary.includes('"^"'), "^ should be quoted");
  assert.ok(result.primary.includes('":"'), ": should be quoted");
});

test("mixed quotes and operators are handled safely", () => {
  const result = buildFtsQueryVariants('a" OR b');
  // The quote is stripped, then remaining text is escaped
  assert.ok(!result.primary.includes('a"'), "double quote should be stripped");
});

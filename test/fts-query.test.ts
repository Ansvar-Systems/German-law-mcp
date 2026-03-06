import test from "node:test";
import assert from "node:assert/strict";
import { buildFtsQueryVariants, sanitizeFtsInput } from "../src/utils/fts-query.js";

test("plain query returns tiered FTS5 variants", () => {
  const result = buildFtsQueryVariants("Datenschutz Gesetz");
  assert.ok(result.length >= 2, "should return multiple variants");
  assert.ok(result[0]!.includes("Datenschutz"), "first variant should contain search terms");
});

test("single token returns prefix variant", () => {
  const result = buildFtsQueryVariants("Kündigungsschutz");
  assert.ok(result.length >= 1, "should return at least one variant");
  assert.ok(result.some(v => v.includes("*")), "should include a prefix wildcard variant");
});

test("empty query returns empty array", () => {
  const result = buildFtsQueryVariants("");
  assert.equal(result.length, 0);
});

test("sanitizeFtsInput strips double quotes", () => {
  const sanitized = sanitizeFtsInput('"unmatched quote');
  assert.ok(!sanitized.includes('"'), "should not contain raw double quotes");
  const result = buildFtsQueryVariants(sanitized);
  assert.ok(Array.isArray(result), "should return an array");
});

test("sanitizeFtsInput strips parentheses", () => {
  const sanitized = sanitizeFtsInput("test(value)");
  const result = buildFtsQueryVariants(sanitized);
  const joined = result.join(" ");
  assert.ok(joined.includes("test") && joined.includes("value"), "should contain the search terms");
});

test("sanitizeFtsInput handles special characters", () => {
  const sanitized = sanitizeFtsInput("()^:");
  const result = buildFtsQueryVariants(sanitized);
  assert.ok(Array.isArray(result), "should return an array");
});

test("sanitizeFtsInput handles mixed quotes and operators", () => {
  const sanitized = sanitizeFtsInput('a" OR b');
  const result = buildFtsQueryVariants(sanitized);
  assert.ok(Array.isArray(result), "should return an array");
  assert.ok(result.every(v => typeof v === "string"), "all variants should be strings");
});

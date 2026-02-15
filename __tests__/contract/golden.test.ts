import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { LawMcpShell } from "../../src/shell/shell.js";
import { BUILTIN_ADAPTERS } from "../../src/adapters/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Fixture types
// ---------------------------------------------------------------------------

interface GoldenTestAssertions {
  result_not_empty?: boolean;
  text_contains?: string[];
  any_result_contains?: string[];
  fields_present?: string[];
  text_not_empty?: boolean;
  min_results?: number;
  citation_url_pattern?: string;
  upstream_text_hash?: { url: string; expected_sha256: string };
  citation_resolves?: boolean;
  handles_gracefully?: boolean;
}

interface GoldenTest {
  id: string;
  category: string;
  description: string;
  tool: string;
  input: Record<string, unknown>;
  assertions: GoldenTestAssertions;
}

interface GoldenTestsFile {
  $schema?: string;
  version: string;
  mcp_name: string;
  description: string;
  tests: GoldenTest[];
}

interface ToolResult {
  tool: string;
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string; details?: unknown };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").replace(/[\r\n]+/g, " ").trim().toLowerCase();
}

function sha256(text: string): string {
  return createHash("sha256").update(normalizeText(text)).digest("hex");
}

function extractCitationUrls(data: unknown): string[] {
  const urls: string[] = [];
  const text = JSON.stringify(data);
  const urlRegex = /https?:\/\/[^\s"'<>]+/g;
  let match: RegExpExecArray | null;
  while ((match = urlRegex.exec(text)) !== null) {
    urls.push(match[0]);
  }
  return urls;
}

async function fetchWithTimeout(
  url: string,
  timeoutMs = 10_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function stringifyData(data: unknown): string {
  if (typeof data === "string") return data;
  return JSON.stringify(data, null, 0) ?? "";
}

// ---------------------------------------------------------------------------
// Load fixtures & create shell
// ---------------------------------------------------------------------------

const fixturesPath = join(process.cwd(), "fixtures", "golden-tests.json");
const fixtureContent = readFileSync(fixturesPath, "utf-8");
const fixture = JSON.parse(fixtureContent) as GoldenTestsFile;

const shell = LawMcpShell.fromAdapters(BUILTIN_ADAPTERS);

const isNightly = process.env["CONTRACT_MODE"] === "nightly";

// ---------------------------------------------------------------------------
// Contract test runner
// ---------------------------------------------------------------------------

describe(`Contract tests: ${fixture.mcp_name}`, () => {
  for (const test of fixture.tests) {
    describe(`[${test.id}] ${test.description}`, () => {
      let result: ToolResult;

      it("runs without throwing", async () => {
        result = (await shell.handleToolCall({
          name: test.tool as never,
          arguments: test.input,
        })) as ToolResult;
        assert.ok(result, "result should be defined");
        assert.equal(result.tool, test.tool);
      });

      if (test.assertions.result_not_empty) {
        it("result is not empty", async () => {
          result ??= (await shell.handleToolCall({
            name: test.tool as never,
            arguments: test.input,
          })) as ToolResult;

          if (result.ok) {
            assert.ok(result.data !== undefined, "data should be defined");
          } else {
            assert.ok(result.error !== undefined, "error should be defined");
          }
        });
      }

      if (test.assertions.text_contains) {
        for (const needle of test.assertions.text_contains) {
          it(`result contains text "${needle}"`, async () => {
            result ??= (await shell.handleToolCall({
              name: test.tool as never,
              arguments: test.input,
            })) as ToolResult;

            const haystack = stringifyData(result.data).toLowerCase();
            assert.ok(
              haystack.includes(needle.toLowerCase()),
              `Expected "${needle}" in result`,
            );
          });
        }
      }

      if (test.assertions.any_result_contains) {
        for (const needle of test.assertions.any_result_contains) {
          it(`any result item contains "${needle}"`, async () => {
            result ??= (await shell.handleToolCall({
              name: test.tool as never,
              arguments: test.input,
            })) as ToolResult;

            const haystack = stringifyData(result.data).toLowerCase();
            assert.ok(
              haystack.includes(needle.toLowerCase()),
              `Expected "${needle}" in result`,
            );
          });
        }
      }

      if (test.assertions.fields_present) {
        it(`result has fields: ${test.assertions.fields_present.join(", ")}`, async () => {
          result ??= (await shell.handleToolCall({
            name: test.tool as never,
            arguments: test.input,
          })) as ToolResult;

          assert.equal(result.ok, true);
          const data = result.data as Record<string, unknown>;
          assert.ok(data, "data should be defined");
          for (const field of test.assertions.fields_present!) {
            assert.ok(
              field in data,
              `Expected field "${field}" in result data`,
            );
          }
        });
      }

      if (test.assertions.text_not_empty) {
        it("result text is not empty", async () => {
          result ??= (await shell.handleToolCall({
            name: test.tool as never,
            arguments: test.input,
          })) as ToolResult;

          const text = stringifyData(result.data);
          assert.ok(text.trim().length > 0, "result text should not be empty");
        });
      }

      if (test.assertions.min_results !== undefined) {
        it(`returns at least ${test.assertions.min_results} results`, async () => {
          result ??= (await shell.handleToolCall({
            name: test.tool as never,
            arguments: test.input,
          })) as ToolResult;

          const data = result.data;
          const items = Array.isArray(data)
            ? data
            : Array.isArray((data as Record<string, unknown>)?.documents)
              ? (data as Record<string, unknown>).documents
              : [];
          assert.ok(
            (items as unknown[]).length >= test.assertions.min_results!,
            `Expected at least ${test.assertions.min_results} results`,
          );
        });
      }

      if (test.assertions.citation_url_pattern) {
        it(`citation URLs match pattern: ${test.assertions.citation_url_pattern}`, async () => {
          result ??= (await shell.handleToolCall({
            name: test.tool as never,
            arguments: test.input,
          })) as ToolResult;

          const urls = extractCitationUrls(result.data);
          const pattern = new RegExp(test.assertions.citation_url_pattern!);
          assert.ok(urls.length > 0, "Expected at least one URL");
          for (const url of urls) {
            assert.match(url, pattern);
          }
        });
      }

      if (test.assertions.upstream_text_hash && isNightly) {
        const hashAssertion = test.assertions.upstream_text_hash;
        it(`upstream text hash matches for ${hashAssertion.url}`, async () => {
          const response = await fetchWithTimeout(hashAssertion.url);
          assert.ok(response.ok, `Expected HTTP 200 for ${hashAssertion.url}`);
          const body = await response.text();
          const hash = sha256(body);
          assert.equal(hash, hashAssertion.expected_sha256);
        });
      }

      if (test.assertions.citation_resolves && isNightly) {
        it("citation URLs resolve (HTTP 200)", async () => {
          result ??= (await shell.handleToolCall({
            name: test.tool as never,
            arguments: test.input,
          })) as ToolResult;

          const urls = extractCitationUrls(result.data);
          assert.ok(urls.length > 0, "Expected at least one URL");
          for (const url of urls) {
            const response = await fetchWithTimeout(url);
            assert.ok(
              response.ok,
              `Expected HTTP 200 for ${url}, got ${response.status}`,
            );
          }
        });
      }

      if (test.assertions.handles_gracefully) {
        it("handles gracefully (no unhandled exception)", async () => {
          result ??= (await shell.handleToolCall({
            name: test.tool as never,
            arguments: test.input,
          })) as ToolResult;

          assert.equal(result.tool, test.tool);
        });
      }
    });
  }
});

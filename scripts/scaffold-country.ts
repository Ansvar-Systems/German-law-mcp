import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

interface CliOptions {
  code: string;
  name: string;
  language: string;
  source: string;
  register: boolean;
  dryRun: boolean;
}

const ADAPTER_INDEX_PATH = "src/adapters/index.ts";
const IMPORT_START_MARKER = "// scaffold-imports-start";
const IMPORT_END_MARKER = "// scaffold-imports-end";
const ARRAY_START_MARKER = "// scaffold-adapters-start";
const ARRAY_END_MARKER = "// scaffold-adapters-end";

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  validateCode(options.code);

  const adapterPath = `src/adapters/${options.code}.ts`;
  const sampleDataPath = `src/sample-data/${options.code}-legislation.ts`;
  const testPath = `test/${options.code}.adapter.test.ts`;

  await assertNotExists(adapterPath);
  await assertNotExists(sampleDataPath);
  await assertNotExists(testPath);

  const files: Array<{ filePath: string; content: string }> = [
    {
      filePath: adapterPath,
      content: buildAdapterTemplate(options),
    },
    {
      filePath: sampleDataPath,
      content: buildSampleDataTemplate(options),
    },
    {
      filePath: testPath,
      content: buildTestTemplate(options),
    },
  ];

  if (options.register) {
    const registry = await readFile(resolveRoot(ADAPTER_INDEX_PATH), "utf8");
    const updated = updateAdapterRegistry(registry, options.code);

    files.push({
      filePath: ADAPTER_INDEX_PATH,
      content: updated,
    });
  }

  if (options.dryRun) {
    printDryRun(files.map((entry) => entry.filePath), options);
    return;
  }

  for (const file of files) {
    const absolutePath = resolveRoot(file.filePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, file.content, "utf8");
  }

  process.stdout.write(
    [
      `Created template files for "${options.name}" (${options.code}).`,
      `- ${adapterPath}`,
      `- ${sampleDataPath}`,
      `- ${testPath}`,
      options.register
        ? `- Updated ${ADAPTER_INDEX_PATH}`
        : `- Skipped adapter registry update (--no-register)`,
      "Next steps:",
      `1. Replace sample data and citation rules in ${adapterPath}.`,
      `2. Run: npm run typecheck && npm test`,
    ].join("\n") + "\n",
  );
}

function parseCliOptions(argv: string[]): CliOptions {
  const flags = parseFlags(argv);
  const code = (getStringFlag(flags, "code") ?? "").toLowerCase();
  const name = getStringFlag(flags, "name") ?? code.toUpperCase();
  const language = getStringFlag(flags, "language") ?? code;
  const source = getStringFlag(flags, "source") ?? "official-source";
  const register = !flags["no-register"];
  const dryRun = Boolean(flags["dry-run"]);

  if (!code) {
    throw new Error(
      "Missing required flag --code. Example: npm run scaffold:country -- --code de --name Germany --language de --source gesetze-im-internet",
    );
  }

  return {
    code,
    name,
    language,
    source,
    register,
    dryRun,
  };
}

function parseFlags(argv: string[]): Record<string, string | boolean> {
  const output: Record<string, string | boolean> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token?.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];
    const hasValue = typeof next === "string" && !next.startsWith("--");

    if (hasValue) {
      output[key] = next;
      index += 1;
    } else {
      output[key] = true;
    }
  }

  return output;
}

function getStringFlag(
  flags: Record<string, string | boolean>,
  key: string,
): string | undefined {
  const value = flags[key];
  return typeof value === "string" ? value : undefined;
}

function validateCode(code: string): void {
  if (!/^[a-z]{2,3}$/.test(code)) {
    throw new Error(
      `Invalid country code "${code}". Use 2-3 lowercase letters, for example "de" or "fra".`,
    );
  }
}

async function assertNotExists(relativeFilePath: string): Promise<void> {
  try {
    await readFile(resolveRoot(relativeFilePath), "utf8");
    throw new Error(`File already exists: ${relativeFilePath}`);
  } catch (error) {
    const message = (error as Error).message;
    if (!message.includes("ENOENT")) {
      throw error;
    }
  }
}

function buildAdapterTemplate(options: CliOptions): string {
  const variablePrefix = countryVariablePrefix(options.code);
  const adapterName = `${variablePrefix}Adapter`;
  const sampleConst = `${variablePrefix.toUpperCase()}_LEGISLATION`;
  const citationPrefix = options.code.toUpperCase();

  return `import { ${sampleConst} } from "../sample-data/${options.code}-legislation.js";
import {
  createRegexCitationHandlers,
  createStaticIngestionRunner,
  getDocumentFromMemory,
  searchDocumentsInMemory,
} from "../shell/adapter-kit.js";
import type { CountryAdapter } from "../shell/types.js";

const ${citationPrefix}_CITATION_PATTERN =
  /^${citationPrefix}-(?<year>\\\\d{4})-(?<number>\\\\d+)$/i;

const { parseCitation, validateCitation } = createRegexCitationHandlers({
  pattern: ${citationPrefix}_CITATION_PATTERN,
  reason:
    "Citation does not match expected format (${citationPrefix}-YYYY-NNN). Update this rule for ${options.name}.",
  normalize: ({ year, number }) => \`${citationPrefix}-\${year}-\${number}\`,
});

const runIngestion = createStaticIngestionRunner({
  defaultSource: "${options.source}",
  count: ${sampleConst}.length,
});

export const ${adapterName}: CountryAdapter = {
  country: {
    code: "${options.code}",
    name: "${escapeString(options.name)}",
    defaultLanguage: "${options.language}",
    sources: ["${options.source}"],
  },
  capabilities: {
    documents: true,
    citations: true,
    ingestion: true,
  },
  async searchDocuments(request) {
    return searchDocumentsInMemory(${sampleConst}, request);
  },
  async getDocument(id) {
    return getDocumentFromMemory(${sampleConst}, id);
  },
  parseCitation,
  validateCitation,
  runIngestion,
};
`;
}

function buildSampleDataTemplate(options: CliOptions): string {
  const sampleConst = `${countryVariablePrefix(options.code).toUpperCase()}_LEGISLATION`;
  const citationPrefix = options.code.toUpperCase();

  return `import type { LawDocument } from "../shell/types.js";

export const ${sampleConst}: LawDocument[] = [
  {
    id: "${options.code}-sample-001",
    country: "${options.code}",
    kind: "statute",
    title: "${escapeString(options.name)} Sample Act",
    citation: "${citationPrefix}-2020-1",
    sourceUrl: "https://example.org/${options.code}/sample-act",
    effectiveDate: "2020-01-01",
    textSnippet: "Replace this with real text from your official source.",
    metadata: {
      source: "${options.source}",
      template: true,
    },
  },
];
`;
}

function buildTestTemplate(options: CliOptions): string {
  const citationPrefix = options.code.toUpperCase();

  return `import assert from "node:assert/strict";
import test from "node:test";
import { BUILTIN_ADAPTERS } from "../src/adapters/index.js";
import { LawMcpShell } from "../src/shell/shell.js";

const shell = LawMcpShell.fromAdapters(BUILTIN_ADAPTERS);

test("${options.code} adapter is discoverable", async () => {
  const result = await shell.handleToolCall({
    name: "law.describe_country",
    arguments: { country: "${options.code}" },
  });

  assert.equal(result.ok, true);
  assert.equal(
    (result.data as { country: { code: string } }).country.code,
    "${options.code}",
  );
});

test("${options.code} citation validation works for template format", async () => {
  const result = await shell.handleToolCall({
    name: "law.validate_citation",
    arguments: { country: "${options.code}", citation: "${citationPrefix}-2020-1" },
  });

  assert.equal(result.ok, true);
  assert.equal((result.data as { valid: boolean }).valid, true);
});
`;
}

function updateAdapterRegistry(content: string, code: string): string {
  const variablePrefix = countryVariablePrefix(code);
  const adapterName = `${variablePrefix}Adapter`;
  const importLine = `import { ${adapterName} } from "./${code}.js";`;
  const adapterLine = `  ${adapterName},`;

  const updatedImports = upsertBetweenMarkers(
    content,
    IMPORT_START_MARKER,
    IMPORT_END_MARKER,
    importLine,
  );

  return upsertBetweenMarkers(
    updatedImports,
    ARRAY_START_MARKER,
    ARRAY_END_MARKER,
    adapterLine,
  );
}

function upsertBetweenMarkers(
  content: string,
  startMarker: string,
  endMarker: string,
  newLine: string,
): string {
  const lines = content.split("\n");
  const startIndex = lines.findIndex((line) => line.includes(startMarker));
  const endIndex = lines.findIndex((line) => line.includes(endMarker));

  if (startIndex < 0 || endIndex < 0 || startIndex >= endIndex) {
    throw new Error(`Could not find marker block: ${startMarker} ... ${endMarker}`);
  }

  const existing = lines
    .slice(startIndex + 1, endIndex)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  const deduped = new Set([...existing, newLine]);
  const sorted = [...deduped].sort((a, b) => a.localeCompare(b));
  const replacement = [
    ...lines.slice(0, startIndex + 1),
    ...sorted,
    ...lines.slice(endIndex),
  ];

  return replacement.join("\n");
}

function countryVariablePrefix(code: string): string {
  return `${code.toLowerCase()}${code.toLowerCase().length === 2 ? "" : "Country"}`;
}

function escapeString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function resolveRoot(relativePath: string): string {
  return path.resolve(process.cwd(), relativePath);
}

function printDryRun(paths: string[], options: CliOptions): void {
  process.stdout.write(
    [
      "Dry run only. No files were written.",
      `Country: ${options.name} (${options.code})`,
      ...paths.map((filePath) => `- ${filePath}`),
    ].join("\n") + "\n",
  );
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

import { BUILTIN_ADAPTERS } from "./adapters/index.js";
import { getCapabilities } from "./db/german-law-db.js";
import { ShellError } from "./shell/errors.js";
import { LawMcpShell } from "./shell/shell.js";
import type { CountryAdapter, ToolCall } from "./shell/types.js";

export { LawMcpShell } from "./shell/shell.js";
export {
  createRegexCitationHandlers,
  createStaticIngestionRunner,
  getDocumentFromMemory,
  searchDocumentsInMemory,
} from "./shell/adapter-kit.js";
export type {
  CountryAdapter,
  CountryDescriptor,
  LawDocument,
  ToolCall,
  ToolResult,
} from "./shell/types.js";

const shell = LawMcpShell.fromAdapters(resolveAdapters());

async function main(): Promise<void> {
  const input = await readStdin();

  if (!input.trim()) {
    printHelp();
    return;
  }

  let call: ToolCall;
  try {
    call = JSON.parse(input) as ToolCall;
  } catch (error) {
    throw new ShellError(
      "invalid_json",
      `Expected JSON ToolCall payload on stdin: ${(error as Error).message}`,
    );
  }

  const result = await shell.handleToolCall(call);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function resolveAdapters(): CountryAdapter[] {
  const adapterFilter = process.env.LAW_COUNTRIES?.trim();

  let adapters: CountryAdapter[];

  if (!adapterFilter) {
    adapters = BUILTIN_ADAPTERS;
  } else {
    const selected = new Set(
      adapterFilter
        .split(",")
        .map((country) => country.trim().toLowerCase())
        .filter(Boolean),
    );

    adapters = BUILTIN_ADAPTERS.filter((adapter) =>
      selected.has(adapter.country.code.toLowerCase()),
    );

    if (adapters.length === 0) {
      throw new ShellError(
        "no_countries_selected",
        `LAW_COUNTRIES did not match any registered adapters: ${adapterFilter}`,
      );
    }
  }

  return adapters.map(enrichWithDbCapabilities);
}

/**
 * Attach runtime DB capability detection to adapters that use a local
 * SQLite database. This enables the shell to gate tools (e.g. case law,
 * preparatory works) when the underlying tables are absent on the free tier.
 */
function enrichWithDbCapabilities(adapter: CountryAdapter): CountryAdapter {
  if (adapter.country.code === "de") {
    return {
      ...adapter,
      getDbCapabilities: () => getCapabilities(),
    };
  }
  return adapter;
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    process.stdin.on("end", () =>
      resolve(Buffer.concat(chunks).toString("utf8")),
    );
    process.stdin.on("error", reject);
  });
}

function printHelp(): void {
  const payload = {
    message:
      "Provide a JSON ToolCall on stdin. Example: " +
      '{"name":"law_list_countries","arguments":{}}',
    tools: shell.getToolDefinitions(),
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

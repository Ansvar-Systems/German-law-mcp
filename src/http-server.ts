#!/usr/bin/env node

/**
 * HTTP Server Entry Point for Premium Docker Deployment
 *
 * Provides Streamable HTTP transport for remote MCP clients.
 * Use src/index.ts for local stdio-based usage.
 */

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { LawMcpShell } from "./shell/shell.js";
import { germanyAdapter } from "./adapters/de.js";
import { getCapabilities, getDb, getMetadata } from "./db/german-law-db.js";
import { getPremiumTools } from "./premium-tools.js";
import { responseMeta } from "./utils/metadata.js";
import type { ComplianceMeta } from "./utils/metadata.js";
import type { ToolName } from "./shell/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = parseInt(process.env.PORT || "3000", 10);

let pkgVersion = "0.0.0";
try {
  const pkg = JSON.parse(
    readFileSync(join(__dirname, "..", "package.json"), "utf8"),
  ) as { version: string };
  pkgVersion = pkg.version;
} catch {
  // fallback
}

const SERVER_NAME = "german-law-mcp";

function buildComplianceMeta(): ComplianceMeta {
  try {
    const dbMeta = getMetadata();
    return responseMeta(dbMeta.built_at ?? new Date().toISOString().substring(0, 10));
  } catch {
    return responseMeta(new Date().toISOString().substring(0, 10));
  }
}

function createMcpServer(): { server: Server; shell: LawMcpShell } {
  const meta = buildComplianceMeta();

  const enrichedAdapter = {
    ...germanyAdapter,
    getDbCapabilities: () => getCapabilities(),
  };
  const shell = LawMcpShell.fromAdapters([enrichedAdapter]);

  const server = new Server(
    { name: SERVER_NAME, version: pkgVersion },
    { capabilities: { tools: {} } },
  );

  // Detect premium tools using the SDK's public API instead of wrapping
  // internal _requestHandlers (which broke in SDK v1.27.1).
  let premium: ReturnType<typeof getPremiumTools> = null;
  try {
    const db = getDb();
    if (db) {
      premium = getPremiumTools(db);
    }
  } catch (err) {
    console.warn(`[${SERVER_NAME}] Premium tools not available:`, err);
  }

  const premiumToolNames = new Set(premium?.handlers.keys() ?? []);

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const definitions = shell.getToolDefinitions();
    const baseTools = definitions.map((def) => ({
      name: def.name,
      description: def.description,
      inputSchema: def.inputSchema,
    }));

    if (!premium) return { tools: baseTools };

    // Deduplicate: premium tools override base tools with the same name
    const filtered = baseTools.filter((t) => !premiumToolNames.has(t.name));
    return { tools: [...filtered, ...premium.tools] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    // Premium tool — handle directly
    const premiumHandler = premium?.handlers.get(toolName);
    if (premiumHandler) {
      try {
        const rawData = premiumHandler(args);
        // Attach _meta compliance block to premium tool responses
        const data =
          rawData !== null && rawData !== undefined && typeof rawData === "object"
            ? { ...(rawData as Record<string, unknown>), _meta: meta }
            : rawData;
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(data, null, 2) },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                _error_type: "internal_error",
                code: "internal_error",
                message: `Error executing ${toolName}: ${message}`,
                _meta: meta,
              }),
            },
          ],
          isError: true,
        };
      }
    }

    // Base tool — delegate to shell
    const result = await shell.handleToolCall({
      name: toolName as ToolName,
      arguments: args,
    });

    if (result.ok) {
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result.data, null, 2) },
        ],
      };
    }

    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result.error, null, 2) },
      ],
      isError: true,
    };
  });

  return { server, shell };
}

async function main() {
  const sessions = new Map<
    string,
    { transport: StreamableHTTPServerTransport; server: Server }
  >();

  const httpServer = createServer((req, res) => {
    handleRequest(req, res, sessions).catch((err) => {
      console.error(`[${SERVER_NAME}] Unhandled error:`, err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    });
  });

  async function handleRequest(
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
    sessions: Map<
      string,
      { transport: StreamableHTTPServerTransport; server: Server }
    >,
  ) {
    const url = new URL(req.url || "/", `http://localhost:${PORT}`);

    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", server: SERVER_NAME }));
      return;
    }

    if (url.pathname === "/mcp") {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!;
        await session.transport.handleRequest(req, res);
        return;
      }

      // New session — create a fresh MCP server instance per session
      const { server: mcpServer } = createMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK type mismatch with exactOptionalPropertyTypes
      await mcpServer.connect(transport as any);
      transport.onclose = () => {
        if (transport.sessionId) {
          sessions.delete(transport.sessionId);
        }
        mcpServer.close().catch(() => {});
      };

      await transport.handleRequest(req, res);

      // Store AFTER handleRequest — sessionId is set during initialize
      if (transport.sessionId) {
        sessions.set(transport.sessionId, { transport, server: mcpServer });
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }

  httpServer.listen(PORT, () => {
    console.error(
      `${SERVER_NAME} (HTTP) listening on port ${PORT}`,
    );
    console.error(`MCP endpoint: http://localhost:${PORT}/mcp`);
    console.error(`Health check: http://localhost:${PORT}/health`);
  });

  process.on("SIGTERM", () => {
    console.error("Received SIGTERM, shutting down...");
    httpServer.close(() => process.exit(0));
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

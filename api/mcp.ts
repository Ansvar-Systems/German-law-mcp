import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { existsSync, createWriteStream, rmSync, renameSync } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { createGunzip } from 'zlib';
import https from 'https';
import type { IncomingMessage } from 'http';

// Import the shell and adapters from the built output.
import { LawMcpShell } from '../src/shell/shell.js';
import { germanyAdapter } from '../src/adapters/de.js';
import { getCapabilities } from '../src/db/german-law-db.js';
import type { ToolName } from '../src/shell/types.js';

// ---------------------------------------------------------------------------
// Server identity
// ---------------------------------------------------------------------------

const SERVER_NAME = 'german-law-mcp';
const SERVER_VERSION = '0.3.0';

// ---------------------------------------------------------------------------
// Database — downloaded from GitHub Releases on cold start
// ---------------------------------------------------------------------------

const TMP_DB = '/tmp/database.db';
const TMP_DB_TMP = '/tmp/database.db.tmp';
const TMP_DB_LOCK = '/tmp/database.db.lock';

const GITHUB_REPO = 'Ansvar-Systems/German-law-mcp';
const RELEASE_TAG = `v${SERVER_VERSION}`;
const ASSET_NAME = 'database-free.db.gz';

let dbReady = false;

function httpsGet(url: string): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': SERVER_NAME } }, resolve)
      .on('error', reject);
  });
}

async function downloadDatabase(): Promise<void> {
  const url = `https://github.com/${GITHUB_REPO}/releases/download/${RELEASE_TAG}/${ASSET_NAME}`;

  let response = await httpsGet(url);

  // Follow up to 5 redirects (GitHub redirects to S3)
  let redirects = 0;
  while (
    response.statusCode &&
    response.statusCode >= 300 &&
    response.statusCode < 400 &&
    response.headers.location &&
    redirects < 5
  ) {
    response = await httpsGet(response.headers.location);
    redirects++;
  }

  if (response.statusCode !== 200) {
    throw new Error(
      `Failed to download database: HTTP ${response.statusCode} from ${url}`,
    );
  }

  const gunzip = createGunzip();
  const out = createWriteStream(TMP_DB_TMP);
  await pipeline(response, gunzip, out);
  renameSync(TMP_DB_TMP, TMP_DB);
}

async function ensureDatabase(): Promise<void> {
  if (dbReady) return;

  // Clean stale artifacts from previous invocations
  if (existsSync(TMP_DB_LOCK)) {
    rmSync(TMP_DB_LOCK, { recursive: true, force: true });
  }

  if (!existsSync(TMP_DB)) {
    const envDb = process.env.GERMAN_LAW_DB_PATH;
    if (envDb && existsSync(envDb)) {
      // Local dev: use env-specified DB directly, no download
      process.env.GERMAN_LAW_DB_PATH = envDb;
      dbReady = true;
      return;
    }

    console.log('[german-law-mcp] Downloading free-tier database...');
    await downloadDatabase();
    console.log('[german-law-mcp] Database ready');
  }

  process.env.GERMAN_LAW_DB_PATH = TMP_DB;
  dbReady = true;
}

// ---------------------------------------------------------------------------
// Vercel handler
// ---------------------------------------------------------------------------

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, mcp-session-id',
  );
  res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method === 'GET') {
    res.status(200).json({
      name: SERVER_NAME,
      version: SERVER_VERSION,
      protocol: 'mcp-streamable-http',
    });
    return;
  }

  try {
    await ensureDatabase();

    // Build the shell from the Germany adapter, enriched with runtime
    // capability detection so that free-tier gating works correctly.
    const enrichedAdapter = {
      ...germanyAdapter,
      getDbCapabilities: () => getCapabilities(),
    };
    const shell = LawMcpShell.fromAdapters([enrichedAdapter]);

    // Create MCP server and bridge the shell's tools into it
    const server = new Server(
      { name: SERVER_NAME, version: SERVER_VERSION },
      { capabilities: { tools: {} } },
    );

    // List tools: expose all tool definitions from the shell
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      const definitions = shell.getToolDefinitions();
      return {
        tools: definitions.map((def) => ({
          name: def.name,
          description: def.description,
          inputSchema: def.inputSchema,
        })),
      };
    });

    // Call tool: route through the shell's handleToolCall
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const result = await shell.handleToolCall({
        name: request.params.name as ToolName,
        arguments: request.params.arguments as Record<string, unknown>,
      });

      if (result.ok) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result.data, null, 2),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result.error, null, 2),
          },
        ],
        isError: true,
      };
    });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('MCP handler error:', message);
    if (!res.headersSent) {
      res.status(500).json({ error: message });
    }
  }
}

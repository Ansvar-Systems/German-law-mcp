import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import * as path from 'path';
import * as zlib from 'zlib';
import { pipeline } from 'stream/promises';

// Import the shell and adapters from the built output.
// We construct the shell here instead of importing from src/index.ts to avoid
// triggering the stdio server's main() entry point.
import { LawMcpShell } from '../src/shell/shell.js';
import { germanyAdapter } from '../src/adapters/de.js';
import type { ToolName } from '../src/shell/types.js';

// ---------------------------------------------------------------------------
// Server identity
// ---------------------------------------------------------------------------

const SERVER_NAME = 'german-law-mcp';
const SERVER_VERSION = '0.2.0';

// ---------------------------------------------------------------------------
// Database — downloaded from GitHub Releases on cold start, cached in /tmp
// ---------------------------------------------------------------------------

const TMP_DB = '/tmp/database.db';
const TMP_DB_LOCK = '/tmp/database.db.lock';

const GITHUB_OWNER = 'Ansvar-Systems';
const GITHUB_REPO = 'German-law-mcp';
const GITHUB_TAG = `v${SERVER_VERSION}`;
const ASSET_NAME = 'database.db.gz';

let dbReady = false;

function httpsGetRaw(
  url: string,
  headers: Record<string, string>,
): Promise<http.IncomingMessage> {
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    https
      .get(
        {
          hostname: parsed.hostname,
          path: parsed.pathname + parsed.search,
          headers: { 'User-Agent': 'german-law-mcp', ...headers },
        },
        resolve,
      )
      .on('error', reject);
  });
}

async function followRedirects(
  url: string,
  headers: Record<string, string>,
  maxRedirects = 10,
): Promise<http.IncomingMessage> {
  let currentUrl = url;
  for (let i = 0; i < maxRedirects; i++) {
    const res = await httpsGetRaw(currentUrl, headers);
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      currentUrl = res.headers.location;
      // Don't send auth headers to redirected hosts (e.g. Azure blob storage)
      headers = {};
      res.resume();
      continue;
    }
    if (status !== 200) {
      res.resume();
      throw new Error(`HTTP ${status} downloading ${currentUrl}`);
    }
    return res;
  }
  throw new Error('Too many redirects');
}

async function resolveDownloadUrl(): Promise<{
  url: string;
  headers: Record<string, string>;
}> {
  // Allow explicit override (e.g. public URL, S3 presigned URL)
  if (process.env.GERMAN_LAW_DB_URL) {
    return { url: process.env.GERMAN_LAW_DB_URL, headers: {} };
  }

  // For public repos, use the direct download URL (no auth needed)
  const directUrl = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/${GITHUB_TAG}/${ASSET_NAME}`;
  const token = process.env.GITHUB_TOKEN;

  if (token) {
    // If a token is available, use the API for private repo support
    const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tags/${GITHUB_TAG}`;
    const authHeaders = {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
    };

    const releaseRes = await followRedirects(apiUrl, authHeaders);
    const chunks: Buffer[] = [];
    for await (const chunk of releaseRes) {
      chunks.push(chunk as Buffer);
    }
    const release = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    const asset = release.assets?.find(
      (a: { name: string }) => a.name === ASSET_NAME,
    );
    if (!asset) {
      throw new Error(
        `Asset "${ASSET_NAME}" not found in release ${GITHUB_TAG}`,
      );
    }

    return {
      url: asset.url as string,
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/octet-stream',
      },
    };
  }

  // No token — use direct public download URL
  return { url: directUrl, headers: {} };
}

async function downloadDatabase(): Promise<void> {
  const tmpPath = TMP_DB + '.tmp';
  const { url, headers } = await resolveDownloadUrl();
  console.log(`[german-law-mcp] Downloading database...`);

  const res = await followRedirects(url, headers);
  const gunzip = zlib.createGunzip();
  const fileStream = fs.createWriteStream(tmpPath);
  await pipeline(res, gunzip, fileStream);

  fs.renameSync(tmpPath, TMP_DB);
  const size = fs.statSync(TMP_DB).size;
  console.log(
    `[german-law-mcp] Database ready (${(size / 1024 / 1024).toFixed(0)} MB)`,
  );
}

async function ensureDatabase(): Promise<void> {
  if (dbReady) return;

  // Clean stale lock from previous invocations
  if (fs.existsSync(TMP_DB_LOCK)) {
    fs.rmSync(TMP_DB_LOCK, { recursive: true, force: true });
  }

  // Check for pre-existing DB (env override or bundled)
  const envDb = process.env.GERMAN_LAW_DB_PATH;
  if (envDb && fs.existsSync(envDb)) {
    if (!fs.existsSync(TMP_DB)) {
      fs.copyFileSync(envDb, TMP_DB);
    }
  } else if (
    !fs.existsSync(TMP_DB) &&
    fs.existsSync(path.join(process.cwd(), 'data', 'database.db'))
  ) {
    fs.copyFileSync(path.join(process.cwd(), 'data', 'database.db'), TMP_DB);
  }

  // Download from GitHub Releases if still missing
  if (!fs.existsSync(TMP_DB)) {
    await downloadDatabase();
  }

  // Point the German adapter's DB module at /tmp so it finds the database
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

    // Build the shell from the Germany adapter
    const shell = LawMcpShell.fromAdapters([germanyAdapter]);

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

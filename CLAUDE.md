# CLAUDE.md

## Git Workflow

- **Never commit directly to `main`.** Always create a feature branch and open a Pull Request.
- Branch protection requires: verified signatures, PR review, and status checks to pass.
- Use conventional commit prefixes: `feat:`, `fix:`, `chore:`, `docs:`, etc.

## Overview

MCP server for German federal legal research. Provides access to statutes, court decisions, and legislative preparatory works from official German government sources.

**Stack:** TypeScript (ESM), Node.js 20+, SQLite (via `@ansvar/mcp-sqlite` WASM), MCP SDK
**Transport:** stdio (npm/CLI) + Streamable HTTP (Vercel serverless)
**Deployment:** Vercel Strategy B (runtime database download from GitHub Releases)

## Project Structure

```
src/
  index.ts          — CLI entrypoint (stdin JSON → shell → stdout)
  shell/            — MCP tool routing, definitions, types
  adapters/         — Country adapters (de.ts is the primary one)
  citation/         — German citation parsing/normalization
  db/               — SQLite database access layer
  utils/            — FTS query builder
api/
  mcp.ts            — Vercel Streamable HTTP handler
  health.ts         — /health and /version endpoints
scripts/            — Python ingestion scripts + TS build scripts
fixtures/           — Golden tests and drift detection hashes
test/               — Unit tests (node:test runner)
__tests__/contract/ — Contract tests against golden-tests.json
```

## Key Patterns

- **Adapter pattern:** `CountryAdapter` interface with capability flags. Shell validates capabilities before dispatching.
- **Three-tier search:** (1) exact citation match → (2) FTS5 BM25 → (3) LIKE fallback, with deduplication.
- **Tier gating:** Free tier detects available DB tables at runtime (`detectCapabilities()`). Gated tools return upgrade messages, not errors.
- **All DB queries use parameterized statements** — never string interpolation.

## Commands

```bash
npm run build          # TypeScript compilation
npm test               # Build + run unit tests
npm run test:contract  # Build + run golden contract tests
npm run typecheck      # Type-check without emitting
npm run validate       # typecheck + test + test:contract
npm run drift:detect   # Check upstream data drift
```

## Version Management

Version is defined in `package.json` and read dynamically by `api/health.ts`, `api/mcp.ts`, and `src/shell/shell.ts`. Keep `server.json` version in sync when releasing.

## Testing

- Test runner: Node.js built-in `node:test`
- Unit tests: `test/*.test.ts`
- Contract tests: `__tests__/contract/golden.test.ts` reads `fixtures/golden-tests.json`
- Drift detection: `fixtures/golden-hashes.json` with SHA-256 anchors

## Data Sources

All from official German government portals (public domain):
1. **gesetze-im-internet.de** — Federal statutes (XML)
2. **rechtsprechung-im-internet.de** — Federal court decisions (XML)
3. **dip.bundestag.de** — Bundestag preparatory works (REST API)

## Conventions

- ESM modules (`"type": "module"` in package.json)
- Imports use `.js` extension (TypeScript ESM requirement)
- SQLite uses `@ansvar/mcp-sqlite` (WASM-based, works in Vercel serverless)
- Journal mode must be `DELETE` (not WAL) for serverless compatibility
- German legal citations use `§` for paragraphs, `Art.` for articles

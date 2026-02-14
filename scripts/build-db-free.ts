#!/usr/bin/env tsx
/**
 * Free-tier database builder for German Law MCP server.
 *
 * SUBTRACTIVE — copies the full database, then removes case law,
 * preparatory works, and paid-tier stub tables using the native
 * sqlite3 CLI (WASM wrapper can struggle with large databases).
 *
 * Kept tables:
 *   - law_documents + law_documents_fts  (core statutes)
 *   - db_metadata                        (tier info)
 *   - ingestion_runs                     (if present)
 *
 * Dropped tables:
 *   - case_law_documents + case_law_documents_fts
 *   - preparatory_works + preparatory_works_fts
 *   - case_law_documents_full, preparatory_works_full
 *   - agency_guidance, agency_guidance_fts
 *
 * Usage: npm run build:db:free
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const FULL_DB = path.resolve(process.cwd(), 'data', 'database.db');
const FREE_DB = path.resolve(process.cwd(), 'data', 'database-free.db');

function sql(dbPath: string, query: string): string {
  return execFileSync('sqlite3', [dbPath, query], {
    encoding: 'utf-8',
    timeout: 600_000,  // 10 minutes for VACUUM on large DBs
  }).trim();
}

// Tables to drop for the free tier (order matters: FTS/dependents first)
const TABLES_TO_DROP = [
  'case_law_documents_fts',
  'case_law_documents',
  'preparatory_works_fts',
  'preparatory_works',
  'case_law_documents_full',
  'preparatory_works_full',
  'agency_guidance_fts',
  'agency_guidance',
];

function buildFreeTier(): void {
  console.log('Building free-tier database for German Law MCP...\n');

  if (!fs.existsSync(FULL_DB)) {
    console.error(
      `ERROR: No full database found at ${FULL_DB}\n` +
      `Run ingestion first to create the full database.`
    );
    process.exit(1);
  }

  // Verify sqlite3 is available
  try {
    execFileSync('sqlite3', ['--version'], { encoding: 'utf-8' });
  } catch {
    console.error('ERROR: sqlite3 CLI not found. Install it first.');
    process.exit(1);
  }

  const fullSize = fs.statSync(FULL_DB).size;
  console.log(`  Source: ${FULL_DB} (${(fullSize / 1024 / 1024).toFixed(1)} MB)`);

  // Copy full DB to free-tier path
  if (fs.existsSync(FREE_DB)) fs.unlinkSync(FREE_DB);
  fs.copyFileSync(FULL_DB, FREE_DB);
  // Also remove any WAL/journal files from the copy
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const f = FREE_DB + suffix;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  console.log(`  Copied to: ${FREE_DB}`);

  // Switch to DELETE journal mode (WAL can cause locking issues)
  sql(FREE_DB, 'PRAGMA journal_mode = DELETE;');
  sql(FREE_DB, 'PRAGMA foreign_keys = OFF;');

  // Get existing tables
  const tableList = sql(FREE_DB, "SELECT name FROM sqlite_master WHERE type IN ('table', 'view');");
  const existingTables = new Set(tableList.split('\n').filter(Boolean));

  // Drop tables
  console.log('\n  Dropping tables:');
  for (const table of TABLES_TO_DROP) {
    if (existingTables.has(table)) {
      sql(FREE_DB, `DROP TABLE IF EXISTS "${table}";`);
      console.log(`    Dropped: ${table}`);
    } else {
      console.log(`    Skipped (not present): ${table}`);
    }
  }

  // Drop triggers related to dropped tables
  const triggerList = sql(FREE_DB, "SELECT name || '|' || tbl_name FROM sqlite_master WHERE type = 'trigger';");
  const droppedTableSet = new Set(TABLES_TO_DROP);
  for (const line of triggerList.split('\n').filter(Boolean)) {
    const parts = line.split('|');
    const triggerName = parts[0];
    const tblName = parts[1];
    if (tblName && droppedTableSet.has(tblName)) {
      sql(FREE_DB, `DROP TRIGGER IF EXISTS "${triggerName}";`);
      console.log(`    Dropped trigger: ${triggerName}`);
    }
  }

  // Ensure db_metadata table exists and update tier
  sql(FREE_DB, "CREATE TABLE IF NOT EXISTS db_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
  sql(FREE_DB, `INSERT INTO db_metadata (key, value) VALUES ('tier', 'free') ON CONFLICT(key) DO UPDATE SET value = excluded.value;`);
  sql(FREE_DB, `INSERT INTO db_metadata (key, value) VALUES ('schema_version', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value;`);
  sql(FREE_DB, `INSERT INTO db_metadata (key, value) VALUES ('built_at', '${new Date().toISOString()}') ON CONFLICT(key) DO UPDATE SET value = excluded.value;`);
  sql(FREE_DB, `INSERT INTO db_metadata (key, value) VALUES ('builder', 'build-db-free.ts') ON CONFLICT(key) DO UPDATE SET value = excluded.value;`);

  // Report remaining data
  const lawCount = sql(FREE_DB, 'SELECT COUNT(*) FROM law_documents;');
  console.log(`\n  Remaining data:`);
  console.log(`    Law documents: ${parseInt(lawCount).toLocaleString()}`);

  // VACUUM to reclaim space
  console.log('\n  Running VACUUM (this may take a while)...');
  sql(FREE_DB, 'VACUUM;');
  sql(FREE_DB, 'ANALYZE;');

  const freeSize = fs.statSync(FREE_DB).size;
  const reduction = ((1 - freeSize / fullSize) * 100).toFixed(1);

  console.log(
    `\nFree-tier build complete.` +
    `\n  Size: ${(fullSize / 1024 / 1024).toFixed(1)} MB -> ${(freeSize / 1024 / 1024).toFixed(1)} MB (${reduction}% reduction)` +
    `\n  Tier: free` +
    `\n  Output: ${FREE_DB}`
  );

  // Warn if too large for Vercel
  const VERCEL_LIMIT = 250 * 1024 * 1024;
  if (freeSize > VERCEL_LIMIT) {
    console.warn(
      `\n  WARNING: Free-tier database is ${(freeSize / 1024 / 1024).toFixed(0)} MB.` +
      `\n  This may be too large for Vercel Hobby plan (512 MB /tmp limit).` +
      `\n  Consider further data trimming if deployment fails.`
    );
  }
}

buildFreeTier();

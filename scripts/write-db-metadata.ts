#!/usr/bin/env tsx
/**
 * Write db_metadata table to an existing German Law database.
 *
 * German Law MCP uses Python for database ingestion. Rather than modifying
 * the Python scripts, this standalone TypeScript script writes the standard
 * db_metadata table after ingestion completes.
 *
 * Pipeline:
 *   npm run ingest          # Python: build base DB
 *   npm run write:metadata  # TypeScript: add metadata table
 *
 * Usage: npm run write:metadata
 */

import Database from '@ansvar/mcp-sqlite';
import * as fs from 'fs';
import * as path from 'path';

const DB_PATH = path.resolve(process.cwd(), 'data', 'database.db');

function writeMetadata(): void {
  console.log('Writing db_metadata to German Law database...\n');

  if (!fs.existsSync(DB_PATH)) {
    console.error(
      `ERROR: No database found at ${DB_PATH}\n` +
      `Run 'npm run ingest' first to create the database.`
    );
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  // Create metadata table
  db.prepare(`
    CREATE TABLE IF NOT EXISTS db_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `).run();

  // Determine tier by checking for paid tables
  const paidTables = ['case_law_documents_full', 'preparatory_works_full', 'agency_guidance'];
  const hasPaidTable = paidTables.some((table) => {
    const row = db.prepare(
      "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name = ?"
    ).get(table) as { ok?: number } | undefined;
    return Boolean(row?.ok);
  });

  const tier = hasPaidTable ? 'professional' : 'free';

  // Write metadata
  const upsertMeta = db.prepare(`
    INSERT INTO db_metadata (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  const writeMeta = db.transaction(() => {
    upsertMeta.run('tier', tier);
    upsertMeta.run('schema_version', '1');
    upsertMeta.run('built_at', new Date().toISOString());
    upsertMeta.run('builder', 'write-db-metadata.ts');
  });
  writeMeta();

  db.close();

  console.log(`  Database: ${DB_PATH}`);
  console.log(`  Tier: ${tier}`);
  console.log(`  Metadata written successfully.`);
}

writeMetadata();

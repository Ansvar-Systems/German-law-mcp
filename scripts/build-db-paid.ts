#!/usr/bin/env tsx
/**
 * Paid-tier database builder for German Law MCP server.
 *
 * ADDITIVE — does NOT rebuild from scratch. Instead:
 *   1. Verifies a base (free-tier) database exists
 *   2. Adds paid-only tables and schema extensions
 *   3. Updates db_metadata to reflect the professional tier
 *
 * The full build pipeline for paid tier is:
 *   npm run ingest                           # Step 1: Ingest statutes from gesetze-im-internet.de
 *   npm run ingest:cases                     # Step 2: Ingest case law (slow, network)
 *   npm run ingest:prep                      # Step 3: Ingest preparatory works
 *   npm run write:metadata                   # Step 4: Write free-tier metadata
 *   npm run build:db:paid                    # Step 5: Add paid tables + upgrade metadata
 *
 * Usage: npm run build:db:paid
 */

import Database from '@ansvar/mcp-sqlite';
import * as fs from 'fs';
import * as path from 'path';

const DB_PATH = path.resolve(process.cwd(), 'data', 'database.db');

// ─────────────────────────────────────────────────────────────────────────────
// Paid-tier schema extensions
// ─────────────────────────────────────────────────────────────────────────────

const PAID_SCHEMA = `
-- Extended case law with full-text opinions (paid tier)
CREATE TABLE IF NOT EXISTS case_law_documents_full (
  id INTEGER PRIMARY KEY,
  case_law_id TEXT NOT NULL,
  full_text TEXT NOT NULL,
  headnotes TEXT,
  dissenting_opinions TEXT,
  UNIQUE(case_law_id)
);

CREATE INDEX IF NOT EXISTS idx_case_law_documents_full_case
  ON case_law_documents_full(case_law_id);

-- Extended preparatory works with full-text (paid tier)
CREATE TABLE IF NOT EXISTS preparatory_works_full (
  id INTEGER PRIMARY KEY,
  prep_work_id TEXT NOT NULL,
  full_text TEXT NOT NULL,
  section_summaries TEXT,
  UNIQUE(prep_work_id)
);

CREATE INDEX IF NOT EXISTS idx_prep_works_full_prep
  ON preparatory_works_full(prep_work_id);

-- Agency guidance documents (paid tier)
CREATE TABLE IF NOT EXISTS agency_guidance (
  id INTEGER PRIMARY KEY,
  agency TEXT NOT NULL,
  document_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT,
  full_text TEXT,
  issued_date TEXT,
  url TEXT,
  related_statute_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_agency_guidance_agency
  ON agency_guidance(agency);
CREATE INDEX IF NOT EXISTS idx_agency_guidance_statute
  ON agency_guidance(related_statute_id);

-- FTS5 for agency guidance search
CREATE VIRTUAL TABLE IF NOT EXISTS agency_guidance_fts USING fts5(
  title, summary, full_text,
  content='agency_guidance',
  content_rowid='id',
  tokenize='unicode61'
);
`;

// ─────────────────────────────────────────────────────────────────────────────
// Build
// ─────────────────────────────────────────────────────────────────────────────

function buildPaidTier(): void {
  console.log('Building paid-tier extensions for German Law MCP...\n');

  // Verify base database exists
  if (!fs.existsSync(DB_PATH)) {
    console.error(
      `ERROR: No base database found at ${DB_PATH}\n` +
      `Run 'npm run ingest' first to create the base database.`
    );
    process.exit(1);
  }

  const sizeBefore = fs.statSync(DB_PATH).size;
  console.log(`  Base database: ${DB_PATH} (${(sizeBefore / 1024 / 1024).toFixed(1)} MB)`);

  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  // Verify base schema exists
  const hasLawDocs = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='law_documents'"
  ).get();

  if (!hasLawDocs) {
    console.error('ERROR: Base database is missing law_documents table. Rebuild with: npm run ingest');
    db.close();
    process.exit(1);
  }

  // Create db_metadata table if it doesn't exist
  db.prepare(`CREATE TABLE IF NOT EXISTS db_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)`).run();

  // Add paid-tier tables
  console.log('  Adding paid-tier schema extensions...');
  db.pragma('foreign_keys = OFF');
  const statements = PAID_SCHEMA.split(';').map(s => s.trim()).filter(Boolean);
  for (const stmt of statements) {
    db.prepare(stmt).run();
  }
  db.pragma('foreign_keys = ON');

  // Report what's available
  const lawCount = (db.prepare('SELECT COUNT(*) as c FROM law_documents').get() as { c: number }).c;
  const caseCount = (db.prepare('SELECT COUNT(*) as c FROM case_law_documents').get() as { c: number }).c;

  console.log(`\n  Base data available:`);
  console.log(`    Law documents:     ${lawCount.toLocaleString()}`);
  console.log(`    Case law entries:  ${caseCount.toLocaleString()}`);

  // Check if preparatory_works exists
  const hasPrep = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='preparatory_works'"
  ).get();
  if (hasPrep) {
    const prepCount = (db.prepare('SELECT COUNT(*) as c FROM preparatory_works').get() as { c: number }).c;
    console.log(`    Preparatory works: ${prepCount.toLocaleString()}`);
  }

  // Check paid tables for data
  const paidTables = ['case_law_documents_full', 'preparatory_works_full', 'agency_guidance'];
  console.log(`\n  Paid-tier tables (stub — no data sources connected yet):`);
  for (const table of paidTables) {
    const row = db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number };
    console.log(`    ${table}: ${row.c} rows`);
  }

  // Update metadata to professional tier
  const upsertMeta = db.prepare(`
    INSERT INTO db_metadata (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  const updateMeta = db.transaction(() => {
    upsertMeta.run('tier', 'professional');
    upsertMeta.run('schema_version', '2');
    upsertMeta.run('built_at', new Date().toISOString());
    upsertMeta.run('builder', 'build-db-paid.ts');
    upsertMeta.run('paid_tables', paidTables.join(','));
  });
  updateMeta();

  db.pragma('wal_checkpoint(TRUNCATE)');
  db.prepare('ANALYZE').run();
  db.close();

  const sizeAfter = fs.statSync(DB_PATH).size;
  console.log(
    `\nPaid-tier build complete.` +
    `\n  Size: ${(sizeBefore / 1024 / 1024).toFixed(1)} MB -> ${(sizeAfter / 1024 / 1024).toFixed(1)} MB` +
    `\n  Tier: professional` +
    `\n  Output: ${DB_PATH}`
  );

  console.log(`\n  NOTE: Paid-tier tables are empty stubs. To populate them:`);
  console.log(`    1. case_law_documents_full -- needs full-text opinions from rechtsprechung-im-internet.de (future)`);
  console.log(`    2. preparatory_works_full -- needs Bundestag DIP full-text API (future)`);
  console.log(`    3. agency_guidance -- needs BaFin/BSI document scrapers (future)`);
}

buildPaidTier();

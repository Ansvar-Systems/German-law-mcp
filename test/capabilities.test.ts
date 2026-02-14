import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from '@ansvar/mcp-sqlite';
import {
  detectCapabilities,
  readDbMetadata,
  isProfessionalCapability,
  upgradeMessage,
} from '../src/capabilities.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Create a minimal in-memory DB with only free-tier tables. */
function createFreeTierDb(): InstanceType<typeof Database> {
  const db = new Database(':memory:');
  db.prepare('CREATE TABLE law_documents (id INTEGER PRIMARY KEY, title TEXT)').run();
  db.prepare('CREATE TABLE case_law_documents (id INTEGER PRIMARY KEY, title TEXT)').run();
  db.prepare('CREATE TABLE eu_references (id INTEGER PRIMARY KEY, ref_type TEXT)').run();
  return db;
}

/** Create an in-memory DB with both free and paid tables. */
function createPaidTierDb(): InstanceType<typeof Database> {
  const db = createFreeTierDb();
  db.prepare('CREATE TABLE case_law_documents_full (id INTEGER PRIMARY KEY, full_text TEXT)').run();
  db.prepare('CREATE TABLE preparatory_works_full (id INTEGER PRIMARY KEY, full_text TEXT)').run();
  db.prepare('CREATE TABLE agency_guidance (id INTEGER PRIMARY KEY, guidance TEXT)').run();
  return db;
}

/** Add db_metadata table with given key-value pairs. */
function addMetadata(db: InstanceType<typeof Database>, entries: Record<string, string>): void {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS db_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `).run();
  const insert = db.prepare('INSERT INTO db_metadata (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(entries)) {
    insert.run(key, value);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('detectCapabilities', () => {
  let db: InstanceType<typeof Database>;

  afterEach(() => {
    if (db) db.close();
  });

  it('should detect free-tier capabilities (3 tables)', () => {
    db = createFreeTierDb();
    const caps = detectCapabilities(db);

    assert.equal(caps.has('core_legislation'), true);
    assert.equal(caps.has('basic_case_law'), true);
    assert.equal(caps.has('eu_references'), true);

    assert.equal(caps.has('expanded_case_law'), false);
    assert.equal(caps.has('full_preparatory_works'), false);
    assert.equal(caps.has('agency_guidance'), false);

    assert.equal(caps.size, 3);
  });

  it('should detect all capabilities on paid-tier DB (6 tables)', () => {
    db = createPaidTierDb();
    const caps = detectCapabilities(db);

    assert.equal(caps.has('core_legislation'), true);
    assert.equal(caps.has('basic_case_law'), true);
    assert.equal(caps.has('eu_references'), true);
    assert.equal(caps.has('expanded_case_law'), true);
    assert.equal(caps.has('full_preparatory_works'), true);
    assert.equal(caps.has('agency_guidance'), true);

    assert.equal(caps.size, 6);
  });

  it('should return empty set for empty database', () => {
    db = new Database(':memory:');
    const caps = detectCapabilities(db);
    assert.equal(caps.size, 0);
  });

  it('should detect partial capabilities (only some tables)', () => {
    db = new Database(':memory:');
    db.prepare('CREATE TABLE law_documents (id INTEGER PRIMARY KEY)').run();

    const caps = detectCapabilities(db);
    assert.equal(caps.size, 1);
    assert.equal(caps.has('core_legislation'), true);
  });
});

describe('readDbMetadata', () => {
  let db: InstanceType<typeof Database>;

  afterEach(() => {
    if (db) db.close();
  });

  it('should read metadata when table exists', () => {
    db = new Database(':memory:');
    addMetadata(db, {
      tier: 'free',
      schema_version: '2',
      built_at: '2026-02-14T10:30:00.000Z',
      builder: 'write-db-metadata.ts',
    });

    const meta = readDbMetadata(db);
    assert.equal(meta.tier, 'free');
    assert.equal(meta.schema_version, '2');
    assert.equal(meta.built_at, '2026-02-14T10:30:00.000Z');
    assert.equal(meta.builder, 'write-db-metadata.ts');
  });

  it('should read professional tier', () => {
    db = new Database(':memory:');
    addMetadata(db, {
      tier: 'professional',
      schema_version: '2',
      built_at: '2026-02-14T10:35:00.000Z',
      builder: 'build-db-paid.ts',
    });

    const meta = readDbMetadata(db);
    assert.equal(meta.tier, 'professional');
    assert.equal(meta.builder, 'build-db-paid.ts');
  });

  it('should return defaults when db_metadata table is missing', () => {
    db = new Database(':memory:');

    const meta = readDbMetadata(db);
    assert.equal(meta.tier, 'unknown');
    assert.equal(meta.schema_version, '1');
    assert.equal(meta.built_at, 'unknown');
    assert.equal(meta.builder, 'unknown');
  });

  it('should return defaults for unknown tier values', () => {
    db = new Database(':memory:');
    addMetadata(db, {
      tier: 'enterprise',
      schema_version: '3',
    });

    const meta = readDbMetadata(db);
    assert.equal(meta.tier, 'unknown');
    assert.equal(meta.schema_version, '3');
  });

  it('should handle partial metadata (some keys missing)', () => {
    db = new Database(':memory:');
    addMetadata(db, {
      tier: 'free',
    });

    const meta = readDbMetadata(db);
    assert.equal(meta.tier, 'free');
    assert.equal(meta.schema_version, '1');
    assert.equal(meta.built_at, 'unknown');
    assert.equal(meta.builder, 'unknown');
  });
});

describe('isProfessionalCapability', () => {
  it('should return true for paid capabilities', () => {
    assert.equal(isProfessionalCapability('expanded_case_law'), true);
    assert.equal(isProfessionalCapability('full_preparatory_works'), true);
    assert.equal(isProfessionalCapability('agency_guidance'), true);
  });

  it('should return false for free capabilities', () => {
    assert.equal(isProfessionalCapability('core_legislation'), false);
    assert.equal(isProfessionalCapability('basic_case_law'), false);
    assert.equal(isProfessionalCapability('eu_references'), false);
  });
});

describe('upgradeMessage', () => {
  it('should include the feature name', () => {
    const msg = upgradeMessage('expanded case law');
    assert.ok(msg.includes('expanded case law'));
  });

  it('should mention Professional tier', () => {
    const msg = upgradeMessage('anything');
    assert.ok(msg.includes('Professional tier'));
  });

  it('should mention German Law MCP', () => {
    const msg = upgradeMessage('anything');
    assert.ok(msg.includes('German Law MCP'));
  });

  it('should include contact info', () => {
    const msg = upgradeMessage('anything');
    assert.ok(msg.includes('hello@ansvar.ai'));
  });
});

/**
 * Runtime capability detection for the German Law MCP server.
 *
 * The server inspects which SQLite tables are present on startup and
 * exposes a Set<Capability> so that tool handlers can gate features
 * (or return an upgrade prompt) without hard-coding tier logic.
 */

import Database from '@ansvar/mcp-sqlite';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Capability =
  | 'core_legislation'
  | 'basic_case_law'
  | 'eu_references'
  | 'expanded_case_law'
  | 'full_preparatory_works'
  | 'agency_guidance';

export type Tier = 'free' | 'professional' | 'unknown';

export interface DbMetadata {
  tier: Tier;
  schema_version: string;
  built_at: string;
  builder: string;
}

// ---------------------------------------------------------------------------
// Table → Capability mapping
// ---------------------------------------------------------------------------

const CAPABILITY_TABLES: Record<Capability, string> = {
  core_legislation: 'law_documents',
  basic_case_law: 'case_law_documents',
  eu_references: 'eu_references',
  expanded_case_law: 'case_law_documents_full',
  full_preparatory_works: 'preparatory_works_full',
  agency_guidance: 'agency_guidance',
};

const PROFESSIONAL_CAPABILITIES: ReadonlySet<Capability> = new Set([
  'expanded_case_law',
  'full_preparatory_works',
  'agency_guidance',
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Detect which capabilities the current database supports. */
export function detectCapabilities(
  db: InstanceType<typeof Database>,
): Set<Capability> {
  const caps = new Set<Capability>();

  for (const [capability, table] of Object.entries(CAPABILITY_TABLES)) {
    if (tableExists(db, table)) {
      caps.add(capability as Capability);
    }
  }

  return caps;
}

/** Read db_metadata key-value pairs. Returns sensible defaults when missing. */
export function readDbMetadata(
  db: InstanceType<typeof Database>,
): DbMetadata {
  const defaults: DbMetadata = {
    tier: 'unknown',
    schema_version: '1',
    built_at: 'unknown',
    builder: 'unknown',
  };

  if (!tableExists(db, 'db_metadata')) {
    return defaults;
  }

  try {
    const rows = db
      .prepare('SELECT key, value FROM db_metadata')
      .all() as { key: string; value: string }[];

    const map = new Map(rows.map((r) => [r.key, r.value]));

    const rawTier = map.get('tier') ?? 'unknown';
    const tier: Tier = rawTier === 'free' || rawTier === 'professional' ? rawTier : 'unknown';

    return {
      tier,
      schema_version: map.get('schema_version') ?? defaults.schema_version,
      built_at: map.get('built_at') ?? defaults.built_at,
      builder: map.get('builder') ?? defaults.builder,
    };
  } catch {
    return defaults;
  }
}

/** Check whether a capability belongs to the paid (professional) tier. */
export function isProfessionalCapability(cap: Capability): boolean {
  return PROFESSIONAL_CAPABILITIES.has(cap);
}

/** Human-readable upgrade prompt for gated features. */
export function upgradeMessage(feature: string): string {
  return (
    `The "${feature}" feature requires the Professional tier of the German Law MCP. ` +
    `Upgrade to the Professional tier for full-text case law, preparatory works, ` +
    `and agency guidance. Contact hello@ansvar.ai for details.`
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tableExists(db: InstanceType<typeof Database>, name: string): boolean {
  try {
    const row = db
      .prepare(
        "SELECT 1 AS ok FROM sqlite_master WHERE type IN ('table','view') AND name = ?",
      )
      .get(name) as { ok?: number } | undefined;
    return Boolean(row?.ok);
  } catch {
    return false;
  }
}

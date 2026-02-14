import Database from "@ansvar/mcp-sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseGermanCitation } from "../citation/german-citation.js";
import type {
  CaseLawSearchRequest,
  LawDocument,
  PreparatoryWorksRequest,
  SearchResponse,
} from "../shell/types.js";
import { buildFtsQueryVariants } from "../utils/fts-query.js";
import { detectCapabilities, readDbMetadata, type Capability, type DbMetadata } from '../capabilities.js';

const DB_ENV_VAR = "GERMAN_LAW_DB_PATH";
const DEFAULT_DB_PATH = path.resolve(process.cwd(), "data", "database.db");

type StatuteRow = {
  id: string;
  country: string;
  kind: string;
  title: string;
  citation: string | null;
  source_url: string | null;
  effective_date: string | null;
  text_snippet: string | null;
  metadata_json: string | null;
};

type CaseLawRow = {
  id: string;
  country: string;
  case_id: string | null;
  ecli: string | null;
  court: string | null;
  decision_date: string | null;
  file_number: string | null;
  decision_type: string | null;
  title: string;
  citation: string | null;
  source_url: string;
  text_snippet: string | null;
  metadata_json: string | null;
};

type PreparatoryWorkRow = {
  id: string;
  country: string;
  dip_id: string;
  title: string;
  statute_id: string | null;
  statute_citation: string | null;
  work_type: string | null;
  publication_date: string | null;
  source_url: string;
  text_snippet: string | null;
  metadata_json: string | null;
};

type SqlParam = string | number;

let dbInstance: InstanceType<typeof Database> | null = null;
let dbAvailabilityChecked = false;
let dbAvailable = false;
let resolvedPathCache = "";
let dbCapabilities: Set<Capability> | null = null;
let dbMetadata: DbMetadata | null = null;

export function searchGermanLawDocuments(
  query: string,
  limit: number,
): SearchResponse | null {
  const db = getDb();
  if (!db || !tableExists(db, "law_documents")) {
    return null;
  }

  const clampedLimit = clampLimit(limit);
  const exactRows = findExactCitationRows(db, query, clampedLimit);
  const mergedRows: StatuteRow[] = [];
  const seen = new Set<string>();

  pushUniqueRows(mergedRows, seen, exactRows, clampedLimit);
  if (mergedRows.length >= clampedLimit) {
    return {
      documents: mergedRows.map(mapStatuteRowToLawDocument),
      total: mergedRows.length,
    };
  }

  const remaining = clampedLimit - mergedRows.length;
  const variants = buildFtsQueryVariants(query);
  if (!variants.primary) {
    return {
      documents: mergedRows.map(mapStatuteRowToLawDocument),
      total: mergedRows.length,
    };
  }

  if (tableExists(db, "law_documents_fts")) {
    const primaryRows = runLawFtsQuery(db, variants.primary, remaining * 3);
    if (primaryRows) {
      pushUniqueRows(mergedRows, seen, primaryRows, clampedLimit);
    }
    if (mergedRows.length >= clampedLimit) {
      return {
        documents: mergedRows.map(mapStatuteRowToLawDocument),
        total: mergedRows.length,
      };
    }

    if (variants.fallback) {
      const fallbackRows = runLawFtsQuery(db, variants.fallback, remaining * 3);
      if (fallbackRows && fallbackRows.length > 0) {
        pushUniqueRows(mergedRows, seen, fallbackRows, clampedLimit);
      }
    }
    if (mergedRows.length >= clampedLimit) {
      return {
        documents: mergedRows.map(mapStatuteRowToLawDocument),
        total: mergedRows.length,
      };
    }
  }

  const likeRows = runLawLikeQuery(db, query, remaining * 3);
  pushUniqueRows(mergedRows, seen, likeRows, clampedLimit);

  return {
    documents: mergedRows.map(mapStatuteRowToLawDocument),
    total: mergedRows.length,
  };
}

export function searchGermanCaseLawDocuments(
  request: CaseLawSearchRequest,
): SearchResponse | null {
  const db = getDb();
  if (!db || !tableExists(db, "case_law_documents")) {
    return null;
  }

  const query = request.query.trim();
  if (!query) {
    return { documents: [], total: 0 };
  }

  const clampedLimit = clampLimit(request.limit ?? 20);
  const filters = buildCaseFilterSql({
    ...(request.court === undefined ? {} : { court: request.court }),
    ...(request.dateFrom === undefined ? {} : { dateFrom: request.dateFrom }),
    ...(request.dateTo === undefined ? {} : { dateTo: request.dateTo }),
  });

  const mergedRows: CaseLawRow[] = [];
  const seen = new Set<string>();

  const exactRows = findExactCaseRows(db, query, clampedLimit, filters);
  pushUniqueRows(mergedRows, seen, exactRows, clampedLimit);
  if (mergedRows.length >= clampedLimit) {
    return {
      documents: mergedRows.map(mapCaseLawRowToLawDocument),
      total: mergedRows.length,
    };
  }

  const remaining = clampedLimit - mergedRows.length;
  const variants = buildFtsQueryVariants(query);
  if (variants.primary && tableExists(db, "case_law_documents_fts")) {
    const primaryRows = runCaseLawFtsQuery(
      db,
      variants.primary,
      remaining * 3,
      filters,
    );
    if (primaryRows) {
      pushUniqueRows(mergedRows, seen, primaryRows, clampedLimit);
    }
    if (mergedRows.length >= clampedLimit) {
      return {
        documents: mergedRows.map(mapCaseLawRowToLawDocument),
        total: mergedRows.length,
      };
    }

    if (variants.fallback) {
      const fallbackRows = runCaseLawFtsQuery(
        db,
        variants.fallback,
        remaining * 3,
        filters,
      );
      if (fallbackRows && fallbackRows.length > 0) {
        pushUniqueRows(mergedRows, seen, fallbackRows, clampedLimit);
      }
    }
    if (mergedRows.length >= clampedLimit) {
      return {
        documents: mergedRows.map(mapCaseLawRowToLawDocument),
        total: mergedRows.length,
      };
    }
  }

  const likeRows = runCaseLawLikeQuery(db, query, remaining * 3, filters);
  pushUniqueRows(mergedRows, seen, likeRows, clampedLimit);

  return {
    documents: mergedRows.map(mapCaseLawRowToLawDocument),
    total: mergedRows.length,
  };
}

export function searchGermanPreparatoryWorks(
  request: PreparatoryWorksRequest,
): SearchResponse | null {
  const db = getDb();
  if (!db || !tableExists(db, "preparatory_works")) {
    return null;
  }

  const hints = buildPreparatorySearchHints(request);
  const clampedLimit = clampLimit(request.limit ?? 20);
  const filters = buildPreparatoryFilterSql(request);
  const mergedRows: PreparatoryWorkRow[] = [];
  const seen = new Set<string>();

  if (hints.length > 0 && tableExists(db, "preparatory_works_fts")) {
    const variants = buildFtsQueryVariants(hints[0] ?? "");
    if (variants.primary) {
      const primaryRows = runPreparatoryFtsQuery(
        db,
        variants.primary,
        clampedLimit * 3,
        filters,
      );
      if (primaryRows) {
        pushUniqueRows(mergedRows, seen, primaryRows, clampedLimit);
      }
      if (mergedRows.length >= clampedLimit) {
        return {
          documents: mergedRows.map(mapPreparatoryWorkRowToLawDocument),
          total: mergedRows.length,
        };
      }

      if (variants.fallback) {
        const fallbackRows = runPreparatoryFtsQuery(
          db,
          variants.fallback,
          clampedLimit * 3,
          filters,
        );
        if (fallbackRows && fallbackRows.length > 0) {
          pushUniqueRows(mergedRows, seen, fallbackRows, clampedLimit);
        }
      }
      if (mergedRows.length >= clampedLimit) {
        return {
          documents: mergedRows.map(mapPreparatoryWorkRowToLawDocument),
          total: mergedRows.length,
        };
      }
    }
  }

  const likeRows = runPreparatoryLikeQuery(
    db,
    hints,
    clampedLimit * 3,
    filters,
  );
  pushUniqueRows(mergedRows, seen, likeRows, clampedLimit);

  if (mergedRows.length === 0 && hints.length === 0) {
    const filteredRows = runPreparatoryFilteredQuery(db, clampedLimit, filters);
    pushUniqueRows(mergedRows, seen, filteredRows, clampedLimit);
  }

  return {
    documents: mergedRows.map(mapPreparatoryWorkRowToLawDocument),
    total: mergedRows.length,
  };
}

export function getGermanLawDocumentById(id: string): LawDocument | null | undefined {
  const db = getDb();
  if (!db || !tableExists(db, "law_documents")) {
    return undefined;
  }

  let row: StatuteRow | undefined;
  try {
    row = db
      .prepare(
        `
        SELECT id, country, kind, title, citation, source_url, effective_date, text_snippet, metadata_json
        FROM law_documents
        WHERE id = ?
        LIMIT 1
        `,
      )
      .get(id) as StatuteRow | undefined;
  } catch {
    return undefined;
  }

  return row ? mapStatuteRowToLawDocument(row) : null;
}

export function getGermanDocumentByAnyId(
  id: string,
): LawDocument | null | undefined {
  const db = getDb();
  if (!db) {
    return undefined;
  }

  if (tableExists(db, "law_documents")) {
    try {
      const statuteRow = db
        .prepare(
          `
          SELECT id, country, kind, title, citation, source_url, effective_date, text_snippet, metadata_json
          FROM law_documents
          WHERE id = ?
          LIMIT 1
          `,
        )
        .get(id) as StatuteRow | undefined;
      if (statuteRow) {
        return mapStatuteRowToLawDocument(statuteRow);
      }
    } catch {
      return undefined;
    }
  }

  if (tableExists(db, "case_law_documents")) {
    try {
      const caseLawRow = db
        .prepare(
          `
          SELECT
            id,
            country,
            case_id,
            ecli,
            court,
            decision_date,
            file_number,
            decision_type,
            title,
            citation,
            source_url,
            text_snippet,
            metadata_json
          FROM case_law_documents
          WHERE id = ?
          LIMIT 1
          `,
        )
        .get(id) as CaseLawRow | undefined;
      if (caseLawRow) {
        return mapCaseLawRowToLawDocument(caseLawRow);
      }
    } catch {
      return undefined;
    }
  }

  if (tableExists(db, "preparatory_works")) {
    try {
      const preparatoryRow = db
        .prepare(
          `
          SELECT
            id,
            country,
            dip_id,
            title,
            statute_id,
            statute_citation,
            work_type,
            publication_date,
            source_url,
            text_snippet,
            metadata_json
          FROM preparatory_works
          WHERE id = ?
          LIMIT 1
          `,
        )
        .get(id) as PreparatoryWorkRow | undefined;
      if (preparatoryRow) {
        return mapPreparatoryWorkRowToLawDocument(preparatoryRow);
      }
    } catch {
      return undefined;
    }
  }

  return null;
}

export function getGermanLawDocumentsByStatuteId(
  statuteId: string,
  limit = 200,
): SearchResponse | null {
  const db = getDb();
  if (!db || !tableExists(db, "law_documents")) {
    return null;
  }

  const normalized = statuteId.trim().toLowerCase();
  if (!normalized) {
    return { documents: [], total: 0 };
  }

  const clampedLimit = clampLimit(limit);
  try {
    const rows = db
      .prepare(
        `
        SELECT id, country, kind, title, citation, source_url, effective_date, text_snippet, metadata_json
        FROM law_documents
        WHERE lower(statute_id) = ?
        ORDER BY id
        LIMIT ?
        `,
      )
      .all(normalized, clampedLimit) as StatuteRow[];

    return {
      documents: rows.map(mapStatuteRowToLawDocument),
      total: rows.length,
    };
  } catch {
    return null;
  }
}

export function getGermanLawDocumentsByCitation(
  citation: string,
  limit = 200,
): SearchResponse | null {
  const db = getDb();
  if (!db || !tableExists(db, "law_documents")) {
    return null;
  }

  const trimmed = citation.trim();
  if (!trimmed) {
    return { documents: [], total: 0 };
  }

  const parsed = parseGermanCitation(trimmed);
  const candidates = dedupeStrings([
    trimmed,
    parsed?.normalized ?? "",
    ...(parsed?.lookupCitations ?? []),
  ])
    .map((value) => value.toLowerCase())
    .filter((value) => value.length > 0);
  if (candidates.length === 0) {
    return { documents: [], total: 0 };
  }

  const preferred = (parsed?.lookupCitations[0] ?? parsed?.normalized ?? trimmed).toLowerCase();
  const clampedLimit = clampLimit(limit);
  const placeholders = candidates.map(() => "?").join(", ");

  try {
    const rows = db
      .prepare(
        `
        SELECT id, country, kind, title, citation, source_url, effective_date, text_snippet, metadata_json
        FROM law_documents
        WHERE lower(citation) IN (${placeholders})
        ORDER BY
          CASE WHEN lower(citation) = ? THEN 0 ELSE 1 END,
          id
        LIMIT ?
        `,
      )
      .all(...candidates, preferred, clampedLimit) as StatuteRow[];

    return {
      documents: rows.map(mapStatuteRowToLawDocument),
      total: rows.length,
    };
  } catch {
    return null;
  }
}

export function getGermanLawDocumentCount(): number | null {
  const db = getDb();
  if (!db || !tableExists(db, "law_documents")) {
    return null;
  }

  try {
    const row = db
      .prepare("SELECT COUNT(*) AS count FROM law_documents")
      .get() as { count: number };
    return Number(row.count);
  } catch {
    return null;
  }
}

export function getGermanCaseLawDocumentCount(): number | null {
  const db = getDb();
  if (!db || !tableExists(db, "case_law_documents")) {
    return null;
  }

  try {
    const row = db
      .prepare("SELECT COUNT(*) AS count FROM case_law_documents")
      .get() as { count: number };
    return Number(row.count);
  } catch {
    return null;
  }
}

export function getGermanPreparatoryWorkCount(): number | null {
  const db = getDb();
  if (!db || !tableExists(db, "preparatory_works")) {
    return null;
  }

  try {
    const row = db
      .prepare("SELECT COUNT(*) AS count FROM preparatory_works")
      .get() as { count: number };
    return Number(row.count);
  } catch {
    return null;
  }
}

export function citationExistsInGermanLawDatabase(citation: string): boolean | null {
  const db = getDb();
  if (!db || !tableExists(db, "law_documents")) {
    return null;
  }

  const parsed = parseGermanCitation(citation);
  if (!parsed || parsed.lookupCitations.length === 0) {
    return false;
  }

  try {
    return existsByCitation(db, parsed.lookupCitations);
  } catch {
    return null;
  }
}

export function resolveGermanLawDatabasePath(): string {
  return process.env[DB_ENV_VAR]?.trim() || DEFAULT_DB_PATH;
}

export function resetGermanLawDatabaseCache(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
  dbAvailabilityChecked = false;
  dbAvailable = false;
  resolvedPathCache = "";
}

export function getCapabilities(): Set<Capability> {
  if (!dbCapabilities) getDb();
  return dbCapabilities ?? new Set();
}

export function getMetadata(): DbMetadata {
  if (!dbMetadata) getDb();
  return dbMetadata ?? { tier: 'unknown', schema_version: '1', built_at: 'unknown', builder: 'unknown' };
}

function getDb(): InstanceType<typeof Database> | null {
  const resolvedPath = resolveGermanLawDatabasePath();

  if (dbAvailabilityChecked && resolvedPath === resolvedPathCache) {
    return dbAvailable ? dbInstance : null;
  }

  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }

  resolvedPathCache = resolvedPath;
  dbAvailabilityChecked = true;
  dbAvailable = false;

  if (!fs.existsSync(resolvedPath)) {
    return null;
  }

  try {
    dbInstance = new Database(resolvedPath, { readonly: true });
    dbAvailable = true;
    // Detect capabilities on first open
    dbCapabilities = detectCapabilities(dbInstance);
    dbMetadata = readDbMetadata(dbInstance);
    console.error(`[german-law-mcp] Database tier: ${dbMetadata.tier}, capabilities: ${[...dbCapabilities].join(', ')}`);
    return dbInstance;
  } catch {
    return null;
  }
}

function tableExists(db: InstanceType<typeof Database>, tableName: string): boolean {
  try {
    const row = db
      .prepare(
        `
        SELECT 1 AS exists_flag
        FROM sqlite_master
        WHERE type IN ('table', 'view')
          AND name = ?
        LIMIT 1
        `,
      )
      .get(tableName) as { exists_flag?: number } | undefined;

    return Boolean(row?.exists_flag);
  } catch {
    return false;
  }
}

function runLawFtsQuery(
  db: InstanceType<typeof Database>,
  ftsQuery: string,
  limit: number,
): StatuteRow[] | null {
  try {
    const rows = db
      .prepare(
        `
        SELECT d.id, d.country, d.kind, d.title, d.citation, d.source_url, d.effective_date, d.text_snippet, d.metadata_json
        FROM law_documents_fts f
        JOIN law_documents d ON d.rowid = f.rowid
        WHERE law_documents_fts MATCH ?
        ORDER BY bm25(law_documents_fts)
        LIMIT ?
        `,
      )
      .all(ftsQuery, limit) as StatuteRow[];

    return rows;
  } catch {
    return null;
  }
}

function findExactCitationRows(
  db: InstanceType<typeof Database>,
  query: string,
  limit: number,
): StatuteRow[] {
  const parsed = parseGermanCitation(query);
  if (!parsed || parsed.lookupCitations.length === 0) {
    return [];
  }

  const citations = dedupeStrings(parsed.lookupCitations).map((value) =>
    value.toLowerCase(),
  );
  const placeholders = citations.map(() => "?").join(", ");

  try {
    return db
      .prepare(
        `
        SELECT id, country, kind, title, citation, source_url, effective_date, text_snippet, metadata_json
        FROM law_documents
        WHERE lower(citation) IN (${placeholders})
        ORDER BY
          CASE WHEN lower(citation) = ? THEN 0 ELSE 1 END,
          id
        LIMIT ?
        `,
      )
      .all(...citations, citations[0] ?? "", limit) as StatuteRow[];
  } catch {
    return [];
  }
}

function runLawLikeQuery(
  db: InstanceType<typeof Database>,
  query: string,
  limit: number,
): StatuteRow[] {
  const tokens = query
    .normalize("NFC")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);

  const searchTerms = tokens.length > 0 ? tokens : [query.trim()];
  const clauses: string[] = [];
  const params: SqlParam[] = [];

  for (const term of searchTerms) {
    const like = `%${term}%`;
    clauses.push("(title LIKE ? OR citation LIKE ? OR text_snippet LIKE ?)");
    params.push(like, like, like);
  }

  const whereClause = clauses.length > 0 ? clauses.join(" AND ") : "1 = 0";

  try {
    return db
      .prepare(
        `
        SELECT id, country, kind, title, citation, source_url, effective_date, text_snippet, metadata_json
        FROM law_documents
        WHERE ${whereClause}
        LIMIT ?
        `,
      )
      .all(...params, limit) as StatuteRow[];
  } catch {
    return [];
  }
}

function findExactCaseRows(
  db: InstanceType<typeof Database>,
  query: string,
  limit: number,
  filters: SqlFilter,
): CaseLawRow[] {
  const lower = query.toLowerCase();
  const params: SqlParam[] = [lower, lower, lower, lower, lower, ...filters.params, limit];

  try {
    return db
      .prepare(
        `
        SELECT
          id,
          country,
          case_id,
          ecli,
          court,
          decision_date,
          file_number,
          decision_type,
          title,
          citation,
          source_url,
          text_snippet,
          metadata_json
        FROM case_law_documents
        WHERE (
          lower(ecli) = ?
          OR lower(file_number) = ?
          OR lower(citation) = ?
          OR lower(case_id) = ?
          OR lower(id) = ?
        ) ${filters.clause}
        ORDER BY decision_date DESC, id DESC
        LIMIT ?
        `,
      )
      .all(...params) as CaseLawRow[];
  } catch {
    return [];
  }
}

function runCaseLawFtsQuery(
  db: InstanceType<typeof Database>,
  ftsQuery: string,
  limit: number,
  filters: SqlFilter,
): CaseLawRow[] | null {
  try {
    const rows = db
      .prepare(
        `
        SELECT
          c.id,
          c.country,
          c.case_id,
          c.ecli,
          c.court,
          c.decision_date,
          c.file_number,
          c.decision_type,
          c.title,
          c.citation,
          c.source_url,
          c.text_snippet,
          c.metadata_json
        FROM case_law_documents_fts f
        JOIN case_law_documents c ON c.rowid = f.rowid
        WHERE case_law_documents_fts MATCH ? ${filters.clause}
        ORDER BY bm25(case_law_documents_fts), c.decision_date DESC
        LIMIT ?
        `,
      )
      .all(ftsQuery, ...filters.params, limit) as CaseLawRow[];

    return rows;
  } catch {
    return null;
  }
}

function runCaseLawLikeQuery(
  db: InstanceType<typeof Database>,
  query: string,
  limit: number,
  filters: SqlFilter,
): CaseLawRow[] {
  const tokens = query
    .normalize("NFC")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
  const searchTerms = tokens.length > 0 ? tokens : [query.trim()];
  const clauses: string[] = [];
  const params: SqlParam[] = [];

  for (const term of searchTerms) {
    const like = `%${term}%`;
    clauses.push(
      "(title LIKE ? OR citation LIKE ? OR text_snippet LIKE ? OR file_number LIKE ? OR court LIKE ? OR ecli LIKE ?)",
    );
    params.push(like, like, like, like, like, like);
  }

  const queryClause = clauses.length > 0 ? clauses.join(" AND ") : "1 = 0";
  try {
    return db
      .prepare(
        `
        SELECT
          id,
          country,
          case_id,
          ecli,
          court,
          decision_date,
          file_number,
          decision_type,
          title,
          citation,
          source_url,
          text_snippet,
          metadata_json
        FROM case_law_documents
        WHERE (${queryClause}) ${filters.clause}
        ORDER BY decision_date DESC, id DESC
        LIMIT ?
        `,
      )
      .all(...params, ...filters.params, limit) as CaseLawRow[];
  } catch {
    return [];
  }
}

function runPreparatoryFtsQuery(
  db: InstanceType<typeof Database>,
  ftsQuery: string,
  limit: number,
  filters: SqlFilter,
): PreparatoryWorkRow[] | null {
  try {
    const rows = db
      .prepare(
        `
        SELECT
          p.id,
          p.country,
          p.dip_id,
          p.title,
          p.statute_id,
          p.statute_citation,
          p.work_type,
          p.publication_date,
          p.source_url,
          p.text_snippet,
          p.metadata_json
        FROM preparatory_works_fts f
        JOIN preparatory_works p ON p.rowid = f.rowid
        WHERE preparatory_works_fts MATCH ? ${filters.clause}
        ORDER BY bm25(preparatory_works_fts), p.publication_date DESC
        LIMIT ?
        `,
      )
      .all(ftsQuery, ...filters.params, limit) as PreparatoryWorkRow[];

    return rows;
  } catch {
    return null;
  }
}

function runPreparatoryLikeQuery(
  db: InstanceType<typeof Database>,
  hints: string[],
  limit: number,
  filters: SqlFilter,
): PreparatoryWorkRow[] {
  const tokens = hints.length > 0 ? tokenizeHints(hints) : [];
  const clauses: string[] = [];
  const params: SqlParam[] = [];

  for (const token of tokens) {
    const like = `%${token}%`;
    clauses.push("(title LIKE ? OR statute_citation LIKE ? OR text_snippet LIKE ?)");
    params.push(like, like, like);
  }

  const queryClause = clauses.length > 0 ? clauses.join(" AND ") : "1 = 0";
  try {
    return db
      .prepare(
        `
        SELECT
          id,
          country,
          dip_id,
          title,
          statute_id,
          statute_citation,
          work_type,
          publication_date,
          source_url,
          text_snippet,
          metadata_json
        FROM preparatory_works
        WHERE (${queryClause}) ${filters.clause}
        ORDER BY publication_date DESC, id DESC
        LIMIT ?
        `,
      )
      .all(...params, ...filters.params, limit) as PreparatoryWorkRow[];
  } catch {
    return [];
  }
}

function runPreparatoryFilteredQuery(
  db: InstanceType<typeof Database>,
  limit: number,
  filters: SqlFilter,
): PreparatoryWorkRow[] {
  try {
    return db
      .prepare(
        `
        SELECT
          id,
          country,
          dip_id,
          title,
          statute_id,
          statute_citation,
          work_type,
          publication_date,
          source_url,
          text_snippet,
          metadata_json
        FROM preparatory_works
        WHERE 1 = 1 ${filters.clause}
        ORDER BY publication_date DESC, id DESC
        LIMIT ?
        `,
      )
      .all(...filters.params, limit) as PreparatoryWorkRow[];
  } catch {
    return [];
  }
}

function buildPreparatorySearchHints(
  request: PreparatoryWorksRequest,
): string[] {
  const hints: string[] = [];

  if (request.query) {
    hints.push(request.query);
  }

  if (request.statuteId) {
    hints.push(request.statuteId);
  }

  if (request.citation) {
    hints.push(request.citation);
    const parsedCitation = parseGermanCitation(request.citation);
    if (parsedCitation?.normalized) {
      hints.push(parsedCitation.normalized);
    }
    const code = parsedCitation?.parsed.code;
    if (code && typeof code === "string") {
      hints.push(code);
    }
  }

  return dedupeStrings(hints);
}

interface SqlFilter {
  clause: string;
  params: SqlParam[];
}

interface CaseSearchFilterInput {
  court?: string;
  dateFrom?: string;
  dateTo?: string;
}

function buildCaseFilterSql(filters: CaseSearchFilterInput): SqlFilter {
  const clauses: string[] = [];
  const params: SqlParam[] = [];

  if (filters.court?.trim()) {
    clauses.push("AND court LIKE ?");
    params.push(`%${filters.court.trim()}%`);
  }

  const dateFrom = normalizeIsoDate(filters.dateFrom);
  if (dateFrom) {
    clauses.push("AND decision_date >= ?");
    params.push(dateFrom);
  }

  const dateTo = normalizeIsoDate(filters.dateTo);
  if (dateTo) {
    clauses.push("AND decision_date <= ?");
    params.push(dateTo);
  }

  return {
    clause: clauses.length > 0 ? ` ${clauses.join(" ")} ` : "",
    params,
  };
}

function buildPreparatoryFilterSql(
  request: PreparatoryWorksRequest,
): SqlFilter {
  const clauses: string[] = [];
  const params: SqlParam[] = [];

  if (request.statuteId?.trim()) {
    clauses.push("AND lower(statute_id) = ?");
    params.push(request.statuteId.trim().toLowerCase());
  }

  if (request.citation?.trim()) {
    const parsed = parseGermanCitation(request.citation);
    const tokens = dedupeStrings([
      request.citation,
      parsed?.normalized ?? "",
      parsed?.parsed.code ?? "",
    ])
      .map((token) => token.toLowerCase())
      .filter((token) => token.length > 1);

    if (tokens.length > 0) {
      const tokenClauses: string[] = [];
      for (const token of tokens) {
        tokenClauses.push(
          "(lower(statute_citation) LIKE ? OR lower(title) LIKE ? OR lower(text_snippet) LIKE ?)",
        );
        const like = `%${token}%`;
        params.push(like, like, like);
      }
      clauses.push(`AND (${tokenClauses.join(" OR ")})`);
    }
  }

  return {
    clause: clauses.length > 0 ? ` ${clauses.join(" ")} ` : "",
    params,
  };
}

function normalizeIsoDate(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function tokenizeHints(hints: string[]): string[] {
  const tokens = hints
    .flatMap((hint) =>
      hint
        .normalize("NFC")
        .split(/\s+/)
        .map((token) => token.trim()),
    )
    .filter((token) => token.length > 1);

  return dedupeStrings(tokens);
}

function existsByCitation(
  db: InstanceType<typeof Database>,
  citations: string[],
): boolean {
  const values = dedupeStrings(citations).map((value) => value.toLowerCase());
  if (values.length === 0) {
    return false;
  }

  const placeholders = values.map(() => "?").join(", ");
  const row = db
    .prepare(
      `
      SELECT 1 AS hit
      FROM law_documents
      WHERE lower(citation) IN (${placeholders})
      LIMIT 1
      `,
    )
    .get(...values) as { hit?: number } | undefined;

  return Boolean(row?.hit);
}

function pushUniqueRows<T extends { id: string }>(
  target: T[],
  seen: Set<string>,
  rows: T[],
  limit: number,
): void {
  for (const row of rows) {
    if (seen.has(row.id)) {
      continue;
    }
    seen.add(row.id);
    target.push(row);
    if (target.length >= limit) {
      return;
    }
  }
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function mapStatuteRowToLawDocument(row: StatuteRow): LawDocument {
  return {
    id: row.id,
    country: row.country,
    kind: mapKind(row.kind),
    title: row.title,
    ...(row.citation ? { citation: row.citation } : {}),
    ...(row.source_url ? { sourceUrl: row.source_url } : {}),
    ...(row.effective_date ? { effectiveDate: row.effective_date } : {}),
    ...(row.text_snippet ? { textSnippet: row.text_snippet } : {}),
    ...(row.metadata_json ? { metadata: parseMetadata(row.metadata_json) } : {}),
  };
}

function mapCaseLawRowToLawDocument(row: CaseLawRow): LawDocument {
  const metadata = {
    ...(row.metadata_json ? parseMetadata(row.metadata_json) : {}),
    ...(row.case_id ? { case_id: row.case_id } : {}),
    ...(row.ecli ? { ecli: row.ecli } : {}),
    ...(row.court ? { court: row.court } : {}),
    ...(row.file_number ? { file_number: row.file_number } : {}),
    ...(row.decision_type ? { decision_type: row.decision_type } : {}),
  };

  return {
    id: row.id,
    country: row.country,
    kind: "case",
    title: row.title,
    ...(row.citation ? { citation: row.citation } : {}),
    ...(row.source_url ? { sourceUrl: row.source_url } : {}),
    ...(row.decision_date ? { effectiveDate: row.decision_date } : {}),
    ...(row.text_snippet ? { textSnippet: row.text_snippet } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
}

function mapPreparatoryWorkRowToLawDocument(row: PreparatoryWorkRow): LawDocument {
  const metadata = {
    ...(row.metadata_json ? parseMetadata(row.metadata_json) : {}),
    dip_id: row.dip_id,
    ...(row.statute_id ? { statute_id: row.statute_id } : {}),
    ...(row.work_type ? { work_type: row.work_type } : {}),
  };

  return {
    id: row.id,
    country: row.country,
    kind: "preparatory_work",
    title: row.title,
    ...(row.statute_citation ? { citation: row.statute_citation } : {}),
    ...(row.source_url ? { sourceUrl: row.source_url } : {}),
    ...(row.publication_date ? { effectiveDate: row.publication_date } : {}),
    ...(row.text_snippet ? { textSnippet: row.text_snippet } : {}),
    metadata,
  };
}

function mapKind(value: string): LawDocument["kind"] {
  const kind = value.toLowerCase();
  if (
    kind === "statute" ||
    kind === "regulation" ||
    kind === "case" ||
    kind === "preparatory_work"
  ) {
    return kind;
  }
  return "other";
}

function parseMetadata(
  raw: string,
): Record<string, string | number | boolean | null> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, string | number | boolean | null>;
  } catch {
    return {};
  }
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || Number.isNaN(limit)) {
    return 20;
  }
  if (limit < 1) {
    return 1;
  }
  if (limit > 100) {
    return 100;
  }
  return Math.trunc(limit);
}

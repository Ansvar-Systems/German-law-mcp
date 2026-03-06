/**
 * Statute ID resolution for German Law MCP.
 *
 * 9-step resolution cascade with shortest-match ranking.
 * Resolves fuzzy document references (titles, Act names, chapter numbers)
 * to database document IDs.
 */

import type Database from '@ansvar/mcp-sqlite';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Db = InstanceType<typeof Database>;

interface DocRow {
  id: string;
  title: string;
  short_name: string | null;
}

// ---------------------------------------------------------------------------
// Abbreviation map (Step 2) — add entries as needed
// ---------------------------------------------------------------------------

const ABBREVIATIONS: Record<string, string> = {
  // Example: 'DPA': 'data-protection-act-2019',
};

// ---------------------------------------------------------------------------
// Caches (lazy singletons, reset per test run)
// ---------------------------------------------------------------------------

let allDocsCache: DocRow[] | null = null;
let chapterLookup: Map<string, string> | null = null;

/** Reset caches — exported for test teardown. */
export function resetCaches(): void {
  allDocsCache = null;
  chapterLookup = null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalise "Act YYYY" to "Act, YYYY" — German statutes store the comma form.
 * Only adds a comma when one is not already present.
 */
function normalizeActTitle(input: string): string {
  return input.replace(/\bAct\s+(?!,)(\d{4})\b/gi, 'Act, $1');
}

/**
 * Strip punctuation characters and collapse whitespace.
 * Used for the final punctuation-normalized fallback scan.
 */
function normalizePunctuation(s: string): string {
  return s.replace(/[,;:.()[\]]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Load all documents into the in-memory cache (lazy, once per process).
 */
function getAllDocs(db: Db): DocRow[] {
  if (!allDocsCache) {
    allDocsCache = db.prepare(
      'SELECT id, title, short_name FROM legal_documents',
    ).all() as DocRow[];
  }
  return allDocsCache;
}

/**
 * Build a chapter-number → document_id map from s1 provision content.
 * Parses patterns like "[Chapter 39]" or "[Chapter 39:2]".
 */
function getChapterLookup(db: Db): Map<string, string> {
  if (!chapterLookup) {
    chapterLookup = new Map();
    const rows = db.prepare(
      "SELECT document_id, content FROM legal_provisions WHERE provision_ref = 's1' AND content LIKE '%[Chapter %'",
    ).all() as { document_id: string; content: string }[];

    for (const row of rows) {
      const match = row.content.match(/\[Chapter\s+(\d+[:\d]*)\]/);
      if (match?.[1]) {
        chapterLookup.set(match[1], row.document_id);
      }
    }
  }
  return chapterLookup;
}

// ---------------------------------------------------------------------------
// Main resolution function — 9-step cascade
// ---------------------------------------------------------------------------

/**
 * Resolve a document identifier to a database document ID.
 *
 * Steps:
 * 1. Direct ID match
 * 2. Abbreviation map
 * 3. Chapter number lookup
 * 4. Exact title match (case-insensitive), then with trailing year stripped
 * 5. Shortest LIKE match on title
 * 6. Case-insensitive shortest LIKE on title
 * 7. Short-name LIKE (case-insensitive)
 * 8. Punctuation-normalized full scan (shortest match)
 * 9. Return null
 */
export function resolveDocumentId(
  db: Db,
  input: string,
): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // -----------------------------------------------------------------------
  // Step 1 — Direct ID match
  // -----------------------------------------------------------------------
  const directMatch = db.prepare(
    'SELECT id FROM legal_documents WHERE id = ?',
  ).get(trimmed) as { id: string } | undefined;
  if (directMatch) return directMatch.id;

  // -----------------------------------------------------------------------
  // Step 2 — Abbreviation map
  // -----------------------------------------------------------------------
  const abbrev = ABBREVIATIONS[trimmed] ?? ABBREVIATIONS[trimmed.toUpperCase()];
  if (abbrev) return abbrev;

  // -----------------------------------------------------------------------
  // Step 3 — Chapter number lookup (e.g., "Cap 39", "Chapter 486")
  // -----------------------------------------------------------------------
  const chapMatch = trimmed.match(/^(?:Cap(?:\.?\s*| )|(Chapter)\s*)(\d+[:\d]*)$/i);
  if (chapMatch?.[2]) {
    const lookup = getChapterLookup(db);
    const chapResult = lookup.get(chapMatch[2]);
    if (chapResult) return chapResult;
  }

  // -----------------------------------------------------------------------
  // Step 4 — Exact title match (case-insensitive)
  // -----------------------------------------------------------------------
  const normalized = normalizeActTitle(trimmed);

  // 4a: exact match on normalised input
  const exactTitle = db.prepare(
    'SELECT id FROM legal_documents WHERE LOWER(title) = LOWER(?)',
  ).get(normalized) as { id: string } | undefined;
  if (exactTitle) return exactTitle.id;

  // 4b: try with trailing year stripped from stored titles
  //     e.g. input "Data Protection Act" should match "Data Protection Act, 2019"
  const docs = getAllDocs(db);
  const lowerNormalized = normalized.toLowerCase();
  for (const doc of docs) {
    const storedBase = doc.title.replace(/,?\s*\d{4}\s*$/, '').toLowerCase();
    if (storedBase === lowerNormalized) return doc.id;
  }

  // -----------------------------------------------------------------------
  // Step 5 — Shortest LIKE match (case-sensitive on title)
  // -----------------------------------------------------------------------
  const likeMatches = docs.filter(d => d.title.includes(normalized));
  if (likeMatches.length > 0) {
    likeMatches.sort((a, b) => a.title.length - b.title.length);
    return likeMatches[0]!.id;
  }

  // -----------------------------------------------------------------------
  // Step 6 — Case-insensitive shortest LIKE on title
  // -----------------------------------------------------------------------
  const lowerLikeMatches = docs.filter(
    d => d.title.toLowerCase().includes(lowerNormalized),
  );
  if (lowerLikeMatches.length > 0) {
    lowerLikeMatches.sort((a, b) => a.title.length - b.title.length);
    return lowerLikeMatches[0]!.id;
  }

  // -----------------------------------------------------------------------
  // Step 7 — Short-name LIKE (case-insensitive)
  // -----------------------------------------------------------------------
  const shortNameMatches = docs.filter(
    d => d.short_name && d.short_name.toLowerCase().includes(lowerNormalized),
  );
  if (shortNameMatches.length > 0) {
    shortNameMatches.sort((a, b) => (a.title?.length ?? 0) - (b.title?.length ?? 0));
    return shortNameMatches[0]!.id;
  }

  // -----------------------------------------------------------------------
  // Step 8 — Punctuation-normalized full scan (shortest match)
  // -----------------------------------------------------------------------
  const puncNormalized = normalizePunctuation(lowerNormalized);
  const puncMatches = docs.filter(d => {
    const puncTitle = normalizePunctuation(d.title.toLowerCase());
    return puncTitle.includes(puncNormalized);
  });
  if (puncMatches.length > 0) {
    puncMatches.sort((a, b) => a.title.length - b.title.length);
    return puncMatches[0]!.id;
  }

  // -----------------------------------------------------------------------
  // Step 9 — No match
  // -----------------------------------------------------------------------
  return null;
}

// ---------------------------------------------------------------------------
// Legacy compatibility — some repos import these older function names.
// ---------------------------------------------------------------------------

/** @deprecated Use resolveDocumentId instead. */
export const resolveExistingStatuteId = resolveDocumentId;

/** @deprecated Use resolveDocumentId(db, id) !== null instead. */
export function isValidStatuteId(db: Db, id: string): boolean {
  return resolveDocumentId(db, id) !== null;
}

/** @deprecated Return candidate IDs for a query (compat shim). */
export function statuteIdCandidates(db: Db, input: string): string[] {
  const resolved = resolveDocumentId(db, input);
  return resolved ? [resolved] : [];
}

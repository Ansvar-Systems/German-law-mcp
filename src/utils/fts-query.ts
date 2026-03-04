/**
 * FTS5 query helpers for German Law MCP.
 *
 * Handles query sanitization, boolean operator passthrough, stemming,
 * and 6-tier variant generation for SQLite FTS5.
 */

/** FTS5 boolean operators that should pass through to the engine. */
const BOOLEAN_OPERATORS = new Set(['AND', 'OR', 'NOT']);

/**
 * Common English suffixes for naive stemming.
 * Ordered longest-first so we strip the most specific suffix.
 */
const STEM_SUFFIXES = [
  'ies', 'ing', 'ers', 'tion', 'ment', 'ness', 'able', 'ible',
  'ous', 'ive', 'ed', 'es', 'er', 'ly', 's',
];

/**
 * Naive English stemmer: strips a common suffix and returns `stem*`.
 * Returns null if the word is too short (<5 chars) or no suffix matched.
 */
export function stemWord(word: string): string | null {
  if (word.length < 5) return null;

  const lower = word.toLowerCase();
  for (const suffix of STEM_SUFFIXES) {
    if (lower.endsWith(suffix)) {
      const stem = lower.slice(0, -suffix.length);
      if (stem.length >= 3) {
        return `${stem}*`;
      }
    }
  }
  return null;
}

/**
 * Check whether the input contains FTS5 boolean operators (AND, OR, NOT).
 */
function containsBooleanOperators(tokens: string[]): boolean {
  return tokens.some(t => BOOLEAN_OPERATORS.has(t));
}

/**
 * Sanitize user input for safe FTS5 queries.
 *
 * Removes characters that have special meaning in FTS5 syntax while
 * preserving AND, OR, NOT as boolean operators when they appear
 * between search terms.
 */
export function sanitizeFtsInput(input: string): string {
  const tokens = input.split(/\s+/).filter(t => t.length > 0);
  if (tokens.length === 0) return '';

  if (containsBooleanOperators(tokens)) {
    // Boolean mode: narrow strip — preserve quotes and parens for phrase grouping
    return input.replace(/[{}[\]^~*:]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Standard mode: aggressive strip
  const cleaned = input
    .replace(/['"(){}[\]^~*:@#$%&+=<>|\\/.!?,;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const cleanTokens = cleaned.split(/\s+/).filter(t => t.length > 0 && !BOOLEAN_OPERATORS.has(t));
  return cleanTokens.join(' ');
}

/**
 * Build FTS5 query variants for a search term.
 *
 * When boolean operators (AND/OR/NOT) are detected, returns only the
 * sanitized input as a single variant — let FTS5 handle the boolean logic.
 *
 * Otherwise returns variants in specificity order (most specific first):
 * 1. Exact phrase match — `"term1 term2 term3"`
 * 2. AND — `term1 AND term2 AND term3`
 * 3. Prefix AND — `term1 AND term2 AND term3*`
 * 4. Stemmed prefix — `stem1* AND stem2* AND stem3*`
 * 5. OR — `term1 OR term2 OR term3`
 */
export function buildFtsQueryVariants(sanitized: string): string[] {
  if (!sanitized || sanitized.trim().length === 0) {
    return [];
  }

  const tokens = sanitized.split(/\s+/).filter(t => t.length > 0);
  if (tokens.length === 0) return [];

  // Boolean passthrough: return as single variant for FTS5 to handle
  if (containsBooleanOperators(tokens)) {
    return [sanitized];
  }

  const variants: string[] = [];

  // Tier 1: Exact phrase (multi-word only)
  if (tokens.length > 1) {
    variants.push(`"${tokens.join(' ')}"`);
  }

  // Tier 2: AND query
  variants.push(tokens.join(' AND '));

  // Tier 3: Prefix AND (wildcard on last term, or single term)
  const firstToken = tokens[0];
  const lastToken = tokens[tokens.length - 1];
  if (tokens.length === 1 && firstToken && firstToken.length >= 3) {
    variants.push(`${firstToken}*`);
  } else if (tokens.length > 1 && lastToken) {
    const prefixTerms = [...tokens.slice(0, -1), `${lastToken}*`];
    variants.push(prefixTerms.join(' AND '));
  }

  // Tier 4: Stemmed prefix (all terms stemmed with wildcards)
  const stemmed = tokens.map(t => stemWord(t) ?? `${t}*`);
  const stemmedQuery = stemmed.join(' AND ');
  // Only add if different from tier 3
  if (!variants.includes(stemmedQuery)) {
    variants.push(stemmedQuery);
  }

  // Tier 5: OR query (broadest FTS5 variant)
  if (tokens.length > 1) {
    variants.push(tokens.join(' OR '));
  }

  return variants;
}

/**
 * Build a SQL LIKE pattern from search terms.
 *
 * Produces `%term1%term2%...%` for use as a last-resort fallback
 * when all FTS5 variants return zero results.
 */
// ---------------------------------------------------------------------------
// Legacy compatibility — some repos call buildFtsQueryVariants expecting
// { primary: string; fallback?: string } instead of string[].
// The legacy wrapper delegates to the new tiered logic but returns the old shape.
// ---------------------------------------------------------------------------

export interface FtsQueryVariants {
  primary: string;
  fallback?: string | undefined;
  use_like?: boolean | undefined;
}

export function buildFtsQueryVariantsLegacy(query: string): FtsQueryVariants {
  const sanitized = sanitizeFtsInput(query);
  const variants = buildFtsQueryVariants(sanitized);
  if (variants.length === 0) return { primary: query, use_like: true };
  return {
    primary: variants[0] ?? query,
    fallback: variants.length > 1 ? variants[variants.length - 1] : undefined,
    use_like: true,
  };
}

export function buildLikePattern(input: string): string {
  const tokens = input
    .replace(/['"(){}[\]^~*:@#$%&+=<>|\\/.!?,;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(t => t.length > 0 && !BOOLEAN_OPERATORS.has(t));

  if (tokens.length === 0) return '%';
  return `%${tokens.join('%')}%`;
}

import type {
  CitationParseResult,
  CitationValidationResult,
  IngestionRequest,
  IngestionResult,
  LawDocument,
  SearchRequest,
  SearchResponse,
} from "./types.js";

interface RegexCitationOptions {
  pattern: RegExp;
  reason: string;
  normalize: (groups: Record<string, string>) => string;
}

interface StaticIngestionOptions {
  defaultSource: string;
  count: number;
}

export function searchDocumentsInMemory(
  documents: LawDocument[],
  request: SearchRequest,
): SearchResponse {
  const limit = clampLimit(request.limit ?? 20);
  const query = request.query.trim().toLowerCase();

  if (query.length === 0) {
    return { documents: [], total: 0 };
  }

  const matches = documents
    .filter((doc) => {
      const titleMatch = doc.title.toLowerCase().includes(query);
      const citationMatch = doc.citation?.toLowerCase().includes(query) ?? false;
      const snippetMatch = doc.textSnippet?.toLowerCase().includes(query) ?? false;
      const idMatch = doc.id.toLowerCase().includes(query);
      return titleMatch || citationMatch || snippetMatch || idMatch;
    })
    .slice(0, limit);

  return {
    documents: matches,
    total: matches.length,
  };
}

export function getDocumentFromMemory(
  documents: LawDocument[],
  id: string,
): LawDocument | null {
  return documents.find((doc) => doc.id === id) ?? null;
}

export function createRegexCitationHandlers(options: RegexCitationOptions): {
  parseCitation: (citation: string) => Promise<CitationParseResult | null>;
  validateCitation: (citation: string) => Promise<CitationValidationResult>;
} {
  const parseCitation = async (
    citation: string,
  ): Promise<CitationParseResult | null> => {
    const match = citation.trim().match(options.pattern);

    if (!match?.groups) {
      return null;
    }

    const groups = removeUndefinedValues(match.groups);

    if (Object.keys(groups).length === 0) {
      return null;
    }

    return {
      original: citation,
      normalized: options.normalize(groups),
      parsed: groups,
    };
  };

  const validateCitation = async (
    citation: string,
  ): Promise<CitationValidationResult> => {
    const parsed = await parseCitation(citation);

    if (!parsed) {
      return {
        valid: false,
        reason: options.reason,
      };
    }

    return {
      valid: true,
      normalized: parsed.normalized,
    };
  };

  return { parseCitation, validateCitation };
}

export function createStaticIngestionRunner(
  options: StaticIngestionOptions,
): (request: IngestionRequest) => Promise<IngestionResult> {
  return async (request: IngestionRequest): Promise<IngestionResult> => {
    const startedAt = new Date().toISOString();
    const sourceId = request.sourceId ?? options.defaultSource;
    const dryRun = request.dryRun ?? false;
    const ingestedCount = dryRun ? 0 : options.count;
    const skippedCount = dryRun ? options.count : 0;
    const finishedAt = new Date().toISOString();

    return {
      startedAt,
      finishedAt,
      sourceId,
      dryRun,
      ingestedCount,
      skippedCount,
    };
  };
}

function removeUndefinedValues(
  values: Record<string, string | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, string] =>
      typeof entry[1] === "string",
    ),
  );
}

function clampLimit(limit: number): number {
  if (limit < 1) {
    return 1;
  }

  if (limit > 100) {
    return 100;
  }

  return limit;
}

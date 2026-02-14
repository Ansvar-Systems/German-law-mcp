import { execFile } from "node:child_process";
import * as path from "node:path";
import { parseGermanCitation } from "../citation/german-citation.js";
import {
  citationExistsInGermanLawDatabase,
  getGermanCaseLawDocumentCount,
  getGermanDocumentByAnyId,
  getGermanLawDocumentsByCitation,
  getGermanLawDocumentsByStatuteId,
  getGermanLawDocumentById,
  getGermanLawDocumentCount,
  getGermanPreparatoryWorkCount,
  resolveGermanLawDatabasePath,
  searchGermanCaseLawDocuments,
  searchGermanLawDocuments,
  searchGermanPreparatoryWorks,
} from "../db/german-law-db.js";
import { GERMAN_LEGISLATION } from "../sample-data/de-legislation.js";
import {
  getDocumentFromMemory,
  searchDocumentsInMemory,
} from "../shell/adapter-kit.js";
import type {
  CountryAdapter,
  CitationFormatResult,
  EuBasisResponse,
  EuComplianceValidationResult,
  EuImplementationSearchResponse,
  EuReference,
  IngestionResult,
  LawDocument,
  SearchResponse,
} from "../shell/types.js";

type IngestionSourceId =
  | "gesetze-im-internet"
  | "rechtsprechung-im-internet"
  | "dip-bundestag";

const INGESTION_SCRIPTS: Record<IngestionSourceId, string> = {
  "gesetze-im-internet": path.resolve(
    process.cwd(),
    "scripts/ingest_gesetze_im_internet.py",
  ),
  "rechtsprechung-im-internet": path.resolve(
    process.cwd(),
    "scripts/ingest_rechtsprechung_im_internet.py",
  ),
  "dip-bundestag": path.resolve(process.cwd(), "scripts/ingest_dip_bundestag.py"),
};

const INGESTION_SOURCES: IngestionSourceId[] = [
  "gesetze-im-internet",
  "rechtsprechung-im-internet",
  "dip-bundestag",
];

export const germanyAdapter: CountryAdapter = {
  country: {
    code: "de",
    name: "Germany",
    defaultLanguage: "de",
    sources: [
      "gesetze-im-internet",
      "rechtsprechung-im-internet",
      "dip-bundestag",
    ],
  },
  capabilities: {
    documents: true,
    caseLaw: true,
    preparatoryWorks: true,
    citations: true,
    formatting: true,
    currency: true,
    legalStance: true,
    eu: true,
    ingestion: true,
  },
  async searchDocuments(request) {
    const dbSearch = searchGermanLawDocuments(request.query, request.limit ?? 20);
    if (dbSearch) {
      return dbSearch;
    }
    return searchDocumentsInMemory(GERMAN_LEGISLATION, request);
  },
  async searchCaseLaw(request) {
    const dbSearch = searchGermanCaseLawDocuments(request);
    if (dbSearch) {
      return dbSearch;
    }
    return { documents: [], total: 0 };
  },
  async getPreparatoryWorks(request) {
    const dbSearch = searchGermanPreparatoryWorks(request);
    if (dbSearch) {
      return dbSearch;
    }
    return { documents: [], total: 0 };
  },
  async getDocument(id) {
    const dbDocument = getGermanLawDocumentById(id);
    if (dbDocument !== undefined) {
      return dbDocument;
    }
    return getDocumentFromMemory(GERMAN_LEGISLATION, id);
  },
  async parseCitation(citation: string) {
    const parsed = parseGermanCitation(citation);
    if (!parsed) {
      return null;
    }

    return {
      original: citation,
      normalized: parsed.normalized,
      parsed: parsed.parsed,
    };
  },
  async validateCitation(citation: string) {
    const parsed = await this.parseCitation?.(citation);

    if (!parsed) {
      return {
        valid: false,
        reason:
          "Citation does not match supported German formats, for example '§ 823 Abs. 1 BGB' or 'Art. 1 Abs. 1 GG'.",
      };
    }

    const existsInDb = citationExistsInGermanLawDatabase(citation);
    if (existsInDb === false) {
      return {
        valid: false,
        normalized: parsed.normalized,
        reason:
          "Citation format is valid, but no matching provision was found in the current German law database.",
      };
    }

    return {
      valid: true,
      normalized: parsed.normalized,
    };
  },
  async formatCitation(request): Promise<CitationFormatResult> {
    const style = request.style ?? "default";
    const parsed = parseGermanCitation(request.citation);

    if (!parsed) {
      return {
        original: request.citation,
        formatted: request.citation.trim(),
        style,
        valid: false,
        reason:
          "Citation does not match supported German formats, for example '§ 823 Abs. 1 BGB' or 'Art. 1 Abs. 1 GG'.",
      };
    }

    const formatted = formatGermanCitationByStyle(parsed, style);
    return {
      original: request.citation,
      formatted,
      style,
      valid: true,
    };
  },
  async checkCurrency(request) {
    const documents = collectCurrencyDocuments(request);
    const statuteId = request.statuteId?.trim();
    const requestedCitation = request.citation?.trim();
    if (documents.dbUnavailable && documents.documents.length === 0) {
      return {
        status: "unknown",
        ...(statuteId ? { statuteId } : {}),
        ...(requestedCitation ? { citation: requestedCitation } : {}),
        ...(request.asOfDate ? { asOfDate: request.asOfDate } : {}),
        reason:
          "Current corpus database is unavailable; currency cannot be verified deterministically.",
      };
    }

    if (documents.documents.length === 0) {
      return {
        status: "not_found",
        ...(statuteId ? { statuteId } : {}),
        ...(requestedCitation ? { citation: requestedCitation } : {}),
        ...(request.asOfDate ? { asOfDate: request.asOfDate } : {}),
        reason: "No matching statute/provision found in the ingested corpus.",
      };
    }

    const sourceDate = newestDate(documents.documents.map((doc) => doc.effectiveDate));
    const asOfDate = normalizeIsoDate(request.asOfDate);
    if (asOfDate && sourceDate && asOfDate < sourceDate) {
      return {
        status: "unknown",
        ...(statuteId ? { statuteId } : {}),
        ...(requestedCitation ? { citation: requestedCitation } : {}),
        asOfDate,
        sourceDate,
        reason:
          "The corpus stores consolidated current text; historical in-force status before the known effective date is not guaranteed.",
        evidence: {
          matches: documents.documents.length,
        },
      };
    }

    return {
      status: "likely_in_force",
      ...(statuteId ? { statuteId } : {}),
      ...(requestedCitation ? { citation: requestedCitation } : {}),
      ...(asOfDate ? { asOfDate } : {}),
      ...(sourceDate ? { sourceDate } : {}),
      evidence: {
        matches: documents.documents.length,
        sampleDocumentId: documents.documents[0]?.id ?? null,
      },
    };
  },
  async buildLegalStance(request) {
    const limit = clampLimit(request.limit ?? 10, 1, 100);
    const statutesResult = await this.searchDocuments?.({
      query: request.query,
      limit,
    });
    const includeCaseLaw = request.includeCaseLaw ?? true;
    const includePreparatoryWorks = request.includePreparatoryWorks ?? true;

    const caseLawResult = includeCaseLaw
      ? await this.searchCaseLaw?.({ query: request.query, limit })
      : undefined;
    const preparatoryResult = includePreparatoryWorks
      ? await this.getPreparatoryWorks?.({ query: request.query, limit })
      : undefined;

    const statutes = statutesResult?.documents ?? [];
    const caseLaw = caseLawResult?.documents ?? [];
    const preparatoryWorks = preparatoryResult?.documents ?? [];
    const keyCitations = dedupeStrings(
      [...statutes, ...caseLaw, ...preparatoryWorks]
        .map((document) => document.citation ?? "")
        .filter(Boolean),
    ).slice(0, limit * 2);

    return {
      query: request.query,
      statutes,
      caseLaw,
      preparatoryWorks,
      keyCitations,
    };
  },
  async getEuBasis(request): Promise<EuBasisResponse> {
    const limit = clampLimit(request.limit ?? 40, 1, 200);
    const { documents } = collectEuBasisDocuments(request, limit * 8);
    const references = extractEuReferencesFromDocuments(documents, limit * 8);

    return {
      references: references.slice(0, limit),
      total: references.length,
    };
  },
  async searchEuImplementations(
    request,
  ): Promise<EuImplementationSearchResponse> {
    const limit = clampLimit(request.limit ?? 20, 1, 200);
    const documents = await collectDocumentsForEuSearch(
      this,
      request.query,
      Math.max(limit * 8, 120),
    );
    const references = extractEuReferencesFromDocuments(documents, limit * 24);
    const summaries = summarizeEuImplementations(references);

    return {
      results: summaries.slice(0, limit),
      total: summaries.length,
    };
  },
  async getNationalImplementations(
    request,
  ): Promise<EuImplementationSearchResponse> {
    const limit = clampLimit(request.limit ?? 20, 1, 200);
    const documents = await collectDocumentsForEuSearch(
      this,
      request.euId,
      Math.max(limit * 10, 150),
    );
    const normalizedTarget = normalizeEuIdentifier(request.euId);
    const filteredReferences = extractEuReferencesFromDocuments(
      documents,
      limit * 24,
    ).filter((reference) =>
      euIdentifiersMatch(reference.euId, normalizedTarget),
    );
    const summaries = summarizeEuImplementations(filteredReferences);

    return {
      results: summaries.slice(0, limit),
      total: summaries.length,
    };
  },
  async getProvisionEuBasis(request): Promise<EuBasisResponse> {
    return this.getEuBasis!({
      documentId: request.documentId,
      ...(request.limit === undefined ? {} : { limit: request.limit }),
    });
  },
  async validateEuCompliance(
    request,
  ): Promise<EuComplianceValidationResult> {
    const normalizedTarget = normalizeEuIdentifier(request.euId);
    const dbAvailable = getGermanLawDocumentCount() !== null;

    if (request.citation || request.statuteId) {
      const basis = await this.getEuBasis!({
        ...(request.citation ? { citation: request.citation } : {}),
        ...(request.statuteId ? { statuteId: request.statuteId } : {}),
        limit: 200,
      });
      const matches = basis.references.filter((reference) =>
        euIdentifiersMatch(reference.euId, normalizedTarget),
      );
      const relatedStatutes = dedupeStrings(
        matches.map((reference) => reference.sourceStatuteId ?? ""),
      );

      if (matches.length > 0) {
        return {
          euId: request.euId,
          status: "mapped",
          matches: matches.length,
          relatedStatutes,
        };
      }

      return {
        euId: request.euId,
        status: dbAvailable ? "not_mapped" : "unknown",
        matches: 0,
        relatedStatutes: [],
        reason: dbAvailable
          ? "No linkage between requested EU act and selected national provision was found."
          : "Current corpus database is unavailable; compliance mapping is uncertain.",
      };
    }

    const implementations = await this.getNationalImplementations!({
      euId: request.euId,
      limit: 200,
    });
    const matchCount = implementations.results.reduce(
      (total, item) => total + item.implementationCount,
      0,
    );
    const relatedStatutes = dedupeStrings(
      implementations.results.flatMap((item) => item.statutes),
    );

    if (matchCount > 0) {
      return {
        euId: request.euId,
        status: "mapped",
        matches: matchCount,
        relatedStatutes,
      };
    }

    return {
      euId: request.euId,
      status: dbAvailable ? "not_mapped" : "unknown",
      matches: 0,
      relatedStatutes: [],
      reason: dbAvailable
        ? "No mapped national implementations were found for the requested EU act."
        : "Current corpus database is unavailable; compliance mapping is uncertain.",
    };
  },
  async runIngestion(request): Promise<IngestionResult> {
    const requestedSource = normalizeSourceId(request.sourceId);
    const sources = requestedSource === "all" ? INGESTION_SOURCES : [requestedSource];
    const startedAt = new Date().toISOString();
    let totalIngested = 0;
    let totalSkipped = 0;
    let hadSuccessfulRun = false;

    for (const source of sources) {
      const args = buildIngestionArgs(source, request.dryRun ?? false);
      const report = await executeIngestionScript(args).catch(() => null);
      if (!report) {
        if (request.dryRun) {
          totalSkipped += getCurrentSourceCount(source);
        }
        continue;
      }

      hadSuccessfulRun = true;
      if (request.dryRun) {
        const selectedCount = extractDryRunSelectedCount(report);
        totalSkipped += selectedCount > 0 ? selectedCount : getCurrentSourceCount(source);
      } else {
        totalIngested += extractIngestedCount(report);
        totalSkipped += extractSkippedCount(report);
      }
    }

    if (!hadSuccessfulRun && !request.dryRun) {
      const currentCount = getGermanLawDocumentCount() ?? 0;
      totalSkipped += currentCount;
    }

    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      sourceId: request.sourceId ?? "gesetze-im-internet",
      dryRun: request.dryRun ?? false,
      ingestedCount: totalIngested,
      skippedCount: totalSkipped,
    };
  },
};

const EU_TYPED_PREFIX_PATTERN =
  /\b(?<type>Richtlinie|Directive|Verordnung|Regulation)\s*(?:\((?<jur1>EU|EG|EWG)\)|(?<jur2>EU|EG|EWG))\s*(?:Nr\.?\s*)?(?<num>\d{2,4}\/\d{2,4})\b/giu;
const EU_TYPED_SUFFIX_PATTERN =
  /\b(?<type>Richtlinie|Directive|Verordnung|Regulation)\s*(?<num>\d{2,4}\/\d{2,4})\/(?<jur>EU|EG|EWG)\b/giu;
const EU_GENERIC_PREFIX_PATTERN =
  /\b(?<jur>EU|EG|EWG)\s*(?:Nr\.?\s*)?(?<num>\d{2,4}\/\d{2,4})\b/giu;
const EU_GENERIC_SUFFIX_PATTERN =
  /\b(?<num>\d{2,4}\/\d{2,4})\/(?<jur>EU|EG|EWG)\b/giu;
const CELEX_PATTERN = /\b(?:CELEX[:\s]*)?(?<celex>3\d{4}[A-Z]\d{4})\b/giu;

interface ExtractedEuAct {
  euId: string;
  euType: string;
  contextSnippet?: string;
  confidence: number;
}

interface CurrencyDocumentCollection {
  documents: LawDocument[];
  dbUnavailable: boolean;
}

interface EuBasisCollection {
  documents: LawDocument[];
  dbUnavailable: boolean;
}

function collectCurrencyDocuments(request: {
  citation?: string;
  statuteId?: string;
}): CurrencyDocumentCollection {
  const documents: LawDocument[] = [];
  let dbUnavailable = false;

  const statuteId = request.statuteId?.trim();
  if (statuteId) {
    const byStatute = getGermanLawDocumentsByStatuteId(statuteId, 120);
    if (byStatute === null) {
      dbUnavailable = true;
    } else {
      documents.push(...byStatute.documents);
    }
  }

  const citation = request.citation?.trim();
  if (citation) {
    const byCitation = getGermanLawDocumentsByCitation(citation, 80);
    if (byCitation === null) {
      dbUnavailable = true;
      const fallback = searchDocumentsInMemory(GERMAN_LEGISLATION, {
        query: citation,
        limit: 20,
      });
      documents.push(...fallback.documents);
    } else {
      documents.push(...byCitation.documents);
    }
  }

  return {
    documents: uniqueDocuments(documents),
    dbUnavailable,
  };
}

function collectEuBasisDocuments(
  request: {
    citation?: string;
    statuteId?: string;
    documentId?: string;
  },
  maxDocuments: number,
): EuBasisCollection {
  const documents: LawDocument[] = [];
  let dbUnavailable = false;

  const documentId = request.documentId?.trim();
  if (documentId) {
    const byId = getGermanDocumentByAnyId(documentId);
    if (byId === undefined) {
      dbUnavailable = true;
    } else if (byId) {
      documents.push(byId);
    }

    const memoryDocument = getDocumentFromMemory(GERMAN_LEGISLATION, documentId);
    if (memoryDocument) {
      documents.push(memoryDocument);
    }
  }

  const statuteId = request.statuteId?.trim();
  if (statuteId) {
    const byStatute = getGermanLawDocumentsByStatuteId(statuteId, maxDocuments);
    if (byStatute === null) {
      dbUnavailable = true;
    } else {
      documents.push(...byStatute.documents);
    }
  }

  const citation = request.citation?.trim();
  if (citation) {
    const byCitation = getGermanLawDocumentsByCitation(citation, maxDocuments);
    if (byCitation === null) {
      dbUnavailable = true;
      const fallback = searchDocumentsInMemory(GERMAN_LEGISLATION, {
        query: citation,
        limit: Math.min(maxDocuments, 20),
      });
      documents.push(...fallback.documents);
    } else {
      documents.push(...byCitation.documents);
    }
  }

  return {
    documents: uniqueDocuments(documents).slice(0, maxDocuments),
    dbUnavailable,
  };
}

async function collectDocumentsForEuSearch(
  adapter: CountryAdapter,
  query: string,
  maxDocuments: number,
): Promise<LawDocument[]> {
  const statuteLimit = clampLimit(maxDocuments, 1, 200);
  const secondaryLimit = clampLimit(Math.ceil(maxDocuments / 2), 1, 200);

  const statutes = (
    (await adapter.searchDocuments?.({ query, limit: statuteLimit })) ?? {
      documents: [],
    }
  ).documents;
  const caseLaw = (
    (await adapter.searchCaseLaw?.({ query, limit: secondaryLimit })) ?? {
      documents: [],
    }
  ).documents;
  const preparatoryWorks = (
    (await adapter.getPreparatoryWorks?.({ query, limit: secondaryLimit })) ?? {
      documents: [],
    }
  ).documents;

  return uniqueDocuments([...statutes, ...caseLaw, ...preparatoryWorks]).slice(
    0,
    maxDocuments,
  );
}

function extractEuReferencesFromDocuments(
  documents: LawDocument[],
  maxReferences: number,
): EuReference[] {
  const references: EuReference[] = [];
  const seen = new Set<string>();
  const clampedLimit = clampLimit(maxReferences, 1, 5000);

  for (const document of documents) {
    const extracted = extractEuActsFromText(buildDocumentEuSearchText(document));
    const sourceStatuteId = resolveSourceStatuteId(document);
    for (const euAct of extracted) {
      const key = `${normalizeEuIdentifier(euAct.euId)}|${document.id}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      references.push({
        euId: euAct.euId,
        euType: euAct.euType,
        sourceKind: document.kind,
        sourceId: document.id,
        ...(sourceStatuteId ? { sourceStatuteId } : {}),
        ...(document.citation ? { sourceCitation: document.citation } : {}),
        ...(document.title ? { sourceTitle: document.title } : {}),
        ...(document.sourceUrl ? { sourceUrl: document.sourceUrl } : {}),
        ...(euAct.contextSnippet ? { contextSnippet: euAct.contextSnippet } : {}),
        confidence: euAct.confidence,
      });

      if (references.length >= clampedLimit) {
        return references;
      }
    }
  }

  return references;
}

function summarizeEuImplementations(
  references: EuReference[],
): EuImplementationSearchResponse["results"] {
  const grouped = new Map<
    string,
    {
      euId: string;
      euType: string;
      sources: Set<string>;
      statutes: Set<string>;
    }
  >();

  for (const reference of references) {
    const normalizedId = normalizeEuIdentifier(reference.euId);
    const key = `${normalizedId}|${reference.euType.toLowerCase()}`;
    const current = grouped.get(key) ?? {
      euId: normalizedId,
      euType: reference.euType,
      sources: new Set<string>(),
      statutes: new Set<string>(),
    };
    current.sources.add(reference.sourceId);
    if (reference.sourceStatuteId) {
      current.statutes.add(reference.sourceStatuteId);
    }
    grouped.set(key, current);
  }

  return [...grouped.values()]
    .map((entry) => ({
      euId: entry.euId,
      euType: entry.euType,
      implementationCount: entry.sources.size,
      statutes: [...entry.statutes].sort((a, b) => a.localeCompare(b)),
    }))
    .sort((left, right) => {
      if (right.implementationCount !== left.implementationCount) {
        return right.implementationCount - left.implementationCount;
      }
      return left.euId.localeCompare(right.euId);
    });
}

function extractEuActsFromText(content: string): ExtractedEuAct[] {
  const trimmed = collapseWhitespace(content);
  if (!trimmed) {
    return [];
  }

  const found = new Map<string, ExtractedEuAct>();
  const addAct = (
    euId: string,
    euType: string,
    confidence: number,
    index: number,
    rawMatch: string,
  ): void => {
    const normalizedId = normalizeEuIdentifier(euId);
    const key = `${normalizedId}|${euType.toLowerCase()}`;
    const current = found.get(key);
    if (current && current.confidence >= confidence) {
      return;
    }

    found.set(key, {
      euId: normalizedId,
      euType,
      confidence,
      contextSnippet: buildContextSnippet(trimmed, index, rawMatch.length),
    });
  };

  for (const match of trimmed.matchAll(CELEX_PATTERN)) {
    const celex = match.groups?.celex;
    if (!celex) {
      continue;
    }
    const parsed = parseCelex(celex);
    if (!parsed) {
      continue;
    }
    addAct(parsed.euId, parsed.euType, 0.99, match.index ?? 0, match[0]);
  }

  for (const match of trimmed.matchAll(EU_TYPED_PREFIX_PATTERN)) {
    const type = match.groups?.type;
    const num = match.groups?.num;
    const jurisdiction = match.groups?.jur1 ?? match.groups?.jur2;
    if (!type || !num || !jurisdiction) {
      continue;
    }
    addAct(
      normalizeEuIdParts(jurisdiction, num),
      normalizeEuType(type),
      0.95,
      match.index ?? 0,
      match[0],
    );
  }

  for (const match of trimmed.matchAll(EU_TYPED_SUFFIX_PATTERN)) {
    const type = match.groups?.type;
    const num = match.groups?.num;
    const jurisdiction = match.groups?.jur;
    if (!type || !num || !jurisdiction) {
      continue;
    }
    addAct(
      normalizeEuIdParts(jurisdiction, num),
      normalizeEuType(type),
      0.94,
      match.index ?? 0,
      match[0],
    );
  }

  for (const match of trimmed.matchAll(EU_GENERIC_PREFIX_PATTERN)) {
    const jurisdiction = match.groups?.jur;
    const num = match.groups?.num;
    if (!jurisdiction || !num) {
      continue;
    }
    addAct(
      normalizeEuIdParts(jurisdiction, num),
      "act",
      0.9,
      match.index ?? 0,
      match[0],
    );
  }

  for (const match of trimmed.matchAll(EU_GENERIC_SUFFIX_PATTERN)) {
    const jurisdiction = match.groups?.jur;
    const num = match.groups?.num;
    if (!jurisdiction || !num) {
      continue;
    }
    addAct(
      normalizeEuIdParts(jurisdiction, num),
      "act",
      0.89,
      match.index ?? 0,
      match[0],
    );
  }

  return [...found.values()].sort((left, right) => {
    if (right.confidence !== left.confidence) {
      return right.confidence - left.confidence;
    }
    return left.euId.localeCompare(right.euId);
  });
}

function buildDocumentEuSearchText(document: LawDocument): string {
  const metadataValues = document.metadata
    ? Object.values(document.metadata)
        .filter((value): value is string | number | boolean => value !== null)
        .map((value) => String(value))
    : [];
  return [
    document.title,
    document.citation ?? "",
    document.textSnippet ?? "",
    metadataValues.join(" "),
  ]
    .filter(Boolean)
    .join(" ");
}

function resolveSourceStatuteId(document: LawDocument): string | undefined {
  const metadataStatuteId = metadataStringValue(document, "statute_id");
  if (metadataStatuteId) {
    return metadataStatuteId;
  }

  if (document.kind === "statute" || document.kind === "regulation") {
    const separator = document.id.indexOf(":");
    if (separator > 0) {
      return document.id.slice(0, separator);
    }
  }

  return undefined;
}

function metadataStringValue(
  document: LawDocument,
  key: string,
): string | undefined {
  const value = document.metadata?.[key];
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return undefined;
}

function normalizeEuType(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "richtlinie" || normalized === "directive") {
    return "directive";
  }
  if (normalized === "verordnung" || normalized === "regulation") {
    return "regulation";
  }
  return "act";
}

function normalizeEuIdParts(jurisdiction: string, numberExpression: string): string {
  const [yearRaw, numberRaw] = numberExpression.split("/");
  const year = yearRaw?.trim() ?? "";
  const numberToken = numberRaw?.trim() ?? "";
  const numericPart = Number.parseInt(numberToken, 10);
  const number =
    Number.isFinite(numericPart) && !Number.isNaN(numericPart)
      ? String(numericPart)
      : numberToken;

  return `${jurisdiction.trim().toUpperCase()} ${year}/${number}`.trim();
}

function normalizeEuIdentifier(input: string): string {
  const trimmed = collapseWhitespace(input).toUpperCase();
  if (!trimmed) {
    return "";
  }

  const celexInput = trimmed.replace(/^CELEX[:\s]*/i, "");
  const celex = parseCelex(celexInput);
  if (celex) {
    return celex.euId;
  }

  const prefixMatch = trimmed.match(
    /^(EU|EG|EWG)\s*(?:NR\.?\s*)?(\d{2,4})\/(\d{2,4})$/,
  );
  if (prefixMatch) {
    return normalizeEuIdParts(
      prefixMatch[1] ?? "EU",
      `${prefixMatch[2] ?? ""}/${prefixMatch[3] ?? ""}`,
    );
  }

  const suffixMatch = trimmed.match(/^(\d{2,4})\/(\d{2,4})\/(EU|EG|EWG)$/);
  if (suffixMatch) {
    return normalizeEuIdParts(
      suffixMatch[3] ?? "EU",
      `${suffixMatch[1] ?? ""}/${suffixMatch[2] ?? ""}`,
    );
  }

  return trimmed;
}

function euIdentifiersMatch(candidate: string, targetNormalized: string): boolean {
  const candidateNormalized = normalizeEuIdentifier(candidate);
  if (candidateNormalized === targetNormalized) {
    return true;
  }

  const candidateWithoutJurisdiction = candidateNormalized.replace(
    /^(EU|EG|EWG)\s+/,
    "",
  );
  const targetWithoutJurisdiction = targetNormalized.replace(
    /^(EU|EG|EWG)\s+/,
    "",
  );
  return candidateWithoutJurisdiction === targetWithoutJurisdiction;
}

function parseCelex(input: string): { euId: string; euType: string } | null {
  const normalized = input.trim().toUpperCase();
  if (!/^3\d{4}[A-Z]\d{4}$/.test(normalized)) {
    return null;
  }

  const year = normalized.slice(1, 5);
  const typeMarker = normalized.slice(5, 6);
  const rawNumber = normalized.slice(6);
  const parsedNumber = Number.parseInt(rawNumber, 10);
  if (!Number.isFinite(parsedNumber) || Number.isNaN(parsedNumber)) {
    return null;
  }

  const euType =
    typeMarker === "R"
      ? "regulation"
      : typeMarker === "L"
        ? "directive"
        : typeMarker === "D"
          ? "decision"
          : "act";

  return {
    euId: `EU ${year}/${parsedNumber}`,
    euType,
  };
}

function buildContextSnippet(
  content: string,
  index: number,
  length: number,
): string {
  const start = Math.max(0, index - 90);
  const end = Math.min(content.length, index + length + 90);
  return collapseWhitespace(content.slice(start, end));
}

function formatGermanCitationByStyle(
  parsed: NonNullable<ReturnType<typeof parseGermanCitation>>,
  style: "default" | "short" | "pinpoint",
): string {
  if (style === "default" || style === "pinpoint") {
    return parsed.normalized;
  }

  if (parsed.type === "paragraph") {
    const section = parsed.parsed.section ?? "";
    const code = parsed.parsed.code ?? "";
    return collapseWhitespace(`§ ${section} ${code}`);
  }

  const article = parsed.parsed.article ?? "";
  const code = parsed.parsed.code ?? "";
  return collapseWhitespace(`Art. ${article} ${code}`);
}

function uniqueDocuments(documents: LawDocument[]): LawDocument[] {
  const seen = new Set<string>();
  const deduped: LawDocument[] = [];
  for (const document of documents) {
    if (seen.has(document.id)) {
      continue;
    }
    seen.add(document.id);
    deduped.push(document);
  }
  return deduped;
}

function newestDate(values: Array<string | undefined>): string | undefined {
  const validDates = values
    .map((value) => normalizeIsoDate(value))
    .filter((value): value is string => value !== undefined)
    .sort((left, right) => left.localeCompare(right));
  return validDates.at(-1);
}

function normalizeIsoDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function clampLimit(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || Number.isNaN(value)) {
    return min;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return Math.trunc(value);
}

function buildIngestionArgs(
  sourceId: IngestionSourceId,
  dryRun: boolean,
): string[] {
  const args = [
    INGESTION_SCRIPTS[sourceId],
    "--db-path",
    resolveGermanLawDatabasePath(),
  ];

  if (dryRun) {
    args.push("--dry-run");
  } else {
    args.push("--only-missing", "--quiet");
  }

  if (sourceId === "gesetze-im-internet") {
    const maxLaws = process.env.GERMAN_LAW_INGEST_MAX_LAWS?.trim();
    if (maxLaws) {
      args.push("--max-laws", maxLaws);
    }
  }

  if (sourceId === "rechtsprechung-im-internet") {
    const maxCases = process.env.GERMAN_LAW_INGEST_MAX_CASES?.trim();
    if (maxCases) {
      args.push("--max-cases", maxCases);
    }

    const stopAfterExisting = process.env.GERMAN_LAW_INGEST_CASES_STOP_AFTER_EXISTING?.trim();
    if (stopAfterExisting) {
      args.push("--stop-after-existing", stopAfterExisting);
    }
  }

  if (sourceId === "dip-bundestag") {
    const maxDocuments = process.env.GERMAN_LAW_INGEST_MAX_PREP_WORKS?.trim();
    if (maxDocuments) {
      args.push("--max-documents", maxDocuments);
    }

    const stopAfterExisting = process.env.GERMAN_LAW_INGEST_PREP_STOP_AFTER_EXISTING?.trim();
    if (stopAfterExisting) {
      args.push("--stop-after-existing", stopAfterExisting);
    }

    const apiKey = process.env.GERMAN_LAW_DIP_API_KEY?.trim();
    if (apiKey) {
      args.push("--api-key", apiKey);
    }

    const wahlperioden = process.env.GERMAN_LAW_PREP_WAHLPERIODEN
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    for (const period of wahlperioden ?? []) {
      args.push("--wahlperiode", period);
    }
  }

  return args;
}

function normalizeSourceId(sourceId?: string): IngestionSourceId | "all" {
  if (!sourceId) {
    return "gesetze-im-internet";
  }

  const normalized = sourceId.trim().toLowerCase();
  if (normalized === "all") {
    return "all";
  }
  if (
    normalized === "gesetze-im-internet" ||
    normalized === "rechtsprechung-im-internet" ||
    normalized === "dip-bundestag"
  ) {
    return normalized;
  }

  return "gesetze-im-internet";
}

interface IngestionScriptReport {
  started_at?: string;
  finished_at?: string;
  status?: string;
  error?: string;
  selected_laws?: number;
  selected_cases?: number;
  selected_documents?: number;
  ingested_sections?: number;
  skipped_sections?: number;
  ingested_count?: number;
  skipped_count?: number;
  ingested_cases?: number;
  skipped_cases?: number;
  ingested_documents?: number;
  skipped_documents?: number;
}

function extractIngestedCount(report: IngestionScriptReport): number {
  return Number(
    report.ingested_count ??
      report.ingested_sections ??
      report.ingested_cases ??
      report.ingested_documents ??
      0,
  );
}

function getCurrentSourceCount(sourceId: IngestionSourceId): number {
  if (sourceId === "gesetze-im-internet") {
    return getGermanLawDocumentCount() ?? 0;
  }
  if (sourceId === "rechtsprechung-im-internet") {
    return getGermanCaseLawDocumentCount() ?? 0;
  }
  return getGermanPreparatoryWorkCount() ?? 0;
}

function extractDryRunSelectedCount(report: IngestionScriptReport): number {
  return Number(
    report.selected_laws ?? report.selected_cases ?? report.selected_documents ?? 0,
  );
}

function extractSkippedCount(report: IngestionScriptReport): number {
  return Number(
    report.skipped_count ??
      report.skipped_sections ??
      report.skipped_cases ??
      report.skipped_documents ??
      0,
  );
}

async function executeIngestionScript(args: string[]): Promise<IngestionScriptReport> {
  const output = await new Promise<{ stdout: string; stderr: string }>(
    (resolve, reject) => {
      execFile(
        "python3",
        args,
        { maxBuffer: 32 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            reject(
              new Error(
                `German ingestion script failed: ${stderr || stdout || error.message}`,
              ),
            );
            return;
          }
          resolve({ stdout, stderr });
        },
      );
    },
  );

  const lines = output.stdout
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const lastLine = lines.at(-1);
  if (!lastLine) {
    return {};
  }

  try {
    return JSON.parse(lastLine) as IngestionScriptReport;
  } catch {
    return {};
  }
}

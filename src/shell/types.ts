export type CountryCode = string;

export type ToolName =
  | "law_list_countries"
  | "law_describe_country"
  | "law_search_documents"
  | "law_search_case_law"
  | "law_get_preparatory_works"
  | "law_format_citation"
  | "law_check_currency"
  | "law_build_legal_stance"
  | "law_get_eu_basis"
  | "law_search_eu_implementations"
  | "law_get_national_implementations"
  | "law_get_provision_eu_basis"
  | "law_validate_eu_compliance"
  | "law_get_document"
  | "law_parse_citation"
  | "law_validate_citation"
  | "law_list_sources"
  | "law_about"
  | "law_run_ingestion";

export interface CountryDescriptor {
  code: CountryCode;
  name: string;
  defaultLanguage: string;
  sources: string[];
}

export type DocumentKind =
  | "statute"
  | "regulation"
  | "case"
  | "preparatory_work"
  | "other";

export interface LawDocument {
  id: string;
  country: CountryCode;
  kind: DocumentKind;
  title: string;
  citation?: string;
  sourceUrl?: string;
  effectiveDate?: string;
  textSnippet?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface SearchRequest {
  query: string;
  limit?: number;
}

export interface SearchResponse {
  documents: LawDocument[];
  total: number;
}

export interface CaseLawSearchRequest extends SearchRequest {
  court?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface PreparatoryWorksRequest {
  citation?: string;
  statuteId?: string;
  query?: string;
  limit?: number;
}

export type CitationFormatStyle = "default" | "short" | "pinpoint";

export interface CitationFormatRequest {
  citation: string;
  style?: CitationFormatStyle;
}

export interface CitationFormatResult {
  original: string;
  formatted: string;
  style: CitationFormatStyle;
  valid: boolean;
  reason?: string;
}

export interface CurrencyCheckRequest {
  citation?: string;
  statuteId?: string;
  asOfDate?: string;
}

export interface CurrencyCheckResult {
  status: "likely_in_force" | "not_found" | "unknown";
  statuteId?: string;
  citation?: string;
  asOfDate?: string;
  sourceDate?: string;
  reason?: string;
  evidence?: Record<string, string | number | boolean | null>;
}

export interface LegalStanceRequest {
  query: string;
  limit?: number;
  includeCaseLaw?: boolean;
  includePreparatoryWorks?: boolean;
}

export interface LegalStanceResult {
  query: string;
  statutes: LawDocument[];
  caseLaw: LawDocument[];
  preparatoryWorks: LawDocument[];
  keyCitations: string[];
}

export interface EuBasisRequest {
  citation?: string;
  statuteId?: string;
  documentId?: string;
  limit?: number;
}

export interface EuImplementationSearchRequest {
  query: string;
  limit?: number;
}

export interface EuNationalImplementationsRequest {
  euId: string;
  limit?: number;
}

export interface EuComplianceValidationRequest {
  euId: string;
  citation?: string;
  statuteId?: string;
}

export interface EuReference {
  euId: string;
  euType: string;
  sourceKind: string;
  sourceId: string;
  sourceStatuteId?: string;
  sourceCitation?: string;
  sourceTitle?: string;
  sourceUrl?: string;
  contextSnippet?: string;
  confidence?: number;
}

export interface EuBasisResponse {
  references: EuReference[];
  total: number;
}

export interface EuImplementationSummary {
  euId: string;
  euType: string;
  implementationCount: number;
  statutes: string[];
}

export interface EuImplementationSearchResponse {
  results: EuImplementationSummary[];
  total: number;
}

export interface EuComplianceValidationResult {
  euId: string;
  status: "mapped" | "not_mapped" | "unknown";
  matches: number;
  relatedStatutes: string[];
  reason?: string;
}

export interface CitationParseResult {
  original: string;
  normalized: string;
  parsed: Record<string, string>;
}

export interface CitationValidationResult {
  valid: boolean;
  normalized?: string;
  reason?: string;
}

export interface IngestionRequest {
  sourceId?: string;
  dryRun?: boolean;
}

export interface IngestionResult {
  startedAt: string;
  finishedAt: string;
  sourceId: string;
  dryRun: boolean;
  ingestedCount: number;
  skippedCount: number;
}

export interface CountryAdapter {
  country: CountryDescriptor;
  capabilities: {
    documents: boolean;
    caseLaw: boolean;
    preparatoryWorks: boolean;
    citations: boolean;
    formatting: boolean;
    currency: boolean;
    legalStance: boolean;
    eu: boolean;
    ingestion: boolean;
  };
  /**
   * Optional runtime capability detection. Returns the set of DB-level
   * capabilities actually available (e.g. tables present). When provided,
   * the shell uses this to gate tools that require professional-tier data
   * and return a clear upgrade message instead of empty results.
   */
  getDbCapabilities?(): ReadonlySet<string>;
  searchDocuments?(request: SearchRequest): Promise<SearchResponse>;
  searchCaseLaw?(request: CaseLawSearchRequest): Promise<SearchResponse>;
  getPreparatoryWorks?(request: PreparatoryWorksRequest): Promise<SearchResponse>;
  formatCitation?(request: CitationFormatRequest): Promise<CitationFormatResult>;
  checkCurrency?(request: CurrencyCheckRequest): Promise<CurrencyCheckResult>;
  buildLegalStance?(request: LegalStanceRequest): Promise<LegalStanceResult>;
  getEuBasis?(request: EuBasisRequest): Promise<EuBasisResponse>;
  searchEuImplementations?(
    request: EuImplementationSearchRequest,
  ): Promise<EuImplementationSearchResponse>;
  getNationalImplementations?(
    request: EuNationalImplementationsRequest,
  ): Promise<EuImplementationSearchResponse>;
  getProvisionEuBasis?(request: { documentId: string; limit?: number }): Promise<EuBasisResponse>;
  validateEuCompliance?(
    request: EuComplianceValidationRequest,
  ): Promise<EuComplianceValidationResult>;
  getDocument?(id: string): Promise<LawDocument | null>;
  parseCitation?(citation: string): Promise<CitationParseResult | null>;
  validateCitation?(citation: string): Promise<CitationValidationResult>;
  runIngestion?(request: IngestionRequest): Promise<IngestionResult>;
}

export interface ToolCall {
  name: ToolName;
  arguments?: Record<string, unknown>;
}

export interface ToolResult {
  tool: ToolName;
  ok: boolean;
  data?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface ToolDefinition {
  name: ToolName;
  description: string;
  inputSchema: Record<string, unknown>;
}

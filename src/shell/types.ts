export type CountryCode = string;

export type ToolName =
  | "law.list_countries"
  | "law.describe_country"
  | "law.search_documents"
  | "law.search_case_law"
  | "law.get_preparatory_works"
  | "law.format_citation"
  | "law.check_currency"
  | "law.build_legal_stance"
  | "law.get_eu_basis"
  | "law.search_eu_implementations"
  | "law.get_national_implementations"
  | "law.get_provision_eu_basis"
  | "law.validate_eu_compliance"
  | "law.get_document"
  | "law.parse_citation"
  | "law.validate_citation"
  | "law.run_ingestion";

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

import { AdapterRegistry } from "./adapter-registry.js";
import { ShellError, toShellError } from "./errors.js";
import { TOOL_DEFINITIONS } from "./tool-contract.js";
import type {
  CaseLawSearchRequest,
  CitationFormatRequest,
  CountryAdapter,
  CurrencyCheckRequest,
  EuBasisRequest,
  EuComplianceValidationRequest,
  EuImplementationSearchRequest,
  EuNationalImplementationsRequest,
  IngestionRequest,
  LegalStanceRequest,
  PreparatoryWorksRequest,
  SearchRequest,
  ToolCall,
  ToolDefinition,
  ToolName,
  ToolResult,
} from "./types.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

export class LawMcpShell {
  private readonly handlers: Record<ToolName, ToolHandler>;

  constructor(private readonly registry: AdapterRegistry) {
    this.handlers = {
      "law_list_countries": this.listCountries.bind(this),
      "law_describe_country": this.describeCountry.bind(this),
      "law_search_documents": this.searchDocuments.bind(this),
      "law_search_case_law": this.searchCaseLaw.bind(this),
      "law_get_preparatory_works": this.getPreparatoryWorks.bind(this),
      "law_format_citation": this.formatCitation.bind(this),
      "law_check_currency": this.checkCurrency.bind(this),
      "law_build_legal_stance": this.buildLegalStance.bind(this),
      "law_get_eu_basis": this.getEuBasis.bind(this),
      "law_search_eu_implementations": this.searchEuImplementations.bind(this),
      "law_get_national_implementations": this.getNationalImplementations.bind(this),
      "law_get_provision_eu_basis": this.getProvisionEuBasis.bind(this),
      "law_validate_eu_compliance": this.validateEuCompliance.bind(this),
      "law_get_document": this.getDocument.bind(this),
      "law_parse_citation": this.parseCitation.bind(this),
      "law_validate_citation": this.validateCitation.bind(this),
      "law_run_ingestion": this.runIngestion.bind(this),
    };
  }

  static fromAdapters(adapters: CountryAdapter[]): LawMcpShell {
    const registry = new AdapterRegistry();
    registry.registerMany(adapters);
    return new LawMcpShell(registry);
  }

  getToolDefinitions(): ToolDefinition[] {
    return TOOL_DEFINITIONS;
  }

  async handleToolCall(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments ?? {};

    try {
      const handler = this.handlers[call.name];
      const data = await handler(args);

      return {
        tool: call.name,
        ok: true,
        data,
      };
    } catch (error) {
      const normalizedError = toShellError(error);
      return {
        tool: call.name,
        ok: false,
        error: {
          code: normalizedError.code,
          message: normalizedError.message,
          details: normalizedError.details,
        },
      };
    }
  }

  private async listCountries(): Promise<unknown> {
    return this.registry.list().map((adapter) => ({
      country: adapter.country,
      capabilities: adapter.capabilities,
    }));
  }

  private async describeCountry(args: Record<string, unknown>): Promise<unknown> {
    const countryCode = requireString(args, "country");
    const adapter = this.registry.get(countryCode);

    return {
      country: adapter.country,
      capabilities: adapter.capabilities,
      tools: this.countryToolSupport(adapter),
    };
  }

  private async searchDocuments(args: Record<string, unknown>): Promise<unknown> {
    const adapter = this.requireDocumentsAdapter(args);
    const query = requireString(args, "query");
    const limit = optionalNumber(args, "limit");
    const request: SearchRequest =
      limit === undefined ? { query } : { query, limit };

    return adapter.searchDocuments!(request);
  }

  private async getDocument(args: Record<string, unknown>): Promise<unknown> {
    const adapter = this.requireDocumentsAdapter(args);
    const id = requireString(args, "id");

    return adapter.getDocument!(id);
  }

  private async searchCaseLaw(args: Record<string, unknown>): Promise<unknown> {
    const adapter = this.requireCaseLawAdapter(args);
    const query = requireString(args, "query");
    const limit = optionalNumber(args, "limit");
    const court = optionalString(args, "court");
    const dateFrom = optionalString(args, "dateFrom");
    const dateTo = optionalString(args, "dateTo");
    const request: CaseLawSearchRequest = {
      query,
      ...(limit === undefined ? {} : { limit }),
      ...(court === undefined ? {} : { court }),
      ...(dateFrom === undefined ? {} : { dateFrom }),
      ...(dateTo === undefined ? {} : { dateTo }),
    };

    return adapter.searchCaseLaw!(request);
  }

  private async getPreparatoryWorks(
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const adapter = this.requirePreparatoryWorksAdapter(args);
    const citation = optionalString(args, "citation");
    const statuteId = optionalString(args, "statuteId");
    const query = optionalString(args, "query");
    const limit = optionalNumber(args, "limit");

    if (citation === undefined && statuteId === undefined && query === undefined) {
      throw new ShellError(
        "invalid_arguments",
        "Expected at least one of: citation, statuteId, query",
      );
    }

    const request: PreparatoryWorksRequest = {
      ...(citation === undefined ? {} : { citation }),
      ...(statuteId === undefined ? {} : { statuteId }),
      ...(query === undefined ? {} : { query }),
      ...(limit === undefined ? {} : { limit }),
    };

    return adapter.getPreparatoryWorks!(request);
  }

  private async parseCitation(args: Record<string, unknown>): Promise<unknown> {
    const adapter = this.requireCitationsAdapter(args);
    const citation = requireString(args, "citation");

    return adapter.parseCitation!(citation);
  }

  private async formatCitation(args: Record<string, unknown>): Promise<unknown> {
    const adapter = this.requireFormattingAdapter(args);
    const citation = requireString(args, "citation");
    const styleValue = optionalString(args, "style");
    const style =
      styleValue === undefined
        ? undefined
        : parseCitationStyle(styleValue);
    const request: CitationFormatRequest =
      style === undefined ? { citation } : { citation, style };

    return adapter.formatCitation!(request);
  }

  private async checkCurrency(args: Record<string, unknown>): Promise<unknown> {
    const adapter = this.requireCurrencyAdapter(args);
    const citation = optionalString(args, "citation");
    const statuteId = optionalString(args, "statuteId");
    const asOfDate = optionalString(args, "asOfDate");

    if (citation === undefined && statuteId === undefined) {
      throw new ShellError(
        "invalid_arguments",
        "Expected at least one of: citation, statuteId",
      );
    }

    const request: CurrencyCheckRequest = {
      ...(citation === undefined ? {} : { citation }),
      ...(statuteId === undefined ? {} : { statuteId }),
      ...(asOfDate === undefined ? {} : { asOfDate }),
    };

    return adapter.checkCurrency!(request);
  }

  private async buildLegalStance(args: Record<string, unknown>): Promise<unknown> {
    const adapter = this.requireLegalStanceAdapter(args);
    const query = requireString(args, "query");
    const limit = optionalNumber(args, "limit");
    const includeCaseLaw = optionalBoolean(args, "includeCaseLaw");
    const includePreparatoryWorks = optionalBoolean(args, "includePreparatoryWorks");
    const request: LegalStanceRequest = {
      query,
      ...(limit === undefined ? {} : { limit }),
      ...(includeCaseLaw === undefined ? {} : { includeCaseLaw }),
      ...(includePreparatoryWorks === undefined ? {} : { includePreparatoryWorks }),
    };

    return adapter.buildLegalStance!(request);
  }

  private async getEuBasis(args: Record<string, unknown>): Promise<unknown> {
    const adapter = this.requireEuAdapter(args);
    const citation = optionalString(args, "citation");
    const statuteId = optionalString(args, "statuteId");
    const documentId = optionalString(args, "documentId");
    const limit = optionalNumber(args, "limit");

    if (
      citation === undefined &&
      statuteId === undefined &&
      documentId === undefined
    ) {
      throw new ShellError(
        "invalid_arguments",
        "Expected at least one of: citation, statuteId, documentId",
      );
    }

    const request: EuBasisRequest = {
      ...(citation === undefined ? {} : { citation }),
      ...(statuteId === undefined ? {} : { statuteId }),
      ...(documentId === undefined ? {} : { documentId }),
      ...(limit === undefined ? {} : { limit }),
    };

    return adapter.getEuBasis!(request);
  }

  private async searchEuImplementations(
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const adapter = this.requireEuAdapter(args);
    const query = requireString(args, "query");
    const limit = optionalNumber(args, "limit");
    const request: EuImplementationSearchRequest =
      limit === undefined ? { query } : { query, limit };

    return adapter.searchEuImplementations!(request);
  }

  private async getNationalImplementations(
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const adapter = this.requireEuAdapter(args);
    const euId = requireString(args, "euId");
    const limit = optionalNumber(args, "limit");
    const request: EuNationalImplementationsRequest =
      limit === undefined ? { euId } : { euId, limit };

    return adapter.getNationalImplementations!(request);
  }

  private async getProvisionEuBasis(
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const adapter = this.requireEuAdapter(args);
    const documentId = requireString(args, "documentId");
    const limit = optionalNumber(args, "limit");

    return adapter.getProvisionEuBasis!(
      limit === undefined ? { documentId } : { documentId, limit },
    );
  }

  private async validateEuCompliance(
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const adapter = this.requireEuAdapter(args);
    const euId = requireString(args, "euId");
    const citation = optionalString(args, "citation");
    const statuteId = optionalString(args, "statuteId");
    const request: EuComplianceValidationRequest = {
      euId,
      ...(citation === undefined ? {} : { citation }),
      ...(statuteId === undefined ? {} : { statuteId }),
    };

    return adapter.validateEuCompliance!(request);
  }

  private async validateCitation(
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const adapter = this.requireCitationsAdapter(args);
    const citation = requireString(args, "citation");

    return adapter.validateCitation!(citation);
  }

  private async runIngestion(args: Record<string, unknown>): Promise<unknown> {
    const adapter = this.requireIngestionAdapter(args);
    const sourceId = optionalString(args, "sourceId");
    const dryRun = optionalBoolean(args, "dryRun") ?? false;
    const request: IngestionRequest =
      sourceId === undefined ? { dryRun } : { sourceId, dryRun };

    return adapter.runIngestion!(request);
  }

  private requireDocumentsAdapter(args: Record<string, unknown>): CountryAdapter {
    const adapter = this.requireCountry(args);

    if (!adapter.capabilities.documents || !adapter.searchDocuments || !adapter.getDocument) {
      throw new ShellError(
        "unsupported_capability",
        `Country ${adapter.country.code} does not support document search`,
      );
    }

    return adapter;
  }

  private requireCaseLawAdapter(args: Record<string, unknown>): CountryAdapter {
    const adapter = this.requireCountry(args);

    if (!adapter.capabilities.caseLaw || !adapter.searchCaseLaw) {
      throw new ShellError(
        "unsupported_capability",
        `Country ${adapter.country.code} does not support case law search`,
      );
    }

    return adapter;
  }

  private requirePreparatoryWorksAdapter(
    args: Record<string, unknown>,
  ): CountryAdapter {
    const adapter = this.requireCountry(args);

    if (!adapter.capabilities.preparatoryWorks || !adapter.getPreparatoryWorks) {
      throw new ShellError(
        "unsupported_capability",
        `Country ${adapter.country.code} does not support preparatory works retrieval`,
      );
    }

    return adapter;
  }

  private requireCitationsAdapter(args: Record<string, unknown>): CountryAdapter {
    const adapter = this.requireCountry(args);

    if (
      !adapter.capabilities.citations ||
      !adapter.parseCitation ||
      !adapter.validateCitation
    ) {
      throw new ShellError(
        "unsupported_capability",
        `Country ${adapter.country.code} does not support citation parsing`,
      );
    }

    return adapter;
  }

  private requireFormattingAdapter(args: Record<string, unknown>): CountryAdapter {
    const adapter = this.requireCountry(args);

    if (!adapter.capabilities.formatting || !adapter.formatCitation) {
      throw new ShellError(
        "unsupported_capability",
        `Country ${adapter.country.code} does not support citation formatting`,
      );
    }

    return adapter;
  }

  private requireCurrencyAdapter(args: Record<string, unknown>): CountryAdapter {
    const adapter = this.requireCountry(args);

    if (!adapter.capabilities.currency || !adapter.checkCurrency) {
      throw new ShellError(
        "unsupported_capability",
        `Country ${adapter.country.code} does not support currency checks`,
      );
    }

    return adapter;
  }

  private requireLegalStanceAdapter(args: Record<string, unknown>): CountryAdapter {
    const adapter = this.requireCountry(args);

    if (!adapter.capabilities.legalStance || !adapter.buildLegalStance) {
      throw new ShellError(
        "unsupported_capability",
        `Country ${adapter.country.code} does not support legal stance building`,
      );
    }

    return adapter;
  }

  private requireEuAdapter(args: Record<string, unknown>): CountryAdapter {
    const adapter = this.requireCountry(args);

    if (
      !adapter.capabilities.eu ||
      !adapter.getEuBasis ||
      !adapter.searchEuImplementations ||
      !adapter.getNationalImplementations ||
      !adapter.getProvisionEuBasis ||
      !adapter.validateEuCompliance
    ) {
      throw new ShellError(
        "unsupported_capability",
        `Country ${adapter.country.code} does not support EU linkage`,
      );
    }

    return adapter;
  }

  private requireIngestionAdapter(args: Record<string, unknown>): CountryAdapter {
    const adapter = this.requireCountry(args);

    if (!adapter.capabilities.ingestion || !adapter.runIngestion) {
      throw new ShellError(
        "unsupported_capability",
        `Country ${adapter.country.code} does not support ingestion`,
      );
    }

    return adapter;
  }

  private requireCountry(args: Record<string, unknown>): CountryAdapter {
    const countryCode = requireString(args, "country");
    return this.registry.get(countryCode);
  }

  private countryToolSupport(adapter: CountryAdapter): Record<string, boolean> {
    return {
      "law_search_documents":
        adapter.capabilities.documents &&
        Boolean(adapter.searchDocuments) &&
        Boolean(adapter.getDocument),
      "law_search_case_law":
        adapter.capabilities.caseLaw && Boolean(adapter.searchCaseLaw),
      "law_get_preparatory_works":
        adapter.capabilities.preparatoryWorks &&
        Boolean(adapter.getPreparatoryWorks),
      "law_format_citation":
        adapter.capabilities.formatting && Boolean(adapter.formatCitation),
      "law_check_currency":
        adapter.capabilities.currency && Boolean(adapter.checkCurrency),
      "law_build_legal_stance":
        adapter.capabilities.legalStance && Boolean(adapter.buildLegalStance),
      "law_get_eu_basis":
        adapter.capabilities.eu && Boolean(adapter.getEuBasis),
      "law_search_eu_implementations":
        adapter.capabilities.eu &&
        Boolean(adapter.searchEuImplementations),
      "law_get_national_implementations":
        adapter.capabilities.eu &&
        Boolean(adapter.getNationalImplementations),
      "law_get_provision_eu_basis":
        adapter.capabilities.eu && Boolean(adapter.getProvisionEuBasis),
      "law_validate_eu_compliance":
        adapter.capabilities.eu && Boolean(adapter.validateEuCompliance),
      "law_get_document":
        adapter.capabilities.documents && Boolean(adapter.getDocument),
      "law_parse_citation":
        adapter.capabilities.citations &&
        Boolean(adapter.parseCitation),
      "law_validate_citation":
        adapter.capabilities.citations && Boolean(adapter.validateCitation),
      "law_run_ingestion":
        adapter.capabilities.ingestion && Boolean(adapter.runIngestion),
    };
  }
}

function parseCitationStyle(
  value: string,
): CitationFormatRequest["style"] {
  const normalized = value.trim().toLowerCase();
  if (normalized === "default" || normalized === "short" || normalized === "pinpoint") {
    return normalized;
  }

  throw new ShellError(
    "invalid_arguments",
    "Expected style to be one of: default, short, pinpoint",
  );
}

function requireString(
  args: Record<string, unknown>,
  key: string,
): string {
  const value = args[key];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ShellError("invalid_arguments", `Expected non-empty string: ${key}`);
  }

  return value;
}

function optionalString(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = args[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new ShellError("invalid_arguments", `Expected string: ${key}`);
  }

  return value;
}

function optionalNumber(
  args: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = args[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new ShellError("invalid_arguments", `Expected number: ${key}`);
  }

  return value;
}

function optionalBoolean(
  args: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = args[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new ShellError("invalid_arguments", `Expected boolean: ${key}`);
  }

  return value;
}

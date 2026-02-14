import type { ToolDefinition } from "./types.js";

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "law_list_countries",
    description:
      "List available country adapters and their capabilities in this server.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: "law_describe_country",
    description:
      "Describe supported data sources and capabilities for one country.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["country"],
      properties: {
        country: { type: "string", description: "Country code, for example se" },
      },
    },
  },
  {
    name: "law_search_documents",
    description: "Search documents (statutes/cases/etc.) in one country.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["country", "query"],
      properties: {
        country: { type: "string" },
        query: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 100 },
      },
    },
  },
  {
    name: "law_search_case_law",
    description: "Search case law in one country with optional court/date filters.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["country", "query"],
      properties: {
        country: { type: "string" },
        query: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 100 },
        court: { type: "string" },
        dateFrom: {
          type: "string",
          description: "Inclusive start date in YYYY-MM-DD format.",
        },
        dateTo: {
          type: "string",
          description: "Inclusive end date in YYYY-MM-DD format.",
        },
      },
    },
  },
  {
    name: "law_get_preparatory_works",
    description: "Get preparatory works for a country by citation, statute id, or query.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["country"],
      properties: {
        country: { type: "string" },
        citation: { type: "string" },
        statuteId: { type: "string" },
        query: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 100 },
      },
      anyOf: [{ required: ["citation"] }, { required: ["statuteId"] }, { required: ["query"] }],
    },
  },
  {
    name: "law_format_citation",
    description: "Format a legal citation for one country.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["country", "citation"],
      properties: {
        country: { type: "string" },
        citation: { type: "string" },
        style: {
          type: "string",
          enum: ["default", "short", "pinpoint"],
        },
      },
    },
  },
  {
    name: "law_check_currency",
    description:
      "Check whether a statute/citation appears current in the ingested corpus.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["country"],
      properties: {
        country: { type: "string" },
        citation: { type: "string" },
        statuteId: { type: "string" },
        asOfDate: { type: "string", description: "YYYY-MM-DD" },
      },
      anyOf: [{ required: ["citation"] }, { required: ["statuteId"] }],
    },
  },
  {
    name: "law_build_legal_stance",
    description:
      "Build a structured research bundle from statutes, case law, and preparatory works.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["country", "query"],
      properties: {
        country: { type: "string" },
        query: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 100 },
        includeCaseLaw: { type: "boolean" },
        includePreparatoryWorks: { type: "boolean" },
      },
    },
  },
  {
    name: "law_get_eu_basis",
    description: "Get EU references linked to a statute, citation, or document.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["country"],
      properties: {
        country: { type: "string" },
        citation: { type: "string" },
        statuteId: { type: "string" },
        documentId: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 200 },
      },
      anyOf: [
        { required: ["citation"] },
        { required: ["statuteId"] },
        { required: ["documentId"] },
      ],
    },
  },
  {
    name: "law_search_eu_implementations",
    description: "Search EU acts and mapped national implementations.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["country", "query"],
      properties: {
        country: { type: "string" },
        query: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 200 },
      },
    },
  },
  {
    name: "law_get_national_implementations",
    description: "Get national implementations for one EU act id.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["country", "euId"],
      properties: {
        country: { type: "string" },
        euId: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 200 },
      },
    },
  },
  {
    name: "law_get_provision_eu_basis",
    description: "Get EU references linked to a provision/document id.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["country", "documentId"],
      properties: {
        country: { type: "string" },
        documentId: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 200 },
      },
    },
  },
  {
    name: "law_validate_eu_compliance",
    description:
      "Validate whether an EU act has mapped national implementations in the corpus.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["country", "euId"],
      properties: {
        country: { type: "string" },
        euId: { type: "string" },
        citation: { type: "string" },
        statuteId: { type: "string" },
      },
    },
  },
  {
    name: "law_get_document",
    description: "Get a single document by country and id.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["country", "id"],
      properties: {
        country: { type: "string" },
        id: { type: "string" },
      },
    },
  },
  {
    name: "law_parse_citation",
    description: "Parse and normalize a legal citation in one country.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["country", "citation"],
      properties: {
        country: { type: "string" },
        citation: { type: "string" },
      },
    },
  },
  {
    name: "law_validate_citation",
    description: "Validate a legal citation in one country.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["country", "citation"],
      properties: {
        country: { type: "string" },
        citation: { type: "string" },
      },
    },
  },
  {
    name: "law_run_ingestion",
    description: "Run ingestion/update workflow for one country source.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["country"],
      properties: {
        country: { type: "string" },
        sourceId: { type: "string" },
        dryRun: { type: "boolean" },
      },
    },
  },
];

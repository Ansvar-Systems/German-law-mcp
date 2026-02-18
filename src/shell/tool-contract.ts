import type { ToolDefinition } from "./types.js";

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "law_list_countries",
    description:
      "List all available country adapters and their capabilities. " +
      "Use this first to discover which countries are available and what data each country provides " +
      "(statutes, case law, preparatory works, EU cross-references, citation parsing). " +
      "Returns an array of objects with country code and capability flags.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: "law_describe_country",
    description:
      "Get detailed information about a specific country's capabilities and supported tools. " +
      "Returns the country descriptor (code, name, language) and a map of which tools are available. " +
      "Use this to check what a country supports before calling country-specific tools.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["country"],
      properties: {
        country: {
          type: "string",
          description:
            "ISO 3166-1 alpha-2 country code, lowercase. Example: 'de' for Germany.",
        },
      },
    },
  },
  {
    name: "law_search_documents",
    description:
      "Full-text search across German federal statutes and regulations. " +
      "Accepts natural language queries or German legal citations. " +
      "The search uses a three-tier strategy: (1) exact citation match, (2) FTS5 BM25-ranked full-text search, (3) LIKE fallback. " +
      "Supports German legal terms (e.g. 'Datenschutz', 'Grundrechte') and citation patterns (e.g. '§ 823 BGB', 'Art. 1 GG'). " +
      "Returns documents with id, title, citation, source URL, effective date, and text snippet. " +
      "Use law_get_document to retrieve the full text of a specific result. " +
      "Default limit: 20. Max: 100.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["country", "query"],
      properties: {
        country: {
          type: "string",
          description: "Country code. Use 'de' for Germany.",
        },
        query: {
          type: "string",
          description:
            "Search query: a German legal term, topic, or citation. " +
            "Examples: 'Datenschutz', '§ 433 BGB', 'Kündigungsschutz', 'Art. 14 GG'.",
        },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 100,
          default: 20,
          description: "Maximum number of results to return. Default: 20, max: 100.",
        },
      },
    },
  },
  {
    name: "law_search_case_law",
    description:
      "Search German federal court decisions (Rechtsprechung). " +
      "Covers decisions from: BVerfG (Constitutional Court), BGH (Federal Court of Justice), " +
      "BVerwG (Federal Administrative Court), BAG (Federal Labour Court), " +
      "BSG (Federal Social Court), BFH (Federal Fiscal Court), BPatG (Federal Patent Court). " +
      "Supports filtering by court name and date range. " +
      "Returns documents with ECLI, file number (Aktenzeichen), court, decision date, and text snippet. " +
      "Note: Only published federal court decisions are included; lower court (Landesgerichte) decisions are not available. " +
      "Default limit: 20. Max: 100. " +
      "Requires professional tier for full case law access.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["country", "query"],
      properties: {
        country: {
          type: "string",
          description: "Country code. Use 'de' for Germany.",
        },
        query: {
          type: "string",
          description:
            "Search query: legal topic, ECLI, Aktenzeichen (file number), or free text. " +
            "Examples: 'Meinungsfreiheit', 'ECLI:DE:BVerfG:2020', '1 BvR 16/13'.",
        },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 100,
          default: 20,
          description: "Maximum number of results. Default: 20, max: 100.",
        },
        court: {
          type: "string",
          description:
            "Filter by court name (partial match). Examples: 'BVerfG', 'BGH', 'BAG'.",
        },
        dateFrom: {
          type: "string",
          description: "Inclusive start date in YYYY-MM-DD format. Example: '2020-01-01'.",
        },
        dateTo: {
          type: "string",
          description: "Inclusive end date in YYYY-MM-DD format. Example: '2024-12-31'.",
        },
      },
    },
  },
  {
    name: "law_get_preparatory_works",
    description:
      "Retrieve legislative preparatory works (Gesetzesmaterialien) from the DIP Bundestag documentation system. " +
      "Includes Drucksachen (printed papers) and Plenarprotokolle (plenary protocols) for Wahlperioden 19 and 20. " +
      "Search by citation (e.g. '§ 1 BDSG'), statute ID, or free-text query. " +
      "At least one of citation, statuteId, or query must be provided. " +
      "Returns documents with DIP ID, title, statute reference, work type, publication date, and text snippet. " +
      "Default limit: 20. Max: 100. " +
      "Requires professional tier for full preparatory works access.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["country"],
      properties: {
        country: {
          type: "string",
          description: "Country code. Use 'de' for Germany.",
        },
        citation: {
          type: "string",
          description:
            "German legal citation to find related preparatory works. Example: '§ 1 BDSG'.",
        },
        statuteId: {
          type: "string",
          description: "Internal statute identifier. Example: 'bdsg-2018'.",
        },
        query: {
          type: "string",
          description: "Free-text search query for preparatory works. Example: 'Datenschutzreform'.",
        },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 100,
          default: 20,
          description: "Maximum number of results. Default: 20, max: 100.",
        },
      },
      anyOf: [{ required: ["citation"] }, { required: ["statuteId"] }, { required: ["query"] }],
    },
  },
  {
    name: "law_format_citation",
    description:
      "Normalize and format a German legal citation into a standard form. " +
      "Supports three styles: 'default' (full form), 'short' (abbreviated), and 'pinpoint' (section-only). " +
      "Accepts common German citation formats: '§ 823 Abs. 1 BGB', 'Art. 1 Abs. 1 GG', " +
      "'Artikel 1 Absatz 1 Grundgesetz'. " +
      "Use this to standardize citations before searching or displaying them.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["country", "citation"],
      properties: {
        country: {
          type: "string",
          description: "Country code. Use 'de' for Germany.",
        },
        citation: {
          type: "string",
          description:
            "German legal citation to format. Examples: '§ 823 Abs 1 BGB', 'Art 1 GG', 'Paragraph 433 BGB'.",
        },
        style: {
          type: "string",
          enum: ["default", "short", "pinpoint"],
          description:
            "Citation style. 'default': full standardized form, 'short': abbreviated, 'pinpoint': section reference only.",
        },
      },
    },
  },
  {
    name: "law_check_currency",
    description:
      "Check whether a German statute or provision appears current (in force) in the ingested corpus. " +
      "Provide either a citation (e.g. '§ 1 BGB') or a statute ID. " +
      "Optionally specify an as-of date to check historical currency. " +
      "Note: This checks the ingested data, not a live government feed. " +
      "Data is updated regularly but may lag behind the official gazette by a few days.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["country"],
      properties: {
        country: {
          type: "string",
          description: "Country code. Use 'de' for Germany.",
        },
        citation: {
          type: "string",
          description: "German legal citation. Example: '§ 1 BGB', 'Art. 20 GG'.",
        },
        statuteId: {
          type: "string",
          description: "Internal statute identifier.",
        },
        asOfDate: {
          type: "string",
          description: "Check currency as of this date (YYYY-MM-DD). Default: today.",
        },
      },
      anyOf: [{ required: ["citation"] }, { required: ["statuteId"] }],
    },
  },
  {
    name: "law_build_legal_stance",
    description:
      "Build a comprehensive legal research bundle for a topic. " +
      "Aggregates results from statutes, case law, and preparatory works into a single structured response. " +
      "This is the recommended tool for broad legal research — it saves multiple round trips. " +
      "Case law and preparatory works are included by default but can be disabled. " +
      "On the free tier, case law and preparatory works may be unavailable (a notice will be included). " +
      "Default limit: 20. Max: 100 (applies per category).",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["country", "query"],
      properties: {
        country: {
          type: "string",
          description: "Country code. Use 'de' for Germany.",
        },
        query: {
          type: "string",
          description:
            "Legal research topic or question. Examples: 'Mietrecht Kündigung', 'Datenschutz Arbeitnehmer', 'GmbH Haftung'.",
        },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 100,
          default: 20,
          description: "Max results per category (statutes, case law, prep works). Default: 20.",
        },
        includeCaseLaw: {
          type: "boolean",
          description: "Include case law results. Default: true.",
        },
        includePreparatoryWorks: {
          type: "boolean",
          description: "Include preparatory works. Default: true.",
        },
      },
    },
  },
  {
    name: "law_get_eu_basis",
    description:
      "Get EU directives and regulations referenced by a German statute. " +
      "Looks up EU legal basis (CELEX numbers, directive/regulation references) linked to a German law. " +
      "Provide a citation, statute ID, or document ID. " +
      "Requires the eu_references table (professional tier). " +
      "Use this to trace which EU law a German statute implements.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["country"],
      properties: {
        country: {
          type: "string",
          description: "Country code. Use 'de' for Germany.",
        },
        citation: {
          type: "string",
          description: "German citation. Example: '§ 1 BDSG'.",
        },
        statuteId: {
          type: "string",
          description: "Internal statute identifier.",
        },
        documentId: {
          type: "string",
          description: "Document ID from a previous search result.",
        },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 200,
          default: 20,
          description: "Maximum EU references to return. Default: 20, max: 200.",
        },
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
    description:
      "Search for EU acts (directives and regulations) and their German implementation mapping. " +
      "Use this to find which EU law corresponds to a topic, then use law_get_national_implementations " +
      "to see which German statutes implement it. " +
      "Requires professional tier.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["country", "query"],
      properties: {
        country: {
          type: "string",
          description: "Country code. Use 'de' for Germany.",
        },
        query: {
          type: "string",
          description:
            "Search query for EU acts. Examples: 'GDPR', 'data protection', 'NIS2', 'AI Act'.",
        },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 200,
          default: 20,
          description: "Maximum results. Default: 20, max: 200.",
        },
      },
    },
  },
  {
    name: "law_get_national_implementations",
    description:
      "Get all German statutes that implement a specific EU act (directive or regulation). " +
      "Provide the EU act identifier (e.g. a CELEX number or short identifier from law_search_eu_implementations). " +
      "Requires professional tier.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["country", "euId"],
      properties: {
        country: {
          type: "string",
          description: "Country code. Use 'de' for Germany.",
        },
        euId: {
          type: "string",
          description:
            "EU act identifier (CELEX number or short ID). Example: '32016R0679' (GDPR).",
        },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 200,
          default: 20,
          description: "Maximum results. Default: 20, max: 200.",
        },
      },
    },
  },
  {
    name: "law_get_provision_eu_basis",
    description:
      "Get EU references linked to a specific provision or document by its document ID. " +
      "Use a document ID obtained from a previous search result. " +
      "Requires professional tier.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["country", "documentId"],
      properties: {
        country: {
          type: "string",
          description: "Country code. Use 'de' for Germany.",
        },
        documentId: {
          type: "string",
          description: "Document ID from a previous search result.",
        },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 200,
          default: 20,
          description: "Maximum EU references. Default: 20, max: 200.",
        },
      },
    },
  },
  {
    name: "law_validate_eu_compliance",
    description:
      "Validate whether a specific EU act has mapped German national implementations in the corpus. " +
      "Returns compliance status indicating whether the EU act is implemented by German statutes. " +
      "Requires professional tier.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["country", "euId"],
      properties: {
        country: {
          type: "string",
          description: "Country code. Use 'de' for Germany.",
        },
        euId: {
          type: "string",
          description: "EU act identifier to validate.",
        },
        citation: {
          type: "string",
          description: "Optional German citation for scoped validation.",
        },
        statuteId: {
          type: "string",
          description: "Optional statute ID for scoped validation.",
        },
      },
    },
  },
  {
    name: "law_get_document",
    description:
      "Retrieve a single document by its ID. " +
      "Use this to get the full text/details of a specific statute, case, or preparatory work " +
      "found via law_search_documents, law_search_case_law, or law_get_preparatory_works. " +
      "The ID is returned in the 'id' field of search results. " +
      "Searches across all document tables (statutes, case law, preparatory works).",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["country", "id"],
      properties: {
        country: {
          type: "string",
          description: "Country code. Use 'de' for Germany.",
        },
        id: {
          type: "string",
          description:
            "Document ID from a previous search result. Examples: 'gg-art-1', 'bgb-433'.",
        },
      },
    },
  },
  {
    name: "law_parse_citation",
    description:
      "Parse and normalize a German legal citation string into structured components. " +
      "Returns the parsed components (code, paragraph/article number, subsection, sentence) " +
      "and a normalized form of the citation. " +
      "Supports formats: '§ 823 Abs. 1 BGB', 'Art. 1 Abs. 1 GG', 'Artikel 1 Absatz 1 Grundgesetz'. " +
      "Use this to understand or validate citation structure before searching.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["country", "citation"],
      properties: {
        country: {
          type: "string",
          description: "Country code. Use 'de' for Germany.",
        },
        citation: {
          type: "string",
          description:
            "German legal citation to parse. Examples: '§ 823 Abs. 1 BGB', 'Art. 1 GG'.",
        },
      },
    },
  },
  {
    name: "law_validate_citation",
    description:
      "Validate a German legal citation against the ingested corpus. " +
      "Returns whether the citation exists in the database, along with any matching documents. " +
      "Use this to verify a citation is real and corresponds to an existing provision. " +
      "Returns {valid: true/false} with details about the match.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["country", "citation"],
      properties: {
        country: {
          type: "string",
          description: "Country code. Use 'de' for Germany.",
        },
        citation: {
          type: "string",
          description:
            "German legal citation to validate. Examples: '§ 823 BGB', 'Art. 1 GG'.",
        },
      },
    },
  },
  {
    name: "law_list_sources",
    description:
      "List all data sources used by this server, with provenance metadata. " +
      "Returns information about each source: name, URL, last ingestion date, scope, and limitations. " +
      "Use this to understand the data coverage and freshness of the server.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["country"],
      properties: {
        country: {
          type: "string",
          description: "Country code. Use 'de' for Germany.",
        },
      },
    },
  },
  {
    name: "law_about",
    description:
      "Get server metadata: version, database tier, capabilities, data statistics, and source information. " +
      "Use this to understand what this server provides and its current state. " +
      "Returns version, tier (free/professional), document counts, and data freshness.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: "law_run_ingestion",
    description:
      "Trigger data ingestion or update workflow for a country's data source. " +
      "Primarily used for maintenance. Set dryRun: true to preview what would be updated without making changes. " +
      "Not available in production Vercel deployment.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["country"],
      properties: {
        country: {
          type: "string",
          description: "Country code. Use 'de' for Germany.",
        },
        sourceId: {
          type: "string",
          description: "Specific source to ingest. Omit to update all sources.",
        },
        dryRun: {
          type: "boolean",
          description: "Preview mode: show what would be updated without making changes. Default: false.",
        },
      },
    },
  },
];

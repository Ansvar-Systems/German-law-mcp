import { SWEDISH_LEGISLATION } from "../sample-data/se-legislation.js";
import {
  createRegexCitationHandlers,
  createStaticIngestionRunner,
  getDocumentFromMemory,
  searchDocumentsInMemory,
} from "../shell/adapter-kit.js";
import type {
  CountryAdapter,
} from "../shell/types.js";

const SFS_PATTERN = /^SFS\s*(?<year>\d{4}):(?<number>\d+)$/i;
const { parseCitation, validateCitation } = createRegexCitationHandlers({
  pattern: SFS_PATTERN,
  reason: "Citation does not match expected SFS format (SFS YYYY:NNN).",
  normalize: ({ year, number }) => `SFS ${year}:${number}`,
});
const runIngestion = createStaticIngestionRunner({
  defaultSource: "riksdagen",
  count: SWEDISH_LEGISLATION.length,
});

export const swedenAdapter: CountryAdapter = {
  country: {
    code: "se",
    name: "Sweden",
    defaultLanguage: "sv",
    sources: ["riksdagen", "lagen.nu"],
  },
  capabilities: {
    documents: true,
    caseLaw: false,
    preparatoryWorks: false,
    citations: true,
    formatting: false,
    currency: false,
    legalStance: false,
    eu: false,
    ingestion: true,
    versionTracking: false,
  },
  async searchDocuments(request) {
    return searchDocumentsInMemory(SWEDISH_LEGISLATION, request);
  },
  async getDocument(id: string) {
    return getDocumentFromMemory(SWEDISH_LEGISLATION, id);
  },
  parseCitation,
  validateCitation,
  runIngestion,
};

import { NORWEGIAN_LEGISLATION } from "../sample-data/no-legislation.js";
import {
  createRegexCitationHandlers,
  createStaticIngestionRunner,
  getDocumentFromMemory,
  searchDocumentsInMemory,
} from "../shell/adapter-kit.js";
import type {
  CountryAdapter,
} from "../shell/types.js";

const LOV_PATTERN =
  /^LOV-(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})-(?<number>\d+)$/i;
const { parseCitation, validateCitation } = createRegexCitationHandlers({
  pattern: LOV_PATTERN,
  reason: "Citation does not match expected LOV format (LOV-YYYY-MM-DD-NNN).",
  normalize: ({ year, month, day, number }) =>
    `LOV-${year}-${month}-${day}-${number}`,
});
const runIngestion = createStaticIngestionRunner({
  defaultSource: "lovdata",
  count: NORWEGIAN_LEGISLATION.length,
});

export const norwayAdapter: CountryAdapter = {
  country: {
    code: "no",
    name: "Norway",
    defaultLanguage: "no",
    sources: ["lovdata"],
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
    return searchDocumentsInMemory(NORWEGIAN_LEGISLATION, request);
  },
  async getDocument(id: string) {
    return getDocumentFromMemory(NORWEGIAN_LEGISLATION, id);
  },
  parseCitation,
  validateCitation,
  runIngestion,
};

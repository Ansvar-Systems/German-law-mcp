import Database from "@ansvar/mcp-sqlite";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { BUILTIN_ADAPTERS } from "../src/adapters/index.js";
import { resetGermanLawDatabaseCache } from "../src/db/german-law-db.js";
import { LawMcpShell } from "../src/shell/shell.js";

test("de adapter uses sqlite-backed corpus when configured", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "german-law-mcp-"));
  const dbPath = path.join(tempDir, "test.db");
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE law_documents (
      id TEXT PRIMARY KEY,
      country TEXT NOT NULL,
      statute_id TEXT,
      section_ref TEXT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      citation TEXT,
      source_url TEXT,
      effective_date TEXT,
      text_snippet TEXT,
      metadata_json TEXT,
      updated_at TEXT
    );

    CREATE VIRTUAL TABLE law_documents_fts USING fts5(
      title,
      citation,
      text_snippet,
      content='law_documents',
      content_rowid='rowid',
      tokenize='unicode61'
    );

    CREATE TRIGGER law_documents_ai AFTER INSERT ON law_documents BEGIN
      INSERT INTO law_documents_fts(rowid, title, citation, text_snippet)
      VALUES (new.rowid, new.title, COALESCE(new.citation, ''), COALESCE(new.text_snippet, ''));
    END;

    CREATE TABLE case_law_documents (
      id TEXT PRIMARY KEY,
      country TEXT NOT NULL,
      case_id TEXT NOT NULL UNIQUE,
      ecli TEXT,
      court TEXT,
      decision_date TEXT,
      file_number TEXT,
      decision_type TEXT,
      title TEXT NOT NULL,
      citation TEXT,
      source_url TEXT NOT NULL,
      text_snippet TEXT,
      metadata_json TEXT,
      updated_at TEXT
    );

    CREATE VIRTUAL TABLE case_law_documents_fts USING fts5(
      title,
      citation,
      text_snippet,
      content='case_law_documents',
      content_rowid='rowid',
      tokenize='unicode61'
    );

    CREATE TRIGGER case_law_documents_ai AFTER INSERT ON case_law_documents BEGIN
      INSERT INTO case_law_documents_fts(rowid, title, citation, text_snippet)
      VALUES (new.rowid, new.title, COALESCE(new.citation, ''), COALESCE(new.text_snippet, ''));
    END;

    CREATE TABLE preparatory_works (
      id TEXT PRIMARY KEY,
      country TEXT NOT NULL,
      dip_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      statute_id TEXT,
      statute_citation TEXT,
      work_type TEXT,
      publication_date TEXT,
      source_url TEXT NOT NULL,
      text_snippet TEXT,
      metadata_json TEXT,
      updated_at TEXT
    );

    CREATE VIRTUAL TABLE preparatory_works_fts USING fts5(
      title,
      statute_citation,
      text_snippet,
      content='preparatory_works',
      content_rowid='rowid',
      tokenize='unicode61'
    );

    CREATE TRIGGER preparatory_works_ai AFTER INSERT ON preparatory_works BEGIN
      INSERT INTO preparatory_works_fts(rowid, title, statute_citation, text_snippet)
      VALUES (new.rowid, new.title, COALESCE(new.statute_citation, ''), COALESCE(new.text_snippet, ''));
    END;
  `);

  db.prepare(`
    INSERT INTO law_documents (
      id, country, statute_id, section_ref, kind, title, citation, source_url, effective_date, text_snippet, metadata_json, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    "bdsg:1",
    "de",
    "bdsg",
    "§ 1",
    "statute",
    "Bundesdatenschutzgesetz - Zweck und Anwendungsbereich",
    "§ 1 BDSG",
    "https://www.gesetze-im-internet.de/bdsg_2018/",
    "2018-05-25",
    "Dieses Gesetz dient der Durchführung der Verordnung (EU) 2016/679.",
    JSON.stringify({ source: "fixture" }),
  );
  db.prepare(`
    INSERT INTO law_documents (
      id, country, statute_id, section_ref, kind, title, citation, source_url, effective_date, text_snippet, metadata_json, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    "bdsg:10",
    "de",
    "bdsg",
    "§ 10",
    "statute",
    "Bundesdatenschutzgesetz - Aufsicht",
    "§ 10 BDSG",
    "https://www.gesetze-im-internet.de/bdsg_2018/",
    "2018-05-25",
    "Die Aufsicht hat auch Bezüge zu § 1 BDSG.",
    JSON.stringify({ source: "fixture" }),
  );

  db.prepare(`
    INSERT INTO case_law_documents (
      id, country, case_id, ecli, court, decision_date, file_number, decision_type, title, citation, source_url, text_snippet, metadata_json, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    "case:jure999999001",
    "de",
    "JURE999999001",
    "ECLI:DE:BGH:2024:0201.IXZR1.23.0",
    "BGH IX. Zivilsenat",
    "2024-02-01",
    "IX ZR 1/23",
    "Urteil",
    "BGH zur Haftung nach § 823 BGB",
    "IX ZR 1/23",
    "https://example.invalid/case-1",
    "Der BGH konkretisiert die Voraussetzungen des § 823 Abs. 1 BGB.",
    JSON.stringify({ source: "fixture" }),
  );

  db.prepare(`
    INSERT INTO preparatory_works (
      id, country, dip_id, title, statute_id, statute_citation, work_type, publication_date, source_url, text_snippet, metadata_json, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    "prep:310586",
    "de",
    "310586",
    "Medizinforschungsgesetz",
    "bdsg",
    "BDSG",
    "Gesetzgebung",
    "2024-07-01",
    "https://example.invalid/prep-1",
    "Gesetzentwurf mit Datenschutzbezug zum BDSG.",
    JSON.stringify({ source: "fixture" }),
  );
  db.close();

  const originalEnv = process.env.GERMAN_LAW_DB_PATH;
  process.env.GERMAN_LAW_DB_PATH = dbPath;
  resetGermanLawDatabaseCache();

  try {
    const shell = LawMcpShell.fromAdapters(BUILTIN_ADAPTERS);

    const searchResult = await shell.handleToolCall({
      name: "law_search_documents",
      arguments: { country: "de", query: "datenschutz", limit: 5 },
    });

    assert.equal(searchResult.ok, true);
    const payload = searchResult.data as { total: number; documents: Array<{ id: string }> };
    assert.equal(payload.total >= 1, true);
    assert.equal(payload.documents.some((doc) => doc.id === "bdsg:1"), true);

    const getResult = await shell.handleToolCall({
      name: "law_get_document",
      arguments: { country: "de", id: "bdsg:1" },
    });

    assert.equal(getResult.ok, true);
    assert.equal((getResult.data as { id: string }).id, "bdsg:1");

    const citationSearchResult = await shell.handleToolCall({
      name: "law_search_documents",
      arguments: { country: "de", query: "§ 1 BDSG", limit: 2 },
    });
    assert.equal(citationSearchResult.ok, true);
    const citationSearchPayload = citationSearchResult.data as {
      documents: Array<{ id: string }>;
    };
    assert.equal(citationSearchPayload.documents[0]?.id, "bdsg:1");

    const validCitationResult = await shell.handleToolCall({
      name: "law_validate_citation",
      arguments: { country: "de", citation: "§ 1 BDSG" },
    });
    assert.equal(validCitationResult.ok, true);
    assert.equal((validCitationResult.data as { valid: boolean }).valid, true);

    const missingCitationResult = await shell.handleToolCall({
      name: "law_validate_citation",
      arguments: { country: "de", citation: "§ 999 BDSG" },
    });
    assert.equal(missingCitationResult.ok, true);
    assert.equal((missingCitationResult.data as { valid: boolean }).valid, false);

    const caseLawResult = await shell.handleToolCall({
      name: "law_search_case_law",
      arguments: { country: "de", query: "haftung", limit: 5 },
    });
    assert.equal(caseLawResult.ok, true);
    const caseLawPayload = caseLawResult.data as {
      documents: Array<{ id: string; kind: string }>;
    };
    assert.equal(caseLawPayload.documents[0]?.id, "case:jure999999001");
    assert.equal(caseLawPayload.documents[0]?.kind, "case");

    const preparatoryWorksResult = await shell.handleToolCall({
      name: "law_get_preparatory_works",
      arguments: { country: "de", citation: "§ 1 BDSG", limit: 5 },
    });
    assert.equal(preparatoryWorksResult.ok, true);
    const preparatoryPayload = preparatoryWorksResult.data as {
      documents: Array<{ id: string; kind: string }>;
    };
    assert.equal(preparatoryPayload.documents[0]?.id, "prep:310586");
    assert.equal(preparatoryPayload.documents[0]?.kind, "preparatory_work");

    const formattedCitationResult = await shell.handleToolCall({
      name: "law_format_citation",
      arguments: {
        country: "de",
        citation: "§ 1 Absatz 1 bdsg",
        style: "short",
      },
    });
    assert.equal(formattedCitationResult.ok, true);
    assert.equal(
      (formattedCitationResult.data as { formatted: string }).formatted,
      "§ 1 BDSG",
    );

    const currencyResult = await shell.handleToolCall({
      name: "law_check_currency",
      arguments: { country: "de", statuteId: "bdsg" },
    });
    assert.equal(currencyResult.ok, true);
    assert.equal(
      (currencyResult.data as { status: string }).status,
      "likely_in_force",
    );

    const legalStanceResult = await shell.handleToolCall({
      name: "law_build_legal_stance",
      arguments: { country: "de", query: "datenschutz", limit: 5 },
    });
    assert.equal(legalStanceResult.ok, true);
    const legalStancePayload = legalStanceResult.data as {
      statutes: Array<{ id: string }>;
    };
    assert.equal(
      legalStancePayload.statutes.some((document) => document.id === "bdsg:1"),
      true,
    );

    const euBasisResult = await shell.handleToolCall({
      name: "law_get_eu_basis",
      arguments: { country: "de", statuteId: "bdsg", limit: 10 },
    });
    assert.equal(euBasisResult.ok, true);
    const euBasisPayload = euBasisResult.data as {
      references: Array<{ euId: string }>;
    };
    assert.equal(
      euBasisPayload.references.some((reference) =>
        reference.euId.includes("2016/679"),
      ),
      true,
    );

    const euSearchResult = await shell.handleToolCall({
      name: "law_search_eu_implementations",
      arguments: { country: "de", query: "datenschutz", limit: 10 },
    });
    assert.equal(euSearchResult.ok, true);
    const euSearchPayload = euSearchResult.data as {
      results: Array<{ euId: string; statutes: string[] }>;
    };
    assert.equal(
      euSearchPayload.results.some(
        (result) =>
          result.euId.includes("2016/679") && result.statutes.includes("bdsg"),
      ),
      true,
    );

    const euNationalResult = await shell.handleToolCall({
      name: "law_get_national_implementations",
      arguments: { country: "de", euId: "EU 2016/679", limit: 10 },
    });
    assert.equal(euNationalResult.ok, true);
    const euNationalPayload = euNationalResult.data as {
      results: Array<{ euId: string; statutes: string[] }>;
    };
    assert.equal(
      euNationalPayload.results.some(
        (result) =>
          result.euId.includes("2016/679") && result.statutes.includes("bdsg"),
      ),
      true,
    );

    const provisionBasisResult = await shell.handleToolCall({
      name: "law_get_provision_eu_basis",
      arguments: { country: "de", documentId: "bdsg:1", limit: 10 },
    });
    assert.equal(provisionBasisResult.ok, true);
    const provisionBasisPayload = provisionBasisResult.data as {
      references: Array<{ euId: string }>;
    };
    assert.equal(
      provisionBasisPayload.references.some((reference) =>
        reference.euId.includes("2016/679"),
      ),
      true,
    );

    const euComplianceResult = await shell.handleToolCall({
      name: "law_validate_eu_compliance",
      arguments: { country: "de", euId: "EU 2016/679", statuteId: "bdsg" },
    });
    assert.equal(euComplianceResult.ok, true);
    assert.equal(
      (euComplianceResult.data as { status: string }).status,
      "mapped",
    );
  } finally {
    if (originalEnv === undefined) {
      delete process.env.GERMAN_LAW_DB_PATH;
    } else {
      process.env.GERMAN_LAW_DB_PATH = originalEnv;
    }
    resetGermanLawDatabaseCache();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

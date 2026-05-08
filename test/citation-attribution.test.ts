/**
 * Source Attribution Standard — per-item _citation block tests.
 *
 * CLAUDE.md §"Source Attribution Standard" requires every _citation block
 * to carry source_url, publisher, license. License codes must exist in
 * `infrastructure/attribution-licenses.json`. This test pins the per-kind
 * attribution map for the German Law MCP corpora.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildDocCitation } from "../src/shell/shell.js";

const VALID_LICENSE_CODES = new Set([
  "Public-Domain",
  "CC-BY-4.0",
  "CC-BY-SA-4.0",
  "CC0-1.0",
  "Apache-2.0",
  "MIT",
  "Crown-Copyright",
  "EU-Decision-2011-833",
  "OGL-3.0",
]);

describe("buildDocCitation: Source Attribution Standard", () => {
  test("statute carries gesetze-im-internet attribution", () => {
    const c = buildDocCitation({
      id: "bdsg_2018:1",
      kind: "statute",
      title: "BDSG § 1",
      source_url: "https://www.gesetze-im-internet.de/bdsg_2018/__1.html",
    });
    assert.equal(c.publisher, "gesetze-im-internet.de");
    assert.equal(c.license, "Public-Domain");
    assert.equal(c.source_url, "https://www.gesetze-im-internet.de/bdsg_2018/__1.html");
    assert.equal(c.publisher_url, "https://www.gesetze-im-internet.de");
    assert.ok(VALID_LICENSE_CODES.has(c.license as string));
  });

  test("regulation carries gesetze-im-internet attribution", () => {
    const c = buildDocCitation({
      id: "datenschutz_durchführungsgesetz:1",
      kind: "regulation",
      title: "DSDurchfG § 1",
      source_url: "https://www.gesetze-im-internet.de/example/__1.html",
    });
    assert.equal(c.publisher, "gesetze-im-internet.de");
    assert.equal(c.license, "Public-Domain");
  });

  test("case law carries Rechtsprechung attribution", () => {
    const c = buildDocCitation({
      id: "BVerfG-2-BvR-001-25",
      kind: "case",
      title: "BVerfG 2 BvR 001/25",
      source_url: "https://www.rechtsprechung-im-internet.de/jportal/?...",
    });
    assert.equal(c.publisher, "Rechtsprechung im Internet");
    assert.equal(c.license, "Public-Domain");
    assert.equal(c.publisher_url, "https://www.rechtsprechung-im-internet.de");
    assert.ok(VALID_LICENSE_CODES.has(c.license as string));
  });

  test("preparatory work carries Bundestag DIP attribution with CC-BY-4.0", () => {
    const c = buildDocCitation({
      id: "vorgang-12345",
      kind: "preparatory_work",
      title: "Drucksache 20/12345",
      source_url: "https://search.dip.bundestag.de/api/v1/vorgang/12345",
    });
    assert.equal(c.publisher, "DIP Bundestag");
    assert.equal(c.license, "CC-BY-4.0");
    assert.equal(c.publisher_url, "https://search.dip.bundestag.de");
    assert.ok(VALID_LICENSE_CODES.has(c.license as string));
  });

  test("source_url falls back to camelCase sourceUrl when present", () => {
    const c = buildDocCitation({
      id: "stgb:1",
      kind: "statute",
      title: "StGB § 1",
      sourceUrl: "https://www.gesetze-im-internet.de/stgb/__1.html",
    });
    assert.equal(c.source_url, "https://www.gesetze-im-internet.de/stgb/__1.html");
  });

  test("source_url is null when both fields are missing", () => {
    const c = buildDocCitation({
      id: "stgb:1",
      kind: "statute",
      title: "StGB § 1",
    });
    assert.equal(c.source_url, null);
  });

  test("unknown kind falls back to gesetze-im-internet (defensive default)", () => {
    const c = buildDocCitation({
      id: "unknown:1",
      kind: "ordinance",
      title: "Some ordinance",
    });
    assert.equal(c.publisher, "gesetze-im-internet.de");
    assert.equal(c.license, "Public-Domain");
  });

  test("canonical_ref + display_text + lookup unchanged (back-compat)", () => {
    const c = buildDocCitation({
      id: "bdsg_2018:1",
      kind: "statute",
      title: "BDSG § 1",
      citation: "§ 1 BDSG",
    });
    assert.equal(c.canonical_ref, "§ 1 BDSG");
    assert.equal(c.display_text, "BDSG § 1");
    assert.deepEqual(c.lookup, { tool: "get_provision", args: { id: "bdsg_2018:1" } });
  });
});

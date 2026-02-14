# Implementation Status

## Current baseline

- Template shell is in place and running.
- Germany adapter (`de`) is active.
- Citation parser/validator supports core forms:
  - `§ 823 Abs. 1 BGB`
  - `Art. 1 Abs. 1 GG`
- Adapter now prefers SQLite-backed corpus and falls back to fixture data only if no DB is available.
- Retrieval strategy is current-law focused (consolidated text + practical recent materials), matching Dutch/Swedish MCP usage rather than deep historical reconstruction.

## Tool surface

Implemented tools:

- `law.search_documents` (statutes/provisions)
- `law.search_case_law` (court + date filters)
- `law.get_preparatory_works` (citation/statute/query selectors)
- `law.format_citation` (default/short/pinpoint styles)
- `law.check_currency` (as-of aware current-corpus signal)
- `law.build_legal_stance` (statute + case-law + preparatory bundle)
- `law.get_eu_basis` (EU references for citation/statute/document)
- `law.search_eu_implementations` (EU act search + mapped statutes)
- `law.get_national_implementations` (national mappings for one EU act)
- `law.get_provision_eu_basis` (EU basis at document/provision granularity)
- `law.validate_eu_compliance` (mapping validation summary)
- `law.get_document`
- `law.parse_citation`
- `law.validate_citation`
- `law.run_ingestion`

## Ingestion pipeline

Implemented:

- `scripts/ingest_gesetze_im_internet.py`
  - pulls TOC from `gii-toc.xml`
  - downloads per-statute `xml.zip` packages
  - parses `norm` entries and section text
  - writes to SQLite tables: `statutes`, `law_documents`, `law_documents_fts`, `ingestion_runs`
- `scripts/ingest_rechtsprechung_im_internet.py`
  - pulls TOC from `rii-toc.xml`
  - downloads per-case `zip/xml` packages
  - parses ECLI/court/date/file-number/title/text
  - writes to `case_law_documents`, `case_law_documents_fts`
- `scripts/ingest_dip_bundestag.py`
  - fetches DIP API records (`/vorgang`) with cursor pagination
  - normalizes parliamentary process metadata
  - links to statute IDs where detectable from known statute abbreviations
  - writes to `preparatory_works`, `preparatory_works_fts`
- `scripts/auto_update_german_law.py`
  - runs incremental refresh cycles across all three sources
  - lock-protected (prevents overlapping jobs)
  - supports one-shot, cron-friendly, and daemon loop usage
  - includes early-stop thresholds for fast DIP/case deltas

Verified runs (February 14, 2026):

- Full TOC ingestion completed via repeated `--only-missing` batches.
- Targeted ingestion run for `bgb`, `gg`, `stgb` succeeded.
- Recent case-law batch ingestion succeeded (latest-first).
- Full DIP wahlperiode-20 ingestion succeeded.

Current database snapshot:

- statutes: `6870`
- provisions/documents: `91843`
- case law decisions: `5000` (configured practical window of latest decisions)
- preparatory works: `89423` (wahlperioden `19` + `20`)
- remaining statutes from current TOC snapshot: `0` (of `6870`)

## Verification checks completed

- `npm run validate` passes.
- Runtime search/get works against ingested DB.
- Example query resolved: `§ 823 BGB` -> `bgb:823`.
- `law.search_case_law` returns ingested decisions with filters.
- `law.get_preparatory_works` returns DIP records and supports citation-driven lookup.

## Remaining work for full production coverage

1. Add CI/cron orchestration for continuous incremental refresh and drift monitoring.
2. Extend case-law coverage with configurable rolling windows (for example 5k/10k recent decisions) and daily deltas.
3. Add parser conformance suites for additional German citation variants (`§§`, ranges, Nr., Buchst., etc.).
4. Tighten as-of-date currency semantics with explicit historical version timelines (current implementation is a consolidated-text signal).

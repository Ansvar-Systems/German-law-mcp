# German Law MCP

Germany-first law MCP server built from `template-law-mcp`, following the same quality principles used in the Dutch and Swedish law MCP projects:

- deterministic, source-backed outputs
- explicit citation parsing and validation
- test-gated behavior with no speculative legal citations
- practical current-law retrieval (not deep historical versioning by default)

## Current status

- Runtime shell is in place.
- `de` adapter is implemented and registered.
- Three source lanes are wired:
  - statutes: `gesetze-im-internet`
  - case law: `rechtsprechung-im-internet`
  - preparatory works: `dip-bundestag`
- German citation validation currently supports:
  - `§ 823 Abs. 1 BGB`
  - `Art. 1 Abs. 1 GG`
- SQLite-backed corpus is supported (`GERMAN_LAW_DB_PATH`).
- Initial sample legislation remains as fallback when no database is present.
- Advanced helpers are enabled:
  - citation formatting (`law.format_citation`)
  - currency checks (`law.check_currency`)
  - legal stance bundles (`law.build_legal_stance`)
  - EU linkage/compliance tools (`law.get_eu_basis`, `law.search_eu_implementations`, `law.get_national_implementations`, `law.get_provision_eu_basis`, `law.validate_eu_compliance`)

## Quick start

```bash
npm install
npm run validate
```

Run a tool call from stdin JSON:

```bash
echo '{"name":"law.list_countries","arguments":{}}' | npm run dev
```

Dry-run ingestion scope from official TOC:

```bash
python3 scripts/ingest_gesetze_im_internet.py --dry-run
```

Start ingestion:

```bash
python3 scripts/ingest_gesetze_im_internet.py
```

Ingest case law:

```bash
python3 scripts/ingest_rechtsprechung_im_internet.py --only-missing
```

Ingest preparatory works (current Bundestag period by default):

```bash
python3 scripts/ingest_dip_bundestag.py --only-missing
```

Ingest a subset first:

```bash
python3 scripts/ingest_gesetze_im_internet.py --max-laws 50
```

Ingest only laws missing from your local DB:

```bash
npm run ingest:missing
```

Run all sources incrementally:

```bash
npm run ingest:all:missing
```

Run one incremental auto-update cycle:

```bash
npm run auto-update
```

Run continuous update loop (every 30 minutes):

```bash
npm run auto-update:daemon
```

## Core tools

- `law.list_countries`
- `law.describe_country`
- `law.search_documents`
- `law.search_case_law`
- `law.get_preparatory_works`
- `law.format_citation`
- `law.check_currency`
- `law.build_legal_stance`
- `law.get_eu_basis`
- `law.search_eu_implementations`
- `law.get_national_implementations`
- `law.get_provision_eu_basis`
- `law.validate_eu_compliance`
- `law.get_document`
- `law.parse_citation`
- `law.validate_citation`
- `law.run_ingestion`

## 100% accuracy roadmap

Execution plan and acceptance gates are documented in:

- `docs/ACCURACY_PLAN.md`
- `docs/IMPLEMENTATION_STATUS.md`

This roadmap is designed to bring German coverage and reliability to production parity with the Dutch and Swedish MCPs.

Current ingestion status (February 14, 2026):

- statutes: `6870/6870` TOC coverage (`91843` provisions)
- case law: `5000` recent decisions ingested (latest-first practical window)
- preparatory works: `89423` DIP records (Wahlperiode `19` + `20`)

## Environment

See `.env.example`.

- `LAW_COUNTRIES`: comma-separated country filter (example: `de`)
- `GERMAN_LAW_DB_PATH`: override SQLite path (default `data/database.db`)
- `GERMAN_LAW_INGEST_MAX_LAWS`: optional cap used by `law.run_ingestion`
- `GERMAN_LAW_INGEST_MAX_CASES`: optional cap for case-law ingestion
- `GERMAN_LAW_INGEST_MAX_PREP_WORKS`: optional cap for preparatory-works ingestion
- `GERMAN_LAW_PREP_WAHLPERIODEN`: comma-separated DIP Wahlperioden (default `20`)
- `GERMAN_LAW_DIP_API_KEY`: optional DIP API key override
- `GERMAN_LAW_INGEST_CASES_STOP_AFTER_EXISTING`: optional case sync early-stop threshold
- `GERMAN_LAW_INGEST_PREP_STOP_AFTER_EXISTING`: optional preparatory sync early-stop threshold
- `GERMAN_LAW_AUTO_UPDATE_*`: defaults for auto-update cycle limits

## Architecture and adapter rollout

- `docs/ARCHITECTURE.md`
- `docs/COUNTRY_CHECKLIST.md`
- `docs/AUTO_UPDATE.md`

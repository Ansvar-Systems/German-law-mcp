# Architecture

The template separates shared MCP behavior from country-specific legal logic.

## Shared shell (`src/shell`)

- `types.ts`: domain and adapter contracts.
- `tool-contract.ts`: tool names and input schemas.
- `shell.ts`: request routing and capability checks.
- `adapter-registry.ts`: adapter registration and lookup.
- `errors.ts`: structured error type.
- `adapter-kit.ts`: reusable helper primitives for adapter implementations.

## Country layer (`src/adapters`)

Each country adapter implements `CountryAdapter`:

- metadata (`country`, `capabilities`)
- document handlers (`searchDocuments`, `getDocument`)
- case-law handler (`searchCaseLaw`)
- preparatory-works handler (`getPreparatoryWorks`)
- citation handlers (`parseCitation`, `validateCitation`)
- ingestion handler (`runIngestion`)

Adapters are registered centrally in `src/adapters/index.ts`.

## Entrypoint (`src/index.ts`)

- Reads JSON tool calls from stdin.
- Filters loaded countries via `LAW_COUNTRIES`.
- Dispatches tool calls through `LawMcpShell`.

## Germany data layer

- `src/db/german-law-db.ts` provides read access to:
  - `law_documents` (statutes/provisions)
  - `case_law_documents`
  - `preparatory_works`
- Ingestion scripts:
  - `scripts/ingest_gesetze_im_internet.py`
  - `scripts/ingest_rechtsprechung_im_internet.py`
  - `scripts/ingest_dip_bundestag.py`
  - `scripts/auto_update_german_law.py` (incremental orchestration)

## Why this structure

- New country work is isolated to adapter + tests.
- Shared runtime remains stable across countries.
- Common adapter code is reusable through `adapter-kit.ts`.

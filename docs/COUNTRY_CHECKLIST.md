# Country Adapter Checklist

Use this checklist whenever you scaffold a new country.

## 1. Source mapping

- Confirm official legislation sources (and license terms).
- Confirm case law and preparatory works sources if in scope.
- Decide update cadence (hourly/daily/manual).

## 2. Citation model

- Define country citation formats and edge cases.
- Replace template regex in `src/adapters/<code>.ts`.
- Add positive and negative citation tests in `test/<code>.adapter.test.ts`.

## 3. Document normalization

- Map source fields into `LawDocument`.
- Normalize date formats to ISO `YYYY-MM-DD`.
- Ensure stable document IDs.

## 4. Ingestion behavior

- Replace static ingestion runner with real ingestion job.
- Track ingest counts and skipped counts.
- Add retry/error strategy for upstream source failures.

## 5. Search quality

- Replace in-memory sample data with real index/storage.
- Verify query behavior for local language and diacritics.
- Add tests for exact citation, title search, and no-result cases.

## 6. Operational readiness

- Run `npm run validate`.
- Confirm adapter appears in `law.list_countries`.
- Confirm `law.describe_country` shows correct sources/capabilities.

## 7. Done criteria

- Country adapter has real sources.
- Citation parser/validator is country-correct.
- Ingestion is runnable in dry-run and normal mode.
- Tests cover core country behavior.

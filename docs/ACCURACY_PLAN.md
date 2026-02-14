# German Law MCP Accuracy Plan

This plan defines how we reach production-grade, source-grounded German legal retrieval with measurable quality gates.

## Target definition

"100% accuracy" means every returned citation/provision is traceable to an authoritative source and passes deterministic validation.

Quality dimensions:

- Citation accuracy: parsed + normalized citation is structurally correct.
- Retrieval accuracy: returned provision text corresponds to the requested citation/date.
- Currency accuracy: in-force status and version date are correct.
- Source fidelity: no generated legal content without source trace.

## Phase 1: Foundation (now)

Scope:

- Stable shell runtime and tool contracts.
- Germany adapter with deterministic citation parsing.
- Initial German fixture corpus.
- Unit tests for core adapter behavior.

Exit criteria:

- `npm run validate` passes.
- `law.describe_country` reports `de` correctly.
- German citation happy-path and rejection-path tests pass.

## Phase 2: Authoritative source mapping

Primary data sources:

- Federal law portal (`gesetze-im-internet.de`) for consolidated statute text.
- Federal jurisprudence portal (`rechtsprechung-im-internet.de`) for selected case law.
- Bundestag/Bundesrat material for preparatory works where available.
- EUR-Lex + national implementation references for EU linkage.

Tasks:

- Define source adapters and license constraints.
- Map source entities to normalized internal schema.
- Implement deterministic source IDs per document/provision/version.

Exit criteria:

- Source registry committed with update cadence and failure policy.
- At least 50 priority statutes ingested with section-level structure.

Status (February 14, 2026):

- Completed and exceeded for statutes (`6870` statutes, `91843` provisions).
- Case-law and preparatory-works source lanes are implemented and operational:
  - `5000` recent case-law decisions ingested (latest-first strategy).
  - `89423` preparatory works ingested for Bundestag Wahlperioden `19` and `20`.

## Phase 3: Citation and parser conformance

Tasks:

- Expand citation grammar:
  - `§`, `§§`, ranges, litera (`a`, `b`)
  - `Art.` references
  - Absatz/Satz/Nr./Buchst.
  - common abbreviation variants (`Abs`, `Satz`, `Nr`)
- Build positive/negative conformance suites.
- Add statute-specific normalization rules.

Exit criteria:

- Parser precision >= 99.5% on curated citation corpus.
- Zero false positives on negative corpus.

## Phase 4: Provision and temporal correctness

Tasks:

- Provision-level storage with effective-date/version metadata.
- `get_provision`-style retrieval behavior on top of current shell tools.
- Historical lookup tests (as-of date scenarios).

Exit criteria:

- Version-selection correctness >= 99% on dated regression set.
- Currency checks validated against source dates for test corpus.

## Phase 5: Cross-source verification and release gate

Tasks:

- Differential checks against source snapshots.
- Regression pack built from manually verified citations.
- CI gate: fail build on citation/parser/retrieval regressions.

Exit criteria:

- 100% pass rate on verified regression corpus.
- No unresolved high-severity mismatches in latest audit run.

## Immediate implementation backlog

1. Expand citation parser conformance corpus (edge formats + negative tests).
2. Add automated refresh cadence and drift checks for all three sources.
3. Add rolling case-law coverage policy (for example latest `N` decisions with daily delta sync).
4. Add as-of-date retrieval primitives for stricter temporal correctness.
5. Harden EU linkage precision with dedicated EUR-Lex/CELEX alignment and regression checks (baseline linkage primitives are implemented).

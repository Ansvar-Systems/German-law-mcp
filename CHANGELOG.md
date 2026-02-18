# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] - 2026-02-18

### Added
- `law_list_sources` tool for data provenance metadata
- `law_about` tool for server metadata (version, tier, statistics)
- FTS5 double-quote escaping to prevent parse errors on untrusted input
- FTS query unit tests (`test/fts-query.test.ts`)
- Golden tests: de-013 (list_sources), de-014 (about), de-015 (German special chars), de-016 (SQL injection)
- DELETE method handling in Streamable HTTP transport
- Promise-based mutex for database download race condition prevention
- Error logging in all database query catch blocks

### Changed
- All tool descriptions enriched with detailed parameter documentation, examples, and edge case guidance
- Version management: `api/health.ts`, `api/mcp.ts`, `src/shell/shell.ts` now read version from `package.json`
- Health endpoint dynamically reports tier and capabilities from database metadata
- `server.json` version synced to 0.3.1
- Contract test runner handles `sources` and `results` arrays in addition to `documents`
- CLAUDE.md expanded with full project guide (structure, patterns, conventions)

### Fixed
- Hardcoded `tier: 'free'` in health endpoint replaced with dynamic detection
- Non-POST methods (DELETE, PUT, PATCH) no longer fall through to MCP handler
- Database download no longer races on concurrent cold starts

### Security
- FTS5 query injection via unmatched double quotes now mitigated

## [0.2.0] - 2026-02-14

### Added
- Full CI/CD pipeline (11 GitHub Actions workflows)
- Security scanning (CodeQL, Trivy, Semgrep, Gitleaks, OSSF Scorecard, Socket Security)
- Docker container scanning with SBOM generation (CycloneDX, SPDX)
- Daily data freshness checks against gesetze-im-internet.de
- Tag-triggered npm + MCP Registry publishing with provenance
- Public release documentation (`CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`)
- Repository license file (`LICENSE`, Apache-2.0)
- CI/Security badges in README

### Changed
- Package metadata: removed `private: true`, added npm registry fields
- README updated with CI/CD section and badges

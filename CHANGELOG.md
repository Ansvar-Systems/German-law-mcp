# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

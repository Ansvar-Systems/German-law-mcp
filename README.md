# German Law MCP

[![npm version](https://badge.fury.io/js/@ansvar%2Fgerman-law-mcp.svg)](https://www.npmjs.com/package/@ansvar/german-law-mcp)
[![MCP Registry](https://img.shields.io/badge/MCP-Registry-blue)](https://registry.modelcontextprotocol.io)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![CI](https://github.com/Ansvar-Systems/German-law-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Ansvar-Systems/German-law-mcp/actions/workflows/ci.yml)
[![Daily Data Check](https://github.com/Ansvar-Systems/German-law-mcp/actions/workflows/check-updates.yml/badge.svg)](https://github.com/Ansvar-Systems/German-law-mcp/actions/workflows/check-updates.yml)

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

## Quick Start

### Use Remotely (No Install Needed)

> Connect directly to the hosted version — zero dependencies, nothing to install.

**Endpoint:** `https://german-law-mcp.vercel.app/mcp`

| Client | How to Connect |
|--------|---------------|
| **Claude.ai** | Settings > Connectors > Add Integration > paste URL |
| **Claude Code** | `claude mcp add german-law --transport http https://german-law-mcp.vercel.app/mcp` |
| **Claude Desktop** | Add to config (see below) |
| **GitHub Copilot** | Add to VS Code settings (see below) |

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "german-law": {
      "type": "url",
      "url": "https://german-law-mcp.vercel.app/mcp"
    }
  }
}
```

**GitHub Copilot** — add to VS Code `settings.json`:

```json
{
  "github.copilot.chat.mcp.servers": {
    "german-law": {
      "type": "http",
      "url": "https://german-law-mcp.vercel.app/mcp"
    }
  }
}
```

### Use Locally (npm)

```bash
npx @ansvar/german-law-mcp
```

**Claude Desktop** — add to `claude_desktop_config.json`:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "german-law": {
      "command": "npx",
      "args": ["-y", "@ansvar/german-law-mcp"]
    }
  }
}
```

**Cursor / VS Code:**

```json
{
  "mcp.servers": {
    "german-law": {
      "command": "npx",
      "args": ["-y", "@ansvar/german-law-mcp"]
    }
  }
}
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

## CI/CD & Security

This repository uses [GitHub Actions](.github/workflows/) for automated quality and security enforcement:

| Workflow | Schedule | Purpose |
|----------|----------|---------|
| [CI](.github/workflows/ci.yml) | Push / PR | Build, test (Node 20/22), type check |
| [CodeQL](.github/workflows/codeql.yml) | Push / PR / Weekly | Semantic code analysis (security-extended queries) |
| [Trivy](.github/workflows/trivy.yml) | Push / PR / Daily | Dependency vulnerability scanning (SARIF) |
| [Semgrep](.github/workflows/semgrep.yml) | Push / PR | SAST — OWASP Top 10, secrets, JS/TS rules |
| [Gitleaks](.github/workflows/gitleaks.yml) | Push / PR | Secret scanning across full git history |
| [OSSF Scorecard](.github/workflows/ossf-scorecard.yml) | Push / Weekly | Repository security hygiene scoring |
| [Socket Security](.github/workflows/socket-security.yml) | Push / PR | Supply chain attack detection |
| [Docker Security](.github/workflows/docker-security.yml) | Push / PR / Daily | Container image scanning + SBOM (CycloneDX, SPDX) |
| [Data Freshness](.github/workflows/check-updates.yml) | Daily | gesetze-im-internet.de update check, auto-issue creation |
| [Publish](.github/workflows/publish.yml) | Tag `v*` | npm publish (with provenance) + MCP Registry |
| [MCPB Bundle](.github/workflows/mcpb-bundle.yml) | Tag `v*` | MCPB distribution bundle |

## Important Disclaimers

### Legal Advice

> **THIS TOOL IS NOT LEGAL ADVICE**
>
> Statute text is sourced from official gesetze-im-internet.de publications. However:
> - This is a **research tool**, not a substitute for professional legal counsel
> - **Court case coverage is limited** -- do not rely solely on this for case law research
> - **Verify critical citations** against primary sources for court filings
> - **EU cross-references** are extracted from German statute text, not EUR-Lex full text

### Client Confidentiality

Queries go through the Claude API. For privileged or confidential matters, use on-premise deployment. Lawyers should consider Bundesrechtsanwaltskammer (German Federal Bar Association) confidentiality obligations when using cloud-based AI tools.

## Related Projects: Complete Compliance Suite

This server is part of **Ansvar's Compliance Suite** -- MCP servers that work together for end-to-end compliance coverage:

### [@ansvar/eu-regulations-mcp](https://github.com/Ansvar-Systems/EU_compliance_MCP)
**Query 49 EU regulations directly from Claude** -- GDPR, AI Act, DORA, NIS2, MiFID II, eIDAS, and more. Full regulatory text with article-level search. `npx @ansvar/eu-regulations-mcp`

### @ansvar/german-law-mcp (This Project)
**Query 6,870 German statutes directly from Claude** -- BGB, StGB, GG, and more. Full provision text with EU cross-references. `npx @ansvar/german-law-mcp`

### [@ansvar/dutch-law-mcp](https://github.com/Ansvar-Systems/Dutch-law-mcp)
**Query 3,248 Dutch statutes directly from Claude** -- BW, Sr, Awb, and more. Full provision text with EU cross-references. `npx @ansvar/dutch-law-mcp`

### [@ansvar/swedish-law-mcp](https://github.com/Ansvar-Systems/swedish-law-mcp)
**Query 717 Swedish statutes directly from Claude** -- DSL, BrB, ABL, MB, and more. Full provision text with EU cross-references. `npx @ansvar/swedish-law-mcp`

### [@ansvar/slovenian-law-mcp](https://github.com/Ansvar-Systems/Slovenian-law-mcp)
**Query Slovenian statutes directly from Claude** -- ZVOP-2, KZ-1, ZGD-1, and more. Full provision text with EU cross-references. `npx @ansvar/slovenian-law-mcp`

### [@ansvar/us-regulations-mcp](https://github.com/Ansvar-Systems/US_Compliance_MCP)
**Query US federal and state compliance laws** -- HIPAA, CCPA, SOX, GLBA, FERPA, and more. `npm install @ansvar/us-regulations-mcp`

### [@ansvar/ot-security-mcp](https://github.com/Ansvar-Systems/ot-security-mcp)
**Query IEC 62443, NIST 800-82/53, and MITRE ATT&CK for ICS** -- Specialized for OT/ICS environments. `npx @ansvar/ot-security-mcp`

### [@ansvar/automotive-cybersecurity-mcp](https://github.com/Ansvar-Systems/Automotive-MCP)
**Query UNECE R155/R156 and ISO 21434** -- Automotive cybersecurity compliance. `npx @ansvar/automotive-cybersecurity-mcp`

### [@ansvar/sanctions-mcp](https://github.com/Ansvar-Systems/Sanctions-MCP)
**Offline-capable sanctions screening** -- OFAC, EU, UN sanctions lists. `pip install ansvar-sanctions-mcp`

## Citation

If you use this MCP server in academic research:

```bibtex
@software{german_law_mcp_2025,
  author = {Ansvar Systems AB},
  title = {German Law MCP Server: Production-Grade Legal Research Tool},
  year = {2025},
  url = {https://github.com/Ansvar-Systems/German-law-mcp},
  note = {Comprehensive German legal database with 6,870 statutes, 91,843 provisions, and EU cross-references}
}
```

## Legal

- License: Apache-2.0
- Security policy: see `SECURITY.md`
- Contribution guidelines: see `CONTRIBUTING.md`

### Data Licenses

- **Statutes & Regulations:** gesetze-im-internet.de (public domain, German federal government)
- **Case Law:** rechtsprechung-im-internet.de (public domain)
- **Preparatory Works:** DIP Bundestag (public domain)
- **EU Metadata:** EUR-Lex (EU public domain)

## About Ansvar Systems

We build AI-accelerated compliance and legal research tools for the European market. This MCP server is part of our growing suite of jurisdiction-specific legal research tools.

**[ansvar.eu](https://ansvar.eu)** -- Stockholm, Sweden

## Architecture and adapter rollout

- `docs/ARCHITECTURE.md`
- `docs/COUNTRY_CHECKLIST.md`
- `docs/AUTO_UPDATE.md`

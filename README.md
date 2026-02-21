# German Law MCP Server

**The gesetze-im-internet.de alternative for the AI age.**

[![npm version](https://badge.fury.io/js/@ansvar%2Fgerman-law-mcp.svg)](https://www.npmjs.com/package/@ansvar/german-law-mcp)
[![MCP Registry](https://img.shields.io/badge/MCP-Registry-blue)](https://registry.modelcontextprotocol.io)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![GitHub stars](https://img.shields.io/github/stars/Ansvar-Systems/German-law-mcp?style=social)](https://github.com/Ansvar-Systems/German-law-mcp)
[![CI](https://github.com/Ansvar-Systems/German-law-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Ansvar-Systems/German-law-mcp/actions/workflows/ci.yml)
[![Daily Data Check](https://github.com/Ansvar-Systems/German-law-mcp/actions/workflows/check-updates.yml/badge.svg)](https://github.com/Ansvar-Systems/German-law-mcp/actions/workflows/check-updates.yml)

Query **6,870 German federal statutes** -- from the BGB and StGB to the GG, BDSG, and more -- directly from Claude, Cursor, or any MCP-compatible client.

If you're building legal tech, compliance tools, or doing German legal research, this is your verified reference database.

Built by [Ansvar Systems](https://ansvar.eu) -- Stockholm, Sweden

---

## Why This Exists

German legal research is scattered across gesetze-im-internet.de, dejure.org, rechtsprechung-im-internet.de, and DIP Bundestag. Whether you're:
- A **Rechtsanwalt** validating citations in a Schriftsatz or contract
- A **compliance officer** checking if a statute is still in force
- A **legal tech developer** building tools on German law
- A **researcher** tracing legislative history from Drucksache to statute

...you shouldn't need 47 browser tabs and manual PDF cross-referencing. Ask Claude. Get the exact provision. With context.

This MCP server makes German law **searchable, cross-referenceable, and AI-readable**.

---

## Quick Start

### Use Remotely (No Install Needed)

> Connect directly to the hosted version -- zero dependencies, nothing to install.

**Endpoint:** `https://german-law-mcp.vercel.app/mcp`

| Client | How to Connect |
|--------|---------------|
| **Claude.ai** | Settings > Connectors > Add Integration > paste URL |
| **Claude Code** | `claude mcp add german-law --transport http https://german-law-mcp.vercel.app/mcp` |
| **Claude Desktop** | Add to config (see below) |
| **GitHub Copilot** | Add to VS Code settings (see below) |

**Claude Desktop** -- add to `claude_desktop_config.json`:

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

**GitHub Copilot** -- add to VS Code `settings.json`:

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

**Claude Desktop** -- add to `claude_desktop_config.json`:

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

## Example Queries

Once connected, just ask naturally:

- *"Was sagt § 823 Abs. 1 BGB über Schadensersatz?"*
- *"Ist das BDSG 2018 noch in Kraft?"*
- *"Find provisions about Datenschutz in German law"*
- *"What EU directives does the BDSG implement?"*
- *"Which German laws implement the GDPR?"*
- *"Get the preparatory works for the IT-Sicherheitsgesetz"*
- *"Validate the citation § 433 BGB"*
- *"Search for Kündigungsschutz in case law"*
- *"Compare DSGVO implementation across German statutes"*

---

## What's Included

| Category | Count | Details |
|----------|-------|---------|
| **Statutes** | 6,870 laws | Complete German federal legislation |
| **Provisions** | 91,843 sections | Full-text searchable with FTS5 |
| **Case Law** | 5,000 decisions | BVerfG, BGH, BVerwG, BAG, BSG, BFH, BPatG |
| **Preparatory Works** | 89,423 records | Drucksachen + Plenarprotokolle (WP 19 + 20) |
| **Database Size** | ~300 MB | Runtime download on cold start (Strategy B) |
| **Daily Updates** | Automated | Freshness checks against gesetze-im-internet.de |

**Verified data only** -- every provision is ingested from official government sources. Zero LLM-generated content.

---

## See It In Action

### Why This Works

**Verbatim Source Text (No LLM Processing):**
- All statute text is ingested from gesetze-im-internet.de official XML exports
- Provisions are returned **unchanged** from SQLite FTS5 database rows
- Zero LLM summarization or paraphrasing -- the database contains regulation text, not AI interpretations

**Smart Context Management:**
- Search returns ranked provisions with BM25 scoring (safe for context)
- Three-tier search strategy: exact citation match → FTS5 full-text → LIKE fallback
- Cross-references help navigate without loading everything at once

**Technical Architecture:**
```
gesetze-im-internet.de → Parse XML → SQLite → FTS5 snippet() → MCP response
                  ↑                          ↑
           Provision parser           Verbatim database query
```

### Traditional Research vs. This MCP

| Traditional Approach | This MCP Server |
|---------------------|-----------------|
| Search gesetze-im-internet.de by law name | Search by plain German: *"Datenschutz Arbeitnehmer"* |
| Navigate multi-section statutes manually | Get the exact provision with context |
| Manual cross-referencing between laws | `law_build_legal_stance` aggregates across sources |
| "Is this statute still in force?" → check manually | `law_check_currency` → answer in seconds |
| Find EU basis → dig through EUR-Lex | `law_get_eu_basis` → linked EU directives instantly |
| Check DIP Bundestag for legislative history | `law_get_preparatory_works` → structured results |
| No API, no integration | MCP protocol → AI-native |

**Traditional:** Search gesetze-im-internet.de → Download XML → Ctrl+F → Cross-reference with Drucksache → Check EUR-Lex for EU basis → Repeat

**This MCP:** *"What EU law is the basis for § 1 BDSG?"* → Done.

---

## Available Tools (19)

### Core Legal Research Tools (8)

| Tool | Description |
|------|-------------|
| `law_search_documents` | FTS5 search on 91,843 provisions with BM25 ranking |
| `law_get_document` | Retrieve specific provision by document ID |
| `law_search_case_law` | Search 5,000 federal court decisions with court/date filters |
| `law_get_preparatory_works` | Get Drucksachen and Plenarprotokolle for a statute |
| `law_validate_citation` | Validate citation against database (zero-hallucination check) |
| `law_build_legal_stance` | Aggregate citations from statutes, case law, prep works |
| `law_format_citation` | Format citations per German conventions (default/short/pinpoint) |
| `law_check_currency` | Check if statute is in force in the ingested corpus |

### Citation Tools (2)

| Tool | Description |
|------|-------------|
| `law_parse_citation` | Parse `§ 823 Abs. 1 BGB` or `Art. 1 Abs. 1 GG` into structured components |
| `law_validate_citation` | Check if a citation exists in the database |

### EU Law Integration Tools (5)

| Tool | Description |
|------|-------------|
| `law_get_eu_basis` | Get EU directives/regulations for a German statute |
| `law_get_national_implementations` | Find German laws implementing an EU act |
| `law_search_eu_implementations` | Search EU documents with German implementation counts |
| `law_get_provision_eu_basis` | Get EU law references for specific provision |
| `law_validate_eu_compliance` | Check implementation status |

### Discovery & Metadata Tools (4)

| Tool | Description |
|------|-------------|
| `law_list_countries` | List available country adapters and capabilities |
| `law_describe_country` | Detailed country capability information |
| `law_list_sources` | Data provenance and source metadata |
| `law_about` | Server version, tier, statistics, and freshness |

> **Note:** Most tools require a `country` parameter. Use `"de"` for Germany.

---

## Data Sources & Freshness

All content is sourced from authoritative German legal databases:

- **[gesetze-im-internet.de](https://www.gesetze-im-internet.de/)** -- Federal Ministry of Justice, all consolidated federal statutes
- **[rechtsprechung-im-internet.de](https://www.rechtsprechung-im-internet.de/)** -- Federal court decisions (BVerfG, BGH, BVerwG, BAG, BSG, BFH, BPatG)
- **[DIP Bundestag](https://dip.bundestag.de/)** -- Legislative preparatory works (Drucksachen, Plenarprotokolle)
- **[EUR-Lex](https://eur-lex.europa.eu/)** -- EU cross-reference metadata

### Automated Freshness Checks (Daily)

A [daily GitHub Actions workflow](.github/workflows/check-updates.yml) monitors all data sources:

| Source | Check | Method |
|--------|-------|--------|
| **Statute amendments** | gesetze-im-internet.de XML index | All 6,870 statutes checked |
| **New statutes** | New entries in federal gazette | Diffed against database |
| **Case law** | rechtsprechung-im-internet.de feed | Compared to database |
| **Preparatory works** | DIP API query (30-day window) | New records detected |

---

## Security

This project uses multiple layers of automated security scanning:

| Scanner | What It Does | Schedule |
|---------|-------------|----------|
| **CodeQL** | Static analysis for security vulnerabilities | Weekly + PRs |
| **Semgrep** | SAST scanning (OWASP top 10, secrets, TypeScript) | Every push |
| **Gitleaks** | Secret detection across git history | Every push |
| **Trivy** | CVE scanning on filesystem and npm dependencies | Daily |
| **Docker Security** | Container image scanning + SBOM generation | Daily |
| **Socket.dev** | Supply chain attack detection | PRs |
| **OSSF Scorecard** | OpenSSF best practices scoring | Weekly |

See [SECURITY.md](SECURITY.md) for the full policy and vulnerability reporting.

---

## Important Disclaimers

### Legal Advice

> **THIS TOOL IS NOT LEGAL ADVICE**
>
> Statute text is sourced from official gesetze-im-internet.de publications. However:
> - This is a **research tool**, not a substitute for professional legal counsel
> - **Court case coverage is limited** (5,000 decisions) -- do not rely solely on this for case law research
> - **Verify critical citations** against primary sources for court filings
> - **EU cross-references** are extracted from German statute text, not EUR-Lex full text

**Before using professionally, read:** [DISCLAIMER.md](DISCLAIMER.md) | [PRIVACY.md](PRIVACY.md)

### Client Confidentiality

Queries go through the Claude API. For privileged or confidential matters, use on-premise deployment. Lawyers should consider Bundesrechtsanwaltskammer (BRAK) confidentiality obligations when using cloud-based AI tools. See [PRIVACY.md](PRIVACY.md) for compliance guidance.

---

## Documentation

- **[Architecture](docs/ARCHITECTURE.md)** -- Multi-country adapter architecture
- **[Accuracy Plan](docs/ACCURACY_PLAN.md)** -- Roadmap to production accuracy
- **[Auto Update](docs/AUTO_UPDATE.md)** -- Automated data freshness system
- **[Security Policy](SECURITY.md)** -- Vulnerability reporting and scanning details
- **[Disclaimer](DISCLAIMER.md)** -- Legal disclaimers and professional use notices
- **[Privacy](PRIVACY.md)** -- Client confidentiality and data handling

---

## Development

### Branching Strategy

This repository uses a `dev` integration branch. **Do not push directly to `main`.**

```
feature-branch → PR to dev → verify on dev → PR to main → deploy
```

- `main` is production-ready. Only receives merges from `dev` via PR.
- `dev` is the integration branch. All changes land here first.
- Feature branches are created from `dev`.

### Setup

```bash
git clone https://github.com/Ansvar-Systems/German-law-mcp
cd German-law-mcp
npm install
npm run build
npm test
```

### Running Locally

```bash
npm run dev                                       # Start MCP server
npx @anthropic/mcp-inspector node dist/src/index.js   # Test with MCP Inspector
```

### Data Management

```bash
npm run ingest                    # Ingest statutes from gesetze-im-internet.de
npm run ingest:cases              # Ingest case law from rechtsprechung-im-internet.de
npm run ingest:prep               # Ingest preparatory works from DIP Bundestag
npm run auto-update               # Run full update cycle
npm run auto-update:dry-run       # Preview what would be updated
npm run drift:detect              # Detect schema/data drift
```

### Performance

- **Search Speed:** <100ms for most FTS5 queries
- **Database Size:** ~300 MB (runtime download, Strategy B)
- **Ingestion Coverage:** 6,870/6,870 statutes (100% TOC coverage)

---

## Related Projects: Complete Compliance Suite

This server is part of **Ansvar's Compliance Suite** -- MCP servers that work together for end-to-end compliance coverage:

### [@ansvar/eu-regulations-mcp](https://github.com/Ansvar-Systems/EU_compliance_MCP)
**Query 49 EU regulations directly from Claude** -- GDPR, AI Act, DORA, NIS2, MiFID II, eIDAS, and more. Full regulatory text with article-level search. `npx @ansvar/eu-regulations-mcp`

### @ansvar/german-law-mcp (This Project)
**Query 6,870 German statutes directly from Claude** -- BGB, StGB, GG, BDSG, and more. Full provision text with EU cross-references. `npx @ansvar/german-law-mcp`

### [@ansvar/dutch-law-mcp](https://github.com/Ansvar-Systems/Dutch-law-mcp)
**Query 3,248 Dutch statutes directly from Claude** -- BW, Sr, Awb, and more. Full provision text with EU cross-references. `npx @ansvar/dutch-law-mcp`

### [@ansvar/swedish-law-mcp](https://github.com/Ansvar-Systems/Swedish-law-mcp)
**Query 717 Swedish statutes directly from Claude** -- DSL, BrB, ABL, MB, and more. Full provision text with EU cross-references. `npx @ansvar/swedish-law-mcp`

### [@ansvar/us-regulations-mcp](https://github.com/Ansvar-Systems/US_Compliance_MCP)
**Query US federal and state compliance laws** -- HIPAA, CCPA, SOX, GLBA, FERPA, and more. `npx @ansvar/us-regulations-mcp`

### [@ansvar/automotive-cybersecurity-mcp](https://github.com/Ansvar-Systems/Automotive-MCP)
**Query UNECE R155/R156 and ISO 21434** -- Automotive cybersecurity compliance. `npx @ansvar/automotive-cybersecurity-mcp`

---

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Priority areas:
- Lower court decisions (Landesgerichte, Oberlandesgerichte)
- Historical statute versions and amendment tracking (Fassungsvergleich)
- Expanded case law coverage (currently 5,000 of ~50,000+ published decisions)
- State law (Landesrecht) for major Bundesländer

---

## Roadmap

- [x] **Full statute coverage** -- 6,870 federal statutes, 91,843 provisions
- [x] **Case law** -- 5,000 federal court decisions
- [x] **Preparatory works** -- 89,423 DIP records (WP 19 + 20)
- [x] **EU cross-references** -- Extracted from statute text
- [x] **Citation parsing** -- `§ 823 Abs. 1 BGB` and `Art. 1 Abs. 1 GG` formats
- [x] **Free/Professional tier gating** -- Honest messaging for tier limitations
- [ ] Expanded case law (full archive, ~50,000+ decisions)
- [ ] Lower court coverage (Landesgerichte)
- [ ] Historical statute versions (Fassungsvergleich)
- [ ] State law (Landesrecht)
- [ ] English translations for key statutes

---

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

---

## License

Apache License 2.0. See [LICENSE](./LICENSE) for details.

### Data Licenses

- **Statutes & Regulations:** gesetze-im-internet.de (public domain, German federal government)
- **Case Law:** rechtsprechung-im-internet.de (public domain)
- **Preparatory Works:** DIP Bundestag (public domain)
- **EU Metadata:** EUR-Lex (EU public domain)

---

## About Ansvar Systems

We build AI-accelerated compliance and legal research tools for the European market. This MCP server started as our internal reference tool for German law -- turns out everyone building for the DACH market has the same research frustrations.

So we're open-sourcing it. Navigating 6,870 statutes shouldn't require a law degree.

**[ansvar.eu](https://ansvar.eu)** -- Stockholm, Sweden

---

<p align="center">
  <sub>Built with care in Stockholm, Sweden</sub>
</p>

# Contributing

Thanks for contributing to German Law MCP.

## Prerequisites

- Node.js 20+
- Python 3.10+ (for ingestion scripts)
- npm

## Development Setup

```bash
npm install
npm run validate
```

## Common Commands

- `npm run dev` - run stdio MCP server from TypeScript source
- `npm run build` - compile TypeScript to `dist/`
- `npm test` - build and run test suite
- `npm run typecheck` - type-check without emitting
- `npm run validate` - typecheck + test
- `npm run auto-update` - run one incremental update cycle
- `npm run ingest:all:missing` - ingest all missing data incrementally

## Pull Request Guidelines

- Keep changes focused and scoped
- Include tests for behavior changes when possible
- Update docs when adding/changing tools, scripts, configuration, or API behavior
- Ensure `npm run validate` passes before requesting review

## Commit Style

Use clear commit messages, ideally Conventional Commits:

- `feat: add provision history filter`
- `fix: handle missing citation in tool input`
- `docs: update setup instructions`

## Data and Legal Notes

- Source data originates from public legal information systems (gesetze-im-internet.de, rechtsprechung-im-internet.de, DIP Bundestag)
- Do not commit credentials or private data
- This project is a research/compliance tooling interface, not legal advice

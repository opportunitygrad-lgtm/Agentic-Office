# AI Business OS

A multi-company AI Business Operating System: a visual command centre where AI
agents work for multiple companies under human governance — tasks, approvals,
budgets and a complete audit trail. AI providers (Claude, OpenAI, Grok, local
logic) are replaceable workers behind one interface.

**Status:** Stage 01 — Foundation complete. See [docs/BUILD_LEDGER.md](docs/BUILD_LEDGER.md).

```bash
cp .env.example .env && pnpm install && pnpm infra:up && pnpm db:migrate && pnpm db:seed && pnpm dev
```

- [Architecture](docs/ARCHITECTURE.md) · [Data model](docs/DATA_MODEL.md) · [Development](docs/DEVELOPMENT.md)
- [Security](docs/SECURITY.md) · [Roadmap](docs/ROADMAP.md) · [Build ledger](docs/BUILD_LEDGER.md)

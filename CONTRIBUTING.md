# Contributing

Thanks for your interest! This is a small project, but contributions are
welcome.

## Getting set up

See the [Getting Started](https://github.com/AlperenTurkmen/world_cup_prediction/wiki/Getting-Started)
wiki page (or [`DEPLOY.md`](DEPLOY.md)) for local setup. In short:

```bash
npm install
cp .env.example .env.local   # fill in the values
npm run dev
```

## Before you open a pull request

- **Run the checks.** `npm test` (unit tests) and `npm run build` (the most
  thorough typecheck) must both pass.
- **Tests are required for load-bearing logic.** Any change to the workbook
  parser, scoring/bracket derivation, or the results sync must keep the existing
  `*.test.ts` suites green, and ideally add coverage. These run against the
  master workbook fixture — see the validation gates in
  [`CLAUDE.md`](CLAUDE.md) / [`AGENTS.md`](AGENTS.md).
- **Match the surrounding style.** Follow the conventions in the files you're
  editing; there's no separate formatter step to run.

## Architectural rules to respect

A few constraints are easy to break and important to preserve:

- **Supabase is server-only** — never import the service-role client into a
  Client Component.
- **Scoring lives in SQL**, computed on read; weights are tunable only in the
  `scoring_weights` and `round_weights` tables.
- **Database changes** go in both `db/schema.sql` and `db/migration.sql`; DDL
  can't be applied from app code.

The full picture is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Reporting bugs & ideas

Open a GitHub issue with steps to reproduce (for bugs) or the use case (for
features). For anything security-sensitive, see [`SECURITY.md`](SECURITY.md)
instead of filing a public issue.

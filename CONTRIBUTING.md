# Contributing to Artifex

Everything here is the working convention of this repository, written once so
that [AGENTS.md](AGENTS.md) can point at it instead of restating it. Read
[AGENTS.md](AGENTS.md) first for what the repository is and where things live.

## Before a change

Node 20 or later. No build step and no dependencies, so a clone runs as it is.

```bash
npm run check
```

That is lint and the 164 tests, about ten seconds, and it is the one command to
run after a change. `npm run negative` is the 85-mutation suite and takes about
seventeen minutes — run it when the change touches a check, a contract key or an
invariant, not after every edit. [AGENTS.md](AGENTS.md) has the full command
table.

**The first question asked of a new primitive, default or example:** does it
only make sense for one kind of picture? Then it is a defect, not a convenience.

## Documentation conventions

**The tracked documentation is four files**: [README.md](README.md),
[AGENTS.md](AGENTS.md), this file and
[skills/artifex/SKILL.md](skills/artifex/SKILL.md). What a reader of the public
repository needs goes in one of them.

**`docs/` is local and git-ignored**, so a clone has none. No tracked file
links, points or cites into it. A code comment that needs a fact states the
fact.

**Absolute paths on a contributor's own machine do not belong in a tracked
file.** This repository is public. `%APPDATA%` and `C:\Program Files` paths are
the same everywhere and are fine.

## When you change code

Changing `core/` usually means changing
[skills/artifex/SKILL.md](skills/artifex/SKILL.md) too, in the same commit.

`ROADMAP.jsonl` is Foreman's ledger. Edit it through the `foreman` skill, not by
hand.

The three host manifests are `plugin.json`, `.claude-plugin/plugin.json` and
`.codex-plugin/plugin.json`. The last two are byte-identical, and the root one
adds only `$schema`. There is no build step: edit all three or they drift.
Two catalogs make the repository installable: `.claude-plugin/marketplace.json`
for Claude Code and `.agents/plugins/marketplace.json` for Codex. Both name the
plugin `artifex` and point at `./`. `agy plugin validate .` and
`claude plugin validate .claude-plugin/plugin.json` check the manifests; the
second warns about the root `CLAUDE.md`, which is expected.
`claude plugin validate .` checks the catalog.

## Rejected alternatives

Kept so the same questions are not reopened without new evidence.

**A docs-lint tool to catch stale counts** in `README.md`, `AGENTS.md` and
`skills/artifex/SKILL.md`. A tool to watch three files is more code than the
three fixes.

## Reporting

There is no public issue tracker yet. See **Support** in [README.md](README.md).

# Contributing to Artifex

Everything here is the working convention of this repository, written once so
that [AGENTS.md](AGENTS.md) can point at it instead of restating it. Read
[AGENTS.md](AGENTS.md) first for what the repository is, where things live and
how the documents are shelved.

## Before a change

Node 20 or later. No build step and no dependencies, so a clone runs as it is.

```bash
npm run check
```

That is lint and the 162 tests, about ten seconds, and it is the one command to
run after a change. `npm run negative` is the 81-mutation suite and takes about
seventeen minutes — run it when the change touches a check, a contract key or an
invariant, not after every edit. [AGENTS.md](AGENTS.md) has the full command
table.

**The first question asked of a new primitive, default or example:** does it
only make sense for one kind of picture? Then it is a defect, not a convenience.
The eight testable forms are in
[docs/knowledge/subject-neutrality.md](docs/knowledge/subject-neutrality.md).

## Documentation conventions

**The folder is the `type`.** A path says what to expect before the file is
opened.

| folder | `type` | what it promises |
|---|---|---|
| `docs/knowledge/` | `knowledge` | must always be true, and is kept current |
| `docs/decisions/` | `adr` | a decision, with its cost and what would overturn it |
| `docs/tasks/` | `task_summary` | was true on the day it was written, and is not rewritten |

**Every document opens with YAML frontmatter** — `type`, `summary`,
`related_files`, plus `status` on a `task_summary` — so the right document is
found by searching that metadata rather than by opening all of them.
`grep -r "^summary:" docs/` is the index, and there is no hand-kept one.

```yaml
---
type: knowledge
summary: "What this document covers and when to consult it."
related_files: []
---
```

**One document per topic**, with a stable kebab-case name and no date in it, so
a citation stays good. Add to the topic's document rather than starting a
sibling. Git is the history — no versioned filenames and no archive folders.

**A live task gets one tracking note in `docs/tasks/`**, with `status: active`
and a topic name like every other document: no date and no id in the filename.
At closure its durable findings move into the topic documents, and the note
either stays as the dated report or goes.

**A number inside a dated section keeps its date** instead of being refreshed.
`docs/tasks/field-test-findings.md` saying "96 tests" is evidence, not a stale
count. A `knowledge` document that measures this repository says when, as in
"Measured 2026-09-20", so a later reader can tell evidence from a stale count.

**Citations are by section**, as in `docs/knowledge/imported-sources.md §18.1`.

**Absolute paths on a contributor's own machine do not belong in a tracked
file.** This repository is public. `%APPDATA%` and `C:\Program Files` paths are
the same everywhere and are fine.

## When you change code

When you change `core/`, check the documents whose `related_files` cover what
you touched and update them in the same commit. Changing `core/` usually means
changing [skills/artifex/SKILL.md](skills/artifex/SKILL.md) too.

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

**Keeping the flat `docs/` layout.** It was this project's established one, and
the frontmatter already said what each file was. But a reader has to open a file
to see its frontmatter, and a directory says the same thing before anything is
opened. The move cost one rewrite of every citation — `ROADMAP.jsonl`, the code
comments that cite a document by section, `AGENTS.md`, `README.md` — and it is
paid.

**Splitting `decisions.md` into one file per decision.** The directory is built
for that and it can happen when a decision needs its own room. Eight sections in
one file are still one topic, and they are read together.

**Deleting the historical findings documents.** `docs/` is large against 332 KB
of code, which looks top-heavy. It is not junk: several of these carry
measurements that cannot be re-obtained cheaply — the peer scan, the book scan,
the speed numbers. Consolidate them; do not delete them.

**Refreshing every stale number.** It would make `field-test-findings.md` claim
162 tests on a day when 96 existed, which is a fabricated measurement. Only
front-of-house files — `README.md`, `AGENTS.md`, `skills/artifex/SKILL.md` — get
their counts corrected.

**A docs-lint tool to catch stale counts.** A tool to watch three files is more
code than the three fixes.

## Reporting

There is no public issue tracker yet. See **Support** in [README.md](README.md).

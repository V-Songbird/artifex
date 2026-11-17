---
type: knowledge
summary: "What the Check workflow runs on each push and pull request, how to start and size the mutation shards by hand, how to check a workflow change, and the branch rules; read before changing CI or merging a change to a check."
related_files: [".github/workflows/check.yml", "tests/negative.js"]
---

# Continuous integration

The [Check workflow](../../.github/workflows/check.yml) runs on Linux only, with the Node version in `.nvmrc`.

## On every push and pull request

Each push to `main` and each push to a pull request runs one job, `Check (ubuntu-latest)`. It rejects tracked ignored files, runs `npm run check`, builds the standalone page, builds the showcase site and runs `npm run site:check`. It has a 30-minute cap. It does not run the mutation suite or anything on Windows.

One run takes a few minutes, most of them `npm run check`. A pull request merged after one push runs the job twice, once for the pull request and once for the push to `main`.

A second workflow, [Site](../../.github/workflows/site.yml), runs only when started by hand: it checks the built site in Edge on a Windows runner without failing on frame budgets, and builds it and runs `npm run site:check` on Linux. It deploys nothing. [The site](site.md) describes it.

## Running the mutation suite by hand

The mutation shards run only when someone starts the workflow by hand. Start it after changing a check, contract key or invariant, and before merging such a change:

1. On GitHub, open **Actions**, then **Check**.
2. Select **Run workflow**, choose the branch, and select **Run workflow** again.

Or, from a terminal with the GitHub CLI signed in:

```bash
gh workflow run check.yml --ref <branch>
```

A manual run starts the six `Mutations (<k>/6)` jobs and `Check (ubuntu-latest)` side by side. The run passes only when every shard passes. Starting it again on the same branch cancels the earlier run, and so does a push to `main` while it runs on `main`, because the workflow cancels an older run for the same ref.

A manual run is expensive. Its cost grows with the number of registered mutations. Each mutation in `tests/negative.js` has one `expect:` line, so this command counts them:

```bash
grep -c "^    expect:" tests/negative.js
```

In PowerShell, use `(Select-String -Path tests/negative.js -Pattern '^    expect:').Count`. A filtered run of `npm run negative` also names the total in its control line, as `<n> of <total> mutations selected`, after it has run the whole suite once. At the sizing estimate below, 20 seconds per mutation, a manual run takes about one runner minute for every three mutations, plus a few minutes of control in each of the six shards. The registry held 1,220 mutations on 2026-11-16, so a run would take roughly 420 runner minutes across its shards; no run on the hosted Linux runner has measured it yet. To run a subset locally instead, use `npm run negative -- --file <path>` or `--expect <text>`, described in [the mutation suite](verification.md#the-mutation-suite).

## Shards

Each `Mutations (<k>/6)` job has a 90-minute cap. A shard holds every sixth mutation in registry order, so its size is the registry's count divided by six, rounded up. Each shard first runs the whole suite as its control, then runs each test file that its mutations need alone, once, a few minutes more. Each mutation then runs only the file that holds its expected test.

To size shards, assume about 20 seconds per mutation, an estimate with some margin from local timings until a CI run measures it. At that rate a 90-minute shard fits about 250 mutations, or about 1,500 across six shards. The time per mutation grows with the slowest test files that hold expected tests, such as `tests/replay.test.js` and `tests/examples.test.js`. Add shards, in the matrix, the job name and the run step, when the longest shard job nears its cap. Each mutation-suite subprocess also keeps the finite runner deadline described in [the mutation suite](verification.md#the-mutation-suite). The workflow sets `ARTIFEX_NEGATIVE_TIMEOUT_MS` to 900000 for that job: the first manual run, on 2026-11-16, stopped in every shard because one whole-suite run takes about six minutes on a hosted runner, over the 300-second default.

## Checking a workflow change

The project has no YAML parser, so no local check reads `.github/workflows/check.yml`. GitHub parses it when you push it, and a file it cannot parse fails its run before any job starts. To see the jobs GitHub parsed from the file, open a run of it:

```bash
gh run list --workflow check.yml --limit 1
gh run view <run id>
```

`gh run view` lists the jobs of the run, including jobs the run skipped. On a push, the skipped mutation shards appear as one job, under the unexpanded name `Mutations (${{ matrix.shard }}/6)`. `gh workflow view check.yml` shows only recent runs, and `--yaml` shows the file as written, not as parsed.

## Branch rules

Submit changes through a pull request targeting `main`. A ruleset on `main` requires the pull request, a linear history, resolved review conversations and a passing `Check (ubuntu-latest)`, and refuses deleting the branch or force pushing to it; a repository administrator can bypass it. The only job that reports a check is `Check (ubuntu-latest)`; no job reports `Check (windows-latest)`. When a job's name changes, change the ruleset's required checks with it and read the rules back, because a required check that no job reports makes a pull request wait forever.

See the [security policy](../SECURITY.md) for private vulnerability reporting and the boundaries of executing piece code.

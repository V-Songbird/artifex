---
type: api_spec
summary: "Defines style packs: the folder and style.json format, where packs are installed, how a style name resolves, the npm run styles list, trust, check and pack commands, and drawing a style by name with --style; read before making, installing, sharing or checking a style pack."
related_files: ["tools/styles.js", "skills/style-pack/SKILL.md", "tools/replay.js", "skills/artifex/styles/builtin.json", "skills/artifex/styles/catalog.md", "tools/piece-input.js", "tools/build-page.js", "tools/contact-sheet.js", "tests/styles.test.js", "docs/security.md"]
---

# Style packs

A style pack is one named style that someone can install and draw by name: the style's guide, the code of its reference piece and a sample that piece drew. The built-in styles in [`skills/artifex/styles/`](../../skills/artifex/styles/catalog.md) and the installed packs are listed together by `npm run styles`.

A pack contains executable JavaScript. Read [style packs in the security policy](../security.md#style-packs) before you install one.

## Built-in styles

[`builtin.json`](../../skills/artifex/styles/builtin.json) lists every built-in style in the gallery's order, each with `name`, `title`, `summary`, `guide` and `module`. `guide` and `module` are file names in `skills/artifex/styles/`. Each module exports `name`, `size` and `seed` beside `draw`, so it is a valid piece on its own, and draws what the gallery draws for that style. Built-in styles have no `style.json` and need no trust.

## Where packs are installed

Each pack is one folder in `~/.artifex/styles/`, named after the pack, such as `~/.artifex/styles/pointillism/`. The environment variable `ARTIFEX_HOME` replaces `~/.artifex`. A relative `ARTIFEX_HOME` is resolved from the directory where you ran `npm run styles`, as for the paths `page` and `seeds` take. Trust is recorded in `~/.artifex/trust.json`, outside `styles/`, so a pack cannot ship its own trust.

To install a pack, extract its folder into `~/.artifex/styles/`, then read and trust it (see [trust](#trust-a-pack)).

## Pack folder

```
pointillism/
  style.json     the manifest
  guide.md       the style's guide
  piece.cjs      the reference piece: one external piece
  lib/…          local helpers and JSON data the piece requires (optional)
  sample.svg     or sample.png: drawn by the piece, carrying its replay manifest
```

The piece follows the [external piece](../knowledge/development.md#external-pieces) rules. It may require only files the pack lists and `artifex/core/<file>.js`.

## style.json

```json
{
  "stylePack": 1,
  "name": "pointillism",
  "title": "Pointillism",
  "version": "1.0.0",
  "artifex": "0.1.0",
  "summary": "Dots of unmixed colour that blend in the eye.",
  "author": "optional free text",
  "license": "optional SPDX identifier",
  "piece": "piece.cjs",
  "guide": "guide.md",
  "sample": "sample.svg",
  "files": { "piece.cjs": "<sha256 hex>", "lib/dots.js": "<sha256 hex>", "guide.md": "<sha256 hex>", "sample.svg": "<sha256 hex>" }
}
```

| Key | Rule |
| --- | --- |
| `stylePack` | `1`, the format version. |
| `name` | Lowercase kebab-case (`a-z`, `0-9` and single hyphens), at most 40 characters, equal to the folder name. |
| `title`, `summary`, `version` | Nonempty single lines of text. `version` is the pack's own version, for people. |
| `artifex` | The exact Artifex version the sample was drawn and proved with. It must equal the `artifex` field in the sample's replay manifest. |
| `author`, `license` | Optional nonempty single lines of text. |
| `piece` | A `.cjs` or `.js` file listed in `files`. |
| `guide` | A `.md` file listed in `files`. |
| `sample` | A `.svg` or `.png` file listed in `files`. |
| `files` | Every file of the pack except `style.json`, each mapped to the SHA-256 of its bytes in lowercase hex. |

Any other key is refused. Each path in `files` is relative to the pack folder and uses forward slashes. A path is refused when it:

- uses a backslash;
- is absolute, including a drive letter such as `C:/`;
- contains a `..` segment, an empty segment or a `.` segment;
- holds a control character or one of `: * ? " < > |`;
- ends a name with a dot or a space, which Windows drops;
- names `style.json` itself.

The sample's recipe (seed, parameters, playhead and scale) is kept only in the sample's own replay manifest, so it cannot disagree with a copy.

## Resolving a style by name

A name is lowercased, then matched exactly against the built-in names and then the installed packs. Listing and resolving read `builtin.json`, each pack's `style.json` and `trust.json`; no pack code runs.

- A built-in style's name is reserved. An installed pack with that name is listed as `refused`, and the built-in style is used.
- A folder that is not a valid pack is listed as `broken` with its reason, such as `no style.json` or the first `style.json` rule it breaks. Naming it gives that reason.
- A pack folder that is a link, such as a symbolic link or a Windows junction, is listed as `broken`.
- Files in `styles/` that are not folders are ignored.
- An unknown name fails with every available name and the install folder, for example: `style: no style named "puntillismo". Available: cad, circuit-board, … (built in); pointillism (installed). Packs are installed in /home/you/.artifex/styles.`

## npm run styles

| Command | Result |
| --- | --- |
| `npm run styles` | Lists every built-in style and installed pack: name, built in or installed, and for a pack its version, the version it was proved with and whether it is trusted, then title and summary. Broken and refused folders follow with their reasons. The last line names the install folder. |
| `npm run styles -- --json` | Prints the same list as JSON; `npm run styles -- list --json` is the same. |
| `npm run styles -- trust <name>` | Shows a pack and records your trust in it (below). |
| `npm run styles -- check <name>` | Checks a style, and replays a pack's sample (below). |
| `npm run styles -- pack <piece> --name <name> --guide <guide.md> --summary <text>` | Makes a pack of a piece, proves its sample and installs it (see [make a pack](#make-a-pack)). |

A command that fails prints its reason on standard error and exits with code 1.

The JSON report holds `home` (the `ARTIFEX_HOME` folder), `packs` (its `styles/` folder), `styles` and `problems`. Each entry of `styles` has `name`, `title`, `summary`, `source` (`builtin` or `installed`), and absolute `guide` and `piece` paths. An installed entry adds `sample`, `version`, `artifex`, `proved` (whether `artifex` is this library's version), `trusted`, `folder`, and `author` and `license` when given. Each entry of `problems` has `name`, `folder`, `status` (`broken` or `refused`) and `reason`.

### Trust a pack

`npm run styles -- trust <name>` first verifies the pack folder:

- no file or folder inside the pack is a link;
- no `.js`, `.cjs`, `.mjs` or `.json` file is missing from `files`, because only those can be loaded; other unlisted files, such as `Thumbs.db`, are ignored and never read;
- every listed file exists and matches its hash;
- the sample's replay manifest names the same Artifex version as `artifex`.

It then prints the pack's author, license and proved-with version, every file with its size and hash, and, for each `.js` or `.cjs` file, the modules it requires. The requires are read by the loader's parser; no pack code runs. Last, it records the SHA-256 of `style.json` in `trust.json`, under the pack's name with its version. Because `style.json` hashes every file the pack can load, that one hash covers the whole pack.

A pack whose `style.json` changes, including a new version with the same files, is no longer trusted and must be trusted again. Built-in styles cannot be trusted; they need no trust.

### Check a style

`npm run styles -- check <name>` on a built-in style loads its module as a piece and requires the piece's name to be the style's name and its guide to exist.

On an installed pack, it runs these steps in order and stops at the first failure:

1. Verifies the pack folder as `trust` does.
2. Requires the pack to be trusted as it is now. An untrusted or changed pack is refused with the command that trusts it.
3. Requires `artifex` to be this library's version. A pack proved with another version fails with `is not proved on this version`.
4. Loads the piece, confined to the pack's listed files and `artifex/core/<file>.js`. Any other require is refused by name.

5. Copies the pack's listed files to a new temporary folder and replays the sample there with the copy's piece, as `npm run replay -- sample.svg --piece piece.cjs` does (see [replaying a saved file](../knowledge/development.md#replaying-a-saved-file)). An SVG sample must redraw byte for byte in Node; a PNG sample is redrawn in installed Edge and must be identical, or at least 40 dB PSNR and closer to its own frame than to either neighbour. A sample that differs fails with replay's first difference. The copy is removed either way.

Steps 4 and 5 run pack code. A pass shows the sample redraws on this machine and this Artifex version; it says nothing about another browser, GPU or version.

## Make a pack

```
npm run styles -- pack <piece> --name <name> --guide <guide.md> --summary <text>
  [--title <text>] [--version <v>] [--author <text>] [--license <spdx>] [--seed <n>] [--t <0..1>] [--replace]
```

`<piece>` is an [external piece](../knowledge/development.md#external-pieces), a built-in style's module or any other piece module; relative paths resolve from where you ran the command. The [style-pack skill](../../skills/style-pack/SKILL.md) walks an agent through it.

1. Refuses a `--name` that breaks the `name` rule or is a built-in style's name, an existing `<ARTIFEX_HOME>/styles/<name>` unless `--replace` is given, a link there even with `--replace`, and a guide without a `# ` title followed by headings that start `What makes it read as`, `Recipe`, `Pitfalls` and `Any subject`, in that order. Other headings, such as `Palette`, may come between them.
2. Loads the piece and copies it to `piece.cjs`, and every local helper or JSON file it reaches to `lib/<file name>`, adding `-2`, `-3` and on when two share a name. Each literal `require` is rewritten to the file's new place. A require of the library's `core/`, by any path, becomes `artifex/core/<file>.js`, as does `examples/stroke-font.js`, which re-exports `core/stroke-font.js`. A require of any other file in the library's `examples/` is refused, because only `core/` is the library's API.
3. Draws the sample at `--seed` (default: the piece's seed) and the playhead `--t` (default 1) on the frame grid: `sample.svg` in Node for a piece that declares `vector` output, otherwise `sample.png` 600 pixels wide, drawn in installed Edge as the page's PNG button draws it. Each carries its replay manifest.
4. Writes `style.json`: `title` from `--title` or the guide's `# ` heading, `version` from `--version` or `1.0.0`, `artifex` this library's version, `author` and `license` when given, and the hash of every file.
5. Replays the sample from a clean copy, as `check` does.
6. Only when it matches, moves the pack into `<ARTIFEX_HOME>/styles/<name>`, replacing the old folder under `--replace`, and trusts it as `trust` does, since you just made it from your own piece.

The pack is built in a temporary folder inside `ARTIFEX_HOME`, beside `styles/`, which is removed whatever happens. When a step fails, including a sample that does not replay, nothing is installed or trusted, and a pack `--replace` would have replaced is kept as it was.

Under `--replace`, the old pack is moved aside to `<ARTIFEX_HOME>/.old-<name>-<suffix>`, beside `styles/` where the scan never looks, just before the new pack moves into its place. If that move or the trust that follows fails, as a locked file on Windows or a full disk can make it, the new pack is removed and the old one moves back with its entry in `trust.json`. The old pack is removed only once the new one is installed and trusted; if that removal fails, `pack` says so and names the folder it is left in. If restoring the old pack fails, the error names that folder too, so the old pack can be moved back by hand. A fresh install that fails at the same step is removed in the same way, so a failed `pack` never leaves an untrusted pack behind.

To share a pack, zip its folder. The person who receives it extracts it into their `~/.artifex/styles/`, reads it, trusts it and runs `check` on their own machine.

## Draw a style by name

`npm run page -- --style <name>` and `npm run seeds -- --style <name> [count] [playhead]` draw the style's piece: a built-in style's module, or a pack's piece. `seeds` takes `--param`, `--box` and `--png` as it does for any piece. They write `out/style-<name>-page.html` and `out/style-<name>-seeds.html` (or `-param-<names>`) in the library, never in the pack folder, which must stay as it was hashed.

A pack goes through steps 1, 2 and 4 of `check` first, so an untrusted or changed pack is refused with the command that trusts it, and nothing is written. A pack proved with another Artifex version still draws, after a warning on standard error that its sample is not proved on this version. An unknown name fails with every available name, as above.

## Checks

`node --test tests/styles.test.js` checks `builtin.json` against the gallery and the modules, each `style.json` rule, the scan and its broken and refused folders, the unknown-name error, trust records, every refusal of `check` and `trust`, links, the command line, and `--style` in `page` and `seeds`: loading, refusals, the version warning and output names, all under a temporary `ARTIFEX_HOME`. It also checks `pack`'s rewriting of requires, the guide headings, `style.json` and trust output, every refusal, the removal of its own output and the keeping of a replaced pack when the sample does not replay, the return of a replaced pack and its trust when moving the new pack into place or trusting it fails, and `check`'s replay of a changed sample, with SVG samples in Node. A PNG sample needs installed Edge and is not drawn by these tests.

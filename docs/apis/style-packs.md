---
type: api_spec
summary: "Defines styles and style packs: the built-in styles' registry, the pack folder and style.json format, the proof of each mark function, where packs are installed, how a style name resolves, and the npm run styles list, trust, check and pack commands; read before making, installing, sharing or checking a style pack."
related_files: ["tools/styles.js", "skills/style-pack/SKILL.md", "skills/artifex/styles/builtin.json", "skills/artifex/styles/catalog.md", "tools/piece-input.js", "tests/styles.test.js", "docs/SECURITY.md"]
---

# Style packs

A style is knowledge, not a picture. It has two parts:

- **A guide** that teaches what makes the style read as itself, how each mark is made, and how work in the style is composed, lit, coloured, moved and timed.
- **A module of mark functions** that draw the style's marks on any path, outline or area a piece gives them. The module draws nothing by itself and holds no subject, scene or layout. A mark whose width changes along its path follows the [variable-width rule](../../skills/artifex/styles/catalog.md#variable-width-marks).

A style pack is one named style that someone can install: its guide, its module and a proof of each mark function. A pack holds no piece, no sample and no image, so nothing in it can stand in for the composition of the piece you make with it. A replica drawn to calibrate a style's marks against a reference image is not part of the style and never goes in a pack; see [named styles](../../skills/artifex/SKILL.md#named-styles).

The built-in styles in [`skills/artifex/styles/`](../../skills/artifex/styles/catalog.md) and the installed packs are listed together by `npm run styles`, which is the catalog of every style.

A pack contains executable JavaScript. Read [style packs in the security policy](../SECURITY.md#style-packs) before you install one.

## Built-in styles

[`builtin.json`](../../skills/artifex/styles/builtin.json) lists every built-in style, each with `name`, `title`, `summary`, `guide` and `module`. `guide` and `module` are file names in `skills/artifex/styles/`. The module exports only functions that draw marks, never `name`, `size`, `seed` or `draw`. A piece requires it as `artifex/styles/<name>.js`. Built-in styles have no `style.json` and need no trust.

## Where packs are installed

Each pack is one folder in `~/.artifex/styles/`, named after the pack, such as `~/.artifex/styles/pointillism/`. The environment variable `ARTIFEX_HOME` replaces `~/.artifex`. A relative `ARTIFEX_HOME` is resolved from the directory where you ran `npm run styles`. Trust is recorded in `~/.artifex/trust.json`, outside `styles/`, so a pack cannot ship its own trust.

To install a pack, extract its folder into `~/.artifex/styles/`, then read and trust it (see [trust](#trust-a-pack)).

## Pack folder

```
pointillism/
  style.json     the manifest
  guide.md       the style's guide
  marks.cjs      the module of mark functions
  proof.cjs      the proof of each mark function
  lib/…          local helpers and JSON data the module or proof requires (optional)
```

The module and the proof may require only files the pack lists, by their path from the requiring file such as `./lib/ink.js`, and `artifex/core/<file>.js`. Any other require, including a Node built-in such as `node:fs`, is refused by name when the pack is checked. When the author's module requires a built-in style as `artifex/styles/<name>.js`, `pack` copies that module into `lib/` with the helpers it requires, such as `kit.js`, and rewrites the requires to their `lib/` paths. A module can also require `artifex/styles/kit.js` for the shared helpers, such as `bristles` for a dry stroke's hairs ([the style catalog](../../skills/artifex/styles/catalog.md) describes it); `pack` copies `kit.js` into `lib/` the same way.

## The proof

The proof is a CommonJS module that exports one entry for each function the module exports:

```js
module.exports = {
  dots: { box: [0, 0, 60, 40], draw(g, marks) { marks.dots(g, 3, 0, 0, 60, 40); } },
  dash: { box: [0, 0, 60, 40], draw(g, marks) { marks.dash(g, 5, 5, 55, 35); } },
};
```

`box` is `[x, y, w, h]`, four finite numbers with `w` and `h` above 0: the geometry the mark is given. `draw(g, marks)` calls the mark function on `g`, a Canvas2D-shaped surface, with that geometry. `marks` is the pack's module; a proof that requires the module itself, such as `require('./marks.cjs')`, gets the same functions, so calling the mark either way counts.

Each `draw` runs three times, each on a fresh proof surface: once on each of two fresh loads of the module and the proof, then again on the second load. A value the module takes when it loads, such as `Math.random()` at the top of the file, makes the two loads differ, and state the module keeps between calls, such as a counter, makes the second load's two runs differ. The surface draws nothing: it records every call and setting, and checks every point that a filled or stroked path, a rectangle or an image reaches, after the current transform. A mark is proved when:

- `draw` calls the mark function it is named after;
- every run makes the same calls with the same values, so the mark is deterministic;
- it paints at least once with something of size: an empty path or a rectangle of no size does not count;
- every point it paints, in every run, lies inside `box`.

An object given to the surface, such as a matrix for `setTransform`, compares by every value it holds, a `Map` or `Set` by its entries, and image data by its pixels. A mark that calls `drawImage` cannot be proved: a canvas or image source's pixels cannot be compared, and a real canvas refuses image data there, so place pixels with `putImageData` instead. When `shadowColor` is not transparent, every painted point is checked again moved by `shadowOffsetX` and `shadowOffsetY`, in canvas pixels whatever the transform. `clearRect` paints nothing, but its corners must lie inside `box` too. A stroke's width and a shadow's blur are not counted against the box. Curves are checked at 16 points and arcs at 32 points along them. Text is not supported on the proof surface.

A proof is refused when it names a function the module does not export, when it lacks an entry for one, or when its `box` is not four finite numbers with a positive size. The refusal names the first mark that failed and why, such as `the proof of dash paints at (75, 35), outside its box [0, 0, 60, 40]` or `the proof of dots draws differently the second time, from call 3: …`.

## style.json

```json
{
  "stylePack": 2,
  "name": "pointillism",
  "title": "Pointillism",
  "version": "1.0.0",
  "artifex": "0.1.0",
  "summary": "Dots of unmixed colour that blend in the eye.",
  "author": "optional free text",
  "license": "optional SPDX identifier",
  "guide": "guide.md",
  "module": "marks.cjs",
  "proof": "proof.cjs",
  "marks": ["dots", "dash"],
  "files": { "guide.md": "<sha256 hex>", "marks.cjs": "<sha256 hex>", "proof.cjs": "<sha256 hex>", "lib/ink.js": "<sha256 hex>" }
}
```

| Key | Rule |
| --- | --- |
| `stylePack` | `2`, the format version. A format 1 pack, which held a piece and a sample, is refused with the command to pack its mark functions again. |
| `name` | Lowercase kebab-case (`a-z`, `0-9` and single hyphens), at most 40 characters, equal to the folder name, and not a [Windows device name](#windows-device-names). |
| `title`, `summary`, `version` | Nonempty single lines of text. `summary` is the style's signature in words. `version` is the pack's own version, for people. |
| `artifex` | The Artifex version the pack was made and proved with. `check` proves the pack again on the version you run. |
| `author`, `license` | Optional nonempty single lines of text. |
| `guide` | A `.md` file listed in `files`. |
| `module` | A `.cjs` or `.js` file listed in `files`: the mark functions. |
| `proof` | A `.cjs` or `.js` file listed in `files`, not the module itself. |
| `marks` | The names of the functions the module exports, in its export order, each once. Listing reads them from here, so no pack code runs to list a pack. |
| `files` | Every file of the pack except `style.json`, each mapped to the SHA-256 of its bytes in lowercase hex. |

Any other key is refused. Each path in `files` is relative to the pack folder and uses forward slashes. A path is refused when it:

- uses a backslash;
- is absolute, including a drive letter such as `C:/`;
- contains a `..` segment, an empty segment or a `.` segment;
- holds a control character or one of `: * ? " < > |`;
- ends a name with a dot or a space, which Windows drops;
- has a folder or file name that is a [Windows device name](#windows-device-names), such as `lib/aux.js`;
- names `style.json` itself.

### Windows device names

Windows reserves some file names for devices. A name is refused when it is one of these, in any case:

- `CON`, `PRN`, `AUX`, `NUL`, `CONIN$`, `CONOUT$`, `COM1` to `COM9` and `LPT0` to `LPT9`, alone or followed by an extension, as in `aux.js`, `Nul.tar.gz`, `lpt0.js` or `con .json`, where spaces come before the dot;
- `COM¹`, `COM²`, `COM³`, `LPT¹`, `LPT²` and `LPT³`, with a superscript digit, alone. With an extension, as in `com¹.js`, they are ordinary names, because Windows, Git for Windows and Windows `tar` all treat them as files.

Git for Windows cannot add such a file, and some Windows tools open the device instead of the file, so a pack with one would not install or be shared reliably on Windows, even when it was made on another system. A device name inside a longer name is allowed: `con-x`, `auxx.js`, `com10`, `com0` and `x.con` are ordinary names.

## Resolving a style by name

A name is lowercased, then matched exactly against the built-in names and then the installed packs. Listing and resolving read `builtin.json`, the built-in modules, each pack's `style.json` and `trust.json`; no pack code runs.

- A built-in style's name is reserved. An installed pack with that name is listed as `refused`, and the built-in style is used.
- A folder that is not a valid pack is listed as `broken` with its reason, such as `no style.json` or the first `style.json` rule it breaks. Naming it gives that reason.
- A pack folder that is a link, such as a symbolic link or a Windows junction, is listed as `broken`.
- Files in `styles/` that are not folders are ignored.
- An unknown name fails with every available name and the install folder, for example: `style: no style named "puntillismo". Available: backlit-silhouette, cad, … (built in); pointillism (installed). Packs are installed in /home/you/.artifex/styles.`

## npm run styles

| Command | Result |
| --- | --- |
| `npm run styles` | The catalog. For each built-in style and installed pack: its name, built in or installed, title and summary; then the names of its mark functions; then the paths of its guide and module. A pack also shows its version, the version it was packed with and whether it is trusted. Broken and refused folders follow with their reasons. The last line names the install folder. |
| `npm run styles -- --json` | Prints the same catalog as JSON; `npm run styles -- list --json` is the same. |
| `npm run styles -- trust <name>` | Shows a pack and records your trust in it (below). |
| `npm run styles -- check <name>` | Checks a style, and proves each mark of a pack (below). |
| `npm run styles -- pack <marks.js> --proof <proof.js> --name <name> --guide <guide.md> --summary <text>` | Makes a pack, proves each mark and installs it (see [make a pack](#make-a-pack)). |

A command that fails prints its reason on standard error and exits with code 1.

The JSON report holds `home` (the `ARTIFEX_HOME` folder), `packs` (its `styles/` folder), `styles` and `problems`. Each entry of `styles` has `name`, `title`, `summary`, `source` (`builtin` or `installed`), the absolute `guide` and `module` paths, and `marks`, the names of the module's functions. An installed entry adds the absolute `proof` path, `version`, `artifex`, `trusted`, `folder`, and `author` and `license` when given. Each entry of `problems` has `name`, `folder`, `status` (`broken` or `refused`) and `reason`.

### Trust a pack

`npm run styles -- trust <name>` first verifies the pack folder:

- no file or folder inside the pack is a link;
- no `.js`, `.cjs`, `.mjs` or `.json` file is missing from `files`, because only those can be loaded; other unlisted files, such as `Thumbs.db`, are ignored and never read;
- every listed file exists and matches its hash.

It then prints the pack's author, license and the version it was packed with, its mark functions, every file with its size and hash, and, for each `.js` or `.cjs` file, the modules it requires. The requires are read by the loader's parser; no pack code runs. Last, it records the SHA-256 of `style.json` in `trust.json`, under the pack's name with its version. Because `style.json` hashes every file the pack can load, that one hash covers the whole pack.

A pack whose `style.json` changes, including a new version with the same files, is no longer trusted and must be trusted again. Built-in styles cannot be trusted; they need no trust.

### Check a style

`npm run styles -- check <name>` on a built-in style requires its module to export at least one function and none of `name`, `size`, `seed` or `draw`, and its guide to have the headings a pack's guide needs (see [make a pack](#make-a-pack), step 1).

On an installed pack, it runs these steps in order and stops at the first failure:

1. Verifies the pack folder as `trust` does.
2. Requires the pack to be trusted as it is now. An untrusted or changed pack is refused with the command that trusts it.
3. Requires the guide to have the headings a pack's guide needs.
4. Loads the module and the proof, confined to the pack's listed files and `artifex/core/<file>.js`. Any other require is refused by name.
5. Requires the module to export functions and no piece, and the names in `marks` to be exactly its functions, in order.
6. Runs [the proof](#the-proof) of each mark function.

Steps 4 to 6 run pack code. A pass shows each mark draws the same twice inside its box on this machine and this Artifex version. It does not show that the marks look right; judge that by eye in a piece of your own.

## Make a pack

```
npm run styles -- pack <marks.js> --proof <proof.js> --name <name> --guide <guide.md> --summary <text>
  [--title <text>] [--version <v>] [--author <text>] [--license <spdx>] [--replace]
```

`<marks.js>` is the module of mark functions and `<proof.js>` its proof; relative paths resolve from where you ran the command. The [style-pack skill](../../skills/style-pack/SKILL.md) walks an agent through it.

1. Refuses a `--name` that breaks the `name` rule, including a Windows device name, or is a built-in style's name; an existing `<ARTIFEX_HOME>/styles/<name>` unless `--replace` is given; a link there even with `--replace`; and a guide without a `# ` title followed by level-2 headings (`## `) that start, in any letter case, `What makes it read as`, `Marks`, `Creative direction` and `Pitfalls`, in that order. Other headings, such as `Palette`, may come between them. It also refuses a `--proof` that names the module itself.
2. Copies the module to `marks.cjs`, the proof to `proof.cjs`, and every local helper or JSON file they reach to `lib/<file name>`, adding `-2`, `-3` and on when two share a name. A helper whose `lib/` path breaks a [path rule of `files`](#stylejson) is refused here, before anything is written. That includes a file name that is a [Windows device name](#windows-device-names), such as `./aux.min.js`, holds a character such as `:`, `*` or `?`, or ends with a dot or a space, names that some systems allow. The refusal names the helper's own path, so rename that file. Each literal `require` is rewritten to the file's new place, so a proof that requires `./marks.js` requires `./marks.cjs`. A require of the library's `core/`, by any path, becomes `artifex/core/<file>.js`, as does `examples/stroke-font.js`, which re-exports `core/stroke-font.js`. A built-in style's module, required as `artifex/styles/<name>.js` or by path, is copied into `lib/` like a local helper, with the helpers it requires. A require of any other file in the library's `examples/` is refused, because only `core/` is the library's API.
3. Loads the copied module confined to the pack's files, and refuses it when it exports a piece or no function. Its function names become `marks`.
4. Writes `style.json`'s fields: `title` from `--title` or the guide's `# ` heading, `version` from `--version` or `1.0.0`, `artifex` this library's version, `author` and `license` when given, and the hash of every file.
5. Runs [the proof](#the-proof) of each mark from the copy, so the proof reads nothing from your project.
6. Only when every mark is proved, writes `style.json`, moves the pack into `<ARTIFEX_HOME>/styles/<name>`, replacing the old folder under `--replace`, and trusts it as `trust` does, since you just made it from your own files.

The pack is built in a temporary folder inside `ARTIFEX_HOME`, beside `styles/`, which is removed whatever happens. When a step fails, including a mark that is not proved, nothing is installed or trusted, and a pack `--replace` would have replaced is kept as it was.

Under `--replace`, the old pack is moved aside to `<ARTIFEX_HOME>/.old-<name>-<suffix>`, beside `styles/` where the scan never looks, just before the new pack moves into its place. If that move or the trust that follows fails, as a locked file on Windows or a full disk can make it, the new pack is removed and the old one moves back with its entry in `trust.json`. The old pack is removed only once the new one is installed and trusted; if that removal fails, `pack` says so and names the folder it is left in. If restoring the old pack fails, the error names that folder too, so the old pack can be moved back by hand. A fresh install that fails at the same step is removed in the same way, so a failed `pack` never leaves an untrusted pack behind.

To share a pack, zip its folder. The person who receives it extracts it into their `~/.artifex/styles/`, reads it, trusts it and runs `check` on their own machine.

## Use a style in a piece

A style draws nothing by name. `--style <name>` in `npm run page`, `seeds`, `still`, `film` and `replay` is refused with the paths of the style's guide and module, and nothing is written. An unknown name is refused with every available name.

To work in a style, read its guide, then draw your own piece and call the style's mark functions with your own geometry. A piece requires a built-in style's module as `artifex/styles/<name>.js`. For an installed pack, trust and check it first, then copy its module and `lib/` folder into your project and require the module from your piece by its path.

## Checks

`node --test tests/styles.test.js` checks `builtin.json` against the guides and the mark modules; that the built-in styles hold no subject, scene or example image; that the catalog lists every built-in style with its guide and module; each `style.json` rule; the scan and its broken and refused folders; the unknown-name error; trust records; every refusal of `check` and `trust`; links; confined loading; every refusal of a proof; the command line; and the `--style` refusal in `page` and `seeds`, all under a temporary `ARTIFEX_HOME`. It also checks `pack`'s rewriting of requires, the guide headings, `style.json` and trust output, every refusal, the removal of its own output and the keeping of a replaced pack when a mark is not proved, and the return of a replaced pack and its trust when moving the new pack into place or trusting it fails. `tests/cli.test.js` checks the `--style` refusal in `film` and `still`, and `tests/replay.test.js` in `replay`.

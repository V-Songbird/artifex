# Artifex style gallery

This branch holds community style packs for [Artifex](https://github.com/V-Songbird/artifex). It shares no history with `main`, so installing the plugin never copies these packs.

Every pack here is under the gallery's licence, MIT, whatever licence the engine carries.

## Add your style

1. Make your pack with `npm run styles -- pack ... --license MIT` in an Artifex checkout. The [style packs guide](https://github.com/V-Songbird/artifex/blob/main/docs/apis/style-packs.md#make-a-pack) explains the command.
2. Make one folder named after your pack, holding three things:
   - `card.json`, with `name`, `title`, `summary`, `author` and `license`. The title, summary and licence must match the pack's `style.json`.
   - `demo.cjs`, a piece that draws the gallery's bird with your pack's marks. It may require only your pack's files, `artifex/core/<file>.js`, `artifex/site/subject.js` (the bird) and `artifex/styles/kit.js`.
   - The pack folder itself, as `pack` installed it in `~/.artifex/styles/<name>/`.
3. From the Artifex checkout, run `npm run gallery -- <folder holding your item>`. It reads the item, proves the pack and loads the demo within its own files.
4. Fork this repository and open a pull request that adds only your folder. **Pick `gallery` as the base branch**, not `main`.

[The gallery](https://github.com/V-Songbird/artifex/blob/main/docs/apis/style-packs.md#the-gallery) lists every rule an item must pass. In short: no picture, nothing that loads from elsewhere, and no file outside your folder.

## Review

CI runs the same check on every pull request. The owner then judges the art and merges it.

A pull request that changes `.github/` or an item already here is refused, whatever its checks say.

The check runs the item's code. Run `npm run gallery` yourself only on an item whose files you have read.

---
type: api_spec
summary: "Defines the JSON report npm run measure prints for a PNG reference: its fields, coordinate system, colour clustering, outline geometry and limits; read before writing code that reads a measurement or changing tools/measure-reference.js."
related_files: ["tools/measure-reference.js", "tests/measure-reference.test.js", "docs/knowledge/command-line-tools.md"]
---

# Reference measurements

`npm run measure -- <reference.png>` reads a PNG and reports what it measured as one JSON object. A piece fits its own shapes to these numbers. The report holds no pixels, picture, SVG or path to paste, so the piece is still solved, not traced. [Replica mode](../../skills/artifex/reference/replica.md) says how a piece uses the report. [Measuring a reference image](../knowledge/command-line-tools.md#measuring-a-reference-image) explains how to run the command.

## Report

```json
{
  "file": "ref.png",
  "size": { "w": 40, "h": 30 },
  "pixels": 1200,
  "transparent": 0,
  "colours": [
    {
      "hex": "#dc1e1e",
      "rgb": [220, 30, 30],
      "pixels": 100,
      "share": 0.083333,
      "outlines": [
        { "points": [[5, 5.5], [14.5, 5], [15, 14.5], [5.5, 15]], "area": 99.5, "hole": false, "bbox": [5, 5, 15, 15] }
      ],
      "dropped": 0
    }
  ],
  "options": { "colors": 8, "tolerance": 1, "minArea": 4 }
}
```

The example shows one of the image's colours: a 10 x 10 square of pixels whose top-left pixel is at column 5, row 5. At the default tolerance of 1 pixel its outline keeps 4 points; at `--tolerance 0` it keeps all 8, two at each cut corner.

| Field | Meaning |
| --- | --- |
| `file` | The file name as it was given on the command line. |
| `size` | The image's width `w` and height `h` in pixels. |
| `pixels` | `w * h`. |
| `transparent` | The share of pixels with alpha under 128, from 0 to 1. These pixels belong to no colour. |
| `colours` | The dominant colours, the colour with the most pixels first. |
| `colours[].hex`, `rgb` | The mean colour of the colour's pixels, as `#rrggbb` and as three numbers from 0 to 255. |
| `colours[].pixels`, `share` | How many pixels took this colour, and that count divided by `pixels`, rounded to 6 decimals. The shares and `transparent` add up to 1, within rounding. |
| `colours[].outlines` | Every closed outline of this colour's regions, the largest area first. |
| `colours[].dropped` | How many outlines enclosed less than `minArea` square pixels and were left out. |
| `options` | The options the report was measured with. |

Each outline has these fields:

| Field | Meaning |
| --- | --- |
| `points` | The simplified outline as `[x, y]` pairs. The loop is closed: the last point joins the first, which is not repeated. |
| `area` | The area the outline encloses before simplification, in square pixels, rounded to 2 decimals. |
| `hole` | `true` when the outline runs around a part of the region that has another colour or is transparent, such as the inside of a ring. To leave a transparent hole unpainted, follow [replica mode](../../skills/artifex/reference/replica.md) step 4. |
| `bbox` | `[x0, y0, x1, y1]`, the outline's bounds before simplification. |

## Coordinates and outline geometry

- Coordinates are in image pixels from the image's top-left corner: x grows to the right and y grows down. Pixel column 5 covers x from 5 to 6.
- Outlines run along pixel edges, so every coordinate is a whole or half number. A region of whole pixels gets the bounds of those pixels: the 10 x 10 square above has `bbox` `[5, 5, 15, 15]`.
- Each corner is cut by half a pixel on both sides, so a square's area is 0.5 square pixels less than its pixel count, and a single pixel encloses 0.5.
- Regions connect through shared sides only. Two pixels of one colour that touch only at a corner make two outlines.
- `points` keeps every point that lies farther than `tolerance` pixels from the simplified outline (Ramer-Douglas-Peucker). With `tolerance` 0, only points on straight runs are removed. An outline keeps at least 3 points.

## How colours are chosen

1. The opaque pixels are counted in bins of 8 levels per channel.
2. The bin with the most pixels gives the first colour. Each further colour comes from the bin farthest from the colours chosen so far, until there are `colors` colours or the farthest bin lies within 16 sRGB units of a chosen colour.
3. A bin can give a colour only when it and its neighbouring bins, about 24 levels per channel around it, hold at least 0.1% of the opaque pixels. Rare blends, such as anti-aliased edges, therefore join the colours they blend instead of becoming colours of their own.
4. The colours are refined by k-means in sRGB until no bin changes colour, at most 32 rounds. Every pixel takes the colour of its bin.

The result is the same on every run. Colours are the stored sample values: colour profiles and gamma chunks are ignored, and a 16-bit sample is read as its high byte.

## Limits

- PNG only, in every colour type and bit depth, without interlacing. A JPEG, WebP or GIF file is refused by name.
- At most 50,000,000 pixels.
- `colors` is a whole number from 1 to 32, 8 by default. `tolerance` defaults to 1 pixel and `minArea` to 4 square pixels.

## Speed and memory

Before tracing a colour, the tool counts the pixels, sides and 2 x 2 blocks of each region and of each hole, and notes which region or hole lies inside which. These counts give every outline's area exactly, without tracing it: the area inside an outline is its own region's or hole's share plus everything inside it. An outline that encloses less than `minArea` is counted in `dropped` and never traced, together with everything inside it; tests see this through the `traced` count the tool's `outlines` function returns, which the report leaves out. This holds for a region with holes too: a small ring is skipped whatever its bounding box. The report is the same as tracing every outline and then dropping the small ones.

The outlines left are traced by walking from one 2 x 2 cell of pixels to the next, inside the tool. They come out with the same points, starting point, direction and order as the library's `isolines` gives them.

Speckle therefore costs little: tracing time grows with the outlines kept, not with the outlines dropped. Measured on a 12th-generation Intel Core i5 desktop, with the default options, other work running on the machine at the same time. Before is the tool as it was until it walked outlines itself and skipped small rings exactly; the report is byte for byte the same.

| Generated test image | Outlines kept / dropped | Before | Now |
| --- | --- | --- | --- |
| 3000 x 3000, each pixel one of 8 flat colours at random | 58,975 / 6,708,541 | 4.2 to 4.3 s, 0.3 to 0.4 GB | 3.4 to 3.5 s, 0.4 GB |
| 4000 x 3000 (12 megapixels), smooth colour waves with per-pixel noise, like a noisy photo | 82,541 / 622,455 | 10.3 to 10.4 s, 0.5 GB | 4.6 s, 0.5 GB |

Times include reading and decoding the PNG. Memory is the process's peak.

---
type: api_spec
summary: "Defines core/grow.js: tone turned into evenly spaced dots, and lines that branch towards attractors; read when a piece shades with dots or grows a branching form."
related_files: ["core/grow.js", "core/d3-delaunay.js", "tests/grow.test.js", "skills/artifex/reference/geometry-fields.md"]
---

# Growth by rule

Import helpers from `core/grow.js`.

## Tone as dots

`stipple(R, tone, bounds, n, opt)` returns `n` points over `bounds`, `[x0, y0, x1, y1]`, crowded where `tone(x, y)` is high and sparse where it is low, each evenly spaced among its neighbours, after Secord (2002). `tone` returns 0 to 1: how much ink a place takes. The points start where `R` and the tone put them and then move, `opt.rounds` times (default 30), to the weighted middle of the region nearer to each than to any other. `opt.grid` (default 512, from 8 to 2048) is how many samples of the tone the longer side takes; keep it well above the number of dots across, or dots in the darkest places share a sample and clump. `opt.name` (default `'stipple'`) separates one set from another. A tone that is 0 everywhere gives no dots. The result is plain points, the same for a canvas and an SVG.

## Lines that branch

`colonise(attractors, roots, opt)` grows from `roots`, `[x, y]` points, towards `attractors`, `[x, y]` points, after Runions and others (2007). Each round every attractor within `opt.reach` of the growth pulls on its nearest point; a pulled point grows a new one `opt.step` away, towards the mean of its pulls; an attractor nearer than `opt.kill` is used up. It ends when nothing pulls or after `opt.rounds` (default 400).

| Option | Default | Meaning |
| --- | --- | --- |
| `step` | Required | The length of each new piece. |
| `reach` | `6 * step` | How far an attractor pulls. A root farther than this from every attractor grows nothing. |
| `kill` | `2 * step` | How near the growth must come to use an attractor up. Larger leaves a sparser form. |
| `tip`, `power` | `1`, `2.2` | A tip's width, and how widths add up from the tips down: `(sum of children's width ** power) ** (1 / power)`. |

It returns `{ points, parent, width }`: every point grown, the index of the one it grew from (`-1` for a root), and its width, so a stem is as thick as what it carries. Draw each point to its parent. Where the attractors lie decides the form: a cloud fills as a crown, a row is followed, a ring is traced. It takes no random source; place the attractors with `R`.

Run `node --test tests/grow.test.js`.

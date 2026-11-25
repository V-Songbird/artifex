// Diagrams laid out from data, as geometry only: a radar, a timeline, a
// layered graph (a flow chart or a state diagram) and a sankey. Each returns
// points, boxes and paths in design units and draws nothing, so the piece
// draws them with the marks of whatever style it is in.
//
// Text is measured by the caller: `measure(label)` returns [width, height] in
// design units for the lettering the piece will draw, so boxes fit their
// labels and labels keep clear of one another.

'use strict';

const need = (ok, what) => { if (!ok) throw new RangeError('diagram ' + what); };
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const point = (p) => Array.isArray(p) && p.length === 2 && p.every(finite);

/**
 * A radar of `values`, numbers or `{ name, value }`, one spoke each from
 * `centre`, the first pointing up and the rest clockwise. A value of `max`
 * (default the largest value) reaches `radius`.
 * Returns { spokes: [{ name, value, angle, tip, at, label }], shape, ring(k) }:
 * `tip` the spoke's end at the radius, `at` the value's point on it, `label` a
 * point `gap` (default a tenth of the radius) past the tip, `shape` the closed
 * polygon through every `at`, and `ring(k)` the polygon at share k of the radius.
 */
function radar(values, { centre, radius, max, gap = radius / 10 } = {}) {
  need(Array.isArray(values) && values.length >= 3, 'radar: values takes three or more numbers or { name, value } rows');
  need(point(centre) && radius > 0, 'radar: centre takes [x, y] and radius a number above 0');
  const rows = values.map((v) => (typeof v === 'number' ? { name: null, value: v } : v));
  need(rows.every((r) => r && finite(r.value) && r.value >= 0), 'radar: every value takes a finite number, 0 or more');
  const top = max === undefined ? Math.max(...rows.map((r) => r.value)) || 1 : max;
  need(top > 0, 'radar: max takes a number above 0');
  const on = (angle, d) => [centre[0] + d * Math.cos(angle), centre[1] + d * Math.sin(angle)];
  const spokes = rows.map((r, i) => {
    const angle = -Math.PI / 2 + (i / rows.length) * 2 * Math.PI;
    return { name: r.name, value: r.value, angle, tip: on(angle, radius), at: on(angle, (radius * Math.min(r.value, top)) / top), label: on(angle, radius + gap) };
  });
  return { spokes, shape: spokes.map((s) => s.at), ring: (k) => spokes.map((s) => on(s.angle, radius * k)) };
}

/**
 * A timeline of `events`, `{ t, label }`, along the line `from` to `to`, which
 * holds the times `t0` to `t1` (default the events' first and last). Labels
 * start at their event and sit in lanes either side of the line, so that no two
 * in one lane come within `gap` (default 8) of each other by `measure`.
 * Returns { axis: [from, to], events: [{ t, label, at, lane, side, anchor, size }],
 * tick(t) }: `at` the event's point on the line, `side` 1 or -1, `lane` 0 for the
 * lane nearest the line, `anchor` the label's corner nearest the event's point
 * on the line's side (its baseline start for a level line), `size` what
 * `measure` gave; `tick(t)` the point of any time.
 */
function timeline(events, { from, to, t0, t1, measure, gap = 8, lane = null } = {}) {
  need(Array.isArray(events) && events.length > 0 && events.every((e) => e && finite(e.t)), 'timeline: events takes one or more { t, label } rows with a finite t');
  need(point(from) && point(to) && (from[0] !== to[0] || from[1] !== to[1]), 'timeline: from and to take two different [x, y] points');
  need(typeof measure === 'function', 'timeline: measure takes a function (label) => [width, height]');
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const a = t0 === undefined ? sorted[0].t : t0, b = t1 === undefined ? sorted[sorted.length - 1].t : t1;
  need(finite(a) && finite(b) && b >= a, 'timeline: t0 and t1 take finite numbers, t1 at or after t0');
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const u = [(to[0] - from[0]) / length, (to[1] - from[1]) / length], n = [u[1], -u[0]];
  const along = (t) => (b === a ? 0.5 : (t - a) / (b - a)) * length;
  const tick = (t) => [from[0] + u[0] * along(t), from[1] + u[1] * along(t)];
  const ends = [];
  const placed = sorted.map((e) => {
    const size = measure(e.label ?? ''), s = along(e.t);
    let k = ends.findIndex((end) => end + gap <= s);
    if (k < 0) k = ends.length;
    ends[k] = s + size[0];
    // Lanes alternate sides, nearest first: 0 one side, 1 the other, 2 the first again, further out.
    const side = k % 2 ? -1 : 1, level = Math.floor(k / 2), step = lane ?? size[1] * 1.6;
    const off = side * (level + 1) * step, at = tick(e.t);
    return { t: e.t, label: e.label ?? '', at, lane: level, side, anchor: [at[0] + n[0] * off, at[1] + n[1] * off], size };
  });
  return { axis: [from, to], events: placed, tick };
}

// Ranks by the longest path from a source, over `links` [from, to] by index;
// links that close a cycle are in `back` and take no part.
function ranks(count, links) {
  const out = Array.from({ length: count }, () => []);
  links.forEach(([a, b], i) => { if (a !== b) out[a].push([b, i]); });
  const state = new Array(count).fill(0), back = new Set();
  const visit = (v) => {
    state[v] = 1;
    for (const [w, i] of out[v]) { if (state[w] === 1) back.add(i); else if (!state[w]) visit(w); }
    state[v] = 2;
  };
  for (let v = 0; v < count; v++) if (!state[v]) visit(v);
  const rank = new Array(count).fill(0);
  for (let pass = 0; pass < count; pass++) {
    let moved = false;
    links.forEach(([a, b], i) => { if (a !== b && !back.has(i) && rank[b] < rank[a] + 1) { rank[b] = rank[a] + 1; moved = true; } });
    if (!moved) break;
  }
  return { rank, back };
}

// Orders each rank to cut crossings: four sweeps, each node moved to the mean
// place of its neighbours in the rank before.
function order(rank, links, back) {
  const depth = Math.max(...rank) + 1, rows = Array.from({ length: depth }, () => []);
  rank.forEach((r, v) => rows[r].push(v));
  const place = new Array(rank.length);
  const index = () => rows.forEach((row) => row.forEach((v, i) => { place[v] = i; }));
  index();
  const kept = links.filter(([a, b], i) => a !== b && !back.has(i));
  for (let sweep = 0; sweep < 4; sweep++) {
    const down = sweep % 2 === 0;
    for (let r = down ? 1 : depth - 2; r >= 0 && r < depth; r += down ? 1 : -1) {
      const mean = (v) => {
        const near = kept.filter(([a, b]) => (down ? b === v : a === v)).map(([a, b]) => place[down ? a : b]);
        return near.length ? near.reduce((s, x) => s + x, 0) / near.length : place[v];
      };
      const key = new Map(rows[r].map((v) => [v, mean(v)]));
      rows[r].sort((p, q) => key.get(p) - key.get(q) || place[p] - place[q]);
      index();
    }
  }
  return rows;
}

/**
 * A layered graph: a flow chart or a state diagram. `nodes` are `{ id, label }`
 * (or `{ id, w, h }` for a given size), `edges` `{ from, to, label }` by id.
 * Nodes are ranked so that edges run one way, `direction` 'down' (default) or
 * 'right'; an edge that closes a cycle runs back round the far side, and an
 * edge from a node to itself is a loop on that side. A node's box is its
 * measured label plus `pad` (default 12) all round; ranks are `gap[0]` apart
 * and nodes in a rank `gap[1]` (default [48, 28]).
 * Returns { nodes: [{ id, label, x, y, w, h, rank }], edges: [{ from, to, label,
 * path, at, back }], size: [w, h] }: boxes by their top left corner from (0, 0),
 * `path` a polyline from the source's edge to the target's, `at` its middle
 * point for the edge's label, `size` the whole layout's extent, back edges
 * included. Place it with a translate; scale it by drawing smaller text.
 */
function layered(nodes, edges, { measure, direction = 'down', pad = 12, gap = [48, 28] } = {}) {
  need(Array.isArray(nodes) && nodes.length > 0, 'layered: nodes takes one or more { id, label } rows');
  need(direction === 'down' || direction === 'right', `layered: direction takes 'down' or 'right', got ${direction}`);
  const ids = new Map(nodes.map((n, i) => [n.id, i]));
  need(ids.size === nodes.length, 'layered: each node takes its own id');
  const links = (edges || []).map((e, i) => {
    need(ids.has(e.from) && ids.has(e.to), `layered: edge ${i} names a node that is not in nodes: ${ids.has(e.from) ? e.to : e.from}`);
    return [ids.get(e.from), ids.get(e.to)];
  });
  const flip = direction === 'right';
  const sizes = nodes.map((n) => {
    if (finite(n.w) && finite(n.h)) return [n.w, n.h];
    need(typeof measure === 'function', 'layered: measure takes a function (label) => [width, height] for a node with no w and h');
    const [w, h] = measure(n.label ?? String(n.id));
    return [w + 2 * pad, h + 2 * pad];
  });
  // Along the ranks (`deep`) and across them (`wide`), whichever way they run.
  const deep = (v) => sizes[v][flip ? 0 : 1], wide = (v) => sizes[v][flip ? 1 : 0];
  const { rank, back } = ranks(nodes.length, links);
  const rows = order(rank, links, back);
  const start = [], thick = rows.map((row) => Math.max(...row.map(deep)));
  thick.reduce((at, t, r) => { start[r] = at; return at + t + gap[0]; }, 0);
  const across = new Array(nodes.length);
  const span = rows.map((row) => row.reduce((s, v) => s + wide(v), 0) + gap[1] * (row.length - 1));
  const widest = Math.max(...span);
  rows.forEach((row, r) => { let at = (widest - span[r]) / 2; for (const v of row) { across[v] = at; at += wide(v) + gap[1]; } });
  const box = (v) => {
    const d = start[rank[v]] + (thick[rank[v]] - deep(v)) / 2;
    return flip ? { x: d, y: across[v] } : { x: across[v], y: d };
  };
  const placed = nodes.map((n, v) => ({ id: n.id, label: n.label ?? String(n.id), ...box(v), w: sizes[v][0], h: sizes[v][1], rank: rank[v] }));
  // A point in (deep, wide) coordinates, as [x, y].
  const xy = (d, a) => (flip ? [d, a] : [a, d]);
  const far = start[rows.length - 1] + thick[rows.length - 1];
  let lanes = 0;
  const routed = (edges || []).map((e, i) => {
    const [a, b] = links[i];
    const d0 = start[rank[a]] + (thick[rank[a]] - deep(a)) / 2, d1 = start[rank[b]] + (thick[rank[b]] - deep(b)) / 2;
    const ma = across[a] + wide(a) / 2, mb = across[b] + wide(b) / 2;
    let path;
    if (a === b || back.has(i)) {
      // Out of the far side of the source, along a lane past every node, into the far side of the target.
      const lane = widest + gap[1] * (++lanes);
      const out = d0 + deep(a) * (a === b ? 0.7 : 0.5), into = d1 + deep(b) * (a === b ? 0.3 : 0.5);
      path = [xy(out, across[a] + wide(a)), xy(out, lane), xy(into, lane), xy(into, across[b] + wide(b))];
    } else {
      const leave = d0 + deep(a), arrive = d1, mid = (leave + arrive) / 2;
      path = ma === mb ? [xy(leave, ma), xy(arrive, mb)] : [xy(leave, ma), xy(mid, ma), xy(mid, mb), xy(arrive, mb)];
    }
    const k = (path.length - 1) / 2, p = path[Math.floor(k)], q = path[Math.ceil(k)];
    return { from: e.from, to: e.to, label: e.label ?? null, path, at: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], back: a === b || back.has(i) };
  });
  const reach = widest + gap[1] * lanes;
  return { nodes: placed, edges: routed, size: flip ? [far, reach] : [reach, far] };
}

/**
 * A sankey: `flows` `{ from, to, value }` between `nodes` `{ id, label }`, in
 * the `box` [x, y, w, h]. Nodes stand in columns by how many flows lead to
 * them, each `nodeWidth` (default 14) wide and as tall as the larger of what
 * enters and what leaves it, `gap` (default 10) apart; one scale serves every
 * column. A flow that closes a cycle is refused.
 * Returns { nodes: [{ id, label, x, y, w, h, value, column }], ribbons: [{ from,
 * to, value, outline, spine, width }], scale }: `outline` the ribbon's closed
 * band from the source's right edge to the target's left, `spine` its centre
 * line and `width` its thickness, for a style that strokes rather than fills.
 */
function sankey(nodes, flows, { box, nodeWidth = 14, gap = 10, samples = 20 } = {}) {
  need(Array.isArray(nodes) && nodes.length > 1, 'sankey: nodes takes two or more { id, label } rows');
  need(Array.isArray(box) && box.length === 4 && box.every(finite) && box[2] > 0 && box[3] > 0, 'sankey: box takes [x, y, w, h] with a width and a height above 0');
  const ids = new Map(nodes.map((n, i) => [n.id, i]));
  need(ids.size === nodes.length, 'sankey: each node takes its own id');
  need(Array.isArray(flows) && flows.length > 0, 'sankey: flows takes one or more { from, to, value } rows');
  const links = flows.map((f, i) => {
    need(ids.has(f.from) && ids.has(f.to), `sankey: flow ${i} names a node that is not in nodes: ${ids.has(f.from) ? f.to : f.from}`);
    need(finite(f.value) && f.value > 0, `sankey: flow ${i} takes a value above 0`);
    return [ids.get(f.from), ids.get(f.to)];
  });
  const { rank, back } = ranks(nodes.length, links);
  need(!back.size && links.every(([a, b]) => a !== b), `sankey: flow ${back.size ? [...back][0] : links.findIndex(([a, b]) => a === b)} closes a cycle, and a sankey runs one way`);
  const rows = order(rank, links, back);
  const sum = (v, end) => flows.reduce((s, f, i) => s + (links[i][end] === v ? f.value : 0), 0);
  const value = nodes.map((_, v) => Math.max(sum(v, 0), sum(v, 1)));
  const [x, y, w, h] = box;
  const scale = Math.min(...rows.map((row) => (h - gap * (row.length - 1)) / row.reduce((s, v) => s + value[v], 0)));
  need(scale > 0, 'sankey: the box is too short for its gaps: give it more height or a smaller gap');
  const step = rows.length > 1 ? (w - nodeWidth) / (rows.length - 1) : 0;
  const top = new Array(nodes.length);
  rows.forEach((row) => {
    let at = y + (h - (row.reduce((s, v) => s + value[v] * scale, 0) + gap * (row.length - 1))) / 2;
    for (const v of row) { top[v] = at; at += value[v] * scale + gap; }
  });
  const placed = nodes.map((n, v) => ({ id: n.id, label: n.label ?? String(n.id), x: x + rank[v] * step, y: top[v], w: nodeWidth, h: value[v] * scale, value: value[v], column: rank[v] }));
  // Each node's flows leave in the order of their targets and arrive in the order of their sources, so ribbons do not cross at a node.
  const left = [...top], right = [...top], slot = new Array(flows.length);
  const by = (end) => flows.map((_, i) => i).sort((p, q) => top[links[p][end]] - top[links[q][end]] || p - q);
  for (const i of by(1)) { slot[i] = [right[links[i][0]], 0]; right[links[i][0]] += flows[i].value * scale; }
  for (const i of by(0)) { slot[i][1] = left[links[i][1]]; left[links[i][1]] += flows[i].value * scale; }
  const ribbons = flows.map((f, i) => {
    const [a, b] = links[i], x0 = placed[a].x + nodeWidth, x1 = placed[b].x, t = f.value * scale;
    const edge = (off) => Array.from({ length: samples + 1 }, (_, k) => {
      const u = k / samples, s = u * u * (3 - 2 * u);
      return [x0 + (x1 - x0) * u, slot[i][0] + (slot[i][1] - slot[i][0]) * s + off];
    });
    return { from: f.from, to: f.to, value: f.value, outline: [...edge(0), ...edge(t).reverse()], spine: edge(t / 2), width: t };
  });
  return { nodes: placed, ribbons, scale };
}

module.exports = { radar, timeline, layered, sankey };

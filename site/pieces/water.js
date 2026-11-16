// The water that crosses the intro's last line, and the ink that blooms into it.
//
// A WIDE BRUSH OF CLEAN WATER passes once across the sheet, left to right, low
// enough that the wordmark stays dry and the still-wet line under it goes in.
// Like the plotter it is not drawn: the wet paper it leaves is, a little darker
// than dry paper, with a faint tide line at its edges and a sheen where the
// light falls on the standing water, and so is its shadow while it passes.
//
// THE INK BLOOMS ALONG THE CURRENT. Where the water reaches the line, ink runs
// out of it into the water: a plume from each point, walking the current,
// widening as it spreads and paler as it thins, arriving quickly and then
// slowing. The current is the brush's drag, the tilt of the sheet and slow
// eddies; it is the flow field the next shot's brush paints in. Ink stops at
// the edge of the water, where the wet meets the dry, and gathers there.

'use strict';

const { rng, fbm, gradient2 } = require('../../core/rand.js');
const { curl } = require('../../core/field.js');
const P = require('./paper.js');
const { soft } = require('./held.js');
const M = require('./wordmark.js');

const FROM = -170;          // the brush's footprint enters here...
const TO = P.W + 170;       // ...and leaves here
const SWEEP_AT = 0.2;       // seam second the footprint's front reaches FROM
const SWEEP = 0.95;         // seconds to cross from FROM to TO
const STEP = 8;             // edge samples, design units apart
const RUSH = 0.8;           // most of a plume's ink rushes out with this time constant...
const CREEP = 4.5;          // ...and the rest creeps on, evenly, for this many seconds
const ARRIVE = 0.15;        // seconds a puff of a plume takes to darken in as the ink reaches it

/** The share of its run a plume's ink has covered `age` seconds after the water reached it. */
function share(age) {
  return age <= 0 ? 0 : 0.75 * (1 - Math.exp(-age / RUSH)) + 0.25 * Math.min(1, age / CREEP);
}

/** The inverse of share: the age at which the ink covers share `u` of the run. */
function ageAt(u) {
  let lo = 0, hi = CREEP;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (share(mid) < u) lo = mid; else hi = mid; }
  return hi;
}

/** The underline's y at x, carried straight on past its ends. */
function lineY(pts, x) {
  if (x <= pts[0][0]) return pts[0][1] + (x - pts[0][0]) * (pts[1][1] - pts[0][1]) / (pts[1][0] - pts[0][0]);
  const n = pts.length - 1;
  if (x >= pts[n][0]) return pts[n][1] + (x - pts[n][0]) * (pts[n][1] - pts[n - 1][1]) / (pts[n][0] - pts[n - 1][0]);
  let i = 1;
  while (pts[i][0] < x) i++;
  const u = (x - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
  return pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * u;
}

/** The wet band's edge at x, from its samples. */
function edge(ys, x) {
  const f = Math.max(0, Math.min(ys.length - 1.000001, (x - FROM) / STEP));
  const i = Math.floor(f);
  return ys[i] + (ys[i + 1] - ys[i]) * (f - i);
}

/** Where the brush's footprint front is at second `sec`. */
function head(sec) {
  return FROM + (TO - FROM) * Math.max(0, Math.min(1, (sec - SWEEP_AT) / SWEEP));
}

/** The second at which the footprint's front reaches x. */
function touch(x) {
  return SWEEP_AT + SWEEP * (x - FROM) / (TO - FROM);
}

/** The current's heading at (x, y): the brush's drag, the sheet's tilt, and eddies. */
function currentOf(s) {
  const R = rng(s.seed);
  const w = s.water;
  const eddy = curl((x, y) => gradient2(R, x / 160 + 11, y / 160 + 5, 'eddy'), 0.5);
  return (x, y) => {
    const [ex, ey] = eddy(x, y);
    return Math.atan2(w.fall + ey * 160 * w.swirl, 1 + ex * 160 * w.swirl);
  };
}

/** Build stage: the wet band, the current, and the plume every point of the line lets go into it. */
function soak(s) {
  const R = rng(s.seed);
  const under = s.lines[s.lines.length - 1].pts;
  s.water = {
    fall: 0.35 + R('water', 'fall') * 0.5,
    swirl: 0.8 + R('water', 'swirl') * 0.8,
    sheen: 0.3 + R('water', 'sheen') * 0.4,
  };
  const lift = 16 + R('water', 'lift') * 10;
  const depth = 250 + R('water', 'depth') * 90;
  const lean = (R('water', 'lean') - 0.5) * 0.12;
  s.water.top = [];
  s.water.bottom = [];
  for (let x = FROM; x <= TO + 1e-9; x += STEP) {
    const top = lineY(under, x) - lift - (fbm(R, x / 150, 0.5, 2, 'water top') - 0.5) * 16;
    s.water.top.push(top);
    s.water.bottom.push(top + depth + lean * (x - P.W / 2) + (fbm(R, x / 220, 3.5, 2, 'water bottom') - 0.5) * 70);
  }
  const current = currentOf(s);
  const inside = (x, y) => y > edge(s.water.top, x) + 1 && y < edge(s.water.bottom, x) - 1;

  // A plume from every few units of the line, each with its own load of ink.
  s.plumes = [];
  const x0 = under[0][0], x1 = under[under.length - 1][0];
  for (let i = 0, x = x0 + 4; x < x1 - 2; i++, x += 13 + R('plume', 'gap', i) * 9) {
    const y = lineY(under, x);
    const run = 70 + Math.pow(R('plume', 'run', i), 1.4) * 260;
    const pts = [[x, y]];
    let px = x, py = y;
    // Ink leaves the line into the water, mostly below it where there is more
    // water to take it, and turns into the current.
    const up = R('plume', 'up', i) < 0.25;
    let heading = (up ? -Math.PI / 2 : Math.PI / 2) + (R('plume', 'aim', i) - 0.5) * 0.9;
    let stopped = false;
    for (let d = 0; d < run; d += 3) {
      const target = current(px, py);
      let turn = (target - heading) % (Math.PI * 2);
      if (turn > Math.PI) turn -= Math.PI * 2;
      if (turn < -Math.PI) turn += Math.PI * 2;
      heading += turn * 0.12;
      const nx = px + Math.cos(heading) * 3, ny = py + Math.sin(heading) * 3;
      if (!inside(nx, ny) && pts.length > 2) { stopped = true; break; }
      px = nx; py = ny;
      pts.push([px, py]);
    }
    // Normals, to set each puff a little off the path.
    const normals = pts.map((p, k) => {
      const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
    });
    const load = 0.55 + R('plume', 'load', i) * 0.45, spread = 0.8 + R('plume', 'spread', i) * 0.6;
    // Half the line lets go at once; the rest holds its ink a moment longer, so
    // blooms keep breaking out while the first ones spread.
    const late = R('plume', 'late', i) < 0.5 ? 0 : R('plume', 'wait', i) * 1.9;
    s.plumes.push({ pts, normals, stopped, touch: touch(x) + 0.04 + late, load, spread, puffs: puffs(R, i, pts, normals, load, spread) });
  }
}

/** The wet band as far as the brush has got, with the footprint's rounded front. */
function wetPath(g, s, sec) {
  const hx = head(sec);
  if (hx <= FROM) return false;
  const { top, bottom } = s.water;
  const n = Math.min(top.length - 1, Math.floor((hx - FROM) / STEP));
  g.beginPath();
  g.moveTo(FROM, top[0]);
  for (let i = 1; i <= n; i++) g.lineTo(FROM + i * STEP, top[i]);
  const t = edge(top, hx), b = edge(bottom, hx);
  // The footprint's front: a broad curve ahead of the last sample.
  g.lineTo(hx, t);
  g.bezierCurveTo(hx + 34, t + (b - t) * 0.2, hx + 34, t + (b - t) * 0.8, hx, b);
  for (let i = n; i >= 0; i--) g.lineTo(FROM + i * STEP, bottom[i]);
  g.closePath();
  return true;
}

/** The second the brush has left the sheet: from then on the wet paper only settles. */
const SWEPT = SWEEP_AT + SWEEP + 0.05;

/**
 * The wet paper at second `sec`: a little darker than dry paper with a tide
 * line along its edges, and the soft halo the line's ink spreads into it. Once
 * the brush has gone this no longer changes, and a shot may keep it with the
 * paper (see `hold`).
 */
function drawWet(g, s, sec) {
  if (!wetPath(g, s, sec)) return;
  g.save();
  g.fillStyle = 'rgba(104, 90, 66, 0.055)';
  g.fill();
  g.strokeStyle = 'rgba(104, 90, 66, 0.08)';
  g.lineWidth = 2.4;
  g.stroke();
  g.restore();
  drawHalo(g, s, sec);
}

/** The tide line alone: the edge the water leaves on the paper, which stays when the water has dried. */
function drawTide(g, s) {
  if (!wetPath(g, s, SWEPT)) return;
  g.save();
  g.strokeStyle = 'rgba(104, 90, 66, 0.08)';
  g.lineWidth = 2.4;
  g.stroke();
  g.restore();
}

/**
 * The light's reflection at second `sec`: a soft band across the sheet that
 * drifts as the water moves, `strength` times as bright as on the water itself.
 */
function sheenOf(g, s, sec, strength = 1) {
  const lx = Math.cos(s.light), ly = Math.sin(s.light);
  const cx = P.W / 2 + lx * 160 + Math.sin(sec * 1.3) * 40, cy = edge(s.water.top, P.W / 2) + 90 + ly * 40;
  const sheen = g.createLinearGradient(cx - ly * 260, cy + lx * 260, cx + ly * 260, cy - lx * 260);
  sheen.addColorStop(0, 'rgba(255, 253, 246, 0)');
  sheen.addColorStop(0.5, `rgba(255, 253, 246, ${Math.min(1, 0.2 * s.water.sheen * strength).toFixed(3)})`);
  sheen.addColorStop(1, 'rgba(255, 253, 246, 0)');
  return sheen;
}

/** The light's reflection on the standing water. */
function drawSheen(g, s, sec) {
  if (!wetPath(g, s, sec)) return;
  g.save();
  g.fillStyle = sheenOf(g, s, sec);
  g.fill();
  g.restore();
}

/** The halo the last line's ink spreads into the water behind the brush, soft: laid at a third of the resolution. */
function drawHalo(g, s, sec) {
  const pts = s.lines[s.lines.length - 1].pts;
  const hx = head(sec);
  if (hx <= pts[0][0]) return;
  soft(g, 3, (sg) => {
    sg.lineCap = 'round';
    sg.lineJoin = 'round';
    for (const [c, w] of [[0.05, 24], [0.1, 12]]) {
      sg.strokeStyle = P.wash(c);
      sg.lineWidth = w;
      sg.beginPath();
      wetTrace(sg, pts, hx);
      sg.stroke();
    }
  });
}

/** The brush over its footprint while it passes, seen by the light it blocks. */
function drawBrush(g, s, sec) {
  const lx = Math.cos(s.light), ly = Math.sin(s.light);
  const hx = head(sec);
  if (hx > FROM && hx < TO) {
    const ox = -lx * 44, oy = -ly * 44;
    const mid = (edge(s.water.top, hx) + edge(s.water.bottom, hx)) / 2;
    const r = 160;
    const shade = g.createRadialGradient(hx + ox, mid + oy, 0, hx + ox, mid + oy, r);
    shade.addColorStop(0, 'rgba(60, 48, 32, 0.12)');
    shade.addColorStop(1, 'rgba(60, 48, 32, 0)');
    g.fillStyle = shade;
    g.fillRect(hx + ox - r, mid + oy - r, 2 * r, 2 * r);
  }
}

/** How far down its path a plume's ink has run by second `sec`, in points. */
function front(p, sec) {
  const age = sec - p.touch;
  return (p.pts.length - 1) * share(age);
}

// THE PUFF. Ink spreading in water is a soft cloud whose pigment is carried
// out to a lacy edge. One such cloud is drawn once per page, in four variants
// with different edges, and every plume is laid as a chain of them, small and
// dense near the line, wide and pale downstream.
const SPRITE = 96;
const VARIANTS = 4;
let sprite = null;

function puffSprite() {
  if (sprite) return sprite;
  const w = SPRITE * VARIANTS;
  const c = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(w, SPRITE)
    : typeof document === 'object' ? Object.assign(document.createElement('canvas'), { width: w, height: SPRITE }) : null;
  if (!c) return null;
  const g = c.getContext('2d');
  const img = g.createImageData(w, SPRITE);
  // A material, the same on every sheet: its own fixed address, not the seed's.
  const R = rng(0);
  const [ir, ig, ib] = P.INK.match(/[0-9a-f]{2}/gi).map((h) => parseInt(h, 16));
  const half = SPRITE / 2;
  for (let v = 0; v < VARIANTS; v++) {
    for (let y = 0; y < SPRITE; y++) {
      for (let x = 0; x < SPRITE; x++) {
        const dx = (x + 0.5 - half) / half, dy = (y + 0.5 - half) / half;
        const rho = Math.hypot(dx, dy), th = Math.atan2(dy, dx);
        // The edge wanders in and out around the cloud; inside, the ink is mottled.
        const edgeAt = 0.7 + 0.3 * fbm(R, 3 + Math.cos(th) * 1.8 + v * 7, 3 + Math.sin(th) * 1.8, 4, 'fringe');
        const u = rho / edgeAt;
        if (u >= 1) continue;
        const body = Math.pow(1 - u * u, 1.3) * 0.75;
        const rim = Math.max(0, 1 - Math.abs(u - 0.88) / 0.12) * 0.08;
        const mottle = 0.8 + 0.4 * fbm(R, x / 9 + v * 13, y / 9, 2, 'mottle');
        const i = (y * w + v * SPRITE + x) * 4;
        img.data[i] = ir; img.data[i + 1] = ig; img.data[i + 2] = ib;
        img.data[i + 3] = Math.round(Math.min(1, (body + rim) * mottle) * 255);
      }
    }
  }
  g.putImageData(img, 0, 0);
  sprite = c;
  return c;
}

const STRETCH = 1.7;        // a puff's length along the current, for a width of 1

/** The heading along a path, from its left normal. */
const heading = ([nx, ny]) => Math.atan2(-nx, ny);

/** Build stage helper: the chain of puffs along one plume, spaced by their own size. */
function puffs(R, i, pts, normals, load, spread) {
  const n = pts.length - 1;
  const out = [];
  for (let d = 0, j = 0; d < n * 3; j++) {
    const k = Math.min(n, Math.round(d / 3));
    const r = (7 + Math.pow(d, 0.74) * 1.1 * spread) * (0.8 + R('puff', 'r' + i, j) * 0.4);
    out.push({
      k, r,
      // Dense at the line, thinning as the ink spreads downstream.
      alpha: load * (0.08 + 0.23 * Math.exp(-d / 90)) * (0.75 + R('puff', 'a' + i, j) * 0.5),
      // Drawn out along the current, as streaming ink is, and turned a little off it.
      cos: Math.cos(heading(normals[k]) + (R('puff', 'turn' + i, j) - 0.5) * 0.7),
      sin: Math.sin(heading(normals[k]) + (R('puff', 'turn' + i, j) - 0.5) * 0.7),
      shift: (R('puff', 'shift' + i, j) - 0.5) * r * 0.5,
      variant: Math.floor(R('puff', 'v' + i, j) * VARIANTS),
      // When the front reaches it.
      at: ageAt(k / Math.max(1, n)),
    });
    d += Math.max(5, r * 1.25);
  }
  return out;
}

/**
 * One puff `q` ({ cos, sin, alpha, variant }) of radius r at (cx, cy), drawn
 * out along its heading, under the surface's transform `m`.
 */
function stamp(g, m, img, q, cx, cy, r, k = 1) {
  const along = r * STRETCH / (SPRITE / 2), across = r / (SPRITE / 2);
  const a = q.cos * along, b = q.sin * along, c = -q.sin * across, d = q.cos * across;
  g.setTransform(m.a * a + m.c * b, m.b * a + m.d * b, m.a * c + m.c * d, m.b * c + m.d * d, m.a * cx + m.c * cy + m.e, m.b * cx + m.d * cy + m.f);
  g.globalAlpha = q.alpha * k;
  g.drawImage(img, q.variant * SPRITE, 0, SPRITE, SPRITE, -SPRITE / 2, -SPRITE / 2, SPRITE, SPRITE);
}

/**
 * The ink in the water at second `sec`: every plume's puffs as far as its
 * front has run, each spreading after the front reaches it, and the darker
 * pools where plumes met the dry paper at the water's edge.
 */
function drawPlumes(g, s, sec) {
  const img = puffSprite();
  g.save();
  const m = typeof g.getTransform === 'function' ? g.getTransform() : null;
  for (const p of s.plumes) {
    const age = sec - p.touch;
    if (age <= 0) continue;
    for (const q of p.puffs) {
      const since = age - q.at;
      if (since <= 0) break;
      // It darkens in as the ink arrives, spreads quickly, then goes on spreading slowly.
      const k = Math.min(1, since / ARRIVE);
      const r = q.r * (0.6 + 0.4 * (1 - Math.exp(-since / 0.45))) * (1 + 0.05 * since);
      const [x, y] = p.pts[q.k], [nx, ny] = p.normals[q.k];
      const cx = x + nx * q.shift, cy = y + ny * q.shift;
      if (img && m) {
        stamp(g, m, img, q, cx, cy, r, k);
      } else {
        g.globalAlpha = q.alpha * 0.5 * k;
        g.fillStyle = P.INK;
        g.beginPath();
        g.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  if (m) g.setTransform(m);
  g.globalAlpha = 1;
  g.fillStyle = P.wash(0.16);
  g.beginPath();
  for (const p of s.plumes) {
    if (!p.stopped || p.pts.length < 16) continue;
    const f = front(p, sec), n = p.pts.length - 1;
    if (f < n - 1.5) continue;
    const [x, y] = p.pts[n];
    const r = (2.5 + Math.pow(n * 3, 0.74) * 0.4 * p.spread) * Math.min(1, (f - (n - 1.5)) / 1.5);
    g.moveTo(x + r, y);
    g.ellipse(x, y, r, r * 0.5, Math.atan2(p.normals[n][0], -p.normals[n][1]), 0, Math.PI * 2);
  }
  g.fill();
  g.restore();
}

/**
 * The last line through the water at second `sec` (the pen's second
 * `wordSec`): dry ahead of the brush, as the wordmark draws it; behind the
 * brush it gives its ink up to the water, paling as it goes (its halo is
 * drawn with the wet paper).
 */
function drawLine(g, s, sec, wordSec) {
  const under = s.lines[s.lines.length - 1];
  const hx = head(sec);
  if (hx < under.pts[under.pts.length - 1][0] + M.LINE) {
    g.save();
    g.beginPath();
    g.rect(hx, -50, P.W + 400, P.H + 100);
    g.clip();
    M.drawWord(g, s, wordSec, [under]);
    g.restore();
  }
  const pts = under.pts;
  if (hx <= pts[0][0]) return;
  // The line itself, paler the longer the water has held it.
  const ink = g.createLinearGradient(pts[0][0], 0, Math.max(pts[0][0] + 1, hx), 0);
  for (let i = 0; i <= 6; i++) {
    const x = pts[0][0] + (hx - pts[0][0]) * i / 6;
    const left = Math.exp(-Math.max(0, sec - touch(x)) / 0.7);
    ink.addColorStop(i / 6, P.wash(+(0.25 + 0.63 * left).toFixed(2)));
  }
  g.save();
  g.strokeStyle = ink;
  g.lineWidth = M.LINE;
  g.lineCap = 'round';
  g.beginPath();
  wetTrace(g, pts, hx);
  g.stroke();
  g.restore();
}

/** The part of the line behind the brush, from its start to x = hx. */
function wetTrace(g, pts, hx) {
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length && pts[i - 1][0] < hx; i++) {
    const [x, y] = pts[i];
    if (x <= hx) g.lineTo(x, y);
    else {
      const [px, py] = pts[i - 1];
      g.lineTo(hx, py + (y - py) * (hx - px) / (x - px));
    }
  }
}

module.exports = { puffSprite, stamp, VARIANTS, soak, drawWet, drawTide, drawSheen, sheenOf, drawHalo, drawBrush, drawPlumes, drawLine, SWEPT, currentOf, head, touch, edge, SWEEP_AT, SWEEP };

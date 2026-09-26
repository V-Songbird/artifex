// The loose forms let go of the painting and fall to the foot of the frame,
// where they pile and come to rest: a system of forces, solved once in the
// build, so a frame is a lookup into it and scrolling back replays the same
// fall (see settle.cjs). Each form is a rigid body of capsules that follow its
// paint: a disc is one circle, a line a chain along its stroke, any other
// form its outline and a core; they fall under gravity, strike and slide on
// one another and on the mat's edges, and sleep once still.
//
// Every strike above a whisper is kept, with its body and speed, so the sound
// hears the fall the picture shows.

'use strict';

const Hg = require('./hang.js');
const Sk = require('./score.js');

const HZ = 30, SUB = 4, DT = 1 / (HZ * SUB);
const GRAVITY = 1500;          // units a second squared: a light skin, falling with weight
// FASTEST keeps a form from crossing more than about half a thin line in one substep, so none passes through another.
const BOUNCE = 0.1, GRIP = 0.6, ITERATIONS = 12, PUSH = 0.35, SLOP = 0.5, FASTEST = 700;
const STIFF = 0.25;           // the share of an overlap closed each substep by the contact itself, as a speed apart
// A contact is seen this far ahead of touching, so a form closing the gap in one substep is stopped at it, not inside.
const AHEAD = FASTEST / (HZ * SUB) + 1;
const SHAKE = 0.3;             // from the release, the trembling shakes apart the forms that lie over one another
const LETGO = [0.0, 0.55];     // then over this long the forms let go one after another and fall

// Forms that fall as one: the rainbow's arcs, nested as they were laid. The
// long arc over the composition is too thin to hold anything up, so it stays
// where it lies on the painting and the others slide over it.
const TOGETHER = [[12, 13, 14, 15, 16, 17]];
const STAYS = [6];

// Falls already solved, by seed, so the next piece of the score that shows the
// same fall goes on from where the last left off instead of solving it again:
// the shots after it draw the same forms. Going on from a kept state is the
// same arithmetic in the same order as solving from the release, so the track
// is the same whichever piece solved it first. The last few seeds are kept.
const solved = new Map();
const KEEP = 3;

/**
 * Build stage: every form's fall, frame by frame from the release until
 * second `until` of the score, and every strike.
 */
function fall(s, until) {
  const at = Sk.T.release, win = Hg.windowOf(s.hang.k);
  const walls = [[1, 0, win[0] + 1], [-1, 0, -(win[2] - 1)], [0, -1, -(win[3] - 1)]];
  const byZ = (z) => s.skins.find((k) => k.z === z);
  const grouped = new Set(TOGETHER.flat()), stays = new Set(STAYS);
  const groups = TOGETHER.map((zs) => zs.map(byZ)).concat(s.skins.filter((k) => !grouped.has(k.z) && !stays.has(k.z)).map((k) => [k]));
  const bodies = groups.map((ks) => body(ks.map((k) => [k, Sk.cued(s, k.i, at)])));
  // The notes let go first, dropping off the staff lines they sit on, then the lines, then the band, each a little apart.
  const order = bodies.slice().sort((a, b) => rank(s, a.ks[0][0].i) - rank(s, b.ks[0][0].i) || a.ks[0][0].i - b.ks[0][0].i);
  order.forEach((b, j) => { b.free = at; b.drop = at + SHAKE + LETGO[0] + (LETGO[1] - LETGO[0]) * (j / (order.length - 1)); });
  const n = s.skins.length, frames = Math.ceil((until - at) * HZ) + 1, track = new Float64Array(frames * n * 3);
  // A form that stays keeps its pose at the release; one that falls, its body's.
  const still = s.skins.filter((k) => stays.has(k.z)).map((k) => [k, Sk.cued(s, k.i, at)]);
  const save = (f) => {
    for (const [k, p] of still) { const o = (f * n + k.i) * 3; track[o] = p.x; track[o + 1] = p.y; track[o + 2] = p.turn; }
    for (const b of bodies) {
      const c = Math.cos(b.a), sn = Math.sin(b.a);
      for (const [k, p] of b.ks) {
        // The member's middle as it was at the release, about the body's, turned and carried with it.
        const qx = k.c[0] + p.x - b.x0, qy = k.c[1] + p.y - b.y0, o = (f * n + k.i) * 3;
        track[o] = b.x + c * qx - sn * qy - k.c[0];
        track[o + 1] = b.y + sn * qx + c * qy - k.c[1];
        track[o + 2] = p.turn + b.a;
      }
    }
  };
  // Forms lying over one another as they let go -- a note on a staff line -- are pushed apart by the trembling
  // before any falls, no faster than a contact may push (see step), and held from drifting while they are.
  const key = s.seed + ' ' + JSON.stringify(s.params || {}), kept = solved.get(key);
  let hits = [], from = 1;
  if (kept) {
    track.set(kept.track.subarray(0, Math.min(kept.frames, frames) * n * 3));
    // A longer fall kept: its strikes up to this one's last substep, as solving this one would have found them.
    if (kept.frames >= frames) { s.fall = { at, frames, hz: HZ, track, hits: thin(kept.hits.filter((h) => h.at < at + ((frames - 1) * SUB + 0.5) * DT)) }; return; }
    kept.state.forEach((st, i) => Object.assign(bodies[i], st));
    hits = kept.hits.slice();
    from = kept.frames;
  } else save(0);
  for (const b of bodies) world(b);
  for (let f = from; f < frames; f++) {
    const t = at + (f - 1) / HZ;
    if (bodies.every((b) => b.asleep) && (t < Sk.T.close[0] || t > Sk.T.close[1])) { track.copyWithin(f * n * 3, (f - 1) * n * 3, f * n * 3); continue; }
    for (let m = 0; m < SUB; m++) {
      // The box's side walls close in as its frame does.
      const now = at + ((f - 1) * SUB + m + 1) * DT, c = Sk.pinch(s, now);
      step(bodies, c ? [[1, 0, walls[0][2] + c], [-1, 0, walls[1][2] + c], walls[2]] : walls, now, hits);
    }
    save(f);
  }
  if (!kept || kept.frames < frames) {
    solved.delete(key);
    solved.set(key, { frames, track, hits: hits.slice(), state: bodies.map(({ x, y, a, vx, vy, w, still, asleep }) => ({ x, y, a, vx, vy, w, still, asleep })) });
    if (solved.size > KEEP) solved.delete(solved.keys().next().value);
  }
  // The track, read by score.js poses: per frame from the release, per form, its offset and turn.
  s.fall = { at, frames, hz: HZ, track, hits: thin(hits) };
}

/** Where a form lets go in the order: the notes, then the staff's lines, then the rest. */
function rank(s, i) {
  const k = s.skins[i];
  if (s.notes.includes(k)) return 0;
  return k.shape === 'line' && k.size > 140 ? 1 : 2;
}

/**
 * A rigid body for skins `ks`, pairs [skin, pose]: capsules (ax, ay, bx, by, r
 * in `caps`, five numbers each) about the members' middle, as they lie in
 * their poses, and its mass and turning inertia; its turn counts from the release.
 */
function body(ks) {
  const x0 = ks.reduce((t, [k, p]) => t + k.c[0] + p.x, 0) / ks.length, y0 = ks.reduce((t, [k, p]) => t + k.c[1] + p.y, 0) / ks.length;
  const caps = [];
  for (const [k, p] of ks) {
    const c = Math.cos(p.turn), sn = Math.sin(p.turn);
    // A point of the skin's paint, where it lies at the release, about the body's middle.
    const at = ([x, y]) => { const lx = x - k.c[0], ly = y - k.c[1]; return [k.c[0] + p.x + c * lx - sn * ly - x0, k.c[1] + p.y + sn * lx + c * ly - y0]; };
    const w = k.box[2] - k.box[0], h = k.box[3] - k.box[1];
    if (k.shape === 'round' && Math.abs(w - h) < 0.15 * Math.max(w, h)) { const m = at(k.c); caps.push(m[0], m[1], m[0], m[1], Math.max(3.5, Math.min(w, h) / 2)); } else if (k.shape === 'line' && k.paths.length === 1) {
      for (const path of k.paths) {
        const r = Math.max(3, path.half), pts = path.pts.map(at);
        let a = pts[0];
        for (let i = 1; i < pts.length; i++) {
          if (i < pts.length - 1 && Math.hypot(pts[i][0] - a[0], pts[i][1] - a[1]) < 14) continue;
          caps.push(a[0], a[1], pts[i][0], pts[i][1], r);
          a = pts[i];
        }
      }
    } else {
      const hull = convex(k.paths.flatMap((q) => q.pts).map(at)), m = at(k.c);
      let inner = Infinity;
      hull.forEach((a, i) => {
        const b = hull[(i + 1) % hull.length];
        caps.push(a[0], a[1], b[0], b[1], 2.5);
        inner = Math.min(inner, segDist(m[0], m[1], a[0], a[1], b[0], b[1]));
      });
      if (inner > 3) caps.push(m[0], m[1], m[0], m[1], inner);
    }
  }
  let reach = 0, area = 0;
  for (let i = 0; i < caps.length; i += 5) {
    const [ax, ay, bx, by, r] = caps.slice(i, i + 5);
    reach = Math.max(reach, Math.hypot(ax, ay) + r, Math.hypot(bx, by) + r);
    area += Math.PI * r * r + 2 * r * Math.hypot(bx - ax, by - ay);
  }
  // Mass grows slower than area, so the smallest dot is not crushed between the largest.
  const mass = Math.max(120, area) ** 0.85, inertia = (mass * reach * reach) / 3;
  return { ks, caps: Float64Array.from(caps), wc: new Float64Array((caps.length / 5) * 9), reach, im: 1 / mass, ii: 1 / inertia, x: x0, y: y0, x0, y0, a: 0, vx: 0, vy: 0, w: 0, free: Infinity, still: 0, asleep: false };
}

/** The convex hull of points, anticlockwise. */
function convex(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const q of p) { while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (hi.length > 1 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

/** The distance from point (px, py) to segment a-b. */
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}

// segSeg's answer, the closest points x1, y1, x2, y2: kept, so a substep makes no arrays.
const SS = new Float64Array(4);

/** The closest points between segments p1-q1 and p2-q2, into SS. */
function segSeg(p1x, p1y, q1x, q1y, p2x, p2y, q2x, q2y) {
  const d1x = q1x - p1x, d1y = q1y - p1y, d2x = q2x - p2x, d2y = q2y - p2y, rx = p1x - p2x, ry = p1y - p2y;
  const a = d1x * d1x + d1y * d1y, e = d2x * d2x + d2y * d2y, f = d2x * rx + d2y * ry;
  let s = 0, t = 0;
  if (a > 1e-9 || e > 1e-9) {
    if (a <= 1e-9) t = Math.max(0, Math.min(1, f / e));
    else {
      const c = d1x * rx + d1y * ry;
      if (e <= 1e-9) s = Math.max(0, Math.min(1, -c / a));
      else {
        const b = d1x * d2x + d1y * d2y, den = a * e - b * b;
        s = den > 1e-9 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
        t = (b * s + f) / e;
        if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); } else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
      }
    }
  }
  SS[0] = p1x + d1x * s; SS[1] = p1y + d1y * s; SS[2] = p2x + d2x * t; SS[3] = p2y + d2y * t;
}

/** Body `b`'s capsules in the world, into b.wc: x0, y0, x1, y1, r and the box x0, y0, x1, y1, nine numbers each. */
function world(b) {
  const c = Math.cos(b.a), sn = Math.sin(b.a), k = b.caps, w = b.wc;
  for (let i = 0, j = 0; i < k.length; i += 5, j += 9) {
    const x0 = b.x + c * k[i] - sn * k[i + 1], y0 = b.y + sn * k[i] + c * k[i + 1], x1 = b.x + c * k[i + 2] - sn * k[i + 3], y1 = b.y + sn * k[i + 2] + c * k[i + 3], r = k[i + 4];
    w[j] = x0; w[j + 1] = y0; w[j + 2] = x1; w[j + 3] = y1; w[j + 4] = r;
    w[j + 5] = Math.min(x0, x1) - r; w[j + 6] = Math.min(y0, y1) - r; w[j + 7] = Math.max(x0, x1) + r; w[j + 8] = Math.max(y0, y1) + r;
  }
}

/**
 * Every contact between bodies A and B, their capsules as world left them,
 * pushed onto `out` when given, the normal from B to A. Returns how many there were.
 */
function collide(A, B, out) {
  const a = A.wc, b = B.wc;
  let found = 0;
  for (let i = 0; i < a.length; i += 9) {
    for (let j = 0; j < b.length; j += 9) {
      if (a[i + 5] > b[j + 7] || b[j + 5] > a[i + 7] || a[i + 6] > b[j + 8] || b[j + 6] > a[i + 8]) continue;
      segSeg(a[i], a[i + 1], a[i + 2], a[i + 3], b[j], b[j + 1], b[j + 2], b[j + 3]);
      const dx = SS[0] - SS[2], dy = SS[1] - SS[3], d = Math.hypot(dx, dy), r = a[i + 4] + b[j + 4];
      if (d >= r + AHEAD) continue;
      const nx = d > 1e-6 ? dx / d : 0, ny = d > 1e-6 ? dy / d : -1;
      found++;
      if (out) out.push({ A, B, x: SS[2] + nx * b[j + 4], y: SS[3] + ny * b[j + 4], nx, ny, depth: r - d, jn: 0, jt: 0, bias: 0 });
    }
  }
  return found;
}

/** One substep at second `now`: gravity on every free form, contacts found and resolved, positions moved. */
function step(bodies, walls, now, hits) {
  const free = (b) => b && now >= b.free && !b.asleep;
  for (const b of bodies) {
    if (!free(b)) continue;
    if (now >= b.drop) b.vy += GRAVITY * DT;
    else { b.vx *= 0.8; b.vy *= 0.8; b.w *= 0.8; }
    world(b);
  }
  const contacts = [];
  for (let i = 0; i < bodies.length; i++) {
    const A = bodies[i];
    // A wall meets every form let go, asleep or not, so a moving wall wakes what it reaches.
    if (now >= A.free) {
      const w = A.wc;
      for (const [wx, wy, wd] of walls) {
        for (let q = 0; q < w.length; q += 9) {
          const r = w[q + 4], ends = w[q] === w[q + 2] && w[q + 1] === w[q + 3] ? 1 : 2;
          for (let e = 0; e < ends; e++) {
            const px = w[q + 2 * e], py = w[q + 2 * e + 1], d = px * wx + py * wy - wd - r;
            if (d < AHEAD) contacts.push({ A, B: null, x: px - wx * r, y: py - wy * r, nx: wx, ny: wy, depth: -d, jn: 0, jt: 0, bias: 0 });
          }
        }
      }
    }
    for (let j = i + 1; j < bodies.length; j++) {
      const B = bodies[j];
      if (!free(A) && !free(B)) continue;
      if (Math.hypot(A.x - B.x, A.y - B.y) > A.reach + B.reach) continue;
      collide(A, B, contacts);
    }
  }
  // Pinned forms, not yet let go, and sleeping ones do not move: they act as walls.
  const im = (b) => (free(b) ? b.im : 0), ii = (b) => (free(b) ? b.ii : 0);
  const vx = (b, y) => (b ? b.vx - b.w * (y - b.y) : 0), vy = (b, x) => (b ? b.vy + b.w * (x - b.x) : 0);
  for (const c of contacts) {
    const vn = (vx(c.A, c.y) - vx(c.B, c.y)) * c.nx + (vy(c.A, c.x) - vy(c.B, c.x)) * c.ny;
    // A contact not yet touching lets its forms close no more than the gap in this substep. One touching asks
    // for the bounce, or for enough speed apart to close its overlap, whichever is more.
    const touching = c.depth > -1 || -vn * DT > -c.depth;
    c.bias = c.depth < 0 ? c.depth / DT : Math.max(vn < -60 ? -BOUNCE * vn : 0, Math.min(150, (STIFF / DT) * Math.max(0, c.depth - SLOP)));
    if (touching && vn < -60) hits.push({ at: now, i: c.A.ks[0][0].i, j: c.B ? c.B.ks[0][0].i : -1, speed: -vn });
  }
  const apply = (b, jx, jy, x, y) => {
    if (!free(b)) return;
    b.vx += jx * b.im; b.vy += jy * b.im; b.w += ((x - b.x) * jy - (y - b.y) * jx) * b.ii;
  };
  for (let it = 0; it < ITERATIONS; it++) {
    for (const c of contacts) {
      const { A, B, x, y, nx, ny } = c;
      const rax = x - A.x, ray = y - A.y, rbx = B ? x - B.x : 0, rby = B ? y - B.y : 0;
      const rna = rax * ny - ray * nx, rnb = rbx * ny - rby * nx;
      const kn = im(A) + im(B) + rna * rna * ii(A) + rnb * rnb * ii(B);
      if (kn <= 0) continue;
      let dj = (-((vx(A, y) - vx(B, y)) * nx + (vy(A, x) - vy(B, x)) * ny) + c.bias) / kn;
      const jn = Math.max(0, c.jn + dj);
      dj = jn - c.jn;
      c.jn = jn;
      apply(A, nx * dj, ny * dj, x, y);
      apply(B, -nx * dj, -ny * dj, x, y);
      // Friction along the contact, no more than the grip allows.
      const tx = -ny, ty = nx, rta = rax * ty - ray * tx, rtb = rbx * ty - rby * tx;
      const kt = im(A) + im(B) + rta * rta * ii(A) + rtb * rtb * ii(B);
      let dt = -((vx(A, y) - vx(B, y)) * tx + (vy(A, x) - vy(B, x)) * ty) / kt;
      const jt = Math.max(-GRIP * c.jn, Math.min(GRIP * c.jn, c.jt + dt));
      dt = jt - c.jt;
      c.jt = jt;
      apply(A, tx * dt, ty * dt, x, y);
      apply(B, -tx * dt, -ty * dt, x, y);
    }
  }
  // Out of one another: each contact's overlap pushed apart, a little at a time, so a deep one eases out.
  for (const c of contacts) {
    const a = im(c.A), b = im(c.B), d = Math.min(0.6, Math.max(0, c.depth - SLOP) * PUSH) / ((a + b) || 1);
    if (a) { c.A.x += c.nx * d * a; c.A.y += c.ny * d * a; }
    if (b) { c.B.x -= c.nx * d * b; c.B.y -= c.ny * d * b; }
  }
  for (const b of bodies) {
    if (!free(b)) continue;
    b.w *= 0.995;
    const v = Math.hypot(b.vx, b.vy);
    if (v > FASTEST) { b.vx *= FASTEST / v; b.vy *= FASTEST / v; }
    b.x += b.vx * DT; b.y += b.vy * DT; b.a += b.w * DT;
    // A form that has kept still for a while sleeps, and stays where it lies.
    b.still = now >= b.drop && v < 12 && Math.abs(b.w) < 0.12 ? b.still + DT : 0;
    if (b.still > 0.25) { b.asleep = true; b.vx = b.vy = b.w = 0; world(b); }
  }
  // A strike wakes what it strikes, and so does a form lying too far into another, until they part.
  for (const c of contacts) {
    if (c.jn * (c.A.im + (c.B ? c.B.im : 0)) > 25 || c.depth > SLOP + 1) {
      for (const b of [c.A, c.B]) if (b && b.asleep && now >= b.free) { b.asleep = false; b.still = 0; }
    }
  }
}

/** One strike per pair of forms within a tenth of a second, the fastest. */
function thin(hits) {
  const out = [], last = new Map();
  for (const h of hits) {
    const key = Math.min(h.i, h.j) + ' ' + Math.max(h.i, h.j), prev = last.get(key);
    if (prev && h.at - prev.at < 0.1) { if (h.speed > prev.speed) prev.speed = h.speed; continue; }
    const e = { ...h };
    last.set(key, e);
    out.push(e);
  }
  return out;
}

module.exports = { fall, HZ };

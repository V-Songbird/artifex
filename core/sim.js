// Parts coupled in space: particles, the links between them, the walls they
// meet, and a record of every impact.
//
// A thread, a rope, a net, a soft ring, a body that lands and settles: each is
// particles held at distances from one another and pushed out of what they
// meet. `simulate` solves the whole timeline once, in a build stage, and keeps
// one snapshot per drawn frame, so `draw` is a lookup and a scrub lands where
// playback does. Nothing here knows what the particles are.
//
// The solver is position-based: each substep moves every free particle by its
// velocity, relaxes the links and contacts a fixed number of times in a fixed
// order, and takes the velocity from how far each particle moved. The contacts
// then set the velocity along their normals, together, in a few fixed passes:
// each reflects only a velocity that pointed into its surface, never more than
// it came in with, and takes back speed the push out of an overlap gave. If the
// bodies a step's contacts touched still leave with more motion than they
// brought, every contact change of that step is scaled back by one factor.
// That is what keeps the energy from growing.
//
// Bodies that turn are a second solver beside the first: boxes and convex
// shapes with an angle, a spin and the inertia their shape gives, solved by
// the vendored planck (core/planck.js) against the same fixed walls and logged
// in the same contact log. Bodies and particles do not meet each other.

'use strict';

// Below this approach speed, in units per second per unit of gravity per
// substep, a contact stops bouncing and rests: a body on a floor would
// otherwise hop by one substep's fall for ever.
const REST = 2;
// A particle is kept this fraction of a wall's scale off its line, far above
// the rounding of the arithmetic that says which side it is on.
const SKIN = 1e-9;

function need(name, v, ok, what) {
  if (!(typeof v === 'number' && !Number.isNaN(v) && ok(v))) throw new RangeError(`simulate: ${name} must be ${what}, got ${String(v)}`);
}

const finite = (v) => Number.isFinite(v);

/**
 * The `bodies` of a spec, checked, each with its corners relative to its
 * origin and its area: a box `width` by `height` centred on (x, y), or the
 * convex shape its `points` go round. `h` is the length of a substep: planck
 * turns a body at most a quarter turn a step, so a faster start spin is
 * refused.
 */
function readBodies(list, h) {
  const shapes = list.map((b, k) => {
    const who = `body ${k}`;
    if (b === null || typeof b !== 'object') throw new RangeError(`simulate: ${who} must be an object of its keys`);
    const { angle = 0, vx = 0, vy = 0, spin = 0, mass = 1, hold = 0, width, height, points } = b;
    for (const [name, v] of [['x', b.x], ['y', b.y], ['angle', angle], ['vx', vx], ['vy', vy], ['spin', spin]]) need(`${who} ${name}`, v, finite, 'a finite number');
    need(`${who} spin`, spin, (v) => Math.abs(v * h) <= Math.PI / 2, `at most a quarter turn a substep, ${Math.PI / 2 / h} radians a second either way; raise substeps for more`);
    need(`${who} mass`, mass, (v) => finite(v) && v > 0, 'a finite number above 0');
    need(`${who} hold`, hold, (v) => v >= 0, 'seconds, 0 or more, or Infinity');
    if (b.path !== undefined) throw new RangeError(`simulate: ${who} takes no path: a body moves only as the solve moves it; hold one in place with hold`);
    if (hold > 0 && (vx !== 0 || vy !== 0 || spin !== 0)) throw new RangeError(`simulate: ${who} is held, so it starts at rest; give it no hold, or no vx, vy or spin`);
    let corners;
    if (points === undefined) {
      need(`${who} width`, width, (v) => finite(v) && v > 0, 'a finite number above 0, or give points');
      need(`${who} height`, height, (v) => finite(v) && v > 0, 'a finite number above 0, or give points');
      corners = [[-width / 2, -height / 2], [width / 2, -height / 2], [width / 2, height / 2], [-width / 2, height / 2]];
    } else {
      if (width !== undefined || height !== undefined) throw new RangeError(`simulate: ${who} takes width and height, or points, not both`);
      if (!Array.isArray(points) || points.length < 3 || points.length > 8) throw new RangeError(`simulate: ${who} points must be a list of 3 to 8 [x, y] corners`);
      corners = points.map((p, j) => {
        if (!Array.isArray(p) || p.length !== 2) throw new RangeError(`simulate: ${who} point ${j} must be [x, y]`);
        need(`${who} point ${j} x`, p[0], finite, 'a finite number');
        need(`${who} point ${j} y`, p[1], finite, 'a finite number');
        return [p[0], p[1]];
      });
      // Convex: every corner turns the same way, none goes straight on, and
      // the turns add up to one round, not the two or more of a star.
      let round = 0;
      const turns = corners.map(([ax, ay], j) => {
        const [bx, by] = corners[(j + 1) % corners.length];
        const [cx, cy] = corners[(j + 2) % corners.length];
        const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
        round += Math.atan2(cross, (bx - ax) * (cx - bx) + (by - ay) * (cy - by));
        return Math.sign(cross);
      });
      if (turns.some((s) => s === 0 || s !== turns[0]) || Math.abs(round) > 3 * Math.PI) {
        throw new RangeError(`simulate: ${who} points must go round a convex shape once, every corner turning the same way`);
      }
    }
    let area = 0;
    corners.forEach(([ax, ay], j) => {
      const [bx, by] = corners[(j + 1) % corners.length];
      area += (ax * by - bx * ay) / 2;
    });
    const xs = corners.map((p) => p[0]);
    const ys = corners.map((p) => p[1]);
    const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    return { x: b.x, y: b.y, angle, vx, vy, spin, mass, hold, box: points === undefined ? [width, height] : null, corners, area: Math.abs(area), extent };
  });
  // planck merges corners closer than half its linearSlop, in units of the
  // median extent, and makes a shape left with fewer than 3 a box 2 units
  // wide: such a body would collide as a shape it is not.
  if (shapes.some((s) => !s.box)) {
    const weld = (0.5 * require('./planck.js').Settings.linearSlop) * shapes.map((s) => s.extent).sort((a, b) => a - b)[shapes.length >> 1];
    shapes.forEach((s, k) => {
      if (s.box) return;
      s.corners.forEach(([ax, ay], i) => s.corners.forEach(([bx, by], j) => {
        if (j > i && Math.hypot(bx - ax, by - ay) < weld) throw new RangeError(`simulate: body ${k} points ${i} and ${j} must be at least ${weld} apart, 1/400 of the bodies' median size, or planck merges them; make the body larger`);
      }));
    });
  }
  return shapes;
}

/**
 * Solve the bodies with planck, the walls fixed, one world step per substep:
 * poses and motions per frame, and the contacts as the particles' log words
 * them. planck's tolerances suit bodies about 1 unit across, so every length,
 * position, speed and gravity is divided by U, the median of the bodies'
 * widest extents, on the way in, and multiplied back on the way out; angles
 * and spin are not scaled. A body far smaller or larger than U, beyond about
 * 50 times, gets planck's tolerances in its own size.
 */
function solveBodies(list, { frames, hz, S, gravity, keep, wall, restitution, friction, quiet }) {
  const nb = list.length;
  const poses = new Float64Array(frames * nb * 3);
  const motions = new Float64Array(frames * nb * 3);
  const log = [];
  if (nb === 0) return { poses, motions, log };
  const planck = require('./planck.js');
  // planck would slow a body to 2 units a step, twice U; the sweep against
  // the walls catches a faster one, so a body keeps the speed it is given.
  planck.Settings.maxTranslation = Infinity;
  const U =list.map((b) => b.extent).sort((a, b) => a - b)[nb >> 1];
  const h = 1 / (hz * S);
  // planck stops bouncing below 1 unit a second, U in design units, so a large
  // body would not bounce at all; it rests below the particles' speed instead.
  planck.Settings.velocityThreshold = (REST * Math.hypot(gravity[0], gravity[1]) * h) / U;
  const vec = (x, y) => new planck.Vec2(x / U, y / U);
  // planck puts a body turning or drifting below its fixed tolerances to sleep
  // and stops it; a body here moves until something it meets stops it.
  const world = new planck.World({ gravity: vec(gravity[0], gravity[1]), allowSleep: false });
  const ground = world.createBody();
  wall.forEach((q, k) => ground.createFixture(planck.Edge(vec(q.from[0], q.from[1]), vec(q.to[0], q.to[1])), { friction: q.mu, restitution: q.e, userData: k }));
  const solids = list.map((b, k) => {
    const it = world.createBody({
      type: b.hold > 0 ? 'static' : 'dynamic', position: vec(b.x, b.y), angle: b.angle,
      linearVelocity: vec(b.vx, b.vy), angularVelocity: b.spin, userData: k,
    });
    const shape = b.box ? planck.Box(b.box[0] / U / 2, b.box[1] / U / 2) : planck.Polygon(b.corners.map(([x, y]) => vec(x, y)));
    it.createFixture(shape, { density: (b.mass * U * U) / b.area, friction, restitution });
    return it;
  });
  let f = 0;
  let sec = 0;
  // planck reports a touch the last step's solve made as this step opens,
  // before it moves anything, and a touch its sweep finds
  // after this step's solve. The first is stamped with the last step, whose
  // frame is the first to show it.
  let opening = false;
  let was = [0, 0];
  const solver = world.m_solver;
  const solveWorld = solver.solveWorld;
  solver.solveWorld = (step) => { opening = false; solveWorld.call(solver, step); };
  const endsOf = (c) => [c.getFixtureA(), c.getFixtureB()].map((x) => (x.getBody() === ground ? { wall: x.getUserData() } : { body: x.getBody() }));
  // The normal points from A to B; the speed the two close at along it at a
  // point, in design units, read before the step solves it.
  const closing = (ends, m, point) => {
    const v = ends.map((e) => (e.body ? e.body.getLinearVelocityFromWorldPoint(point) : { x: 0, y: 0 }));
    return -((v[1].x - v[0].x) * m.normal.x + (v[1].y - v[0].y) * m.normal.y) * U;
  };
  // A touch counts as an impact when it closes at `quiet` or faster, and
  // faster than a resting body's `REST` steps of gravity. Letting a held body
  // go rebuilds every contact it has, and those that were resting, or that
  // only gravity's first step closes, begin again below this.
  const landing = Math.max(quiet, REST * Math.hypot(gravity[0], gravity[1]) * h);
  // An impact at manifold points `at`: logged at their middle when the two
  // close there at `landing` or faster.
  const note = (c, m, at) => {
    const ends = endsOf(c);
    const by = ends.find((e) => e.wall !== undefined);
    let px = 0;
    let py = 0;
    for (const i of at) { px += m.points[i].x / at.length; py += m.points[i].y / at.length; }
    const speed = closing(ends, m, new planck.Vec2(px, py));
    if (!(speed > 0 && speed >= landing)) return;
    const k = ends.map((e) => (e.body ? e.body.getUserData() : Infinity));
    const first = k[0] <= k[1] ? 0 : 1;
    const towards = first === 1 ? 1 : -1;
    log.push(Object.freeze({
      frame: opening ? was[0] : f, seconds: opening ? was[1] : sec, x: px * U, y: py * U, nx: m.normal.x * towards, ny: m.normal.y * towards,
      speed, a: null, b: null, wall: by ? by.wall : null, body: k[first], other: by ? null : k[1 - first],
    }));
  };
  // A contact that begins touching: a body meeting a wall takes the wall's
  // restitution and friction, two bodies the spec's. It is logged once, at the
  // middle of all its points.
  const fast = new WeakMap();
  world.on('begin-contact', (c) => {
    fast.delete(c);
    const by = endsOf(c).find((e) => e.wall !== undefined);
    c.setRestitution(by ? wall[by.wall].e : restitution);
    c.setFriction(by ? wall[by.wall].mu : friction);
    const m = c.getWorldManifold(null);
    if (!m || m.pointCount === 0) return;
    note(c, m, Array.from({ length: m.pointCount }, (_, i) => i));
  });
  // A body already touching lands again when a corner or face it pivoted
  // towards comes down while it rests on another point. A point closing at
  // `landing` or faster logs an impact at that point when it was not closing
  // so fast the step before; the step a contact begins only marks its points.
  world.on('pre-solve', (c) => {
    const m = c.getWorldManifold(null);
    if (!m) return;
    const ends = endsOf(c);
    const ids = c.getManifold().points;
    const before = fast.get(c);
    const now = new Set();
    const at = [];
    for (let i = 0; i < m.pointCount; i++) {
      if (closing(ends, m, m.points[i]) < landing) continue;
      now.add(ids[i].id.key);
      if (before && !before.has(ids[i].id.key)) at.push(i);
    }
    fast.set(c, now);
    if (at.length > 0) note(c, m, at);
  });
  const snap = (frame) => solids.forEach((it, k) => {
    const p = it.getPosition();
    const v = it.getLinearVelocityFromWorldPoint(p);
    const o = (frame * nb + k) * 3;
    poses[o] = p.x * U; poses[o + 1] = p.y * U; poses[o + 2] = it.getAngle();
    motions[o] = v.x * U; motions[o + 1] = v.y * U; motions[o + 2] = it.getAngularVelocity();
  });
  snap(0);
  for (f = 1; f < frames; f++) {
    for (let k = 0; k < S; k++) {
      const t = ((f - 1) * S + k) * h;
      sec = ((f - 1) * S + k + 1) * h;
      solids.forEach((it, j) => { if (it.isStatic() && t >= list[j].hold) it.setDynamic(); });
      // A bullet's step is swept against the other bodies too, not only the
      // walls. Only a body that a step carries further than planck's linear
      // tolerance is one: sweeping a resting stack's bodies tips it over.
      for (let j = 0; j < nb; j++) {
        const it = solids[j];
        const v = it.getLinearVelocity();
        it.setBullet(it.isDynamic() && (Math.hypot(v.x, v.y) + (Math.abs(it.getAngularVelocity()) * list[j].extent) / U / 2) * h > planck.Settings.linearSlop);
      }
      was = [k === 0 ? f - 1 : f, t];
      opening = true;
      world.step(h, 8, 3);
      if (keep === 1) continue;
      for (const it of solids) {
        if (!it.isDynamic()) continue;
        const v = it.getLinearVelocity();
        it.setLinearVelocity(new planck.Vec2(v.x * keep, v.y * keep));
        it.setAngularVelocity(it.getAngularVelocity() * keep);
      }
    }
    snap(f);
  }
  return { poses, motions, log };
}

/** The particles' log and the bodies', each in its order, merged by time: particles first within a step. */
function merge(parts, bodies) {
  if (bodies.length === 0) return parts;
  const out = [];
  let p = 0;
  for (const e of bodies) {
    while (p < parts.length && parts[p].seconds <= e.seconds) out.push(parts[p++]);
    out.push(e);
  }
  return out.concat(parts.slice(p));
}

/**
 * Links along a run of particles, `first` to `first + count - 1`, each to the
 * next: a thread, a rope or a chain. Each link keeps the distance its two
 * particles start at unless `simulate` is given another.
 */
function chain(first, count) {
  const out = [];
  for (let i = 0; i + 1 < count; i++) out.push([first + i, first + i + 1]);
  return out;
}

/** A chain whose last particle is linked back to its first: a loop. */
function ring(first, count) {
  const out = chain(first, count);
  if (count > 2) out.push([first + count - 1, first]);
  return out;
}

/**
 * Links across a sheet of `cols` by `rows` particles laid out row by row from
 * `first`: each to its right-hand and lower neighbour, a net or a cloth.
 */
function grid(first, cols, rows) {
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = first + r * cols + c;
      if (c + 1 < cols) out.push([i, i + 1]);
      if (r + 1 < rows) out.push([i, i + cols]);
    }
  }
  return out;
}

/**
 * Solve a system of particles over `frames` frames at `hz` frames a second.
 *
 * Frame k is the state at k / hz seconds; frame 0 is the start as given. Each
 * frame takes `substeps` equal steps (default 16), and each step relaxes every
 * link and contact `iterations` times (default 4), links first, then particle
 * pairs, then walls, each in the order given. More substeps hold a long chain
 * to its length better than more relaxations do, for less work.
 *
 * - `particles`: `{ x, y, vx, vy, mass, radius, group, hold, path }`. `mass`
 *   (default 1) weights how far a link or a collision moves each of two. A
 *   `radius` above 0 (default 0) makes a disc that meets walls at that distance
 *   and other discs; discs that share a `group` above 0 pass through each other.
 *   Until `hold` seconds (default 0) the particle is held: it stays where it
 *   starts, or follows `path(seconds) -> [x, y]` when given, and moves nothing
 *   it touches out of its way. Released, it moves off with the velocity its
 *   path last gave it, or from rest; `vx` and `vy` (default 0) are the start
 *   velocity of a particle free from the start. A `path` holds for ever unless
 *   `hold` says otherwise; `hold: Infinity` pins.
 * - `force`: a function (seconds, x, y) returning [fx, fy], a push on every
 *   free particle that varies in time and place; `breaks`: `{ link, at }` or
 *   `{ link, stretch }`, a link that gives way at a second or when stretched
 *   past that share of its length. The result's `broken` lists
 *   `{ link, frame, seconds }`. Without them a solve is unchanged.
 * - `links`: `[a, b]`, `[a, b, length]` or `[a, b, length, stiffness]`: keep
 *   particles a and b `length` apart (default: as far apart as they start),
 *   closing `stiffness` (default 1, above 0 and at most 1) of the error each
 *   relaxation. `chain`, `ring` and `grid` write them. `'rope'` as the last
 *   element, as in `[a, b, 'rope']`, makes a link that pulls but never pushes:
 *   it lets its two particles come closer than `length`, so a chain of them
 *   folds where it lands.
 * - `walls`: `{ from: [x, y], to: [x, y], restitution, friction }`: a
 *   segment, met from either side. A particle moving fast enough to cross it in
 *   one step is caught where its path crosses. An endpoint may instead be a
 *   function `(seconds) -> [x, y]`: the wall then moves, its line taken again
 *   where each step ends, and a body it crosses within a step is caught the
 *   same way. Over a step it moves as a rigid line through its middle, a
 *   change of length growing or shrinking it about that middle, so what rests
 *   on it rides with its middle and turn, and a wall that strikes a body hands
 *   it the wall's speed plus the bounce its restitution gives.
 * - `gravity` `[gx, gy]` in units per second squared (default `[0, 0]`);
 *   `drag` per second (default 0): a free particle keeps `exp(-drag)` of its
 *   velocity each second.
 * - `restitution` (default 0.3) and `friction` (default 0.3) are those of disc
 *   meeting disc, and each wall's own default to them. Restitution runs from 0,
 *   no bounce, to 1, as fast out as in; friction is a Coulomb coefficient.
 * - `quiet` (default 0): contacts approaching slower than this, in units per
 *   second, are not recorded; nor a body's slower than two substeps of gravity.
 * - `bodies` (default `[]`): `{ x, y, angle, vx, vy, spin, width, height,
 *   points, mass, hold }`, boxes and convex shapes that turn, solved by planck
 *   one world step a substep. A box is `width` by `height` centred on (x, y);
 *   `points` instead are 3 to 8 corners `[x, y]` of a convex shape relative to
 *   (x, y). `angle` in radians turns +x towards +y, as the canvas `rotate`
 *   does; `spin` is in radians a second. Until `hold` seconds the body stands
 *   still, and nothing moves it; it has no path. Bodies meet one another and
 *   the walls, which must not move, with each wall's restitution and friction,
 *   or the spec's between two bodies; they do not meet particles. `drag`,
 *   `gravity` and `substeps` hold for them too, `iterations` does not. With
 *   bodies, `particles` may be left out or empty.
 *
 * Returns `{ frames, hz, count, xy, vxy, contacts, wallGrid, at, velocity }`:
 * `xy` and `vxy` hold every frame's positions and velocities, `at(frame, i)`
 * and `velocity(frame, i)` read one as `[x, y]`. A velocity leaves out the
 * push out of an overlap a step starts in, so in a crowd a body can travel
 * further than its velocity says. Travel between frames adds that push back
 * but lags gravity and bounces, so forecast from it only for a body pushed
 * through a crowd at a steady speed; under gravity, velocity forecasts better.
 * `wallGrid` is true when the
 * walls were filed in cells and looked up there, false when every particle was
 * tested against every wall; a wall that moves is never filed, and every
 * particle is tested against it. `contacts` lists every impact in
 * the order it happened, once when two things meet, not again while they stay
 * in touch: `{ frame, seconds, x, y, nx, ny, speed, a, b, wall }`. `frame` is
 * the first frame that shows it, `seconds` when it happened, `x, y` the point
 * of contact, `nx, ny` the normal pointing towards particle `a`, `speed` how
 * fast they closed along it, and `b` the other particle or `wall` the wall's
 * index, the other `null`.
 *
 * With bodies, it also returns `bodies`, their count, `poses` and `motions`,
 * every frame's `x, y, angle` and `vx, vy, spin` per body, `vx, vy` the
 * velocity of its point (x, y), and `pose(frame,
 * k)` and `motion(frame, k)` to read one. A body's contacts join the log, in
 * time order, after the particles' of the same step: `{ frame, seconds, x, y,
 * nx, ny, speed, a: null, b: null, wall, body, other }`, with `body` the lower
 * index of the two, the normal pointing towards it, and `other` the other
 * body or `wall` the wall, the other `null`.
 *
 * Only discs near one another, and particles and walls near one another, are
 * tested for touching, which gives the same bytes as testing every pair;
 * `simulate(spec, { everyPair: true })` tests every pair of discs and every
 * particle against every wall, to check that.
 */
function simulate(spec, { everyPair = false } = {}) {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) throw new RangeError('simulate: needs an object of its keys');
  const {
    frames, hz, substeps = 16, iterations = 4, gravity = [0, 0], drag = 0,
    particles: given, links = [], walls = [], restitution = 0.3, friction = 0.3, quiet = 0, bodies: rigid = [],
  } = spec;
  need('frames', frames, (v) => Number.isSafeInteger(v) && v >= 1, 'a whole number of frames, 1 or more');
  need('hz', hz, (v) => finite(v) && v > 0, 'frames a second above 0');
  need('substeps', substeps, (v) => Number.isInteger(v) && v >= 1 && v <= 1000, 'a whole number from 1 to 1000');
  need('iterations', iterations, (v) => Number.isInteger(v) && v >= 1 && v <= 1000, 'a whole number from 1 to 1000');
  if (!Array.isArray(gravity) || gravity.length !== 2) throw new RangeError('simulate: gravity must be [gx, gy] in units per second squared');
  need('gravity x', gravity[0], finite, 'a finite number');
  need('gravity y', gravity[1], finite, 'a finite number');
  need('drag', drag, (v) => finite(v) && v >= 0, 'a finite number per second, 0 or more');
  need('restitution', restitution, (v) => v >= 0 && v <= 1, 'from 0 to 1');
  need('friction', friction, (v) => finite(v) && v >= 0, 'a finite number, 0 or more');
  need('quiet', quiet, (v) => finite(v) && v >= 0, 'a finite speed, 0 or more');
  if (!Array.isArray(rigid)) throw new RangeError('simulate: bodies must be a list of { x, y, width, height } or { x, y, points }');
  // With bodies, the particles may be left out or empty.
  const particles = given === undefined && rigid.length > 0 ? [] : given;
  if (!Array.isArray(particles) || (particles.length === 0 && rigid.length === 0)) throw new RangeError('simulate: particles must be a non-empty list');
  if (!Array.isArray(links)) throw new RangeError('simulate: links must be a list of [a, b, length, stiffness]');
  if (!Array.isArray(walls)) throw new RangeError('simulate: walls must be a list of { from, to }');

  const n = particles.length;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);
  const x0 = new Float64Array(n);           // where each particle started the step
  const y0 = new Float64Array(n);
  const ux = new Float64Array(n);           // its velocity before the step
  const uy = new Float64Array(n);
  const px = new Float64Array(n);           // its velocity before its contacts' pass
  const py = new Float64Array(n);
  const mark = new Int32Array(n).fill(-1);  // the step it was last touched on
  const lift = new Float64Array(n);         // the square of the speed a wall in motion may leave it with, or -1
  const inv = new Float64Array(n);          // 1 / mass
  const w = new Float64Array(n);            // 1 / mass while free, 0 while held
  const rad = new Float64Array(n);
  const group = new Array(n);
  const hold = new Float64Array(n);
  const path = new Array(n);
  particles.forEach((p, i) => {
    const who = `particle ${i}`;
    if (p === null || typeof p !== 'object') throw new RangeError(`simulate: ${who} must be an object of its keys`);
    const { mass = 1, radius = 0, vx: pvx = 0, vy: pvy = 0, group: g = 0 } = p;
    need(`${who} x`, p.x, finite, 'a finite number');
    need(`${who} y`, p.y, finite, 'a finite number');
    need(`${who} vx`, pvx, finite, 'a finite number');
    need(`${who} vy`, pvy, finite, 'a finite number');
    need(`${who} mass`, mass, (v) => finite(v) && v > 0, 'a finite number above 0');
    need(`${who} radius`, radius, (v) => finite(v) && v >= 0, 'a finite number, 0 or more');
    need(`${who} group`, g, (v) => Number.isInteger(v) && v >= 0, 'a whole number, 0 or more');
    if (p.path !== undefined && typeof p.path !== 'function') throw new RangeError(`simulate: ${who} path must be a function of seconds returning [x, y]`);
    const h = p.hold === undefined ? (p.path ? Infinity : 0) : p.hold;
    need(`${who} hold`, h, (v) => v >= 0, 'seconds, 0 or more, or Infinity');
    if (h > 0 && (pvx !== 0 || pvy !== 0)) throw new RangeError(`simulate: ${who} is held, so it starts at rest; move it with a path, or give it no hold`);
    x[i] = p.x; y[i] = p.y; vx[i] = pvx; vy[i] = pvy;
    inv[i] = 1 / mass; rad[i] = radius; group[i] = g; hold[i] = h; path[i] = p.path;
  });

  const L = links.length;
  const la = new Int32Array(L);
  const lb = new Int32Array(L);
  const len = new Float64Array(L);
  const stiff = new Float64Array(L);
  const rope = new Uint8Array(L);
  links.forEach((k, j) => {
    const who = `link ${j}`;
    const slack = Array.isArray(k) && k.length > 2 && k[k.length - 1] === 'rope';
    const m = slack ? k.length - 1 : Array.isArray(k) ? k.length : 0;
    if (m < 2 || m > 4) throw new RangeError(`simulate: ${who} must be [a, b], [a, b, length] or [a, b, length, stiffness], with 'rope' last for one that never pushes`);
    const [a, b, l, s = 1] = slack ? k.slice(0, m) : k;
    need(`${who} a`, a, (v) => Number.isInteger(v) && v >= 0 && v < n, `a particle index from 0 to ${n - 1}`);
    need(`${who} b`, b, (v) => Number.isInteger(v) && v >= 0 && v < n && v !== a, `another particle index from 0 to ${n - 1}`);
    const rest = l === undefined ? Math.hypot(x[b] - x[a], y[b] - y[a]) : l;
    need(`${who} length`, rest, (v) => finite(v) && v > 0, 'a finite distance above 0; two particles that start together need one');
    need(`${who} stiffness`, s, (v) => v > 0 && v <= 1, 'above 0 and at most 1');
    la[j] = a; lb[j] = b; len[j] = rest; stiff[j] = s; rope[j] = slack ? 1 : 0;
  });

  // A push that varies in time and place, and links that give way: at a
  // second, or when stretched past a share of their length.
  const force = spec.force;
  if (force !== undefined && typeof force !== 'function') throw new RangeError('simulate: force must be a function (seconds, x, y) returning [fx, fy]');
  const breakAt = new Float64Array(L).fill(Infinity);
  const breakBy = new Float64Array(L).fill(Infinity);
  const gone = new Float64Array(L).fill(-1);  // the second a link gave way, or -1
  if (spec.breaks !== undefined && !Array.isArray(spec.breaks)) throw new RangeError('simulate: breaks must be a list of { link, at } or { link, stretch }');
  (spec.breaks || []).forEach((b, k) => {
    const who = `break ${k}`;
    if (b === null || typeof b !== 'object') throw new RangeError(`simulate: ${who} must be { link, at } or { link, stretch }`);
    need(`${who} link`, b.link, (v) => Number.isInteger(v) && v >= 0 && v < L, `a link index from 0 to ${L - 1}`);
    if (b.at === undefined && b.stretch === undefined) throw new RangeError(`simulate: ${who} needs at, the second it gives way, or stretch, the share of its length it gives way past`);
    if (b.at !== undefined) { need(`${who} at`, b.at, (v) => finite(v) && v >= 0, 'seconds, 0 or more'); breakAt[b.link] = b.at; }
    if (b.stretch !== undefined) { need(`${who} stretch`, b.stretch, (v) => finite(v) && v > 1, 'a share above 1, such as 1.5'); breakBy[b.link] = b.stretch; }
  });
  const broken = [];

  const M = walls.length;
  const wall = walls.map((wl, j) => {
    const who = `wall ${j}`;
    if (wl === null || typeof wl !== 'object') throw new RangeError(`simulate: ${who} must be an object of its keys`);
    const { from, to, restitution: e = restitution, friction: mu = friction } = wl;
    for (const [name, pt] of [['from', from], ['to', to]]) {
      if (typeof pt === 'function') continue;
      if (!Array.isArray(pt) || pt.length !== 2) throw new RangeError(`simulate: ${who} ${name} must be [x, y], or a function of seconds returning [x, y]`);
      need(`${who} ${name} x`, pt[0], finite, 'a finite number');
      need(`${who} ${name} y`, pt[1], finite, 'a finite number');
    }
    need(`${who} restitution`, e, (v) => v >= 0 && v <= 1, 'from 0 to 1');
    need(`${who} friction`, mu, (v) => finite(v) && v >= 0, 'a finite number, 0 or more');
    // A wall with an endpoint that is a function of seconds moves: `pose`
    // sets its line where the step ends, and the step keeps the middle of
    // the line and its directions from where the step started, `mx0` on.
    return {
      from, to, moves: typeof from === 'function' || typeof to === 'function', e, mu, swept: false,
      ax: 0, ay: 0, mx: 0, my: 0, dx: 0, dy: 0, nx: 0, ny: 0, length: 0, skin: 0,
      mx0: 0, my0: 0, dx0: 0, dy0: 0, nx0: 0, ny0: 0,
    };
  });
  const endpoint = (k, name, sec) => {
    const pt = wall[k][name];
    if (typeof pt !== 'function') return pt;
    const q = pt(sec);
    if (!Array.isArray(q) || q.length !== 2 || !finite(q[0]) || !finite(q[1])) {
      throw new RangeError(`simulate: wall ${k} ${name} must return finite [x, y], got ${JSON.stringify(q)} at ${sec} s`);
    }
    return q;
  };
  // Wall k's line at `sec`: along the wall, and its normal, `from` to `to`
  // turned a quarter. `skin` is the hair a particle without a radius is kept
  // off the line.
  const pose = (k, sec) => {
    const q = wall[k];
    const from = endpoint(k, 'from', sec);
    const to = endpoint(k, 'to', sec);
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const length = Math.hypot(dx, dy);
    need(`wall ${k} length`, length, (v) => v > 0, `above 0${q.moves ? ` at ${sec} s` : ''}: from and to must differ`);
    q.ax = from[0]; q.ay = from[1]; q.mx = (from[0] + to[0]) / 2; q.my = (from[1] + to[1]) / 2;
    q.dx = dx / length; q.dy = dy / length; q.nx = -dy / length; q.ny = dx / length; q.length = length;
    q.skin = SKIN * (length + Math.abs(from[0]) + Math.abs(from[1]));
  };
  const movers = [];
  wall.forEach((q, k) => {
    pose(k, 0);
    if (q.moves) movers.push(k);
  });
  const shapes = readBodies(rigid, 1 / (hz * substeps));
  if (shapes.length > 0 && movers.length > 0) throw new RangeError(`simulate: wall ${movers[0]} moves, and bodies meet only walls that stand still`);
  // A moving wall's line at the end of a step, keeping the line it had at the
  // start. Over the step the wall moves as a rigid line through its middle:
  // it translates and turns with the middle, and a change of length grows or
  // shrinks it about that middle, so the ends of a floor drawing in drag
  // nothing standing on it, and a belt whose ends move together carries
  // what rests on it. A wall whose direction reverses within a step, its ends
  // passing through each other or the line turning more than a quarter, has
  // no rigid motion through its middle: the sweep would carry a body that
  // rested on it to its other side, so the step is refused by name.
  const sweep = (sec) => {
    for (const k of movers) {
      const q = wall[k];
      q.mx0 = q.mx; q.my0 = q.my; q.dx0 = q.dx; q.dy0 = q.dy; q.nx0 = q.nx; q.ny0 = q.ny;
      pose(k, sec);
      if (q.dx * q.dx0 + q.dy * q.dy0 < 0) {
        throw new RangeError(`simulate: wall ${k} reverses its direction at ${sec} s: its ends pass through each other, or it turns more than a quarter in one step; keep each end on its own side, or raise substeps`);
      }
      q.swept = true;
    }
  };

  // The pairs that can touch are tested in index order: discs only, since a
  // particle without a radius meets walls and nothing else, and never two of
  // one group above 0.
  const discs = [];
  for (let i = 0; i < n; i++) if (rad[i] > 0) discs.push(i);
  const pairs = (record) => {
    for (const i of discs) for (const j of discs) if (j > i && !(group[i] > 0 && group[i] === group[j])) onPair(i, j, record);
  };

  const S = substeps;
  const h = 1 / (hz * S);
  const [gx, gy] = gravity;
  const keep = Math.exp(-drag * h);
  // Slower than this along a normal, a contact rests instead of bouncing.
  const still = REST * Math.hypot(gx, gy) * h;

  const xy = new Float64Array(frames * n * 2);
  const vxy = new Float64Array(frames * n * 2);
  const snap = (f) => {
    const o = f * n * 2;
    for (let i = 0; i < n; i++) { xy[o + 2 * i] = x[i]; xy[o + 2 * i + 1] = y[i]; vxy[o + 2 * i] = vx[i]; vxy[o + 2 * i + 1] = vy[i]; }
  };
  snap(0);

  const where = (i, sec) => {
    const q = path[i](sec);
    if (!Array.isArray(q) || !finite(q[0]) || !finite(q[1])) {
      throw new RangeError(`simulate: particle ${i} path must return finite [x, y], got ${JSON.stringify(q)} at ${sec} s`);
    }
    return q;
  };

  // This step's contacts, in the order first found: kind (0 wall, 1 pair), i,
  // j, the normal towards i, and for the velocity pass the normal speed it
  // aims at, the sum of its pushes so far and the least that sum may reach.
  let touch = new Map();
  let before = new Map();
  const contacts = [];

  const meet = (key, kind, i, j, nx, ny, wx, wy) => {
    const c = touch.get(key);
    if (c) { c.nx = nx; c.ny = ny; c.wx = wx; c.wy = wy; return; }
    touch.set(key, { kind, i, j, nx, ny, wx, wy, target: 0, sum: 0, floor: null });
  };

  // Push particle i out of wall k along the normal; hold it where it lay across
  // the wall when friction is enough to stop that little slip.
  const onWall = (i, k, record) => {
    const q = wall[k];
    const r = rad[i];
    // Where the particle started the step. Against a wall that moved over the
    // step, where it started in the wall's own frame: as far along the wall
    // from its middle, and as far off its line, as it was, measured where the
    // wall now stands. The step is then swept against the wall where it
    // stands, so a wall crossing a body catches it as a body crossing a wall
    // is caught, and a slip is measured against the wall's own motion.
    let sx = x0[i];
    let sy = y0[i];
    if (q.swept) {
      const along0 = (sx - q.mx0) * q.dx0 + (sy - q.my0) * q.dy0;
      const off0 = (sx - q.mx0) * q.nx0 + (sy - q.my0) * q.ny0;
      sx = q.mx + q.dx * along0 + q.nx * off0;
      sy = q.my + q.dy * along0 + q.ny * off0;
    }
    const s0 = (sx - q.ax) * q.nx + (sy - q.ay) * q.ny;
    const s1 = (x[i] - q.ax) * q.nx + (y[i] - q.ay) * q.ny;
    // On one side all step and at least a radius off the line: no contact.
    if ((s0 > 0 && s1 > r) || (s0 < 0 && s1 < -r)) return;
    let nx = 0;
    let ny = 0;
    let depth = 0;
    // Did the step's path reach the wall's line within its length, from the
    // side it started on? It is put back on that side, at least a hair off the
    // line, so rounding cannot leave it on the other side for the next step.
    const crossed = (s0 > 0 && s1 <= 0) || (s0 < 0 && s1 >= 0);
    let hit = false;
    let along = 0;
    if (crossed) {
      const u = s0 / (s0 - s1);
      const cx = sx + (x[i] - sx) * u;
      const cy = sy + (y[i] - sy) * u;
      along = (cx - q.ax) * q.dx + (cy - q.ay) * q.dy;
      if (along >= 0 && along <= q.length) {
        const side = s0 > 0 ? 1 : -1;
        nx = side * q.nx; ny = side * q.ny;
        depth = Math.max(r, q.skin) - side * s1;
        hit = true;
      }
    }
    if (!hit) {
      if (r === 0) return;
      along = Math.min(q.length, Math.max(0, (x[i] - q.ax) * q.dx + (y[i] - q.ay) * q.dy));
      const cx = q.ax + q.dx * along;
      const cy = q.ay + q.dy * along;
      const ox = x[i] - cx;
      const oy = y[i] - cy;
      const d = Math.hypot(ox, oy);
      if (d >= r) return;
      if (d > 0) { nx = ox / d; ny = oy / d; } else {
        const side = s0 >= 0 ? 1 : -1;
        nx = side * q.nx; ny = side * q.ny;
      }
      depth = r - d;
    }
    // Along the normal only: the particle keeps its place along the surface.
    x[i] += nx * depth;
    y[i] += ny * depth;
    if (!record) return;
    // Static friction: a slip along the wall smaller than friction times the
    // push is undone, so a body at rest on a slope stays there.
    const mx = x[i] - sx;
    const my = y[i] - sy;
    const mn = mx * nx + my * ny;
    const tx = mx - mn * nx;
    const ty = my - mn * ny;
    if (Math.hypot(tx, ty) < q.mu * depth) { x[i] -= tx; y[i] -= ty; }
    // The wall's velocity at the contact: how far the point of the line the
    // contact lies at moved over the step, with the middle and the turn.
    let wx = 0;
    let wy = 0;
    if (q.swept) {
      const a = along - q.length / 2;
      wx = (q.mx + q.dx * a - (q.mx0 + q.dx0 * a)) / h;
      wy = (q.my + q.dy * a - (q.my0 + q.dy0 * a)) / h;
    }
    if (held) held.push(k, i, nx, ny, wx, wy); else meet(i * (M + 1) + k, 0, i, k, nx, ny, wx, wy);
  };

  // Push two discs apart along the line between them, each by the share its
  // mass leaves it.
  const onPair = (i, j, record) => {
    const wi = w[i];
    const wj = w[j];
    if (wi + wj === 0) return;
    const ox = x[i] - x[j];
    const oy = y[i] - y[j];
    const reach = rad[i] + rad[j];
    if (Math.abs(ox) >= reach || Math.abs(oy) >= reach) return;
    const d = Math.hypot(ox, oy);
    if (d >= reach) return;
    // Two discs at one point part along x, the same way every time.
    const nx = d > 0 ? ox / d : 1;
    const ny = d > 0 ? oy / d : 0;
    const depth = reach - d;
    const a = wi / (wi + wj);
    x[i] += nx * depth * a; y[i] += ny * depth * a;
    x[j] -= nx * depth * (1 - a); y[j] -= ny * depth * (1 - a);
    if (!record) return;
    // Static friction between the two, on their relative slip.
    const mx = x[i] - x0[i] - (x[j] - x0[j]);
    const my = y[i] - y0[i] - (y[j] - y0[j]);
    const mn = mx * nx + my * ny;
    const tx = mx - mn * nx;
    const ty = my - mn * ny;
    if (Math.hypot(tx, ty) < friction * depth) {
      x[i] -= tx * a; y[i] -= ty * a;
      x[j] += tx * (1 - a); y[j] += ty * (1 - a);
    }
    meet(n * (M + 1) + i * n + j, 1, i, j, nx, ny, 0, 0);
  };

  // A contact's normal velocity, relative velocity for a pair: bounce what came
  // in, never more. Reflect only a velocity that pointed into the surface.
  // Contacts that share a body are solved together, a few passes in a fixed
  // order: each keeps the sum of its pushes, so where one body meets several
  // at once the bounces settle on one answer instead of adding up. The sum may
  // take back speed the push out of an overlap gave, which a deep overlap
  // turns into far more than came in, but never pulls beyond that.
  const bounce = (c) => {
    const { kind, i, j, nx, ny, wx, wy } = c;
    const wi = w[i];
    const wj = kind === 0 ? 0 : w[j];
    if (wi + wj === 0) return;
    const came = (ux[i] - (kind === 0 ? wx : ux[j])) * nx + (uy[i] - (kind === 0 ? wy : uy[j])) * ny;
    // What was already leaving keeps its speed and gets no push.
    const e = kind === 0 ? wall[j].e : restitution;
    // Gravity pulling a body off the underside of a wall slowed it on the way
    // in, so it bounces back no faster than it arrived.
    const off = kind === 0 ? Math.max(0, (gx * nx + gy * ny) * h) : 0;
    c.target = came >= 0 ? came : -came > still ? -e * Math.min(0, came + off) : 0;
    const vn = (vx[i] - (kind === 0 ? wx : vx[j])) * nx + (vy[i] - (kind === 0 ? wy : vy[j])) * ny;
    if (c.floor === null) c.floor = Math.min(0, c.target - vn);
    const total = Math.min(came >= 0 ? 0 : Infinity, Math.max(c.floor, c.sum + c.target - vn));
    const dn = total - c.sum;
    c.sum = total;
    const a = wi / (wi + wj);
    vx[i] += nx * dn * a; vy[i] += ny * dn * a;
    if (kind === 1) { vx[j] -= nx * dn * (1 - a); vy[j] -= ny * dn * (1 - a); }
  };

  // Then the slide slows by friction times the change the contact made along
  // the normal, gravity's pull into it included, and a new impact is logged.
  const settle = (c, f, sec) => {
    const { kind, i, j, nx, ny, wx, wy } = c;
    const mu = kind === 0 ? wall[j].mu : friction;
    const wi = w[i];
    const wj = kind === 0 ? 0 : w[j];
    if (wi + wj === 0) return;
    const rvx = vx[i] - (kind === 0 ? wx : vx[j]);
    const rvy = vy[i] - (kind === 0 ? wy : vy[j]);
    const came = (ux[i] - (kind === 0 ? wx : ux[j])) * nx + (uy[i] - (kind === 0 ? wy : uy[j])) * ny;
    const vn = rvx * nx + rvy * ny;
    const a = wi / (wi + wj);
    const pull = kind === 0 ? -(gx * nx + gy * ny) * h : 0;
    const pressed = Math.max(0, c.target - came + pull);
    const tx = rvx - vn * nx;
    const ty = rvy - vn * ny;
    const slide = Math.hypot(tx, ty);
    if (slide > 0) {
      const cut = Math.min(slide, mu * pressed) / slide;
      vx[i] -= tx * cut * a; vy[i] -= ty * cut * a;
      if (kind === 1) { vx[j] += tx * cut * (1 - a); vy[j] += ty * cut * (1 - a); }
    }
    const key = kind === 0 ? i * (M + 1) + j : n * (M + 1) + i * n + j;
    if (came < 0 && -came >= quiet && !before.has(key)) {
      const r = rad[i];
      contacts.push(Object.freeze({
        frame: f, seconds: sec, x: x[i] - nx * r, y: y[i] - ny * r, nx, ny,
        speed: -came, a: i, b: kind === 1 ? j : null, wall: kind === 0 ? j : null,
      }));
    }
  };

  // The broad phase: the discs filed in square cells a little wider than the
  // widest reach of two discs, so two that touch lie in one cell or in two
  // that meet. Of `pairs`, only those of neighbours are tested, in the same
  // order, so the result is the same to the bit. A push moves only its two
  // discs: while disc i meets each j above it in turn, the discs above j stay
  // where they were looked up, and i is looked up again if it changes cell.
  // Discs more than four times the median radius are large, and filed in
  // cells of their own, sized by the widest of them, so large discs do not
  // make every cell large. A small disc looks the large ones up in the large
  // cells around its small cell. A large disc looks up the small ones in every
  // small cell within its reach, or, when those cells outnumber the discs,
  // takes every disc above it; a push that moves it to another cell of either
  // size has it looked up again.
  const radii = discs.map((i) => rad[i]).sort((a, b) => a - b);
  const limit = 4 * radii[radii.length >> 1];
  const large = new Uint8Array(n);
  const filed = [];
  const apart = [];
  let widest = 0;
  let widestLarge = 0;
  for (const i of discs) {
    if (rad[i] > limit) { large[i] = 1; apart.push(i); widestLarge = Math.max(widestLarge, rad[i]); } else { filed.push(i); widest = Math.max(widest, rad[i]); }
  }
  const size = 2 * widest * (1 + 2 ** -20);
  const sizeLarge = 2 * widestLarge * (1 + 2 ** -20);
  const next = new Int32Array(n);
  const prev = new Int32Array(n);
  const cx = new Int32Array(n);
  const cy = new Int32Array(n);
  const near = new Int32Array(n);
  let count = 0;
  // Cells hash to buckets, each a list linked through `next` and `prev`; a
  // bucket can hold several cells, and a disc counts only in its own.
  const T = 2 ** Math.ceil(Math.log2(2 * filed.length + 2));
  const head = new Int32Array(T);
  const bucket = (u, v) => (Math.imul(u, 0x9e3779b1) ^ Math.imul(v, 0x85ebca77)) & (T - 1);
  const file = (i) => {
    cx[i] = Math.floor(x[i] / size);
    cy[i] = Math.floor(y[i] / size);
    const b = bucket(cx[i], cy[i]);
    prev[i] = -1;
    next[i] = head[b];
    if (head[b] >= 0) prev[head[b]] = i;
    head[b] = i;
  };
  // True when disc i moved to another cell, and is filed there.
  const move = (i) => {
    if (Math.floor(x[i] / size) === cx[i] && Math.floor(y[i] / size) === cy[i]) return false;
    if (prev[i] >= 0) next[prev[i]] = next[i]; else head[bucket(cx[i], cy[i])] = next[i];
    if (next[i] >= 0) prev[next[i]] = prev[i];
    file(i);
    return true;
  };
  // The discs filed in cells u0 to u1 across and v0 to v1 down, above index
  // `after` and outside disc i's group, added to `near` in index order.
  const walk = (i, u0, u1, v0, v1, after) => {
    const g = group[i];
    for (let u = u0; u <= u1; u++) {
      for (let v = v0; v <= v1; v++) {
        for (let j = head[bucket(u, v)]; j >= 0; j = next[j]) {
          if (j <= after || cx[j] !== u || cy[j] !== v || (g > 0 && g === group[j])) continue;
          let k = count++;
          for (; k > 0 && near[k - 1] > j; k--) near[k] = near[k - 1];
          near[k] = j;
        }
      }
    }
  };
  // Disc i's neighbours above index `after` it can touch, in index order.
  const cells = (i, after) => {
    count = 0;
    walk(i, cx[i] - 1, cx[i] + 1, cy[i] - 1, cy[i] + 1, after);
  };
  // The same for cells `s` wide in `t` buckets, for large discs alone or
  // every disc together. The small cells keep their own copy: reached through
  // this one, they cost the common case 4 %.
  const cellsOf = (s, t) => {
    const top = new Int32Array(t);
    const at = (u, v) => (Math.imul(u, 0x9e3779b1) ^ Math.imul(v, 0x85ebca77)) & (t - 1);
    const put = (i) => {
      cx[i] = Math.floor(x[i] / s);
      cy[i] = Math.floor(y[i] / s);
      const b = at(cx[i], cy[i]);
      prev[i] = -1;
      next[i] = top[b];
      if (top[b] >= 0) prev[top[b]] = i;
      top[b] = i;
    };
    const shift = (i) => {
      if (Math.floor(x[i] / s) === cx[i] && Math.floor(y[i] / s) === cy[i]) return false;
      if (prev[i] >= 0) next[prev[i]] = next[i]; else top[at(cx[i], cy[i])] = next[i];
      if (next[i] >= 0) prev[next[i]] = prev[i];
      put(i);
      return true;
    };
    const look = (i, u0, u1, v0, v1, after) => {
      const g = group[i];
      for (let u = u0; u <= u1; u++) {
        for (let v = v0; v <= v1; v++) {
          for (let j = top[at(u, v)]; j >= 0; j = next[j]) {
            if (j <= after || cx[j] !== u || cy[j] !== v || (g > 0 && g === group[j])) continue;
            let m = count++;
            for (; m > 0 && near[m - 1] > j; m--) near[m] = near[m - 1];
            near[m] = j;
          }
        }
      }
    };
    return { head: top, bucket: at, file: put, move: shift, walk: look };
  };
  const big = cellsOf(sizeLarge, 2 ** Math.ceil(Math.log2(2 * apart.length + 2)));
  const whole = cellsOf(sizeLarge, 2 ** Math.ceil(Math.log2(2 * (apart.length > 0 ? discs.length : 0) + 2)));
  // How many small cells out a large disc reaches, or 0 when it takes every
  // disc; and the small cell it was last looked up around.
  const span = new Int32Array(n);
  for (const i of apart) {
    const k = Math.ceil((rad[i] + widest) / (2 * widest));
    if ((2 * k + 1) ** 2 <= discs.length) span[i] = k;
  }
  const ox = new Int32Array(n);
  const oy = new Int32Array(n);
  // A few large discs cost a small one less to go through than to look up.
  // Otherwise it looks up the large cells within the reach of a small and a
  // large disc of its whole small cell, so it needs no other look until it
  // leaves that cell.
  const few = apart.length <= 16;
  const reach = (widest + widestLarge) * (1 + 2 ** -20);
  const refileApart = (i) => {
    if (large[i]) return big.move(i) || (span[i] > 0 && (Math.floor(x[i] / size) !== ox[i] || Math.floor(y[i] / size) !== oy[i]));
    return move(i);
  };
  const aroundApart = (i, after) => {
    count = 0;
    if (large[i] && span[i] === 0) {
      const g = group[i];
      for (const j of discs) if (j > after && !(g > 0 && g === group[j])) near[count++] = j;
      return;
    }
    if (large[i]) {
      ox[i] = Math.floor(x[i] / size);
      oy[i] = Math.floor(y[i] / size);
      walk(i, ox[i] - span[i], ox[i] + span[i], oy[i] - span[i], oy[i] + span[i], after);
      big.walk(i, cx[i] - 1, cx[i] + 1, cy[i] - 1, cy[i] + 1, after);
      return;
    }
    walk(i, cx[i] - 1, cx[i] + 1, cy[i] - 1, cy[i] + 1, after);
    if (!few) {
      const u0 = Math.floor((cx[i] * size - reach) / sizeLarge);
      const u1 = Math.floor(((cx[i] + 1) * size + reach) / sizeLarge);
      const v0 = Math.floor((cy[i] * size - reach) / sizeLarge);
      const v1 = Math.floor(((cy[i] + 1) * size + reach) / sizeLarge);
      big.walk(i, u0, u1, v0, v1, after);
      return;
    }
    const g = group[i];
    for (const j of apart) {
      if (j <= after || (g > 0 && g === group[j])) continue;
      let m = count++;
      for (; m > 0 && near[m - 1] > j; m--) near[m] = near[m - 1];
      near[m] = j;
    }
  };
  // Rounding cannot file a disc a cell off within 2^22 small cells of the
  // origin. A pass that starts with a disc beyond, or at a coordinate that is
  // not a number, tests every pair instead; no pass pushes a disc that far.
  const far = (i) => !(Math.abs(x[i] / size) < 2 ** 22 && Math.abs(y[i] / size) < 2 ** 22);
  // Two sizes apart cost each small disc two looks of nine cells, and each
  // large one its small cells or every disc. In a sparse pile every disc filed
  // in the large cells costs less: each frame takes the cheaper, counting how
  // many discs the large cells around each disc hold where the frame starts,
  // with the sorting that many candidates costs. A cell looked up apart costs
  // about three times as much, measured on piles of two sizes. Either gives the same
  // bytes.
  let together = false;
  let apartCost = (few ? 9 + apart.length : 18) * filed.length;
  for (const i of apart) apartCost += span[i] > 0 ? (2 * span[i] + 1) ** 2 : discs.length;
  apartCost *= 3;
  const tally = new Int32Array(apart.length > 0 ? 2 ** Math.ceil(Math.log2(2 * discs.length + 2)) : 0);
  const choose = () => {
    if (discs.some(far)) return;
    tally.fill(0);
    for (const i of discs) tally[whole.bucket(Math.floor(x[i] / sizeLarge), Math.floor(y[i] / sizeLarge))]++;
    let cost = 0;
    for (let q = 0; q < discs.length && cost <= apartCost; q++) {
      const a = Math.floor(x[discs[q]] / sizeLarge);
      const b = Math.floor(y[discs[q]] / sizeLarge);
      let c = 0;
      for (let u = a - 1; u <= a + 1; u++) for (let v = b - 1; v <= b + 1; v++) c += tally[whole.bucket(u, v)];
      cost += 9 + c + c * c / 8;
    }
    together = cost <= apartCost;
    refile = together ? whole.move : refileApart;
    around = together ? aroundAll : aroundApart;
  };
  const aroundAll = (i, after) => {
    count = 0;
    whole.walk(i, cx[i] - 1, cx[i] + 1, cy[i] - 1, cy[i] + 1, after);
  };
  // Without large discs, these are the small cells' own; the common case pays
  // nothing for the others.
  let refile = move;
  let around = cells;
  const broad = (record) => {
    if (discs.some(far)) return false;
    if (together) {
      whole.head.fill(-1);
      for (const i of discs) whole.file(i);
    } else {
      head.fill(-1);
      big.head.fill(-1);
      for (const i of filed) file(i);
      for (const i of apart) big.file(i);
    }
    for (const i of discs) {
      around(i, i);
      for (let p = 0; p < count; p++) {
        const j = near[p];
        onPair(i, j, record);
        refile(j);
        if (refile(i)) { around(i, j); p = -1; }
      }
    }
    return true;
  };

  // The walls filed once, since they never move, in square cells as wide as
  // the median wall is long, or twice the discs' cells when that is wider, so
  // walls far shorter than a disc do not make its box span many cells and
  // test every wall: each wall cut into pieces half a cell long, and
  // filed in every cell each piece's box, widened by `pad`, covers. A particle
  // can meet a wall only where the wall crosses the box its step spans,
  // widened by its radius, so it is tested only against the walls filed in the
  // cells that box covers. `pad`, far above the rounding of the arithmetic
  // that decides a contact, widens both boxes. A particle meets walls without
  // touching anything else, so taking the particles one by one, each against
  // its walls in index order, moves every one exactly as taking the walls one
  // by one does; the contacts found are then met in wall order, as that would.
  // Eight walls or fewer cost less to test than to look up, and a box of many
  // cells, or one far out, is tested against every wall. So are all walls when
  // they average more than 32 cell widths, each rounded up: filing them then
  // costs more than testing every wall. A wall that moves is never filed:
  // every particle is tested against it, in its place in index order.
  // Cells hash to buckets, as the discs' do, at least twice as many as the
  // cells the pieces fill; a bucket lists each wall with its cell, and a
  // lookup takes only its own cells' walls.
  const lengths = wall.map((q) => q.length).sort((a, b) => a - b);
  const wsize = Math.max(lengths[lengths.length >> 1], 2 * size);
  const pad = wsize * 2 ** -20;
  const inside = (u, v) => Math.abs(u) < 2 ** 22 && Math.abs(v) < 2 ** 22;
  let walled = M > 8;
  let pieces = 0;
  for (let k = 0; walled && k < M; k++) if (!wall[k].moves) pieces += 2 * Math.ceil(wall[k].length / wsize);
  if (pieces > 64 * M) walled = false;
  const B = walled ? 2 ** Math.ceil(Math.log2(8 * pieces)) : 0;
  const cellWalls = new Array(B).fill(null);
  const wallBucket = (u, v) => (Math.imul(u, 0x9e3779b1) ^ Math.imul(v, 0x85ebca77)) & (B - 1);
  for (let k = 0; walled && k < M; k++) {
    const q = wall[k];
    if (q.moves) continue;
    const cut = 2 * Math.ceil(q.length / wsize);
    for (let s = 0; walled && s < cut; s++) {
      const ta = (q.length * s) / cut;
      const tb = (q.length * (s + 1)) / cut;
      const xa = q.ax + q.dx * ta;
      const xb = q.ax + q.dx * tb;
      const ya = q.ay + q.dy * ta;
      const yb = q.ay + q.dy * tb;
      const u0 = Math.floor((Math.min(xa, xb) - pad) / wsize);
      const u1 = Math.floor((Math.max(xa, xb) + pad) / wsize);
      const v0 = Math.floor((Math.min(ya, yb) - pad) / wsize);
      const v1 = Math.floor((Math.max(ya, yb) + pad) / wsize);
      if (!inside(u0, v0) || !inside(u1, v1)) { walled = false; break; }
      for (let u = u0; u <= u1; u++) {
        for (let v = v0; v <= v1; v++) {
          const b = wallBucket(u, v);
          const list = cellWalls[b];
          if (!list) cellWalls[b] = [k, u, v];
          else if (list[list.length - 3] !== k || list[list.length - 2] !== u || list[list.length - 1] !== v) list.push(k, u, v);
        }
      }
    }
  }
  const seen = new Int32Array(M).fill(-1);
  const nearWalls = new Int32Array(M);
  let visit = 0;
  // Particle i's walls above index `after` it can meet, in index order, or -1
  // for every wall. No test fails without `pad` in its box: the walls' pieces
  // are widened by it too, and within the cells `inside` allows it is over
  // 2^10 times the rounding of a coordinate, so either widening alone covers
  // every contact the arithmetic decides. Both stay, so neither side's
  // rounding needs proving on its own.
  const wallsNear = (i, after) => {
    const r = rad[i] + pad;
    const u0 = Math.floor((Math.min(x0[i], x[i]) - r) / wsize);
    const u1 = Math.floor((Math.max(x0[i], x[i]) + r) / wsize);
    const v0 = Math.floor((Math.min(y0[i], y[i]) - r) / wsize);
    const v1 = Math.floor((Math.max(y0[i], y[i]) + r) / wsize);
    if (!((u1 - u0 + 1) * (v1 - v0 + 1) <= 16) || !inside(u0, v0) || !inside(u1, v1)) return -1;
    visit++;
    let m = 0;
    for (let u = u0; u <= u1; u++) {
      for (let v = v0; v <= v1; v++) {
        const list = cellWalls[wallBucket(u, v)];
        if (!list) continue;
        for (let e = 0; e < list.length; e += 3) {
          const k = list[e];
          if (k <= after || seen[k] === visit || list[e + 1] !== u || list[e + 2] !== v) continue;
          seen[k] = visit;
          let p = m++;
          for (; p > 0 && nearWalls[p - 1] > k; p--) nearWalls[p] = nearWalls[p - 1];
          nearWalls[p] = k;
        }
      }
    }
    for (const k of movers) {
      if (k <= after) continue;
      let p = m++;
      for (; p > 0 && nearWalls[p - 1] > k; p--) nearWalls[p] = nearWalls[p - 1];
      nearWalls[p] = k;
    }
    return m;
  };
  // The wall contacts a recorded pass finds, as wall, particle, nx, ny and the
  // wall's velocity, while it goes particle by particle.
  let held = null;
  const found = [];
  const byWall = (a, b) => found[a] - found[b] || found[a + 1] - found[b + 1];
  const wallPass = (record) => {
    found.length = 0;
    held = record ? found : null;
    for (let i = 0; i < n; i++) {
      if (w[i] === 0) continue;
      // From `from` on, every wall: all of them when the box is not looked up,
      // or those above the last one met when its new box is not.
      let from = M;
      let m = wallsNear(i, -1);
      if (m < 0) from = 0;
      for (let p = 0; p < m; p++) {
        const k = nearWalls[p];
        const bx = x[i];
        const by = y[i];
        onWall(i, k, record);
        if (x[i] === bx && y[i] === by) continue;
        m = wallsNear(i, k);
        p = -1;
        if (m < 0) from = k + 1;
      }
      for (let k = from; k < M; k++) onWall(i, k, record);
    }
    held = null;
    if (!record || found.length === 0) return;
    const order = [];
    for (let o = 0; o < found.length; o += 6) order.push(o);
    order.sort(byWall);
    for (const o of order) {
      const k = found[o];
      const i = found[o + 1];
      meet(i * (M + 1) + k, 0, i, k, found[o + 2], found[o + 3], found[o + 4], found[o + 5]);
    }
  };

  // Every disc pair, then every wall, in index order.
  const collide = (record) => {
    if (everyPair || !broad(record)) pairs(record);
    if (walled && !everyPair) wallPass(record);
    else for (let kk = 0; kk < M; kk++) for (let i = 0; i < n; i++) if (w[i] > 0) onWall(i, kk, record);
  };

  for (let f = 1; f < frames; f++) {
    if (apart.length > 0 && !everyPair) choose();
    for (let k = 0; k < S; k++) {
      const t = ((f - 1) * S + k) * h;
      const sec = ((f - 1) * S + k + 1) * h;
      for (let i = 0; i < n; i++) {
        w[i] = t < hold[i] ? 0 : inv[i];
        x0[i] = x[i]; y0[i] = y[i];
      }
      // An overlap the step starts in, such as a body placed inside a wall, is
      // put right before the step, and the step starts from there: turned into
      // velocity, the correction would fire the two apart. The walls stand
      // where the last step left them.
      for (const k of movers) wall[k].swept = false;
      collide(false);
      for (let i = 0; i < n; i++) {
        x0[i] = x[i]; y0[i] = y[i];
        ux[i] = vx[i]; uy[i] = vy[i];
        if (w[i] === 0) {
          if (path[i]) {
            const [qx, qy] = where(i, sec);
            x[i] = qx; y[i] = qy;
          }
          continue;
        }
        if (force) {
          const push = force(t, x[i], y[i]);
          if (!Array.isArray(push) || push.length !== 2 || !finite(push[0]) || !finite(push[1])) throw new RangeError('simulate: force must return a finite [fx, fy]');
          vx[i] += push[0] * inv[i] * h;
          vy[i] += push[1] * inv[i] * h;
        }
        vx[i] = (vx[i] + gx * h) * keep;
        vy[i] = (vy[i] + gy * h) * keep;
        x[i] += vx[i] * h;
        y[i] += vy[i] * h;
      }
      for (let j = 0; j < L; j++) {
        if (gone[j] < 0 && sec >= breakAt[j]) { gone[j] = sec; broken.push({ link: j, frame: f, seconds: sec }); }
      }
      sweep(sec);
      [before, touch] = [touch, before];
      touch.clear();
      for (let it = 0; it < iterations; it++) {
        for (let j = 0; j < L; j++) {
          const a = la[j];
          const b = lb[j];
          const wa = w[a];
          const wb = w[b];
          if (wa + wb === 0) continue;
          const dx = x[b] - x[a];
          const dy = y[b] - y[a];
          const d = Math.hypot(dx, dy);
          if (gone[j] >= 0) continue;
          if (d > len[j] * breakBy[j]) { gone[j] = sec; broken.push({ link: j, frame: f, seconds: sec }); continue; }
          if (d === 0 || (rope[j] && d <= len[j])) continue;
          const c = (stiff[j] * (d - len[j])) / (d * (wa + wb));
          x[a] += dx * c * wa; y[a] += dy * c * wa;
          x[b] -= dx * c * wb; y[b] -= dy * c * wb;
        }
        collide(true);
      }
      for (let i = 0; i < n; i++) {
        vx[i] = (x[i] - x0[i]) / h;
        vy[i] = (y[i] - y0[i]) / h;
      }
      const stamp = (f - 1) * S + k;
      const bodies = [];
      for (const c of touch.values()) {
        for (const i of c.kind === 0 ? [c.i] : [c.i, c.j]) {
          if (w[i] > 0 && mark[i] !== stamp) { mark[i] = stamp; bodies.push(i); px[i] = vx[i]; py[i] = vy[i]; lift[i] = -1; }
        }
        // A wall in motion may hand a body it touches as much motion as the
        // body could leave it with: the speed it closed at in the wall's
        // frame, back, plus the wall's own.
        if (c.kind === 0 && (c.wx !== 0 || c.wy !== 0) && w[c.i] > 0) {
          const i = c.i;
          const far = Math.hypot((ux[i] + gx * h) * keep - c.wx, (uy[i] + gy * h) * keep - c.wy) + Math.hypot(c.wx, c.wy);
          lift[i] = Math.max(lift[i], far * far);
        }
      }
      for (let it = 0; it < iterations; it++) for (const c of touch.values()) bounce(c);
      for (const c of touch.values()) settle(c, f, sec);
      // Contacts solved one at a time can still, where several meet at once,
      // hand the bodies they touch more motion than those bodies brought into
      // the step. If they did, every change the contacts made is scaled back
      // by one factor, which keeps momentum, until the bodies have no more
      // than they brought, or than the push out of their overlaps left them.
      let brought = 0;
      let had = 0;
      let cross = 0;
      let change = 0;
      for (const i of bodies) {
        const m = 1 / w[i];
        const bx = (ux[i] + gx * h) * keep;
        const by = (uy[i] + gy * h) * keep;
        const dx = vx[i] - px[i];
        const dy = vy[i] - py[i];
        brought += 0.5 * m * (lift[i] >= 0 ? lift[i] : bx * bx + by * by);
        had += 0.5 * m * (px[i] * px[i] + py[i] * py[i]);
        cross += m * (px[i] * dx + py[i] * dy);
        change += 0.5 * m * (dx * dx + dy * dy);
      }
      const cap = Math.max(brought, had);
      if (change > 0 && had + cross + change > cap) {
        const s = (-cross + Math.sqrt(Math.max(0, cross * cross + 4 * change * (cap - had)))) / (2 * change);
        for (const i of bodies) {
          vx[i] = px[i] + (vx[i] - px[i]) * s;
          vy[i] = py[i] + (vy[i] - py[i]) * s;
        }
      }
    }
    snap(f);
  }

  const nb = shapes.length;
  const { poses, motions, log } = solveBodies(shapes, { frames, hz, S, gravity, keep, wall, restitution, friction, quiet });
  const readBody = (arr, what) => (frame, k) => {
    if (!Number.isInteger(frame) || frame < 0 || frame >= frames) throw new RangeError(`simulate: ${what} needs a whole frame from 0 to ${frames - 1}, got ${frame}`);
    if (!Number.isInteger(k) || k < 0 || k >= nb) throw new RangeError(`simulate: ${what} needs a body index from 0 to ${nb - 1}, got ${k}`);
    const o = (frame * nb + k) * 3;
    return [arr[o], arr[o + 1], arr[o + 2]];
  };
  const read = (arr, what) => (frame, i) => {
    if (!Number.isInteger(frame) || frame < 0 || frame >= frames) throw new RangeError(`simulate: ${what} needs a whole frame from 0 to ${frames - 1}, got ${frame}`);
    if (!Number.isInteger(i) || i < 0 || i >= n) throw new RangeError(`simulate: ${what} needs a particle index from 0 to ${n - 1}, got ${i}`);
    const o = (frame * n + i) * 2;
    return [arr[o], arr[o + 1]];
  };
  return Object.freeze({
    frames, hz, count: n, xy, vxy, contacts: Object.freeze(merge(contacts, log)), wallGrid: walled && !everyPair,
    broken: Object.freeze(broken.map((b) => Object.freeze(b))),
    at: read(xy, 'at'), velocity: read(vxy, 'velocity'),
    bodies: nb, poses, motions, pose: readBody(poses, 'pose'), motion: readBody(motions, 'motion'),
  });
}

/**
 * A medium that flows on a coarse grid, solved once for the whole film: smoke,
 * mist, dye in water, a current that carries things, for any subject. Returns
 * one snapshot per frame, so `draw` is a lookup and a scrub lands where
 * playback does.
 *
 * The grid is `cols` by `rows` cells, sampled at its (cols + 1) * (rows + 1)
 * corners in row order, as `sampleGrid` and `isolines` in core/field.js take
 * them; the outer ring of corners is the wall. Each frame of `frames` at `hz`
 * the `sources` add to it, the velocity spreads by `viscosity`, is made free of
 * sinks and springs, carries itself and is freed again, and the density spreads
 * by `diffusion`, is carried and fades by `fade` (the share it loses a second,
 * as e^-fade). Every step traces back along the flow and reads what was there,
 * so no speed or step makes it blow up. `buoyancy` lifts dense cells, towards
 * -y, by that many cells per second squared per unit of density.
 *
 * A source is `{ at, radius, density, push, from, to }`: `at` is [x, y] from 0
 * to 1 across the grid, `radius` its reach in cells (default 1.5), `density`
 * what it adds a second at its centre, `push` the [x, y] it adds to the
 * velocity a second, in cells per second, and `from` and `to` the seconds it
 * is on (default always). `sources` may instead be a function of the second
 * and the frame that returns such a list, for a source that moves. Speeds are
 * in cells per second, `viscosity` and `diffusion` in cells squared per second.
 *
 * The result holds `cols`, `rows`, `frames`, `density(frame)`, a Float32Array
 * of the corner samples, `velocity(frame)`, its [u, v] arrays, and
 * `sample(frame, x, y)`, the density at [x, y] from 0 to 1, read between
 * corners. Nothing is random: one spec gives one run.
 */
function fluid(spec) {
  const who = (name, v, ok, what) => { if (!(typeof v === 'number' && !Number.isNaN(v) && ok(v))) throw new RangeError(`fluid: ${name} must be ${what}, got ${String(v)}`); };
  if (spec === null || typeof spec !== 'object') throw new RangeError(`fluid: the spec must be an object of its keys, got ${String(spec)}`);
  const { cols, rows, frames, hz, viscosity = 0, diffusion = 0, fade = 0, buoyancy = 0, iterations = 20, sources = [] } = spec;
  who('cols', cols, (v) => Number.isInteger(v) && v >= 4 && v <= 512, 'a whole number from 4 to 512');
  who('rows', rows, (v) => Number.isInteger(v) && v >= 4 && v <= 512, 'a whole number from 4 to 512');
  who('frames', frames, (v) => Number.isInteger(v) && v >= 1, 'a whole number, 1 or more');
  who('hz', hz, (v) => v > 0 && finite(v), 'a frame rate above 0');
  who('viscosity', viscosity, (v) => v >= 0 && finite(v), '0 or more');
  who('diffusion', diffusion, (v) => v >= 0 && finite(v), '0 or more');
  who('fade', fade, (v) => v >= 0 && finite(v), '0 or more');
  who('buoyancy', buoyancy, finite, 'a finite number');
  who('iterations', iterations, (v) => Number.isInteger(v) && v >= 1 && v <= 200, 'a whole number from 1 to 200');
  if (typeof sources !== 'function' && !Array.isArray(sources)) throw new RangeError('fluid: sources must be a list of sources, or a function of the second and the frame that returns one');
  const nx = cols + 1, ny = rows + 1, n = nx * ny, dt = 1 / hz;
  if (frames * n > 2 ** 26) throw new RangeError(`fluid: ${frames} frames of ${nx} by ${ny} samples are more than the ${2 ** 26} a run keeps; use a coarser grid`);
  let u = new Float64Array(n), v = new Float64Array(n), d = new Float64Array(n);
  let u0 = new Float64Array(n), v0 = new Float64Array(n), d0 = new Float64Array(n);
  // What the wall does to a value beside it: a velocity into the wall turns back, anything else is copied.
  const wall = (b, x) => {
    for (let i = 1; i < nx - 1; i++) { x[i] = b === 2 ? -x[i + nx] : x[i + nx]; x[i + nx * (ny - 1)] = b === 2 ? -x[i + nx * (ny - 2)] : x[i + nx * (ny - 2)]; }
    for (let j = 1; j < ny - 1; j++) { x[nx * j] = b === 1 ? -x[1 + nx * j] : x[1 + nx * j]; x[nx - 1 + nx * j] = b === 1 ? -x[nx - 2 + nx * j] : x[nx - 2 + nx * j]; }
    x[0] = 0.5 * (x[1] + x[nx]); x[nx - 1] = 0.5 * (x[nx - 2] + x[2 * nx - 1]);
    x[nx * (ny - 1)] = 0.5 * (x[1 + nx * (ny - 1)] + x[nx * (ny - 2)]); x[n - 1] = 0.5 * (x[n - 2] + x[n - 1 - nx]);
  };
  // x = (x0 + a * its four neighbours) / c, relaxed a fixed number of times in a fixed order.
  const relax = (b, x, x0, a, c) => {
    for (let k = 0; k < iterations; k++) {
      for (let j = 1; j < ny - 1; j++) for (let i = 1, p = 1 + nx * j; i < nx - 1; i++, p++) x[p] = (x0[p] + a * (x[p - 1] + x[p + 1] + x[p - nx] + x[p + nx])) / c;
      wall(b, x);
    }
  };
  const spread = (b, x, x0, rate) => { if (rate === 0) { x.set(x0); return; } relax(b, x, x0, dt * rate, 1 + 4 * dt * rate); };
  // Each value is read from where the flow brought it from, between four corners.
  const carry = (b, x, x0, fu, fv) => {
    for (let j = 1; j < ny - 1; j++) for (let i = 1, p = 1 + nx * j; i < nx - 1; i++, p++) {
      const sx = Math.min(nx - 1.5, Math.max(0.5, i - dt * fu[p])), sy = Math.min(ny - 1.5, Math.max(0.5, j - dt * fv[p]));
      const i0 = Math.floor(sx), j0 = Math.floor(sy), fx = sx - i0, fy = sy - j0, q = i0 + nx * j0;
      x[p] = (1 - fx) * ((1 - fy) * x0[q] + fy * x0[q + nx]) + fx * ((1 - fy) * x0[q + 1] + fy * x0[q + nx + 1]);
    }
    wall(b, x);
  };
  // Take out of the velocity the part that piles up or thins out, using u0 and v0 as scratch.
  const free = () => {
    const [p, div] = [u0, v0];
    for (let j = 1; j < ny - 1; j++) for (let i = 1, k = 1 + nx * j; i < nx - 1; i++, k++) { div[k] = -0.5 * (u[k + 1] - u[k - 1] + v[k + nx] - v[k - nx]); p[k] = 0; }
    wall(0, div); wall(0, p);
    relax(0, p, div, 1, 4);
    for (let j = 1; j < ny - 1; j++) for (let i = 1, k = 1 + nx * j; i < nx - 1; i++, k++) { u[k] -= 0.5 * (p[k + 1] - p[k - 1]); v[k] -= 0.5 * (p[k + nx] - p[k - nx]); }
    wall(1, u); wall(2, v);
  };
  const emit = (t, f) => {
    const list = typeof sources === 'function' ? sources(t, f) : sources;
    if (!Array.isArray(list)) throw new RangeError(`fluid: sources at ${t} s must return a list, got ${String(list)}`);
    list.forEach((s, k) => {
      if (s === null || typeof s !== 'object') throw new RangeError(`fluid: source ${k} must be an object of its keys, got ${String(s)}`);
      const { at, radius = 1.5, density = 0, push = [0, 0], from = 0, to = Infinity } = s;
      if (!(Array.isArray(at) && at.length === 2 && at.every(finite)) || !(Array.isArray(push) && push.length === 2 && push.every(finite))) throw new RangeError(`fluid: source ${k} needs at and push as finite [x, y] pairs`);
      who(`source ${k} radius`, radius, (r) => r > 0 && finite(r), 'cells above 0');
      who(`source ${k} density`, density, (r) => r >= 0 && finite(r), '0 or more');
      if (t < from || t >= to) return;
      const [cx, cy] = [at[0] * cols, at[1] * rows];
      for (let j = Math.max(1, Math.ceil(cy - radius)); j <= Math.min(ny - 2, cy + radius); j++) for (let i = Math.max(1, Math.ceil(cx - radius)); i <= Math.min(nx - 2, cx + radius); i++) {
        const w = Math.max(0, 1 - ((i - cx) ** 2 + (j - cy) ** 2) / (radius * radius)) * dt;
        d[i + nx * j] += w * density; u[i + nx * j] += w * push[0]; v[i + nx * j] += w * push[1];
      }
    });
  };
  const kept = [];
  const dim = Math.exp(-fade * dt);
  for (let f = 0; f < frames; f++) {
    emit(f * dt, f);
    if (buoyancy !== 0) for (let k = 0; k < n; k++) v[k] -= buoyancy * d[k] * dt;
    [u, u0] = [u0, u]; [v, v0] = [v0, v];
    spread(1, u, u0, viscosity); spread(2, v, v0, viscosity);
    free();
    // Both parts are carried by the velocity as it was, read from the copies.
    u0.set(u); v0.set(v);
    carry(1, u, u0, u0, v0); carry(2, v, v0, u0, v0);
    free();
    [d, d0] = [d0, d];
    spread(0, d, d0, diffusion);
    [d, d0] = [d0, d];
    carry(0, d, d0, u, v);
    if (dim !== 1) for (let k = 0; k < n; k++) d[k] *= dim;
    kept.push([Float32Array.from(d), Float32Array.from(u), Float32Array.from(v)]);
  }
  const frame = (f) => { who('frame', f, (k) => Number.isInteger(k) && k >= 0 && k < frames, `a whole number from 0 to ${frames - 1}`); return kept[f]; };
  return {
    cols, rows, frames,
    density: (f) => frame(f)[0],
    velocity: (f) => [frame(f)[1], frame(f)[2]],
    sample: (f, x, y) => {
      const a = frame(f)[0];
      const sx = Math.min(cols, Math.max(0, x * cols)), sy = Math.min(rows, Math.max(0, y * rows));
      const i0 = Math.min(cols - 1, Math.floor(sx)), j0 = Math.min(rows - 1, Math.floor(sy)), fx = sx - i0, fy = sy - j0, q = i0 + nx * j0;
      return (1 - fx) * ((1 - fy) * a[q] + fy * a[q + nx]) + fx * ((1 - fy) * a[q + 1] + fy * a[q + nx + 1]);
    },
  };
}

module.exports = { simulate, chain, ring, grid, fluid };

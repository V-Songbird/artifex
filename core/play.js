// Interactive pieces: a session, its input log, and the film a session makes.
//
// The picture on tick n is draw(state_n, n / hz), where state_n is the solved
// state stepped n times, each step handed the inputs that landed in its tick.
// Nothing else enters: no wall clock, no unseeded generator, no device data.
// So the same seed, parameters and log give the same session on every run in
// the same engine, and the log is at once the save file, the replay recipe
// and the film script.
//
// Nothing here knows what a piece depicts or what game it plays.

'use strict';

const { validate, solve, clockAt, PieceError, SESSION, VERSION } = require('./piece.js');
const { rng } = require('./rand.js');
const { digest: bytesDigest } = require('./image.js');

// A session's bounds. A log is data a person or a file hands in, so it is
// capped; one hour at 60 ticks a second is the longest session that runs again.
const MAX_EVENTS = 50000;
const MAX_TICKS = 216000;
const POINTER = ['down', 'move', 'up'];

const refuse = (cause) => new PieceError('play: ' + cause);

/** Why `row`, a log row, is malformed, or null: [tick, down | move | up, x, y] or [tick, 'key', key, down]. */
function rowShape(row) {
  const kind = row[1];
  if (POINTER.includes(kind)) {
    return row.length === 4 && Number.isFinite(row[2]) && Number.isFinite(row[3]) ? null : `a ${kind} row is [tick, '${kind}', x, y]`;
  }
  if (kind === 'key') {
    return row.length === 4 && typeof row[2] === 'string' && row[2].length >= 1 && row[2].length <= 32 && typeof row[3] === 'boolean'
      ? null : "a key row is [tick, 'key', key, down]";
  }
  return null;
}

/** The input `e` as a log row at `tick`, after checking its shape and that `p` listens to it. */
function rowOf(e, i, tick, p) {
  if (!e || typeof e !== 'object') throw refuse(`input ${i} must be an object`);
  const pointer = POINTER.includes(e.kind);
  if (!pointer && e.kind !== 'key') {
    throw refuse(`input ${i} has kind ${JSON.stringify(e.kind)}; an input is down, move or up with x and y, or key with key and down`);
  }
  const need = pointer ? 'pointer' : 'key';
  if (!p.play.inputs.includes(need)) throw refuse(`input ${i} is a ${need} input and ${p.name} listens only to ${p.play.inputs.join(' and ')}`);
  if (pointer && !(Number.isFinite(e.x) && Number.isFinite(e.y))) throw refuse(`input ${i}, a ${e.kind}, needs finite x and y in design units`);
  const row = pointer ? [tick, e.kind, e.x, e.y] : [tick, 'key', e.key, e.down];
  if (rowShape(row)) throw refuse(`input ${i}, a key, needs the key's name, 1 to 32 characters, and down true or false`);
  return row;
}

/** A row as the input step is handed: a fresh object, so step cannot change the log. */
const inputOf = (row) => (row[1] === 'key' ? { kind: 'key', key: row[2], down: row[3] } : { kind: row[1], x: row[2], y: row[3] });

/** Rows with each run of moves folded to its last move: within one tick only where the pointer ended counts. */
function folded(rows) {
  return rows.filter((row, i) => !(row[1] === 'move' && rows[i + 1] && rows[i + 1][1] === 'move'));
}

/** The validated piece, refusing one without play by name. */
function playable(piece) {
  const p = validate(piece);
  if (!p.play) throw refuse(`${p.name} declares no play, so it has no session; add play: { step } to make it interactive`);
  return p;
}

/**
 * A new session of `piece` at `seed` with `params`: the solved state at tick
 * 0, which `advance(inputs)` steps one tick, recording `inputs` in the log.
 * Returns { piece, solved, state, tick, log, advance, describe, save }; `piece`
 * is the validated piece, and drawing it from `solved` at tick / hz draws the
 * session as it stands. A build that fails is refused with the stage that threw.
 */
function session(piece, seed, params) {
  const p = playable(piece);
  const solved = solve(p, seed, params);
  const e = solved.stages.error;
  if (e) throw refuse(`build stage "${e.stage}" (${e.at + 1} of ${e.of}) threw: ${e.message}`);
  const R = rng(solved.seed);
  const s = {
    piece: p, solved, state: solved.state, tick: 0, log: [],
    advance(inputs = []) {
      if (!Array.isArray(inputs)) throw refuse('advance takes a list of inputs, [] for a tick with none');
      const tick = s.tick + 1;
      if (tick > MAX_TICKS) throw refuse(`a session runs at most ${MAX_TICKS} ticks`);
      const rows = folded(inputs.map((input, i) => rowOf(input, i, tick, p)));
      if (s.log.length + rows.length > MAX_EVENTS) throw refuse(`a session's log holds at most ${MAX_EVENTS} inputs`);
      p.play.step(solved.state, rows.map(inputOf), tick, R);
      // Logged once the tick is played, so a step that throws leaves the log saveable at the last good tick.
      s.log.push(...rows);
      s.tick = tick;
      return s;
    },
    describe: () => (p.play.describe ? String(p.play.describe(solved.state)) : null),
    // The saved session: the solve's manifest fields, then the tick rate, the ticks played and the log.
    save: () => ({ ...solved.manifest, hz: p.play.hz, ticks: s.tick, log: s.log.map((row) => row.slice()) }),
  };
  return s;
}

/** Throws naming the first way `file` is not a session of `p` (validated, with play); never runs any of it. */
function checkSession(p, file) {
  const no = (cause) => new PieceError('session: ' + cause);
  if (!file || typeof file !== 'object' || Array.isArray(file)) throw no('a session is a JSON object, as the page\'s save session writes it');
  if (file.piece !== p.name) throw no(`the session is of piece ${JSON.stringify(file.piece)}, not ${p.name}`);
  if (file.artifex !== VERSION) throw no(`the session was made by artifex ${JSON.stringify(file.artifex)} and this is ${VERSION}; run it with that version`);
  if (file.hz !== p.play.hz) throw no(`the session ticks ${JSON.stringify(file.hz)} times a second and ${p.name} ticks ${p.play.hz}`);
  if (!file.size || file.size.w !== p.size.w || file.size.h !== p.size.h) {
    throw no(`the session was played at ${JSON.stringify(file.size)} and ${p.name} draws at ${JSON.stringify({ w: p.size.w, h: p.size.h })}`);
  }
  if (!(Number.isInteger(file.seed) && file.seed >= 0 && file.seed <= 0xffffffff)) throw no('seed must be an integer in [0, 2^32-1]');
  if (!file.params || typeof file.params !== 'object' || Array.isArray(file.params)) throw no('params must be an object of declared parameters');
  for (const [k, v] of Object.entries(file.params)) {
    const d = p.params[k];
    if (!d) throw no(`unknown param: ${k}. Declared: ${Object.keys(p.params).join(', ') || '(none)'}`);
    if (!(Number.isFinite(v) && v >= d.min && v <= d.max)) throw no(`params.${k} must be a finite number in [${d.min}, ${d.max}], got ${v}`);
  }
  if (!(Number.isInteger(file.ticks) && file.ticks >= 0 && file.ticks <= MAX_TICKS)) throw no(`ticks must be a whole number from 0 to ${MAX_TICKS}`);
  const log = file.log;
  if (!Array.isArray(log)) throw no('log must be a list of [tick, kind, ...values] rows');
  if (log.length > MAX_EVENTS) throw no(`log holds ${log.length} rows, more than the ${MAX_EVENTS} a session may`);
  for (let i = 0; i < log.length; i++) {
    const row = log[i];
    if (!Array.isArray(row) || !Number.isInteger(row[0])) throw no(`log row ${i} must be [tick, kind, ...values] with a whole tick`);
    if (row[0] < 1) throw no(`log row ${i} is at tick ${row[0]}; ticks start at 1`);
    if (row[0] > file.ticks) throw no(`log row ${i} is at tick ${row[0]}, after the session's ${file.ticks} ticks`);
    if (i && row[0] < log[i - 1][0]) throw no(`log row ${i} is at tick ${row[0]}, before row ${i - 1}'s tick ${log[i - 1][0]}; rows are in tick order`);
    if (!POINTER.includes(row[1]) && row[1] !== 'key') throw no(`log row ${i} has kind ${JSON.stringify(row[1])}; a row is down, move, up or key`);
    const bad = rowShape(row);
    if (bad) throw no(`log row ${i}: ${bad}`);
    const need = row[1] === 'key' ? 'key' : 'pointer';
    if (!p.play.inputs.includes(need)) throw no(`log row ${i} is a ${need} input and ${p.name} listens only to ${p.play.inputs.join(' and ')}`);
  }
}

/** The log's rows grouped by tick: rows[k] lists the inputs of tick k. */
function byTick(log) {
  const at = new Map();
  for (const row of log) {
    if (!at.has(row[0])) at.set(row[0], []);
    at.get(row[0]).push(inputOf(row));
  }
  return at;
}

/**
 * Run the saved session `file` of `piece` again, tick by tick from its seed
 * and parameters, calling `onTick(session)` at tick 0 and after every tick.
 * Returns the session at its last tick. The file is checked by shape first,
 * and only its numbers and names are read.
 */
function rerun(piece, file, onTick = null) {
  const p = playable(piece);
  checkSession(p, file);
  const s = session(p, file.seed, file.params);
  const rows = byTick(file.log);
  if (onTick) onTick(s);
  while (s.tick < file.ticks) {
    s.advance(rows.get(s.tick + 1) || []);
    if (onTick) onTick(s);
  }
  return s;
}

/** The digest of a session's log, as its films and stills record it: over its JSON text's UTF-16 code units, low byte first, so no encoder is needed. */
function digest(log) {
  const text = JSON.stringify(log), units = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    units[2 * i] = c & 255;
    units[2 * i + 1] = c >> 8;
  }
  return bytesDigest(units);
}

/**
 * The film of the saved session `file` of `piece`: a validated piece with a
 * timeline of one frame per tick, frame i drawing the session at tick i, at
 * the session's seed and parameters. Every film, still and replay tool takes
 * it as any piece with a timeline, and its manifest records the session as
 * { hz, ticks, digest, file }, `file` the session file's name when one is given.
 * Each solve of the film steps a session of its own, forward to the frame
 * asked for, and runs again from tick 0 for an earlier one.
 */
function film(piece, file, name = null) {
  const p = playable(piece);
  checkSession(p, file);
  const { hz } = p.play, rows = byTick(file.log), info = { hz, ticks: file.ticks, digest: digest(file.log), ...(name && { file: name }) };
  const params = {};
  for (const [k, d] of Object.entries(p.params)) params[k] = { ...d, value: k in file.params ? file.params[k] : d.value };
  const cursors = new WeakMap();
  return validate({
    name: p.name, size: { w: p.size.w, h: p.size.h }, seed: file.seed, params, outputs: p.outputs.slice(),
    ...(p.images && { images: p.images }),
    time: { duration: (file.ticks + 1) / hz, hz },
    state: () => ({ [SESSION]: { ...info } }),
    draw(surface, state, t, clock) {
      let s = cursors.get(state);
      if (!s || s.tick > clock.frame) cursors.set(state, s = session(p, state.seed, state.params));
      while (s.tick < clock.frame) s.advance(rows.get(s.tick + 1) || []);
      p.draw(surface, s.state, s.tick / hz, clockAt(p, s.tick / hz));
    },
  });
}

module.exports = { session, rerun, checkSession, digest, film, MAX_EVENTS, MAX_TICKS };

// CAD: a technical drawing as a CAD package shows model space, with no
// interface: a dark background, one colour per layer, stroke-font text.
// Visible outlines that hide what lies behind them, hidden, centre and
// phantom lines, hatched sections, linear, angular, radius and diameter
// dimensions, cutting planes, detail callouts, notes, a zoned sheet frame and
// a title block.
//
// A parts bin: functions that draw the style's marks on any path, outline or
// area you give them. Nothing here picks a subject, a scene or a layout.

'use strict';

const font = require('../../../core/stroke-font.js');
const { path, sub } = require('./kit.js');

// The layers: [colour, width, dash]. One colour per layer is what reads as CAD.
const LAYER = {
  object: ['#ffffff', 2.4, []],
  hidden: ['#ffff00', 1.4, [9, 5]],
  center: ['#ff0000', 1.2, [26, 5, 5, 5]],
  phantom: ['#ff00ff', 1.3, [26, 5, 5, 5, 5, 5]],
  dim: ['#00ffff', 1.2, []],
  hatch: ['#808080', 1, []],
  cut: ['#00ff00', 2.8, [30, 6, 6, 6]],
  construct: ['#7d8996', 1, [4, 4]],
  frame: ['#ffffff', 1.4, []],
  text: ['#ffff00', 1.4, []],
  label: ['#b8c0c8', 1.1, []],
};

// Model-space backgrounds a CAD package offers: grey-blue, black, dark green
// and neutral grey, each told from the others at a glance.
const GROUNDS = ['#212830', '#000000', '#163a24', '#2b2b2b'];

// Set the pen to a layer's colour, width and dash; `width` overrides the layer's.
function layer(g, name, width) {
  const [colour, w, dash] = LAYER[name];
  g.strokeStyle = colour;
  g.fillStyle = colour;
  g.lineWidth = width || w;
  g.setLineDash(dash);
}

// A straight line from a to b in the current pen.
function seg(g, a, b) {
  g.beginPath();
  g.moveTo(a[0], a[1]);
  g.lineTo(b[0], b[1]);
  g.stroke();
}

// Stroke-font text in a layer, vertically centred on y; align 'left',
// 'center' or 'right', rotated by `rot`. Returns its width.
function txt(g, str, x, y, size, name = 'text', align = 'left', rot = 0) {
  const w = font.width(str, size);
  g.save();
  layer(g, name, Math.max(1.1, size * 0.1));
  g.setLineDash([]);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.translate(x, y);
  if (rot) g.rotate(rot);
  font.text(g, str, align === 'center' ? -w / 2 : align === 'right' ? -w : 0, -size / 2, size);
  g.restore();
  return w;
}

// Dimension text in the dimension layer. The stroke font has no degree or
// diameter sign, so `o.deg` and `o.dia` draw them; `o.size` (13) and
// `o.align` ('left', 'right' or centred).
function dimText(g, str, x, y, rot = 0, o = {}) {
  const size = o.size || 13;
  const w = font.width(str, size) + (o.dia ? size * 0.95 : 0) + (o.deg ? size * 0.5 : 0);
  g.save();
  layer(g, 'dim', 1.3);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.translate(x, y);
  if (rot) g.rotate(rot);
  let pen = o.align === 'right' ? -w : o.align === 'left' ? 0 : -w / 2;
  if (o.dia) {
    g.beginPath();
    g.arc(pen + size * 0.36, 0, size * 0.33, 0, Math.PI * 2);
    g.moveTo(pen, size * 0.48);
    g.lineTo(pen + size * 0.72, -size * 0.48);
    g.stroke();
    pen += size * 0.95;
  }
  font.text(g, str, pen, -size / 2, size);
  pen += font.width(str, size);
  if (o.deg) {
    g.beginPath();
    g.arc(pen + size * 0.24, -size * 0.36, size * 0.13, 0, Math.PI * 2);
    g.stroke();
  }
  g.restore();
}

// A filled arrowhead at `tip`, pointing away from `from`: 12 long, 3.2 half-wide.
function arrow(g, tip, from) {
  const dx = tip[0] - from[0]; const dy = tip[1] - from[1]; const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d; const uy = dy / d;
  g.beginPath();
  g.moveTo(tip[0], tip[1]);
  g.lineTo(tip[0] - ux * 12 - uy * 3.2, tip[1] - uy * 12 + ux * 3.2);
  g.lineTo(tip[0] - ux * 12 + uy * 3.2, tip[1] - uy * 12 - ux * 3.2);
  g.closePath();
  g.fill();
}

// A horizontal linear dimension between points a and b, its line at height y:
// extension lines leave a 4-unit gap at the object and run 6 past the line;
// the label sits 11 above it; `o` as for dimText.
function dimH(g, a, b, y, label, o = {}) {
  layer(g, 'dim');
  for (const p of [a, b]) {
    const s = Math.sign(y - p[1]) || 1;
    seg(g, [p[0], p[1] + s * 4], [p[0], y + s * 6]);
  }
  seg(g, [a[0], y], [b[0], y]);
  arrow(g, [a[0], y], [b[0], y]);
  arrow(g, [b[0], y], [a[0], y]);
  dimText(g, label, (a[0] + b[0]) / 2, y - 11, 0, o);
}

// A vertical linear dimension between a and b, its line at x; the label reads
// bottom to top, 11 left of the line.
function dimV(g, a, b, x, label, o = {}) {
  layer(g, 'dim');
  for (const p of [a, b]) {
    const s = Math.sign(x - p[0]) || 1;
    seg(g, [p[0] + s * 4, p[1]], [x + s * 6, p[1]]);
  }
  seg(g, [x, a[1]], [x, b[1]]);
  arrow(g, [x, a[1]], [x, b[1]]);
  arrow(g, [x, b[1]], [x, a[1]]);
  dimText(g, label, x - 11, (a[1] + b[1]) / 2, -Math.PI / 2, o);
}

// An angular dimension: an arc of radius r round vertex c from angle a0 to
// a1, arrowheads at both ends, the label in degrees at `at`.
function dimAngle(g, c, r, a0, a1, label, at) {
  layer(g, 'dim');
  g.beginPath();
  g.arc(c[0], c[1], r, a0, a1);
  g.stroke();
  const p0 = [c[0] + Math.cos(a0) * r, c[1] + Math.sin(a0) * r];
  const p1 = [c[0] + Math.cos(a1) * r, c[1] + Math.sin(a1) * r];
  arrow(g, p0, [p0[0] - Math.sin(a0) * 12, p0[1] + Math.cos(a0) * 12]);
  arrow(g, p1, [p1[0] + Math.sin(a1) * 12, p1[1] - Math.cos(a1) * 12]);
  dimText(g, label, at[0], at[1], 0, { deg: true });
}

// A leader: an arrow at `tip`, a line to `knee`, a 16-unit shoulder and a
// label, for radii (`R15`), diameters (`o.dia`) and notes; `o.left` turns it.
function leader(g, tip, knee, label, o = {}) {
  layer(g, 'dim');
  const dir = o.left ? -1 : 1;
  const end = [knee[0] + dir * 16, knee[1]];
  seg(g, tip, knee);
  seg(g, knee, end);
  arrow(g, tip, knee);
  dimText(g, label, end[0] + dir * 5, end[1], 0, { ...o, align: o.left ? 'right' : 'left' });
}

// Centre lines through c, running 12 past a round feature of radii rx, ry.
function centreLines(g, c, rx, ry = rx) {
  layer(g, 'center');
  seg(g, [c[0] - rx - 12, c[1]], [c[0] + rx + 12, c[1]]);
  seg(g, [c[0], c[1] - ry - 12], [c[0], c[1] + ry + 12]);
}

// Section hatching: parallel lines at `angle`, `spacing` apart, clipped to a
// closed polygon, in the hatch layer.
function hatch(g, poly, angle, spacing) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const cx = (x0 + x1) / 2; const cy = (y0 + y1) / 2; const r = Math.hypot(x1 - x0, y1 - y0) / 2;
  const ux = Math.cos(angle); const uy = Math.sin(angle);
  g.save();
  path(g, poly);
  g.clip();
  layer(g, 'hatch');
  g.beginPath();
  for (let k = -r; k <= r; k += spacing) {
    g.moveTo(cx - ux * r - uy * k, cy - uy * r + ux * k);
    g.lineTo(cx + ux * r - uy * k, cy + uy * r + ux * k);
  }
  g.stroke();
  g.restore();
}

// Where a closed polygon crosses the vertical line x: [top, bottom]. Finds
// the extent of a section at a cutting plane.
function spanAt(poly, x) {
  const ys = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]; const b = poly[(i + 1) % poly.length];
    if ((a[0] - x) * (b[0] - x) <= 0 && a[0] !== b[0]) ys.push(a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]));
  }
  return [Math.min(...ys), Math.max(...ys)];
}

// A visible outline: filled with the model ground, then stroked in the object
// layer, so what was drawn behind it is hidden. Draw back to front.
function solid(g, pts, ground) {
  g.fillStyle = ground;
  path(g, pts);
  g.fill();
  layer(g, 'object');
  path(g, pts);
  g.stroke();
}

// A cut face: a solid outline hatched at `angle`, `spacing` apart, crossed at
// -angle when `cross` (ANSI 37), then outlined again on top.
function sectionFill(g, poly, ground, angle = Math.PI / 4, spacing = 9, cross = false) {
  solid(g, poly, ground);
  hatch(g, poly, angle, spacing);
  if (cross) hatch(g, poly, -angle, spacing);
  layer(g, 'object');
  path(g, poly);
  g.stroke();
}

// Draw `inside` clipped to a box [x, y, w, h] minus a closed polygon (even-odd),
// so what lies beyond a section shows round it but never through it.
function beyond(g, [x, y, w, h], poly, inside) {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  sub(g, poly);
  g.clip('evenodd');
  inside();
  g.restore();
}

// A vertical cutting plane at x from top to bottom: the dashed cut-layer line,
// thick 18-unit ends, 30-unit arrows in the viewing direction (`dir` 1 looks
// toward +x, -1 toward -x) and the section letter at each end. Rotate the
// canvas for a plane at another angle.
function cuttingPlane(g, x, top, bottom, letter, dir = 1) {
  layer(g, 'cut');
  seg(g, [x, top], [x, bottom]);
  g.setLineDash([]);
  g.lineWidth = 4;
  seg(g, [x, top], [x, top + 18]);
  seg(g, [x, bottom - 18], [x, bottom]);
  g.lineWidth = 1.6;
  for (const y of [top, bottom]) { seg(g, [x, y], [x + dir * 30, y]); arrow(g, [x + dir * 30, y], [x, y]); }
  txt(g, letter, x + dir * 14, top - 16, 14, 'text', 'center');
  txt(g, letter, x + dir * 14, bottom + 16, 14, 'text', 'center');
}

// A detail callout on a view: a thin circle of radius r round c, a short
// leader leaving it at angle `at` and the detail's letter.
function detailCallout(g, c, r, letter, at = 0.7) {
  layer(g, 'object', 1.2);
  g.beginPath();
  g.arc(c[0], c[1], r, 0, Math.PI * 2);
  g.stroke();
  const edge = [c[0] + Math.cos(at) * r, c[1] + Math.sin(at) * r];
  layer(g, 'dim');
  seg(g, edge, [edge[0] + 26, edge[1] + 22]);
  txt(g, letter, edge[0] + 38, edge[1] + 24, 14, 'text', 'center');
}

// A detail view: `inside` drawn clipped to a circle of radius r round c, then
// the circle stroked thin in the object layer. Draw the geometry at 2:1 or 4:1.
function detailView(g, c, r, inside) {
  g.save();
  g.beginPath();
  g.arc(c[0], c[1], r, 0, Math.PI * 2);
  g.clip();
  inside();
  g.restore();
  layer(g, 'object', 1.2);
  g.beginPath();
  g.arc(c[0], c[1], r, 0, Math.PI * 2);
  g.stroke();
}

// A view's title centred at (x, y), size 14 in the text layer, with its scale
// `gap` below at size 10 in the label layer; pass no scale for the title alone.
function viewLabel(g, title, scale, x, y, gap = 20) {
  txt(g, title, x, y, 14, 'text', 'center');
  if (scale) txt(g, scale, x, y + gap, 10, 'label', 'center');
}

// Numbered notes from (x, y), one per line, `lead` apart, in the text layer.
function notes(g, lines, x, y, size = 11, lead = 22) {
  lines.forEach((n, i) => txt(g, n, x, y + i * lead, size));
}

// A sheet frame with zones: an outer rule round [x, y, w, h], an inner border
// `margin` inside it at width 2.6, ticks between the rules dividing it into
// `cols` by `rows` zones, numbered across and lettered down.
function sheetFrame(g, x, y, w, h, { margin = 20, cols = 4, rows = 4, size = 11 } = {}) {
  const ix = x + margin; const iy = y + margin; const iw = w - 2 * margin; const ih = h - 2 * margin;
  const cw = iw / cols; const rh = ih / rows;
  layer(g, 'frame', 1.2);
  g.strokeRect(x, y, w, h);
  layer(g, 'frame', 2.6);
  g.strokeRect(ix, iy, iw, ih);
  layer(g, 'frame', 1.2);
  for (let k = 1; k < Math.max(cols, rows); k++) {
    const u = ix + k * cw; const v = iy + k * rh;
    if (k < cols) { seg(g, [u, y], [u, iy]); seg(g, [u, iy + ih], [u, y + h]); }
    if (k < rows) { seg(g, [x, v], [ix, v]); seg(g, [ix + iw, v], [x + w, v]); }
  }
  for (let k = 0; k < Math.max(cols, rows); k++) {
    const u = ix + (k + 0.5) * cw; const v = iy + (k + 0.5) * rh;
    if (k < cols) for (const ty of [y + margin / 2, y + h - margin / 2]) txt(g, String(k + 1), u, ty, size, 'frame', 'center');
    if (k < rows) for (const tx of [x + margin / 2, x + w - margin / 2]) txt(g, 'ABCDEFGHJKLMNP'[k], tx, v, size, 'frame', 'center');
  }
}

// A title block's rules: a 2.2-wide border round [x, y, w, h], full-width rules
// at each height in `rows`, and partial rules `cols` as [x, top, bottom].
function titleBlock(g, x, y, w, h, rows = [], cols = []) {
  layer(g, 'frame', 2.2);
  g.strokeRect(x, y, w, h);
  layer(g, 'frame', 1.2);
  for (const ry of rows) seg(g, [x, ry], [x + w, ry]);
  for (const [cx, top, bottom] of cols) seg(g, [cx, top], [cx, bottom]);
}

// One title-block cell at its top-left corner: a 7-unit grey label and a
// value below it, shrunk to fit a cell `w` wide.
function titleCell(g, x, y, label, value, size = 12, w = Infinity) {
  txt(g, label, x + 6, y + 9, 7, 'label');
  txt(g, value, x + 6, y + 27, Math.min(size, (size * (w - 16)) / font.width(value, size)));
}

module.exports = {
  LAYER, GROUNDS, layer, seg, txt, dimText, arrow, dimH, dimV, dimAngle, leader, centreLines, hatch, spanAt, solid,
  sectionFill, beyond, cuttingPlane, detailCallout, detailView, viewLabel, notes, sheetFrame, titleBlock, titleCell,
};

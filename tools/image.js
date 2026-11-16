#!/usr/bin/env node
'use strict';

// Write an image the user gives as a module a piece declares in `images`:
// decoded sRGB pixels as base64, with the image's source and rights, under a
// header comment that names all three.
//
//   npm run image -- "./photo.jpg" --source "the user's own photo" --rights "the user's; private use"
//     [--out "./photo.image.js"] [--width N] [--channels 1|3|4] [--edge PATH] [--timeout-ms N] [--headed]
//
// A plain PNG is decoded in Node. Any other image, and a PNG that is
// interlaced or carries a colour profile or gamma without an sRGB chunk, is
// decoded in installed Edge, which converts it to sRGB, and comes back as a
// plain PNG. --width shrinks it, each pixel the area average of what it
// covers, so the same file always gives the same bytes. --channels 1 keeps
// only the tone, a third of the size, for a piece that reads tones alone;
// without it, an image with transparent pixels keeps 4 channels and any other
// 3. Prints one line naming the module, its size and its digest.

const fs = require('node:fs');
const path = require('node:path');
const { check, digest, MAX_PIXELS } = require('../core/image.js');
const { decodePng } = require('./measure-reference.js');
const { withEdge, waitFor, evaluateInPieces, pageErrors, timeoutArg } = require('./check-browser.js');
const { callerDirectory, shown } = require('./piece-input.js');

const USAGE = 'usage: npm run image -- <image> --source <text> --rights <text> [--out file.image.js] [--width N] [--channels 1|3|4] [--edge PATH] [--timeout-ms N] [--headed]';
/** A refused argument: its cause, then the usage line. */
const refuse = (cause) => new Error('image: ' + cause + '\n' + USAGE);

function parseArgs(args) {
  const out = { image: null, out: null, source: null, rights: null, width: null, channels: null, browser: {} };
  const value = (i) => {
    if (args[i + 1] === undefined || args[i + 1].startsWith('--')) throw refuse(args[i] + ' needs a value');
    return args[i + 1];
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--out') out.out = value(i++);
    else if (a === '--source' || a === '--rights') out[a.slice(2)] = value(i++);
    else if (a === '--width') {
      const text = value(i++);
      if (!/^[1-9]\d*$/.test(text)) throw refuse('--width takes a whole number of pixels, 1 or more, got ' + text);
      out.width = Number(text);
    }
    else if (a === '--channels') {
      const text = value(i++);
      if (!['1', '3', '4'].includes(text)) throw refuse('--channels takes 1 (grey), 3 (RGB) or 4 (RGBA), got ' + text);
      out.channels = Number(text);
    }
    else if (a === '--edge') out.browser.edge = value(i++);
    else if (a === '--timeout-ms') out.browser.timeoutMs = timeoutArg(value(i++), refuse, { max: 3600000 });
    else if (a === '--headed') out.browser.headed = true;
    else if (a.startsWith('--')) throw refuse('unknown option ' + a);
    else if (out.image) throw refuse('one image per module, got "' + out.image + '" and "' + a + '"');
    else out.image = a;
  }
  if (!out.image) throw refuse('name the image to read, such as ./photo.jpg');
  for (const k of ['source', 'rights']) {
    if (out[k] === null) throw refuse('--' + k + (k === 'source' ? ' must name where the image came from, such as the user\'s own photo or a URL'
      : ' must say whose the image is and on what terms, as the user gave them; the library grants none'));
  }
  // Only a .image.js is written, so a slip of the option never replaces a piece or its data.
  if (out.out !== null && !/\.image\.js$/i.test(out.out)) throw refuse('--out must name a .image.js file, got ' + out.out);
  return out;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Why Node cannot read `bytes` as sRGB pixels, or null when it can: a file that
 * is not a PNG, or a PNG that is interlaced or names a colour profile or gamma
 * without an sRGB chunk, which decodePng would read unconverted.
 */
function edgeReason(bytes) {
  if (bytes.length < 8 || SIGNATURE.some((v, i) => bytes[i] !== v)) return 'it is not a PNG';
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const seen = new Set();
  for (let at = 8; at + 8 <= b.length;) {
    const length = b.readUInt32BE(at), chunk = b.toString('latin1', at + 4, at + 8);
    if (chunk === 'IHDR' && b[at + 8 + 12] === 1) return 'it is an interlaced PNG';
    if (chunk === 'IDAT' || chunk === 'IEND') break;
    seen.add(chunk);
    at += 12 + length;
  }
  if (!seen.has('sRGB') && ['iCCP', 'gAMA', 'cHRM'].some((c) => seen.has(c))) return 'it is a PNG with a colour profile or gamma';
  return null;
}

// Serialized into a blank page: the image served at /file, decoded and
// converted to sRGB by Edge, drawn on an sRGB canvas and saved as a plain PNG,
// as base64. Refusals start with "image: ", so the tool shows them alone.
async function decodeInEdge(name) {
  const blob = await (await fetch('/file')).blob();
  let bitmap;
  try { bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'default' }); }
  catch (e) { throw new Error('image: ' + name + ' is not an image Edge can decode: ' + e.message); }
  const c = document.createElement('canvas');
  c.width = bitmap.width; c.height = bitmap.height;
  c.getContext('2d', { colorSpace: 'srgb' }).drawImage(bitmap, 0, 0);
  const png = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
  if (!png) throw new Error('image: ' + name + ' is ' + c.width + ' x ' + c.height + ', more than a canvas can save; shrink it first');
  const bytes = new Uint8Array(await png.arrayBuffer());
  let text = '';
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(at, at + 0x8000));
  return btoa(text);
}

/** `bytes` as { w, h, rgba } in sRGB, decoded in Node or, when edgeReason names a reason, in installed Edge. */
async function decode(bytes, name, browser = {}, edge = withEdge) {
  let png = bytes;
  if (edgeReason(bytes)) {
    const page = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>image</title></head><body></body></html>';
    const text = await edge(page, { ...browser, file: Buffer.from(bytes), command: 'image' }, async (client, context) => {
      await waitFor(client, context, 'document.readyState === "complete"');
      context.phase = 'decoding ' + name;
      const value = await evaluateInPieces(client, '(' + decodeInEdge.toString() + ')(' + JSON.stringify(name) + ')');
      pageErrors(client, context);
      return value;
    });
    png = new Uint8Array(Buffer.from(text, 'base64'));
  }
  try { return decodePng(png, name); } catch (e) { throw new Error(e.message.replace(/^measure: /, 'image: ')); }
}

/**
 * `rgba`, `sw` x `sh` pixels, shrunk to `w` x `h`: each pixel the average of
 * the source area it covers, a pixel it covers in part counted by the share it
 * covers, its colour weighted by alpha so a transparent pixel lends it none.
 */
function shrink(rgba, sw, sh, w, h) {
  const spans = (s, d) => Array.from({ length: d }, (_, i) => {
    const a = i * s / d, b = (i + 1) * s / d, out = [];
    for (let j = Math.floor(a); j < Math.min(s, Math.ceil(b)); j++) out.push([j, (Math.min(b, j + 1) - Math.max(a, j)) * d / s]);
    return out;
  });
  const across = spans(sw, w), down = spans(sh, h);
  // Across each row first, premultiplied, then down each column.
  const rows = new Float64Array(sh * w * 4);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      for (const [j, k] of across[x]) {
        const i = (y * sw + j) * 4, a = rgba[i + 3] * k;
        rows[o] += rgba[i] * a; rows[o + 1] += rgba[i + 1] * a; rows[o + 2] += rgba[i + 2] * a; rows[o + 3] += a;
      }
    }
  }
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (const [j, k] of down[y]) {
        const i = (j * w + x) * 4;
        r += rows[i] * k; g += rows[i + 1] * k; b += rows[i + 2] * k; a += rows[i + 3] * k;
      }
      const o = (y * w + x) * 4;
      if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); }
      out[o + 3] = Math.round(a);
    }
  }
  return out;
}

/** The pixels as `channels` bytes each: 1 the Rec. 709 luma of the sRGB values, 3 RGB, 4 RGBA. */
function pack(rgba, channels) {
  const out = new Uint8Array(rgba.length / 4 * channels);
  for (let i = 0, o = 0; i < rgba.length; i += 4, o += channels) {
    if (channels === 1) out[o] = Math.min(255, Math.round(0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]));
    else for (let c = 0; c < channels; c++) out[o + c] = rgba[i + c];
  }
  return out;
}

// JSON text that a line comment and a script tag both keep whole.
const UNSAFE = new RegExp('[' + String.fromCharCode(0x2028, 0x2029) + '<]', 'g');
const escape = (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0');
const literal = (value) => JSON.stringify(value).replace(UNSAFE, escape);
// Line terminators in a file name, written escaped so its comment line stays whole.
const BREAKS = new RegExp('[\\n\\r' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');

/**
 * The module's text and what it holds, for decoded `{ w, h, rgba }` and the
 * parsed options: shrunk to `width` when given, packed to its channels and
 * checked as FIELDS.images checks a declaration.
 */
function imageModule(decoded, options, name) {
  const { w: sw, h: sh, rgba } = decoded;
  if (options.width !== null && options.width > sw) throw refuse('--width ' + options.width + ' is wider than ' + name + ', which is ' + sw + ' pixels wide; it only shrinks');
  const w = options.width ?? sw, h = Math.max(1, Math.round(sh * w / sw));
  if (w * h > MAX_PIXELS) throw refuse(name + ' at ' + w + ' x ' + h + ' is ' + (w * h) + ' pixels, over the ' + MAX_PIXELS + ' one image may hold; give a smaller --width');
  const pixels = w === sw && h === sh ? rgba : shrink(rgba, sw, sh, w, h);
  let clear = false;
  for (let i = 3; i < pixels.length && !clear; i += 4) clear = pixels[i] !== 255;
  const channels = options.channels ?? (clear ? 4 : 3);
  if (clear && channels !== 4) throw refuse(name + ' has transparent pixels, which --channels ' + channels + ' would drop; use --channels 4, or flatten the image first');
  const bytes = pack(pixels, channels);
  const declared = { w, h, channels, pixels: Buffer.from(bytes).toString('base64'), source: options.source, rights: options.rights };
  const why = check({ image: declared });
  if (why) throw refuse(why.replace(/^images\.image\.(source|rights) /, '--$1 '));
  const kind = { 1: 'grey', 3: 'RGB', 4: 'RGBA' }[channels];
  const text = [
    `// ${name.replace(BREAKS, escape)}, decoded for an Artifex piece's images by npm run image.`,
    `// Source: ${literal(options.source)}`,
    `// Rights: ${literal(options.rights)}`,
    `// ${w} x ${h} pixels, ${kind}${w === sw ? '' : `, area-averaged from ${sw} x ${sh}`}, ${digest(bytes)}.`,
    '',
    '\'use strict\';',
    '',
    'module.exports = {',
    `  w: ${w},`,
    `  h: ${h},`,
    `  channels: ${channels},`,
    `  source: ${literal(options.source)},`,
    `  rights: ${literal(options.rights)},`,
    `  pixels: '${declared.pixels}',`,
    '};',
    '',
  ].join('\n');
  return { text, w, h, channels, digest: digest(bytes) };
}

async function main(args = process.argv.slice(2), cwd = callerDirectory(), edge = withEdge) {
  if (args.includes('--help') || args.includes('-h')) return console.log(USAGE);
  const options = parseArgs(args);
  const file = path.resolve(cwd, options.image);
  let bytes;
  try { bytes = new Uint8Array(fs.readFileSync(file)); } catch (e) {
    if (e.code === 'ENOENT') throw refuse('no file at ' + shown(file, cwd));
    throw e;
  }
  const name = path.basename(file);
  const made = imageModule(await decode(bytes, name, options.browser, edge), options, name);
  const out = options.out ? path.resolve(cwd, options.out) : path.join(path.dirname(file), path.basename(file, path.extname(file)) + '.image.js');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, made.text);
  console.log(`image: ${shown(out, cwd)}: ${made.w} x ${made.h}, ${made.channels} channel${made.channels === 1 ? '' : 's'}, ${(Buffer.byteLength(made.text) / 1024).toFixed(1)} kB, ${made.digest}. Declare it in the piece as images: { name: require('./${path.basename(out)}') }`);
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { parseArgs, edgeReason, decode, shrink, pack, imageModule, main };

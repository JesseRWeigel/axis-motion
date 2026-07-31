'use strict';
// Minimal OpenType reader for the `fvar` (font variations) table.
// Spec: https://learn.microsoft.com/en-us/typography/opentype/spec/fvar
//
// Deliberately hand written. Nothing here consults a font library, a
// filename, or a hardcoded list of axis tags. Every axis reported comes
// out of the bytes of the file.

const fs = require('fs');

class FontError extends Error {
  constructor(message, file) {
    super(message);
    this.name = 'FontError';
    this.file = file;
  }
}

const F2DOT14 = 16384; // 2.14 fixed point
const FIXED = 65536;   // 16.16 fixed point

function readFixed(buf, off) {
  return buf.readInt32BE(off) / FIXED;
}

// Round a 16.16 fixed value the way the spec's own examples do, so that
// 400.0 does not come back as 399.99998474121094.
function fixed(buf, off) {
  return Math.round(readFixed(buf, off) * 1e6) / 1e6;
}

function tableDirectory(buf, offset, file) {
  if (offset + 12 > buf.length) {
    throw new FontError('truncated before table directory', file);
  }
  const numTables = buf.readUInt16BE(offset + 4);
  const tables = new Map();
  for (let i = 0; i < numTables; i++) {
    const rec = offset + 12 + 16 * i;
    if (rec + 16 > buf.length) {
      throw new FontError(`truncated table record ${i}`, file);
    }
    tables.set(buf.toString('latin1', rec, rec + 4), {
      offset: buf.readUInt32BE(rec + 8),
      length: buf.readUInt32BE(rec + 12),
    });
  }
  return tables;
}

// TrueType collections (.ttc) hold several fonts in one file. We read the
// first. Returns the byte offset of the font's own table directory.
function fontOffset(buf, file) {
  if (buf.length < 12) throw new FontError('file too small to be a font', file);
  const tag = buf.toString('latin1', 0, 4);
  if (tag === 'ttcf') {
    const numFonts = buf.readUInt32BE(8);
    if (numFonts < 1) throw new FontError('collection declares 0 fonts', file);
    return buf.readUInt32BE(12);
  }
  // 0x00010000 (TrueType), 'OTTO' (CFF), 'true' / 'typ1' (legacy Apple).
  const sfnt = buf.readUInt32BE(0);
  if (sfnt !== 0x00010000 && tag !== 'OTTO' && tag !== 'true' && tag !== 'typ1') {
    throw new FontError(
      `not an sfnt font: leading bytes 0x${sfnt.toString(16).padStart(8, '0')}`,
      file
    );
  }
  return 0;
}

// Pull the English (Windows, Unicode BMP) string for a nameID out of `name`.
function readNames(buf, table) {
  const out = new Map();
  if (!table) return out;
  const base = table.offset;
  if (base + 6 > buf.length) return out;
  const count = buf.readUInt16BE(base + 2);
  const storage = base + buf.readUInt16BE(base + 4);
  for (let i = 0; i < count; i++) {
    const rec = base + 6 + 12 * i;
    if (rec + 12 > buf.length) break;
    const platform = buf.readUInt16BE(rec);
    const encoding = buf.readUInt16BE(rec + 2);
    const nameId = buf.readUInt16BE(rec + 6);
    const len = buf.readUInt16BE(rec + 8);
    const off = storage + buf.readUInt16BE(rec + 10);
    if (off + len > buf.length) continue;
    let value;
    if (platform === 3 && (encoding === 1 || encoding === 0)) {
      // Name strings are UTF-16BE. Node has no utf16be decoder, so read
      // code units one at a time rather than byte swapping.
      value = '';
      for (let k = 0; k + 1 < len; k += 2) {
        value += String.fromCharCode(buf.readUInt16BE(off + k));
      }
    } else if (platform === 1 && encoding === 0) {
      value = buf.toString('latin1', off, off + len);
    } else {
      continue;
    }
    if (!out.has(nameId)) out.set(nameId, value);
  }
  return out;
}

/**
 * Read the variation axes of a font file.
 *
 * Returns { file, family, isVariable, axes, instances }.
 * A font with no `fvar` table returns isVariable:false and axes:[].
 * It never returns a guessed axis. That distinction is the whole point.
 */
function readFvar(file) {
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch (err) {
    throw new FontError(`cannot read font file: ${err.code || err.message}`, file);
  }

  const base = fontOffset(buf, file);
  const tables = tableDirectory(buf, base, file);
  const names = readNames(buf, tables.get('name'));
  const family = names.get(16) || names.get(1) || null;

  const fvar = tables.get('fvar');
  if (!fvar) {
    return { file, family, isVariable: false, axes: [], instances: [] };
  }
  const o = fvar.offset;
  if (o + 16 > buf.length) throw new FontError('fvar header truncated', file);

  const major = buf.readUInt16BE(o);
  const minor = buf.readUInt16BE(o + 2);
  if (major !== 1 || minor !== 0) {
    throw new FontError(`unsupported fvar version ${major}.${minor}`, file);
  }
  const axesArrayOffset = o + buf.readUInt16BE(o + 4);
  const axisCount = buf.readUInt16BE(o + 8);
  const axisSize = buf.readUInt16BE(o + 10);
  const instanceCount = buf.readUInt16BE(o + 12);
  const instanceSize = buf.readUInt16BE(o + 14);

  if (axisSize < 20) throw new FontError(`fvar axisSize ${axisSize} below 20`, file);

  const axes = [];
  for (let i = 0; i < axisCount; i++) {
    const a = axesArrayOffset + i * axisSize;
    if (a + 20 > buf.length) throw new FontError(`fvar axis ${i} truncated`, file);
    const flags = buf.readUInt16BE(a + 16);
    const nameId = buf.readUInt16BE(a + 18);
    axes.push({
      tag: buf.toString('latin1', a, a + 4),
      min: fixed(buf, a + 4),
      default: fixed(buf, a + 8),
      max: fixed(buf, a + 12),
      hidden: (flags & 0x0001) !== 0,
      name: names.get(nameId) || null,
    });
  }

  const instances = [];
  const instBase = axesArrayOffset + axisCount * axisSize;
  for (let i = 0; i < instanceCount; i++) {
    const p = instBase + i * instanceSize;
    if (p + 4 + axisCount * 4 > buf.length) break;
    const subfamilyNameId = buf.readUInt16BE(p);
    const coords = {};
    for (let k = 0; k < axisCount; k++) {
      coords[axes[k].tag] = fixed(buf, p + 4 + k * 4);
    }
    instances.push({ name: names.get(subfamilyNameId) || null, coords });
  }

  return { file, family, isVariable: true, axes, instances };
}

/** Look up one axis by tag. Returns undefined when the font lacks it. */
function findAxis(font, tag) {
  return font.axes.find((a) => a.tag === tag);
}

module.exports = { readFvar, findAxis, FontError, F2DOT14, FIXED };

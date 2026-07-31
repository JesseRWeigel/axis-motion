'use strict';
// Walk the system font directories and report which files carry an fvar
// table. fontconfig's `:variable` selector returned nothing on this box, so
// the scan reads the table directory of every font file directly.

const fs = require('fs');
const path = require('path');
const { readFvar } = require('./fvar');

const DEFAULT_ROOTS = [
  '/usr/share/fonts',
  '/usr/local/share/fonts',
  path.join(process.env.HOME || '/root', '.local/share/fonts'),
  path.join(process.env.HOME || '/root', '.fonts'),
];

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ttf|otf|ttc|otc)$/i.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * @returns {{scanned:number, variable:Array, static:number, errors:Array}}
 * `variable[].realPath` collapses symlinks so duplicate entries are visible.
 */
function scanFonts(roots = DEFAULT_ROOTS) {
  const files = [];
  for (const r of roots) walk(r, files);
  files.sort();
  const variable = [];
  const errors = [];
  let staticCount = 0;
  for (const f of files) {
    let font;
    try {
      font = readFvar(f);
    } catch (err) {
      errors.push({ file: f, error: err.message });
      continue;
    }
    if (font.isVariable) {
      let realPath = f;
      try {
        realPath = fs.realpathSync(f);
      } catch {
        /* leave as is */
      }
      variable.push({
        file: f,
        realPath,
        isSymlink: realPath !== f,
        family: font.family,
        axes: font.axes,
        instanceCount: font.instances.length,
      });
    } else {
      staticCount++;
    }
  }
  return { scanned: files.length, variable, static: staticCount, errors };
}

module.exports = { scanFonts, walk, DEFAULT_ROOTS };

'use strict';
// fvar parsing, checked against known files on this machine.
//
// The numbers below were not produced by this parser. They were read out of
// the byte offsets the OpenType fvar spec defines, and they are asserted
// exactly, not approximately. If the parser starts inventing a wght axis for
// every font, or misreads 16.16 fixed point, these fail.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { readFvar, findAxis } = require('../src/fvar');
const { scanFonts } = require('../src/scan');

const UBUNTU_SANS = '/usr/share/fonts/truetype/ubuntu/UbuntuSans[wdth,wght].ttf';
const UBUNTU_SANS_MONO = '/usr/share/fonts/truetype/ubuntu/UbuntuSansMono[wght].ttf';
const UBUNTU_MONO = '/usr/share/fonts/truetype/ubuntu/UbuntuMono[wght].ttf';
const STATIC_FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';

test('these fixture fonts exist on this machine', () => {
  for (const f of [UBUNTU_SANS, UBUNTU_SANS_MONO, UBUNTU_MONO, STATIC_FONT]) {
    assert.ok(fs.existsSync(f), `missing fixture font ${f}`);
  }
});

test('UbuntuSans[wdth,wght].ttf declares exactly wdth and wght with exact bounds', () => {
  const f = readFvar(UBUNTU_SANS);
  assert.equal(f.isVariable, true);
  assert.equal(f.family, 'Ubuntu Sans');
  assert.deepEqual(
    f.axes.map((a) => a.tag),
    ['wdth', 'wght'],
    'axis tags, in the order the fvar table stores them'
  );
  assert.deepEqual(findAxis(f, 'wdth'), {
    tag: 'wdth',
    min: 75,
    default: 100,
    max: 100,
    hidden: false,
    name: 'Width',
  });
  assert.deepEqual(findAxis(f, 'wght'), {
    tag: 'wght',
    min: 100,
    default: 400,
    max: 800,
    hidden: false,
    name: 'Weight',
  });
  assert.equal(f.instances.length, 16);
  // A named instance carries a coordinate for every axis.
  const light = f.instances.find((i) => i.name === 'Light');
  assert.ok(light, 'expected a named instance called Light');
  assert.deepEqual(light.coords, { wdth: 100, wght: 300 });
});

test('UbuntuSansMono[wght].ttf declares only wght, 100 to 700', () => {
  const f = readFvar(UBUNTU_SANS_MONO);
  assert.deepEqual(
    f.axes.map((a) => a.tag),
    ['wght']
  );
  assert.equal(findAxis(f, 'wght').min, 100);
  assert.equal(findAxis(f, 'wght').max, 700);
  assert.equal(findAxis(f, 'wght').default, 400);
  assert.equal(findAxis(f, 'wdth'), undefined, 'this font has no width axis');
  assert.equal(f.instances.length, 7);
});

test('UbuntuMono[wght].ttf has a narrower wght range than UbuntuSansMono', () => {
  // Two fonts with the same axis tag and different bounds. A parser that
  // hardcodes a range instead of reading it cannot get both right.
  const mono = readFvar(UBUNTU_MONO);
  const sansMono = readFvar(UBUNTU_SANS_MONO);
  assert.equal(findAxis(mono, 'wght').min, 400);
  assert.equal(findAxis(mono, 'wght').max, 700);
  assert.equal(findAxis(sansMono, 'wght').min, 100);
  assert.notEqual(findAxis(mono, 'wght').min, findAxis(sansMono, 'wght').min);
});

test('negative control: DejaVuSans.ttf has no fvar and reports no axes at all', () => {
  const f = readFvar(STATIC_FONT);
  assert.equal(f.isVariable, false);
  assert.deepEqual(f.axes, [], 'a static font must report zero axes, not a default wght');
  assert.equal(findAxis(f, 'wght'), undefined);
  assert.equal(findAxis(f, 'wdth'), undefined);
  assert.deepEqual(f.instances, []);
  // The family name still parses, which proves the file was actually read
  // rather than skipped.
  assert.equal(f.family, 'DejaVu Sans');
});

test('negative control: every static font in the scan reports zero axes', () => {
  const r = scanFonts();
  assert.ok(r.scanned > 50, `expected to scan many fonts, scanned ${r.scanned}`);
  assert.ok(r.static > 0, 'expected some static fonts');
  for (const v of r.variable) {
    assert.ok(v.axes.length > 0, `${v.file} was called variable with no axes`);
  }
});

test('a synthetic font with a custom axis tag parses that tag, not a guess', () => {
  // No font on this machine carries a custom axis, so one is built here in
  // memory. Written to a temp file, never committed. Two axes: a hidden
  // custom "GRAD" and a "XPRT" with a negative minimum, which also exercises
  // signed 16.16 fixed point.
  const file = buildSyntheticFont([
    { tag: 'GRAD', min: -200, def: 0, max: 150, flags: 0x0001 },
    { tag: 'XPRT', min: -1.5, def: 0.25, max: 2.75, flags: 0 },
  ]);
  const f = readFvar(file);
  fs.unlinkSync(file);
  assert.equal(f.isVariable, true);
  assert.deepEqual(
    f.axes.map((a) => a.tag),
    ['GRAD', 'XPRT']
  );
  assert.equal(findAxis(f, 'GRAD').min, -200);
  assert.equal(findAxis(f, 'GRAD').max, 150);
  assert.equal(findAxis(f, 'GRAD').hidden, true, 'axis flag bit 0 means hidden');
  assert.equal(findAxis(f, 'XPRT').min, -1.5);
  assert.equal(findAxis(f, 'XPRT').default, 0.25);
  assert.equal(findAxis(f, 'XPRT').max, 2.75);
  assert.equal(findAxis(f, 'wght'), undefined, 'no wght was invented');
});

// Build the smallest sfnt that carries a valid fvar table.
function buildSyntheticFont(axes) {
  const os = require('os');
  const path = require('path');
  const axisSize = 20;
  const fvar = Buffer.alloc(16 + axes.length * axisSize);
  fvar.writeUInt16BE(1, 0); // majorVersion
  fvar.writeUInt16BE(0, 2); // minorVersion
  fvar.writeUInt16BE(16, 4); // axesArrayOffset
  fvar.writeUInt16BE(2, 6); // reserved
  fvar.writeUInt16BE(axes.length, 8);
  fvar.writeUInt16BE(axisSize, 10);
  fvar.writeUInt16BE(0, 12); // instanceCount
  fvar.writeUInt16BE(4 + 4 * axes.length, 14); // instanceSize
  axes.forEach((a, i) => {
    const o = 16 + i * axisSize;
    fvar.write(a.tag, o, 4, 'latin1');
    fvar.writeInt32BE(Math.round(a.min * 65536), o + 4);
    fvar.writeInt32BE(Math.round(a.def * 65536), o + 8);
    fvar.writeInt32BE(Math.round(a.max * 65536), o + 12);
    fvar.writeUInt16BE(a.flags, o + 16);
    fvar.writeUInt16BE(256 + i, o + 18); // axisNameID
  });

  const numTables = 1;
  const header = Buffer.alloc(12 + 16 * numTables);
  header.writeUInt32BE(0x00010000, 0);
  header.writeUInt16BE(numTables, 4);
  header.write('fvar', 12, 4, 'latin1');
  header.writeUInt32BE(0, 12 + 4); // checksum, not verified by this reader
  header.writeUInt32BE(header.length, 12 + 8); // offset
  header.writeUInt32BE(fvar.length, 12 + 12); // length

  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'axis-motion-test-')),
    'synthetic.ttf'
  );
  fs.writeFileSync(file, Buffer.concat([header, fvar]));
  return file;
}

module.exports = { buildSyntheticFont };

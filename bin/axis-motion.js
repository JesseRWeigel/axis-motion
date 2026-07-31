#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parseTimeline, DslError, GRAMMAR } = require('../src/dsl');
const { compile, sample, AxisError } = require('../src/compile');
const { emitCss } = require('../src/emit-css');
const { emitWaapiJson } = require('../src/emit-waapi');
const { readFvar, FontError } = require('../src/fvar');
const { scanFonts } = require('../src/scan');
const { renderPage } = require('../src/render-page');

const USAGE = `axis-motion, variable font axis animation

  axis-motion fonts                 list system fonts that carry an fvar table
  axis-motion axes <font-file>      print the axes a font declares
  axis-motion css <timeline.tl>     compile a timeline to CSS @keyframes
  axis-motion waapi <timeline.tl>   compile a timeline to a WAAPI JSON spec
  axis-motion page <timeline.tl>    compile to a standalone HTML preview page
  axis-motion sample <timeline.tl> <glyphIndex> <timeMs>
                                    print the axis values at one instant
  axis-motion video <timeline.tl> [-o out/name.mp4] [--fps 30]
  axis-motion grammar               print the timeline grammar

Exit code is 1 on any parse error, unknown axis, or out of range value.
`;

function loadPlan(file) {
  const src = fs.readFileSync(file, 'utf8');
  const timeline = parseTimeline(src);
  return compile(timeline, { baseDir: path.dirname(path.resolve(file)) });
}

async function main(argv) {
  const cmd = argv[0];
  if (!cmd || cmd === '-h' || cmd === '--help') {
    process.stdout.write(USAGE);
    return 0;
  }
  if (cmd === 'grammar') {
    process.stdout.write(GRAMMAR + '\n');
    return 0;
  }
  if (cmd === 'fonts') {
    const r = scanFonts();
    const seen = new Set();
    process.stdout.write(`scanned ${r.scanned} font files\n`);
    for (const v of r.variable) {
      const axes = v.axes.map((a) => `${a.tag}[${a.min}..${a.max}] def ${a.default}`).join('  ');
      const dup = seen.has(v.realPath) ? '  (symlink to a file already listed)' : '';
      seen.add(v.realPath);
      process.stdout.write(`${v.file}\n    ${v.family || '(no family name)'}  ${axes}${dup}\n`);
    }
    process.stdout.write(
      `${r.variable.length} files with fvar, ${seen.size} distinct, ${r.static} static, ${r.errors.length} unreadable\n`
    );
    return 0;
  }
  if (cmd === 'axes') {
    if (!argv[1]) throw new Error('axes needs a font file');
    const f = readFvar(argv[1]);
    process.stdout.write(`${f.file}\nfamily: ${f.family || '(none)'}\n`);
    if (!f.isVariable) {
      process.stdout.write('no fvar table: this font has no variation axes\n');
      return 0;
    }
    for (const a of f.axes) {
      process.stdout.write(
        `  ${a.tag}  min ${a.min}  default ${a.default}  max ${a.max}` +
          `  name ${a.name || '(none)'}${a.hidden ? '  hidden' : ''}\n`
      );
    }
    process.stdout.write(`  ${f.instances.length} named instances\n`);
    return 0;
  }

  if (!argv[1]) throw new Error(`${cmd} needs a timeline file`);

  if (cmd === 'css') {
    process.stdout.write(emitCss(loadPlan(argv[1])));
    return 0;
  }
  if (cmd === 'waapi') {
    process.stdout.write(emitWaapiJson(loadPlan(argv[1])));
    return 0;
  }
  if (cmd === 'page') {
    process.stdout.write(renderPage(loadPlan(argv[1])));
    return 0;
  }
  if (cmd === 'sample') {
    const plan = loadPlan(argv[1]);
    const gi = Number(argv[2] || 0);
    const t = Number(argv[3] || 0);
    const v = sample(plan, gi, t);
    process.stdout.write(
      plan.axesUsed.map((tag) => `"${tag}" ${Number(v[tag].toFixed(4))}`).join(', ') + '\n'
    );
    return 0;
  }
  if (cmd === 'video') {
    const { exportVideo } = require('../src/export-video');
    const plan = loadPlan(argv[1]);
    const oi = argv.indexOf('-o');
    const fi = argv.indexOf('--fps');
    const r = await exportVideo(plan, {
      out: oi > 0 ? argv[oi + 1] : 'out/axis-motion.mp4',
      fps: fi > 0 ? Number(argv[fi + 1]) : 30,
    });
    process.stdout.write(
      `wrote ${r.out}\n${r.frames} frames at ${r.fps} fps, ` +
        `${r.durationMs}ms, ${r.bytes} bytes\n`
    );
    return 0;
  }
  throw new Error(`unknown command "${cmd}"\n\n${USAGE}`);
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    if (err instanceof DslError) {
      process.stderr.write('timeline parse error\n' + err.format() + '\n');
    } else if (err instanceof AxisError) {
      process.stderr.write(`refused: ${err.message}\n`);
    } else if (err instanceof FontError) {
      process.stderr.write(`font error in ${err.file}: ${err.message}\n`);
    } else {
      process.stderr.write(`error: ${err.message}\n`);
    }
    process.exit(1);
  });

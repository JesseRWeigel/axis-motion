'use strict';
// Video export.
//
// Honest account of how this works and why:
//
// ffmpeg's `drawtext` filter draws text through libfreetype, and it exposes
// no way to set OpenType variation coordinates. Given a variable font it
// draws that font's default instance and silently ignores any axis you meant
// to animate, which would produce a video of completely static text with a
// convincing filename. So this exporter does not use drawtext.
//
// Instead it drives headless Chromium, which does implement
// font-variation-settings, seeks the same WAAPI animation the JS export
// produces to each frame time, screenshots, and pipes the PNGs into ffmpeg.
// The typography in the video is therefore rendered by the same engine and
// the same font file as the browser export. What it is not is an independent
// text rasteriser. If Chromium is unavailable this function raises; it never
// falls back to drawtext.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { renderPage } = require('./render-page');

// playwright-core is not a dependency of this project. It is borrowed from a
// sibling project in the same workspace, or pointed at with an env var.
// No absolute home directory path is committed, and no single hardcoded path either: resolving
// only a SIBLING project's node_modules worked in the directory this was written in and failed
// in every fresh clone. PLAYWRIGHT_CORE is honoured alongside the project-specific name because
// every other project in this catalog uses that one.
const CANDIDATES = [
  process.env.AXIS_MOTION_PLAYWRIGHT,
  process.env.PLAYWRIGHT_CORE,
  path.resolve(__dirname, '..', 'node_modules', 'playwright-core'),
  'playwright-core',
  'playwright',
  path.resolve(__dirname, '..', '..', 'a11y-sweep', 'node_modules', 'playwright-core'),
].filter(Boolean);

function loadChromium() {
  const tried = [];
  for (const c of CANDIDATES) {
    try {
      return require(c).chromium;
    } catch (err) {
      tried.push(c);
    }
  }
  throw new Error(
    'video export needs playwright-core and none was found.\n'
    + 'To install:  npm install --no-save playwright-core && npx playwright install chromium\n'
    + 'Or point at an existing install with PLAYWRIGHT_CORE=/path/to/playwright-core\n'
    + `Tried: ${tried.join(', ')}`
  );
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve({ out, err }) : reject(new Error(`${cmd} exited ${code}\n${err.slice(-2000)}`))));
  });
}

/**
 * @param {object} plan compiled plan
 * @param {object} opts { out, fps, width, height, fontSize, background, color }
 * @returns {Promise<{out:string, frames:number, fps:number, bytes:number, durationMs:number}>}
 */
async function exportVideo(plan, opts = {}) {
  const o = {
    out: 'out/axis-motion.mp4',
    fps: 30,
    width: 960,
    height: 320,
    fontSize: 96,
    background: '#0e0f12',
    color: '#f4f4f5',
    ...opts,
  };
  const chromium = loadChromium();
  const durationMs = plan.totalDuration;
  const frames = Math.max(2, Math.round((durationMs / 1000) * o.fps) + 1);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'axis-motion-'));
  const pagePath = path.join(tmp, 'frame.html');
  fs.writeFileSync(pagePath, renderPage(plan, o));

  const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  try {
    const page = await browser.newPage({
      viewport: { width: o.width, height: o.height },
      deviceScaleFactor: 1,
    });
    await page.goto('file://' + pagePath);
    await page.waitForFunction('window.axisMotionReady === true');
    await page.evaluate(() => document.fonts.ready);
    for (let i = 0; i < frames; i++) {
      const t = (i / (frames - 1)) * durationMs;
      await page.evaluate((tt) => window.axisMotionSeek(tt), t);
      await page.screenshot({
        path: path.join(tmp, `f${String(i).padStart(5, '0')}.png`),
      });
    }
  } finally {
    await browser.close();
  }

  fs.mkdirSync(path.dirname(path.resolve(o.out)), { recursive: true });
  await run('ffmpeg', [
    '-y',
    '-loglevel', 'error',
    '-framerate', String(o.fps),
    '-i', path.join(tmp, 'f%05d.png'),
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'medium',
    '-crf', '18',
    path.resolve(o.out),
  ]);

  for (const f of fs.readdirSync(tmp)) fs.unlinkSync(path.join(tmp, f));
  fs.rmdirSync(tmp);

  const bytes = fs.statSync(path.resolve(o.out)).size;
  return { out: path.resolve(o.out), frames, fps: o.fps, bytes, durationMs };
}

module.exports = { exportVideo, PLAYWRIGHT };

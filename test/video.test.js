'use strict';
// Video export.
//
// The claim in README.md is that ffmpeg's own text drawing cannot set
// variation axes, which is why frames come from Chromium instead. That claim
// is asserted here against the real ffmpeg on this machine rather than left
// as prose, and the encoded file is then checked to actually contain motion.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseTimeline } = require('../src/dsl');
const { compile } = require('../src/compile');
const { exportVideo } = require('../src/export-video');

const ROOT = path.resolve(__dirname, '..');
const FONT = '/usr/share/fonts/truetype/ubuntu/UbuntuSans[wdth,wght].ttf';

const TINY = [
  `font ${FONT}`,
  'text "AB"',
  'name tiny',
  'duration 400ms',
  'stagger 100ms',
  'easing linear',
  '@0% wght 100',
  '@100% wght 800',
].join('\n');

test('ffmpeg exists and its drawtext filter has no way to set a variation axis', () => {
  const version = execFileSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  assert.match(version, /^ffmpeg version /, 'ffmpeg not on PATH');

  const help = execFileSync('ffmpeg', ['-hide_banner', '-h', 'filter=drawtext'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.match(help, /fontfile/, 'this does not look like drawtext help output');
  // If a future ffmpeg gains an axis option, this fails and the README's
  // explanation has to be rewritten. That is the intended behaviour.
  for (const word of ['variation', 'variable_font', 'axis', 'axes', 'fvar', 'variations']) {
    assert.ok(
      !new RegExp(`\\b${word}\\b`, 'i').test(help),
      `drawtext help mentions "${word}", so the README claim needs revisiting`
    );
  }
});

test('the exporter renders a real mp4 whose frames actually change', async (t) => {
  const plan = compile(parseTimeline(TINY), { baseDir: ROOT });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axis-motion-video-'));
  const out = path.join(dir, 'tiny.mp4');

  const r = await exportVideo(plan, {
    out,
    fps: 10,
    width: 320,
    height: 120,
    fontSize: 48,
  });

  // 400ms timeline + 100ms stagger = 500ms, at 10fps that is 6 frames.
  assert.equal(r.durationMs, 500);
  assert.equal(r.frames, 6);
  assert.ok(fs.existsSync(out), 'no file was written');
  assert.ok(r.bytes > 500, `suspiciously small video: ${r.bytes} bytes`);

  const probe = execFileSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
     'stream=codec_name,width,height,nb_frames', '-of', 'default=nw=1', out],
    { encoding: 'utf8' }
  );
  assert.match(probe, /codec_name=h264/);
  assert.match(probe, /width=320/);
  assert.match(probe, /height=120/);
  assert.match(probe, /nb_frames=6/);

  // Decode the first and last frame and confirm they differ. A silently
  // static render would produce identical frames and still probe fine.
  const frames = path.join(dir, 'check');
  fs.mkdirSync(frames);
  execFileSync('ffmpeg', ['-v', 'error', '-i', out, path.join(frames, 'f%03d.png')]);
  const files = fs.readdirSync(frames).sort();
  assert.equal(files.length, 6, `expected 6 decoded frames, got ${files.length}`);
  const first = fs.readFileSync(path.join(frames, files[0]));
  const last = fs.readFileSync(path.join(frames, files[files.length - 1]));
  assert.notEqual(
    first.length === last.length && Buffer.compare(first, last) === 0,
    true,
    'first and last frame are byte identical, so the video is not animating'
  );
  // And the text should get heavier, which means more non-background pixels.
  const ink = (buf) => buf.length; // PNG size tracks ink for a flat background
  assert.ok(
    ink(last) > ink(first),
    `expected the heavier last frame to encode larger, got ${ink(first)} then ${ink(last)}`
  );

  t.diagnostic(`video: ${r.frames} frames at ${r.fps} fps, ${r.bytes} bytes`);
  fs.rmSync(dir, { recursive: true, force: true });
});

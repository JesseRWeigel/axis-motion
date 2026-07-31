'use strict';
// The axis-motion timeline DSL.
//
// One statement per line. A statement is either a directive or a keyframe.
// Blank lines and lines whose first non-space character is `#` are ignored.
// The full grammar is in README.md and is repeated in GRAMMAR below so the
// parser and the documentation cannot drift apart silently.

const { parseEasing } = require('./easing');

const GRAMMAR = `
program    := line*
line       := directive | keyframe | comment | blank
comment    := ws* "#" any*
directive  := ws* name ws+ argument (ws+ argument)* ws*
name       := "font" | "text" | "duration" | "stagger" | "easing" | "name"
keyframe   := ws* "@" position ws+ settings (ws* "[" easing "]")? ws*
position   := number "%" | number ("ms" | "s")
settings   := setting (ws* "," ws* setting)*
setting    := tag ws+ number
tag        := <4 characters, [A-Za-z0-9 ], an OpenType axis tag>
number     := ["+"|"-"] digit* ["." digit*]
easing     := "linear" | "ease" | "ease-in" | "ease-out" | "ease-in-out"
            | "cubic-bezier(" number "," number "," number "," number ")"
`.trim();

class DslError extends Error {
  constructor(message, line, column, source) {
    super(`line ${line}, column ${column}: ${message}`);
    this.name = 'DslError';
    this.line = line;
    this.column = column;
    this.reason = message;
    this.sourceLine = source;
  }
  /** Human readable caret pointing at the offending column. */
  format() {
    const gutter = String(this.line).padStart(4) + ' | ';
    return [
      this.message,
      gutter + (this.sourceLine === undefined ? '' : this.sourceLine),
      ' '.repeat(gutter.length + this.column - 1) + '^',
    ].join('\n');
  }
}

const DIRECTIVES = new Set(['font', 'text', 'duration', 'stagger', 'easing', 'name']);
const NUMBER_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

// A cursor over one line, so every error carries a 1-based column.
class Line {
  constructor(text, lineNo) {
    this.text = text;
    this.lineNo = lineNo;
    this.i = 0;
  }
  get col() {
    return this.i + 1;
  }
  fail(message, col = this.col) {
    throw new DslError(message, this.lineNo, col, this.text);
  }
  skipWs() {
    while (this.i < this.text.length && /\s/.test(this.text[this.i])) this.i++;
  }
  atEnd() {
    this.skipWs();
    return this.i >= this.text.length;
  }
  peek() {
    return this.text[this.i];
  }
  expect(ch) {
    this.skipWs();
    if (this.text[this.i] !== ch) {
      this.fail(`expected "${ch}", found ${this.text[this.i] === undefined ? 'end of line' : `"${this.text[this.i]}"`}`);
    }
    this.i++;
  }
  // A run of non-space, non-comma, non-bracket characters.
  word() {
    this.skipWs();
    const start = this.i;
    while (this.i < this.text.length && !/[\s,[\]]/.test(this.text[this.i])) this.i++;
    if (this.i === start) this.fail('expected a word', start + 1);
    return { value: this.text.slice(start, this.i), col: start + 1 };
  }
  number() {
    const w = this.word();
    if (!NUMBER_RE.test(w.value)) {
      this.fail(`expected a number, found "${w.value}"`, w.col);
    }
    return { value: Number(w.value), col: w.col };
  }
  rest() {
    this.skipWs();
    const start = this.i;
    this.i = this.text.length;
    return { value: this.text.slice(start).trim(), col: start + 1 };
  }
}

function stripComment(text) {
  // `#` only starts a comment outside a quoted string.
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') quoted = !quoted;
    else if (text[i] === '#' && !quoted) return text.slice(0, i);
  }
  return text;
}

function parseTime(token, line) {
  const m = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(ms|s)$/.exec(token.value);
  if (!m) {
    line.fail(`expected a duration like 800ms or 1.5s, found "${token.value}"`, token.col);
  }
  const n = Number(m[1]);
  if (n < 0) line.fail(`duration must not be negative, found "${token.value}"`, token.col);
  return m[2] === 's' ? n * 1000 : n;
}

function unquote(raw, line, col) {
  if (raw.length >= 2 && raw[0] === '"' && raw[raw.length - 1] === '"') {
    return raw.slice(1, -1);
  }
  if (raw.includes('"')) line.fail('unbalanced quote', col);
  return raw;
}

/**
 * Parse timeline source into a syntax object. No font is consulted here,
 * so this stage cannot know whether an axis is real. That check lives in
 * compile(), which has the font.
 */
function parseTimeline(source) {
  const lines = String(source).split('\n');
  const out = {
    font: null,
    text: null,
    duration: null,
    stagger: 0,
    easing: parseEasing('linear'),
    name: 'axis-motion',
    keyframes: [],
  };
  const seen = new Set();

  for (let n = 0; n < lines.length; n++) {
    const raw = stripComment(lines[n].replace(/\r$/, ''));
    if (!raw.trim()) continue;
    // Column numbers stay correct against the original line because
    // stripComment only ever truncates a suffix.
    const line = new Line(raw, n + 1);
    line.skipWs();

    if (line.peek() === '@') {
      out.keyframes.push(parseKeyframe(line));
      continue;
    }

    const kw = line.word();
    if (!DIRECTIVES.has(kw.value)) {
      line.fail(
        `unknown directive "${kw.value}". Expected one of: ${[...DIRECTIVES].join(', ')}, or a keyframe starting with "@"`,
        kw.col
      );
    }
    if (seen.has(kw.value)) {
      line.fail(`directive "${kw.value}" given more than once`, kw.col);
    }
    seen.add(kw.value);

    switch (kw.value) {
      case 'font': {
        const v = line.rest();
        if (!v.value) line.fail('font needs a path', v.col);
        out.font = unquote(v.value, line, v.col);
        break;
      }
      case 'text': {
        const v = line.rest();
        if (!v.value) line.fail('text needs a string', v.col);
        out.text = unquote(v.value, line, v.col);
        if (out.text.length === 0) line.fail('text must not be empty', v.col);
        break;
      }
      case 'name': {
        const v = line.word();
        if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(v.value)) {
          line.fail(`name "${v.value}" must be a CSS identifier`, v.col);
        }
        out.name = v.value;
        if (!line.atEnd()) line.fail('unexpected extra input after name');
        break;
      }
      case 'duration':
      case 'stagger': {
        const v = line.word();
        out[kw.value] = parseTime(v, line);
        if (!line.atEnd()) line.fail(`unexpected extra input after ${kw.value}`);
        break;
      }
      case 'easing': {
        const v = line.rest();
        try {
          out.easing = parseEasing(v.value);
        } catch (err) {
          line.fail(err.message, v.col);
        }
        break;
      }
    }
  }

  if (out.font === null) throw new DslError('no "font" directive in timeline', lines.length, 1, '');
  if (out.text === null) throw new DslError('no "text" directive in timeline', lines.length, 1, '');
  if (out.duration === null) {
    throw new DslError('no "duration" directive in timeline', lines.length, 1, '');
  }
  if (out.duration <= 0) {
    throw new DslError('duration must be greater than 0', lines.length, 1, '');
  }
  if (out.keyframes.length < 2) {
    throw new DslError(
      `a timeline needs at least 2 keyframes, found ${out.keyframes.length}`,
      lines.length,
      1,
      ''
    );
  }

  // Resolve keyframe positions to offsets in [0,1].
  for (const kf of out.keyframes) {
    if (kf.unit === '%') {
      if (kf.raw < 0 || kf.raw > 100) {
        throw new DslError(
          `keyframe position ${kf.raw}% is outside 0% to 100%`,
          kf.line,
          kf.col,
          kf.source
        );
      }
      kf.offset = kf.raw / 100;
    } else {
      if (kf.ms > out.duration) {
        throw new DslError(
          `keyframe at ${kf.ms}ms is past the ${out.duration}ms duration`,
          kf.line,
          kf.col,
          kf.source
        );
      }
      kf.offset = kf.ms / out.duration;
    }
    kf.timeMs = kf.offset * out.duration;
  }

  for (let i = 1; i < out.keyframes.length; i++) {
    const prev = out.keyframes[i - 1];
    const cur = out.keyframes[i];
    if (cur.offset <= prev.offset) {
      throw new DslError(
        `keyframe offsets must increase: ${fmtPct(cur.offset)} does not come after ${fmtPct(prev.offset)}`,
        cur.line,
        cur.col,
        cur.source
      );
    }
  }
  const first = out.keyframes[0];
  const last = out.keyframes[out.keyframes.length - 1];
  if (first.offset !== 0) {
    throw new DslError(
      `first keyframe must be at 0%, found ${fmtPct(first.offset)}`,
      first.line,
      first.col,
      first.source
    );
  }
  if (last.offset !== 1) {
    throw new DslError(
      `last keyframe must be at 100%, found ${fmtPct(last.offset)}`,
      last.line,
      last.col,
      last.source
    );
  }
  return out;
}

function fmtPct(offset) {
  const p = offset * 100;
  return `${Number(p.toFixed(4))}%`;
}

function parseKeyframe(line) {
  const atCol = line.col;
  line.expect('@');
  const pos = line.word();
  const kf = {
    line: line.lineNo,
    col: atCol,
    source: line.text,
    settings: [],
    easing: null,
  };
  if (pos.value.endsWith('%')) {
    const body = pos.value.slice(0, -1);
    if (!NUMBER_RE.test(body)) {
      line.fail(`expected a percentage like 50%, found "${pos.value}"`, pos.col);
    }
    kf.unit = '%';
    kf.raw = Number(body);
  } else {
    kf.unit = 'time';
    kf.ms = parseTime(pos, line);
  }

  for (;;) {
    line.skipWs();
    if (line.peek() === '[' || line.atEnd()) break;
    const tag = line.word();
    if (!/^[\x20-\x7e]{4}$/.test(tag.value) || !/^[A-Za-z0-9 ]{4}$/.test(tag.value)) {
      line.fail(
        `axis tag "${tag.value}" must be exactly 4 characters from A-Z, a-z, 0-9 or space`,
        tag.col
      );
    }
    const val = line.number();
    kf.settings.push({ tag: tag.value, value: val.value, col: val.col, tagCol: tag.col });
    line.skipWs();
    if (line.peek() === ',') {
      line.i++;
      continue;
    }
    break;
  }

  if (kf.settings.length === 0) {
    line.fail('keyframe has no axis settings', line.col);
  }

  line.skipWs();
  if (line.peek() === '[') {
    const openCol = line.col;
    line.i++;
    const close = line.text.indexOf(']', line.i);
    if (close === -1) line.fail('unclosed "[" around easing', openCol);
    const spec = line.text.slice(line.i, close).trim();
    try {
      kf.easing = parseEasing(spec);
    } catch (err) {
      line.fail(err.message, line.i + 1);
    }
    line.i = close + 1;
  }
  if (!line.atEnd()) {
    line.fail(`unexpected input "${line.text.slice(line.i).trim()}" at end of keyframe`);
  }

  const tags = new Set();
  for (const s of kf.settings) {
    if (tags.has(s.tag)) {
      throw new DslError(`axis "${s.tag}" set twice in one keyframe`, kf.line, s.tagCol, kf.source);
    }
    tags.add(s.tag);
  }
  return kf;
}

module.exports = { parseTimeline, DslError, GRAMMAR };

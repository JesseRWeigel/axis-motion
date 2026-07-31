#!/usr/bin/env bash
# axis-motion verification. Exits 0 only when every check really ran and passed.
# A dependency that is missing is a failure, never a skip.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
SUCCESS_LINE="axis-motion verify: all checks passed"

say() { printf '\n== %s\n' "$1"; }
# Paths printed here go into README.md, so strip $HOME. The replacement needs
# a backslash before the tilde or bash expands it back to $HOME and the
# substitution silently does nothing.
tilde() { printf '%s' "${1/#$HOME/\~}"; }

fail=0

say "environment"
node --version
ffmpeg -version | head -1
printf 'repo: %s\n' "$(tilde "$ROOT")"

say "no secrets and no home directory paths in tracked files"
# Checked with Python, not grep. A file containing a NUL byte is classified as
# binary by grep and skipped entirely, which reports the same "clean" as a file
# that was read and found clean.
python3 - "$ROOT" <<'PY'
import os, re, subprocess, sys
root = sys.argv[1]
files = subprocess.run(['git', 'ls-files', '-z'], cwd=root, capture_output=True, check=True)
names = [n for n in files.stdout.decode().split('\0') if n]
patterns = [
    ('aws key id', re.compile(rb'AKIA[0-9A-Z]{16}')),
    ('github token', re.compile(rb'gh[pousr]_[A-Za-z0-9]{36}')),
    ('openai key', re.compile(rb'sk-[A-Za-z0-9]{32,}')),
    ('openrouter key', re.compile(rb'sk-or-v1-[a-f0-9]{64}')),
    ('slack token', re.compile(rb'xox[baprs]-[A-Za-z0-9-]{10,}')),
    ('private key block', re.compile(rb'-----BEGIN [A-Z ]*PRIVATE KEY-----')),
    ('home directory path', re.compile(rb'/home/[a-z][a-z0-9_-]*/')),
]
bad, nul = [], []
for n in names:
    p = os.path.join(root, n)
    if not os.path.isfile(p):
        continue
    data = open(p, 'rb').read()
    if b'\0' in data:
        nul.append(n)
    for label, rx in patterns:
        for m in rx.finditer(data):
            bad.append(f'{n}: {label}: {m.group(0)[:24]!r}')
total = sum(os.path.getsize(os.path.join(root,n)) for n in names if os.path.isfile(os.path.join(root,n)))
print(f'scanned {len(names)} tracked files, {round(total/1024)} KB')
if nul:
    print('files containing a NUL byte, which would blind a grep based scan:')
    for n in nul:
        print('  ' + n)
    sys.exit(1)
if bad:
    print('credential shaped or private strings found:')
    for b in bad:
        print('  ' + b)
    sys.exit(1)
print('no credential shaped strings, no /home/<user>/ paths, no NUL bytes')
PY

say "nothing large and nothing binary is committed"
python3 - "$ROOT" <<'PY'
import os, subprocess, sys
root = sys.argv[1]
names = [n for n in subprocess.run(['git','ls-files','-z'], cwd=root, capture_output=True, check=True).stdout.decode().split('\0') if n]
total = 0
big = []
banned = []
for n in names:
    p = os.path.join(root, n)
    if not os.path.isfile(p):
        continue
    size = os.path.getsize(p)
    total += size
    if size > 200_000:
        big.append((n, size))
    if os.path.splitext(n)[1].lower() in {'.ttf', '.otf', '.woff', '.woff2', '.mp4', '.webm', '.mov', '.png', '.jpg', '.gif'}:
        banned.append(n)
print(f'{len(names)} tracked files, {round(total/1024)} KB total')
if banned:
    print('font or media files are committed, which this project forbids:')
    for n in banned:
        print('  ' + n)
    sys.exit(1)
if big:
    print('files over 200 KB:')
    for n, s in big:
        print(f'  {n} {s}')
    sys.exit(1)
print('largest tracked file: ' + max(((os.path.getsize(os.path.join(root,n)), n) for n in names if os.path.isfile(os.path.join(root,n))))[1])
PY

say "the axis inventory this machine really has"
node bin/axis-motion.js fonts | tail -12

say "refusals, run for real"
set +e
node bin/axis-motion.js css examples/bad-axis.tl
rc_axis=$?
node bin/axis-motion.js css examples/out-of-range.tl
rc_range=$?
node bin/axis-motion.js css examples/bad-syntax.tl
rc_syntax=$?
node bin/axis-motion.js css examples/wide-to-narrow.tl > /dev/null
rc_good=$?
set -e
printf 'exit codes: unknown axis %s, out of range %s, syntax error %s, valid timeline %s\n' \
  "$rc_axis" "$rc_range" "$rc_syntax" "$rc_good"
if [ "$rc_axis" -ne 1 ] || [ "$rc_range" -ne 1 ] || [ "$rc_syntax" -ne 1 ]; then
  echo "FAIL: a case that must be refused did not exit 1"
  fail=1
fi
if [ "$rc_good" -ne 0 ]; then
  echo "FAIL: a valid timeline did not compile"
  fail=1
fi

say "docs/index.html is a fresh build from the live font scan"
node tools/build-docs.js --check

say "test suite"
# Every test file is named explicitly. A glob that matched nothing would let
# this report success having run zero tests.
TESTS=(test/fvar.test.js test/dsl.test.js test/easing.test.js test/refusal.test.js
       test/stagger.test.js test/determinism.test.js test/video.test.js test/browser.test.js)
for f in "${TESTS[@]}"; do
  [ -f "$f" ] || { echo "FAIL: missing test file $f"; exit 1; }
done
TEST_LOG="$(mktemp)"
trap 'rm -f "$TEST_LOG"' EXIT
if ! node --test "${TESTS[@]}" 2>&1 | tee "$TEST_LOG"; then
  fail=1
fi

PASS_COUNT=$(sed -n 's/^ℹ pass \([0-9]*\)$/\1/p' "$TEST_LOG" | tail -1)
FAIL_COUNT=$(sed -n 's/^ℹ fail \([0-9]*\)$/\1/p' "$TEST_LOG" | tail -1)
SKIP_COUNT=$(sed -n 's/^ℹ skipped \([0-9]*\)$/\1/p' "$TEST_LOG" | tail -1)
: "${PASS_COUNT:=0}" "${FAIL_COUNT:=1}" "${SKIP_COUNT:=0}"

say "test accounting"
printf 'pass %s, fail %s, skipped %s\n' "$PASS_COUNT" "$FAIL_COUNT" "$SKIP_COUNT"
EXPECTED_TESTS=79
if [ "$FAIL_COUNT" -ne 0 ]; then
  echo "FAIL: $FAIL_COUNT test(s) failed"
  fail=1
fi
if [ "$SKIP_COUNT" -ne 0 ]; then
  echo "FAIL: $SKIP_COUNT test(s) were skipped, which is 'could not verify'"
  fail=1
fi
if [ "$PASS_COUNT" -ne "$EXPECTED_TESTS" ]; then
  echo "FAIL: expected $EXPECTED_TESTS passing tests, saw $PASS_COUNT."
  echo "      If a test was added or removed on purpose, update EXPECTED_TESTS"
  echo "      in scripts/verify.sh and the count in README.md."
  fail=1
fi

say "README is current"
python3 - "$ROOT" "$SUCCESS_LINE" "$PASS_COUNT" <<'PY'
import re, sys, os
root, success_line, passes = sys.argv[1], sys.argv[2], sys.argv[3]
p = os.path.join(root, 'README.md')
if not os.path.isfile(p):
    print('FAIL: no README.md'); sys.exit(1)
text = open(p, encoding='utf-8').read()
problems = []
if '## Status' not in text:
    problems.append('README.md has no "## Status" section')
else:
    status = text.split('## Status', 1)[1].split('\n## ', 1)[0]
    if success_line not in status:
        problems.append(f'the Status section does not contain the verify success line: {success_line!r}')
    if f'pass {passes}' not in status:
        problems.append(f'the Status section does not show the current passing count, pass {passes}')
for section in ['## Limitations', '## The timeline DSL', '## Axis inventory']:
    if section not in text:
        problems.append(f'README.md has no "{section}" section')
for placeholder in ['TODO', 'FIXME', 'coming soon', 'XXX']:
    if placeholder in text:
        problems.append(f'README.md still contains the placeholder {placeholder!r}')
if re.search(r'/home/[a-z][a-z0-9_-]*/', text):
    problems.append('README.md contains an absolute /home/<user>/ path')
# The README claims an axis inventory. Check it against a live scan.
sys.path.insert(0, root)
import subprocess, json
out = subprocess.run(['node', '-e', """
const {scanFonts} = require('./src/scan');
const s = scanFonts();
const distinct = new Map();
for (const v of s.variable) if (!distinct.has(v.realPath)) distinct.set(v.realPath, v);
const tags = [...new Set(s.variable.flatMap(v => v.axes.map(a => a.tag)))].sort();
process.stdout.write(JSON.stringify({files: [...distinct.keys()].map(p => p.split('/').pop()), tags, scanned: s.scanned, withFvar: s.variable.length}));
"""], cwd=root, capture_output=True, text=True, check=True)
live = json.loads(out.stdout)
for f in live['files']:
    if f not in text:
        problems.append(f'README.md does not list the variable font {f}')
for t in live['tags']:
    if f'`{t}`' not in text:
        problems.append(f'README.md does not mention the axis tag {t}')
if problems:
    for x in problems:
        print('FAIL: ' + x)
    sys.exit(1)
print(f'README.md carries the Status section, the success line, pass {passes}, '
      f'all {len(live["files"])} variable fonts and all {len(live["tags"])} axis tags')
PY

if [ "$fail" -ne 0 ]; then
  echo
  echo "axis-motion verify: FAILED"
  exit 1
fi

echo
echo "$SUCCESS_LINE"

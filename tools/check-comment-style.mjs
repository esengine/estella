// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-comment-style.mjs — docs/CODE_COMMENTS.md, enforced.
 *
 * The convention says: few comments, state the contract, put history in the
 * commit message. It was documented and then violated steadily, because every
 * other convention in this repo has a gate and this one had only prose asking
 * for less prose.
 *
 * It reads the DIFF, not the tree. The convention's own rollout rule is "clean
 * up the file you touch", so the tree is full of comments written before it and
 * a whole-tree gate would be noise nobody could act on. Checking added lines
 * makes it actionable on exactly the code being written.
 *
 *   node tools/check-comment-style.mjs           added lines vs origin/master
 *   node tools/check-comment-style.mjs --all     whole tree (reporting only)
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { corpusRoots, censusFindings, trackedFiles, untrackedFiles, addedDiff }
  from './lib/sourceCensus.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = /\.(ts|tsx|mjs|js|cpp|hpp|h)$/;
// Generated files state what the generator says; third-party carries its own style.
const SKIP = /(^|\/)(node_modules|dist|build|third_party|\.git)\/|\.generated\.|generated\//;

/**
 * How much a comment may say before it is prose. An inline `//` run explains one
 * non-obvious decision, so it gets the convention's "add a line"; a doc block
 * states a contract and may need a few more.
 */
const MAX_INLINE_LINES = 3;
const MAX_DOC_LINES = 4;

const RULES = [
  {
    id: 'history',
    // Past tense ABOUT THE CODE. git already records it, and it goes stale in place.
    test: /\b(used to|as this used|previously,|formerly|in the past)\b|\bwas (?:removed|renamed|split out|moved (?:to|out))\b|\bhas been (?:removed|renamed|moved)\b|\bthe old (?:path|code|way|behaviou?r|version)\b/i,
    say: 'history of the code — put it in the commit message, keep the contract here',
  },
  {
    id: 'stage-name',
    // Roadmap codenames a reader cannot look up, and that outlive the roadmap.
    test: /\b(RC\d+|P[0-3]\b|Phase \d|Batch [A-Z]\b|gap \d|audit [A-Z]\d)/,
    say: 'internal stage/roadmap codename — name the thing, not the plan it came from',
  },
  {
    id: 'unreachable-doc',
    // A pointer the reader cannot follow: a section sign is a codename wearing a
    // number, and an uncommitted markdown path names a file on somebody else's
    // disk — which the gitignored design docs here have always been.
    test: (text) => /§/.test(text) || docRefs(text).some((d) => !isTracked(d)),
    say: 'points at something the reader cannot open — say what it says, or cite a committed path',
  },
];

/** Markdown paths named in a comment, as written. */
function docRefs(text) {
  return [...text.matchAll(/[\w./-]+\.md\b/g)].map((m) => m[0]);
}

/**
 * Every path git has, plus their basenames, because a comment cites a document
 * by bare filename as often as by its full path and both mean one file. Empty
 * means the question could not be asked, and a scan that cannot ask must not
 * answer green.
 */
const ROOTS = corpusRoots();
const CENSUS = censusFindings(ROOTS);

const TRACKED = (() => {
  const files = ROOTS.flatMap((r) => trackedFiles(r));
  if (files.length === 0) {
    console.error('check-comment-style: the census is empty — cannot judge doc references.');
    process.exit(2);
  }
  return new Set([...files, ...files.map((f) => f.slice(f.lastIndexOf('/') + 1))]);
})();

function isTracked(ref) {
  const clean = ref.replace(/^\.\//, '');
  return TRACKED.has(clean) || TRACKED.has(clean.slice(clean.lastIndexOf('/') + 1));
}

/** Every line of `file`, as [lineNumber, text] — a new file is all added. */
function wholeFile(byFile, f) {
  try {
    byFile.set(f, readFileSync(path.join(ROOT, f), 'utf8').split('\n').map((t, i) => [i + 1, t]));
  } catch { /* vanished between listing and reading */ }
}

/** Added lines per file, as [lineNumber, text], across every corpus root. */
function addedLines() {
  const byFile = new Map();
  for (const root of ROOTS) {
    // A file git has never seen produces no diff, and a brand-new file is exactly
    // where prose collects — every line of it is added.
    for (const f of untrackedFiles(root)) {
      if (!SKIP.test(f) && SOURCE.test(f)) wholeFile(byFile, f);
    }
    let file = null;
    let line = 0;
    for (const raw of addedDiff(root, ['-U0']).split('\n')) {
      if (raw.startsWith('+++ b/')) {
        const named = root.prefix ? `${root.prefix}/${raw.slice(6).trim()}` : raw.slice(6).trim();
        file = SKIP.test(named) || !SOURCE.test(named) ? null : named;
        continue;
      }
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      if (hunk) { line = Number(hunk[1]); continue; }
      if (!file) continue;
      if (raw.startsWith('+')) {
        if (!byFile.has(file)) byFile.set(file, []);
        byFile.get(file).push([line, raw.slice(1)]);
        line++;
      }
    }
  }
  return byFile;
}

function allLines() {
  const byFile = new Map();
  for (const root of ROOTS) {
    for (const f of trackedFiles(root)) {
      if (SKIP.test(f) || !SOURCE.test(f)) continue;
      wholeFile(byFile, f);
    }
  }
  return byFile;
}

const COMMENT = /^\s*(\/\/|\*|\/\*)/;
/**
 * Delimiters, section rules and structured tags carry no prose to measure.
 * `@details` is deliberately absent: it is where prose hides. The release tags
 * are here because api-surface requires one on every frozen symbol, and a
 * mandatory tag must not spend the budget meant for the contract — which is why
 * `@compiled` is here too: the AOT build reads it, so it is a declaration.
 */
const NOT_PROSE = /^\s*(\/\*+\s*$|\*\/|\/\/\s*[=-]+\s*$|\*\s*$|\/\/\s*$)|@(param|returns?|throws|example|see|code|endcode|file|brief|copyright|author|date|public|beta|experimental|internal|deprecated|compiled)\b/;
/** A Doxygen file header states why the file exists; that is its job. */
const FILE_HEADER = /@file\b/;

const headerSpanCache = new Map();
const fileTextCache = new Map();

/** A file's lines, cached — the diff cannot answer questions about what it omitted. */
function fileLines(file) {
  if (!fileTextCache.has(file)) {
    let lines = null;
    try { lines = readFileSync(path.join(ROOT, file), 'utf8').split('\n'); }
    catch { /* vanished, or unreadable */ }
    fileTextCache.set(file, lines);
  }
  return fileTextCache.get(file);
}

/**
 * The comment block a line belongs to, read from the file rather than the diff.
 * `-U0` carries no context, so a block edited twice arrives as two short runs and
 * is never weighed whole. `*/` closes a block and `/*` opens one: a doc comment
 * above a run of `//` stays two blocks, or the length reported is nobody's.
 */
function enclosingBlock(file, line) {
  const lines = fileLines(file);
  if (!lines) return null;
  const at = (n) => lines[n - 1];
  if (at(line) === undefined || !COMMENT.test(at(line))) return null;
  const opens = (t) => /^\s*\/\*/.test(t);
  const closes = (t) => /\*\//.test(t);
  let first = line;
  while (first > 1 && !opens(at(first))) {
    const above = at(first - 1);
    if (above === undefined || !COMMENT.test(above) || closes(above)) break;
    first -= 1;
  }
  let last = line;
  while (!closes(at(last))) {
    const below = at(last + 1);
    if (below === undefined || !COMMENT.test(below) || opens(below)) break;
    last += 1;
  }
  const out = [];
  for (let n = first; n <= last; n++) out.push([n, at(n)]);
  return out;
}

/**
 * Whether a line falls inside the file's `@file` header. Reading the diff means a
 * paragraph added to the MIDDLE of a header arrives without the `@file` line, so
 * the exemption has to be looked up on disk or the header's own budget is charged
 * to whoever edits it.
 */
function insideFileHeader(file, line) {
  if (!headerSpanCache.has(file)) {
    let span = null;
    try {
      const lines = readFileSync(path.join(ROOT, file), 'utf8').split('\n');
      const open = lines.findIndex((t) => /^\s*\/\*\*/.test(t));
      if (open >= 0) {
        const close = lines.findIndex((t, i) => i >= open && /\*\//.test(t));
        if (close >= 0 && lines.slice(open, close + 1).some((t) => FILE_HEADER.test(t))) {
          span = [open + 1, close + 1];
        }
      }
    } catch { /* vanished, or unreadable — no exemption */ }
    headerSpanCache.set(file, span);
  }
  const span = headerSpanCache.get(file);
  return span !== null && line >= span[0] && line <= span[1];
}

function scan(byFile) {
  const findings = [];
  for (const [file, lines] of byFile) {
    // One finding per real block, however many runs of it reached us.
    const measured = new Set();
    let run = [];
    const weigh = (block) => {
      const prose = block.filter(([, t]) => !NOT_PROSE.test(t));
      const isHeader = block.some(([, t]) => FILE_HEADER.test(t))
        || insideFileHeader(file, block[0][0]);
      // A block edited inside an existing `/** */` shows up in the diff without its
      // opener, so a run of ` * ` continuation lines counts as a doc block too.
      const isDoc = block.some(([, t]) => /^\s*\/\*\*/.test(t))
        || /^\s*\*/.test(block[0][1]);
      const limit = isDoc ? MAX_DOC_LINES : MAX_INLINE_LINES;
      if (!isHeader && prose.length > limit) {
        findings.push({
          file, line: block[0][0], id: 'too-long',
          say: `${prose.length} lines of prose (limit ${limit}) — state the contract or the trap, not the story`,
        });
      }
    };
    /**
     * A run of comment lines can span SEVERAL real blocks — SPDX lines above a
     * doc header are one run and two blocks — so each line's own block is weighed
     * and the run itself is never the unit.
     */
    const flushRun = () => {
      const seeds = run;
      run = [];
      if (seeds.length === 0) return;
      let any = false;
      for (const [n] of seeds) {
        const real = enclosingBlock(file, n);
        if (!real) continue;
        any = true;
        const start = real[0][0];
        if (measured.has(start)) continue;
        measured.add(start);
        weigh(real);
      }
      if (!any) weigh(seeds);
    };
    let prev = -2;
    for (const [n, text] of lines) {
      if (!COMMENT.test(text)) { flushRun(); prev = -2; continue; }
      if (n !== prev + 1) flushRun();
      run.push([n, text]);
      prev = n;
      for (const rule of RULES) {
        const hit = typeof rule.test === 'function' ? rule.test(text) : rule.test.test(text);
        if (hit) findings.push({ file, line: n, id: rule.id, say: rule.say, text: text.trim() });
      }
    }
    flushRun();
  }
  return findings;
}

const all = process.argv.includes('--all');
const lines = all ? allLines() : addedLines();
const findings = scan(lines);

/** What the run READ, so "clean" is attached to a corpus rather than to silence. */
const present = ROOTS.filter((r) => r.present);
const absent = ROOTS.filter((r) => !r.present).map((r) => r.prefix);
const read = `${lines.size} file(s) across ${present.length} repositor${present.length === 1 ? 'y' : 'ies'}`
  + (absent.length ? `, and none in ${absent.join(', ')} — not checked out` : '');

// A census that could not look is not a style opinion, so it fails even under
// --all: the whole failure mode here is a green run that read nothing.
if (CENSUS.length) {
  for (const f of CENSUS) console.error(`  - ${f}`);
  console.error(`\ncheck-comment-style: ${CENSUS.length} problem(s) with the corpus itself.`);
  process.exit(1);
}

if (findings.length === 0) {
  console.log(`check-comment-style: ${all ? 'tree' : 'added lines'} clean — ${read}; `
    + 'comments state contracts, not stories.');
  process.exit(0);
}

const byFile = new Map();
for (const f of findings) {
  if (!byFile.has(f.file)) byFile.set(f.file, []);
  byFile.get(f.file).push(f);
}
for (const [file, fs] of byFile) {
  console.error(`\n${file}`);
  for (const f of fs.sort((a, b) => a.line - b.line)) {
    console.error(`  ${file}:${f.line}  ${f.say}`);
    if (f.text) console.error(`      ${f.text}`);
  }
}
console.error(`\ncheck-comment-style: ${findings.length} finding(s) in ${read}. `
  + 'See docs/CODE_COMMENTS.md.');
process.exit(all ? 0 : 1);

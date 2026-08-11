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
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
];

/** Added lines per file, as [lineNumber, text]. */
function addedLines() {
  let base = '';
  for (const ref of ['origin/master', 'master']) {
    try {
      base = execFileSync('git', ['merge-base', 'HEAD', ref], { cwd: ROOT, encoding: 'utf8' }).trim();
      break;
    } catch { /* try the next ref */ }
  }
  const args = base ? ['diff', '-U0', base, '--'] : ['diff', '-U0', 'HEAD', '--'];
  const diff = execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

  const byFile = new Map();
  // A file git has never seen produces no diff, and a brand-new file is exactly
  // where prose collects — every line of it is added.
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  for (const f of untracked.split('\n')) {
    if (!f || SKIP.test(f) || !SOURCE.test(f)) continue;
    try {
      byFile.set(f, readFileSync(path.join(ROOT, f), 'utf8').split('\n').map((t, i) => [i + 1, t]));
    } catch { /* vanished between listing and reading */ }
  }
  let file = null;
  let line = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ b/')) {
      file = raw.slice(6).trim();
      if (SKIP.test(file) || !SOURCE.test(file)) file = null;
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
  return byFile;
}

function allLines() {
  const listed = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const byFile = new Map();
  for (const f of listed.split('\n')) {
    if (!f || SKIP.test(f) || !SOURCE.test(f)) continue;
    let text;
    try { text = readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
    byFile.set(f, text.split('\n').map((t, i) => [i + 1, t]));
  }
  return byFile;
}

const COMMENT = /^\s*(\/\/|\*|\/\*)/;
/**
 * Delimiters, section rules and structured tags carry no prose to measure.
 * `@details` is deliberately absent: it is where prose hides. The release tags
 * are here because api-surface requires one on every frozen symbol, and a
 * mandatory tag must not spend the budget meant for the contract.
 */
const NOT_PROSE = /^\s*(\/\*+\s*$|\*\/|\/\/\s*[=-]+\s*$|\*\s*$|\/\/\s*$)|@(param|returns?|throws|example|see|code|endcode|file|brief|copyright|author|date|public|beta|experimental|internal|deprecated)\b/;
/** A Doxygen file header states why the file exists; that is its job. */
const FILE_HEADER = /@file\b/;

const headerSpanCache = new Map();

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
    const index = new Map(lines.map(([n, t]) => [n, t]));
    let block = [];
    const flushBlock = () => {
      if (block.length === 0) return;
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
      block = [];
    };
    let prev = -2;
    for (const [n, text] of lines) {
      if (!COMMENT.test(text)) { flushBlock(); prev = -2; continue; }
      if (n !== prev + 1) flushBlock();
      block.push([n, text]);
      prev = n;
      for (const rule of RULES) {
        if (rule.test.test(text)) findings.push({ file, line: n, id: rule.id, say: rule.say, text: text.trim() });
      }
    }
    flushBlock();
    void index;
  }
  return findings;
}

const all = process.argv.includes('--all');
const findings = scan(all ? allLines() : addedLines());

if (findings.length === 0) {
  console.log(`check-comment-style: ${all ? 'tree' : 'added lines'} clean — comments state contracts, not stories.`);
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
console.error(`\ncheck-comment-style: ${findings.length} finding(s). See docs/CODE_COMMENTS.md.`);
process.exit(all ? 0 : 1);

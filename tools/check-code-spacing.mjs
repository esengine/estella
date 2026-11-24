#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-code-spacing.mjs — code is written to be read: spaced operators and commas, and no line that is a program.
 *
 * Read from the syntax tree, so a template, a regex or a generic is never taken for an operator. `a === b ? c : d`, `{ x: 1, y: 2 }`
 * and `if (` keep their spaces. A line may hold a few short statements (`x /= len; y /= len;`), but not more than six, and not a
 * block holding a block (`for (...) { if (a) { b; c; } }`): code once crammed that way, unspaced, read as minified.
 *
 *   node tools/check-code-spacing.mjs                 the gate: every TypeScript file under the roots below
 *   node tools/check-code-spacing.mjs --list          every finding, not only the first few a file
 *   node tools/check-code-spacing.mjs --fix [files]   insert the spaces and line breaks; whitespace only, so nothing else moves
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT } from './lib/repo.mjs';

const ts = createRequire(path.join(ROOT, 'sdk', 'package.json'))('typescript');

/** Where the rule holds. Generated code says what its generator says. */
const ROOTS = ['sdk/src', 'pipeline/src', 'desktop/src', 'desktop/electron', 'desktop/shared'];
const SKIP = /(^|\/)(node_modules|dist|build|third_party)\/|\.generated\.|\/generated\/|(^|\/)generated\.ts$|\.d\.ts$/;
const SOURCE = /\.(ts|tsx|mts)$/;
const MAX_A_LINE = 6;

const args = process.argv.slice(2);
const LIST = args.includes('--list');
const FIX = args.includes('--fix');
const named = args.filter((a) => !a.startsWith('--'));

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e);
    const isDir = statSync(p).isDirectory();
    const rel = path.relative(ROOT, p).replace(/\\/g, '/');
    if (SKIP.test(rel + (isDir ? '/' : ''))) continue;
    if (isDir) walk(p, out);
    else if (SOURCE.test(e)) out.push(p);
  }
}

const WS = /\s/;

/**
 * What is wrong with one file's text. Each finding carries `ins`, the whitespace insertions that fix it, as [offset, text];
 * a dense line carries `split`, the line to break apart.
 */
function inspect(file, text) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found = [];
  const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const say = (pos, what, ins) => found.push({ line: lineOf(pos), what, ins });

  // An operator token with whitespace on both sides of it.
  const spacedOp = (op, label) => {
    const at = op.getStart(sf);
    const ins = [];
    if (!WS.test(text[at - 1])) ins.push([at, ' ']);
    if (!WS.test(text[op.end])) ins.push([op.end, ' ']);
    if (ins.length) say(at, `\`${label}\` without a space on each side`, ins);
  };
  // The first `ch` between two offsets, outside comments; -1 when there is none.
  const charBetween = (from, to, ch) => {
    const s = text.slice(from, to).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
    const i = s.indexOf(ch);
    return i < 0 ? -1 : from + i;
  };
  // A separator (`,` or `:`) followed by whitespace.
  const spacedAfter = (from, to, ch, what) => {
    const at = charBetween(from, to, ch);
    if (at >= 0 && !WS.test(text[at + 1])) say(at, what, [[at + 1, ' ']]);
  };
  const commas = (items) => {
    for (let i = 1; i < items.length; i++) spacedAfter(items[i - 1].end, items[i].getStart(sf), ',', 'a comma without a space after it');
  };

  // Statements that start and end on one line, by line, and how deeply blocks on that line nest.
  const lines = new Map();
  const count = (stmt, depth) => {
    const line = lineOf(stmt.getStart(sf));
    if (line !== lineOf(stmt.end - 1)) return;
    const seen = lines.get(line) ?? { all: new Set(), depth: 0 };
    seen.all.add(stmt);
    seen.depth = Math.max(seen.depth, depth);
    lines.set(line, seen);
  };
  const oneLine = (node) => lineOf(node.getStart(sf)) === lineOf(node.end - 1);

  const visit = (node) => {
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken;
      if (op.kind === ts.SyntaxKind.CommaToken) spacedAfter(op.getStart(sf), op.end, ',', 'a comma without a space after it');
      else spacedOp(op, ts.tokenToString(op.kind) ?? 'operator');
    } else if (ts.isConditionalExpression(node)) {
      spacedOp(node.questionToken, '?');
      spacedOp(node.colonToken, ':');
    } else if (ts.isArrowFunction(node)) {
      spacedOp(node.equalsGreaterThanToken, '=>');
    } else if (ts.isPropertyAssignment(node)) {
      spacedAfter(node.name.end, node.initializer.getStart(sf), ':', 'a `:` without a space after it');
    }
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) && node.type) {
      spacedAfter((node.questionToken ?? node.exclamationToken ?? node.name).end, node.type.getStart(sf), ':', 'a `:` without a space after it');
    }
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isPropertyDeclaration(node) || ts.isBindingElement(node)) && node.initializer) {
      const before = node.type ?? node.exclamationToken ?? node.questionToken ?? node.name;
      const at = charBetween(before.end, node.initializer.getStart(sf), '=');
      if (at >= 0) {
        const ins = [];
        if (!WS.test(text[at - 1])) ins.push([at, ' ']);
        if (!WS.test(text[at + 1])) ins.push([at + 1, ' ']);
        if (ins.length) say(at, '`=` without a space on each side', ins);
      }
    }
    // `{ a: 1 }`, `{ a; }`, `{ a, b }` on one line keep a space inside each brace; `{}` stays as it is.
    if ((ts.isObjectLiteralExpression(node) || ts.isBlock(node) || ts.isObjectBindingPattern(node) || ts.isNamedImports(node) || ts.isNamedExports(node)
      || ts.isTypeLiteralNode(node)) && oneLine(node)) {
      const open = node.getStart(sf);
      const close = node.end - 1;
      if (text[open] === '{' && text[close] === '}' && close > open + 1 && text.slice(open + 1, close).trim()) {
        const ins = [];
        if (!WS.test(text[open + 1])) ins.push([open + 1, ' ']);
        if (!WS.test(text[close - 1])) ins.push([close, ' ']);
        if (ins.length) say(open, 'a `{` or `}` without a space inside it', ins);
      }
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) commas(node.arguments ?? []);
    if (ts.isArrayLiteralExpression(node)) commas(node.elements.filter((e) => !ts.isOmittedExpression(e)));
    if (ts.isObjectLiteralExpression(node)) commas(node.properties);
    if (ts.isFunctionLike(node) && node.parameters) commas(node.parameters);
    if (ts.isVariableDeclarationList(node)) commas(node.declarations);
    if (ts.isIfStatement(node) || ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node)
      || ts.isWhileStatement(node) || ts.isSwitchStatement(node) || ts.isCatchClause(node)) {
      const at = node.getStart(sf);
      const word = /^(if|for|while|switch|catch)\(/.exec(text.slice(at, at + 7))?.[1];
      if (word) say(at, `\`${word}(\` without a space`, [[at + word.length, ' ']]);
      // `if (a)b;` and `for (...){`: the body starts after a space.
      const body = node.thenStatement ?? node.statement ?? node.caseBlock ?? node.block;
      const from = body?.getStart(sf);
      if (from !== undefined && text[from - 1] === ')') say(from, 'nothing between `)` and what it guards', [[from, ' ']]);
    }
    if (ts.isIfStatement(node) && node.elseStatement) {
      const from = node.elseStatement.getStart(sf);
      if (!WS.test(text[from - 1])) say(from, '`else` run into what follows it', [[from, ' ']]);
    }
    if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) {
      for (let i = 1; i < node.types.length; i++) {
        const at = charBetween(node.types[i - 1].end, node.types[i].getStart(sf), ts.isUnionTypeNode(node) ? '|' : '&');
        if (at < 0) continue;
        const ins = [];
        if (!WS.test(text[at - 1])) ins.push([at, ' ']);
        if (!WS.test(text[at + 1])) ins.push([at + 1, ' ']);
        if (ins.length) say(at, `\`${ts.isUnionTypeNode(node) ? '|' : '&'}\` without a space on each side`, ins);
      }
    }
    // A `;` that ends a statement or a `for (` clause is followed by a space, unless a `)` or the line's end comes next.
    if (ts.isForStatement(node)) {
      for (const part of [node.condition, node.incrementor]) {
        if (!part) continue;
        const from = part.getStart(sf);
        if (text[from - 1] === ';') say(from, 'a `;` without a space after it', [[from, ' ']]);
      }
    }
    if ((ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node) || ts.isCaseClause(node) || ts.isDefaultClause(node)) && node.statements) {
      for (let i = 1; i < node.statements.length; i++) {
        const from = node.statements[i].getStart(sf);
        if (!WS.test(text[from - 1]) && text[from - 1] !== '{' && text[from - 1] !== ':') say(from, 'two statements run together', [[from, ' ']]);
      }
    }
    if ((ts.isBlock(node) || ts.isModuleBlock(node)) && node.parent && (ts.isCatchClause(node.parent) || ts.isTryStatement(node.parent) || ts.isFunctionLike(node.parent))) {
      const at = node.getStart(sf);
      if (text[at - 1] === ')') say(at, 'nothing between `)` and `{`', [[at, ' ']]);
    }
    if (ts.isBlock(node) || ts.isModuleBlock(node) || ts.isCaseClause(node) || ts.isDefaultClause(node)) {
      // 1 for `{ a; b; }` on a line; 2 when a block on the same line holds it.
      let depth = 1;
      for (let p = node.parent; p && !ts.isSourceFile(p); p = p.parent) {
        if ((ts.isBlock(p) || ts.isModuleBlock(p)) && oneLine(p) && lineOf(p.getStart(sf)) === lineOf(node.getStart(sf))) depth++;
      }
      if (node.statements.length > 1 || depth > 1) for (const st of node.statements) count(st, depth);
    }
    if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node)) {
      for (let i = 1; i < node.statements.length; i++) {
        const a = node.statements[i - 1];
        const b = node.statements[i];
        if (oneLine(a) && lineOf(b.getStart(sf)) === lineOf(a.end - 1)) {
          count(a, 0);
          count(b, 0);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  for (const [line, seen] of lines) {
    if (seen.all.size > MAX_A_LINE) found.push({ line, what: `${seen.all.size} statements on one line`, split: line });
    else if (seen.depth > 1) found.push({ line, what: 'a block inside a block on one line', split: line });
  }
  return { found, sf };
}

/** Break a dense line at its statements: each statement and each block's braces on lines of their own, indented by depth. */
function splitLines(text, sf, lineNumbers) {
  const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const starts = sf.getLineStarts();
  // The file's own indent step: two spaces if any code line sits at an odd multiple of two, else four.
  const step = text.split('\n').some((l) => /^ *[^ *\r\n]/.test(l) && /^ */.exec(l)[0].length % 4 === 2) ? '  ' : '    ';
  const edits = [];
  for (const line of lineNumbers) {
    const from = starts[line - 1];
    const to = line < starts.length ? starts[line] - 1 : text.length;
    const on = (n) => lineOf(n.getStart(sf)) === line && lineOf(n.end - 1) === line;
    const cuts = new Set();
    const blocks = [];
    const walkLine = (node) => {
      if (node.end < from || node.getStart(sf) > to) return;
      const list = ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node) || ts.isCaseClause(node) || ts.isDefaultClause(node) ? node.statements : null;
      if ((ts.isBlock(node) || ts.isModuleBlock(node)) && on(node) && node.statements.length) {
        blocks.push([node.getStart(sf), node.end - 1]);
        cuts.add(node.getStart(sf) + 1);
        cuts.add(node.end - 1);
      }
      if (list) {
        for (let i = 1; i < list.length; i++) {
          if (on(list[i - 1]) && on(list[i])) cuts.add(list[i].getStart(sf));
        }
      }
      ts.forEachChild(node, walkLine);
    };
    walkLine(sf);
    const sorted = [...cuts].filter((c) => c > from && c < to).sort((a, b) => a - b);
    if (!sorted.length) continue;
    const src = text.slice(from, to);
    const indent = /^\s*/.exec(src)[0];
    const pieces = [];
    let prev = from;
    for (const c of [...sorted, to]) {
      const piece = text.slice(prev, c).trim();
      if (piece) {
        const depth = blocks.filter(([open, close]) => open < prev && prev < close).length;
        pieces.push(indent + step.repeat(depth) + piece);
      }
      prev = c;
    }
    edits.push([from, to, pieces.join('\n')]);
  }
  edits.sort((a, b) => b[0] - a[0]);
  for (const [from, to, repl] of edits) text = text.slice(0, from) + repl + text.slice(to);
  return text;
}

function fix(file) {
  let text = readFileSync(file, 'utf8');
  const original = text;
  for (let round = 0; round < 8; round++) {
    const { found, sf } = inspect(file, text);
    const ins = new Map();
    for (const f of found) for (const [at, s] of f.ins ?? []) ins.set(at, s);
    if (ins.size) {
      for (const at of [...ins.keys()].sort((a, b) => b - a)) text = text.slice(0, at) + ins.get(at) + text.slice(at);
      continue;
    }
    const dense = [...new Set(found.filter((f) => f.split).map((f) => f.split))];
    if (!dense.length) break;
    const next = splitLines(text, sf, dense);
    if (next === text) break;
    text = next;
  }
  if (text !== original) writeFileSync(file, text);
  return text !== original;
}

const files = [];
if (named.length) files.push(...named.map((f) => path.resolve(f)));
else for (const r of ROOTS) walk(path.join(ROOT, r), files);

if (FIX) {
  let changed = 0;
  for (const f of files) if (fix(f)) changed++;
  console.log(`check-code-spacing --fix: ${changed} file(s) rewritten.`);
}

let total = 0;
const byFile = [];
for (const f of files) {
  const { found } = inspect(f, readFileSync(f, 'utf8'));
  if (!found.length) continue;
  total += found.length;
  byFile.push([path.relative(ROOT, f).replace(/\\/g, '/'), found.sort((a, b) => a.line - b.line)]);
}
if (total === 0) {
  console.log(`check-code-spacing: ${files.length} file(s), spaced, and no line holds a program.`);
  process.exit(0);
}
byFile.sort((a, b) => b[1].length - a[1].length);
for (const [f, found] of byFile) {
  console.error(`${f}  (${found.length})`);
  for (const x of LIST ? found : found.slice(0, 3)) console.error(`  ${f}:${x.line}  ${x.what}`);
}
console.error(`check-code-spacing: ${total} finding(s) in ${byFile.length} file(s). Space operators, commas and \`if (\`; at most ${MAX_A_LINE} statements and one level of block a line. \`--fix\` does it.`);
process.exit(1);

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Who writes through a READ path — every place this repo mutates a value
 *        it obtained from `world.get` / `world.tryGet`, or from an unwrapped
 *        `Query(C)` row.
 *
 * `tools/mutation-contract.mjs` proves those writes really land and are never
 * observed. This asks the other half of the question: what would it cost to
 * make them illegal? A read surface cannot be typed read-only on the strength
 * of the defect alone — the answer depends on how much code writes that way.
 *
 * Syntactic, by AST, with no type checker. A checker would need one program per
 * root across the editor submodule boundary, and the shapes that matter are
 * decidable without one: `World.get` takes TWO arguments where `Map.get` takes
 * one, and a query row is reached through the system parameter it was declared
 * on. What that trades away is stated in BLIND_SPOTS and printed with the
 * result, because a census whose limits are unstated reads as an all-clear.
 *
 *   node tools/mutation-census.mjs
 *   node tools/mutation-census.mjs --json
 *   node tools/mutation-census.mjs --self-test   # calibrate on known-positive source
 *
 * Exit codes: 0 the census ran, 2 a declared root could not be read (an
 * unchecked-out editor submodule scans as zero findings, which is a false
 * all-clear, not a clean repo).
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { listTrackedSources, hasEditor } from './lib/sourceRoots.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ts = createRequire(path.join(ROOT, 'sdk', '/'))('typescript');
const JSON_OUT = process.argv.includes('--json');
const SELF_TEST = process.argv.includes('--self-test');

/** Where a game or the engine could write through a read handle. */
const ROOTS = ['sdk/src', 'sdk/tests', 'examples', 'desktop/src'];

/**
 * Files that MUST be excluded: each one deliberately performs the mutation
 * being counted, so a census including them reports its own fixtures as
 * findings. (A gate reading source has to exclude itself; this repo has been
 * caught by that before.)
 */
const EXCLUDED = new Set([
    'tools/mutation-census.mjs',
    'tools/mutation-contract.mjs',
    'bench/replication-dirty/completeness.mjs',
]);

const BLIND_SPOTS = [
    'a handle passed to another function, then written there (counted as `escapes`, not as a write)',
    'a write through a computed key whose value is not a literal',
    'reflection paths (setByPath and friends) that reach a component by string',
    'a row reached by `single()` / `toArray()` destructured across statements',
];

const unwrap = (n) => {
    while (n && (ts.isNonNullExpression(n) || ts.isParenthesizedExpression(n)
        || ts.isAsExpression(n) || ts.isTypeAssertionExpression?.(n))) n = n.expression;
    return n;
};

/** The expression an access chain bottoms out in: `a!.b.c` → `a`, `f(x).y` → `f(x)`. */
function accessRoot(node) {
    let n = unwrap(node);
    while (n && (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n))) {
        n = unwrap(n.expression);
    }
    return n;
}

/**
 * `get` / `tryGet` with TWO arguments — the World signature. `Map.get` takes
 * one, which is what keeps this from drowning in false positives without a
 * checker; a two-argument `.get` on something else is rare enough to be worth
 * reporting and reading.
 */
function worldReadKind(node) {
    const call = unwrap(node);
    if (!call || !ts.isCallExpression(call)) return null;
    const callee = unwrap(call.expression);
    if (!callee || !ts.isPropertyAccessExpression(callee)) return null;
    const name = callee.name.text;
    if (name !== 'get' && name !== 'tryGet') return null;
    if (call.arguments.length !== 2) return null;
    return name;
}

const MUTATING_METHODS = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin']);

/** The nearest enclosing scope a local binding cannot outlive. */
function scopeOf(node) {
    let n = node;
    while (n && !ts.isSourceFile(n) && !ts.isFunctionDeclaration(n) && !ts.isFunctionExpression(n)
        && !ts.isArrowFunction(n) && !ts.isMethodDeclaration(n) && !ts.isConstructorDeclaration(n)
        && !ts.isGetAccessorDeclaration(n) && !ts.isSetAccessorDeclaration(n)) n = n.parent;
    return n;
}

function within(node, scope) {
    for (let n = node; n; n = n.parent) if (n === scope) return true;
    return false;
}

/** Every `Query(...)` argument that is NOT wrapped in `Mut(...)`, by position. */
function queryMutFlags(call) {
    return call.arguments.map((a) => {
        const arg = unwrap(a);
        return ts.isCallExpression(arg) && ts.isIdentifier(unwrap(arg.expression))
            && unwrap(arg.expression).text === 'Mut';
    });
}

function scanFile(rel, text) {
    const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true,
        /\.(tsx|jsx)$/.test(rel) ? ts.ScriptKind.TSX : undefined);
    const findings = [];
    const at = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

    // Bindings that hold a value obtained from a read path, and everything
    // derived from them by property access — `const p = c.inner` keeps p live.
    const tracked = [];
    const isTracked = (node) => {
        const r = accessRoot(node);
        if (!r) return null;
        if (worldReadKind(r)) return { origin: worldReadKind(r), direct: true };
        if (!ts.isIdentifier(r)) return null;
        const hit = tracked.find((t) => t.name === r.text && within(node, t.scope));
        return hit ? { origin: hit.origin, direct: false } : null;
    };

    const collectBindings = () => {
        const visit = (node) => {
            if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
                const init = unwrap(node.initializer);
                const kind = worldReadKind(init) ?? (isTracked(init)?.origin ?? null);
                if (kind && !tracked.some((t) => t.name === node.name.text && t.scope === scopeOf(node))) {
                    // `const p = c.position` is handed back to the World as `c`,
                    // never as `p`. Carrying the chain's ROOT binding is what lets
                    // a write-back through the parent be recognised as one.
                    const parent = accessRoot(init);
                    const via = ts.isIdentifier(parent)
                        ? tracked.find((t) => t.name === parent.text && within(node, t.scope))
                        : null;
                    tracked.push({
                        name: node.name.text, scope: scopeOf(node), origin: kind,
                        root: via?.root ?? via?.name ?? node.name.text,
                    });
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sf);
    };
    // Twice, so one level of `const a = read(); const b = a.inner;` settles.
    collectBindings();
    collectBindings();

    // Query rows the system declared read-only.
    const readonlyRows = [];
    const visitQueries = (node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(unwrap(node.expression))
            && unwrap(node.expression).text === 'Query') {
            const flags = queryMutFlags(node);
            const arrayLit = node.parent;
            if (ts.isArrayLiteralExpression(arrayLit) && ts.isCallExpression(arrayLit.parent)) {
                const idx = arrayLit.elements.indexOf(node);
                const fn = arrayLit.parent.arguments.find((a) =>
                    ts.isArrowFunction(unwrap(a)) || ts.isFunctionExpression(unwrap(a)));
                const param = fn && unwrap(fn).parameters[idx];
                if (param && ts.isIdentifier(param.name)) {
                    readonlyRows.push({ paramName: param.name.text, scope: unwrap(fn), flags });
                }
            }
        }
        ts.forEachChild(node, visitQueries);
    };
    visitQueries(sf);

    // A row binding is read-only when its Query slot was not wrapped in Mut.
    const rowBindings = [];
    for (const row of readonlyRows) {
        const visit = (node) => {
            // for (const [entity, a, b] of query)
            if (ts.isForOfStatement(node) && ts.isIdentifier(unwrap(node.expression))
                && unwrap(node.expression).text === row.paramName) {
                const decl = node.initializer;
                const binding = ts.isVariableDeclarationList(decl) ? decl.declarations[0]?.name : null;
                if (binding && ts.isArrayBindingPattern(binding)) {
                    binding.elements.forEach((el, j) => {
                        if (j === 0 || !ts.isBindingElement(el) || !ts.isIdentifier(el.name)) return;
                        if (row.flags[j - 1] === false) {
                            rowBindings.push({ name: el.name.text, scope: node });
                        }
                    });
                }
            }
            // query.forEach((entity, a, b) => ...)
            if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
                && node.expression.name.text === 'forEach'
                && ts.isIdentifier(unwrap(node.expression.expression))
                && unwrap(node.expression.expression).text === row.paramName) {
                const cb = unwrap(node.arguments[0]);
                if (cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb))) {
                    cb.parameters.forEach((p, j) => {
                        if (j === 0 || !ts.isIdentifier(p.name)) return;
                        if (row.flags[j - 1] === false) rowBindings.push({ name: p.name.text, scope: cb });
                    });
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(row.scope);
    }

    const isRow = (node) => {
        const r = accessRoot(node);
        if (!r || !ts.isIdentifier(r)) return false;
        return rowBindings.some((b) => b.name === r.text && within(node, b.scope));
    };

    const written = new Set();
    /**
     * Whether the handle rooted at `node` is handed back to the World in the same
     * scope. The distinction the census turns on: read-modify-write-back is legal
     * today and reports normally, the same edit without the write-back is the
     * silent write, and counting them together misprices the migration.
     */
    const storesBack = (node) => {
        const r = accessRoot(node);
        if (!r || !ts.isIdentifier(r)) return false;
        const hit = tracked.find((t) => t.name === r.text && within(node, t.scope))
            ?? rowBindings.find((b) => b.name === r.text && within(node, b.scope));
        if (!hit) return false;
        const names = new Set([r.text, hit.root].filter(Boolean));
        let found = false;
        const look = (n) => {
            if (found) return;
            if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
                const m = n.expression.name.text;
                if (m === 'set' || m === 'insert') {
                    if (n.arguments.some((a) => {
                        const u = unwrap(a);
                        return ts.isIdentifier(u) && names.has(u.text);
                    })) found = true;
                } else if (m === 'markChanged') found = true;
            }
            ts.forEachChild(n, look);
        };
        look(hit.scope);
        return found;
    };

    const record = (node, category, origin, target = node) => {
        written.add(node);
        findings.push({
            file: rel, line: at(node), category, origin,
            storedBack: storesBack(target),
            code: node.getText(sf).replace(/\s+/g, ' ').slice(0, 100),
        });
    };

    const visitWrites = (node) => {
        if (ts.isBinaryExpression(node)
            && (node.operatorToken.kind === ts.SyntaxKind.EqualsToken
                || (node.operatorToken.kind >= ts.SyntaxKind.FirstCompoundAssignment
                    && node.operatorToken.kind <= ts.SyntaxKind.LastCompoundAssignment))) {
            const lhs = unwrap(node.left);
            if (ts.isPropertyAccessExpression(lhs) || ts.isElementAccessExpression(lhs)) {
                const t = isTracked(lhs);
                if (t) record(node, t.direct ? 'direct-write' : 'alias-write', t.origin, lhs);
                else if (isRow(lhs)) record(node, 'row-write', 'bare Query', lhs);
            }
        }
        if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
            && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) {
            const op = unwrap(node.operand);
            if (ts.isPropertyAccessExpression(op) || ts.isElementAccessExpression(op)) {
                const t = isTracked(op);
                if (t) record(node, t.direct ? 'direct-write' : 'alias-write', t.origin, op);
                else if (isRow(op)) record(node, 'row-write', 'bare Query', op);
            }
        }
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
            const method = node.expression.name.text;
            const recv = node.expression.expression;
            if (MUTATING_METHODS.has(method)) {
                const t = isTracked(recv);
                if (t) record(node, 'method-write', t.origin, recv);
                else if (isRow(recv)) record(node, 'method-write', 'bare Query', recv);
            }
            if (method === 'assign' && ts.isIdentifier(unwrap(recv)) && unwrap(recv).text === 'Object') {
                const target = node.arguments[0];
                if (target) {
                    const t = isTracked(target);
                    if (t) record(node, 'assign-write', t.origin, target);
                    else if (isRow(target)) record(node, 'assign-write', 'bare Query', target);
                }
            }
        }
        // A handle handed to someone else — not counted as a write, counted as
        // a place this census stops being able to see.
        if (ts.isCallExpression(node) && !written.has(node)) {
            for (const arg of node.arguments) {
                const a = unwrap(arg);
                if (!ts.isIdentifier(a)) continue;
                const callee = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : '';
                if (callee === 'set' || callee === 'insert') continue;
                const hit = tracked.find((t) => t.name === a.text && within(node, t.scope));
                if (hit && !ts.isPropertyAccessExpression(node.expression)) {
                    record(node, 'escapes', hit.origin);
                } else if (hit && ts.isPropertyAccessExpression(node.expression)
                    && !MUTATING_METHODS.has(node.expression.name.text)) {
                    record(node, 'escapes', hit.origin);
                }
            }
        }
        ts.forEachChild(node, visitWrites);
    };
    visitWrites(sf);
    return findings;
}

// --- calibration ------------------------------------------------------------

/**
 * The census is only believable if it is known to fire. Every shape it claims
 * to detect is written out here and asserted, so a refactor that silently stops
 * matching reports zero findings and FAILS instead of reading as a clean repo.
 */
const CALIBRATION = `
    import { Query, Mut, defineSystem } from 'estella';
    function a(world, e, C) { world.get(e, C).v = 1; }
    function b(world, e, C) { world.tryGet(e, C).v = 1; }
    function c(world, e, C) { const h = world.get(e, C); h.v += 1; }
    function d(world, e, C) { const h = world.tryGet(e, C); const p = h.inner; p.x = 1; }
    function f(world, e, C) { const h = world.get(e, C); h.list.push(1); }
    function g(world, e, C) { const h = world.get(e, C); Object.assign(h, { v: 1 }); }
    function h2(world, e, C) { const h = world.get(e, C); helper(h); }
    const s = defineSystem([Query(Mut(A), B)], (q) => {
        for (const [entity, ok, bad] of q) { ok.v = 1; bad.v = 1; }
    });
    const s2 = defineSystem([Query(B)], (q) => { q.forEach((entity, bad) => { bad.v = 1; }); });
    function noise(map, k) { map.get(k).v = 1; }
    function stored(world, e, C) { const h = world.get(e, C); h.v = 1; world.set(e, C, h); }
    function silent(world, e, C) { const h = world.get(e, C); h.v = 1; }
    function viaChild(world, e, C) { const h = world.tryGet(e, C); const p = h.position; p.x = 1; world.set(e, C, h); }
`;

if (SELF_TEST) {
    const got = scanFile('calibration.ts', CALIBRATION);
    const count = (c) => got.filter((f) => f.category === c).length;
    const expected = {
        'direct-write': 2, 'alias-write': 5, 'method-write': 1,
        'assign-write': 1, 'escapes': 1, 'row-write': 2,
    };
    let bad = 0;
    for (const [cat, n] of Object.entries(expected)) {
        const actual = count(cat);
        const ok = actual === n;
        if (!ok) bad++;
        console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${cat.padEnd(13)} expected ${n}, got ${actual}`);
    }
    // The distinction the migration estimate rests on: read-modify-WRITE-BACK
    // reports, the same edit without the write-back does not.
    const inFn = (name) => got.filter((f) => CALIBRATION.split('\n')
        .findIndex((l) => l.includes(`function ${name}(`)) + 1 === f.line);
    for (const [fn, want] of [['stored', true], ['silent', false], ['viaChild', true]]) {
        const hits = inFn(fn).filter((f) => f.category === 'alias-write');
        const ok = hits.length === 1 && hits[0].storedBack === want;
        if (!ok) bad++;
        console.log(`  ${ok ? 'ok  ' : 'FAIL'}  storedBack   ${fn}(): expected ${want}, got ${hits.map((h) => h.storedBack).join(',') || 'no finding'}`);
    }
    const rows = got.filter((f) => f.category === 'row-write').map((f) => f.code);
    console.log(`  row-writes seen: ${JSON.stringify(rows)}`);
    if (!rows.every((r) => r.startsWith('bad'))) {
        console.log('  FAIL  a Mut()-declared row was counted as read-only');
        bad++;
    }
    process.exit(bad === 0 ? 0 : 1);
}

// --- the run ----------------------------------------------------------------

const declaredRoots = ROOTS.filter((r) => !r.startsWith('desktop/') || hasEditor());
const skippedRoots = ROOTS.filter((r) => !declaredRoots.includes(r));
const { files, missing } = listTrackedSources(declaredRoots);
const sources = files.filter((f) => /\.(ts|tsx|js|mjs|jsx)$/.test(f) && !EXCLUDED.has(f) && !f.endsWith('.d.ts'));

const findings = [];
for (const rel of sources) {
    const full = path.join(ROOT, rel);
    if (!existsSync(full)) continue;
    try {
        findings.push(...scanFile(rel, readFileSync(full, 'utf8')));
    } catch (e) {
        findings.push({ file: rel, line: 0, category: 'unparsed', origin: '', code: String(e.message).slice(0, 80) });
    }
}

const writes = findings.filter((f) => f.category !== 'escapes' && f.category !== 'unparsed');
const byRoot = (rel) => ROOTS.find((r) => rel.startsWith(r + '/')) ?? rel;

if (JSON_OUT) {
    console.log(JSON.stringify({ scanned: sources.length, findings, skippedRoots, missing }, null, 2));
} else {
    console.log('');
    console.log(`  ${sources.length} files scanned across ${declaredRoots.join(', ')}`);
    if (skippedRoots.length) console.log(`  NOT scanned (no checkout): ${skippedRoots.join(', ')}`);
    if (missing.length) console.log(`  NOT scanned (root missing): ${missing.join(', ')}`);
    console.log('');
    const cats = [...new Set(findings.map((f) => f.category))].sort();
    for (const cat of cats) {
        const hits = findings.filter((f) => f.category === cat);
        const silent = hits.filter((f) => f.storedBack === false).length;
        const suffix = cat === 'escapes' || cat === 'unparsed' ? ''
            : ` (${hits.length - silent} stored back, ${silent} SILENT)`;
        console.log(`  ${cat} — ${hits.length}${suffix}`);
        const roots = [...new Set(hits.map((h) => byRoot(h.file)))];
        for (const r of roots) {
            const inRoot = hits.filter((h) => byRoot(h.file) === r);
            console.log(`      ${r}: ${inRoot.length}`);
            for (const h of inRoot.slice(0, 12)) {
                const isWrite = h.category !== 'escapes' && h.category !== 'unparsed';
                const tag = !isWrite ? '' : h.storedBack ? '[stored] ' : '[SILENT] ';
                console.log(`        ${h.file}:${h.line}  ${tag}${h.code}`);
            }
            if (inRoot.length > 12) console.log(`        … ${inRoot.length - 12} more`);
        }
    }
    console.log('');
    const silentWrites = writes.filter((f) => f.storedBack === false);
    console.log(`  ${writes.length} writes through a read handle.`);
    console.log(`  ${writes.length - silentWrites.length} are read-modify-write-back and report normally today.`);
    console.log(`  ${silentWrites.length} are SILENT — the value changes and nothing observes it.`);
    console.log(`  ${findings.filter((f) => f.category === 'escapes').length} handles escape this census.`);
    console.log('');
    console.log('  Not decidable by this census:');
    for (const b of BLIND_SPOTS) console.log(`    - ${b}`);
    console.log('');
}

process.exit(skippedRoots.length || missing.length ? 2 : 0);

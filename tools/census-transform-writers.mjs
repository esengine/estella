// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  census-transform-writers.mjs — who can move a Transform, and how each
 *        one says so.
 *
 * A composed world transform is a function of `position`, `rotation`, `scale` and
 * the hierarchy, and it is recomposed on a staleness epoch: a producer that
 * writes those and announces nothing is invisible, and the world answers every
 * later question with the answer it gave first.
 *
 * So the scan is not a count. Each write site is one of: a seam that announces,
 * or a private world that composes its own registry in place. A site that is
 * neither is a producer nobody classified, and `--gate` refuses it — the count
 * moves with any honest refactor, but "there is a writer with no seam" does not.
 *
 * An approval is per (file, function) and is checked against the code, so a
 * declared seam that stopped announcing, and one that no longer writes anything,
 * both go red as well.
 *
 *   node tools/census-transform-writers.mjs          report
 *   node tools/census-transform-writers.mjs --gate   exit 1 on an unclassified writer
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTrackedSources } from './lib/sourceRoots.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GATE = process.argv.includes('--gate');

/** The call that says the composition's inputs moved. */
const SEAM_CALL = 'invalidateTransformComposition';

/**
 * Every C++ writer of a Transform's local inputs, and on what ground it is
 * allowed to be one. `announces` means the subsystem calls the seam — once per
 * pass, not once per field, which is why the call may sit in a different function
 * of the same file than the write does.
 */
const SEAMS = [
    {
        file: 'src/esengine/animation/TweenSystem.cpp', fn: 'applyTweenValue', role: 'announces',
        why: 'once per applied value, colour targets included: a recompose that changes nothing is cheaper than a missed one',
    },
    {
        file: 'src/esengine/ui/UILayoutSystem.cpp', fn: 'layoutUINodeSubtree', role: 'announces',
        why: 'the layout pass announces once for every node it will place',
    },
    {
        file: 'src/esengine/ui/UILayoutSystem.cpp', fn: 'placeScreenRoots', role: 'announces',
        why: 'same pass, same single announcement',
    },
    {
        file: 'src/esengine/bindings/RendererBindings.cpp', fn: 'registry_batchSyncPhysicsTransforms', role: 'announces',
        why: 'once per batch; it also writes the world fields itself, which is a second AUTHORSHIP of the output and a separate question',
    },
    {
        file: 'src/esengine/bindings/RendererBindings.cpp', fn: 'renderer_renderMeshPreview', role: 'private world',
        why: 'builds its own Registry and composes it in place, so nothing outside the call can read a stale value',
    },
    {
        file: 'src/esengine/bindings/EditorAPI.generated.cpp', fn: 'editor_setFloat', role: 'announces',
        why: 'emitted from WRITE_HOOKS; check-transform-seam holds which arms get it',
    },
];

/** The hierarchy is the composition's other input, and one function writes it. */
const HIERARCHY_WRITER = { file: 'src/esengine/ecs/TransformSystem.hpp', fn: 'setParent' };

/**
 * The TS producers, which write the component heap through a pointer setter and
 * call no C++ at all — invisible to any scan of these sources. They reach the
 * same epoch through `recordComponentWrite_`, and sdk/tests/world-transform-
 * authority.test.ts is what holds them to it.
 */
const TS_PRODUCERS = [
    ['world.set / insert / update', 'ptr setter → wasm heap'],
    ['Query(Mut(Transform)) write-back', 'ptr setter → wasm heap'],
    ['Web AOT Mut(Transform)', 'compiled code → component address'],
    ['Native AOT Mut(Transform)', 'compiled code → component address'],
];

const FIELDS = String.raw`(position|rotation|scale)`;
/** A write to a local field through something typed `Transform`. */
const WRITE = new RegExp(String.raw`\b(\w+)\s*(?:\.|->)\s*${FIELDS}\s*(?:\.\w+\s*)?=[^=]`);
const OUTPUT = /world(Position|Rotation|Scale)|cachedMatrix_|decomposed_/;
/** Doc comments show the API; they do not write it. */
const COMMENT = /^\s*(\*|\/\/)/;
/**
 * The nearest preceding definition at column zero. A subsystem announces once per
 * pass, so the unit an approval is granted to is the function a reader would
 * name — not the lambda or the `if` the write happens to sit inside.
 */
const DEFINITION = /^[A-Za-z_][\w:<>&*,\s]*?\b([A-Za-z_]\w*)\s*\(/;
const NOT_A_DEFINITION = /^(if|for|while|switch|return|else|catch|do)\b/;

function enclosing(lines, at) {
    for (let i = at; i >= 0; i--) {
        if (NOT_A_DEFINITION.test(lines[i])) continue;
        const m = DEFINITION.exec(lines[i]);
        if (m) return { fn: m[1], start: i };
    }
    return { fn: '(file scope)', start: 0 };
}

/** Where `fn`'s body ends: the next definition at column zero. */
function bodyOf(lines, start) {
    for (let i = start + 1; i < lines.length; i++) {
        if (!NOT_A_DEFINITION.test(lines[i]) && DEFINITION.test(lines[i])) return lines.slice(start, i).join('\n');
    }
    return lines.slice(start).join('\n');
}

/**
 * The block that bound a name to a Transform. Scoped, because one generated
 * dispatcher binds `c` to every component in the engine, each inside its own arm.
 */
function depths(lines) {
    const out = [];
    let depth = 0;
    for (const line of lines) {
        out.push(depth);
        for (const ch of line.replace(/\/\/.*$/, '')) {
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
        }
    }
    return out;
}

const { files, missing } = listTrackedSources(['src']);
const cpp = files.filter((f) => /\.(cpp|hpp)$/.test(f));

const hits = [];
const bodies = new Map();
for (const rel of cpp) {
    const lines = readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
    const depth = depths(lines);
    const bound = [];
    lines.forEach((line, i) => {
        while (bound.length && bound[bound.length - 1].depth > depth[i]) bound.pop();
        const b = /\b(\w+)\s*=\s*[^;]*\b(?:get|tryGet|emplace|emplaceOrReplace)<(?:[\w:]*::)?Transform>/.exec(line)
            ?? /(?:[\w:]*::)?Transform&\s+(\w+)\s*[=)]/.exec(line)
            ?? /(?:[\w:]*::)?Transform\*\s+(\w+)\s*=/.exec(line);
        if (b) bound.push({ name: b[1], depth: depth[i] });
        if (OUTPUT.test(line) || COMMENT.test(line)) return;
        const m = WRITE.exec(line);
        if (!m || !bound.some((x) => x.name === m[1])) return;
        const { fn, start } = enclosing(lines, i);
        if (!bodies.has(`${rel}#${fn}`)) bodies.set(`${rel}#${fn}`, bodyOf(lines, start));
        hits.push({ file: rel, line: i + 1, fn, code: line.trim().slice(0, 78) });
    });
}

const errors = [];
const seamOf = (h) => SEAMS.find((s) => s.file === h.file && s.fn === h.fn);
for (const h of hits) {
    if (!seamOf(h)) {
        errors.push(`${h.file}:${h.line} — ${h.fn}() writes a Transform input and is not a declared seam`);
    }
}
for (const seam of SEAMS) {
    const mine = hits.filter((h) => h.file === seam.file && h.fn === seam.fn);
    if (mine.length === 0) {
        errors.push(`${seam.file} — ${seam.fn}() is approved as a writer and no longer writes anything`);
        continue;
    }
    const text = missing.some((m) => seam.file.startsWith(m)) ? null : readFileSync(path.join(ROOT, seam.file), 'utf8');
    if (seam.role === 'announces' && text && !text.includes(`${SEAM_CALL}(`)) {
        errors.push(`${seam.file} — ${seam.fn}() writes Transform inputs and its file never calls ${SEAM_CALL}()`);
    }
    if (seam.role === 'private world') {
        const body = bodies.get(`${seam.file}#${seam.fn}`) ?? '';
        // The claim is that nothing outside can read a stale value, which holds
        // only while the registry is the function's own AND it composes it.
        if (!/\bRegistry\s+\w+\s*;/.test(body) || !/TransformSystem|->update\(/.test(body)) {
            errors.push(`${seam.file} — ${seam.fn}() is approved as a private world, but does not build a Registry and compose it`);
        }
    }
}
{
    const text = readFileSync(path.join(ROOT, HIERARCHY_WRITER.file), 'utf8');
    const i = text.split('\n').findIndex((l) => l.includes(`${HIERARCHY_WRITER.fn}(`) && l.includes('Registry&'));
    const body = i < 0 ? '' : bodyOf(text.split('\n'), i);
    if (!body.includes(`${SEAM_CALL}(`)) {
        errors.push(`${HIERARCHY_WRITER.file} — ${HIERARCHY_WRITER.fn}() moves a subtree without announcing it`);
    }
}

const say = (s = '') => console.log(s);
say('');
say('Producers of a Transform\'s composition inputs');
say('');
const w = Math.max(...SEAMS.map((s) => s.fn.length), ...TS_PRODUCERS.map((p) => p[0].length));
for (const seam of SEAMS) {
    const n = hits.filter((h) => h.file === seam.file && h.fn === seam.fn).length;
    say(`  ${seam.fn.padEnd(w)}  ${String(n).padStart(2)} write(s)  ${seam.role}`);
    say(`  ${' '.repeat(w)}  ${seam.file}`);
    say(`  ${' '.repeat(w)}  ${seam.why}`);
    say('');
}
say(`  ${HIERARCHY_WRITER.fn.padEnd(w)}   hierarchy  announces`);
say(`  ${' '.repeat(w)}  ${HIERARCHY_WRITER.file}`);
say(`  ${' '.repeat(w)}  a reparent moves a subtree without touching one transform field`);
say('');
say('  From TypeScript, through a pointer setter that calls no C++:');
for (const [who, how] of TS_PRODUCERS) say(`    ${who.padEnd(w)}  ${how}`);
say('');
say(`  ${hits.length} C++ write site(s) across ${cpp.length} scanned file(s).`);
if (missing.length) say(`  NOT scanned: ${missing.join(', ')}`);
say('');

if (errors.length) {
    console.error('Writers with no seam:\n');
    for (const e of errors) console.error(`  ${e}`);
    console.error('\nA new producer needs an entry in SEAMS saying how the composition learns of it.');
    console.error(`Either call ${SEAM_CALL}() once per pass, or compose the registry you wrote in place.`);
    if (GATE) process.exit(1);
} else if (GATE) {
    console.log(`transform writers OK: ${hits.length} write site(s), every one under a declared seam.`);
}

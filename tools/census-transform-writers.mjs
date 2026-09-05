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

/**
 * Who may write the composition's OUTPUT. A second author is invisible to
 * anything fed by what the composition reports: a spatial index built on the
 * composed delta would not contain one physics-driven entity.
 */
const OUTPUT_AUTHORS = new Map([
    ['src/esengine/ecs/TransformSystem.hpp', 'the canonical composer'],
    ['src/esengine/ecs/components/Transform.hpp', '`ensureDecomposed`, the composer\'s own lazy half'],
]);
const OUTPUT_FIELDS = ['worldPosition', 'worldRotation', 'worldScale', 'cachedMatrix_', 'decomposed_'];
/** A write to one, through anything or through nothing. No binding heuristic:
 *  a struct with these field names IS a Transform, and the point is to leave no
 *  spelling of the write that the scan does not see. */
const OUTPUT_WRITE = new RegExp(String.raw`(?:(?:\.|->)\s*|^\s*)(${OUTPUT_FIELDS.join('|')})\s*(?:\.\w+\s*)?=[^=]`);

/**
 * The seam has to exist on BOTH cores. A producer announces by storing into the
 * epoch, so a core that does not hand that word over turns every announcement
 * into a no-op — nothing recomposes, and the only symptom is a world that stops
 * moving. Each entry: what the SDK asks for, and where that core answers it.
 */
const SEAM_SURFACES = [
    { core: 'web (embind)', asks: 'sdk/src/wasm.ts', answers: 'src/esengine/bindings/WebSDKEntry.cpp',
      names: ['transform_epochAddress', 'transform_ensureComposed'] },
    { core: 'native (QuickJS)', asks: 'sdk/src/ecs/bridge/nativeBindings.ts',
      answers: 'native/host/bindings/EcsBindings.cpp',
      names: ['es_transformEpochBuffer', 'es_transformEnsureComposed'] },
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
    // Deliberately outside recordComponentWrite_: it rewrites every dynamic body
    // every step, so reporting Changed(Transform) would drown that signal. It
    // announces staleness directly instead.
    ['2D physics writeback', 'resolved Transform pointer, by word index'],
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

const { files, missing } = listTrackedSources(['src', 'sdk/src']);
const cpp = files.filter((f) => /\.(cpp|hpp)$/.test(f));

/**
 * The composed output's word range in the Transform pointer layout, read from
 * the generated table rather than counted here: a TS producer writes those slots
 * by index, and a number in this file would be the one that went stale.
 */
function composedOutputWords() {
    const text = readFileSync(path.join(ROOT, 'sdk/src/wasm/ptrLayouts.generated.ts'), 'utf8');
    const block = /Transform:\s*\{[\s\S]*?fields:\s*\[([\s\S]*?)\]/.exec(text);
    if (!block) return null;
    const fields = [...block[1].matchAll(/name:\s*'(\w+)',\s*type:\s*'(\w+)',\s*offset:\s*(\d+)/g)]
        .map((m) => ({ name: m[1], words: { vec3: 3, quat: 4, f32: 1 }[m[2]] ?? 1, word: Number(m[3]) / 4 }));
    const out = fields.filter((f) => OUTPUT_FIELDS.includes(f.name));
    if (out.length === 0) return null;
    return new Set(out.flatMap((f) => Array.from({ length: f.words }, (_, i) => f.word + i)));
}

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
// ── Who writes the composition's OUTPUT ──
const outputWrites = [];
for (const rel of cpp) {
    if (OUTPUT_AUTHORS.has(rel)) continue;
    const lines = readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
    lines.forEach((line, i) => {
        if (COMMENT.test(line)) return;
        const m = OUTPUT_WRITE.exec(line);
        if (m) outputWrites.push({ file: rel, line: i + 1, field: m[1], code: line.trim().slice(0, 70) });
    });
}
for (const w of outputWrites) {
    errors.push(`${w.file}:${w.line} — writes ${w.field}, which only the composition may author`);
}
for (const [file] of OUTPUT_AUTHORS) {
    const text = missing.some((m) => file.startsWith(m)) ? null : readFileSync(path.join(ROOT, file), 'utf8');
    if (text && !OUTPUT_WRITE.test(text.split('\n').find((l) => OUTPUT_WRITE.test(l) && !COMMENT.test(l)) ?? '')) {
        errors.push(`${file} — declared as an author of the composed output and writes none of it`);
    }
}

// The TS producers reach the same fields by INDEX, through a resolved pointer:
// `engF32[fi + 10] = x` is a worldPosition write that no search for the name
// finds, and that is how the physics writeback stayed a second author.
const outputWords = composedOutputWords();
if (!outputWords) {
    errors.push('the Transform pointer layout no longer says where the composed output lives');
} else {
    const INDEXED = /\[\s*(\w+)\s*\+\s*(\d+)\s*\]\s*=[^=]/g;
    for (const rel of files.filter((f) => /^sdk\/src\/.*\.ts$/.test(f) && !f.includes('.generated.'))) {
        const text = readFileSync(path.join(ROOT, rel), 'utf8');
        if (!text.includes('getTransformPtr')) continue;
        text.split('\n').forEach((line, i) => {
            if (COMMENT.test(line)) return;
            for (const m of line.matchAll(INDEXED)) {
                if (outputWords.has(Number(m[2]))) {
                    errors.push(`${rel}:${i + 1} — writes word ${m[2]} of a Transform, which is composed output`);
                }
            }
        });
    }
}

for (const surface of SEAM_SURFACES) {
    for (const file of [surface.asks, surface.answers]) {
        if (missing.some((m) => file.startsWith(m))) continue;
        const text = readFileSync(path.join(ROOT, file), 'utf8');
        for (const name of surface.names) {
            if (!text.includes(name)) {
                errors.push(`${file} — the ${surface.core} core does not carry \`${name}\`, so a producer there announces into nothing`);
            }
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
say('  The seam both cores carry:');
for (const surface of SEAM_SURFACES) say(`    ${surface.core.padEnd(17)} ${surface.answers}`);
say('');
say('  The composition\'s OUTPUT has one author:');
for (const [file, why] of OUTPUT_AUTHORS) say(`    ${file}  —  ${why}`);
say('');
say('  From TypeScript, through a pointer setter that calls no C++:');
for (const [who, how] of TS_PRODUCERS) say(`    ${who.padEnd(w)}  ${how}`);
say('');
say(`  ${hits.length} C++ write site(s) across ${cpp.length} scanned file(s).`);
if (missing.length) say(`  NOT scanned: ${missing.join(', ')}`);
say('');

if (errors.length) {
    console.error('Transform authorship is not what it says:\n');
    for (const e of errors) console.error(`  ${e}`);
    console.error('\nAn INPUT writer needs an entry in SEAMS saying how the composition learns of it:');
    console.error(`call ${SEAM_CALL}() once per pass, or compose the registry you wrote in place.`);
    console.error('The OUTPUT has one author. Write the local fields and let the composition run.');
    if (GATE) process.exit(1);
} else if (GATE) {
    console.log(`transform writers OK: ${hits.length} write site(s), every one under a declared seam.`);
}

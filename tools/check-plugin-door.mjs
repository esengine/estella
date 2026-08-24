#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    check-plugin-door.mjs — a subsystem a game cannot add is a subsystem
 *          the engine has and the engine's users do not.
 * @details 3D physics shipped its components through the main entry, so a scene
 *          could hold a `RigidBody3D` and the runtime loader would quietly wire
 *          the world behind it. What never reached any entry was the door:
 *          `Physics3DPlugin`, the `Physics3D` queries resource, `Physics3DEvents`.
 *          A game could drop a body on the floor and had no way to cast a ray at
 *          it or hear it land — for four releases, with every gate green, because
 *          every gate asks what the surface IS and none asked what is MISSING.
 *
 *          So: every `implements Plugin` in the SDK is either exported from a
 *          public entry, or composed by a plugin that is. Those are the only two
 *          ways a game gets one. Anything else is a subsystem behind a wall.
 *
 *          Read off the TypeScript AST, not a regex over the text. The first
 *          version matched names anywhere in the source and called this reachable
 *          on the strength of `from '../physics3d/Physics3DPlugin'` — a module
 *          path in a file that imports something else entirely. An identifier is
 *          a use; a path and a doc comment are not, and only the parser knows
 *          which is which.
 *
 * Run: node tools/check-plugin-door.mjs   (exit 1 on a walled-off plugin)
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ETC, ENTRIES, ts } from './lib/sdkProgram.mjs';
import { parseSnapshot } from './lib/apiSnapshot.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'sdk', 'src');

const rel = (p) => path.relative(ROOT, p);

/** Every `.ts` under the SDK source, generated files included — a generated
 *  plugin is still a plugin somebody has to be able to add. */
function sources(dir, out = []) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) sources(full, out);
        else if (e.isFile() && e.name.endsWith('.ts')) out.push(full);
    }
    return out;
}

/** class name -> the file declaring it. */
const declaredIn = new Map();
/** class name -> the names a game could reach it BY (itself, plus bindings of it). */
const aliases = new Map();
/** file -> every identifier the file actually uses. */
const idents = new Map();

const alias = (cls, name) => {
    if (!aliases.has(cls)) aliases.set(cls, new Set([cls]));
    aliases.get(cls).add(name);
};

for (const file of sources(SRC)) {
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const used = new Set();
    idents.set(file, used);
    const visit = (node) => {
        if (ts.isIdentifier(node)) used.add(node.text);

        if (ts.isClassDeclaration(node) && node.name) {
            const implemented = (node.heritageClauses ?? [])
                .filter((h) => h.token === ts.SyntaxKind.ImplementsKeyword)
                .flatMap((h) => h.types.map((t) => t.expression.getText(sf)));
            if (implemented.includes('Plugin')) {
                declaredIn.set(node.name.text, file);
                alias(node.name.text, node.name.text);
            }
        }
        // `export const uiPlugin = new UIPlugin()` — the binding IS the door.
        if (ts.isVariableDeclaration(node) && node.name && ts.isIdentifier(node.name)
            && node.initializer && ts.isNewExpression(node.initializer)
            && ts.isIdentifier(node.initializer.expression)) {
            alias(node.initializer.expression.text, node.name.text);
        }
        // `export function physics3dPlugin(...): Physics3DPlugin` — likewise.
        if (ts.isFunctionDeclaration(node) && node.name && node.type
            && ts.isTypeReferenceNode(node.type) && ts.isIdentifier(node.type.typeName)) {
            alias(node.type.typeName.text, node.name.text);
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
}

/** Every symbol any public entry exports. */
const exported = new Set();
for (const entry of Object.keys(ENTRIES)) {
    let snapshot;
    try { snapshot = readFileSync(path.join(ETC, `${entry}.api.md`), 'utf8'); } catch { continue; }
    for (const [name] of parseSnapshot(snapshot)) exported.add(name);
}

const open = new Set();
for (const cls of declaredIn.keys()) {
    if ([...aliases.get(cls)].some((n) => exported.has(n))) open.add(cls);
}
const byEntry = open.size;

/**
 * A plugin with no entry of its own is still reachable if a reachable plugin's
 * file USES it — that is what composition looks like, and the game adds the
 * composer. Iterated to a fixpoint so a chain of composition counts.
 */
for (let grew = true; grew;) {
    grew = false;
    for (const [cls, file] of declaredIn) {
        if (open.has(cls)) continue;
        const composed = [...declaredIn].some(([other, otherFile]) =>
            open.has(other) && otherFile !== file
            && [...aliases.get(cls)].some((n) => idents.get(otherFile).has(n)));
        if (composed) { open.add(cls); grew = true; }
    }
}

const walled = [...declaredIn].filter(([cls]) => !open.has(cls));
if (walled.length) {
    console.error('check-plugin-door: a game has no way to add these.\n');
    for (const [cls, file] of walled) console.error(`  ${cls}  (${rel(file)})`);
    console.error('\nExport it from an entry, or have a plugin that IS exported compose it.');
    process.exit(1);
}

console.log(`check-plugin-door: ${declaredIn.size} plugin(s), every one reachable — `
    + `${byEntry} by an entry, ${declaredIn.size - byEntry} by composition.`);

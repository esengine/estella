#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-scene-teardown.mjs — one teardown protocol, and it covers the instance.
 *
 * A scene that unloads and a load that failed halfway own the same kinds of
 * thing. They had two implementations of giving them back, and the second one
 * was missing four steps: a failed load released no assets, removed no systems,
 * unregistered no draw callbacks and unbound no post-process.
 *
 *   1. `unload` and `rollbackFailedLoad_` perform no teardown of their own —
 *      both go through disposeSceneOwnedState_.
 *   2. The protocol still performs all of them. Emptying a collection is not
 *      giving its contents back: dropping the `removeSystem` loop while keeping
 *      `systemIds.length = 0` leaves the systems running and looks tidy.
 *   3. Every piece of state a SceneInstance owns is named in that teardown.
 *      This is the one that catches the NEXT field: a collection added to the
 *      instance and forgotten in the protocol is invisible until it leaks.
 *
 * Run: node tools/check-scene-teardown.mjs   (exit 1 on violation)
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'sdk/src/scene/sceneManager.ts';

if (!existsSync(path.join(ROOT, FILE))) {
  console.error(`check-scene-teardown is stale: ${FILE} does not exist.`);
  process.exit(1);
}

/** Comments out, line numbers intact. */
const stripComments = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '');

const src = stripComments(readFileSync(path.join(ROOT, FILE), 'utf8'));

/**
 * One method body, braces balanced. Anchored at the member declaration: matching
 * the bare name found `this.unload(` — a call site that appears before the
 * definition — and read a body that was not the method's at all.
 */
function methodBody(name) {
  const m = new RegExp(`\\n {4}(?:private |protected |public )?(?:async )?${name}\\s*\\(`).exec(src);
  if (!m) return null;
  let i = src.indexOf('{', m.index + m[0].length - 1);
  const start = i;
  for (let depth = 0; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return { text: src.slice(start + 1, i), line: src.slice(0, m.index).split('\n').length + 1 };
}

const findings = [];

const dispose = methodBody('disposeSceneOwnedState_');
const releaseAssets = methodBody('releaseSceneAssets_');
if (!dispose || !releaseAssets) {
  console.error(`${FILE}  disposeSceneOwnedState_ / releaseSceneAssets_ is gone — the scene teardown protocol has no single implementation to hold.`);
  process.exit(1);
}
// The protocol is the two together: dispose runs releaseSceneAssets_.
const protocol = dispose.text + releaseAssets.text;

// --- 1. neither door tears down on its own ---------------------------------
const TEARDOWN_OPS = [
  /\bworld\.despawn\s*\(/,
  /\bunregisterDrawCallback\s*\(/,
  /\bremoveSystem\s*\(/,
  /\bunbind\s*\(/,
  /\breleaseAll\s*\(/,
  /\breleaseAssets\s*\(/,
];
for (const name of ['unload', 'rollbackFailedLoad_']) {
  const body = methodBody(name);
  if (!body) {
    findings.push(`${FILE}  ${name}() is gone — this guard is reading the wrong file.`);
    continue;
  }
  for (const op of TEARDOWN_OPS) {
    if (!op.test(body.text)) continue;
    findings.push(`${FILE}:${body.line}  ${name}() tears down on its own (${op.source}) instead of through disposeSceneOwnedState_ — that is how the two copies came to disagree.`);
    break;
  }
}

// --- 2. and the protocol still performs every one of them ------------------
for (const op of TEARDOWN_OPS) {
  if (op.test(protocol)) continue;
  findings.push(`${FILE}:${dispose.line}  the teardown protocol no longer does ${op.source} — emptying the collection that held them is not giving them back.`);
}

// --- 3. every piece of instance state is in the protocol -------------------
const cls = /class SceneInstance \{([\s\S]*?)\n\}/.exec(src);
if (!cls) {
  console.error(`${FILE}  cannot read SceneInstance — this guard parses its fields.`);
  process.exit(1);
}
/** State whose lifetime is NOT the instance's to end, with the reason. */
const NOT_OWNED = new Map([
  ['config', 'the registration this instance was made from; it outlives the instance'],
  ['status', 'a flag on the instance itself, not something held on its behalf'],
]);
const fields = [...cls[1].matchAll(/^\s+(?:readonly )?([A-Za-z0-9_]+)(?:\s*[:=])/gm)].map((m) => m[1]);
const owned = fields.filter((f) => !NOT_OWNED.has(f));
if (owned.length < 5) {
  console.error(`check-scene-teardown: found only ${owned.length} owned field(s) on SceneInstance — the parser no longer matches how they are declared.`);
  process.exit(1);
}
for (const field of owned) {
  if (new RegExp(`\\b${field}\\b`).test(protocol)) continue;
  findings.push(`${FILE}  SceneInstance.${field} is never given back: the teardown protocol does not touch it, so a failed or unloaded scene leaves it live.`);
}

if (findings.length === 0) {
  console.log(`check-scene-teardown: one protocol, covering all ${owned.length} pieces of scene-owned state.`);
  process.exit(0);
}
for (const f of findings) console.error(f);
console.error('\nA scene that did not commit leaves nothing behind. Extend disposeSceneOwnedState_ rather than the caller.');
process.exit(1);

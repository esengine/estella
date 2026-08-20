// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-native-components — every builtin reaches the registry on a device.
 *
 * `BuiltinBridge` resolves a component through add/get/has/remove, and on a device
 * those come from `createNativeRegistry`: from PTR_ACCESSORS for anything with a
 * POD layout, and by hand for anything without one. A component in neither has no
 * route at all — it throws "C++ Registry missing methods" the first time a scene
 * inserts it, and only on a device.
 *
 * MeshSkin was that for as long as it existed: its joints are a variable-length
 * entity list, so no accessor was generated and the native binding generator wrote
 * `// skip joints … needs a bespoke binding` into code nobody reads. Every rigged
 * glTF was unshippable to a phone and the web build said nothing.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const meta = read('sdk/src/ecs/component.generated.ts');
const components = [...new Set(
    [...meta.matchAll(/^ {4}([A-Z][A-Za-z0-9_]*):\s*\{/gm)].map((m) => m[1]),
)];

const ptrSrc = read('sdk/src/ecs/bridge/ptrAccessors.generated.ts');
const table = /export const PTR_ACCESSORS[^{]*\{([\s\S]*?)\n\};/.exec(ptrSrc);
const withAccessor = new Set(
    table ? [...table[1].matchAll(/^\s+([A-Za-z0-9_]+):/gm)].map((m) => m[1]) : [],
);

// Hand-presented: `reg.add<Name> =` in the native registry, which is how the
// components with no POD layout are given the same four methods.
const regSrc = read('sdk/src/ecs/bridge/nativeRegistry.ts');
const byHand = new Set(
    [...regSrc.matchAll(/reg\.add([A-Z][A-Za-z0-9_]*)\s*=/g)].map((m) => m[1]),
);

const stranded = components.filter((c) => !withAccessor.has(c) && !byHand.has(c));
if (stranded.length) {
    console.error('check-native-components: no route to the registry on a device for '
        + `${stranded.length} component(s):`);
    for (const c of stranded) {
        console.error(`  ${c} — no ptr accessor and no reg.add${c} in nativeRegistry.ts`);
    }
    console.error('\nGive it a POD layout, or present it by hand the way MeshSkin and the '
        + 'hierarchy components are.');
    process.exit(1);
}

console.log(`check-native-components: ${components.length} builtin(s) reach the registry on a `
    + `device — ${withAccessor.size} by ptr accessor, ${byHand.size} presented by hand `
    + `(${[...byHand].sort().join(', ')}).`);

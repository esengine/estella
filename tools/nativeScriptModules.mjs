// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  nativeScriptModules.mjs — what each `esengine/*` specifier MEANS to a
 *        script inside a natively packaged game.
 *
 * A native build has no module loader, so the exporter rewrites every `esengine`
 * import to something the host already evaluated. It did that with one rule:
 *
 *     /^esengine(\/.*)?$/  ->  globalThis.ESEngine
 *
 * which reads "esengine, and also anything under it" — four distinct modules
 * collapsed onto the core namespace. The core does not carry their exports, so
 * `import { Physics3D } from 'esengine/physics3d'` produced `undefined`, `Res`
 * stored it without looking (a descriptor holds the reference; nothing reads
 * `_id` until a frame resolves it), and the game threw
 * `cannot read property '_id' of undefined` every frame it ran on a device.
 * 49 exports across the four subpaths are unreachable that way; `Physics3D` is
 * merely the one that crashed instead of being quietly undefined.
 *
 * So a specifier is not matched, it is LOOKED UP. Each one carries a class, and
 * each class owes an obligation a gate can check. There is deliberately NO
 * default: an export added to sdk/package.json with no disposition here fails
 * the build rather than inheriting a guess, which is the whole failure this
 * file exists to make impossible.
 */

/**
 * The registry a native game script resolves a subpath through — installed as a
 * non-enumerable global by the native entry, holding namespaces from the
 * ALREADY-RUNNING graph. A second copy would mint a second `Physics3D`, and
 * `Res` is keyed by identity: the runtime installs one, the game asks another.
 */
export const NATIVE_MODULE_REGISTRY = '__ESTELLA_NATIVE_MODULES__';

export const DISPOSITIONS = {
    'core-global': {
        means: 'the host has already evaluated the SDK and installed globalThis.ESEngine; this binds to that instance',
        resolvesTo: 'globalThis.ESEngine',
        needsNamespace: false,
    },
    'native-subpath': {
        means: 'a public plugin module whose namespace the native entry publishes from its own graph',
        resolvesTo: `globalThis.${NATIVE_MODULE_REGISTRY}[<specifier>]`,
        needsNamespace: true,
    },
    'forbidden-native-script': {
        means: 'a real SDK entry that a natively packaged game script must not import; packaging fails and says why',
        resolvesTo: null,
        needsNamespace: false,
    },
};

/**
 * Every specifier the SDK's `exports` map publishes, and what it means here.
 *
 * `why` is owed by anything forbidden: "no" without a reason is the kind of
 * rule that gets deleted by whoever hits it next.
 */
export const MODULES = {
    'esengine': { disposition: 'core-global' },

    'esengine/physics': { disposition: 'native-subpath' },
    'esengine/physics3d': { disposition: 'native-subpath' },
    'esengine/spine': { disposition: 'native-subpath' },
    'esengine/dragonbones': { disposition: 'native-subpath' },

    'esengine/native': {
        disposition: 'forbidden-native-script',
        why: 'the SDK entry the host itself evaluated — a game script importing it is asking for a second copy of the thing already running',
    },
    'esengine/wasm': {
        disposition: 'forbidden-native-script',
        why: 'the emscripten module surface; a native build embeds Dawn and QuickJS and has no such module',
    },
    'esengine/node': {
        disposition: 'forbidden-native-script',
        why: 'the Node entry, for servers and tools (examples/multiplayer-arena/server) — it reaches for node: builtins a packaged game has none of',
    },
    'esengine/wechat': {
        disposition: 'forbidden-native-script',
        why: 'the WeChat mini-game entry, a different host with a different platform adapter',
    },
    'esengine/minigame': {
        disposition: 'forbidden-native-script',
        why: 'the mini-game entry, as above',
    },
};

/** The `exports` subpath ("." / "./physics3d") a specifier corresponds to. */
export function subpathOf(specifier) {
    return specifier === 'esengine' ? '.' : `.${specifier.slice('esengine'.length)}`;
}

/** The specifier an `exports` subpath corresponds to — the inverse of the above. */
export function specifierOf(subpath) {
    return subpath === '.' ? 'esengine' : `esengine${subpath.slice(1)}`;
}

/** Every specifier that must have a namespace in the native registry. */
export function nativeSubpaths() {
    return Object.entries(MODULES)
        .filter(([, m]) => DISPOSITIONS[m.disposition]?.needsNamespace)
        .map(([specifier]) => specifier);
}

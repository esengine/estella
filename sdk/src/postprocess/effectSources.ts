// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    effectSources.ts
 * @brief   Where the post-process effects' shader sources are looked up, held apart from the effects that name them.
 *
 * @details An effect's definition (its label, its parameters) is small and every package carries it; its shaders are most of the
 *          bytes, and a game that uses three effects should not ship thirty. The sources are installed in groups — see
 *          `sources/` — by the package subpath a game imports or the content asks for, the way a tilemap's parser is. A factory
 *          asks this registry when a pass is compiled, so a group nobody installed costs nothing until an effect from it is used,
 *          and then says which subpath to import rather than failing in a shader compiler.
 */

type Factory = (...args: never[]) => unknown;

const factories = new Map<string, Factory>();

/** Called by a group's installer with the object of `createX` factories it carries. */
export function registerEffectSources(sources: object): void {
    for (const [name, fn] of Object.entries(sources)) {
        if (typeof fn === 'function') factories.set(name, fn as Factory);
    }
}

const computeSources = new Map<string, string>();

/** A compute effect's WGSL, installed with its group. */
export function registerComputeSource(name: string, source: string): void {
    computeSources.set(name, source);
}

/** The WGSL of a compute effect, read when its pass is compiled. */
export function computeSourceOf(name: string): string {
    const source = computeSources.get(name);
    if (source === undefined) {
        throw new Error(`The "${name}" compute effect is not in this package. Import esengine/fx-basic, or set the module to Include in Project Settings.`);
    }
    return source;
}

/** Whether a factory by this name has been installed. */
export function hasEffectSource(name: string): boolean {
    return factories.has(name);
}

/**
 * A stand-in for one of the source objects an effect definition calls into. Typed as the real object (a type-only import, which
 * costs nothing), resolved by name when a method is called.
 */
export function effectSourcesOf<T extends object>(): T {
    return new Proxy({}, {
        get(_target, key): unknown {
            if (typeof key !== 'string') return undefined;
            return (...args: unknown[]) => {
                const fn = factories.get(key);
                if (!fn) {
                    throw new Error(`The post-process effect needs "${key}", which this package does not carry. `
                        + 'Import the effect group that has it (esengine/fx-basic, esengine/fx-atmosphere, esengine/fx-lighting or esengine/fx-agx), '
                        + 'or set the module to Include in Project Settings.');
                }
                return (fn as (...a: unknown[]) => unknown)(...args);
            };
        },
    }) as T;
}

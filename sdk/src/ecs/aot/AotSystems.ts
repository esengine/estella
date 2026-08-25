// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AotSystems.ts
 * @brief   The compiled twins a build produced, and how a system finds its own.
 *
 * @details When a twin is used is settled: the editor's preview always
 *          interprets, and AOT is a shipping mode. So the runner has one rule —
 *          call the twin if there IS one — and the decision lives in who
 *          installs, which is the build, once, at load.
 *
 *          Installing verifies the handshake first. A module whose
 *          contract hash disagrees is REFUSED, not warned about: mismatched
 *          offsets do not produce an error, they produce a read of a different
 *          field.
 */

import type { AnyComponentDef } from '../component';
import { engineAbiDigest, projectShapeDigest, type ShapeDigestInput } from './abiDigest';

/** One system's declaration, as the build wrote it beside the module. */
export interface AotSystemDecl {
    readonly name: string;
    readonly symbol: string;
    /** One entry per declared Query, in the order the system names them. */
    readonly queries: readonly (readonly { comp: string; mut: boolean }[])[];
    readonly resources: readonly string[];
}

export interface AotManifest {
    /** The engine the module was built against (EHT offsets, resource shapes,
     *  struct sizes, address width). */
    readonly engineAbi: string;
    /** The project's own component shapes, scoped to the ones it names. */
    readonly projectShapes: string;
    readonly systems: readonly AotSystemDecl[];
}

/** A twin, resolved: its declaration and the function that runs it. */
export interface AotTwin {
    readonly decl: AotSystemDecl;
    readonly call: (ctx: number) => void;
    /** The components this system may write, for the Changed bookkeeping the
     *  compiled code cannot do — it never calls back. */
    readonly mutated: readonly (readonly AnyComponentDef[])[];
}

/**
 * The twins available to a world. Empty in the editor and in dev, which is why
 * dispatch needs no mode flag: there is simply nothing to find.
 */
export class AotSystems {
    private readonly byName = new Map<string, AotTwin>();

    get size(): number {
        return this.byName.size;
    }

    /**
     * Take a built module, after checking what it baked in against what is here.
     *
     * `resolve` turns a component NAME into the definition this world uses,
     * because the manifest carries names — a build cannot know a runtime's ids.
     * It is also how the project digest is recomputed: the shapes the module
     * named, as this runtime has them now.
     */
    install(
        manifest: AotManifest,
        exports: Readonly<Record<string, unknown>>,
        resolve: (name: string) => AnyComponentDef | undefined,
    ): void {
        // Two questions with two fixes, so two answers rather than one that can
        // only say "something moved".
        const engine = engineAbiDigest(4);
        if (manifest.engineAbi !== engine) {
            throw new Error(
                `AOT module refused: built for engine ${manifest.engineAbi}, this is ${engine}. `
                + 'Rebuild the module against this engine — a wrong offset reads a different '
                + 'field rather than failing.');
        }
        const shapes = projectShapeDigest(scriptShapes(manifest, resolve));
        if (manifest.projectShapes !== shapes) {
            throw new Error(
                `AOT module refused: built for components ${manifest.projectShapes}, this project `
                + `has ${shapes}. Rebuild the project — a component's fields moved under it.`);
        }
        for (const decl of manifest.systems) {
            const call = exports[decl.symbol];
            if (typeof call !== 'function') {
                throw new Error(`AOT module refused: it declares '${decl.name}' but exports no `
                    + `'${decl.symbol}'`);
            }
            const mutated = decl.queries.map((q) => q
                .filter((a) => a.mut)
                .map((a) => resolve(a.comp))
                .filter((c): c is AnyComponentDef => c !== undefined));
            this.byName.set(decl.name, {
                decl, mutated, call: call as (ctx: number) => void,
            });
        }
    }

    get(name: string): AotTwin | undefined {
        return this.byName.get(name);
    }

    clear(): void {
        this.byName.clear();
    }
}

/**
 * The script-component shapes a manifest names, as this runtime has them. Engine
 * components are covered by the engine digest, from EHT's own table, so they are
 * skipped here rather than counted twice.
 */
function scriptShapes(
    manifest: AotManifest,
    resolve: (name: string) => AnyComponentDef | undefined,
): ShapeDigestInput[] {
    const seen = new Set<string>();
    const out: ShapeDigestInput[] = [];
    for (const decl of manifest.systems) {
        for (const query of decl.queries) {
            for (const arg of query) {
                if (seen.has(arg.comp)) continue;
                seen.add(arg.comp);
                const def = resolve(arg.comp);
                if (!def || def._builtin) continue;
                const shape = (def as { _default?: unknown })._default;
                if (shape === null || typeof shape !== 'object') continue;
                out.push({ name: arg.comp, fields: Object.keys(shape as object) });
            }
        }
    }
    return out;
}

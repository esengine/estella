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
    /** One per declared Res/ResMut. `mut` is what makes a host write the mirror
     *  back after the call — without it the write is silently dropped. */
    readonly resources: readonly { name: string; mut: boolean; fields?: readonly string[] }[];
    /**
     * Event readers, and the query slot each one's payloads go into. `fields`
     * is the payload's layout, in the order the compiled code reads it — the
     * host flattens an object into exactly that order or the code reads a
     * different field.
     */
    readonly readers?: readonly { slot: number; event: string; fields: readonly string[] }[];
    /** Event writers, by the slot the appended record names. */
    readonly writers?: readonly { slot: number; event: string; fields: readonly string[] }[];
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
    private calls_ = 0;

    get size(): number {
        return this.byName.size;
    }

    /** The systems a module supplied twins for. Install is all-or-nothing. */
    names(): readonly string[] {
        return [...this.byName.keys()];
    }

    /**
     * How many times a twin has been called. Installed is not the same question
     * as ran: a differential cannot tell them apart, because the closure that
     * would have run produces the same numbers.
     */
    get calls(): number {
        return this.calls_;
    }

    /** Counted by the runner, which is the only thing that dispatches. */
    noteCall(): void {
        this.calls_++;
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
        /**
          * The fields this runtime's copy of a resource has, in ITS order, or
          * undefined when there is no such resource. Asked rather than taken
          * from the manifest: a manifest compared against itself always agrees.
          */
        resourceFields: (name: string) => readonly string[] | undefined = () => [],
        /**
          * `sizeof(es_addr_t)` where this module will run: 4 in a wasm module
          * addressing the engine's memory by offset, 8 in a library the host
          * loaded into its own process. The digest carries it, so asking for
          * the wrong one is the refusal it is supposed to be.
          */
        addressBytes: 4 | 8 = 4,
        /**
          * Which declarations become twins. The handshake is still checked over
          * the WHOLE manifest, because that is what the module is; a host that
          * could bind only some of it still loaded all of it. Default: all.
          */
        runs: (name: string) => boolean = () => true,
    ): void {
        // Two questions with two fixes, so two answers rather than one that can
        // only say "something moved".
        const engine = engineAbiDigest(addressBytes);
        if (manifest.engineAbi !== engine) {
            throw new Error(
                `AOT module refused: built for engine ${manifest.engineAbi}, this is ${engine}. `
                + 'Rebuild the module against this engine — a wrong offset reads a different '
                + 'field rather than failing.');
        }
        const shapes = projectShapeDigest(scriptShapes(manifest, resolve, resourceFields));
        if (manifest.projectShapes !== shapes) {
            throw new Error(
                `AOT module refused: built for components ${manifest.projectShapes}, this project `
                + `has ${shapes}. Rebuild the project — a component's fields moved under it.`);
        }
        for (const decl of manifest.systems) {
            for (const r of decl.resources) {
                // A resource with no address is not a slow path: the ctx would
                // carry 0 and the compiled code would read whatever is there.
                if (!resourceFields(r.name)) {
                    throw new Error(`AOT module refused: '${decl.name}' reads resource `
                        + `'${r.name}', which this runtime does not have`);
                }
            }
            const call = exports[decl.symbol];
            if (typeof call !== 'function') {
                throw new Error(`AOT module refused: it declares '${decl.name}' but exports no `
                    + `'${decl.symbol}'`);
            }
            if (!runs(decl.name)) continue;
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
    resourceFields: (name: string) => readonly string[] | undefined,
): ShapeDigestInput[] {
    const seen = new Set<string>();
    const out: ShapeDigestInput[] = [];
    for (const decl of manifest.systems) {
        // A resource the project declared is a project shape: its fields are
        // what the code reads at each offset, so a change has to refuse a
        // module built before it.
        for (const r of decl.resources) {
            if (!r.fields || seen.has(r.name)) continue;
            seen.add(r.name);
            // As the RUNTIME has it: the module baked in an order, and this is
            // what says whether that order is still the one here.
            out.push({ name: r.name, fields: [...(resourceFields(r.name) ?? [])] });
        }
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

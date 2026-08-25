// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AotSystems.ts
 * @brief   The compiled twins a build produced, and how a system finds its own.
 *
 * @details `REARCH_AOT.md` §9 settles when a twin is used: the editor's preview
 *          always interprets, and AOT is a shipping mode. So the runner has one
 *          rule — call the twin if there IS one — and the decision lives in who
 *          installs, which is the build, once, at load.
 *
 *          Installing verifies the handshake first (§2.5). A module whose
 *          contract hash disagrees is REFUSED, not warned about: mismatched
 *          offsets do not produce an error, they produce a read of a different
 *          field.
 */

import type { AnyComponentDef } from '../component';

/** One system's declaration, as the build wrote it beside the module. */
export interface AotSystemDecl {
    readonly name: string;
    readonly symbol: string;
    /** One entry per declared Query, in the order the system names them. */
    readonly queries: readonly (readonly { comp: string; mut: boolean }[])[];
    readonly resources: readonly string[];
}

export interface AotManifest {
    readonly contractHash: string;
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
     * Take a built module. `expectedHash` is what this SDK's own contract
     * computes; a module that disagrees is refused.
     *
     * `resolve` turns a component NAME into the definition this world uses,
     * because the manifest carries names — a build cannot know a runtime's ids.
     */
    install(
        manifest: AotManifest,
        exports: Readonly<Record<string, unknown>>,
        expectedHash: string,
        resolve: (name: string) => AnyComponentDef | undefined,
    ): void {
        if (manifest.contractHash !== expectedHash) {
            throw new Error(
                `AOT module refused: contract ${manifest.contractHash} but this engine has `
                + `${expectedHash}. The offsets would not line up, and a wrong offset reads a `
                + 'different field rather than failing.');
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

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  How `esengine` resolves inside a staged realm — the editor's play page
 *        and every shipped game share this one map, so a game runs against the
 *        layout it was previewed on.
 *
 *        Subpath exports are listed file by file: an import map does not append
 *        `/index.js` for a directory. The list is esengineResolve's, so the two
 *        strategies cannot name different subpaths.
 *
 *        A shipped game gets the map for what IT installs, not for everything
 *        the engine has: the map is what the export derives its payload from, so
 *        a page that cannot reach a subsystem is also a package that does not
 *        carry it. The editor's play realm authors every subsystem and takes the
 *        whole map.
 */
import { createHash } from 'node:crypto';
import { ESENGINE_SUBPATHS } from './esengineResolve';

/** Where the exporter stages the SDK, relative to the page. */
const STAGED = './sdk/';

/** The engine entry a lean package aliases `esengine` to. */
export const LEAN_ENTRY_FILE = 'index.lean.js';
/** …and the one that carries every optional subsystem. */
export const FULL_ENTRY_FILE = 'index.js';

/** An import map, and what a page needs to carry it under a CSP. */
export interface EngineImportMap {
    imports: Record<string, string>;
    json: string;
    /** The inline `<script type=importmap>` is an inline script, so a page's CSP
     *  has to allow it by hash rather than by `unsafe-inline`. */
    cspHash: string;
    /** The entry bundles in sdk/dist this map names, relative to `dist`. */
    entries: string[];
}

function finish(imports: Record<string, string>): EngineImportMap {
    const json = JSON.stringify({ imports });
    return {
        imports,
        json,
        cspHash: `sha256-${createHash('sha256').update(json).digest('base64')}`,
        entries: Object.values(imports).map((t) => t.replace(/^\.\/sdk\//, '')),
    };
}

/**
 * The map for a package that installs `subpaths` on `entry`. `esengine/wasm` is
 * always named: the runtime loads the engine module through it on every target.
 */
export function engineImportMap(entry: string, subpaths: Iterable<string>): EngineImportMap {
    const imports: Record<string, string> = { esengine: STAGED + entry };
    for (const specifier of ['esengine/wasm', ...subpaths]) {
        const rel = ESENGINE_SUBPATHS[specifier];
        if (rel) imports[specifier] = STAGED + rel;
    }
    return finish(imports);
}

/** Every subsystem the engine has, for a realm that authors all of them. */
export const FULL_IMPORT_MAP: EngineImportMap = finish({
    esengine: STAGED + FULL_ENTRY_FILE,
    ...Object.fromEntries(
        Object.entries(ESENGINE_SUBPATHS).map(([specifier, rel]) => [specifier, STAGED + rel]),
    ),
});

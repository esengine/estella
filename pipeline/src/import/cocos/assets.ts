// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a Cocos project's `.meta` files say about its assets.
 *
 *        A scene names its assets by uuid; the `.meta` beside each file is the
 *        only place that says which file a uuid is, and a sprite frame is a
 *        sub-asset (`<image uuid>@f9941`) of its image. This reads every meta
 *        once into a lookup. Read-only.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface CocosAssetEntry {
    uuid: string;
    /** Absolute path of the asset file. */
    file: string;
    /** Path relative to the project's `assets` folder, forward slashes. */
    rel: string;
    importer: string;
    userData: Record<string, unknown>;
    /** Sub-assets by their full uuid (`<uuid>@<id>`). */
    subs: Map<string, { importer: string; name: string; userData: Record<string, unknown> }>;
}

export interface CocosAssetIndex {
    /** The project's `assets` folder. */
    root: string;
    /** Every asset and every sub-asset, by uuid. A sub-asset resolves to its parent file. */
    byUuid: Map<string, CocosAssetEntry>;
    /** Folders whose contents scripts load by path at run time: asset bundles, and the `resources` folders. */
    bundles: CocosBundleRoot[];
}

export interface CocosBundleRoot {
    /** The name a script loads it by: `resources`, or the bundle's own name. */
    name: string;
    /** The folder, relative to the project's `assets`. */
    rel: string;
}

const SKIP = new Set(['node_modules', '.git']);

function* walk(dir: string): Generator<string> {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const e of entries) {
        if (e.isDirectory()) {
            if (!SKIP.has(e.name)) yield* walk(path.join(dir, e.name));
        } else if (e.name.endsWith('.meta')) {
            yield path.join(dir, e.name);
        }
    }
}

const asObj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Where a project's own copy of the editor's built-in assets lands in the converted project, under the import's folder. */
export const INTERNAL_FOLDER = '__cocos_internal';

/**
 * The editor's built-in assets (`default_ui`, the default particle, the default materials), which a project names by uuid and does not hold: they
 * live in the Creator install. `COCOS_EDITOR_ASSETS` names the folder outright; otherwise the install the project's own version points at, in the
 * place the installer puts it. Null when it is not on this machine, in which case what refers to one is left as a reference that does not resolve.
 */
export function cocosEditorAssets(version: string | undefined): string | null {
    const tail = ['resources', 'resources', '3d', 'engine', 'editor', 'assets'];
    const candidates: string[] = [];
    if (process.env.COCOS_EDITOR_ASSETS) candidates.push(process.env.COCOS_EDITOR_ASSETS);
    if (version) {
        candidates.push(path.join('C:/ProgramData/cocos/editors/Creator', version, ...tail));
        candidates.push(path.join('/Applications/Cocos/Creator', version, 'CocosCreator.app/Contents', 'Resources', ...tail.slice(1)));
    }
    return candidates.find((c) => existsSync(c)) ?? null;
}

export function buildCocosAssetIndex(root: string, internalRoot?: string | null): CocosAssetIndex {
    const byUuid = new Map<string, CocosAssetEntry>();
    const bundles: CocosBundleRoot[] = [];
    scan(root, root, '', byUuid, bundles, true);
    // What the project does not hold itself: its own assets win, so a project that carries a copy of a built-in is read as it is.
    if (internalRoot) {
        const internal = new Map<string, CocosAssetEntry>();
        scan(internalRoot, internalRoot, `${INTERNAL_FOLDER}/`, internal, [], false);
        // Models are left out: the built-in shapes are mapped to the engine's own, by their uuid, and are not meant to be imported as files.
        for (const [uuid, entry] of internal) if (!byUuid.has(uuid) && entry.importer !== 'fbx' && entry.importer !== 'gltf') byUuid.set(uuid, entry);
    }
    return { root, byUuid, bundles };
}

function scan(dir: string, root: string, relPrefix: string, byUuid: Map<string, CocosAssetEntry>, bundles: CocosBundleRoot[], withBundles: boolean): void {
    for (const metaFile of walk(dir)) {
        let meta: Record<string, unknown>;
        try {
            meta = asObj(JSON.parse(readFileSync(metaFile, 'utf8')));
        } catch {
            continue;
        }
        const uuid = meta.uuid;
        if (meta.importer === 'directory') {
            if (!withBundles) continue;
            const folder = metaFile.slice(0, -'.meta'.length);
            const rel = path.relative(root, folder).split(path.sep).join('/');
            const userData = asObj(meta.userData);
            if (userData.isBundle === true) bundles.push({ name: typeof userData.bundleName === 'string' && userData.bundleName ? userData.bundleName : path.basename(folder), rel });
            else if (path.basename(folder) === 'resources') bundles.push({ name: 'resources', rel });
            continue;
        }
        if (typeof uuid !== 'string') continue;
        const file = metaFile.slice(0, -'.meta'.length);
        const entry: CocosAssetEntry = {
            uuid,
            file,
            rel: relPrefix + path.relative(root, file).split(path.sep).join('/'),
            importer: typeof meta.importer === 'string' ? meta.importer : '',
            userData: asObj(meta.userData),
            subs: new Map(),
        };
        for (const sub of Object.values(asObj(meta.subMetas))) {
            const s = asObj(sub);
            if (typeof s.uuid !== 'string') continue;
            entry.subs.set(s.uuid, { importer: typeof s.importer === 'string' ? s.importer : '', name: typeof s.name === 'string' ? s.name : '', userData: asObj(s.userData) });
            byUuid.set(s.uuid, entry);
        }
        byUuid.set(uuid, entry);
    }
}

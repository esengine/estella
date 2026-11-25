// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { readImportJson, setImportMeta } from './importMeta';
import { PNG } from 'pngjs';
import type { PrefabData } from 'esengine';
import { extractUuid } from '../../../sdk/src/asset/AssetRegistry';
import { resolveInside } from '../fs/pathSandbox';
import { META_EXT } from './contentPolicy';
import { metaUuidOf } from './assetMeta';
import { isPsdImageName, pixelSignature, type PsdLayerHistory, type PsdLayerRecord } from './psdLayerIdentity';
import type { SourceFileLocation } from './sourceProducts';

function readHistory(raw: unknown, stem: string): PsdLayerHistory {
    const history = raw as PsdLayerHistory;
    const entityId = (s: unknown) => typeof s === 'string' && /^(l\d+|(?:psd|layer)-\d+)$/.test(s);
    const records = (rows: unknown): rows is PsdLayerRecord[] => Array.isArray(rows) && rows.every(row =>
        row && entityId(row.entityId) && typeof row.name === 'string' && typeof row.group === 'boolean'
        && (row.parent === 'root' || entityId(row.parent))
        && (row.layerId === undefined || Number.isSafeInteger(row.layerId) && row.layerId > 0)
        && (row.file === undefined || isPsdImageName(row.file, stem))
        && (row.fileUuid === undefined || typeof row.fileUuid === 'string')
        && (row.pixels === undefined || typeof row.pixels === 'string'));
    if (!history || typeof history.digest !== 'string' || !records(history.current) || !records(history.retired)) {
        throw new Error(stem + '.esprefab.meta contains unreadable Photoshop layer identities');
    }
    const rows = [...history.current, ...history.retired];
    const files = rows.flatMap(row => row.file ? [row.file.toLowerCase()] : []);
    const nativeIds = rows.flatMap(row => row.layerId === undefined ? [] : [row.layerId]);
    if (new Set(rows.map(row => row.entityId)).size !== rows.length || new Set(files).size !== files.length
        || new Set(nativeIds).size !== nativeIds.length) {
        throw new Error(stem + '.esprefab.meta contains conflicting Photoshop layer identities');
    }
    return history;
}

/** A project may already have migrated the old prefab's path references to texture UUIDs. */
async function legacyTextureNames(dir: string, stem: string, names: string[]) {
    const byUuid = new Map<string, string | undefined>();
    for (const sidecar of names) {
        if (!sidecar.toLowerCase().endsWith(META_EXT)) continue;
        const name = sidecar.slice(0, -META_EXT.length);
        if (!isPsdImageName(name, stem)) continue;
        const meta = await readImportJson(resolveInside(dir, sidecar, 'product directory'));
        const uuid = extractUuid(meta?.uuid);
        if (uuid) byUuid.set(uuid, byUuid.has(uuid) ? undefined : name);
    }
    return byUuid;
}

/** Pre-identity imports numbered the layers l0, l1, ... . Keep those IDs where the old prefab identifies a layer. */
async function legacyHistory(raw: Record<string, unknown>, dir: string, destDir: string, stem: string, namesOnDisk: string[]): Promise<PsdLayerHistory> {
    const prefab = raw as unknown as PrefabData;
    if (prefab.rootEntityId !== 'root' || !Array.isArray(prefab.entities) || !prefab.entities.some(e => e.prefabEntityId === 'root')) {
        throw new Error(stem + '.esprefab already exists and cannot be identified as a Photoshop import');
    }
    const current: PsdLayerRecord[] = [];
    let byUuid: Map<string, string | undefined> | undefined;
    for (const entity of prefab.entities) {
        const root = entity.prefabEntityId === 'root';
        if ((!root && !/^l\d+$/.test(entity.prefabEntityId)) || !Array.isArray(entity.components)
            || entity.components.some(c => c.type !== 'Transform' && (root || c.type !== 'Sprite'))) {
            throw new Error(stem + '.esprefab already contains authored entities or components. Import into a separate folder to keep them.');
        }
        if (root) continue;
        const sprite = entity.components.find(c => c.type === 'Sprite');
        const texture = sprite?.data.texture;
        const uuid = extractUuid(texture);
        let file: string | undefined;
        if (uuid) {
            byUuid ??= await legacyTextureNames(dir, stem, namesOnDisk);
            file = byUuid.get(uuid);
        } else if (typeof texture === 'string') {
            const ref = path.posix.normalize(texture.replace(/\\/g, '/'));
            const folder = path.posix.dirname(ref);
            if (folder === '.' || folder === destDir) file = path.posix.basename(ref);
        }
        if (sprite && !isPsdImageName(file, stem)) {
            throw new Error(stem + '.esprefab contains a texture which cannot be identified as a generated layer. Import into a separate folder to keep it.');
        }
        current.push({ entityId: entity.prefabEntityId, parent: entity.parent ?? 'root', name: entity.name,
            group: !sprite, ...(file && { file }) });
    }
    // Only duplicate names need another clue. The original PNG supplies it even if the two layers traded places.
    const names = new Set<string>(), duplicates = new Set<string>();
    const key = (r: PsdLayerRecord) => JSON.stringify([r.parent, r.name, r.group]);
    for (const row of current) {
        if (names.has(key(row))) duplicates.add(key(row));
        names.add(key(row));
    }
    for (const row of current) {
        if (!row.file || !duplicates.has(key(row))) continue;
        const file = resolveInside(dir, row.file, 'product directory');
        try { row.pixels = pixelSignature(PNG.sync.read(await readFile(file))); }
        catch { /* A missing or edited image gives no evidence for matching this duplicate. */ }
    }
    if (!current.some(row => row.file)) throw new Error(stem + '.esprefab has no generated Photoshop layer textures');
    return { digest: '', current, retired: [] };
}

export async function psdLayerContext(location: SourceFileLocation, stem: string) {
    const dir = resolveInside(location.root, location.destDir, 'project root');
    const file = stem + '.esprefab';
    const sidecar = resolveInside(dir, file + META_EXT, 'product directory');
    const source = await metaUuidOf(location.absSource);
    const meta = await readImportJson(sidecar);
    if (typeof meta?.source === 'string' && meta.source.toLowerCase() !== source) {
        throw new Error(file + ' belongs to a different source asset');
    }
    let names: string[];
    try { names = await readdir(dir); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        names = [];
    }
    let previous: PsdLayerHistory | undefined;
    if (meta?.psdLayers !== undefined) previous = readHistory(meta.psdLayers, stem);
    else {
        const prior = await readImportJson(resolveInside(dir, file, 'product directory'));
        if (prior) previous = await legacyHistory(prior, dir, location.destDir, stem, names);
    }
    const occupied = names.map(name => name.toLowerCase().endsWith(META_EXT) ? name.slice(0, -META_EXT.length) : name);
    const existing = new Set(occupied.map(name => name.toLowerCase()));
    const reassigned: string[] = [];
    for (const row of [...(previous?.current ?? []), ...(previous?.retired ?? [])]) {
        if (!row.file || !existing.has(row.file.toLowerCase())) continue;
        const image = await readImportJson(resolveInside(dir, row.file + META_EXT, 'product directory'));
        if (row.fileUuid && (typeof image?.uuid !== 'string' || image.uuid.toLowerCase() !== row.fileUuid.toLowerCase())
            || typeof image?.source === 'string' && image.source.toLowerCase() !== source) {
            reassigned.push(row.file);
            delete row.file;
            delete row.fileUuid;
        }
    }
    return { previous, reassigned, occupied };
}

export async function savePsdLayerHistory(absPrefab: string, history: PsdLayerHistory): Promise<void> {
    return setImportMeta(absPrefab, meta => ({ ...meta, psdLayers: history }));
}

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { createHash } from 'node:crypto';
import type { Layer } from 'ag-psd';

/** Importer state in the prefab's .meta. Scene overrides address entityId; direct texture references address file. */
export interface PsdLayerRecord {
    entityId: string;
    layerId?: number;
    parent: string;
    name: string;
    group: boolean;
    file?: string;
    fileUuid?: string;
    pixels?: string;
}

export interface PsdLayerHistory {
    digest: string;
    current: PsdLayerRecord[];
    retired: PsdLayerRecord[];
}

export interface PsdLayerContext {
    previous?: PsdLayerHistory;
    occupied?: readonly string[];
}

export function pixelSignature(image: { width: number; height: number; data: ArrayBufferView }): string {
    return createHash('sha256').update(image.width + 'x' + image.height + ':')
        .update(new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength)).digest('hex');
}

function layerImage(layer: Layer) {
    const x = layer.left ?? 0, y = layer.top ?? 0;
    const w = (layer.right ?? x) - x, h = (layer.bottom ?? y) - y;
    const data = layer.imageData;
    return !layer.children && data && data.width > 0 && data.height > 0 && w > 0 && h > 0 ? { x, y, w, h, data } : null;
}

function fileStem(name: string): string {
    return name.trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'layer';
}

/** Accept only names this generator can have made beside the prefab. */
export function isPsdImageName(file: unknown, stem: string): file is string {
    return typeof file === 'string' && file.startsWith(stem + '_') && /^[\w.-]+\.png$/.test(file.slice(stem.length + 1));
}

const label = (name: string, group: boolean): string => JSON.stringify([group, name]);
const location = (parent: string, name: string, group: boolean): string => JSON.stringify([parent, group, name]);
const nativeId = (layer: Layer): number | undefined =>
    Number.isInteger(layer.id) && layer.id! > 0 ? layer.id : undefined;

function count<K>(map: Map<K, number>, key: K): void { map.set(key, (map.get(key) ?? 0) + 1); }

/** Keep source order for drawing. Match identity separately, before a new layer can claim an old ID or filename. */
export function bindPsdLayers(layers: readonly Layer[], stem: string, digest: string, context: PsdLayerContext) {
    const previous = context.previous;
    const active = previous?.current ?? [];
    const history = [...active, ...(previous?.retired ?? [])];
    const byNativeId = new Map(history.filter(r => r.layerId !== undefined).map(r => [r.layerId!, r]));
    const byLocation = new Map<string, PsdLayerRecord[]>();
    for (const record of active) {
        const key = location(record.parent, record.name, record.group);
        const records = byLocation.get(key) ?? [];
        records.push(record);
        byLocation.set(key, records);
    }
    const idCounts = new Map<number, number>();
    function countIds(items: readonly Layer[]) {
        for (const layer of items) {
            const id = nativeId(layer);
            if (id !== undefined) count(idCounts, id);
            if (layer.children) countIds(layer.children);
        }
    }
    countIds(layers);
    const ids = new Set(history.map(r => r.entityId));
    const files = new Set([...(context.occupied ?? []), ...history.flatMap(r => r.file ? [r.file] : [])].map(f => f.toLowerCase()));
    const matched = new Set<PsdLayerRecord>();
    const warnings = new Set<string>();
    const nodes: { layer: Layer; record: PsdLayerRecord; image: ReturnType<typeof layerImage>; depth: number }[] = [];
    let sequence = 0, leaves = 0;
    function freshId(): string {
        while (ids.has('layer-' + sequence)) sequence++;
        return 'layer-' + sequence++;
    }
    function claimImage(name: string): string {
        const base = stem + '_' + fileStem(name);
        let file = base + '.png';
        for (let n = 2; files.has(file.toLowerCase()); n++) file = base + '-' + n + '.png';
        files.add(file.toLowerCase());
        return file;
    }
    function visit(items: readonly Layer[], parent: string) {
        const labels = new Map<string, number>(), signatures = new Map<string, number>();
        const siblings = items.map(layer => {
            const group = layer.children !== undefined, name = layer.name ?? '';
            const key = label(name, group), id = nativeId(layer);
            const layerId = id !== undefined && idCounts.get(id) === 1 ? id : undefined;
            const image = layerImage(layer);
            // A native ID needs no fingerprint unless an old prefab still has to be matched by name.
            const needsSignature = layerId === undefined || !byNativeId.has(layerId) && active.length > 0;
            const pixels = image && needsSignature ? pixelSignature(image.data) : undefined;
            count(labels, key);
            if (pixels) count(signatures, key + pixels);
            return { layer, group, name, key, layerId, pixels, image };
        });
        for (const { layer, group, name, key, layerId, pixels, image } of siblings) {
            let old = layerId !== undefined ? byNativeId.get(layerId) : undefined;
            if (!old && digest === previous?.digest) old = active[nodes.length];
            if (!old) {
                const possible = (byLocation.get(location(parent, name, group)) ?? []).filter(r =>
                    !matched.has(r) && (r.layerId === undefined || layerId === undefined && !idCounts.has(r.layerId)));
                if (possible.length === 1 && labels.get(key) === 1) old = possible[0];
                else if (possible.length) {
                    const same = pixels && signatures.get(key + pixels) === 1 ? possible.filter(r => r.pixels === pixels) : [];
                    if (same.length === 1) old = same[0];
                    else warnings.add('Multiple layers named "' + name + '" have no matching Photoshop layer ID. The ambiguous layers receive new identities so their scene overrides stay separate.');
                }
            }
            if (old) matched.add(old);
            const nativeName = layerId !== undefined ? 'psd-' + layerId : null;
            const entityId = old?.entityId ?? (nativeName && !ids.has(nativeName) ? nativeName : freshId());
            ids.add(entityId);
            const file = old?.file ?? (image ? claimImage(name || entityId) : undefined);
            const record: PsdLayerRecord = { entityId, parent, name, group, ...(layerId !== undefined && { layerId }),
                ...(file && { file }), ...(old?.fileUuid && { fileUuid: old.fileUuid }),
                ...(layerId === undefined && pixels && { pixels }) };
            nodes.push({ layer, record, image, depth: group ? -1 : leaves++ });
            if (layer.children) visit(layer.children, entityId);
        }
    }
    visit(layers, 'root');
    return { nodes, leaves, warnings: [...warnings], history: { digest, current: nodes.map(n => n.record), retired: history.filter(r => !matched.has(r)) } };
}

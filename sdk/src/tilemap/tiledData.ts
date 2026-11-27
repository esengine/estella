// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { decodeBase64Bytes } from '../util/base64';

type Layer = Record<string, unknown>;

export function parseTiledMapDocument(text: string, path?: string): Layer {
    if (text.trimStart().startsWith('<')) {
        const name = path ? `"${path}"` : 'This map';
        throw new Error(`${name} is a Tiled XML map. In Tiled, use File → Export As → "JSON map files (*.tmj)", then reference the .tmj.`);
    }
    return JSON.parse(text) as Layer;
}

/** Flatten Tiled groups in document order for the loader and package validator. */
export function* walkTmjLayers(layers: readonly Layer[], groups: readonly Layer[] = []): Generator<{ layer: Layer; groups: readonly Layer[] }> {
    for (const layer of layers) {
        if (layer.type === 'group') {
            const children = layer.layers as Layer[] | undefined;
            if (children) yield* walkTmjLayers(children, [...groups, layer]);
        } else yield { layer, groups };
    }
}

function encodedTileData(layer: Layer, block: Layer, count: number): string | undefined {
    if (typeof block.data !== 'string') return undefined;
    const name = typeof layer.name === 'string' && layer.name ? ` "${layer.name}"` : '';
    const where = `tile layer${name}${block === layer ? '' : ` chunk (${block.x ?? 0}, ${block.y ?? 0})`}`;
    if (layer.compression) {
        throw new Error(`${where} uses unsupported ${String(layer.compression)} compression. In Tiled, export as CSV or uncompressed Base64.`);
    }
    if (layer.encoding && layer.encoding !== 'base64') {
        throw new Error(`${where} uses unsupported ${String(layer.encoding)} data. In Tiled, export as CSV or uncompressed Base64.`);
    }
    const encoded = block.data.replace(/\s/g, '');
    const paddingAt = encoded.indexOf('=');
    const digits = paddingAt < 0 ? encoded.length : paddingAt;
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || digits % 4 === 1 || (paddingAt >= 0 && encoded.length % 4 !== 0)) {
        throw new Error(`${where} contains invalid Base64 data.`);
    }
    const bytes = count * 4;
    if (!Number.isSafeInteger(bytes) || bytes < 0 || Math.floor(digits * 3 / 4) !== bytes) {
        throw new Error(`${where} must contain ${bytes} bytes for its tile dimensions.`);
    }
    return encoded;
}

/** Tiled stores unsigned, little-endian GIDs with their original flip flags. */
export function readTiledGids(layer: Layer, block: Layer, count: number): ArrayLike<number> | undefined {
    if (Array.isArray(block.data)) return block.data;
    const encoded = encodedTileData(layer, block, count);
    if (encoded === undefined) return undefined;
    const bytes = decodeBase64Bytes(encoded);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const gids = new Uint32Array(count);
    for (let i = 0; i < count; i++) gids[i] = view.getUint32(i * 4, true);
    return gids;
}

/** Check the same encoded layer and chunk envelopes at export, without allocating decoded tiles. */
export function validateTiledTileData(map: Layer): void {
    for (const { layer } of walkTmjLayers((map.layers as Layer[] | undefined) ?? [])) {
        if (layer.type !== 'tilelayer') continue;
        const chunks = layer.chunks as Layer[] | undefined;
        if (chunks?.length) {
            for (const chunk of chunks) encodedTileData(layer, chunk, ((chunk.width as number) ?? 0) * ((chunk.height as number) ?? 0));
        } else {
            encodedTileData(layer, layer, ((layer.width ?? map.width) as number) * ((layer.height ?? map.height) as number));
        }
    }
}

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { decodeBase64Bytes } from '../util/base64';
import { TILE_ID_MASK } from '../wasm/constants.generated';

type Layer = Record<string, unknown>;

// Tiled reserves all four high bits, including its hex rotation flag.
export const TILED_GID_MASK = 0x0fffffff;
const OUT_OF_RANGE_GID_BITS = TILED_GID_MASK & ~TILE_ID_MASK;
const LITTLE_ENDIAN = new Uint8Array(Uint32Array.of(1).buffer)[0] === 1;

function validDimension(value: unknown, min: number): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= min;
}

export function tiledMapDimensions(map: Layer) {
    const { width, height, tilewidth: tileWidth, tileheight: tileHeight } = map;
    const min = map.infinite === true ? 0 : 1;
    if (!validDimension(width, min) || !validDimension(height, min)
        || !validDimension(tileWidth, 1) || !validDimension(tileHeight, 1)) return null;
    return { width, height, tileWidth, tileHeight };
}

export function tiledLayerStorage(layer: Layer, map: { width: number; height: number }) {
    return {
        width: (layer.width as number | undefined) ?? map.width,
        height: (layer.height as number | undefined) ?? map.height,
        // An empty chunks array still describes a sparse layer.
        chunks: Array.isArray(layer.chunks) ? layer.chunks as Layer[] : undefined,
    };
}

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

function describeTileBlock(layer: Layer, block: Layer): string {
    const name = typeof layer.name === 'string' && layer.name ? ` "${layer.name}"` : '';
    return `tile layer${name}${block === layer ? '' : ` chunk (${block.x ?? 0}, ${block.y ?? 0})`}`;
}

function encodedTileData(layer: Layer, block: Layer, count: number): string | undefined {
    if (typeof block.data !== 'string') return undefined;
    const where = describeTileBlock(layer, block);
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

export function assertTileLayerGid(gid: number, layer: Layer, block: Layer): void {
    if ((gid & OUT_OF_RANGE_GID_BITS) !== 0) {
        throw new Error(`${describeTileBlock(layer, block)} uses tile ID ${gid & TILED_GID_MASK}, above Estella's limit of ${TILE_ID_MASK}. `
            + 'Reduce or reorder the map’s tilesets in Tiled so the layer uses IDs within that limit.');
    }
}

/** Tiled stores unsigned, little-endian GIDs with their original flip flags. */
export function readTiledGids(layer: Layer, block: Layer, count: number): ArrayLike<number> | undefined {
    const data = block.data;
    if (Array.isArray(data)) return data;
    const encoded = encodedTileData(layer, block, count);
    if (encoded === undefined) return undefined;
    const bytes = decodeBase64Bytes(encoded);
    if (LITTLE_ENDIAN && bytes.byteOffset % Uint32Array.BYTES_PER_ELEMENT === 0) {
        return new Uint32Array(bytes.buffer, bytes.byteOffset, count);
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const gids = new Uint32Array(count);
    for (let i = 0; i < count; i++) gids[i] = view.getUint32(i * 4, true);
    return gids;
}

function validateGidBlock(layer: Layer, block: Layer, count: number): void {
    const gids = readTiledGids(layer, block, count);
    if (!gids) return;
    const end = Math.min(count, gids.length);
    for (let i = 0; i < end; i++) assertTileLayerGid(gids[i], layer, block);
}

/** Check the same cell IDs the loader converts for rendering and collision. */
export function validateTiledTileData(map: Layer): void {
    const dimensions = tiledMapDimensions(map);
    if (!dimensions) throw new Error('Invalid Tiled map dimensions. Check the map size and tile size in Tiled.');
    for (const { layer } of walkTmjLayers((map.layers as Layer[] | undefined) ?? [])) {
        if (layer.type !== 'tilelayer') continue;
        const { width, height, chunks } = tiledLayerStorage(layer, dimensions);
        if (chunks) {
            for (const chunk of chunks) validateGidBlock(layer, chunk, ((chunk.width as number) ?? 0) * ((chunk.height as number) ?? 0));
        } else {
            validateGidBlock(layer, layer, width * height);
        }
    }
}

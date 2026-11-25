// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

/** Grid and collection images use the same Tiled fields in a .tsj and an inline tileset. */
export function mapTilesetImages(tileset: Record<string, unknown>, resolve: (ref: string) => string): Record<string, unknown> {
    const result = { ...tileset };
    if (typeof result.image === 'string' && result.image) result.image = resolve(result.image);
    if (Array.isArray(result.tiles)) {
        result.tiles = result.tiles.map(tile => typeof tile?.image === 'string' && tile.image
            ? { ...tile, image: resolve(tile.image) } : tile);
    }
    return result;
}

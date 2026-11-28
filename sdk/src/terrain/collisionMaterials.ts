// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { groundPaintAt, type GroundOrigin } from './groundQuery';
import { dominantTerrainLayer, type TerrainPaintTarget } from './paintLayers';
import type { TerrainSource } from './source';
import type { SurfaceTile, TerrainSurface } from './surface';

/** Keep the tile's triangle order within each physical material. */
export function collisionMaterialGroups(
    tile: SurfaceTile, source: TerrainSource, surface: TerrainSurface, origin: GroundOrigin,
    targets?: readonly TerrainPaintTarget[],
): Map<string, number[]> {
    const groups = new Map<string, number[]>();
    const refs: string[] = [];
    for (const row of targets ?? []) {
        if (row.materialIndex >= 0) refs[row.materialIndex] ??= row.physicalMaterial;
    }
    const { indices, positions, x0, z0 } = tile;
    for (let i = 0; i < indices.length; i += 3) {
        const a = indices[i]!, b = indices[i + 1]!, c = indices[i + 2]!;
        const x = x0 + positions[a * 3]! / 3 + positions[b * 3]! / 3 + positions[c * 3]! / 3;
        const z = z0 + positions[a * 3 + 2]! / 3 + positions[b * 3 + 2]! / 3 + positions[c * 3 + 2]! / 3;
        const weights = groundPaintAt(source, surface, origin, x + origin.x, z + origin.z);
        const ref = refs[dominantTerrainLayer(weights)] ?? '';
        let group = groups.get(ref);
        if (!group) { group = []; groups.set(ref, group); }
        group.push(a, b, c);
    }
    return groups;
}

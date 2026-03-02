export interface MergedRect {
    col: number;
    row: number;
    width: number;
    height: number;
}

export function mergeCollisionTiles(
    tiles: ArrayLike<number>,
    mapWidth: number,
    mapHeight: number,
    collisionTileIds: Set<number>,
): MergedRect[] {
    const visited = new Uint8Array(mapWidth * mapHeight);
    const results: MergedRect[] = [];

    const isCollision = (col: number, row: number): boolean => {
        if (col >= mapWidth || row >= mapHeight) return false;
        const idx = row * mapWidth + col;
        if (visited[idx]) return false;
        const tileId = tiles[idx] & 0x1FFF;
        return tileId !== 0 && collisionTileIds.has(tileId);
    };

    for (let row = 0; row < mapHeight; row++) {
        for (let col = 0; col < mapWidth; col++) {
            if (!isCollision(col, row)) continue;

            let w = 1;
            while (isCollision(col + w, row)) {
                w++;
            }

            let h = 1;
            let canExpand = true;
            while (canExpand) {
                const nextRow = row + h;
                if (nextRow >= mapHeight) break;
                for (let dx = 0; dx < w; dx++) {
                    if (!isCollision(col + dx, nextRow)) {
                        canExpand = false;
                        break;
                    }
                }
                if (canExpand) h++;
            }

            for (let dy = 0; dy < h; dy++) {
                for (let dx = 0; dx < w; dx++) {
                    visited[(row + dy) * mapWidth + (col + dx)] = 1;
                }
            }

            results.push({ col, row, width: w, height: h });
        }
    }

    return results;
}

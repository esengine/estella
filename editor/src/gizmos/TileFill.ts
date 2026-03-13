import { readChunkTile } from './TileChunkUtils';

const FLOOD_FILL_LIMIT = 10000;

interface TileGrid {
    infinite: boolean;
    width: number;
    height: number;
    tiles: number[];
    chunks: Record<string, number[]>;
}

function readTile(grid: TileGrid, x: number, y: number): number {
    if (grid.infinite) {
        return readChunkTile(grid.chunks, x, y);
    }
    if (x < 0 || x >= grid.width || y < 0 || y >= grid.height) return -1;
    return grid.tiles[y * grid.width + x] ?? 0;
}

export interface FillResult {
    positions: { x: number; y: number }[];
}

export function floodFill(
    grid: TileGrid,
    startX: number, startY: number,
): FillResult {
    const targetTile = readTile(grid, startX, startY);
    if (targetTile < 0) return { positions: [] };

    const visited = new Set<string>();
    const queue: { x: number; y: number }[] = [{ x: startX, y: startY }];
    const positions: { x: number; y: number }[] = [];
    let head = 0;

    const startKey = `${startX},${startY}`;
    visited.add(startKey);

    while (head < queue.length && positions.length < FLOOD_FILL_LIMIT) {
        const { x, y } = queue[head++];
        positions.push({ x, y });

        const neighbors = [
            { x: x - 1, y },
            { x: x + 1, y },
            { x, y: y - 1 },
            { x, y: y + 1 },
        ];

        for (const n of neighbors) {
            const key = `${n.x},${n.y}`;
            if (visited.has(key)) continue;
            visited.add(key);

            const tile = readTile(grid, n.x, n.y);
            if (tile === targetTile) {
                queue.push(n);
            }
        }
    }

    return { positions };
}

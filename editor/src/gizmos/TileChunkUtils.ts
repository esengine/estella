export const CHUNK_SIZE = 16;
export const FLIP_H_BIT = 0x2000;
export const FLIP_V_BIT = 0x4000;
export const TILE_ID_MASK = 0x1FFF;

export function applyFlipBits(tileId: number, flipH: boolean, flipV: boolean): number {
    if (flipH) tileId |= FLIP_H_BIT;
    if (flipV) tileId |= FLIP_V_BIT;
    return tileId;
}

export function tileToChunk(tx: number, ty: number): { cx: number; cy: number; lx: number; ly: number } {
    return {
        cx: Math.floor(tx / CHUNK_SIZE),
        cy: Math.floor(ty / CHUNK_SIZE),
        lx: ((tx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
        ly: ((ty % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
    };
}

export function readChunkTile(chunks: Record<string, number[]>, tx: number, ty: number): number {
    const { cx, cy, lx, ly } = tileToChunk(tx, ty);
    const chunk = chunks[`${cx},${cy}`];
    return chunk ? (chunk[ly * CHUNK_SIZE + lx] ?? 0) : 0;
}

export function writeChunkTile(chunks: Record<string, number[]>, tx: number, ty: number, tileId: number): void {
    const { cx, cy, lx, ly } = tileToChunk(tx, ty);
    const key = `${cx},${cy}`;
    let chunk = chunks[key];
    if (!chunk) {
        chunk = new Array(CHUNK_SIZE * CHUNK_SIZE).fill(0);
        chunks[key] = chunk;
    }
    chunk[ly * CHUNK_SIZE + lx] = tileId;
}

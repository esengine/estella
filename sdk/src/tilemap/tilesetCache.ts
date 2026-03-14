export interface LoadedTilemapChunk {
    x: number;
    y: number;
    width: number;
    height: number;
    tiles: Uint16Array;
}

export interface LoadedTilemapLayer {
    name: string;
    width: number;
    height: number;
    tiles: Uint16Array;
    chunks: LoadedTilemapChunk[];
    infinite: boolean;
}

export interface LoadedTilemapTileset {
    textureHandle: number;
    columns: number;
}

export interface LoadedTilemapSource {
    tileWidth: number;
    tileHeight: number;
    orientation?: string;
    layers: LoadedTilemapLayer[];
    tilesets: LoadedTilemapTileset[];
    tileAnimations?: Map<number, { tileId: number; duration: number }[]>;
    tileProperties?: Map<number, Map<string, string>>;
}

const tilemapCache_ = new Map<string, LoadedTilemapSource>();

export function registerTilemapSource(path: string, data: LoadedTilemapSource): void {
    tilemapCache_.set(path, data);
}

export function getTilemapSource(path: string): LoadedTilemapSource | undefined {
    return tilemapCache_.get(path);
}

export function clearTilemapSourceCache(): void {
    tilemapCache_.clear();
}

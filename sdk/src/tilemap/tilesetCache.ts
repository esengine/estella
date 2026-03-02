export interface TextureDimensions {
    width: number;
    height: number;
}

export interface LoadedTilemapLayer {
    name: string;
    width: number;
    height: number;
    tiles: Uint16Array;
}

export interface LoadedTilemapTileset {
    textureHandle: number;
    columns: number;
}

export interface LoadedTilemapSource {
    tileWidth: number;
    tileHeight: number;
    layers: LoadedTilemapLayer[];
    tilesets: LoadedTilemapTileset[];
}

const texDimsCache_ = new Map<number, TextureDimensions>();
const tilemapCache_ = new Map<string, LoadedTilemapSource>();

export function registerTextureDimensions(handle: number, width: number, height: number): void {
    texDimsCache_.set(handle, { width, height });
}

export function getTextureDimensions(handle: number): TextureDimensions | undefined {
    return texDimsCache_.get(handle);
}

export function clearTextureDimensionsCache(): void {
    texDimsCache_.clear();
}

export function registerTilemapSource(path: string, data: LoadedTilemapSource): void {
    tilemapCache_.set(path, data);
}

export function getTilemapSource(path: string): LoadedTilemapSource | undefined {
    return tilemapCache_.get(path);
}

export function clearTilemapSourceCache(): void {
    tilemapCache_.clear();
}

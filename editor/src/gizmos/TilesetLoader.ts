import { getGlobalPathResolver } from '../asset';
import { getPlatformAdapter } from '../platform/PlatformAdapter';
import { isUUID, getAssetLibrary } from '../asset/AssetLibrary';

const TILED_GID_MASK = 0x1FFFFFFF;

export interface ParsedTilemapLayer {
    width: number;
    height: number;
    tiles: number[];
}

export interface TilesetInfo {
    tileWidth: number;
    tileHeight: number;
    orientation: string;
    layers: ParsedTilemapLayer[];
    tilesetImage: HTMLImageElement | null;
    tilesetColumns: number;
}

export interface TilesetImageInfo {
    image: HTMLImageElement;
    columns: number;
    tileWidth: number;
    tileHeight: number;
}

type LoadState = { status: 'loading' } | { status: 'loaded'; data: TilesetInfo | null };

const cache_ = new Map<string, LoadState>();
const imageCache_ = new Map<string, HTMLImageElement | null>();
const listeners_: Set<() => void> = new Set();

export function addTilesetLoadListener(cb: () => void): () => void {
    listeners_.add(cb);
    return () => listeners_.delete(cb);
}

function notifyListeners(): void {
    for (const cb of listeners_) cb();
}

function resolveSource(source: string): string {
    if (isUUID(source)) {
        return getAssetLibrary().getPath(source) ?? source;
    }
    return source;
}

export function getTilesetForSource(source: string): TilesetInfo | null {
    const entry = cache_.get(source);
    if (!entry) {
        loadTiledSource(source);
        return null;
    }
    if (entry.status === 'loading') return null;
    return entry.data;
}

function loadTiledSource(source: string): void {
    if (cache_.has(source)) return;
    cache_.set(source, { status: 'loading' });

    loadTiledSourceAsync(source).then(result => {
        cache_.set(source, { status: 'loaded', data: result });
        notifyListeners();
    });
}

async function loadTiledSourceAsync(source: string): Promise<TilesetInfo | null> {
    try {
        const resolver = getGlobalPathResolver();
        if (!resolver) return null;

        const platform = getPlatformAdapter();
        const resolvedPath = resolveSource(source);
        const absPath = resolver.toAbsolutePath(resolvedPath);
        const jsonText = await platform.readTextFile(absPath);
        const json = JSON.parse(jsonText) as Record<string, unknown>;

        const mapWidth = json.width as number;
        const mapHeight = json.height as number;
        const tileWidth = (json.tilewidth as number) ?? 32;
        const tileHeight = (json.tileheight as number) ?? 32;
        if (!mapWidth || !mapHeight) return null;

        const rawTilesets = json.tilesets as Array<Record<string, unknown>> | undefined;
        const firstGid = rawTilesets?.[0]?.firstgid as number ?? 1;
        const tilesetImagePath = rawTilesets?.[0]?.image as string ?? '';
        const tilesetColumns = (rawTilesets?.[0]?.columns as number) ?? 1;

        const rawLayers = json.layers as Array<Record<string, unknown>> | undefined;
        const layers: ParsedTilemapLayer[] = [];

        if (rawLayers) {
            for (const layer of rawLayers) {
                if (layer.type !== 'tilelayer') continue;
                const lw = (layer.width as number) ?? mapWidth;
                const lh = (layer.height as number) ?? mapHeight;
                if (layer.visible === false) continue;
                const rawData = layer.data as number[] | undefined;
                const tiles: number[] = [];
                if (rawData) {
                    for (const gid of rawData) {
                        if (gid === 0) {
                            tiles.push(0);
                        } else {
                            const localId = (gid & TILED_GID_MASK) - firstGid;
                            tiles.push(localId + 1);
                        }
                    }
                }
                layers.push({ width: lw, height: lh, tiles });
            }
        }

        let loadedImage: HTMLImageElement | null = null;
        if (tilesetImagePath) {
            const baseDir = resolvedPath.substring(0, resolvedPath.lastIndexOf('/') + 1);
            loadedImage = await loadImageFromPath(baseDir + tilesetImagePath);
        }

        const orientation = (json.orientation as string) ?? 'orthogonal';

        return {
            tileWidth,
            tileHeight,
            orientation,
            layers,
            tilesetImage: loadedImage,
            tilesetColumns,
        };
    } catch {
        return null;
    }
}

export async function loadImageFromPath(relativePath: string): Promise<HTMLImageElement | null> {
    const cached = imageCache_.get(relativePath);
    if (cached !== undefined) return cached;

    try {
        const resolver = getGlobalPathResolver();
        if (!resolver) return null;

        const platform = getPlatformAdapter();
        const absPath = resolver.toAbsolutePath(relativePath);
        const imageUrl = platform.convertFilePathToUrl(absPath);

        const img = new Image();
        img.src = imageUrl;
        await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error('Failed to load tileset image'));
        });
        imageCache_.set(relativePath, img);
        return img;
    } catch {
        imageCache_.set(relativePath, null);
        return null;
    }
}

export function loadImageFromUrl(url: string): HTMLImageElement | null {
    const cached = imageCache_.get(url);
    if (cached !== undefined) return cached;

    imageCache_.set(url, null);
    const img = new Image();
    img.src = url;
    img.onload = () => {
        imageCache_.set(url, img);
        notifyListeners();
    };
    img.onerror = () => {
        imageCache_.set(url, null);
    };
    return null;
}

export function clearTilesetCache(): void {
    cache_.clear();
    imageCache_.clear();
}

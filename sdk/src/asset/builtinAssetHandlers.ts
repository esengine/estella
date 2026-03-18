import { registerAssetHandler, setBuiltinAssetHandlerInit } from './AssetHandlerRegistry';
import type { AssetServer } from './AssetServer';
import { extractAnimClipTexturePaths, parseAnimClipData, type AnimClipAssetData } from '../animation/AnimClipLoader';
import { registerAnimClip } from '../animation/SpriteAnimator';
import { Audio } from '../audio/Audio';
import { registerTilemapSource } from '../tilemap/tilesetCache';
import { parseTmjJson, resolveRelativePath } from '../tilemap/tiledLoader';
import { parseTimelineAsset, extractTimelineAssetPaths } from '../timeline/TimelineLoader';
import { registerTimelineAsset, registerTimelineTextureHandles } from '../timeline/TimelinePlugin';

export function initBuiltinAssetHandlers(): void {
    registerAssetHandler('texture', {
        async load(paths, assetServer, baseUrl, texturePathToUrl) {
            const handles = new Map<string, number>();
            const promises = [...paths].map(async (texturePath) => {
                try {
                    const isDataUrl = texturePath.startsWith('data:');
                    const url = isDataUrl ? texturePath : baseUrl ? `${baseUrl}/${texturePath}` : `/${texturePath}`;
                    const info = await assetServer.loadTexture(url);
                    handles.set(texturePath, info.handle);
                    texturePathToUrl.set(texturePath, url);
                } catch (err) {
                    console.warn(`Failed to load texture: ${texturePath}`, err);
                    handles.set(texturePath, 0);
                }
            });
            await Promise.all(promises);
            return handles;
        },
    });

    registerAssetHandler('material', {
        async load(paths, assetServer, baseUrl) {
            const handles = new Map<string, number>();
            const promises = [...paths].map(async (materialPath) => {
                try {
                    const loaded = await assetServer.loadMaterial(materialPath, baseUrl);
                    handles.set(materialPath, loaded.handle);
                } catch (err) {
                    console.warn(`Failed to load material: ${materialPath}`, err);
                    handles.set(materialPath, 0);
                }
            });
            await Promise.all(promises);
            return handles;
        },
    });

    registerAssetHandler('font', {
        async load(paths, assetServer, baseUrl) {
            const handles = new Map<string, number>();
            const promises = [...paths].map(async (fontPath) => {
                try {
                    const handle = await assetServer.loadBitmapFont(fontPath, baseUrl);
                    handles.set(fontPath, handle);
                } catch (err) {
                    console.warn(`Failed to load bitmap font: ${fontPath}`, err);
                    handles.set(fontPath, 0);
                }
            });
            await Promise.all(promises);
            return handles;
        },
    });

    registerAssetHandler('anim-clip', {
        async load(paths, assetServer, baseUrl, texturePathToUrl) {
            const promises = [...paths].map(async (clipPath) => {
                try {
                    const data = await assetServer.loadJson<AnimClipAssetData>(clipPath);
                    const texturePaths = extractAnimClipTexturePaths(data);
                    const textureHandles = new Map<string, number>();

                    const texPromises = texturePaths.map(async (texPath: string) => {
                        try {
                            const url = baseUrl ? `${baseUrl}/${texPath}` : `/${texPath}`;
                            const info = await assetServer.loadTexture(url);
                            textureHandles.set(texPath, info.handle);
                            texturePathToUrl.set(texPath, url);
                        } catch (err) {
                            console.warn(`Failed to load anim texture: ${texPath}`, err);
                            textureHandles.set(texPath, 0);
                        }
                    });
                    await Promise.all(texPromises);

                    const clip = parseAnimClipData(clipPath, data, textureHandles);
                    registerAnimClip(clip);
                } catch (err) {
                    console.warn(`Failed to load animation clip: ${clipPath}`, err);
                }
            });
            await Promise.all(promises);
            return new Map();
        },
    });

    registerAssetHandler('audio', {
        async load(paths, _assetServer, baseUrl) {
            const urls = [...paths].map(p => baseUrl ? `${baseUrl}/${p}` : `/${p}`);
            await Audio.preloadAll(urls).catch((err: unknown) => {
                console.warn('Failed to preload audio assets:', err);
            });
            return new Map();
        },
    });

    registerAssetHandler('tilemap', {
        async load(paths, assetServer, baseUrl, texturePathToUrl) {
            const promises = [...paths].map(async (tmjPath) => {
                try {
                    const json = await assetServer.loadJson<Record<string, unknown>>(tmjPath);
                    const mapData = parseTmjJson(json);
                    if (!mapData) {
                        console.warn(`Failed to parse tilemap: ${tmjPath}`);
                        return;
                    }

                    const tilesets = [];
                    for (const ts of mapData.tilesets) {
                        const imagePath = resolveRelativePath(tmjPath, ts.image);
                        let textureHandle = 0;
                        try {
                            const url = baseUrl ? `${baseUrl}/${imagePath}` : `/${imagePath}`;
                            const info = await assetServer.loadTexture(url);
                            textureHandle = info.handle;
                            texturePathToUrl.set(imagePath, url);
                        } catch (err) {
                            console.warn(`Failed to load tileset texture: ${imagePath}`, err);
                        }
                        tilesets.push({ textureHandle, columns: ts.columns });
                    }

                    registerTilemapSource(tmjPath, {
                        tileWidth: mapData.tileWidth,
                        tileHeight: mapData.tileHeight,
                        layers: mapData.layers.map(l => ({
                            name: l.name,
                            width: l.width,
                            height: l.height,
                            tiles: l.tiles,
                            chunks: l.chunks ?? [],
                            infinite: l.infinite ?? false,
                        })),
                        tilesets,
                    });
                } catch (err) {
                    console.warn(`Failed to load tilemap: ${tmjPath}`, err);
                }
            });
            await Promise.all(promises);
            return new Map();
        },
    });

    registerAssetHandler('timeline', {
        async load(paths, assetServer, baseUrl, texturePathToUrl) {
            const promises = [...paths].map(async (tlPath) => {
                try {
                    const raw = await assetServer.loadJson<Record<string, unknown>>(tlPath);
                    const asset = parseTimelineAsset(raw);
                    registerTimelineAsset(tlPath, asset);

                    const assetPaths = extractTimelineAssetPaths(asset);
                    if (assetPaths.textures.length > 0) {
                        const handles = new Map<string, number>();
                        const texPromises = assetPaths.textures.map(async (texPath: string) => {
                            try {
                                const url = baseUrl ? `${baseUrl}/${texPath}` : `/${texPath}`;
                                const info = await assetServer.loadTexture(url);
                                handles.set(texPath, info.handle);
                                texturePathToUrl.set(texPath, url);
                            } catch (err) {
                                console.warn(`Failed to load animFrames texture: ${texPath}`, err);
                                handles.set(texPath, 0);
                            }
                        });
                        await Promise.all(texPromises);
                        registerTimelineTextureHandles(tlPath, handles);
                    }
                } catch (err) {
                    console.warn(`Failed to load timeline: ${tlPath}`, err);
                }
            });
            await Promise.all(promises);
            return new Map();
        },
    });
}

setBuiltinAssetHandlerInit(initBuiltinAssetHandlers);

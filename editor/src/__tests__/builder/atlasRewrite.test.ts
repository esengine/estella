import { describe, it, expect } from 'vitest';

/**
 * Tests the atlas rewrite flow:
 * 1. rewriteSceneData rewrites Sprite.texture to atlas page + uvOffset/uvScale
 * 2. resolveSceneUUIDs resolves remaining UUIDs to paths
 * 3. Scene data is serialized to JSON for embedding
 * 4. Runtime loadTextures reads atlas_0.png from EmbeddedAssetProvider
 * 5. resolveSceneAssetPaths replaces string refs with numeric handles
 */

interface AtlasFrame {
    path: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

interface AtlasResult {
    pages: Array<{ width: number; height: number; frames: AtlasFrame[] }>;
    frameMap: Map<string, { page: number; frame: AtlasFrame }>;
}

const TEXTURE_FIELDS: Record<string, string> = {
    Sprite: 'texture',
    Image: 'texture',
};

const ATLAS_CAPABLE_COMPONENTS = new Set(['Sprite']);

function isUUID(s: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function rewriteAtlasRefs(
    entities: Array<{ components: Array<{ type: string; data: Record<string, unknown> }> }>,
    atlasResult: AtlasResult,
    resolveRef: (ref: string) => string,
): Array<{ oldKey: string; newPath: string }> {
    const metadataUpdates: Array<{ oldKey: string; newPath: string }> = [];

    for (const entity of entities) {
        for (const comp of entity.components || []) {
            if (!ATLAS_CAPABLE_COMPONENTS.has(comp.type)) continue;

            const textureField = TEXTURE_FIELDS[comp.type];
            if (!textureField || !comp.data) continue;

            const textureRef = comp.data[textureField];
            if (typeof textureRef !== 'string') continue;

            const texturePath = resolveRef(textureRef);
            const entry = atlasResult.frameMap.get(texturePath);
            if (!entry) continue;

            const page = atlasResult.pages[entry.page];
            const frame = entry.frame;
            const atlasTexturePath = `atlas_${entry.page}.png`;

            metadataUpdates.push({ oldKey: textureRef, newPath: atlasTexturePath });

            comp.data[textureField] = atlasTexturePath;
            comp.data.uvOffset = {
                x: frame.x / page.width,
                y: 1.0 - (frame.y + frame.height) / page.height,
            };
            comp.data.uvScale = {
                x: frame.width / page.width,
                y: frame.height / page.height,
            };
        }
    }
    return metadataUpdates;
}

function rewriteSceneData(
    sceneData: Record<string, unknown>,
    atlasResult: AtlasResult,
    assetLibrary: Map<string, string>,
): void {
    const entities = sceneData.entities as Array<{
        components: Array<{ type: string; data: Record<string, unknown> }>;
    }> | undefined;
    if (!entities) return;

    const metadataUpdates = rewriteAtlasRefs(entities, atlasResult, (ref) =>
        isUUID(ref) ? (assetLibrary.get(ref) ?? ref) : ref
    );

    const textureMetadata = sceneData.textureMetadata as Record<string, unknown> | undefined;
    if (textureMetadata) {
        for (const { oldKey, newPath } of metadataUpdates) {
            if (textureMetadata[oldKey] && !textureMetadata[newPath]) {
                textureMetadata[newPath] = textureMetadata[oldKey];
                delete textureMetadata[oldKey];
            }
        }
    }
}

function rewritePrefabAtlasRefs(
    prefabData: Record<string, unknown>,
    atlasResult: AtlasResult,
): void {
    const entities = prefabData.entities as Array<{
        components: Array<{ type: string; data: Record<string, unknown> }>;
    }> | undefined;
    if (!entities) return;

    rewriteAtlasRefs(entities, atlasResult, (ref) => ref);
}

function collectNonAtlasCapableTextures(
    sceneDataList: Array<{ name: string; data: Record<string, unknown> }>,
    resolveRef: (ref: string) => string,
): Set<string> {
    const result = new Set<string>();
    for (const { data } of sceneDataList) {
        const entities = data.entities as Array<{
            components: Array<{ type: string; data: Record<string, unknown> }>;
        }> | undefined;
        if (!entities) continue;
        for (const entity of entities) {
            for (const comp of entity.components || []) {
                if (!comp.data || ATLAS_CAPABLE_COMPONENTS.has(comp.type)) continue;
                const textureField = TEXTURE_FIELDS[comp.type];
                if (!textureField) continue;
                const ref = comp.data[textureField];
                if (typeof ref === 'string' && ref) {
                    result.add(resolveRef(ref));
                }
            }
        }
    }
    return result;
}

function resolveSceneUUIDs(
    sceneData: Record<string, unknown>,
    assetLibrary: Map<string, string>,
): void {
    const entities = sceneData.entities as Array<{
        components: Array<{ type: string; data: Record<string, unknown> }>;
    }> | undefined;
    if (!entities) return;

    for (const entity of entities) {
        for (const comp of entity.components || []) {
            if (comp.type !== 'Sprite' || !comp.data) continue;
            const value = comp.data.texture;
            if (typeof value === 'string' && isUUID(value)) {
                const path = assetLibrary.get(value);
                if (path) comp.data.texture = path;
            }
        }
    }
}

describe('Atlas rewrite flow', () => {
    const PLAYER_UUID = '92f1ab5f-28f4-4b95-bb82-7182fdb33494';
    const BACKGROUND_UUID = '78c53bf7-88b8-481d-805c-a443c2d06076';

    const assetLibrary = new Map([
        [PLAYER_UUID, 'assets/textures/player.png'],
        [BACKGROUND_UUID, 'assets/textures/background.png'],
    ]);

    const atlasResult: AtlasResult = {
        pages: [{
            width: 2048,
            height: 2048,
            frames: [
                { path: 'assets/textures/player.png', x: 0, y: 0, width: 64, height: 64 },
                { path: 'assets/textures/background.png', x: 66, y: 0, width: 2, height: 512 },
            ],
        }],
        frameMap: new Map([
            ['assets/textures/player.png', {
                page: 0,
                frame: { path: 'assets/textures/player.png', x: 0, y: 0, width: 64, height: 64 },
            }],
            ['assets/textures/background.png', {
                page: 0,
                frame: { path: 'assets/textures/background.png', x: 66, y: 0, width: 2, height: 512 },
            }],
        ]),
    };

    it('should rewrite player Sprite texture to atlas page with GL-flipped UV coords', () => {
        const sceneData = {
            entities: [
                {
                    components: [
                        { type: 'Transform', data: { position: { x: 0, y: -420, z: 0 } } },
                        { type: 'Sprite', data: { texture: PLAYER_UUID, size: { x: 64, y: 64 } } },
                    ],
                },
            ],
        };

        rewriteSceneData(sceneData, atlasResult, assetLibrary);

        const sprite = sceneData.entities[0].components[1].data as Record<string, unknown>;
        expect(sprite.texture).toBe('atlas_0.png');
        expect(sprite.uvOffset).toEqual({ x: 0 / 2048, y: 1.0 - (0 + 64) / 2048 });
        expect(sprite.uvScale).toEqual({ x: 64 / 2048, y: 64 / 2048 });
        expect(sprite.size).toEqual({ x: 64, y: 64 });
    });

    it('should compute correct GL-flipped UV for non-zero Y positions', () => {
        const offsetAtlas: AtlasResult = {
            pages: [{
                width: 1024,
                height: 1024,
                frames: [
                    { path: 'assets/textures/item.png', x: 128, y: 256, width: 32, height: 48 },
                ],
            }],
            frameMap: new Map([
                ['assets/textures/item.png', {
                    page: 0,
                    frame: { path: 'assets/textures/item.png', x: 128, y: 256, width: 32, height: 48 },
                }],
            ]),
        };
        const ITEM_UUID = 'aabbccdd-1122-3344-5566-778899aabbcc';
        const lib = new Map([[ITEM_UUID, 'assets/textures/item.png']]);
        const sceneData = {
            entities: [{
                components: [
                    { type: 'Sprite', data: { texture: ITEM_UUID, size: { x: 32, y: 48 } } },
                ],
            }],
        };

        rewriteSceneData(sceneData, offsetAtlas, lib);

        const sprite = sceneData.entities[0].components[0].data as Record<string, unknown>;
        expect(sprite.uvOffset).toEqual({
            x: 128 / 1024,
            y: 1.0 - (256 + 48) / 1024,
        });
        expect(sprite.uvScale).toEqual({ x: 32 / 1024, y: 48 / 1024 });
    });

    it('should leave non-atlas textures as UUID for resolveSceneUUIDs', () => {
        const UNLISTED_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        const sceneData = {
            entities: [
                {
                    components: [
                        { type: 'Sprite', data: { texture: UNLISTED_UUID, size: { x: 100, y: 100 } } },
                    ],
                },
            ],
        };

        rewriteSceneData(sceneData, atlasResult, assetLibrary);

        const sprite = sceneData.entities[0].components[0].data as Record<string, unknown>;
        expect(sprite.texture).toBe(UNLISTED_UUID);
        expect(sprite.uvOffset).toBeUndefined();
        expect(sprite.uvScale).toBeUndefined();
    });

    it('should produce valid JSON after full processing', () => {
        const sceneData = {
            entities: [
                {
                    components: [
                        { type: 'Transform', data: {} },
                        { type: 'Sprite', data: { texture: PLAYER_UUID, size: { x: 64, y: 64 } } },
                    ],
                },
                {
                    components: [
                        { type: 'Transform', data: {} },
                        { type: 'Sprite', data: { texture: BACKGROUND_UUID, size: { x: 600, y: 1080 } } },
                    ],
                },
            ],
        };

        rewriteSceneData(sceneData, atlasResult, assetLibrary);
        resolveSceneUUIDs(sceneData, assetLibrary);

        const json = JSON.stringify(sceneData);
        const parsed = JSON.parse(json);

        const playerSprite = parsed.entities[0].components[1].data;
        expect(playerSprite.texture).toBe('atlas_0.png');
        expect(typeof playerSprite.uvOffset.x).toBe('number');
        expect(typeof playerSprite.uvOffset.y).toBe('number');
        expect(typeof playerSprite.uvScale.x).toBe('number');
        expect(typeof playerSprite.uvScale.y).toBe('number');
        expect(playerSprite.uvScale.x).toBeGreaterThan(0);
        expect(playerSprite.uvScale.y).toBeGreaterThan(0);

        const bgSprite = parsed.entities[1].components[1].data;
        expect(bgSprite.texture).toBe('atlas_0.png');
    });

    it('should rewrite prefab Sprite textures to atlas page + uvOffset/uvScale', () => {
        const prefabData = {
            entities: [
                {
                    components: [
                        { type: 'Transform', data: { position: { x: 0, y: 0, z: 0 } } },
                        { type: 'Sprite', data: { texture: 'assets/textures/player.png', size: { x: 64, y: 64 } } },
                    ],
                },
            ],
        };

        rewritePrefabAtlasRefs(prefabData, atlasResult);

        const sprite = prefabData.entities[0].components[1].data as Record<string, unknown>;
        expect(sprite.texture).toBe('atlas_0.png');
        expect(sprite.uvOffset).toEqual({ x: 0 / 2048, y: 1.0 - (0 + 64) / 2048 });
        expect(sprite.uvScale).toEqual({ x: 64 / 2048, y: 64 / 2048 });
        expect(sprite.size).toEqual({ x: 64, y: 64 });
    });

    it('should leave non-atlas prefab textures unchanged', () => {
        const prefabData = {
            entities: [
                {
                    components: [
                        { type: 'Sprite', data: { texture: 'assets/textures/not-packed.png', size: { x: 32, y: 32 } } },
                    ],
                },
            ],
        };

        rewritePrefabAtlasRefs(prefabData, atlasResult);

        const sprite = prefabData.entities[0].components[0].data as Record<string, unknown>;
        expect(sprite.texture).toBe('assets/textures/not-packed.png');
        expect(sprite.uvOffset).toBeUndefined();
        expect(sprite.uvScale).toBeUndefined();
    });

    it('should handle prefab with multiple Sprite entities in atlas', () => {
        const prefabData = {
            entities: [
                {
                    components: [
                        { type: 'Sprite', data: { texture: 'assets/textures/player.png', size: { x: 64, y: 64 } } },
                    ],
                },
                {
                    components: [
                        { type: 'Sprite', data: { texture: 'assets/textures/background.png', size: { x: 2, y: 512 } } },
                    ],
                },
            ],
        };

        rewritePrefabAtlasRefs(prefabData, atlasResult);

        const sprite0 = prefabData.entities[0].components[0].data as Record<string, unknown>;
        expect(sprite0.texture).toBe('atlas_0.png');

        const sprite1 = prefabData.entities[1].components[0].data as Record<string, unknown>;
        expect(sprite1.texture).toBe('atlas_0.png');
        expect(sprite1.uvOffset).toEqual({ x: 66 / 2048, y: 1.0 - (0 + 512) / 2048 });
        expect(sprite1.uvScale).toEqual({ x: 2 / 2048, y: 512 / 2048 });
    });

    it('should NOT rewrite Image texture (Image lacks uvOffset/uvScale support)', () => {
        const HEART_UUID = '11112222-3333-4444-5555-666677778888';
        const heartLib = new Map([
            ...assetLibrary,
            [HEART_UUID, 'assets/textures/player.png'],
        ]);
        const sceneData = {
            entities: [
                {
                    components: [
                        { type: 'Image', data: { texture: HEART_UUID, color: { r: 1, g: 1, b: 1, a: 1 } } },
                    ],
                },
            ],
        };

        rewriteSceneData(sceneData, atlasResult, heartLib);

        const image = sceneData.entities[0].components[0].data as Record<string, unknown>;
        expect(image.texture).toBe(HEART_UUID);
        expect(image.uvOffset).toBeUndefined();
        expect(image.uvScale).toBeUndefined();
    });

    it('should NOT rewrite Image texture in prefab atlas refs', () => {
        const prefabData = {
            entities: [
                {
                    components: [
                        { type: 'Image', data: { texture: 'assets/textures/player.png' } },
                    ],
                },
            ],
        };

        rewritePrefabAtlasRefs(prefabData, atlasResult);

        const image = prefabData.entities[0].components[0].data as Record<string, unknown>;
        expect(image.texture).toBe('assets/textures/player.png');
        expect(image.uvOffset).toBeUndefined();
        expect(image.uvScale).toBeUndefined();
    });

    it('should remove Image textures from packedPaths so they get copied', () => {
        const HEART_UUID = '11112222-3333-4444-5555-666677778888';
        const heartLib = new Map([
            ...assetLibrary,
            [HEART_UUID, 'assets/textures/heart.png'],
        ]);

        const heartAtlas: AtlasResult = {
            pages: [{
                width: 2048,
                height: 2048,
                frames: [
                    ...atlasResult.pages[0].frames,
                    { path: 'assets/textures/heart.png', x: 128, y: 0, width: 24, height: 24 },
                ],
            }],
            frameMap: new Map([
                ...atlasResult.frameMap,
                ['assets/textures/heart.png', {
                    page: 0,
                    frame: { path: 'assets/textures/heart.png', x: 128, y: 0, width: 24, height: 24 },
                }],
            ]),
        };

        const sceneData = {
            entities: [
                {
                    components: [
                        { type: 'Sprite', data: { texture: PLAYER_UUID, size: { x: 64, y: 64 } } },
                    ],
                },
                {
                    components: [
                        { type: 'Image', data: { texture: HEART_UUID, color: { r: 1, g: 1, b: 1, a: 1 } } },
                    ],
                },
            ],
        };

        rewriteSceneData(sceneData, heartAtlas, heartLib);

        const packedPaths = new Set<string>(heartAtlas.frameMap.keys());

        const nonAtlasTextures = collectNonAtlasCapableTextures(
            [{ name: 'Main', data: sceneData }],
            (ref) => isUUID(ref) ? (heartLib.get(ref) ?? ref) : ref,
        );
        for (const path of nonAtlasTextures) {
            packedPaths.delete(path);
        }

        expect(packedPaths.has('assets/textures/player.png')).toBe(true);
        expect(packedPaths.has('assets/textures/background.png')).toBe(true);
        expect(packedPaths.has('assets/textures/heart.png')).toBe(false);
    });

    it('should map texture handles correctly at runtime (simulated)', () => {
        const expectedUvOffsetY = 1.0 - (0 + 64) / 2048;
        const sceneData = {
            entities: [
                {
                    components: [
                        { type: 'Transform', data: {} },
                        { type: 'Sprite', data: { texture: 'atlas_0.png', size: { x: 64, y: 64 },
                            uvOffset: { x: 0, y: expectedUvOffsetY }, uvScale: { x: 64/2048, y: 64/2048 } } },
                    ],
                },
            ],
        };

        const textureCache: Record<string, number> = { 'atlas_0.png': 42 };

        for (const entity of sceneData.entities) {
            for (const comp of entity.components) {
                if (comp.type !== 'Sprite') continue;
                const data = comp.data as Record<string, unknown>;
                if (typeof data.texture === 'string') {
                    data.texture = textureCache[data.texture as string] || 0;
                }
            }
        }

        const sprite = sceneData.entities[0].components[1].data;
        expect(sprite.texture).toBe(42);
        expect(sprite.uvOffset).toEqual({ x: 0, y: expectedUvOffsetY });
        expect(sprite.uvScale).toEqual({ x: 64/2048, y: 64/2048 });
    });
});

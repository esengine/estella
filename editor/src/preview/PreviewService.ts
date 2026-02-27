/**
 * @file    PreviewService.ts
 * @brief   Manages game preview in browser
 */

import type { SceneData } from '../types/SceneTypes';
import type { NativeFS } from '../scripting/types';
import type { TextureMetadata } from '../types/TextureMetadata';
import { getMetaFilePath, parseTextureMetadata } from '../types/TextureMetadata';
import { getComponentAssetFields } from 'esengine';
import { getEditorContext } from '../context/EditorContext';
import { getAssetLibrary } from '../asset/AssetLibrary';
import { getProjectDir } from '../utils/path';
import { deserializePrefab, convertPrefabAssetRefs } from '../prefab/PrefabSerializer';
import { isUUID, getComponentRefFields } from '../asset';

// =============================================================================
// Types
// =============================================================================

interface TauriInvoke {
    (cmd: string, args?: Record<string, unknown>): Promise<unknown>;
}

interface PreviewConfig {
    projectPath: string;
    port?: number;
}

// =============================================================================
// Preview Service
// =============================================================================

export class PreviewService {
    private projectDir_: string;
    private port_: number;
    private previewDir_: string;
    private activePort_: number | null = null;

    constructor(config: PreviewConfig) {
        this.projectDir_ = getProjectDir(config.projectPath);
        this.port_ = config.port ?? 3456;
        this.previewDir_ = `${this.projectDir_}/.esengine/preview`;
    }

    async startPreview(scene: SceneData, compiledScript?: string, spineVersion?: string, enablePhysics?: boolean, physicsConfig?: { gravityX: number; gravityY: number; fixedTimestep: number; subStepCount: number }, runtimeConfig?: Record<string, unknown>): Promise<number | null> {
        const fs = this.getNativeFS();
        const invoke = this.getTauriInvoke();

        if (!fs || !invoke) {
            console.error('PreviewService: Native APIs not available');
            return null;
        }

        await this.preparePreviewFiles(fs, scene, compiledScript, spineVersion, enablePhysics, physicsConfig, runtimeConfig);

        if (this.activePort_ !== null) {
            await this.notifyReload();
            await invoke('open_preview_in_browser', { port: this.activePort_ });
            return this.activePort_;
        }

        const port = await invoke('start_preview_server', {
            projectDir: this.projectDir_,
            port: this.port_,
        }) as number;

        this.activePort_ = port;
        await invoke('open_preview_in_browser', { port });
        return port;
    }

    async startServer(scene: SceneData, compiledScript?: string, spineVersion?: string, enablePhysics?: boolean, physicsConfig?: { gravityX: number; gravityY: number; fixedTimestep: number; subStepCount: number }, runtimeConfig?: Record<string, unknown>): Promise<number | null> {
        const fs = this.getNativeFS();
        const invoke = this.getTauriInvoke();

        if (!fs || !invoke) {
            console.error('PreviewService: Native APIs not available');
            return null;
        }

        await this.preparePreviewFiles(fs, scene, compiledScript, spineVersion, enablePhysics, physicsConfig, runtimeConfig);

        if (this.activePort_ !== null) {
            await this.notifyReload();
            return this.activePort_;
        }

        const port = await invoke('start_preview_server', {
            projectDir: this.projectDir_,
            port: this.port_,
        }) as number;

        this.activePort_ = port;
        return port;
    }

    async stopPreview(): Promise<void> {
        const invoke = this.getTauriInvoke();
        if (invoke) {
            await invoke('stop_preview_server');
        }
        this.activePort_ = null;
    }

    async updatePreviewFiles(
        scene: SceneData,
        compiledScript?: string,
        spineVersion?: string,
        enablePhysics?: boolean,
        physicsConfig?: { gravityX: number; gravityY: number; fixedTimestep: number; subStepCount: number },
        runtimeConfig?: Record<string, unknown>,
    ): Promise<void> {
        const fs = this.getNativeFS();
        if (!fs) return;
        await this.preparePreviewFiles(fs, scene, compiledScript, spineVersion, enablePhysics, physicsConfig, runtimeConfig);
        await this.notifyReload();
    }

    private async preparePreviewFiles(
        fs: NativeFS,
        scene: SceneData,
        compiledScript?: string,
        spineVersion?: string,
        enablePhysics?: boolean,
        physicsConfig?: { gravityX: number; gravityY: number; fixedTimestep: number; subStepCount: number },
        runtimeConfig?: Record<string, unknown>,
    ): Promise<void> {
        await this.ensureDirectory(fs, this.previewDir_);

        await this.createAssetDatabaseWithPrefabs(fs, scene);

        const resolvedScene = JSON.parse(JSON.stringify(scene));
        getAssetLibrary().resolveSceneAssetPaths(resolvedScene);

        const textureMetadata = await this.collectTextureMetadata(fs, resolvedScene);
        const sceneWithMetadata: SceneData = {
            ...resolvedScene,
            textureMetadata: Object.keys(textureMetadata).length > 0 ? textureMetadata : undefined,
        };

        const scenePath = `${this.previewDir_}/scene.json`;
        await fs.writeFile(scenePath, JSON.stringify(sceneWithMetadata, null, 2));

        const configPath = `${this.previewDir_}/config.json`;
        await fs.writeFile(configPath, JSON.stringify({
            spineVersion: spineVersion || null,
            enablePhysics: enablePhysics || false,
            physicsGravityX: physicsConfig?.gravityX ?? 0,
            physicsGravityY: physicsConfig?.gravityY ?? -9.81,
            physicsFixedTimestep: physicsConfig?.fixedTimestep ?? 1 / 60,
            physicsSubStepCount: physicsConfig?.subStepCount ?? 4,
            ...runtimeConfig,
        }));

        const scriptPath = `${this.previewDir_}/user-scripts.js`;
        await fs.writeFile(scriptPath, compiledScript ?? '');

        await this.resolvePrefabsForPreview(fs, resolvedScene);
    }

    private async createAssetDatabaseWithPrefabs(fs: NativeFS, scene: SceneData): Promise<void> {
        const db = getAssetLibrary();
        const assetMap: Record<string, { path: string }> = {};

        for (const entry of db.getAllEntries()) {
            assetMap[entry.uuid] = { path: entry.path };
        }

        const assetDbPath = `${this.previewDir_}/.assets.json`;
        await fs.writeFile(assetDbPath, JSON.stringify(assetMap, null, 2));
    }

    private async collectTextureMetadata(
        fs: NativeFS,
        scene: SceneData
    ): Promise<Record<string, TextureMetadata>> {
        const result: Record<string, TextureMetadata> = {};
        const processedPaths = new Set<string>();

        for (const entity of scene.entities) {
            for (const component of entity.components) {
                const assetFields = getComponentAssetFields(component.type);
                if (!assetFields.includes('texture')) continue;
                const texturePath = component.data.texture as string | undefined;
                if (!texturePath || processedPaths.has(texturePath)) continue;
                processedPaths.add(texturePath);

                const fullPath = `${this.projectDir_}/${texturePath}`;
                const metaPath = getMetaFilePath(fullPath);

                try {
                    if (await fs.exists(metaPath)) {
                        const content = await fs.readFile(metaPath);
                        if (content) {
                            const metadata = parseTextureMetadata(content);
                            if (metadata) {
                                result[texturePath] = metadata;
                            }
                        }
                    }
                } catch (err) {
                    console.warn(`Failed to load texture metadata for ${texturePath}:`, err);
                }
            }
        }

        return result;
    }

    private async resolvePrefabsForPreview(fs: NativeFS, scene: SceneData): Promise<void> {
        const db = getAssetLibrary();
        const visited = new Set<string>();

        const collectPrefabPaths = (entities: SceneData['entities']): string[] => {
            const paths: string[] = [];
            for (const entity of entities) {
                if (entity.prefab?.prefabPath) {
                    paths.push(entity.prefab.prefabPath);
                }
            }
            return paths;
        };

        const resolvePrefabFile = async (relativePath: string): Promise<void> => {
            if (visited.has(relativePath)) return;
            visited.add(relativePath);

            const fullPath = `${this.projectDir_}/${relativePath}`;
            const content = await fs.readFile(fullPath);
            if (!content) return;

            try {
                const prefab = deserializePrefab(content);
                const resolved = convertPrefabAssetRefs(prefab, (value) => {
                    if (isUUID(value)) {
                        return db.getPath(value) ?? value;
                    }
                    return value;
                });

                for (const entity of resolved.entities) {
                    if (entity.nestedPrefab?.prefabPath) {
                        await resolvePrefabFile(entity.nestedPrefab.prefabPath);
                    }
                }

                const outPath = `${this.previewDir_}/${relativePath}`;
                const outDir = outPath.substring(0, outPath.lastIndexOf('/'));
                await this.ensureDirectory(fs, outDir);
                await fs.writeFile(outPath, JSON.stringify(resolved));
            } catch {
                // Skip invalid prefab files
            }
        };

        for (const path of collectPrefabPaths(scene.entities)) {
            await resolvePrefabFile(path);
        }
    }

    private async ensureDirectory(fs: NativeFS, path: string): Promise<void> {
        if (!(await fs.exists(path))) {
            await fs.createDirectory(path);
        }
    }

    private getNativeFS(): NativeFS | null {
        return getEditorContext().fs ?? null;
    }

    private getTauriInvoke(): TauriInvoke | null {
        return getEditorContext().invoke ?? null;
    }

    private async notifyReload(): Promise<void> {
        const invoke = this.getTauriInvoke();
        if (invoke) {
            await invoke('notify_preview_reload');
        }
    }
}

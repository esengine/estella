/**
 * @file    PreviewService.ts
 * @brief   Manages game preview in browser
 */

import type { SceneData } from '../types/SceneTypes';
import type { NativeFS } from '../scripting/types';
import type { TextureMetadata } from '../types/TextureMetadata';
import { getMetaFilePath, parseTextureMetadata } from '../types/TextureMetadata';
import { getEditorContext } from '../context/EditorContext';
import { getAssetLibrary } from '../asset/AssetLibrary';
import { getProjectDir } from '../utils/path';

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

    constructor(config: PreviewConfig) {
        this.projectDir_ = getProjectDir(config.projectPath);
        this.port_ = config.port ?? 3456;
        this.previewDir_ = `${this.projectDir_}/.esengine/preview`;
    }

    async startPreview(scene: SceneData, compiledScript?: string, spineVersion?: string, enablePhysics?: boolean, physicsConfig?: { gravityX: number; gravityY: number; fixedTimestep: number; subStepCount: number }): Promise<void> {
        const fs = this.getNativeFS();
        const invoke = this.getTauriInvoke();

        if (!fs || !invoke) {
            console.error('PreviewService: Native APIs not available');
            return;
        }

        console.log('PreviewService: Preparing files in', this.previewDir_);
        await this.preparePreviewFiles(fs, scene, compiledScript, spineVersion, enablePhysics, physicsConfig);
        console.log('PreviewService: Files prepared');

        const port = await invoke('start_preview_server', {
            projectDir: this.projectDir_,
            port: this.port_,
        }) as number;

        await invoke('open_preview_in_browser', { port });
    }

    async stopPreview(): Promise<void> {
        const invoke = this.getTauriInvoke();
        if (invoke) {
            await invoke('stop_preview_server');
        }
    }

    async updatePreviewFiles(
        scene: SceneData,
        compiledScript?: string,
        spineVersion?: string,
        enablePhysics?: boolean,
        physicsConfig?: { gravityX: number; gravityY: number; fixedTimestep: number; subStepCount: number },
    ): Promise<void> {
        const fs = this.getNativeFS();
        if (!fs) return;
        await this.preparePreviewFiles(fs, scene, compiledScript, spineVersion, enablePhysics, physicsConfig);
    }

    private async preparePreviewFiles(
        fs: NativeFS,
        scene: SceneData,
        compiledScript?: string,
        spineVersion?: string,
        enablePhysics?: boolean,
        physicsConfig?: { gravityX: number; gravityY: number; fixedTimestep: number; subStepCount: number },
    ): Promise<void> {
        await this.ensureDirectory(fs, this.previewDir_);

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
        }));

        if (compiledScript) {
            const scriptPath = `${this.previewDir_}/user-scripts.js`;
            await fs.writeFile(scriptPath, compiledScript);
        }
    }

    private async collectTextureMetadata(
        fs: NativeFS,
        scene: SceneData
    ): Promise<Record<string, TextureMetadata>> {
        const result: Record<string, TextureMetadata> = {};
        const processedPaths = new Set<string>();

        for (const entity of scene.entities) {
            for (const component of entity.components) {
                if (component.type === 'Sprite') {
                    const texturePath = component.data.texture as string | undefined;
                    if (texturePath && !processedPaths.has(texturePath)) {
                        processedPaths.add(texturePath);

                        // Resolve texture path relative to project
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
            }
        }

        return result;
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
}

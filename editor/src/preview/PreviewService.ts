/**
 * @file    PreviewService.ts
 * @brief   Manages game preview in browser
 */

import type { SceneData } from '../types/SceneTypes';
import type { NativeFS } from '../scripting/types';
import type { TextureMetadata } from '../types/TextureMetadata';
import { getMetaFilePath, parseTextureMetadata } from '../types/TextureMetadata';

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
// Path Utilities
// =============================================================================

function normalizePath(path: string): string {
    return path.replace(/\\/g, '/');
}

function getProjectDir(projectPath: string): string {
    const normalized = normalizePath(projectPath);
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash > 0 ? normalized.substring(0, lastSlash) : normalized;
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

    async startPreview(scene: SceneData, compiledScript?: string): Promise<void> {
        const fs = this.getNativeFS();
        const invoke = this.getTauriInvoke();

        if (!fs || !invoke) {
            console.error('PreviewService: Native APIs not available');
            return;
        }

        console.log('PreviewService: Preparing files in', this.previewDir_);
        await this.preparePreviewFiles(fs, scene, compiledScript);
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

    private async preparePreviewFiles(
        fs: NativeFS,
        scene: SceneData,
        compiledScript?: string
    ): Promise<void> {
        await this.ensureDirectory(fs, this.previewDir_);

        // Collect texture metadata
        const textureMetadata = await this.collectTextureMetadata(fs, scene);
        const sceneWithMetadata: SceneData = {
            ...scene,
            textureMetadata: Object.keys(textureMetadata).length > 0 ? textureMetadata : undefined,
        };

        const scenePath = `${this.previewDir_}/scene.json`;
        await fs.writeFile(scenePath, JSON.stringify(sceneWithMetadata, null, 2));

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
        return (window as any).__esengine_fs ?? null;
    }

    private getTauriInvoke(): TauriInvoke | null {
        return (window as any).__esengine_invoke ?? null;
    }
}

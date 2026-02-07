/**
 * @file    AssetCollector.ts
 * @brief   Asset export pipeline: config, reference collection, and build-time asset gathering
 */

import type { BuildConfig } from '../types/BuildTypes';
import { type AssetLibrary, isUUID } from '../asset/AssetLibrary';
import { normalizePath, joinPath, isAbsolutePath, getFileExtension, getDirName } from '../utils/path';
import type { NativeFS } from '../types/NativeFS';
import { ASSET_EXTENSIONS, looksLikeAssetPath } from '../asset/AssetTypes';

// =============================================================================
// Types
// =============================================================================

export type FolderExportMode = 'auto' | 'always' | 'exclude';

export interface AssetExportConfig {
    version: '1.0';
    folders: Record<string, FolderExportMode>;
}

// =============================================================================
// AssetExportConfigService
// =============================================================================

const CONFIG_PATH = '.esengine/asset-export.json';

function createDefaultConfig(): AssetExportConfig {
    return { version: '1.0', folders: {} };
}

export class AssetExportConfigService {
    private fs_: NativeFS;
    private projectDir_: string;

    constructor(projectDir: string, fs: NativeFS) {
        this.projectDir_ = projectDir;
        this.fs_ = fs;
    }

    async load(): Promise<AssetExportConfig> {
        const fullPath = joinPath(this.projectDir_, CONFIG_PATH);
        const content = await this.fs_.readFile(fullPath);
        if (!content) return createDefaultConfig();

        try {
            const data = JSON.parse(content);
            return {
                version: '1.0',
                folders: data.folders ?? {},
            };
        } catch {
            return createDefaultConfig();
        }
    }

    async save(config: AssetExportConfig): Promise<void> {
        const dirPath = joinPath(this.projectDir_, '.esengine');
        await this.fs_.createDirectory(dirPath);
        const fullPath = joinPath(this.projectDir_, CONFIG_PATH);
        await this.fs_.writeFile(fullPath, JSON.stringify(config, null, 4));
    }

    async setMode(folderPath: string, mode: FolderExportMode): Promise<void> {
        const config = await this.load();
        if (mode === 'auto') {
            delete config.folders[folderPath];
        } else {
            config.folders[folderPath] = mode;
        }
        await this.save(config);
    }
}

// =============================================================================
// AssetReferenceCollector
// =============================================================================

export class AssetReferenceCollector {
    private fs_: NativeFS;
    private projectDir_: string;
    private assetLibrary_: AssetLibrary | null;

    constructor(fs: NativeFS, projectDir: string, assetLibrary?: AssetLibrary) {
        this.fs_ = fs;
        this.projectDir_ = projectDir;
        this.assetLibrary_ = assetLibrary ?? null;
    }

    private resolveRef(ref: string): string {
        if (this.assetLibrary_ && isUUID(ref)) {
            return this.assetLibrary_.getPath(ref) ?? ref;
        }
        return ref;
    }

    async collectFromScenes(scenePaths: string[]): Promise<Set<string>> {
        const refs = new Set<string>();
        const visited = new Set<string>();

        for (const scenePath of scenePaths) {
            const fullPath = isAbsolutePath(scenePath)
                ? normalizePath(scenePath)
                : joinPath(this.projectDir_, scenePath);

            const content = await this.fs_.readFile(fullPath);
            if (!content) continue;

            try {
                const scene = JSON.parse(content);
                await this.collectSceneRefs(scene, refs, visited);
            } catch {
                continue;
            }
        }

        return refs;
    }

    private async collectSceneRefs(
        scene: Record<string, unknown>,
        refs: Set<string>,
        visited: Set<string>
    ): Promise<void> {
        const entities = scene.entities as Array<{
            components: Array<{ type: string; data: Record<string, unknown> }>;
        }> | undefined;

        if (!entities) return;

        for (const entity of entities) {
            for (const comp of entity.components || []) {
                if (comp.type === 'Sprite' && comp.data) {
                    if (typeof comp.data.texture === 'string') {
                        refs.add(this.resolveRef(comp.data.texture));
                    }
                    if (typeof comp.data.material === 'string') {
                        await this.collectMaterialRefs(this.resolveRef(comp.data.material), refs, visited);
                    }
                }

                if (comp.type === 'SpineAnimation' && comp.data) {
                    const skelPath = comp.data.skeletonPath;
                    const atlasPath = comp.data.atlasPath;

                    if (typeof skelPath === 'string') {
                        refs.add(this.resolveRef(skelPath));
                    }
                    if (typeof atlasPath === 'string') {
                        const resolvedAtlas = this.resolveRef(atlasPath);
                        refs.add(resolvedAtlas);
                        await this.collectAtlasTextures(resolvedAtlas, refs);
                    }
                    if (typeof comp.data.material === 'string') {
                        await this.collectMaterialRefs(this.resolveRef(comp.data.material), refs, visited);
                    }
                }
            }
        }

        const textureMetadata = scene.textureMetadata as Record<string, unknown> | undefined;
        if (textureMetadata) {
            for (const key of Object.keys(textureMetadata)) {
                refs.add(this.resolveRef(key));
            }
        }
    }

    private async collectMaterialRefs(
        materialPath: string,
        refs: Set<string>,
        visited: Set<string>
    ): Promise<void> {
        if (visited.has(materialPath)) return;
        visited.add(materialPath);
        refs.add(materialPath);

        const fullPath = isAbsolutePath(materialPath)
            ? materialPath
            : joinPath(this.projectDir_, materialPath);

        const content = await this.fs_.readFile(fullPath);
        if (!content) return;

        try {
            const material = JSON.parse(content);

            if (typeof material.shader === 'string' && material.shader) {
                refs.add(material.shader);
            }

            if (material.properties && typeof material.properties === 'object') {
                for (const value of Object.values(material.properties)) {
                    if (looksLikeAssetPath(value)) {
                        refs.add(value);
                    }
                }
            }
        } catch {
            // Ignore parse errors
        }
    }

    private async collectAtlasTextures(atlasPath: string, refs: Set<string>): Promise<void> {
        const fullPath = isAbsolutePath(atlasPath)
            ? atlasPath
            : joinPath(this.projectDir_, atlasPath);

        const content = await this.fs_.readFile(fullPath);
        if (!content) return;

        const atlasDir = getDirName(atlasPath);
        const lines = content.split('\n');
        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (line && line.indexOf(':') === -1 && (/\.png$/i.test(line) || /\.jpg$/i.test(line))) {
                const texturePath = atlasDir ? `${atlasDir}/${line}` : line;
                refs.add(texturePath);
            }
        }
    }
}

// =============================================================================
// BuildAssetCollector
// =============================================================================

export class BuildAssetCollector {
    private fs_: NativeFS;
    private projectDir_: string;
    private assetLibrary_: AssetLibrary | null;

    constructor(fs: NativeFS, projectDir: string, assetLibrary?: AssetLibrary) {
        this.fs_ = fs;
        this.projectDir_ = projectDir;
        this.assetLibrary_ = assetLibrary ?? null;
    }

    async collect(config: BuildConfig, exportConfig: AssetExportConfig): Promise<Set<string>> {
        const refCollector = new AssetReferenceCollector(this.fs_, this.projectDir_, this.assetLibrary_ ?? undefined);
        const referencedPaths = await refCollector.collectFromScenes(config.scenes);

        const result = new Set<string>();
        const assetsDir = joinPath(this.projectDir_, 'assets');
        if (!await this.fs_.exists(assetsDir)) {
            return result;
        }

        await this.walkDirectory(assetsDir, 'assets', exportConfig, referencedPaths, result);
        return result;
    }

    private getEffectiveMode(
        relativePath: string,
        settings: Record<string, FolderExportMode>
    ): FolderExportMode {
        if (settings[relativePath]) {
            return settings[relativePath];
        }

        let current = relativePath;
        while (current.includes('/')) {
            current = current.substring(0, current.lastIndexOf('/'));
            if (settings[current]) {
                return settings[current];
            }
        }

        return 'auto';
    }

    private async walkDirectory(
        absolutePath: string,
        relativePath: string,
        exportConfig: AssetExportConfig,
        referencedPaths: Set<string>,
        result: Set<string>
    ): Promise<void> {
        const mode = this.getEffectiveMode(relativePath, exportConfig.folders);

        if (mode === 'exclude') return;

        const entries = await this.fs_.listDirectoryDetailed(absolutePath);

        for (const entry of entries) {
            const childAbsolute = joinPath(absolutePath, entry.name);
            const childRelative = `${relativePath}/${entry.name}`;

            if (entry.isDirectory) {
                await this.walkDirectory(childAbsolute, childRelative, exportConfig, referencedPaths, result);
            } else {
                if (mode === 'always') {
                    result.add(childRelative);
                } else if (referencedPaths.has(childRelative)) {
                    result.add(childRelative);
                }
            }
        }
    }
}

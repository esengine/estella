/**
 * @file    AssetLibrary.ts
 * @brief   UUID-based asset library with bidirectional path/UUID mapping
 */

import type { SceneData } from '../types/SceneTypes';
import type { TextureMetadata } from '../types/TextureMetadata';
import { joinPath, getFileExtension } from '../utils/path';
import type { NativeFS } from '../types/NativeFS';
import { ASSET_EXTENSIONS, getAssetType } from './AssetTypes';

// =============================================================================
// Types
// =============================================================================

interface AssetMeta {
    uuid: string;
    version: string;
    type: string;
    sliceBorder?: { left: number; right: number; top: number; bottom: number };
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUUID(value: string): boolean {
    return UUID_REGEX.test(value);
}

// =============================================================================
// AssetLibrary
// =============================================================================

export class AssetLibrary {
    private uuidToPath_ = new Map<string, string>();
    private pathToUuid_ = new Map<string, string>();
    private fs_: NativeFS | null = null;
    private projectDir_ = '';

    async initialize(projectDir: string, fs: NativeFS): Promise<void> {
        this.fs_ = fs;
        this.projectDir_ = projectDir;
        this.uuidToPath_.clear();
        this.pathToUuid_.clear();

        const assetsDir = joinPath(projectDir, 'assets');
        if (await fs.exists(assetsDir)) {
            await this.scanDirectory(assetsDir, 'assets');
        }
    }

    getPath(uuid: string): string | undefined {
        return this.uuidToPath_.get(uuid);
    }

    getUuid(path: string): string | undefined {
        return this.pathToUuid_.get(path);
    }

    async ensureMeta(relativePath: string): Promise<string> {
        const existing = this.pathToUuid_.get(relativePath);
        if (existing) return existing;

        if (!this.fs_) {
            throw new Error('AssetLibrary not initialized');
        }

        const fullPath = joinPath(this.projectDir_, relativePath);
        const metaPath = `${fullPath}.meta`;

        if (await this.fs_.exists(metaPath)) {
            const content = await this.fs_.readFile(metaPath);
            if (content) {
                try {
                    const meta = JSON.parse(content) as AssetMeta;
                    if (meta.uuid) {
                        this.register(meta.uuid, relativePath);
                        return meta.uuid;
                    }
                } catch {
                    // Fall through to create new meta
                }
            }
        }

        const uuid = crypto.randomUUID();
        const assetType = getAssetType(relativePath);
        const meta: AssetMeta = {
            uuid,
            version: '1.0',
            type: assetType,
        };

        if (assetType === 'texture') {
            const existingContent = await this.fs_.readFile(metaPath);
            if (existingContent) {
                try {
                    const existing = JSON.parse(existingContent);
                    if (existing.sliceBorder) {
                        meta.sliceBorder = existing.sliceBorder;
                    }
                } catch {
                    // ignore
                }
            }
            if (!meta.sliceBorder) {
                meta.sliceBorder = { left: 0, right: 0, top: 0, bottom: 0 };
            }
        }

        await this.fs_.writeFile(metaPath, JSON.stringify(meta, null, 2));
        this.register(uuid, relativePath);
        return uuid;
    }

    async migrateScene(scene: SceneData): Promise<boolean> {
        if (scene.version === '2.0') return false;
        if (!this.fs_) return false;

        let changed = false;

        for (const entity of scene.entities) {
            for (const comp of entity.components || []) {
                if (comp.type === 'Sprite' && comp.data) {
                    if (typeof comp.data.texture === 'string' && !isUUID(comp.data.texture as string)) {
                        const uuid = await this.ensureMeta(comp.data.texture as string);
                        comp.data.texture = uuid;
                        changed = true;
                    }
                    if (typeof comp.data.material === 'string' && !isUUID(comp.data.material as string)) {
                        const uuid = await this.ensureMeta(comp.data.material as string);
                        comp.data.material = uuid;
                        changed = true;
                    }
                }

                if (comp.type === 'SpineAnimation' && comp.data) {
                    if (typeof comp.data.skeletonPath === 'string' && !isUUID(comp.data.skeletonPath as string)) {
                        const uuid = await this.ensureMeta(comp.data.skeletonPath as string);
                        comp.data.skeletonPath = uuid;
                        changed = true;
                    }
                    if (typeof comp.data.atlasPath === 'string' && !isUUID(comp.data.atlasPath as string)) {
                        const uuid = await this.ensureMeta(comp.data.atlasPath as string);
                        comp.data.atlasPath = uuid;
                        changed = true;
                    }
                    if (typeof comp.data.material === 'string' && !isUUID(comp.data.material as string)) {
                        const uuid = await this.ensureMeta(comp.data.material as string);
                        comp.data.material = uuid;
                        changed = true;
                    }
                }
            }
        }

        if (scene.textureMetadata) {
            const newMetadata: Record<string, TextureMetadata> = {};
            for (const [key, value] of Object.entries(scene.textureMetadata)) {
                if (isUUID(key)) {
                    newMetadata[key] = value;
                } else {
                    const uuid = await this.ensureMeta(key);
                    newMetadata[uuid] = value;
                    changed = true;
                }
            }
            scene.textureMetadata = newMetadata;
        }

        if (changed) {
            scene.version = '2.0';
        }

        return changed;
    }

    resolveSceneAssetPaths(scene: SceneData): void {
        for (const entity of scene.entities) {
            for (const comp of entity.components || []) {
                if (comp.type === 'Sprite' && comp.data) {
                    if (typeof comp.data.texture === 'string' && isUUID(comp.data.texture as string)) {
                        const path = this.getPath(comp.data.texture as string);
                        if (path) comp.data.texture = path;
                    }
                    if (typeof comp.data.material === 'string' && isUUID(comp.data.material as string)) {
                        const path = this.getPath(comp.data.material as string);
                        if (path) comp.data.material = path;
                    }
                }

                if (comp.type === 'SpineAnimation' && comp.data) {
                    if (typeof comp.data.skeletonPath === 'string' && isUUID(comp.data.skeletonPath as string)) {
                        const path = this.getPath(comp.data.skeletonPath as string);
                        if (path) comp.data.skeletonPath = path;
                    }
                    if (typeof comp.data.atlasPath === 'string' && isUUID(comp.data.atlasPath as string)) {
                        const path = this.getPath(comp.data.atlasPath as string);
                        if (path) comp.data.atlasPath = path;
                    }
                    if (typeof comp.data.material === 'string' && isUUID(comp.data.material as string)) {
                        const path = this.getPath(comp.data.material as string);
                        if (path) comp.data.material = path;
                    }
                }
            }
        }

        if (scene.textureMetadata) {
            const resolved: Record<string, TextureMetadata> = {};
            for (const [key, value] of Object.entries(scene.textureMetadata)) {
                if (isUUID(key)) {
                    const path = this.getPath(key);
                    if (path) {
                        resolved[path] = value;
                    } else {
                        resolved[key] = value;
                    }
                } else {
                    resolved[key] = value;
                }
            }
            scene.textureMetadata = resolved;
        }
    }

    unregister(relativePath: string): void {
        const uuid = this.pathToUuid_.get(relativePath);
        if (uuid) {
            this.uuidToPath_.delete(uuid);
        }
        this.pathToUuid_.delete(relativePath);
    }

    updatePath(oldRelativePath: string, newRelativePath: string): void {
        const uuid = this.pathToUuid_.get(oldRelativePath);
        if (uuid) {
            this.uuidToPath_.set(uuid, newRelativePath);
        }
        this.pathToUuid_.delete(oldRelativePath);
        if (uuid) {
            this.pathToUuid_.set(newRelativePath, uuid);
        }
    }

    private register(uuid: string, relativePath: string): void {
        this.uuidToPath_.set(uuid, relativePath);
        this.pathToUuid_.set(relativePath, uuid);
    }

    private async scanDirectory(absolutePath: string, relativePath: string): Promise<void> {
        if (!this.fs_) return;

        const entries = await this.fs_.listDirectoryDetailed(absolutePath);

        for (const entry of entries) {
            const childAbsolute = joinPath(absolutePath, entry.name);
            const childRelative = `${relativePath}/${entry.name}`;

            if (entry.isDirectory) {
                await this.scanDirectory(childAbsolute, childRelative);
            } else if (entry.name.endsWith('.meta')) {
                const content = await this.fs_.readFile(childAbsolute);
                if (content) {
                    try {
                        const meta = JSON.parse(content) as AssetMeta;
                        if (meta.uuid) {
                            const assetRelPath = childRelative.replace(/\.meta$/, '');
                            this.register(meta.uuid, assetRelPath);
                        }
                    } catch {
                        // Skip invalid meta files
                    }
                }
            } else {
                const ext = getFileExtension(entry.name);
                if (ASSET_EXTENSIONS.has(ext)) {
                    const metaAbsolute = `${childAbsolute}.meta`;
                    if (!await this.fs_.exists(metaAbsolute)) {
                        await this.ensureMeta(childRelative);
                    }
                }
            }
        }
    }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: AssetLibrary | null = null;

export function getAssetLibrary(): AssetLibrary {
    if (!instance) {
        instance = new AssetLibrary();
    }
    return instance;
}

export function resetAssetLibrary(): void {
    instance = null;
}

/**
 * @file    MaterialLoader.ts
 * @brief   Material asset loading and caching
 */

import type { MaterialAssetData, MaterialHandle, ShaderHandle } from '../material';
import { Material } from '../material';
import { platformReadTextFile, platformFileExists } from '../platform';
import { AsyncCache } from './AsyncCache';

// =============================================================================
// Types
// =============================================================================

export interface LoadedMaterial {
    handle: MaterialHandle;
    shaderHandle: ShaderHandle;
    path: string;
}

export interface ShaderLoader {
    load(path: string): Promise<ShaderHandle>;
    get(path: string): ShaderHandle | undefined;
}

// =============================================================================
// MaterialLoader
// =============================================================================

export class MaterialLoader {
    private cache_ = new AsyncCache<LoadedMaterial>();
    private shaderLoader_: ShaderLoader;
    private basePath_: string;

    constructor(shaderLoader: ShaderLoader, basePath: string = '') {
        this.shaderLoader_ = shaderLoader;
        this.basePath_ = basePath;
    }

    async load(path: string): Promise<LoadedMaterial> {
        return this.cache_.getOrLoad(path, () => this.loadInternal(path), 0);
    }

    get(path: string): LoadedMaterial | undefined {
        return this.cache_.get(path);
    }

    has(path: string): boolean {
        return this.cache_.has(path);
    }

    release(path: string): void {
        const loaded = this.cache_.get(path);
        if (loaded) {
            Material.release(loaded.handle);
            this.cache_.delete(path);
        }
    }

    releaseAll(): void {
        for (const loaded of this.cache_.values()) {
            Material.release(loaded.handle);
        }
        this.cache_.clear();
    }

    private async loadInternal(path: string): Promise<LoadedMaterial> {
        const fullPath = this.resolvePath(path);
        const exists = await platformFileExists(fullPath);
        if (!exists) {
            throw new Error(`Material file not found: ${fullPath}`);
        }

        const content = await platformReadTextFile(fullPath);
        if (!content) {
            throw new Error(`Failed to read material file: ${fullPath}`);
        }

        const data = JSON.parse(content) as MaterialAssetData;
        if (data.type !== 'material') {
            throw new Error(`Invalid material file type: ${data.type}`);
        }

        const shaderPath = this.resolveShaderPath(path, data.shader);
        const shaderHandle = await this.shaderLoader_.load(shaderPath);
        const materialHandle = Material.createFromAsset(data, shaderHandle);

        return {
            handle: materialHandle,
            shaderHandle,
            path,
        };
    }

    private resolvePath(path: string): string {
        if (path.startsWith('/') || path.startsWith('http')) {
            return path;
        }
        return this.basePath_ ? `${this.basePath_}/${path}` : path;
    }

    private resolveShaderPath(materialPath: string, shaderPath: string): string {
        if (shaderPath.startsWith('/') || shaderPath.startsWith('http') || shaderPath.startsWith('assets/')) {
            return shaderPath;
        }
        const dir = materialPath.substring(0, materialPath.lastIndexOf('/'));
        return dir ? `${dir}/${shaderPath}` : shaderPath;
    }
}

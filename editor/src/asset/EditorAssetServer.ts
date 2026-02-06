/**
 * @file    EditorAssetServer.ts
 * @brief   AssetServer implementation for editor using NativeFS backend
 */

import type { ESEngineModule } from 'esengine';
import type { TextureInfo, SliceBorder, SpineLoadResult } from 'esengine';
import { EditorTextureManager } from '../renderer/EditorTextureManager';
import { AssetLoader } from './AssetLoader';
import type { AssetPathResolver } from './AssetPathResolver';

// =============================================================================
// EditorAssetServer
// =============================================================================

export class EditorAssetServer {
    private module_: ESEngineModule;
    private textureManager_: EditorTextureManager;
    private assetLoader_: AssetLoader;
    private pathResolver_: AssetPathResolver;

    constructor(module: ESEngineModule, pathResolver: AssetPathResolver) {
        this.module_ = module;
        this.pathResolver_ = pathResolver;
        this.textureManager_ = new EditorTextureManager(module, pathResolver);
        this.assetLoader_ = new AssetLoader(module, pathResolver);
    }

    // =========================================================================
    // SDK AssetServer Interface
    // =========================================================================

    async loadTexture(source: string): Promise<TextureInfo> {
        const handle = await this.textureManager_.loadTexture(source);
        const size = this.textureManager_.getSize(source);
        return {
            handle,
            width: size?.width ?? 0,
            height: size?.height ?? 0,
        };
    }

    async loadTextureRaw(source: string): Promise<TextureInfo> {
        const result = await this.assetLoader_.loadTexture(source);
        if (result.success && result.handle !== undefined) {
            return {
                handle: result.handle,
                width: 0,
                height: 0,
            };
        }
        return { handle: 0, width: 0, height: 0 };
    }

    async loadSpine(
        skeletonPath: string,
        atlasPath: string,
        _baseUrl?: string
    ): Promise<SpineLoadResult> {
        return this.assetLoader_.loadSpine(skeletonPath, atlasPath);
    }

    getTexture(source: string): TextureInfo | undefined {
        const handle = this.textureManager_.getHandle(source);
        if (handle === null) return undefined;

        const size = this.textureManager_.getSize(source);
        return {
            handle,
            width: size?.width ?? 0,
            height: size?.height ?? 0,
        };
    }

    hasTexture(source: string): boolean {
        return this.textureManager_.getHandle(source) !== null;
    }

    releaseTexture(source: string): void {
        this.textureManager_.release(source);
    }

    releaseAll(): void {
        this.textureManager_.releaseAll();
        this.assetLoader_.clearCache();
    }

    setTextureMetadata(handle: number, border: SliceBorder): void {
        const rm = this.module_.getResourceManager();
        rm.setTextureMetadata(handle, border.left, border.right, border.top, border.bottom);
    }

    setTextureMetadataByPath(source: string, border: SliceBorder): boolean {
        const handle = this.textureManager_.getHandle(source);
        if (handle !== null) {
            this.setTextureMetadata(handle, border);
            return true;
        }
        return false;
    }

    isSpineLoaded(skeletonPath: string, atlasPath: string): boolean {
        return this.assetLoader_.isSpineLoaded(skeletonPath, atlasPath);
    }

    // =========================================================================
    // Editor-specific Methods
    // =========================================================================

    get textureManager(): EditorTextureManager {
        return this.textureManager_;
    }

    get assetLoader(): AssetLoader {
        return this.assetLoader_;
    }
}

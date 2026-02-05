/**
 * @file    AssetLoader.ts
 * @brief   Asset loading for editor with Emscripten virtual filesystem support
 */

import type { ESEngineModule } from 'esengine';
import type { AssetPathResolver } from './AssetPathResolver';

interface DecodedImage {
    width: number;
    height: number;
    data: Uint8Array;
}

interface NativeFS {
    readFile(path: string): Promise<string | null>;
    readBinaryFile(path: string): Promise<Uint8Array | null>;
}

export interface LoadResult {
    success: boolean;
    error?: string;
}

interface SpineLoadState {
    skeleton: boolean;
    atlas: boolean;
    textures: Map<string, number>;
}

export class AssetLoader {
    private module_: ESEngineModule;
    private pathResolver_: AssetPathResolver;
    private loadedTextures_: Map<string, number> = new Map();
    private loadedSpines_: Map<string, SpineLoadState> = new Map();
    private virtualFSPaths_: Set<string> = new Set();

    constructor(module: ESEngineModule, pathResolver: AssetPathResolver) {
        this.module_ = module;
        this.pathResolver_ = pathResolver;
    }

    async loadTexture(relativePath: string): Promise<{ success: boolean; handle?: number; error?: string }> {
        const existing = this.loadedTextures_.get(relativePath);
        if (existing !== undefined) {
            return { success: true, handle: existing };
        }

        const fs = this.getNativeFS();
        if (!fs) {
            return { success: false, error: 'Native filesystem not available' };
        }

        const absolutePath = this.pathResolver_.toAbsolutePath(relativePath);
        const data = await fs.readBinaryFile(absolutePath);
        if (!data) {
            return { success: false, error: `Failed to read: ${absolutePath}` };
        }

        const decoded = await this.decodeImage(data);
        if (!decoded) {
            return { success: false, error: `Failed to decode: ${relativePath}` };
        }

        const rm = this.module_.getResourceManager();
        if (!rm) {
            return { success: false, error: 'ResourceManager not available' };
        }

        const pixelPtr = this.module_._malloc(decoded.data.length);
        this.module_.HEAPU8.set(decoded.data, pixelPtr);

        const handleId = rm.createTexture(decoded.width, decoded.height, pixelPtr, decoded.data.length, 1);
        this.module_._free(pixelPtr);

        const INVALID_HANDLE = 0xFFFFFFFF;
        if (handleId === INVALID_HANDLE) {
            return { success: false, error: `Failed to create GPU texture: ${relativePath}` };
        }

        rm.registerTextureWithPath(handleId, relativePath);
        this.loadedTextures_.set(relativePath, handleId);

        return { success: true, handle: handleId };
    }

    async loadSpine(skeletonPath: string, atlasPath: string): Promise<LoadResult> {
        const cacheKey = `${skeletonPath}:${atlasPath}`;
        const existing = this.loadedSpines_.get(cacheKey);
        if (existing?.skeleton && existing?.atlas && existing.textures.size > 0) {
            return { success: true };
        }

        const fs = this.getNativeFS();
        if (!fs) {
            return { success: false, error: 'Native filesystem not available' };
        }

        const state: SpineLoadState = existing ?? { skeleton: false, atlas: false, textures: new Map() };

        if (!state.atlas) {
            const atlasAbsPath = this.pathResolver_.toAbsolutePath(atlasPath);
            const atlasContent = await fs.readFile(atlasAbsPath);
            if (!atlasContent) {
                return { success: false, error: `Failed to read atlas: ${atlasAbsPath}` };
            }

            if (!this.writeToVirtualFS(atlasPath, atlasContent)) {
                return { success: false, error: `Failed to write atlas: ${atlasPath}` };
            }
            state.atlas = true;

            const atlasDir = atlasPath.substring(0, atlasPath.lastIndexOf('/'));
            const textureNames = this.parseAtlasTextures(atlasContent);

            for (const texName of textureNames) {
                const texPath = atlasDir ? `${atlasDir}/${texName}` : texName;

                if (state.textures.has(texPath)) continue;

                const result = await this.loadTexture(texPath);
                if (result.success && result.handle !== undefined) {
                    state.textures.set(texPath, result.handle);
                } else {
                    console.error(`[AssetLoader] Failed to load Spine texture: ${texPath} - ${result.error}`);
                }
            }
        }

        if (!state.skeleton) {
            const skelAbsPath = this.pathResolver_.toAbsolutePath(skeletonPath);
            const isBinary = skeletonPath.endsWith('.skel');
            const skelData = isBinary
                ? await fs.readBinaryFile(skelAbsPath)
                : await fs.readFile(skelAbsPath);

            if (!skelData) {
                return { success: false, error: `Failed to read skeleton: ${skelAbsPath}` };
            }

            if (!this.writeToVirtualFS(skeletonPath, skelData)) {
                return { success: false, error: `Failed to write skeleton: ${skeletonPath}` };
            }
            state.skeleton = true;
        }

        this.loadedSpines_.set(cacheKey, state);
        return { success: true };
    }

    isTextureLoaded(path: string): boolean {
        return this.loadedTextures_.has(path);
    }

    isSpineLoaded(skeletonPath: string, atlasPath: string): boolean {
        const cacheKey = `${skeletonPath}:${atlasPath}`;
        const state = this.loadedSpines_.get(cacheKey);
        return !!(state?.skeleton && state?.atlas);
    }

    getTextureHandle(path: string): number | undefined {
        return this.loadedTextures_.get(path);
    }

    releaseTexture(path: string): void {
        const handle = this.loadedTextures_.get(path);
        if (handle !== undefined) {
            const rm = this.module_.getResourceManager();
            rm?.releaseTexture(handle);
            this.loadedTextures_.delete(path);
        }
    }

    clearCache(): void {
        this.loadedTextures_.clear();
        this.loadedSpines_.clear();
        this.virtualFSPaths_.clear();
    }

    private writeToVirtualFS(virtualPath: string, data: string | Uint8Array): boolean {
        if (this.virtualFSPaths_.has(virtualPath)) {
            return true;
        }

        const emscriptenFs = this.getEmscriptenFS();
        if (!emscriptenFs) {
            return false;
        }

        try {
            this.ensureVirtualDir(virtualPath);
            emscriptenFs.writeFile(virtualPath, data);
            this.virtualFSPaths_.add(virtualPath);
            return true;
        } catch (e) {
            console.error(`[AssetLoader] Failed to write to virtual FS: ${virtualPath}`, e);
            return false;
        }
    }

    private ensureVirtualDir(virtualPath: string): void {
        const emscriptenFs = this.getEmscriptenFS();
        if (!emscriptenFs) return;

        const dir = virtualPath.substring(0, virtualPath.lastIndexOf('/'));
        if (!dir) return;

        const parts = dir.split('/').filter(p => p);
        let currentPath = '';

        for (const part of parts) {
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            try {
                const analysis = emscriptenFs.analyzePath(currentPath);
                if (!analysis.exists) {
                    emscriptenFs.mkdir(currentPath);
                }
            } catch {
                try {
                    emscriptenFs.mkdir(currentPath);
                } catch {
                    // Directory might already exist
                }
            }
        }
    }

    private parseAtlasTextures(atlasContent: string): string[] {
        const textures: string[] = [];
        const lines = atlasContent.split('\n');

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.includes(':') &&
                (trimmed.endsWith('.png') || trimmed.endsWith('.jpg'))) {
                textures.push(trimmed);
            }
        }

        return textures;
    }

    private getNativeFS(): NativeFS | null {
        return (window as any).__esengine_fs ?? null;
    }

    private getEmscriptenFS(): any {
        return this.module_.FS ?? null;
    }

    private async decodeImage(data: Uint8Array): Promise<DecodedImage | null> {
        try {
            const blob = new Blob([new Uint8Array(data)]);
            const bitmap = await createImageBitmap(blob);

            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                bitmap.close();
                return null;
            }

            ctx.drawImage(bitmap, 0, 0);
            bitmap.close();

            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

            return {
                width: canvas.width,
                height: canvas.height,
                data: new Uint8Array(imageData.data.buffer)
            };
        } catch (e) {
            console.error('[AssetLoader] Failed to decode image:', e);
            return null;
        }
    }
}

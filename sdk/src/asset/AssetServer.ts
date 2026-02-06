/**
 * @file    AssetServer.ts
 * @brief   Asset loading and caching system
 */

import type { TextureHandle } from '../types';
import type { ESEngineModule } from '../wasm';
import type { MaterialHandle, ShaderHandle } from '../material';
import { Material } from '../material';
import { MaterialLoader, type LoadedMaterial, type ShaderLoader } from './MaterialLoader';
import { platformReadTextFile, platformFileExists } from '../platform';

// =============================================================================
// Types
// =============================================================================

export interface TextureInfo {
    handle: TextureHandle;
    width: number;
    height: number;
}

export interface SliceBorder {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

export interface SpineLoadResult {
    success: boolean;
    error?: string;
}

// =============================================================================
// AssetServer
// =============================================================================

export class AssetServer {
    private module_: ESEngineModule;
    private cache_ = new Map<string, TextureInfo>();
    private pending_ = new Map<string, Promise<TextureInfo>>();
    private canvas_: OffscreenCanvas | HTMLCanvasElement;
    private ctx_: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    private loadedSpines_ = new Map<string, boolean>();
    private virtualFSPaths_ = new Set<string>();
    private materialLoader_: MaterialLoader | null = null;
    private shaderCache_ = new Map<string, ShaderHandle>();
    private shaderPending_ = new Map<string, Promise<ShaderHandle>>();

    constructor(module: ESEngineModule) {
        this.module_ = module;

        if (typeof OffscreenCanvas !== 'undefined') {
            this.canvas_ = new OffscreenCanvas(512, 512);
            this.ctx_ = this.canvas_.getContext('2d', { willReadFrequently: true })!;
        } else {
            this.canvas_ = document.createElement('canvas');
            this.canvas_.width = 512;
            this.canvas_.height = 512;
            this.ctx_ = this.canvas_.getContext('2d', { willReadFrequently: true })!;
        }

        const shaderLoader: ShaderLoader = {
            load: (path: string) => this.loadShader(path),
            get: (path: string) => this.shaderCache_.get(path),
        };
        this.materialLoader_ = new MaterialLoader(shaderLoader);
    }

    // =========================================================================
    // Public API
    // =========================================================================

    /**
     * Load texture with vertical flip (for Sprite/UI).
     * OpenGL UV origin is bottom-left, so standard images need flipping.
     */
    async loadTexture(source: string): Promise<TextureInfo> {
        return this.loadTextureWithFlip(source, true);
    }

    /**
     * Load texture without flip (for Spine).
     * Spine runtime handles UV coordinates internally.
     */
    async loadTextureRaw(source: string): Promise<TextureInfo> {
        return this.loadTextureWithFlip(source, false);
    }

    getTexture(source: string): TextureInfo | undefined {
        return this.cache_.get(this.getCacheKey(source, true));
    }

    hasTexture(source: string): boolean {
        return this.cache_.has(this.getCacheKey(source, true));
    }

    releaseTexture(source: string): void {
        const rm = this.module_.getResourceManager();
        for (const flip of [true, false]) {
            const key = this.getCacheKey(source, flip);
            const info = this.cache_.get(key);
            if (info) {
                rm.releaseTexture(info.handle);
                this.cache_.delete(key);
            }
        }
    }

    releaseAll(): void {
        const rm = this.module_.getResourceManager();
        for (const info of this.cache_.values()) {
            rm.releaseTexture(info.handle);
        }
        this.cache_.clear();
    }

    setTextureMetadata(handle: TextureHandle, border: SliceBorder): void {
        const rm = this.module_.getResourceManager();
        rm.setTextureMetadata(handle, border.left, border.right, border.top, border.bottom);
    }

    setTextureMetadataByPath(source: string, border: SliceBorder): boolean {
        const info = this.cache_.get(this.getCacheKey(source, true));
        if (info) {
            this.setTextureMetadata(info.handle, border);
            return true;
        }
        return false;
    }

    async loadSpine(
        skeletonPath: string,
        atlasPath: string,
        baseUrl?: string
    ): Promise<SpineLoadResult> {
        const cacheKey = `${skeletonPath}:${atlasPath}`;
        if (this.loadedSpines_.get(cacheKey)) {
            return { success: true };
        }

        const resolveUrl = (path: string) => {
            if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('/')) {
                return path;
            }
            return baseUrl ? `${baseUrl}/${path}` : `/${path}`;
        };

        try {
            const atlasUrl = resolveUrl(atlasPath);
            const atlasResponse = await fetch(atlasUrl);
            if (!atlasResponse.ok) {
                return { success: false, error: `Failed to fetch atlas: ${atlasUrl}` };
            }
            const atlasContent = await atlasResponse.text();

            if (!this.writeToVirtualFS(atlasPath, atlasContent)) {
                return { success: false, error: `Failed to write atlas to virtual FS: ${atlasPath}` };
            }

            const atlasDir = atlasPath.substring(0, atlasPath.lastIndexOf('/'));
            const textureNames = this.parseAtlasTextures(atlasContent);

            for (const texName of textureNames) {
                const texPath = atlasDir ? `${atlasDir}/${texName}` : texName;
                const texUrl = resolveUrl(texPath);

                try {
                    const info = await this.loadTextureRaw(texUrl);
                    const rm = this.module_.getResourceManager();
                    rm.registerTextureWithPath(info.handle, texPath);
                } catch (err) {
                    console.warn(`[AssetServer] Failed to load Spine texture: ${texPath}`, err);
                }
            }

            const skelUrl = resolveUrl(skeletonPath);
            const skelResponse = await fetch(skelUrl);
            if (!skelResponse.ok) {
                return { success: false, error: `Failed to fetch skeleton: ${skelUrl}` };
            }

            const isBinary = skeletonPath.endsWith('.skel');
            const skelData = isBinary
                ? new Uint8Array(await skelResponse.arrayBuffer())
                : await skelResponse.text();

            if (!this.writeToVirtualFS(skeletonPath, skelData)) {
                return { success: false, error: `Failed to write skeleton to virtual FS: ${skeletonPath}` };
            }

            this.loadedSpines_.set(cacheKey, true);
            return { success: true };
        } catch (err) {
            return { success: false, error: String(err) };
        }
    }

    isSpineLoaded(skeletonPath: string, atlasPath: string): boolean {
        return this.loadedSpines_.get(`${skeletonPath}:${atlasPath}`) ?? false;
    }

    async loadMaterial(path: string, baseUrl?: string): Promise<LoadedMaterial> {
        if (!this.materialLoader_) {
            throw new Error('MaterialLoader not initialized');
        }
        const fullPath = this.resolveAssetPath(path, baseUrl);
        return this.materialLoader_.load(fullPath);
    }

    getMaterial(path: string, baseUrl?: string): LoadedMaterial | undefined {
        if (!this.materialLoader_) return undefined;
        const fullPath = this.resolveAssetPath(path, baseUrl);
        return this.materialLoader_.get(fullPath);
    }

    hasMaterial(path: string, baseUrl?: string): boolean {
        if (!this.materialLoader_) return false;
        const fullPath = this.resolveAssetPath(path, baseUrl);
        return this.materialLoader_.has(fullPath);
    }

    async loadShader(path: string): Promise<ShaderHandle> {
        const cached = this.shaderCache_.get(path);
        if (cached) return cached;

        const pending = this.shaderPending_.get(path);
        if (pending) return pending;

        const promise = this.loadShaderInternal(path);
        this.shaderPending_.set(path, promise);

        try {
            const handle = await promise;
            this.shaderCache_.set(path, handle);
            return handle;
        } finally {
            this.shaderPending_.delete(path);
        }
    }

    private async loadShaderInternal(path: string): Promise<ShaderHandle> {
        const exists = await platformFileExists(path);
        if (!exists) {
            throw new Error(`Shader file not found: ${path}`);
        }

        const content = await platformReadTextFile(path);
        if (!content) {
            throw new Error(`Failed to read shader file: ${path}`);
        }

        const { vertex, fragment } = this.parseEsShader(content);
        if (!vertex || !fragment) {
            throw new Error(`Invalid shader format: ${path}`);
        }

        return Material.createShader(vertex, fragment);
    }

    private parseEsShader(content: string): { vertex: string | null; fragment: string | null } {
        let vertex: string | null = null;
        let fragment: string | null = null;

        const vertexMatch = content.match(/#pragma\s+vertex\s*([\s\S]*?)#pragma\s+end/);
        const fragmentMatch = content.match(/#pragma\s+fragment\s*([\s\S]*?)#pragma\s+end/);

        if (vertexMatch) {
            vertex = vertexMatch[1].trim();
        }
        if (fragmentMatch) {
            fragment = fragmentMatch[1].trim();
        }

        return { vertex, fragment };
    }

    private resolveAssetPath(path: string, baseUrl?: string): string {
        if (path.startsWith('/') || path.startsWith('http')) {
            return path;
        }
        return baseUrl ? `${baseUrl}/${path}` : `/${path}`;
    }

    // =========================================================================
    // Private Methods
    // =========================================================================

    private getCacheKey(source: string, flip: boolean): string {
        return `${source}:${flip ? 'f' : 'n'}`;
    }

    private async loadTextureWithFlip(source: string, flip: boolean): Promise<TextureInfo> {
        const cacheKey = this.getCacheKey(source, flip);

        const cached = this.cache_.get(cacheKey);
        if (cached) {
            return cached;
        }

        const pending = this.pending_.get(cacheKey);
        if (pending) {
            return pending;
        }

        const promise = this.loadTextureInternal(source, flip);
        this.pending_.set(cacheKey, promise);

        try {
            const result = await promise;
            this.cache_.set(cacheKey, result);
            return result;
        } finally {
            this.pending_.delete(cacheKey);
        }
    }

    private async loadTextureInternal(source: string, flip: boolean): Promise<TextureInfo> {
        const img = await this.loadImage(source);
        return this.createTextureFromImage(img, flip);
    }

    private async loadImage(source: string): Promise<HTMLImageElement | ImageBitmap> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = async () => {
                if (typeof createImageBitmap !== 'undefined') {
                    try {
                        const bitmap = await createImageBitmap(img, {
                            premultiplyAlpha: 'none',
                            colorSpaceConversion: 'none'
                        });
                        resolve(bitmap);
                        return;
                    } catch {
                        // Fall back to Image element
                    }
                }
                resolve(img);
            };
            img.onerror = () => reject(new Error(`Failed to load image: ${source}`));
            img.src = source;
        });
    }

    private createTextureFromImage(img: HTMLImageElement | ImageBitmap, flip: boolean): TextureInfo {
        const { width, height } = img;

        if (this.canvas_.width < width || this.canvas_.height < height) {
            this.canvas_.width = Math.max(this.canvas_.width, this.nextPowerOf2(width));
            this.canvas_.height = Math.max(this.canvas_.height, this.nextPowerOf2(height));
        }

        this.ctx_.clearRect(0, 0, this.canvas_.width, this.canvas_.height);
        this.ctx_.save();
        if (flip) {
            this.ctx_.translate(0, height);
            this.ctx_.scale(1, -1);
        }
        this.ctx_.drawImage(img, 0, 0);
        this.ctx_.restore();

        const imageData = this.ctx_.getImageData(0, 0, width, height);
        const pixels = new Uint8Array(imageData.data.buffer);
        this.unpremultiplyAlpha(pixels);

        const rm = this.module_.getResourceManager();
        const ptr = this.module_._malloc(pixels.length);
        this.module_.HEAPU8.set(pixels, ptr);
        const handle = rm.createTexture(width, height, ptr, pixels.length, 1);
        this.module_._free(ptr);

        return { handle, width, height };
    }

    private unpremultiplyAlpha(pixels: Uint8Array): void {
        for (let i = 0; i < pixels.length; i += 4) {
            const a = pixels[i + 3];
            if (a > 0 && a < 255) {
                const scale = 255 / a;
                pixels[i] = Math.min(255, Math.round(pixels[i] * scale));
                pixels[i + 1] = Math.min(255, Math.round(pixels[i + 1] * scale));
                pixels[i + 2] = Math.min(255, Math.round(pixels[i + 2] * scale));
            }
        }
    }

    private nextPowerOf2(n: number): number {
        let p = 1;
        while (p < n) p *= 2;
        return p;
    }

    private writeToVirtualFS(virtualPath: string, data: string | Uint8Array): boolean {
        if (this.virtualFSPaths_.has(virtualPath)) {
            return true;
        }

        const fs = this.module_.FS;
        if (!fs) {
            return false;
        }

        try {
            this.ensureVirtualDir(virtualPath);
            fs.writeFile(virtualPath, data);
            this.virtualFSPaths_.add(virtualPath);
            return true;
        } catch (e) {
            console.error(`[AssetServer] Failed to write to virtual FS: ${virtualPath}`, e);
            return false;
        }
    }

    private ensureVirtualDir(virtualPath: string): void {
        const fs = this.module_.FS;
        if (!fs) return;

        const dir = virtualPath.substring(0, virtualPath.lastIndexOf('/'));
        if (!dir) return;

        const parts = dir.split('/').filter(p => p);
        let currentPath = '';

        for (const part of parts) {
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            try {
                const analysis = fs.analyzePath(currentPath);
                if (!analysis.exists) {
                    fs.mkdir(currentPath);
                }
            } catch {
                try {
                    fs.mkdir(currentPath);
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
}

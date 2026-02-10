/**
 * @file    AssetServer.ts
 * @brief   Asset loading and caching system
 */

import type { Entity, TextureHandle } from '../types';
import type { ESEngineModule } from '../wasm';
import type { ShaderHandle } from '../material';
import { Material } from '../material';
import { MaterialLoader, type LoadedMaterial, type ShaderLoader } from './MaterialLoader';
import { platformReadTextFile, platformReadFile, platformFileExists, platformFetch, platformCreateCanvas, platformCreateImage } from '../platform';
import type { World } from '../world';
import { loadSceneWithAssets, type SceneData } from '../scene';
import { AsyncCache } from './AsyncCache';

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

export interface SpineDescriptor {
    skeleton: string;
    atlas: string;
    baseUrl?: string;
}

export interface FileLoadOptions {
    baseUrl?: string;
    noCache?: boolean;
}

export interface AssetManifest {
    textures?: string[];
    materials?: string[];
    spine?: SpineDescriptor[];
    json?: string[];
    text?: string[];
    binary?: string[];
}

export interface AssetBundle {
    textures: Map<string, TextureInfo>;
    materials: Map<string, LoadedMaterial>;
    spine: Map<string, SpineLoadResult>;
    json: Map<string, unknown>;
    text: Map<string, string>;
    binary: Map<string, ArrayBuffer>;
}

// =============================================================================
// AssetServer
// =============================================================================

export class AssetServer {
    baseUrl?: string;

    private module_: ESEngineModule;
    private textureCache_ = new AsyncCache<TextureInfo>();
    private shaderCache_ = new AsyncCache<ShaderHandle>();
    private jsonCache_ = new AsyncCache<unknown>();
    private textCache_ = new AsyncCache<string>();
    private binaryCache_ = new AsyncCache<ArrayBuffer>();
    private loadedSpines_ = new Set<string>();
    private virtualFSPaths_ = new Set<string>();
    private materialLoader_: MaterialLoader;
    private canvas_: HTMLCanvasElement;
    private ctx_: CanvasRenderingContext2D;
    private embedded_ = new Map<string, string>();

    constructor(module: ESEngineModule) {
        this.module_ = module;
        this.canvas_ = platformCreateCanvas(512, 512) as HTMLCanvasElement;
        this.ctx_ = this.canvas_.getContext('2d', { willReadFrequently: true })!;

        const shaderLoader: ShaderLoader = {
            load: (path: string) => this.loadShader(path),
            get: (path: string) => this.shaderCache_.get(path),
        };
        this.materialLoader_ = new MaterialLoader(shaderLoader);
    }

    // =========================================================================
    // Embedded Assets
    // =========================================================================

    registerEmbeddedAssets(assets: Record<string, string>): void {
        for (const [key, value] of Object.entries(assets)) {
            this.embedded_.set(key, value);
        }
    }

    // =========================================================================
    // Texture
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
        return this.textureCache_.get(this.textureCacheKey(source, true));
    }

    hasTexture(source: string): boolean {
        return this.textureCache_.has(this.textureCacheKey(source, true));
    }

    releaseTexture(source: string): void {
        const rm = this.module_.getResourceManager();
        for (const flip of [true, false]) {
            const key = this.textureCacheKey(source, flip);
            const info = this.textureCache_.get(key);
            if (info) {
                rm.releaseTexture(info.handle);
                this.textureCache_.delete(key);
            }
        }
    }

    releaseAll(): void {
        const rm = this.module_.getResourceManager();
        for (const info of this.textureCache_.values()) {
            rm.releaseTexture(info.handle);
        }
        this.textureCache_.clear();
        this.jsonCache_.clear();
        this.textCache_.clear();
        this.binaryCache_.clear();
    }

    setTextureMetadata(handle: TextureHandle, border: SliceBorder): void {
        const rm = this.module_.getResourceManager();
        rm.setTextureMetadata(handle, border.left, border.right, border.top, border.bottom);
    }

    setTextureMetadataByPath(source: string, border: SliceBorder): boolean {
        const info = this.textureCache_.get(this.textureCacheKey(source, true));
        if (info) {
            this.setTextureMetadata(info.handle, border);
            return true;
        }
        return false;
    }

    // =========================================================================
    // Spine
    // =========================================================================

    async loadSpine(
        skeletonPath: string,
        atlasPath: string,
        baseUrl?: string
    ): Promise<SpineLoadResult> {
        const cacheKey = `${skeletonPath}:${atlasPath}`;
        if (this.loadedSpines_.has(cacheKey)) {
            return { success: true };
        }

        try {
            const atlasUrl = this.resolveUrl(atlasPath, baseUrl);
            const atlasContent = await this.fetchText(atlasUrl);

            if (!this.writeToVirtualFS(atlasPath, atlasContent)) {
                return { success: false, error: `Failed to write atlas to virtual FS: ${atlasPath}` };
            }

            const atlasDir = atlasPath.substring(0, atlasPath.lastIndexOf('/'));
            const textureNames = this.parseAtlasTextures(atlasContent);

            for (const texName of textureNames) {
                const texPath = atlasDir ? `${atlasDir}/${texName}` : texName;
                const texUrl = this.resolveUrl(texPath, baseUrl);

                try {
                    const info = await this.loadTextureRaw(texUrl);
                    const rm = this.module_.getResourceManager();
                    rm.registerTextureWithPath(info.handle, texPath);
                } catch (err) {
                    console.warn(`[AssetServer] Failed to load Spine texture: ${texPath}`, err);
                }
            }

            const skelUrl = this.resolveUrl(skeletonPath, baseUrl);
            const isBinary = skeletonPath.endsWith('.skel');
            const skelData = isBinary
                ? new Uint8Array(await this.fetchBinary(skelUrl))
                : await this.fetchText(skelUrl);

            if (!this.writeToVirtualFS(skeletonPath, skelData)) {
                return { success: false, error: `Failed to write skeleton to virtual FS: ${skeletonPath}` };
            }

            this.loadedSpines_.add(cacheKey);
            return { success: true };
        } catch (err) {
            return { success: false, error: String(err) };
        }
    }

    isSpineLoaded(skeletonPath: string, atlasPath: string): boolean {
        return this.loadedSpines_.has(`${skeletonPath}:${atlasPath}`);
    }

    // =========================================================================
    // Material & Shader
    // =========================================================================

    async loadMaterial(path: string, baseUrl?: string): Promise<LoadedMaterial> {
        return this.materialLoader_.load(this.resolveUrl(path, baseUrl));
    }

    getMaterial(path: string, baseUrl?: string): LoadedMaterial | undefined {
        return this.materialLoader_.get(this.resolveUrl(path, baseUrl));
    }

    hasMaterial(path: string, baseUrl?: string): boolean {
        return this.materialLoader_.has(this.resolveUrl(path, baseUrl));
    }

    async loadShader(path: string): Promise<ShaderHandle> {
        return this.shaderCache_.getOrLoad(path, () => this.loadShaderInternal(path));
    }

    // =========================================================================
    // Generic File Loading
    // =========================================================================

    async loadJson<T = unknown>(path: string, options?: FileLoadOptions): Promise<T> {
        const url = this.resolveUrl(path, options?.baseUrl);
        if (options?.noCache) {
            return this.fetchJson(url) as Promise<T>;
        }
        return this.jsonCache_.getOrLoad(url, () => this.fetchJson(url)) as Promise<T>;
    }

    async loadText(path: string, options?: FileLoadOptions): Promise<string> {
        const url = this.resolveUrl(path, options?.baseUrl);
        if (options?.noCache) {
            return this.fetchText(url);
        }
        return this.textCache_.getOrLoad(url, () => this.fetchText(url));
    }

    async loadBinary(path: string, options?: FileLoadOptions): Promise<ArrayBuffer> {
        const url = this.resolveUrl(path, options?.baseUrl);
        if (options?.noCache) {
            return this.fetchBinary(url);
        }
        return this.binaryCache_.getOrLoad(url, () => this.fetchBinary(url));
    }

    // =========================================================================
    // Scene & Batch
    // =========================================================================

    async loadScene(world: World, sceneData: SceneData): Promise<Map<number, Entity>> {
        return loadSceneWithAssets(world, sceneData, { assetServer: this });
    }

    async loadAll(manifest: AssetManifest): Promise<AssetBundle> {
        const bundle: AssetBundle = {
            textures: new Map(),
            materials: new Map(),
            spine: new Map(),
            json: new Map(),
            text: new Map(),
            binary: new Map(),
        };

        const promises: Promise<void>[] = [];

        if (manifest.textures) {
            for (const path of manifest.textures) {
                promises.push(
                    this.loadTexture(path).then(info => { bundle.textures.set(path, info); })
                );
            }
        }

        if (manifest.materials) {
            for (const path of manifest.materials) {
                promises.push(
                    this.loadMaterial(path).then(mat => { bundle.materials.set(path, mat); })
                );
            }
        }

        if (manifest.spine) {
            for (const desc of manifest.spine) {
                const key = `${desc.skeleton}:${desc.atlas}`;
                promises.push(
                    this.loadSpine(desc.skeleton, desc.atlas, desc.baseUrl).then(result => {
                        bundle.spine.set(key, result);
                    })
                );
            }
        }

        if (manifest.json) {
            for (const path of manifest.json) {
                promises.push(
                    this.loadJson(path).then(data => { bundle.json.set(path, data); })
                );
            }
        }

        if (manifest.text) {
            for (const path of manifest.text) {
                promises.push(
                    this.loadText(path).then(data => { bundle.text.set(path, data); })
                );
            }
        }

        if (manifest.binary) {
            for (const path of manifest.binary) {
                promises.push(
                    this.loadBinary(path).then(data => { bundle.binary.set(path, data); })
                );
            }
        }

        await Promise.all(promises);
        return bundle;
    }

    // =========================================================================
    // Private - Texture
    // =========================================================================

    private textureCacheKey(source: string, flip: boolean): string {
        return `${source}:${flip ? 'f' : 'n'}`;
    }

    private async loadTextureWithFlip(source: string, flip: boolean): Promise<TextureInfo> {
        const cacheKey = this.textureCacheKey(source, flip);
        return this.textureCache_.getOrLoad(cacheKey, () => this.loadTextureInternal(source, flip));
    }

    private async loadTextureInternal(source: string, flip: boolean): Promise<TextureInfo> {
        const img = await this.loadImage(source);
        return this.createTextureFromImage(img, flip);
    }

    private async loadImage(source: string): Promise<HTMLImageElement | ImageBitmap> {
        const localPath = this.isLocalPath(source) ? this.toLocalPath(source) : source;
        const embedded = this.embedded_.get(localPath);
        const imgSrc = embedded ?? localPath;
        return new Promise((resolve, reject) => {
            const img = platformCreateImage();
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
            img.src = imgSrc;
        });
    }

    private createTextureFromImage(img: HTMLImageElement | ImageBitmap, flip: boolean): TextureInfo {
        const { width, height } = img;
        const gl = this.getWebGL2Context();

        if (gl) {
            return this.createTextureWebGL2(gl, img, width, height, flip);
        }

        return this.createTextureFallback(img, width, height, flip);
    }

    private getWebGL2Context(): WebGL2RenderingContext | null {
        try {
            const glObj = (this.module_ as any).GL;
            if (glObj && glObj.currentContext && glObj.currentContext.GLctx) {
                const ctx = glObj.currentContext.GLctx;
                if (ctx instanceof WebGL2RenderingContext) {
                    return ctx;
                }
            }
        } catch {
            // Fall through to fallback
        }
        return null;
    }

    private createTextureWebGL2(
        gl: WebGL2RenderingContext,
        img: HTMLImageElement | ImageBitmap,
        width: number,
        height: number,
        flip: boolean,
    ): TextureInfo {
        const texture = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, texture);

        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip ? 1 : 0);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);

        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img as any);

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        gl.generateMipmap(gl.TEXTURE_2D);

        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);

        const glObj = (this.module_ as any).GL;
        const glTextureId = glObj.getNewId(glObj.textures);
        glObj.textures[glTextureId] = texture;

        const rm = this.module_.getResourceManager();
        const handle = rm.registerExternalTexture(glTextureId, width, height);

        return { handle, width, height };
    }

    private createTextureFallback(
        img: HTMLImageElement | ImageBitmap,
        width: number,
        height: number,
        flip: boolean,
    ): TextureInfo {
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

    // =========================================================================
    // Private - Shader
    // =========================================================================

    private async loadShaderInternal(path: string): Promise<ShaderHandle> {
        const localPath = this.isLocalPath(path) ? this.toLocalPath(path) : path;
        const exists = await platformFileExists(localPath);
        if (!exists) {
            throw new Error(`Shader file not found: ${path}`);
        }

        const content = await platformReadTextFile(localPath);
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
        const vertexMatch = content.match(/#pragma\s+vertex\s*([\s\S]*?)#pragma\s+end/);
        const fragmentMatch = content.match(/#pragma\s+fragment\s*([\s\S]*?)#pragma\s+end/);
        return {
            vertex: vertexMatch?.[1].trim() ?? null,
            fragment: fragmentMatch?.[1].trim() ?? null,
        };
    }

    // =========================================================================
    // Private - Generic Fetch
    // =========================================================================

    private decodeDataUrlText(dataUrl: string): string {
        return atob(dataUrl.split(',')[1]);
    }

    private decodeDataUrlBinary(dataUrl: string): ArrayBuffer {
        const raw = atob(dataUrl.split(',')[1]);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) {
            bytes[i] = raw.charCodeAt(i);
        }
        return bytes.buffer;
    }

    private isLocalPath(url: string): boolean {
        return !url.startsWith('http://') && !url.startsWith('https://');
    }

    private toLocalPath(url: string): string {
        return url.startsWith('/') ? url.substring(1) : url;
    }

    private async fetchJson(url: string): Promise<unknown> {
        const localPath = this.isLocalPath(url) ? this.toLocalPath(url) : null;
        if (localPath) {
            const embedded = this.embedded_.get(localPath);
            if (embedded) {
                return JSON.parse(this.decodeDataUrlText(embedded));
            }
            const text = await platformReadTextFile(localPath);
            return JSON.parse(text);
        }
        const response = await platformFetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch JSON: ${url} (${response.status})`);
        }
        return response.json();
    }

    private async fetchText(url: string): Promise<string> {
        const localPath = this.isLocalPath(url) ? this.toLocalPath(url) : null;
        if (localPath) {
            const embedded = this.embedded_.get(localPath);
            if (embedded) {
                return this.decodeDataUrlText(embedded);
            }
            return platformReadTextFile(localPath);
        }
        const response = await platformFetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch text: ${url} (${response.status})`);
        }
        return response.text();
    }

    private async fetchBinary(url: string): Promise<ArrayBuffer> {
        const localPath = this.isLocalPath(url) ? this.toLocalPath(url) : null;
        if (localPath) {
            const embedded = this.embedded_.get(localPath);
            if (embedded) {
                return this.decodeDataUrlBinary(embedded);
            }
            return platformReadFile(localPath);
        }
        const response = await platformFetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch binary: ${url} (${response.status})`);
        }
        return response.arrayBuffer();
    }

    // =========================================================================
    // Private - Virtual FS
    // =========================================================================

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

    // =========================================================================
    // Private - Utilities
    // =========================================================================

    private resolveUrl(path: string, baseUrl?: string): string {
        if (path.startsWith('/') || path.startsWith('http://') || path.startsWith('https://')) {
            return path;
        }
        const base = baseUrl ?? this.baseUrl;
        return base ? `${base}/${path}` : `/${path}`;
    }

    private nextPowerOf2(n: number): number {
        let p = 1;
        while (p < n) p *= 2;
        return p;
    }

    private parseAtlasTextures(atlasContent: string): string[] {
        const textures: string[] = [];
        for (const line of atlasContent.split('\n')) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.includes(':') &&
                (trimmed.endsWith('.png') || trimmed.endsWith('.jpg'))) {
                textures.push(trimmed);
            }
        }
        return textures;
    }
}

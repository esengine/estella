/**
 * @file    AssetServer.ts
 * @brief   Asset loading and caching system
 */

import type { Entity, TextureHandle, FontHandle } from '../types';
import { DEFAULT_TEXT_CANVAS_SIZE } from '../defaults';
import type { ESEngineModule } from '../wasm';
import type { ShaderHandle } from '../material';
import { Material } from '../material';
import { MaterialLoader, type LoadedMaterial, type ShaderLoader } from './MaterialLoader';
import { platformReadTextFile, platformReadFile, platformFileExists, platformFetch, platformCreateCanvas, platformCreateImage } from '../platform';
import type { World } from '../world';
import { loadSceneWithAssets, type SceneData } from '../scene';
import { AsyncCache } from './AsyncCache';
import type { PrefabData } from '../prefab';
import type { SpineModuleController } from '../spine/SpineController';

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

export type AddressableAssetType =
    | 'texture' | 'material' | 'spine' | 'bitmap-font'
    | 'prefab' | 'json' | 'text' | 'binary' | 'audio';

export interface AddressableResultMap {
    texture: TextureInfo;
    material: LoadedMaterial;
    spine: SpineLoadResult;
    'bitmap-font': FontHandle;
    prefab: PrefabData;
    json: unknown;
    text: string;
    binary: ArrayBuffer;
    audio: ArrayBuffer;
}

export interface AssetBundle {
    textures: Map<string, TextureInfo>;
    materials: Map<string, LoadedMaterial>;
    spine: Map<string, SpineLoadResult>;
    fonts: Map<string, FontHandle>;
    prefabs: Map<string, PrefabData>;
    json: Map<string, unknown>;
    text: Map<string, string>;
    binary: Map<string, ArrayBuffer>;
}

export interface AddressableManifestAsset {
    path: string;
    address?: string;
    type: AddressableAssetType;
    size: number;
    labels: string[];
    metadata?: {
        atlas?: string;
        atlasPage?: number;
        atlasFrame?: { x: number; y: number; width: number; height: number };
    };
}

export interface AddressableManifestGroup {
    bundleMode: string;
    labels: string[];
    assets: Record<string, AddressableManifestAsset>;
}

export interface AddressableManifest {
    version: '2.0';
    groups: Record<string, AddressableManifestGroup>;
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
    private fontCache_ = new AsyncCache<FontHandle>();
    private prefabCache_ = new AsyncCache<PrefabData>();
    private embedded_ = new Map<string, string>();
    private embeddedOnly_ = false;
    private addressableManifest_: AddressableManifest | null = null;
    private addressIndex_ = new Map<string, AddressableManifestAsset>();
    private labelIndex_ = new Map<string, AddressableManifestAsset[]>();
    private groupAssets_ = new Map<string, AddressableManifestAsset[]>();
    private spineController_: SpineModuleController | null = null;
    private spineSkeletons_ = new Map<string, number>();

    constructor(module: ESEngineModule) {
        this.module_ = module;
        this.canvas_ = platformCreateCanvas(DEFAULT_TEXT_CANVAS_SIZE, DEFAULT_TEXT_CANVAS_SIZE) as HTMLCanvasElement;
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
        if (!this.embeddedOnly_) {
            this.embeddedOnly_ = typeof location !== 'undefined' && location.protocol === 'file:';
        }
    }

    setEmbeddedOnly(value: boolean): void {
        this.embeddedOnly_ = value;
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
        for (const handle of this.fontCache_.values()) {
            rm.releaseBitmapFont(handle);
        }
        this.textureCache_.clear();
        this.fontCache_.clear();
        this.prefabCache_.clear();
        this.jsonCache_.clear();
        this.textCache_.clear();
        this.binaryCache_.clear();
        this.loadedSpines_.clear();
        if (this.spineController_) {
            for (const handle of this.spineSkeletons_.values()) {
                this.spineController_.unloadSkeleton(handle);
            }
        }
        this.spineSkeletons_.clear();
        this.cleanupVirtualFS();
    }

    private cleanupVirtualFS(): void {
        const fs = this.module_.FS;
        if (!fs) return;
        for (const path of this.virtualFSPaths_) {
            try {
                fs.unlink(path);
            } catch {
                // File may already be removed
            }
        }
        this.virtualFSPaths_.clear();
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

    setSpineController(controller: SpineModuleController): void {
        this.spineController_ = controller;
    }

    getSpineSkeletonHandle(skeletonPath: string, atlasPath: string): number | undefined {
        return this.spineSkeletons_.get(`${skeletonPath}:${atlasPath}`);
    }

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
            const loadedTextures: { name: string; info: TextureInfo }[] = [];

            for (const texName of textureNames) {
                const texPath = atlasDir ? `${atlasDir}/${texName}` : texName;
                const texUrl = this.resolveUrl(texPath, baseUrl);

                try {
                    const info = await this.loadTextureRaw(texUrl);
                    const rm = this.module_.getResourceManager();
                    rm.registerTextureWithPath(info.handle, texPath);
                    loadedTextures.push({ name: texName, info });
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

            if (this.spineController_) {
                const skelHandle = this.spineController_.loadSkeleton(skelData, atlasContent, isBinary);
                if (skelHandle >= 0) {
                    const rm = this.module_.getResourceManager();
                    const pageCount = this.spineController_.getAtlasPageCount(skelHandle);
                    for (let i = 0; i < pageCount; i++) {
                        const pageName = this.spineController_.getAtlasPageTextureName(skelHandle, i);
                        const tex = loadedTextures.find(t => t.name === pageName);
                        if (tex) {
                            const glId = rm.getTextureGLId(tex.info.handle);
                            this.spineController_.setAtlasPageTexture(
                                skelHandle, i, glId, tex.info.width, tex.info.height
                            );
                        }
                    }
                    this.spineSkeletons_.set(cacheKey, skelHandle);
                }
            }

            return { success: true };
        } catch (err) {
            return { success: false, error: String(err) };
        }
    }

    isSpineLoaded(skeletonPath: string, atlasPath: string): boolean {
        return this.loadedSpines_.has(`${skeletonPath}:${atlasPath}`);
    }

    // =========================================================================
    // BitmapFont
    // =========================================================================

    async loadBitmapFont(fontPath: string, baseUrl?: string): Promise<FontHandle> {
        const url = this.resolveUrl(fontPath, baseUrl);
        return this.fontCache_.getOrLoad(url, async () => {
            if (fontPath.endsWith('.bmfont')) {
                return this.loadBmfontAsset(url);
            }
            return this.loadFntFile(url);
        });
    }

    getFont(fontPath: string): FontHandle | undefined {
        return this.fontCache_.get(fontPath);
    }

    releaseFont(fontPath: string): void {
        const handle = this.fontCache_.get(fontPath);
        if (handle) {
            const rm = this.module_.getResourceManager();
            rm.releaseBitmapFont(handle);
            this.fontCache_.delete(fontPath);
        }
    }

    private async loadBmfontAsset(url: string): Promise<FontHandle> {
        const json = await this.fetchJson(url) as {
            type: string;
            fntFile?: string;
            generatedFnt?: string;
        };
        const dir = url.substring(0, url.lastIndexOf('/'));

        const fntFile = json.type === 'label-atlas'
            ? json.generatedFnt
            : json.fntFile;

        if (!fntFile) {
            throw new Error(`Invalid bmfont asset: no fnt file specified`);
        }
        const fntUrl = dir ? `${dir}/${fntFile}` : fntFile;
        return this.loadFntFile(fntUrl);
    }

    private async loadFntFile(url: string): Promise<FontHandle> {
        const fntContent = await this.fetchText(url);
        const pageMatch = fntContent.match(/file="([^"]+)"/);
        if (!pageMatch) {
            throw new Error(`No page texture found in .fnt file: ${url}`);
        }
        const texName = pageMatch[1];
        const fntDir = url.substring(0, url.lastIndexOf('/'));
        const texUrl = fntDir ? `${fntDir}/${texName}` : texName;
        const texInfo = await this.loadTextureRaw(texUrl);
        const rm = this.module_.getResourceManager();
        return rm.loadBitmapFont(fntContent, texInfo.handle, texInfo.width, texInfo.height) as FontHandle;
    }

    // =========================================================================
    // Prefab
    // =========================================================================

    async loadPrefab(path: string, baseUrl?: string): Promise<PrefabData> {
        const url = this.resolveUrl(path, baseUrl);
        return this.prefabCache_.getOrLoad(url, () =>
            this.fetchJson(url) as Promise<PrefabData>
        );
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

    async loadAll(manifest: AddressableManifest): Promise<AssetBundle> {
        this.setAddressableManifest(manifest);
        const allAssets: AddressableManifestAsset[] = [];
        if (manifest.groups) {
            for (const group of Object.values(manifest.groups)) {
                if (group.assets) {
                    allAssets.push(...Object.values(group.assets));
                }
            }
        }
        return this.loadAddressableAssets(allAssets);
    }

    // =========================================================================
    // Addressable Assets
    // =========================================================================

    setAddressableManifest(manifest: AddressableManifest): void {
        this.addressableManifest_ = manifest;
        this.addressIndex_.clear();
        this.labelIndex_.clear();
        this.groupAssets_.clear();

        for (const [groupName, group] of Object.entries(manifest.groups || {})) {
            const groupList: AddressableManifestAsset[] = [];
            for (const asset of Object.values(group.assets)) {
                groupList.push(asset);
                if (asset.address) {
                    this.addressIndex_.set(asset.address, asset);
                }
                for (const label of asset.labels) {
                    let list = this.labelIndex_.get(label);
                    if (!list) {
                        list = [];
                        this.labelIndex_.set(label, list);
                    }
                    list.push(asset);
                }
            }
            this.groupAssets_.set(groupName, groupList);
        }
    }

    resolveAddress(address: string): AddressableManifestAsset | undefined {
        return this.addressIndex_.get(address);
    }

    async load<T extends AddressableAssetType = AddressableAssetType>(
        address: string
    ): Promise<AddressableResultMap[T]> {
        const asset = this.addressIndex_.get(address);
        if (!asset) {
            throw new Error(`No asset found with address: ${address}`);
        }
        return this.loadAddressableAsset(asset) as Promise<AddressableResultMap[T]>;
    }

    async loadByLabel(label: string): Promise<AssetBundle> {
        const assets = this.labelIndex_.get(label) ?? [];
        return this.loadAddressableAssets(assets);
    }

    async loadGroup(groupName: string): Promise<AssetBundle> {
        const assets = this.groupAssets_.get(groupName) ?? [];
        return this.loadAddressableAssets(assets);
    }

    private async loadAddressableAsset(asset: AddressableManifestAsset): Promise<unknown> {
        switch (asset.type) {
            case 'texture':
                return this.loadTexture(asset.path);
            case 'material':
                return this.loadMaterial(asset.path);
            case 'spine': {
                const atlas = asset.metadata?.atlas;
                if (!atlas) throw new Error(`Spine asset missing atlas metadata: ${asset.path}`);
                return this.loadSpine(asset.path, atlas);
            }
            case 'bitmap-font':
                return this.loadBitmapFont(asset.path);
            case 'prefab':
                return this.loadPrefab(asset.path);
            case 'audio':
                return this.loadBinary(asset.path);
            case 'json':
                return this.loadJson(asset.path);
            case 'text':
                return this.loadText(asset.path);
            case 'binary':
                return this.loadBinary(asset.path);
            default:
                return this.loadBinary(asset.path);
        }
    }

    private async loadAddressableAssets(assets: AddressableManifestAsset[]): Promise<AssetBundle> {
        const bundle: AssetBundle = {
            textures: new Map(),
            materials: new Map(),
            spine: new Map(),
            fonts: new Map(),
            prefabs: new Map(),
            json: new Map(),
            text: new Map(),
            binary: new Map(),
        };

        const promises: Promise<void>[] = [];
        for (const asset of assets) {
            const key = asset.address ?? asset.path;
            switch (asset.type) {
                case 'texture':
                    promises.push(
                        this.loadTexture(asset.path).then(info => { bundle.textures.set(key, info); })
                    );
                    break;
                case 'material':
                    promises.push(
                        this.loadMaterial(asset.path).then(mat => { bundle.materials.set(key, mat); })
                    );
                    break;
                case 'spine': {
                    const atlas = asset.metadata?.atlas;
                    if (atlas) {
                        promises.push(
                            this.loadSpine(asset.path, atlas).then(result => { bundle.spine.set(key, result); })
                        );
                    }
                    break;
                }
                case 'bitmap-font':
                    promises.push(
                        this.loadBitmapFont(asset.path).then(handle => { bundle.fonts.set(key, handle); })
                    );
                    break;
                case 'prefab':
                    promises.push(
                        this.loadPrefab(asset.path).then(data => { bundle.prefabs.set(key, data); })
                    );
                    break;
                case 'audio':
                    promises.push(
                        this.loadBinary(asset.path).then(data => { bundle.binary.set(key, data); })
                    );
                    break;
                case 'json':
                    promises.push(
                        this.loadJson(asset.path).then(data => { bundle.json.set(key, data); })
                    );
                    break;
                case 'text':
                    promises.push(
                        this.loadText(asset.path).then(data => { bundle.text.set(key, data); })
                    );
                    break;
                case 'binary':
                default:
                    promises.push(
                        this.loadBinary(asset.path).then(data => { bundle.binary.set(key, data); })
                    );
                    break;
            }
        }

        const results = await Promise.allSettled(promises);
        for (const result of results) {
            if (result.status === 'rejected') {
                console.warn('[AssetServer] Failed to load asset:', result.reason);
            }
        }
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
        if (this.embeddedOnly_ && !embedded) {
            throw new Error(`Asset not embedded: ${source}`);
        }
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
        this.ctx_.drawImage(img, 0, 0);

        const imageData = this.ctx_.getImageData(0, 0, width, height);
        const pixels = new Uint8Array(imageData.data.buffer);
        this.unpremultiplyAlpha(pixels);

        const rm = this.module_.getResourceManager();
        const ptr = this.module_._malloc(pixels.length);
        this.module_.HEAPU8.set(pixels, ptr);
        const handle = rm.createTexture(width, height, ptr, pixels.length, 1, flip);
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

        const embedded = this.embedded_.get(localPath);
        if (embedded) {
            const content = this.decodeDataUrlText(embedded);
            const { vertex, fragment } = this.parseEsShader(content);
            if (!vertex || !fragment) {
                throw new Error(`Invalid shader format: ${path}`);
            }
            return Material.createShader(vertex, fragment);
        }

        if (this.embeddedOnly_) {
            throw new Error(`Asset not embedded: ${path}`);
        }

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
            if (this.embeddedOnly_) {
                throw new Error(`Asset not embedded: ${url}`);
            }
            const text = await platformReadTextFile(localPath);
            return JSON.parse(text);
        }
        if (this.embeddedOnly_) {
            throw new Error(`Asset not embedded: ${url}`);
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
            if (this.embeddedOnly_) {
                throw new Error(`Asset not embedded: ${url}`);
            }
            return platformReadTextFile(localPath);
        }
        if (this.embeddedOnly_) {
            throw new Error(`Asset not embedded: ${url}`);
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
            if (this.embeddedOnly_) {
                throw new Error(`Asset not embedded: ${url}`);
            }
            return platformReadFile(localPath);
        }
        if (this.embeddedOnly_) {
            throw new Error(`Asset not embedded: ${url}`);
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

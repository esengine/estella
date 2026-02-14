/**
 * @file    EditorAssetServer.ts
 * @brief   AssetServer implementation for editor using NativeFS backend
 */

import type { ESEngineModule } from 'esengine';
import type { TextureInfo, SliceBorder, SpineLoadResult, MaterialHandle, ShaderHandle, MaterialAssetData } from 'esengine';
import { Material, getAssetTypeEntry } from 'esengine';
import { EditorTextureManager } from '../renderer/EditorTextureManager';
import { AssetLoader } from './AssetLoader';
import type { AssetPathResolver } from './AssetPathResolver';
import { parseShaderProperties, getShaderDefaultProperties } from '../shader/ShaderPropertyParser';
import { getAssetEventBus } from '../events/AssetEventBus';
import { getEditorContext } from '../context/EditorContext';
import type { NativeFS } from '../types/NativeFS';
import { parseEsShader, resolveShaderPath } from '../utils/shader';

interface LoadedMaterial {
    handle: MaterialHandle;
    shaderHandle: ShaderHandle;
    path: string;
}

interface MaterialInstance {
    handle: MaterialHandle;
    basePath: string;
    entityId: number;
}

// =============================================================================
// EditorAssetServer
// =============================================================================

export class EditorAssetServer {
    private module_: ESEngineModule;
    private textureManager_: EditorTextureManager;
    private assetLoader_: AssetLoader;
    private pathResolver_: AssetPathResolver;
    private materialCache_ = new Map<string, LoadedMaterial>();
    private materialPending_ = new Map<string, Promise<LoadedMaterial>>();
    private shaderCache_ = new Map<string, ShaderHandle>();
    private materialInstances_ = new Map<string, MaterialInstance>();
    private fontCache_ = new Map<string, number>();
    private fontPending_ = new Map<string, Promise<number>>();

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
        const rm = this.module_.getResourceManager();
        for (const handle of this.fontCache_.values()) {
            rm.releaseBitmapFont(handle);
        }
        this.fontCache_.clear();
    }

    async loadBitmapFont(fontRef: string): Promise<number> {
        const cached = this.fontCache_.get(fontRef);
        if (cached !== undefined) return cached;

        const pending = this.fontPending_.get(fontRef);
        if (pending) return pending;

        const promise = this.loadBitmapFontInternal(fontRef);
        this.fontPending_.set(fontRef, promise);

        try {
            const handle = await promise;
            this.fontCache_.set(fontRef, handle);
            return handle;
        } finally {
            this.fontPending_.delete(fontRef);
        }
    }

    private async loadBitmapFontInternal(fontRef: string): Promise<number> {
        const fs = this.getNativeFS();
        if (!fs) throw new Error('NativeFS not available');

        const fullPath = this.pathResolver_.toAbsolutePath(fontRef);

        let fntRelDir: string;
        let fntFile: string;

        const fontEntry = getAssetTypeEntry(fontRef);
        if (fontEntry?.editorType === 'bitmap-font' && fontEntry.contentType === 'json') {
            const content = await fs.readFile(fullPath);
            if (!content) throw new Error(`Failed to read: ${fullPath}`);
            const json = JSON.parse(content) as { type?: string; fntFile?: string; generatedFnt?: string };
            const f = json.type === 'label-atlas' ? json.generatedFnt : json.fntFile;
            if (!f) throw new Error(`No fnt file in: ${fontRef}`);
            const refDir = fontRef.substring(0, fontRef.lastIndexOf('/'));
            fntRelDir = refDir;
            fntFile = f;
        } else {
            const lastSlash = fontRef.lastIndexOf('/');
            fntRelDir = lastSlash > 0 ? fontRef.substring(0, lastSlash) : '';
            fntFile = lastSlash > 0 ? fontRef.substring(lastSlash + 1) : fontRef;
        }

        const fntFullPath = fntRelDir ? `${this.pathResolver_.toAbsolutePath(fntRelDir)}/${fntFile}` : this.pathResolver_.toAbsolutePath(fntFile);
        const fntContent = await fs.readFile(fntFullPath);
        if (!fntContent) throw new Error(`Failed to read: ${fntFullPath}`);

        const pageMatch = fntContent.match(/file="([^"]+)"/);
        if (!pageMatch) throw new Error(`No page texture in: ${fntFullPath}`);

        const texName = pageMatch[1];
        const texRelPath = fntRelDir ? `${fntRelDir}/${texName}` : texName;

        const texResult = await this.assetLoader_.loadTexture(texRelPath);
        if (!texResult.success || texResult.handle === undefined) {
            throw new Error(`Failed to load font texture: ${texRelPath}`);
        }

        const rm = this.module_.getResourceManager();
        return rm.loadBitmapFont(fntContent, texResult.handle, texResult.width ?? 0, texResult.height ?? 0);
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

    async loadMaterial(path: string): Promise<LoadedMaterial> {
        const cached = this.materialCache_.get(path);
        if (cached) return cached;

        const pending = this.materialPending_.get(path);
        if (pending) return pending;

        const promise = this.loadMaterialInternal(path);
        this.materialPending_.set(path, promise);

        try {
            const result = await promise;
            this.materialCache_.set(path, result);
            return result;
        } finally {
            this.materialPending_.delete(path);
        }
    }

    getMaterial(path: string): LoadedMaterial | undefined {
        return this.materialCache_.get(path);
    }

    hasMaterial(path: string): boolean {
        return this.materialCache_.has(path);
    }

    private async loadMaterialInternal(path: string): Promise<LoadedMaterial> {
        const fs = this.getNativeFS();
        if (!fs) {
            throw new Error('NativeFS not available');
        }

        const fullPath = this.pathResolver_.toAbsolutePath(path);
        const exists = await fs.exists(fullPath);
        if (!exists) {
            throw new Error(`Material file not found: ${fullPath}`);
        }

        const content = await fs.readFile(fullPath);
        if (!content) {
            throw new Error(`Failed to read material file: ${fullPath}`);
        }

        const data = JSON.parse(content) as MaterialAssetData;
        if (data.type !== 'material') {
            throw new Error(`Invalid material file type: ${data.type}`);
        }

        const shaderPath = resolveShaderPath(path, data.shader);

        const shaderDefaults = await this.getShaderDefaultProperties(shaderPath);
        const mergedProperties = { ...shaderDefaults, ...data.properties };
        const mergedData: MaterialAssetData = { ...data, properties: mergedProperties };

        const shaderHandle = await this.loadShader(shaderPath);
        const materialHandle = Material.createFromAsset(mergedData, shaderHandle);

        return {
            handle: materialHandle,
            shaderHandle,
            path,
        };
    }

    private async getShaderDefaultProperties(shaderPath: string): Promise<Record<string, unknown>> {
        const fs = this.getNativeFS();
        if (!fs) return {};

        const fullPath = this.pathResolver_.toAbsolutePath(shaderPath);
        const exists = await fs.exists(fullPath);
        if (!exists) return {};

        const content = await fs.readFile(fullPath);
        if (!content) return {};

        const info = parseShaderProperties(content);
        if (!info.valid) return {};

        return getShaderDefaultProperties(info);
    }

    private async loadShader(path: string): Promise<ShaderHandle> {
        const cached = this.shaderCache_.get(path);
        if (cached) return cached;

        const fs = this.getNativeFS();
        if (!fs) {
            throw new Error('NativeFS not available');
        }

        const fullPath = this.pathResolver_.toAbsolutePath(path);
        const exists = await fs.exists(fullPath);
        if (!exists) {
            throw new Error(`Shader file not found: ${fullPath}`);
        }

        const content = await fs.readFile(fullPath);
        if (!content) {
            throw new Error(`Failed to read shader file: ${fullPath}`);
        }

        const { vertex, fragment } = parseEsShader(content);
        if (!vertex || !fragment) {
            throw new Error(`Invalid shader format: ${path}`);
        }

        const handle = Material.createShader(vertex, fragment);
        this.shaderCache_.set(path, handle);
        return handle;
    }


    private getNativeFS(): NativeFS | null {
        return getEditorContext().fs ?? null;
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

    updateMaterialUniform(path: string, name: string, value: unknown): boolean {
        const cached = this.materialCache_.get(path);
        if (!cached) return false;

        const uniformValue = this.convertToUniformValue(value);
        if (uniformValue !== null) {
            Material.setUniform(cached.handle, name, uniformValue);
            getAssetEventBus().emit({
                type: 'asset:modified',
                category: 'material',
                path,
                handle: cached.handle,
            });
            return true;
        }
        return false;
    }

    updateMaterialBlendMode(path: string, blendMode: number): boolean {
        const cached = this.materialCache_.get(path);
        if (!cached) return false;

        Material.setBlendMode(cached.handle, blendMode);
        getAssetEventBus().emit({
            type: 'asset:modified',
            category: 'material',
            path,
            handle: cached.handle,
        });
        return true;
    }

    reloadMaterial(path: string): void {
        this.materialCache_.delete(path);
        getAssetEventBus().emit({
            type: 'asset:modified',
            category: 'material',
            path,
        });
    }

    createMaterialInstance(
        basePath: string,
        entityId: number,
        overrides: Record<string, unknown>
    ): MaterialHandle {
        const key = `${basePath}:${entityId}`;
        const existing = this.materialInstances_.get(key);
        if (existing) {
            this.applyOverrides(existing.handle, overrides);
            return existing.handle;
        }

        const base = this.materialCache_.get(basePath);
        if (!base) {
            throw new Error(`Base material not loaded: ${basePath}`);
        }

        const instanceHandle = Material.createInstance(base.handle);
        this.applyOverrides(instanceHandle, overrides);

        this.materialInstances_.set(key, {
            handle: instanceHandle,
            basePath,
            entityId,
        });

        return instanceHandle;
    }

    releaseMaterialInstance(entityId: number): void {
        const keysToDelete: string[] = [];
        for (const [key, instance] of this.materialInstances_) {
            if (instance.entityId === entityId) {
                Material.release(instance.handle);
                keysToDelete.push(key);
            }
        }
        for (const key of keysToDelete) {
            this.materialInstances_.delete(key);
        }
    }

    updateMaterialInstanceOverride(
        basePath: string,
        entityId: number,
        name: string,
        value: unknown
    ): boolean {
        const key = `${basePath}:${entityId}`;
        const instance = this.materialInstances_.get(key);
        if (!instance) return false;

        const uniformValue = this.convertToUniformValue(value);
        if (uniformValue !== null) {
            Material.setUniform(instance.handle, name, uniformValue);
            return true;
        }
        return false;
    }

    private applyOverrides(handle: MaterialHandle, overrides: Record<string, unknown>): void {
        for (const [name, value] of Object.entries(overrides)) {
            const uniformValue = this.convertToUniformValue(value);
            if (uniformValue !== null) {
                Material.setUniform(handle, name, uniformValue);
            }
        }
    }

    private convertToUniformValue(value: unknown): import('esengine').UniformValue | null {
        if (typeof value === 'number') {
            return value;
        }
        if (typeof value === 'object' && value !== null) {
            const obj = value as Record<string, number>;
            if ('a' in obj) {
                return { x: obj.r ?? 0, y: obj.g ?? 0, z: obj.b ?? 0, w: obj.a ?? 0 };
            } else if ('w' in obj) {
                return { x: obj.x ?? 0, y: obj.y ?? 0, z: obj.z ?? 0, w: obj.w ?? 0 };
            } else if ('z' in obj) {
                return { x: obj.x ?? 0, y: obj.y ?? 0, z: obj.z ?? 0 };
            } else if ('y' in obj) {
                return { x: obj.x ?? 0, y: obj.y ?? 0 };
            }
        }
        return null;
    }
}

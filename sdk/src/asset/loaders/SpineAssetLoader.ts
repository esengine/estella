import type { AssetLoader, LoadContext, SpineResult } from '../AssetLoader';
import { requireResourceManager } from '../../resourceManager';
import { getAssetTypeEntry } from '../../assetTypes';
import type { ESEngineModule } from '../../wasm';
import type { SpineModuleController } from '../../spine/SpineController';

export class SpineAssetLoader implements AssetLoader<SpineResult> {
    readonly type = 'spine';
    readonly extensions = ['.skel'];

    private module_: ESEngineModule;
    private spineController_: SpineModuleController | null = null;
    private loaded_ = new Set<string>();
    private virtualFSPaths_ = new Set<string>();
    private skeletonHandles_ = new Map<string, number>();

    constructor(module: ESEngineModule) {
        this.module_ = module;
    }

    setSpineController(controller: SpineModuleController): void {
        this.spineController_ = controller;
    }

    getSkeletonHandle(cacheKey: string): number | undefined {
        return this.skeletonHandles_.get(cacheKey);
    }

    isLoaded(cacheKey: string): boolean {
        return this.loaded_.has(cacheKey);
    }

    async load(skeletonPath: string, ctx: LoadContext): Promise<SpineResult> {
        const deps = ctx.catalog.getDeps(skeletonPath);
        const atlasPath = deps.length > 0 ? deps[0] : null;
        if (!atlasPath) {
            throw new Error(`Spine skeleton has no atlas dependency: ${skeletonPath}. Pass atlas explicitly or configure Catalog deps.`);
        }
        return this.loadWithAtlas(skeletonPath, atlasPath, ctx);
    }

    async loadWithAtlas(skeletonPath: string, atlasPath: string, ctx: LoadContext): Promise<SpineResult> {
        const cacheKey = `${skeletonPath}:${atlasPath}`;
        if (this.loaded_.has(cacheKey)) {
            return { skeletonHandle: this.skeletonHandles_.get(cacheKey) ?? -1 };
        }

        const atlasContent = await ctx.loadText(ctx.catalog.getBuildPath(atlasPath));
        const texNames = parseAtlasTextures(atlasContent);
        const atlasDir = atlasPath.substring(0, atlasPath.lastIndexOf('/'));
        const rm = requireResourceManager();

        const texPromises = texNames.map(async (texName) => {
            const texPath = atlasDir ? `${atlasDir}/${texName}` : texName;
            try {
                const texResult = await ctx.loadTexture(texPath, false);
                rm.registerTextureWithPath(texResult.handle, texPath);
                return { name: texName, handle: texResult.handle, width: texResult.width, height: texResult.height };
            } catch (err) {
                console.warn(`[SpineLoader] Failed to load texture: ${texPath}`, err);
                return null;
            }
        });
        const loadedTextures = (await Promise.all(texPromises)).filter(
            (t): t is { name: string; handle: number; width: number; height: number } => t !== null,
        );

        const skelBuildPath = ctx.catalog.getBuildPath(skeletonPath);
        const isBinary = getAssetTypeEntry(skeletonPath)?.contentType === 'binary';
        const skelData = isBinary
            ? new Uint8Array(await ctx.loadBinary(skelBuildPath))
            : await ctx.loadText(skelBuildPath);

        this.writeToVirtualFS(atlasPath, atlasContent);
        this.writeToVirtualFS(skeletonPath, skelData);

        this.loaded_.add(cacheKey);

        let skeletonHandle = -1;
        if (this.spineController_) {
            skeletonHandle = this.spineController_.loadSkeleton(skelData, atlasContent, isBinary);
            if (skeletonHandle >= 0) {
                const pageCount = this.spineController_.getAtlasPageCount(skeletonHandle);
                for (let i = 0; i < pageCount; i++) {
                    const pageName = this.spineController_.getAtlasPageTextureName(skeletonHandle, i);
                    const tex = loadedTextures.find(t => t.name === pageName);
                    if (tex) {
                        const glId = rm.getTextureGLId(tex.handle);
                        this.spineController_.setAtlasPageTexture(
                            skeletonHandle, i, glId, tex.width, tex.height,
                        );
                    }
                }
                this.skeletonHandles_.set(cacheKey, skeletonHandle);
            }
        }

        return { skeletonHandle };
    }

    unload(_asset: SpineResult): void {
        // Spine resources managed by SpineController lifecycle
    }

    releaseAll(): void {
        if (this.spineController_) {
            for (const handle of this.skeletonHandles_.values()) {
                this.spineController_.unloadSkeleton(handle);
            }
        }
        this.skeletonHandles_.clear();
        this.loaded_.clear();
        this.cleanupVirtualFS();
    }

    private writeToVirtualFS(virtualPath: string, data: string | Uint8Array): void {
        if (this.virtualFSPaths_.has(virtualPath)) return;
        const fs = this.module_.FS;
        if (!fs) return;

        try {
            ensureVirtualDir(fs, virtualPath);
            fs.writeFile(virtualPath, data);
            this.virtualFSPaths_.add(virtualPath);
        } catch (e) {
            console.warn(`[SpineLoader] Failed to write virtual FS: ${virtualPath}`, e);
        }
    }

    private cleanupVirtualFS(): void {
        const fs = this.module_.FS;
        if (!fs) return;
        for (const path of this.virtualFSPaths_) {
            try { fs.unlink(path); } catch { /* already removed */ }
        }
        this.virtualFSPaths_.clear();
    }
}

function ensureVirtualDir(fs: any, virtualPath: string): void {
    const dir = virtualPath.substring(0, virtualPath.lastIndexOf('/'));
    if (!dir) return;
    const parts = dir.split('/').filter((p: string) => p);
    let currentPath = '';
    for (const part of parts) {
        currentPath += '/' + part;
        try { fs.mkdir(currentPath); } catch { /* already exists */ }
    }
}

function parseAtlasTextures(content: string): string[] {
    const textures: string[] = [];
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.includes(':') && (/\.png$/i.test(trimmed) || /\.jpg$/i.test(trimmed))) {
            textures.push(trimmed);
        }
    }
    return textures;
}

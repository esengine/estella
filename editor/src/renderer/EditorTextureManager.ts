/**
 * @file    EditorTextureManager.ts
 * @brief   Manages texture loading and mapping for editor scene rendering
 */

import type { ESEngineModule } from 'esengine';
import { parseTextureMetadata, getMetaFilePath } from '../types/TextureMetadata';

// =============================================================================
// Types
// =============================================================================

interface NativeFS {
    readBinaryFile(path: string): Promise<Uint8Array | null>;
    readFile(path: string): Promise<string | null>;
}

interface TextureEntry {
    handle: number;
    width: number;
    height: number;
}

// =============================================================================
// EditorTextureManager
// =============================================================================

export class EditorTextureManager {
    private module_: ESEngineModule;
    private pathToEntry_: Map<string, TextureEntry> = new Map();
    private pendingLoads_: Map<string, Promise<number>> = new Map();

    constructor(module: ESEngineModule) {
        this.module_ = module;
    }

    /**
     * @brief Load texture from file and create GPU texture
     * @param projectDir Project root directory
     * @param texturePath Relative texture path (e.g., "assets/textures/bg.png")
     * @returns Texture handle ID, or 0 if failed
     */
    async loadTexture(projectDir: string, texturePath: string): Promise<number> {
        const fullPath = this.resolvePath(projectDir, texturePath);

        const existing = this.pathToEntry_.get(fullPath);
        if (existing) {
            return existing.handle;
        }

        const pending = this.pendingLoads_.get(fullPath);
        if (pending) {
            return pending;
        }

        const loadPromise = this.loadTextureInternal(projectDir, fullPath);
        this.pendingLoads_.set(fullPath, loadPromise);

        try {
            const handle = await loadPromise;
            return handle;
        } finally {
            this.pendingLoads_.delete(fullPath);
        }
    }

    /**
     * @brief Get cached texture handle
     * @returns Handle ID or null if not loaded
     */
    getHandle(projectDir: string, texturePath: string): number | null {
        const fullPath = this.resolvePath(projectDir, texturePath);
        const entry = this.pathToEntry_.get(fullPath);
        return entry?.handle ?? null;
    }

    /**
     * @brief Get texture dimensions
     */
    getSize(projectDir: string, texturePath: string): { width: number; height: number } | null {
        const fullPath = this.resolvePath(projectDir, texturePath);
        const entry = this.pathToEntry_.get(fullPath);
        if (!entry) return null;
        return { width: entry.width, height: entry.height };
    }

    /**
     * @brief Release all textures
     */
    releaseAll(): void {
        const rm = this.module_.getResourceManager();
        for (const [, entry] of this.pathToEntry_) {
            rm.releaseTexture(entry.handle);
        }
        this.pathToEntry_.clear();
    }

    /**
     * @brief Release a specific texture
     */
    release(projectDir: string, texturePath: string): void {
        const fullPath = this.resolvePath(projectDir, texturePath);
        const entry = this.pathToEntry_.get(fullPath);
        if (entry) {
            const rm = this.module_.getResourceManager();
            rm.releaseTexture(entry.handle);
            this.pathToEntry_.delete(fullPath);
        }
    }

    // =========================================================================
    // Private Methods
    // =========================================================================

    private resolvePath(projectDir: string, texturePath: string): string {
        const normalized = texturePath.replace(/\\/g, '/');
        if (normalized.startsWith('/') || normalized.includes(':')) {
            return normalized;
        }
        return `${projectDir.replace(/\\/g, '/')}/${normalized}`;
    }

    private async loadTextureInternal(projectDir: string, fullPath: string): Promise<number> {
        const fs = this.getNativeFS();
        if (!fs) {
            console.warn('[EditorTextureManager] NativeFS not available');
            return 0;
        }

        const data = await fs.readBinaryFile(fullPath);
        if (!data) {
            console.warn(`[EditorTextureManager] Failed to read: ${fullPath}`);
            return 0;
        }

        const { handle, width, height } = await this.createTextureFromPixels(data);
        if (handle === 0) {
            return 0;
        }

        this.pathToEntry_.set(fullPath, { handle, width, height });

        await this.loadAndApplyMetadata(projectDir, fullPath, handle);

        return handle;
    }

    private async createTextureFromPixels(data: Uint8Array): Promise<{ handle: number; width: number; height: number }> {
        try {
            const blob = new Blob([data.buffer as ArrayBuffer]);
            const bitmap = await createImageBitmap(blob);

            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                bitmap.close();
                return { handle: 0, width: 0, height: 0 };
            }

            // Flip Y-axis to match OpenGL texture coordinates (bottom-to-top)
            // This mirrors stbi_set_flip_vertically_on_load(true) in Desktop C++
            ctx.translate(0, bitmap.height);
            ctx.scale(1, -1);
            ctx.drawImage(bitmap, 0, 0);

            const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
            bitmap.close();

            const pixels = imageData.data;
            const pixelsPtr = this.module_._malloc(pixels.length);
            this.module_.HEAPU8.set(pixels, pixelsPtr);

            const rm = this.module_.getResourceManager();
            const handle = rm.createTexture(
                imageData.width,
                imageData.height,
                pixelsPtr,
                pixels.length,
                1  // RGBA8
            );

            this.module_._free(pixelsPtr);

            return { handle, width: imageData.width, height: imageData.height };
        } catch (e) {
            console.error('[EditorTextureManager] Failed to create texture:', e);
            return { handle: 0, width: 0, height: 0 };
        }
    }

    private async loadAndApplyMetadata(_projectDir: string, texturePath: string, handle: number): Promise<void> {
        const fs = this.getNativeFS();
        if (!fs) return;

        const metaPath = getMetaFilePath(texturePath);
        const metaContent = await fs.readFile(metaPath);
        if (!metaContent) return;

        const metadata = parseTextureMetadata(metaContent);
        if (!metadata) return;

        const { sliceBorder } = metadata;
        if (sliceBorder.left > 0 || sliceBorder.right > 0 ||
            sliceBorder.top > 0 || sliceBorder.bottom > 0) {
            const rm = this.module_.getResourceManager();
            rm.setTextureMetadata(
                handle,
                sliceBorder.left,
                sliceBorder.right,
                sliceBorder.top,
                sliceBorder.bottom
            );
        }
    }

    private getNativeFS(): NativeFS | null {
        return (window as any).__esengine_fs ?? null;
    }
}

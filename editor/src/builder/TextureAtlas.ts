/**
 * @file    TextureAtlas.ts
 * @brief   Build-time texture atlas packer using MaxRects algorithm
 */

import { type AssetLibrary, isUUID } from '../asset/AssetLibrary';
import { joinPath } from '../utils/path';
import type { NativeFS } from '../types/NativeFS';

// =============================================================================
// Types
// =============================================================================

export interface AtlasFrame {
    path: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface AtlasPage {
    width: number;
    height: number;
    frames: AtlasFrame[];
    imageData: Uint8Array;
}

export interface AtlasResult {
    pages: AtlasPage[];
    frameMap: Map<string, { page: number; frame: AtlasFrame }>;
}

interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface RectWithId extends Rect {
    id: string;
}

// =============================================================================
// MaxRects Bin Packing
// =============================================================================

const PADDING = 2;

class MaxRectsBin {
    private width_: number;
    private height_: number;
    private freeRects_: Rect[];
    readonly placed: RectWithId[] = [];

    constructor(width: number, height: number) {
        this.width_ = width;
        this.height_ = height;
        this.freeRects_ = [{ x: 0, y: 0, width, height }];
    }

    insert(width: number, height: number, id: string): RectWithId | null {
        const paddedW = width + PADDING;
        const paddedH = height + PADDING;

        let bestRect: Rect | null = null;
        let bestShortSide = Infinity;
        let bestLongSide = Infinity;
        let bestIndex = -1;

        for (let i = 0; i < this.freeRects_.length; i++) {
            const free = this.freeRects_[i];
            if (paddedW <= free.width && paddedH <= free.height) {
                const leftoverH = free.height - paddedH;
                const leftoverW = free.width - paddedW;
                const shortSide = Math.min(leftoverH, leftoverW);
                const longSide = Math.max(leftoverH, leftoverW);

                if (shortSide < bestShortSide ||
                    (shortSide === bestShortSide && longSide < bestLongSide)) {
                    bestRect = { x: free.x, y: free.y, width: paddedW, height: paddedH };
                    bestShortSide = shortSide;
                    bestLongSide = longSide;
                    bestIndex = i;
                }
            }
        }

        if (!bestRect || bestIndex < 0) return null;

        const result: RectWithId = {
            x: bestRect.x,
            y: bestRect.y,
            width,
            height,
            id,
        };

        this.splitFreeRects(bestRect);
        this.pruneFreeRects();
        this.placed.push(result);

        return result;
    }

    private splitFreeRects(used: Rect): void {
        const newFree: Rect[] = [];

        for (let i = this.freeRects_.length - 1; i >= 0; i--) {
            const free = this.freeRects_[i];

            if (used.x >= free.x + free.width || used.x + used.width <= free.x ||
                used.y >= free.y + free.height || used.y + used.height <= free.y) {
                continue;
            }

            this.freeRects_.splice(i, 1);

            if (used.x > free.x) {
                newFree.push({ x: free.x, y: free.y, width: used.x - free.x, height: free.height });
            }
            if (used.x + used.width < free.x + free.width) {
                newFree.push({
                    x: used.x + used.width, y: free.y,
                    width: free.x + free.width - used.x - used.width, height: free.height,
                });
            }
            if (used.y > free.y) {
                newFree.push({ x: free.x, y: free.y, width: free.width, height: used.y - free.y });
            }
            if (used.y + used.height < free.y + free.height) {
                newFree.push({
                    x: free.x, y: used.y + used.height,
                    width: free.width, height: free.y + free.height - used.y - used.height,
                });
            }
        }

        this.freeRects_.push(...newFree);
    }

    private pruneFreeRects(): void {
        for (let i = 0; i < this.freeRects_.length; i++) {
            for (let j = i + 1; j < this.freeRects_.length; j++) {
                const a = this.freeRects_[i];
                const b = this.freeRects_[j];
                if (this.contains(b, a)) {
                    this.freeRects_.splice(i, 1);
                    i--;
                    break;
                }
                if (this.contains(a, b)) {
                    this.freeRects_.splice(j, 1);
                    j--;
                }
            }
        }
    }

    private contains(outer: Rect, inner: Rect): boolean {
        return inner.x >= outer.x && inner.y >= outer.y &&
            inner.x + inner.width <= outer.x + outer.width &&
            inner.y + inner.height <= outer.y + outer.height;
    }
}

// =============================================================================
// TextureAtlasPacker
// =============================================================================

function isPackableImage(path: string): boolean {
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    return ext === 'png' || ext === 'jpg' || ext === 'jpeg';
}

export class TextureAtlasPacker {
    private fs_: NativeFS;
    private projectDir_: string;
    private assetLibrary_: AssetLibrary | null;

    constructor(fs: NativeFS, projectDir: string, assetLibrary?: AssetLibrary) {
        this.fs_ = fs;
        this.projectDir_ = projectDir;
        this.assetLibrary_ = assetLibrary ?? null;
    }

    private resolveRef(ref: string): string {
        if (this.assetLibrary_ && isUUID(ref)) {
            return this.assetLibrary_.getPath(ref) ?? ref;
        }
        return ref;
    }

    async pack(
        imagePaths: string[],
        sceneDataList: Array<{ name: string; data: Record<string, unknown> }>,
        maxSize: number = 2048,
        allAssetPaths?: string[]
    ): Promise<AtlasResult> {
        const result: AtlasResult = { pages: [], frameMap: new Map() };

        const eligiblePaths = imagePaths.filter(p => isPackableImage(p));
        if (eligiblePaths.length === 0) return result;

        const spineTextures = await this.collectSpineTextures(sceneDataList, allAssetPaths);
        const nineSliceTextures = this.collectNineSliceTextures(sceneDataList);

        const images: Array<{ path: string; width: number; height: number; data: Uint8Array }> = [];

        for (const relPath of eligiblePaths) {
            if (spineTextures.has(relPath) || nineSliceTextures.has(relPath)) continue;

            const fullPath = joinPath(this.projectDir_, relPath);
            const data = await this.fs_.readBinaryFile(fullPath);
            if (!data) continue;

            const size = this.getImageSize(data, relPath);
            if (!size) continue;

            if (size.width > maxSize / 2 || size.height > maxSize / 2) continue;

            images.push({ path: relPath, width: size.width, height: size.height, data });
        }

        if (images.length === 0) return result;

        images.sort((a, b) => Math.max(b.width, b.height) - Math.max(a.width, a.height));

        const bins: MaxRectsBin[] = [];

        for (const img of images) {
            let placed = false;
            for (let i = 0; i < bins.length; i++) {
                const rect = bins[i].insert(img.width, img.height, img.path);
                if (rect) {
                    placed = true;
                    break;
                }
            }
            if (!placed) {
                const bin = new MaxRectsBin(maxSize, maxSize);
                const rect = bin.insert(img.width, img.height, img.path);
                if (rect) {
                    bins.push(bin);
                }
            }
        }

        const imageDataMap = new Map<string, { data: Uint8Array; width: number; height: number }>();
        for (const img of images) {
            imageDataMap.set(img.path, { data: img.data, width: img.width, height: img.height });
        }

        for (let pageIdx = 0; pageIdx < bins.length; pageIdx++) {
            const bin = bins[pageIdx];
            const frames: AtlasFrame[] = [];

            const canvas = new OffscreenCanvas(maxSize, maxSize);
            const ctx = canvas.getContext('2d')!;

            for (const rect of bin.placed) {
                const imgInfo = imageDataMap.get(rect.id);
                if (!imgInfo) continue;

                const blob = new Blob([imgInfo.data.buffer as ArrayBuffer]);
                const bitmap = await createImageBitmap(blob);
                ctx.drawImage(bitmap, rect.x, rect.y);
                bitmap.close();

                const frame: AtlasFrame = {
                    path: rect.id,
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                };
                frames.push(frame);

                result.frameMap.set(rect.id, { page: pageIdx, frame });
            }

            const pngBlob = await canvas.convertToBlob({ type: 'image/png' });
            const pngData = new Uint8Array(await pngBlob.arrayBuffer());

            result.pages.push({
                width: maxSize,
                height: maxSize,
                frames,
                imageData: pngData,
            });
        }

        return result;
    }

    rewriteSceneData(
        sceneData: Record<string, unknown>,
        atlasResult: AtlasResult,
        atlasPathPrefix: string
    ): void {
        const entities = sceneData.entities as Array<{
            components: Array<{ type: string; data: Record<string, unknown> }>;
        }> | undefined;

        if (!entities) return;

        const metadataUpdates: Array<{ oldKey: string; newPath: string }> = [];

        for (const entity of entities) {
            for (const comp of entity.components || []) {
                if (comp.type !== 'Sprite' || !comp.data) continue;

                const textureRef = comp.data.texture;
                if (typeof textureRef !== 'string') continue;

                const texturePath = this.resolveRef(textureRef);
                const entry = atlasResult.frameMap.get(texturePath);
                if (!entry) continue;

                const page = atlasResult.pages[entry.page];
                const frame = entry.frame;
                const atlasTexturePath = `${atlasPathPrefix}atlas_${entry.page}.png`;

                metadataUpdates.push({ oldKey: textureRef as string, newPath: atlasTexturePath });

                comp.data.texture = atlasTexturePath;
                comp.data.uvOffset = {
                    x: frame.x / page.width,
                    y: frame.y / page.height,
                };
                comp.data.uvScale = {
                    x: frame.width / page.width,
                    y: frame.height / page.height,
                };
            }
        }

        const textureMetadata = sceneData.textureMetadata as Record<string, unknown> | undefined;
        if (textureMetadata) {
            for (const { oldKey, newPath } of metadataUpdates) {
                if (textureMetadata[oldKey] && !textureMetadata[newPath]) {
                    textureMetadata[newPath] = textureMetadata[oldKey];
                    delete textureMetadata[oldKey];
                }
            }
        }
    }

    private async collectSpineTextures(
        sceneDataList: Array<{ name: string; data: Record<string, unknown> }>,
        allAssetPaths?: string[]
    ): Promise<Set<string>> {
        const atlasPaths = new Set<string>();

        for (const { data } of sceneDataList) {
            const entities = data.entities as Array<{
                components: Array<{ type: string; data: Record<string, unknown> }>;
            }> | undefined;
            if (!entities) continue;

            for (const entity of entities) {
                for (const comp of entity.components || []) {
                    if (comp.type !== 'SpineAnimation' || !comp.data) continue;
                    const atlasPath = comp.data.atlasPath;
                    if (typeof atlasPath === 'string') {
                        atlasPaths.add(this.resolveRef(atlasPath));
                    }
                }
            }
        }

        if (allAssetPaths) {
            for (const p of allAssetPaths) {
                if (/\.atlas$/i.test(p)) {
                    atlasPaths.add(p);
                }
            }
        }

        const result = new Set<string>();
        for (const atlasRelPath of atlasPaths) {
            const fullPath = joinPath(this.projectDir_, atlasRelPath);
            const content = await this.fs_.readFile(fullPath);
            if (!content) continue;

            const atlasDir = atlasRelPath.substring(0, atlasRelPath.lastIndexOf('/'));
            const lines = content.split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed && !trimmed.includes(':') && (/\.png$/i.test(trimmed) || /\.jpg$/i.test(trimmed))) {
                    const texPath = atlasDir ? `${atlasDir}/${trimmed}` : trimmed;
                    result.add(texPath);
                }
            }
        }
        return result;
    }

    private collectNineSliceTextures(
        sceneDataList: Array<{ name: string; data: Record<string, unknown> }>
    ): Set<string> {
        const result = new Set<string>();
        for (const { data } of sceneDataList) {
            const textureMetadata = data.textureMetadata as Record<string, { sliceBorder?: { left: number; right: number; top: number; bottom: number } }> | undefined;
            if (!textureMetadata) continue;

            for (const [key, metadata] of Object.entries(textureMetadata)) {
                if (metadata?.sliceBorder) {
                    const b = metadata.sliceBorder;
                    if (b.left > 0 || b.right > 0 || b.top > 0 || b.bottom > 0) {
                        result.add(this.resolveRef(key));
                    }
                }
            }
        }
        return result;
    }

    private getImageSize(data: Uint8Array, path: string): { width: number; height: number } | null {
        const ext = path.split('.').pop()?.toLowerCase() ?? '';
        if (ext === 'png') return this.getPngSize(data);
        if (ext === 'jpg' || ext === 'jpeg') return this.getJpegSize(data);
        return null;
    }

    private getPngSize(data: Uint8Array): { width: number; height: number } | null {
        if (data.length < 24) return null;
        if (data[0] !== 0x89 || data[1] !== 0x50 || data[2] !== 0x4E || data[3] !== 0x47) return null;

        const width = (data[16] << 24) | (data[17] << 16) | (data[18] << 8) | data[19];
        const height = (data[20] << 24) | (data[21] << 16) | (data[22] << 8) | data[23];
        return { width, height };
    }

    private getJpegSize(data: Uint8Array): { width: number; height: number } | null {
        if (data.length < 2 || data[0] !== 0xFF || data[1] !== 0xD8) return null;

        let offset = 2;
        while (offset < data.length - 1) {
            if (data[offset] !== 0xFF) return null;
            const marker = data[offset + 1];

            if (marker === 0xC0 || marker === 0xC2) {
                if (offset + 9 > data.length) return null;
                const height = (data[offset + 5] << 8) | data[offset + 6];
                const width = (data[offset + 7] << 8) | data[offset + 8];
                return { width, height };
            }

            if (marker === 0xD9) return null;
            if (marker === 0xD0 || (marker >= 0xD0 && marker <= 0xD7) || marker === 0x01) {
                offset += 2;
                continue;
            }

            const segLen = (data[offset + 2] << 8) | data[offset + 3];
            offset += 2 + segLen;
        }
        return null;
    }

}

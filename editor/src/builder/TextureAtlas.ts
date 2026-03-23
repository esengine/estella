/**
 * @file    TextureAtlas.ts
 * @brief   Build-time texture atlas packer using MaxRects algorithm
 */

import { type AssetLibrary, isUUID } from '../asset/AssetLibrary';
import { type TextureImporterSettings, getEffectiveImporter } from '../asset/ImporterTypes';
import { joinPath } from '../utils/path';
import type { NativeFS } from '../types/NativeFS';
import { parseAtlasTextures } from '../asset/importers/SpineAtlasParser';
import { getComponentAssetFieldDescriptors, getComponentDefaults } from 'esengine';

// =============================================================================
// Types
// =============================================================================

export interface AtlasFrame {
    path: string;
    x: number;
    y: number;
    width: number;
    height: number;
    sourceWidth?: number;
    sourceHeight?: number;
    trimOffsetX?: number;
    trimOffsetY?: number;
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

function isAtlasCapable(componentType: string): boolean {
    const defaults = getComponentDefaults(componentType);
    if (!defaults) return false;
    return 'uvOffset' in defaults && 'uvScale' in defaults;
}

// =============================================================================
// MaxRects Bin Packing
// =============================================================================

const DEFAULT_PADDING = 2;

class MaxRectsBin {
    private width_: number;
    private height_: number;
    private freeRects_: Rect[];
    private padding_: number;
    readonly placed: RectWithId[] = [];

    constructor(width: number, height: number, padding: number = DEFAULT_PADDING) {
        this.width_ = width;
        this.height_ = height;
        this.padding_ = padding;
        this.freeRects_ = [{ x: 0, y: 0, width, height }];
    }

    insert(width: number, height: number, id: string): RectWithId | null {
        const paddedW = width + this.padding_;
        const paddedH = height + this.padding_;

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

interface TrimResult {
    trimX: number;
    trimY: number;
    trimW: number;
    trimH: number;
}

async function detectTrimBounds(data: Uint8Array, width: number, height: number): Promise<TrimResult | null> {
    try {
        const blob = new Blob([data.buffer as ArrayBuffer]);
        const bitmap = await createImageBitmap(blob);
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();

        const imageData = ctx.getImageData(0, 0, width, height);
        const pixels = imageData.data;

        let minX = width, minY = height, maxX = 0, maxY = 0;
        let hasOpaque = false;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const alpha = pixels[(y * width + x) * 4 + 3];
                if (alpha > 0) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                    hasOpaque = true;
                }
            }
        }

        if (!hasOpaque) return null;

        const trimW = maxX - minX + 1;
        const trimH = maxY - minY + 1;

        if (trimW >= width && trimH >= height) return null;

        return { trimX: minX, trimY: minY, trimW, trimH };
    } catch {
        return null;
    }
}

function isPackableImage(path: string): boolean {
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    return ext === 'png' || ext === 'jpg' || ext === 'jpeg';
}

export class TextureAtlasPacker {
    private fs_: NativeFS;
    private projectDir_: string;
    private assetLibrary_: AssetLibrary | null;
    private platform_: string;

    constructor(fs: NativeFS, projectDir: string, assetLibrary?: AssetLibrary, platform?: string) {
        this.fs_ = fs;
        this.projectDir_ = projectDir;
        this.assetLibrary_ = assetLibrary ?? null;
        this.platform_ = platform ?? '';
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
        allAssetPaths?: string[],
        padding: number = DEFAULT_PADDING
    ): Promise<AtlasResult> {
        const result: AtlasResult = { pages: [], frameMap: new Map() };

        const eligiblePaths = imagePaths.filter(p => isPackableImage(p));
        if (eligiblePaths.length === 0) return result;

        const spineTextures = await this.collectSpineTextures(sceneDataList, allAssetPaths);
        const nineSliceTextures = this.collectNineSliceTextures(sceneDataList, eligiblePaths);
        const nonAtlasTextures = this.collectNonAtlasCapableTextures(sceneDataList);

        const images: Array<{ path: string; width: number; height: number; data: Uint8Array; sourceWidth: number; sourceHeight: number; trimX: number; trimY: number }> = [];

        for (const relPath of eligiblePaths) {
            if (spineTextures.has(relPath) || nineSliceTextures.has(relPath) || nonAtlasTextures.has(relPath)) continue;

            const fullPath = joinPath(this.projectDir_, relPath);
            const data = await this.fs_.readBinaryFile(fullPath);
            if (!data) continue;

            const size = this.getImageSize(data, relPath);
            if (!size) continue;

            let texMaxSize = maxSize;
            if (this.assetLibrary_) {
                const uuid = this.assetLibrary_.getUuid(relPath);
                if (uuid) {
                    const entry = this.assetLibrary_.getEntry(uuid);
                    const effective = entry ? getEffectiveImporter(entry.importer, entry.platformOverrides, this.platform_) as TextureImporterSettings : undefined;
                    const perTexMax = effective?.maxSize;
                    if (perTexMax && perTexMax < texMaxSize) {
                        texMaxSize = perTexMax;
                    }
                }
            }

            if (size.width > texMaxSize / 2 || size.height > texMaxSize / 2) continue;

            const trim = await detectTrimBounds(data, size.width, size.height);
            if (trim) {
                images.push({ path: relPath, width: trim.trimW, height: trim.trimH, data, sourceWidth: size.width, sourceHeight: size.height, trimX: trim.trimX, trimY: trim.trimY });
            } else {
                images.push({ path: relPath, width: size.width, height: size.height, data, sourceWidth: size.width, sourceHeight: size.height, trimX: 0, trimY: 0 });
            }
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
                const bin = new MaxRectsBin(maxSize, maxSize, padding);
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
                const imgMeta2 = images.find(i => i.path === rect.id);
                if (imgMeta2 && (imgMeta2.trimX > 0 || imgMeta2.trimY > 0)) {
                    ctx.drawImage(bitmap, imgMeta2.trimX, imgMeta2.trimY, rect.width, rect.height, rect.x, rect.y, rect.width, rect.height);
                } else {
                    ctx.drawImage(bitmap, rect.x, rect.y);
                }
                bitmap.close();

                const imgMeta = images.find(i => i.path === rect.id);
                const frame: AtlasFrame = {
                    path: rect.id,
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                    sourceWidth: imgMeta?.sourceWidth,
                    sourceHeight: imgMeta?.sourceHeight,
                    trimOffsetX: imgMeta?.trimX,
                    trimOffsetY: imgMeta?.trimY,
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

    async packIncremental(
        imagePaths: string[],
        sceneDataList: Array<{ name: string; data: Record<string, unknown> }>,
        cached: AtlasResult | null,
        currentInputHash: string,
        cachedInputHash: string | undefined,
        maxSize: number = 2048,
        allAssetPaths?: string[],
        padding: number = DEFAULT_PADDING
    ): Promise<AtlasResult> {
        if (cached && cachedInputHash && currentInputHash === cachedInputHash) {
            return cached;
        }

        return this.pack(imagePaths, sceneDataList, maxSize, allAssetPaths, padding);
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
                if (!comp.data || !isAtlasCapable(comp.type)) continue;

                const descriptors = getComponentAssetFieldDescriptors(comp.type);
                for (const desc of descriptors) {
                    if (desc.type !== 'texture') continue;

                    const textureRef = comp.data[desc.field];
                    if (typeof textureRef !== 'string') continue;

                    const texturePath = this.resolveRef(textureRef);
                    const entry = atlasResult.frameMap.get(texturePath);
                    if (!entry) continue;

                    const page = atlasResult.pages[entry.page];
                    const frame = entry.frame;
                    const atlasTexturePath = `${atlasPathPrefix}atlas_${entry.page}.png`;

                    metadataUpdates.push({ oldKey: textureRef as string, newPath: atlasTexturePath });

                    comp.data[desc.field] = atlasTexturePath;
                    comp.data.uvOffset = {
                        x: frame.x / page.width,
                        y: 1.0 - (frame.y + frame.height) / page.height,
                    };
                    comp.data.uvScale = {
                        x: frame.width / page.width,
                        y: frame.height / page.height,
                    };
                }
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

        await this.findAtlasFiles(joinPath(this.projectDir_, 'assets'), 'assets', atlasPaths);

        const result = new Set<string>();
        for (const atlasRelPath of atlasPaths) {
            const fullPath = joinPath(this.projectDir_, atlasRelPath);
            const content = await this.fs_.readFile(fullPath);
            if (!content) continue;

            const atlasDir = atlasRelPath.substring(0, atlasRelPath.lastIndexOf('/'));
            for (const texName of parseAtlasTextures(content)) {
                const texPath = atlasDir ? `${atlasDir}/${texName}` : texName;
                result.add(texPath);
            }
        }
        return result;
    }

    private async findAtlasFiles(
        absolutePath: string,
        relativePath: string,
        result: Set<string>
    ): Promise<void> {
        let entries: Array<{ name: string; isDirectory: boolean }>;
        try {
            entries = await this.fs_.listDirectoryDetailed(absolutePath);
        } catch {
            return;
        }
        for (const entry of entries) {
            const childAbsolute = joinPath(absolutePath, entry.name);
            const childRelative = `${relativePath}/${entry.name}`;
            if (entry.isDirectory) {
                await this.findAtlasFiles(childAbsolute, childRelative, result);
            } else if (/\.atlas$/i.test(entry.name)) {
                result.add(childRelative);
            }
        }
    }

    private collectNineSliceTextures(
        sceneDataList: Array<{ name: string; data: Record<string, unknown> }>,
        imagePaths: string[]
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

        if (this.assetLibrary_) {
            for (const imgPath of imagePaths) {
                if (result.has(imgPath)) continue;
                const uuid = this.assetLibrary_.getUuid(imgPath);
                if (!uuid) continue;
                const entry = this.assetLibrary_.getEntry(uuid);
                const effective = entry ? getEffectiveImporter(entry.importer, entry.platformOverrides, this.platform_) as TextureImporterSettings : undefined;
                const border = effective?.sliceBorder;
                if (border && (border.left > 0 || border.right > 0 || border.top > 0 || border.bottom > 0)) {
                    result.add(imgPath);
                }
            }
        }

        return result;
    }

    private collectNonAtlasCapableTextures(
        sceneDataList: Array<{ name: string; data: Record<string, unknown> }>
    ): Set<string> {
        const result = new Set<string>();

        for (const { data } of sceneDataList) {
            const entities = data.entities as Array<{
                components: Array<{ type: string; data: Record<string, unknown> }>;
            }> | undefined;
            if (!entities) continue;

            for (const entity of entities) {
                for (const comp of entity.components || []) {
                    if (!comp.data || isAtlasCapable(comp.type)) continue;

                    const descriptors = getComponentAssetFieldDescriptors(comp.type);
                    for (const desc of descriptors) {
                        if (desc.type !== 'texture') continue;
                        const ref = comp.data[desc.field];
                        if (typeof ref === 'string' && ref) {
                            result.add(this.resolveRef(ref));
                        }
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

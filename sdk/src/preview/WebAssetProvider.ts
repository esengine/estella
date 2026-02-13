/**
 * @file    WebAssetProvider.ts
 * @brief   RuntimeAssetProvider for browser-based preview
 */

import type { RuntimeAssetProvider } from '../runtimeLoader';
import type { SceneData } from '../scene';

export class WebAssetProvider implements RuntimeAssetProvider {
    private textCache_ = new Map<string, string>();
    private binaryCache_ = new Map<string, Uint8Array>();
    private baseUrl_: string;

    constructor(baseUrl: string) {
        this.baseUrl_ = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
    }

    async prefetch(sceneData: SceneData): Promise<void> {
        const textRefs = new Set<string>();
        const binaryRefs = new Set<string>();
        const bmfontRefs = new Set<string>();

        for (const entity of sceneData.entities) {
            for (const comp of entity.components) {
                if (!comp.data) continue;
                if (comp.type === 'SpineAnimation') {
                    const skelPath = comp.data.skeletonPath as string;
                    const atlasPath = comp.data.atlasPath as string;
                    if (skelPath) {
                        if (skelPath.endsWith('.skel')) {
                            binaryRefs.add(skelPath);
                        } else {
                            textRefs.add(skelPath);
                        }
                    }
                    if (atlasPath) textRefs.add(atlasPath);
                }
                if (comp.type === 'BitmapText' && typeof comp.data.font === 'string' && comp.data.font) {
                    bmfontRefs.add(comp.data.font);
                    textRefs.add(comp.data.font);
                }
                if (typeof comp.data.material === 'string' && comp.data.material) {
                    textRefs.add(comp.data.material);
                }
            }
        }

        const fetches: Promise<void>[] = [];

        for (const ref of textRefs) {
            fetches.push(
                fetch(this.resolveUrl(ref))
                    .then(r => r.text())
                    .then(text => { this.textCache_.set(ref, text); })
                    .catch(() => {})
            );
        }

        for (const ref of binaryRefs) {
            fetches.push(
                fetch(this.resolveUrl(ref))
                    .then(r => r.arrayBuffer())
                    .then(buf => { this.binaryCache_.set(ref, new Uint8Array(buf)); })
                    .catch(() => {})
            );
        }

        await Promise.all(fetches);

        const fntFetches: Promise<void>[] = [];
        for (const ref of bmfontRefs) {
            if (!ref.endsWith('.bmfont')) continue;
            const text = this.textCache_.get(ref);
            if (!text) continue;
            try {
                const json = JSON.parse(text);
                const fntFile = json.type === 'label-atlas' ? json.generatedFnt : json.fntFile;
                if (fntFile) {
                    const dir = ref.substring(0, ref.lastIndexOf('/'));
                    const fntRef = dir ? `${dir}/${fntFile}` : fntFile;
                    if (!this.textCache_.has(fntRef)) {
                        fntFetches.push(
                            fetch(this.resolveUrl(fntRef))
                                .then(r => r.text())
                                .then(t => { this.textCache_.set(fntRef, t); })
                                .catch(() => {})
                        );
                    }
                }
            } catch { /* ignore parse errors */ }
        }
        if (fntFetches.length > 0) {
            await Promise.all(fntFetches);
        }
    }

    readText(ref: string): string {
        const cached = this.textCache_.get(ref);
        if (cached !== undefined) return cached;
        throw new Error('Asset not prefetched: ' + ref);
    }

    readBinary(ref: string): Uint8Array {
        const cached = this.binaryCache_.get(ref);
        if (cached !== undefined) return cached;
        throw new Error('Asset not prefetched: ' + ref);
    }

    async loadPixels(ref: string): Promise<{ width: number; height: number; pixels: Uint8Array }> {
        const url = this.resolveUrl(ref);
        const resp = await fetch(url);
        const blob = await resp.blob();
        const bitmap = await createImageBitmap(blob);
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
        bitmap.close();
        return {
            width: imageData.width,
            height: imageData.height,
            pixels: new Uint8Array(imageData.data.buffer),
        };
    }

    resolvePath(ref: string): string {
        return ref;
    }

    private resolveUrl(ref: string): string {
        if (ref.startsWith('http://') || ref.startsWith('https://') || ref.startsWith('/')) {
            return ref;
        }
        return this.baseUrl_ + ref;
    }
}
